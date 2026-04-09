import path from "node:path";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { readText } from "./fs-utils.mjs";
import { findTicket, parseKanban } from "./kanban-utils.mjs";
import { inferTicketRetrievalContext } from "../../../../core/services/shell-retrieval.mjs";

export async function selectKanbanSource(root, relativePath = null) {
  const candidates = relativePath
    ? [String(relativePath)]
    : ["docs/kanban.md", "kanban.md"];

  let best = {
    path: candidates[0],
    text: "",
    score: -1
  };

  for (const candidate of candidates) {
    const candidatePath = String(candidate);
    const text = await readText(path.resolve(root, candidatePath));
    const score = countKanbanTickets(text);
    if (score > best.score) {
      best = { path: candidatePath, text, score };
    }
  }

  return best;
}

export async function loadTicketContext({ root, ticketId, kanbanPath = null }) {
  const entity = await loadTicketEntityFromStore(root, ticketId);
  if (entity) {
    const sourcePath = extractProjectionPath(entity.provenance) ?? "workflow-db";
    const sourceTicket = sourcePath !== "workflow-db"
      ? await loadTicketFromKanbanSource(root, sourcePath, ticketId)
      : null;
    return {
      ticket: sourceTicket ? mergeEntityTicket(entity, sourceTicket) : runtimeTicketFromEntity(entity),
      entity,
      sourcePath
    };
  }

  const source = await selectKanbanSource(root, kanbanPath);
  if (!source.text.trim()) {
    return {
      ticket: null,
      entity: null,
      sourcePath: source.path
    };
  }

  const parsed = parseKanban(source.text);
  return {
    ticket: findTicket(parsed, { id: ticketId }),
    entity: null,
    sourcePath: source.path
  };
}

export async function inferTicketWorkingSet({ root, ticket, entity = null, limit = 8 } = {}) {
  if (!ticket) {
    return { files: [], symbols: [], evidence: [] };
  }

  const retrieval = await inferTicketRetrievalContext({
    projectRoot: root,
    ticket,
    entity,
    profile: "plan",
    limit
  });

  return {
    files: retrieval.files,
    symbols: retrieval.symbols.map((symbol) => renderSymbolLabel({
      name: symbol.name,
      file_path: symbol.filePath ?? symbol.path ?? "",
      line: symbol.line ?? null
    })),
    evidence: normalizeWorkingSetEvidence(retrieval.evidence)
  };
}

function normalizeWorkingSetEvidence(evidence = []) {
  return (Array.isArray(evidence) ? evidence : []).map((entry) => {
    if (entry?.kind === "file") {
      return { ...entry, kind: "selected-file" };
    }
    if (entry?.kind === "symbol") {
      return { ...entry, kind: "selected-symbol" };
    }
    return entry;
  });
}

async function loadTicketEntityFromStore(root, ticketId) {
  const dbPath = path.resolve(root, ".ai-workflow", "state", "workflow.db");
  if (!existsSync(dbPath)) return null;

  let db = null;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const row = db.prepare("SELECT * FROM entities WHERE id = ? AND entity_type = 'ticket'").get(ticketId);
    if (!row) return null;
    return {
      id: row.id,
      entityType: row.entity_type,
      title: row.title,
      lane: row.lane,
      state: row.state,
      confidence: row.confidence,
      provenance: row.provenance,
      sourceKind: row.source_kind,
      reviewState: row.review_state,
      parentId: row.parent_id,
      relevantUntil: row.relevant_until,
      consultationQuestion: row.consultation_question,
      data: parseJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  } catch {
    return null;
  } finally {
    db?.close?.();
  }
}

function runtimeTicketFromEntity(entity) {
  const body = renderEntityBody(entity);
  return {
    id: entity.id,
    title: entity.title,
    heading: `${entity.id}: ${entity.title}`,
    section: entity.lane ?? "Todo",
    line: null,
    doneDate: entity.data?.completedAt ?? null,
    body
  };
}

async function loadTicketFromKanbanSource(root, relativePath, ticketId) {
  const text = await readText(path.resolve(root, relativePath));
  if (!text.trim()) return null;
  const parsed = parseKanban(text);
  return findTicket(parsed, { id: ticketId });
}

function mergeEntityTicket(entity, sourceTicket) {
  return {
    ...sourceTicket,
    title: entity.title || sourceTicket.title,
    section: entity.lane ?? sourceTicket.section,
    body: sourceTicket.body?.trim() ? sourceTicket.body : renderEntityBody(entity)
  };
}

function renderEntityBody(entity) {
  const lines = [];
  const summary = String(entity.data?.summary ?? "").trim();
  if (summary) lines.push(summary);

  const fieldLabels = new Map([
    ["outcome", "Outcome"],
    ["verification", "Verification"],
    ["epic", "Epic"],
    ["completedAt", "Completed"]
  ]);

  for (const [key, label] of fieldLabels.entries()) {
    const value = String(entity.data?.[key] ?? "").trim();
    if (value) lines.push(`${label}: ${value}`);
  }

  return lines.join("\n");
}

function extractProjectionPath(provenance) {
  const text = String(provenance ?? "");
  const match = text.match(/legacy-kanban-import:(.+)$/);
  return match ? match[1] : null;
}

function countKanbanTickets(text) {
  return parseKanban(text).tickets.length;
}

function parseJson(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function buildTicketQueries(ticket, entity) {
  const candidates = [
    ticket.id,
    ticket.title,
    entity?.data?.outcome,
    entity?.data?.verification,
    entity?.data?.epic
  ];

  for (const token of tokenizeTicketText(`${ticket.heading ?? ""}\n${ticket.body ?? ""}`)) {
    candidates.push(token);
    if (token.includes("-")) {
      for (const part of token.split("-")) {
        candidates.push(part);
      }
    }
  }

  return [...new Set(candidates.map((value) => String(value ?? "").trim()).filter(Boolean))]
    .filter((value) => value.length >= 4)
    .slice(0, 10);
}

function tokenizeTicketText(text) {
  const stop = new Set(["after", "before", "should", "would", "could", "their", "there", "about", "continue", "review", "findings", "restore", "global", "screen", "valid"]);
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9/_:-]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !stop.has(token));
}

function searchIndex(db, query, limit) {
  const trimmed = String(query).trim().toLowerCase();
  if (!trimmed) return [];

  return db.prepare(`
    SELECT id, scope, ref_id, title, body, tags, updated_at,
      (CASE
        WHEN scope = 'entity' AND (',' || lower(tags) || ',') LIKE '%,' || ? || ',%' THEN 130
        WHEN scope = 'entity' AND lower(title) LIKE ? || ' %' THEN 125
        WHEN scope = 'symbol' AND lower(title) LIKE '% ' || ? THEN 120
        WHEN scope = 'symbol' AND lower(tags) LIKE '%' || ? || '%' THEN 110
        WHEN scope = 'symbol' AND lower(title) = ? THEN 105
        WHEN scope = 'symbol' AND lower(title) LIKE '%' || ? || '%' THEN 85
        WHEN lower(title) LIKE '%' || ? || '%' THEN 40
        WHEN lower(body) LIKE '%' || ? || '%' THEN 20
        ELSE 0
      END) AS score
    FROM search_index
    WHERE (lower(title) LIKE '%' || ? || '%' OR lower(body) LIKE '%' || ? || '%')
    ORDER BY score DESC, updated_at DESC
    LIMIT ?
  `).all(trimmed, trimmed, trimmed, trimmed, trimmed, trimmed, trimmed, trimmed, trimmed, trimmed, limit);
}

function getSymbolById(db, symbolId) {
  return db.prepare("SELECT id, file_path, name, kind, line FROM symbols WHERE id = ?").get(symbolId) ?? null;
}

function getEntityById(db, entityId) {
  const row = db.prepare("SELECT id, entity_type, title, data_json, state FROM entities WHERE id = ?").get(entityId);
  if (!row) return null;
  return {
    id: row.id,
    entityType: row.entity_type,
    title: row.title,
    state: row.state,
    data: parseJson(row.data_json)
  };
}

function scoreSearchRow(row, query, kind, filePath = "") {
  const title = String(row.title ?? "").toLowerCase();
  const normalized = String(query ?? "").toLowerCase();
  let score = Number(row.score ?? 0);

  if (title === normalized || title.endsWith(` ${normalized}`)) score += 30;
  if (kind === "symbol") score += 25;
  if (kind === "symbol-file") score += 15;
  if (/(app-shell|modal|overlay|route|dialog)/.test(normalized) && /(app-shell|modal|overlay|route|dialog)/.test(title)) score += 20;
  score += scorePathBias(filePath, normalized);
  return score;
}

function bumpScore(map, key, value) {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + Number(value ?? 0));
}

function rankedKeys(map, limit) {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))
    .slice(0, limit)
    .map(([key]) => key);
}

function rankFileKeys(map, limit) {
  const ranked = [...map.entries()]
    .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])));
  const primary = ranked.filter(([key]) => !String(key).toLowerCase().startsWith("docs/"));
  const supporting = ranked.filter(([key]) => String(key).toLowerCase().startsWith("docs/"));
  const selected = primary.length >= Math.min(limit, 6)
    ? primary
    : [...primary, ...supporting];
  return selected
    .slice(0, limit)
    .map(([key]) => key);
}

function collectReason(map, key, reason) {
  if (!key) return;
  const list = map.get(key) ?? [];
  list.push(reason);
  map.set(key, list);
}

function buildSelectionEvidence({ files, symbols, fileReasons, symbolReasons, fallbackEvidence }) {
  const evidence = [];

  for (const filePath of files.slice(0, 4)) {
    const reasons = summarizeReasons(fileReasons.get(filePath));
    if (!reasons.length) continue;
    evidence.push({
      kind: "selected-file",
      target: filePath,
      reasons
    });
  }

  for (const symbol of symbols.slice(0, 3)) {
    const reasons = summarizeReasons(symbolReasons.get(symbol));
    if (!reasons.length) continue;
    evidence.push({
      kind: "selected-symbol",
      target: symbol,
      reasons
    });
  }

  if (evidence.length) {
    return evidence.slice(0, 6);
  }

  return fallbackEvidence.slice(0, 6);
}

function summarizeReasons(reasons = []) {
  return reasons
    .sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0))
    .slice(0, 2)
    .map((reason) => ({
      query: reason.query,
      via: reason.via,
      title: compactReasonText(reason.title),
      refId: reason.refId
    }));
}

function compactReasonText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
}

function collectRelatedQueries(db, rows, activeTicketId, target) {
  for (const row of rows) {
    if (row.scope !== "entity") continue;
    const entity = getEntityById(db, row.ref_id);
    if (!entity || entity.entityType !== "ticket" || entity.id === activeTicketId || entity.state === "archived") continue;
    for (const token of tokenizeTicketText(`${entity.id}\n${entity.title}\n${entity.data?.summary ?? ""}\n${entity.data?.outcome ?? ""}\n${entity.data?.verification ?? ""}`)) {
      if (token.length >= 4) target.add(token);
    }
  }
}

function renderSymbolLabel(symbol) {
  const filePath = symbol.file_path ?? symbol.filePath ?? "";
  const linePart = Number.isFinite(symbol.line) ? `:${symbol.line}` : "";
  return `${symbol.name} (${filePath}${linePart})`;
}

function isUsefulFileCandidate(filePath) {
  const normalized = String(filePath ?? "").trim().toLowerCase();
  if (!normalized) return false;
  if (/(^|\/)(pnpm-lock\.ya?ml|package-lock\.json|yarn\.lock|bun\.lockb|cargo\.lock)$/.test(normalized)) return false;
  if (/(^|\/)(dist|build|coverage|playwright-report|test-results|node_modules)\//.test(normalized)) return false;
  if (/^(agents|contributing|execution-protocol|enforcement|knowledge|project-guidelines|kanban|epics)\.md$/.test(normalized)) return false;
  if (normalized.startsWith("src/") || normalized.startsWith("functions/")) {
    return /\.(m?[jt]sx?|cjs|mts|cts|json|css|riot)$/.test(normalized);
  }
  if (normalized.startsWith("tests/")) {
    return /\.(m?[jt]sx?|cjs|mts|cts|json|css|riot)$/.test(normalized);
  }
  if (normalized.startsWith("docs/")) {
    return /\.md$/.test(normalized);
  }
  return false;
}

function isCodePath(filePath) {
  const normalized = String(filePath ?? "").trim().toLowerCase();
  return /(^src\/|^functions\/|^tests\/).+\.(m?[jt]sx?|cjs|mts|cts|riot)$/.test(normalized);
}

function scorePathBias(filePath, normalizedQuery) {
  const normalized = String(filePath ?? "").trim().toLowerCase();
  if (!normalized) return 0;

  let score = 0;
  if (normalized.startsWith("src/")) score += 60;
  else if (normalized.startsWith("functions/")) score += 45;
  else if (normalized.startsWith("tests/")) score += 20;
  else if (normalized.startsWith("docs/")) score -= 10;

  if (/\.(m?[jt]sx?|cjs|mts|cts|riot)$/.test(normalized)) score += 30;
  if (/\.md$/.test(normalized)) score -= 25;
  if (/(app-shell|modal|overlay|route|dialog|session|state)/.test(normalized)) score += 35;
  if (normalizedQuery && normalized.includes(normalizedQuery.replace(/\s+/g, "-"))) score += 20;
  if (normalizedQuery && normalized.includes(normalizedQuery.replace(/\s+/g, "/"))) score += 15;
  return score;
}
