import path from "node:path";
import { withWorkflowStore } from "./sync.mjs";

const QUERY_STOP_WORDS = new Set([
  "about",
  "after",
  "before",
  "current",
  "details",
  "exactly",
  "explain",
  "functionality",
  "issue",
  "relates",
  "related",
  "right",
  "tell",
  "that",
  "the",
  "ticket",
  "what",
  "which",
  "work",
  "working"
]);

export async function inferTicketRetrievalContext({
  projectRoot = process.cwd(),
  ticket = null,
  entity = null,
  queryText = "",
  profile = "execute",
  limit = 8
} = {}) {
  return withWorkflowStore(projectRoot, async (store) => inferTicketRetrievalContextFromStore(store, {
    projectRoot,
    ticket,
    entity,
    queryText,
    profile,
    limit
  }));
}

export function inferTicketRetrievalContextFromStore(store, {
  projectRoot = process.cwd(),
  ticket = null,
  entity = null,
  queryText = "",
  profile = "execute",
  limit = 8
} = {}) {
  const normalizedTicket = normalizeTicket(ticket, entity);
  if (!normalizedTicket.id) {
    return emptyRetrievalResult();
  }

  const files = new Set();
  const symbols = new Map();
  const symbolScores = new Map();
  const tests = new Map();
  const relatedEntities = new Map();
  const fileScores = new Map();
  const fileReasons = new Map();
  const symbolReasons = new Map();
  const testReasons = new Map();
  const entityReasons = new Map();
  const queryEvidence = [];
  const allFiles = Array.isArray(store.listFiles?.()) ? store.listFiles() : [];
  const allEntities = Array.isArray(store.listEntities?.()) ? store.listEntities() : [];
  const fileHintTokens = buildFileHintTokens(normalizedTicket, queryText);

  for (const explicitPath of extractExplicitPaths(normalizedTicket.text)) {
    if (!isUsefulFileCandidate(explicitPath)) {
      continue;
    }
    if (store.getFile?.(explicitPath)) {
      addScoredItem(fileScores, fileReasons, explicitPath, 260, {
        kind: "explicit-path",
        value: explicitPath
      });
    }
  }

  const graphEdges = [
    ...(store.listArchitecturalPredicates?.({ subjectId: normalizedTicket.id }) ?? []),
    ...(store.listArchitecturalPredicates?.({ objectId: normalizedTicket.id }) ?? [])
  ];
  for (const edge of graphEdges) {
    const otherId = edge.subjectId === normalizedTicket.id ? edge.objectId : edge.subjectId;
    collectGraphEdge(store, {
      edge,
      otherId,
      profile,
      fileScores,
      fileReasons,
      symbols,
      symbolScores,
      symbolReasons,
      tests,
      testReasons,
      relatedEntities,
      entityReasons
    });
  }

  const queries = buildTicketQueries(normalizedTicket, queryText);
  for (const query of queries) {
    const rows = store.search?.(query, { limit: 12, scopes: ["entity", "symbol", "file", "note"] }) ?? [];
    const hits = [];
    for (const row of rows) {
      if (row.scope === "file") {
        const filePath = String(row.refId ?? "").trim();
        if (!isUsefulFileCandidate(filePath)) {
          continue;
        }
        const score = scoreSearchResult(row, query, profile, "file", filePath);
        addScoredItem(fileScores, fileReasons, filePath, score, {
          kind: "search-file",
          query,
          title: row.title
        });
        hits.push({ scope: row.scope, title: row.title, refId: row.refId });
        continue;
      }

      if (row.scope === "symbol") {
        const symbol = store.getSymbolById?.(row.refId);
        if (!symbol?.filePath || !isCodePath(symbol.filePath)) {
          continue;
        }
        const symbolLabel = renderSymbolLabel(symbol);
        const symbolScore = scoreSearchResult(row, query, profile, "symbol", symbol.filePath);
        const fileScore = scoreSearchResult(row, query, profile, "symbol-file", symbol.filePath);
        symbols.set(symbolLabel, symbol);
        addScoredItem(fileScores, fileReasons, symbol.filePath, fileScore, {
          kind: "search-symbol-file",
          query,
          title: row.title
        });
        addScoredItem(symbolScores, symbolReasons, symbolLabel, symbolScore, {
          kind: "search-symbol",
          query,
          title: row.title
        });
        hits.push({ scope: row.scope, title: row.title, refId: row.refId });
        continue;
      }

      if (row.scope === "entity") {
        const related = store.getEntity?.(row.refId);
        if (!related || related.id === normalizedTicket.id) {
          continue;
        }
        const relationScore = scoreEntityResult(related, query, profile);
        addScoredItem(relatedEntities, entityReasons, related.id, relationScore, {
          kind: "search-entity",
          query,
          title: related.title
        });
        attachEntityFiles(store, related, {
          profile,
          fileScores,
          fileReasons,
          tests,
          testReasons
        });
        hits.push({ scope: row.scope, title: row.title, refId: row.refId });
        continue;
      }

      if (row.scope === "note") {
        const noteFile = String(row.tags?.find((value) => String(value).includes("/")) ?? "").trim();
        if (!isUsefulFileCandidate(noteFile)) {
          continue;
        }
        const score = profile === "read" ? 24 : 18;
        addScoredItem(fileScores, fileReasons, noteFile, score, {
          kind: "note-hit",
          query,
          title: row.title
        });
        hits.push({ scope: row.scope, title: row.title, refId: noteFile });
      }
    }

    if (hits.length) {
      queryEvidence.push({ query, hits: hits.slice(0, 4) });
    }
  }

  applyLexicalFileHints(allFiles, fileHintTokens, {
    profile,
    fileScores,
    fileReasons
  });

  const rankedFiles = rankFileKeys(fileScores, profile, limit);
  for (const filePath of rankedFiles) {
    files.add(filePath);
  }

  for (const filePath of [...files]) {
    for (const candidate of findRelatedTests(allFiles, filePath)) {
      addScoredItem(tests, testReasons, candidate, profile === "read" ? 18 : 34, {
        kind: "adjacent-test",
        value: filePath
      });
    }
  }

  const rankedSymbols = rankKeys(symbolReasons, Math.min(6, limit));
  const rankedTests = rankKeys(testReasons, Math.min(6, limit));
  const rankedEntities = rankKeys(entityReasons, 4).map((id) => allEntities.find((item) => item.id === id)).filter(Boolean);

  return {
    files: [...files].slice(0, limit),
    symbols: rankedSymbols.map((label) => symbols.get(label) ?? { name: label }),
    tests: rankedTests,
    relatedEntities: rankedEntities,
    evidence: buildEvidence({
      files: [...files],
      rankedSymbols,
      rankedTests,
      rankedEntities,
      fileReasons,
      symbolReasons,
      testReasons,
      entityReasons,
      queryEvidence
    }),
    confidence: estimateConfidence({ files: [...files], rankedSymbols, rankedTests, rankedEntities }),
    fallbackStage: determineFallbackStage({ files: [...files], rankedSymbols, queryEvidence, graphEdges })
  };
}

function normalizeTicket(ticket, entity) {
  const source = ticket ?? entity ?? {};
  return {
    id: String(source.id ?? "").trim(),
    title: String(source.title ?? "").trim(),
    text: [
      ticket?.heading,
      ticket?.body,
      entity?.data?.summary,
      entity?.data?.outcome,
      entity?.data?.verification,
      entity?.data?.epic
    ].map((value) => String(value ?? "").trim()).filter(Boolean).join("\n")
  };
}

function emptyRetrievalResult() {
  return {
    files: [],
    symbols: [],
    tests: [],
    relatedEntities: [],
    evidence: [],
    confidence: 0,
    fallbackStage: "none"
  };
}

function buildTicketQueries(ticket, queryText) {
  const values = [
    ticket.id,
    ticket.title,
    ...tokenize(`${ticket.id}\n${ticket.title}\n${ticket.text}`),
    ...tokenize(queryText)
  ];
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))]
    .filter((value) => value.length >= 4)
    .slice(0, 12);
}

function buildFileHintTokens(ticket, queryText) {
  const tokens = new Set();
  for (const value of [ticket.id, ticket.title, ticket.text, queryText]) {
    for (const token of tokenize(value)) {
      if (token.length >= 4) tokens.add(token);
      if (token.includes("-")) {
        for (const part of token.split("-")) {
          if (part.length >= 4 && !QUERY_STOP_WORDS.has(part)) tokens.add(part);
        }
      }
      if (token.includes("/")) {
        for (const part of token.split("/")) {
          if (part.length >= 4 && !QUERY_STOP_WORDS.has(part)) tokens.add(part);
        }
      }
    }
  }
  return [...tokens].slice(0, 20);
}

function tokenize(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9/_:-]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !QUERY_STOP_WORDS.has(token));
}

function extractExplicitPaths(text) {
  return String(text ?? "").match(/\b(?:src|tests|functions|docs|cli|core|runtime)\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+\b/g) ?? [];
}

function collectGraphEdge(store, {
  edge,
  otherId,
  profile,
  fileScores,
  fileReasons,
  symbols,
  symbolScores,
  symbolReasons,
  tests,
  testReasons,
  relatedEntities,
  entityReasons
}) {
  if (String(otherId).startsWith("file:")) {
    const filePath = otherId.slice(5);
    if (isUsefulFileCandidate(filePath)) {
      addScoredItem(fileScores, fileReasons, filePath, 220, {
        kind: "graph-file",
        value: edge.predicate
      });
    }
    return;
  }

  if (String(otherId).startsWith("symbol:")) {
    const symbol = store.getSymbolById?.(otherId.slice(7));
    if (symbol?.filePath) {
      const symbolLabel = renderSymbolLabel(symbol);
      symbols.set(symbolLabel, symbol);
      addScoredItem(symbolScores, symbolReasons, symbolLabel, 72, {
        kind: "graph-symbol",
        value: edge.predicate
      });
      addScoredItem(fileScores, fileReasons, symbol.filePath, 190, {
        kind: "graph-symbol-file",
        value: edge.predicate
      });
    }
    return;
  }

  if (String(otherId).startsWith("test:")) {
    addScoredItem(tests, testReasons, otherId.slice(5), profile === "read" ? 32 : 54, {
      kind: "graph-test",
      value: edge.predicate
    });
    return;
  }

  const related = store.getEntity?.(otherId);
  if (!related) {
    return;
  }
  addScoredItem(relatedEntities, entityReasons, related.id, 80, {
    kind: "graph-entity",
    value: `${edge.predicate}:${related.entityType}`
  });
  attachEntityFiles(store, related, {
    profile,
    fileScores,
    fileReasons,
    tests,
    testReasons
  });
}

function applyLexicalFileHints(allFiles, tokens, {
  profile,
  fileScores,
  fileReasons
}) {
  if (!Array.isArray(allFiles) || !tokens.length) {
    return;
  }

  for (const entry of allFiles) {
    const filePath = String(entry?.path ?? entry?.relativePath ?? "").trim();
    if (!isUsefulFileCandidate(filePath)) {
      continue;
    }
    const hint = scoreFileHintMatch(filePath, tokens, profile);
    if (!hint) {
      continue;
    }
    addScoredItem(fileScores, fileReasons, filePath, hint.score, {
      kind: "path-hint",
      value: hint.token
    });
  }
}

function attachEntityFiles(store, entity, { profile, fileScores, fileReasons, tests, testReasons }) {
  const edges = store.listArchitecturalPredicates?.({ subjectId: entity.id }) ?? [];
  for (const edge of edges) {
    if (String(edge.objectId).startsWith("file:")) {
      const filePath = edge.objectId.slice(5);
      if (isUsefulFileCandidate(filePath)) {
        addScoredItem(fileScores, fileReasons, filePath, profile === "read" ? 40 : 68, {
          kind: "related-entity-file",
          value: `${entity.id}:${edge.predicate}`
        });
      }
      continue;
    }
    if (String(edge.objectId).startsWith("test:")) {
      addScoredItem(tests, testReasons, edge.objectId.slice(5), profile === "read" ? 16 : 28, {
        kind: "related-entity-test",
        value: `${entity.id}:${edge.predicate}`
      });
    }
  }
}

function scoreSearchResult(row, query, profile, kind, filePath = "") {
  const title = String(row.title ?? "").toLowerCase();
  const normalizedQuery = String(query ?? "").toLowerCase();
  const tags = Array.isArray(row.tags) ? row.tags.map((item) => String(item).toLowerCase()) : [];
  let score = 0;

  if (title === normalizedQuery || title.endsWith(` ${normalizedQuery}`)) score += 90;
  if (title.includes(normalizedQuery)) score += 48;
  if (tags.some((tag) => tag.includes(normalizedQuery))) score += 24;
  if (kind === "symbol") score += profile === "execute" ? 56 : 34;
  if (kind === "symbol-file") score += profile === "execute" ? 34 : 20;
  if (kind === "file") score += profile === "execute" ? 22 : 30;
  score += scorePathBias(filePath, normalizedQuery, profile);
  return score;
}

function scoreFileHintMatch(filePath, tokens, profile) {
  const normalized = String(filePath ?? "").toLowerCase();
  const base = path.basename(normalized);
  const stem = base.replace(/\.[^.]+$/, "");
  const matches = [];

  for (const token of tokens) {
    const normalizedToken = String(token ?? "").toLowerCase();
    if (!normalizedToken) {
      continue;
    }
    if (
      normalized.includes(normalizedToken)
      || base.includes(normalizedToken)
      || stem.includes(normalizedToken)
      || normalizedToken.includes(stem)
    ) {
      matches.push(normalizedToken);
    }
  }

  if (!matches.length) {
    return null;
  }

  const uniqueMatches = [...new Set(matches)];
  let score = 70 + (uniqueMatches.length * 55);
  if (/^(src|functions)\//.test(normalized)) score += 95;
  else if (/^tests\//.test(normalized)) score += 88;
  else if (/^(cli|core|runtime)\//.test(normalized)) score += 36;
  else if (/^scripts\//.test(normalized)) score += 12;
  else if (/^docs\//.test(normalized)) score -= 22;

  if (profile === "execute" && /^scripts\//.test(normalized)) {
    score -= 18;
  }

  return {
    score,
    token: uniqueMatches[0]
  };
}

function scoreEntityResult(entity, query, profile) {
  const haystack = `${entity.id} ${entity.title} ${entity.data?.summary ?? ""}`.toLowerCase();
  const normalizedQuery = String(query ?? "").toLowerCase();
  let score = haystack.includes(normalizedQuery) ? 42 : 16;
  if (entity.entityType === "test") score += profile === "read" ? 26 : 12;
  if (entity.entityType === "ticket") score += 18;
  if (entity.entityType === "epic" || entity.entityType === "story") score += 14;
  if (entity.entityType === "module" || entity.entityType === "feature") score += 20;
  return score;
}

function scorePathBias(filePath, query, profile) {
  const normalized = String(filePath ?? "").toLowerCase();
  let score = 0;
  if (profile === "execute") {
    if (normalized.startsWith("src/") || normalized.startsWith("functions/") || normalized.startsWith("cli/") || normalized.startsWith("core/")) score += 26;
    if (normalized.startsWith("tests/")) score += 18;
    if (normalized.startsWith("docs/")) score -= 8;
  } else {
    if (normalized.startsWith("tests/")) score += 16;
    if (normalized.startsWith("docs/")) score += 10;
  }
  const base = path.basename(normalized);
  if (query && base.includes(query)) score += 22;
  if (/shell|workflow|router|status|ticket|telegram/.test(query) && /shell|workflow|router|status|ticket|telegram/.test(normalized)) score += 18;
  return score;
}

function addScoredItem(scoreMap, reasonMap, key, score, reason) {
  if (!key) {
    return;
  }
  scoreMap.set(key, (scoreMap.get(key) ?? 0) + Number(score ?? 0));
  addScoredItemMap(reasonMap, key, { ...reason, score });
}

function addScoredItemMap(map, key, value) {
  if (!key || value == null) {
    return;
  }
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

function rankFileKeys(scoreMap, profile, limit) {
  const ranked = [...scoreMap.entries()]
    .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])));
  const primaryCode = ranked.filter(([filePath]) => /^(src|functions|tests)\//.test(String(filePath)));
  const projectInfra = ranked.filter(([filePath]) => /^(cli|core|runtime)\//.test(String(filePath)));
  const scripts = ranked.filter(([filePath]) => String(filePath).startsWith("scripts/"));
  const docs = ranked.filter(([filePath]) => String(filePath).startsWith("docs/"));
  const other = ranked.filter(([filePath]) => {
    const normalized = String(filePath);
    return !/^(src|functions|tests|cli|core|runtime|scripts|docs)\//.test(normalized);
  });
  const nonDocs = [...primaryCode, ...projectInfra, ...scripts, ...other];
  const includeDocs = profile === "read" || nonDocs.length < Math.max(3, Math.min(limit, 4));
  const merged = includeDocs ? [...nonDocs, ...docs] : nonDocs;
  return merged.slice(0, limit).map(([filePath]) => filePath);
}

function rankKeys(reasonMap, limit) {
  return [...reasonMap.entries()]
    .sort((left, right) => totalReasonScore(right[1]) - totalReasonScore(left[1]) || String(left[0]).localeCompare(String(right[0])))
    .slice(0, limit)
    .map(([key]) => key);
}

function totalReasonScore(reasons = []) {
  return reasons.reduce((total, item) => total + Number(item?.score ?? 0), 0);
}

function findRelatedTests(allFiles, filePath) {
  const normalized = String(filePath ?? "").toLowerCase();
  const base = path.basename(normalized).replace(/\.[^.]+$/, "");
  const stem = base.replace(/\.(spec|test)$/, "");
  const dir = path.dirname(normalized);
  return allFiles
    .map((item) => String(item.path ?? item.relativePath ?? ""))
    .filter((candidate) => candidate.startsWith("tests/"))
    .filter((candidate) => candidate !== filePath)
    .filter((candidate) => candidate.toLowerCase().includes(stem) || path.dirname(candidate.toLowerCase()).includes(path.basename(dir)));
}

function renderSymbolLabel(symbol) {
  const linePart = Number.isFinite(symbol.line) ? `:${symbol.line}` : "";
  return `${symbol.name} (${symbol.filePath}${linePart})`;
}

function buildEvidence({
  files,
  rankedSymbols,
  rankedTests,
  rankedEntities,
  fileReasons,
  symbolReasons,
  testReasons,
  entityReasons,
  queryEvidence
}) {
  const evidence = [];

  for (const filePath of files.slice(0, 3)) {
    evidence.push({
      kind: "file",
      target: filePath,
      reasons: summarizeReasons(fileReasons.get(filePath))
    });
  }
  for (const symbol of rankedSymbols.slice(0, 2)) {
    evidence.push({
      kind: "symbol",
      target: symbol,
      reasons: summarizeReasons(symbolReasons.get(symbol))
    });
  }
  for (const test of rankedTests.slice(0, 2)) {
    evidence.push({
      kind: "test",
      target: test,
      reasons: summarizeReasons(testReasons.get(test))
    });
  }
  for (const entity of rankedEntities.slice(0, 2)) {
    evidence.push({
      kind: "entity",
      target: entity.id,
      reasons: summarizeReasons(entityReasons.get(entity.id))
    });
  }

  if (!evidence.length) {
    for (const item of queryEvidence.slice(0, 2)) {
      evidence.push({
        kind: "search",
        target: item.query,
        reasons: item.hits.map((hit) => ({ via: hit.scope, title: hit.title, refId: hit.refId }))
      });
    }
  }

  return evidence.slice(0, 6);
}

function summarizeReasons(reasons = []) {
  return (reasons ?? [])
    .sort((left, right) => Number(right?.score ?? 0) - Number(left?.score ?? 0))
    .slice(0, 2)
    .map((reason) => ({
      via: reason.kind,
      title: compactText(reason.title ?? reason.value ?? ""),
      query: reason.query ?? null,
      refId: reason.refId ?? null
    }));
}

function estimateConfidence({ files, rankedSymbols, rankedTests, rankedEntities }) {
  const score = (files.length * 0.2) + (rankedSymbols.length * 0.15) + (rankedTests.length * 0.15) + (rankedEntities.length * 0.1);
  return Math.max(0.2, Math.min(0.98, score));
}

function determineFallbackStage({ files, rankedSymbols, queryEvidence, graphEdges }) {
  if (files.length || rankedSymbols.length) {
    return graphEdges.length ? "graph+search" : "search";
  }
  if (queryEvidence.length) {
    return "search-only";
  }
  return "none";
}

function compactText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
}

function isUsefulFileCandidate(filePath) {
  const normalized = String(filePath ?? "").trim().toLowerCase();
  if (!normalized) return false;
  if (/(^|\/)(pnpm-lock\.ya?ml|package-lock\.json|yarn\.lock|bun\.lockb|cargo\.lock)$/.test(normalized)) return false;
  if (/(^|\/)(dist|build|coverage|playwright-report|test-results|node_modules)\//.test(normalized)) return false;
  if (/^(agents|contributing|execution-protocol|enforcement|knowledge|project-guidelines|kanban|epics)\.md$/.test(normalized)) return false;
  return /\.(m?[jt]sx?|cjs|mts|cts|json|css|riot|md)$/.test(normalized);
}

function isCodePath(filePath) {
  const normalized = String(filePath ?? "").trim().toLowerCase();
  return /(^src\/|^functions\/|^tests\/|^cli\/|^core\/).+\.(m?[jt]sx?|cjs|mts|cts|riot)$/.test(normalized);
}
