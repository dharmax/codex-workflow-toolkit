import path from "node:path";
import { openWorkflowStore } from "../db/sqlite-store.mjs";
import { collectProjectFiles, readProjectFile } from "../lib/filesystem.mjs";
import { sha1, stableId } from "../lib/hash.mjs";
import { parseIndexedFile } from "../parsers/index.mjs";
import { deriveCandidateFromNote, reviewCandidates } from "./lifecycle.mjs";
import { buildProjectSummary, buildSmartProjectStatus, compareEpicPriority, createSearchDocumentsForEntities, importLegacyProjections, writeProjectProjections } from "./projections.mjs";
import { auditArchitecture } from "./critic.mjs";
import { SEMANTICS } from "../lib/registry.mjs";
import { evaluateReadiness } from "./readiness-evaluator.mjs";

export async function syncProject({ projectRoot = process.cwd(), writeProjections = false } = {}) {
  const store = await openWorkflowStore({ projectRoot });
  const startedAt = new Date().toISOString();

  // LAY-003: Dynamic Artifact Detection
  const dynamicIgnores = await detectBuildArtifacts(projectRoot);

  try {
    const files = await collectProjectFiles(projectRoot, { ignore: dynamicIgnores });
    store.pruneIndexedFiles(files);
    let symbolCount = 0;
    let claimCount = 0;
    let noteCount = 0;

    for (const relativePath of files) {
      const file = await readProjectFile(projectRoot, relativePath);
      if (file.isBinary) {
        continue;
      }
      const parsed = parseIndexedFile({ filePath: relativePath, content: file.content });
      const filteredNotes = filterIndexedNotes(relativePath, parsed.notes);
      const notes = filteredNotes.map((note) => ({
        ...note,
        ...deriveCandidateScores(note, relativePath)
      }));
      parsed.notes = notes;
      store.replaceIndexedFile({
        file,
        parsed,
        sha1: sha1(file.content),
        indexedAt: startedAt
      });
      symbolCount += parsed.symbols.length;
      claimCount += parsed.facts.length;
      noteCount += parsed.notes.length;
    }

    const importSummary = await importLegacyProjections(store, { projectRoot });
    
    // Architectural Mapping (Heuristic Phase 1)
    await syncArchitecture(projectRoot, store);

    store.cleanupDerivedState();
    for (const note of store.listNotes()) {
      const candidate = deriveCandidateFromNote(note);
      if (candidate.status === "ignored") {
        continue;
      }
      store.upsertCandidate(candidate);
    }

    const lifecycle = reviewCandidates(store);
    createSearchDocumentsForEntities(store);

    // RAG-003: Shadow Sync
    await performShadowSync(store, projectRoot);

    store.setMeta("lastSync", {
      startedAt,
      fileCount: files.length,
      symbolCount,
      claimCount,
      noteCount
    });

    let projections = null;
    if (writeProjections) {
      projections = await writeProjectProjections(store, { projectRoot });
    }

    const summary = buildProjectSummary(store);
    return {
      projectRoot,
      dbPath: store.dbPath,
      indexedFiles: files.length,
      indexedSymbols: symbolCount,
      indexedClaims: claimCount,
      indexedNotes: noteCount,
      importSummary,
      lifecycle,
      projections,
      summary
    };
  } finally {
    store.close();
  }
}

function filterIndexedNotes(relativePath, notes = []) {
  if (!shouldSuppressIndexedNotes(relativePath)) {
    return notes;
  }
  return [];
}

function shouldSuppressIndexedNotes(relativePath) {
  const normalized = String(relativePath ?? "").replace(/\\/g, "/").toLowerCase();
  return normalized === "kanban.md"
    || normalized === "epics.md"
    || normalized === "docs/kanban.md"
    || normalized === "docs/epics.md"
    || normalized.endsWith("/kanban.md")
    || normalized.endsWith("/epics.md")
    || normalized === "progress.md"
    || normalized.endsWith("/progress.md");
}

async function detectBuildArtifacts(root) {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(root).catch(() => []);
  const suspects = ["dist", "build", "target", "out", ".next", ".turbo"];
  return entries.filter(e => suspects.includes(e));
}

async function performShadowSync(store, root) {
  const tickets = store.listEntities({ entityType: "ticket", states: ["open"] });
  const claims = store.db.prepare("SELECT * FROM claims WHERE lifecycle_state = 'active'").all();
  
  for (const ticket of tickets) {
    const ticketId = ticket.id.toLowerCase();
    const titlePhrase = ticket.title.toLowerCase().replace(/\s+/g, " ").trim();

    // Only mutate workflow state when we have strong evidence:
    // an explicit ticket-id mention, or repeated exact-title mentions for long titles.
    const idMatches = claims.filter((claim) => (claim.object_text ?? "").toLowerCase().includes(ticketId));
    const titleMatches = titlePhrase.length >= 24
      ? claims.filter((claim) => (claim.object_text ?? "").toLowerCase().includes(titlePhrase))
      : [];

    if ((idMatches.length >= 1 || titleMatches.length >= 2) && ticket.lane === "Todo") {
      store.upsertEntity({ ...ticket, lane: "In Progress", provenance: "shadow-sync-inference" });
    }
  }
}

export async function withWorkflowStore(projectRoot, callback) {
  const store = await openWorkflowStore({ projectRoot });
  try {
    return await callback(store);
  } finally {
    store.close();
  }
}

export async function getProjectSummary({ projectRoot = process.cwd() } = {}) {
  return withWorkflowStore(projectRoot, async (store) => buildProjectSummary(store));
}

export async function getSmartProjectStatus({ projectRoot = process.cwd() } = {}) {
  const auditFindings = await auditArchitecture(projectRoot);
  return withWorkflowStore(projectRoot, async (store) => buildSmartProjectStatus(store, { auditFindings }));
}

export async function getProjectMetrics({ projectRoot = process.cwd() } = {}) {
  return withWorkflowStore(projectRoot, async (store) => store.getMetricsSummary());
}

export async function evaluateProjectReadiness({ projectRoot = process.cwd(), request } = {}) {
  return withWorkflowStore(projectRoot, async (store) => evaluateReadiness(store, request));
}

export async function recordMetric({ projectRoot = process.cwd(), metric }) {
  return withWorkflowStore(projectRoot, async (store) => store.appendMetric(metric));
}

export async function searchProject({ projectRoot = process.cwd(), query, limit = 20 } = {}) {
  return withWorkflowStore(projectRoot, async (store) => store.search(query, { limit }));
}

export async function listEpics({ projectRoot = process.cwd(), includeArchived = false } = {}) {
  return withWorkflowStore(projectRoot, async (store) => {
    const epics = store.listEntities({ entityType: "epic" })
      .filter((epic) => includeArchived || epic.state !== "archived")
      .sort(compareEpicPriority)
      .map((epic) => buildEpicSummary(store, epic));
    return epics;
  });
}

export async function getEpic({ projectRoot = process.cwd(), epicId } = {}) {
  if (!epicId) {
    return null;
  }

  return withWorkflowStore(projectRoot, async (store) => {
    const epic = store.getEntity(epicId);
    return epic?.entityType === "epic" ? buildEpicDetail(store, epic) : null;
  });
}

export async function searchEpics({ projectRoot = process.cwd(), query, limit = 20 } = {}) {
  const normalizedQuery = normalizeSearchQuery(query);
  if (!normalizedQuery) {
    return [];
  }

  return withWorkflowStore(projectRoot, async (store) => {
    const epics = store.listEntities({ entityType: "epic" })
      .filter((epic) => epic.state !== "archived")
      .map((epic) => buildEpicDetail(store, epic))
      .map((epic) => ({
        ...epic,
        score: scoreEpicMatch(epic, normalizedQuery)
      }))
      .filter((epic) => epic.score > 0)
      .sort((left, right) => right.score - left.score || compareEpicPriority(left, right) || String(left.id).localeCompare(String(right.id)))
      .slice(0, limit);

    return epics;
  });
}

export async function listEpicUserStories({ projectRoot = process.cwd(), epicId, includeArchived = false } = {}) {
  return withWorkflowStore(projectRoot, async (store) => {
    const epic = epicId ? store.getEntity(epicId) : null;
    if (epicId && (!epic || epic.entityType !== "epic")) {
      return [];
    }

    const epics = epic
      ? [epic]
      : store.listEntities({ entityType: "epic" }).filter((entry) => includeArchived || entry.state !== "archived").sort(compareEpicPriority);

    return epics.flatMap((entry) => buildEpicStories(store, entry));
  });
}

export async function searchEpicUserStories({ projectRoot = process.cwd(), query, epicId = null, limit = 20 } = {}) {
  const normalizedQuery = normalizeSearchQuery(query);
  if (!normalizedQuery) {
    return [];
  }

  return withWorkflowStore(projectRoot, async (store) => {
    const epics = epicId
      ? [store.getEntity(epicId)].filter(Boolean)
      : store.listEntities({ entityType: "epic" }).filter((entry) => entry.state !== "archived");

    return epics
      .sort(compareEpicPriority)
      .flatMap((entry) => buildEpicStories(store, entry))
      .map((story) => ({
        ...story,
        score: scoreStoryMatch(story, normalizedQuery)
      }))
      .filter((story) => story.score > 0)
      .sort((left, right) => right.score - left.score || String(left.epic.id).localeCompare(String(right.epic.id)) || left.index - right.index)
      .slice(0, limit);
  });
}

export async function createTicket({ projectRoot = process.cwd(), entity }) {
  return withWorkflowStore(projectRoot, async (store) => {
    store.upsertEntity(entity);
    createSearchDocumentsForEntities(store);
    return entity;
  });
}

export async function addManualNote({ projectRoot = process.cwd(), note }) {
  return withWorkflowStore(projectRoot, async (store) => {
    const candidateScores = deriveCandidateScores(note, note.filePath ?? "manual");
    const materialized = {
      ...note,
      id: note.id ?? stableId("manual-note", note.filePath ?? "manual", note.noteType, note.body),
      sourceKind: "manual",
      provenance: note.provenance ?? "manual"
    };
    store.upsertNote({
      ...materialized,
      ...candidateScores
    });
    const stored = store.listNotes({ filePath: note.filePath }).find((item) => item.id === materialized.id)
      ?? store.listNotes().find((item) => item.id === materialized.id);
    if (stored) {
      const candidate = deriveCandidateFromNote(stored);
      if (candidate.status !== "ignored") {
        store.upsertCandidate(candidate);
      }
    }
    return stored ?? materialized;
  });
}

export async function reviewProjectCandidates({ projectRoot = process.cwd() } = {}) {
  return withWorkflowStore(projectRoot, async (store) => reviewCandidates(store));
}

async function syncArchitecture(projectRoot, store) {
  const files = store.db.prepare("SELECT path FROM files").all();
  const modules = new Map();

  // Rebuild the heuristic module map from the current indexed snapshot only.
  store.resetArchitecture();

  for (const file of files) {
    const moduleName = inferModuleName(file.path);
    if (!moduleName) continue;

    if (!modules.has(moduleName)) {
      const moduleId = `MOD-${moduleName.toUpperCase().replace(/\//g, "-")}`;
      modules.set(moduleName, moduleId);
      store.upsertModule({
        id: moduleId,
        name: moduleName,
        responsibility: `Heuristic module for ${moduleName}`
      });
    }

    const moduleId = modules.get(moduleName);
    store.appendArchitecturalPredicate({
      subjectId: file.path,
      predicate: "belongs_to",
      objectId: moduleId
    });
  }
}

function buildEpicSummary(store, epic) {
  const detail = buildEpicDetail(store, epic);
  return {
    id: detail.id,
    title: detail.title,
    state: detail.state,
    summary: detail.summary,
    userStoryCount: detail.userStories.length,
    ticketBatchCount: detail.ticketBatches.length,
    linkedTicketCount: detail.linkedTickets.length
  };
}

function buildEpicDetail(store, epic) {
  const linkedTickets = store.listEntities({ entityType: "ticket" })
    .filter((ticket) => ticket.parentId === epic.id || ticket.data?.epic === epic.id)
    .map((ticket) => ({
      id: ticket.id,
      title: ticket.title,
      lane: ticket.lane,
      state: ticket.state,
      userStory: ticket.data?.userStory ?? null
    }));

  const userStories = normalizeStoryList(epic.data?.userStories ?? epic.data?.stories ?? []);
  const ticketBatches = normalizeStoryList(epic.data?.ticketBatches ?? epic.data?.batches ?? []);

  return {
    id: epic.id,
    title: epic.title,
    state: epic.state,
    summary: String(epic.data?.summary ?? "").trim(),
    userStories,
    ticketBatches,
    linkedTickets,
    data: epic.data ?? {}
  };
}

function buildEpicStories(store, epic) {
  const detail = buildEpicDetail(store, epic);
  return detail.userStories.map((story, index) => ({
    epic: {
      id: detail.id,
      title: detail.title,
      state: detail.state,
      summary: detail.summary,
      data: epic.data ?? {}
    },
    index: index + 1,
    heading: `Story ${index + 1}`,
    body: story,
    ticketBatch: detail.ticketBatches[index] ?? null
  }));
}

function normalizeStoryList(values = []) {
  return values.map((story) => String(story ?? "").trim()).filter(Boolean);
}

function normalizeSearchQuery(query) {
  return String(query ?? "").trim().toLowerCase();
}

function scoreEpicMatch(epic, query) {
  const haystacks = [
    epic.id,
    epic.title,
    epic.summary,
    epic.userStories.join("\n"),
    epic.ticketBatches.join("\n")
  ].join("\n").toLowerCase();

  if (!haystacks.includes(query)) {
    const tokens = query.split(/\s+/).filter(Boolean);
    if (!tokens.every((token) => haystacks.includes(token))) {
      return 0;
    }
  }

  let score = 10;
  if (epic.id.toLowerCase().includes(query)) score += 40;
  if (epic.title.toLowerCase().includes(query)) score += 30;
  if (epic.summary.toLowerCase().includes(query)) score += 15;
  if (epic.userStories.some((story) => story.toLowerCase().includes(query))) score += 10;
  if (epic.ticketBatches.some((batch) => batch.toLowerCase().includes(query))) score += 5;
  return score;
}

function scoreStoryMatch(story, query) {
  const haystack = [
    story.epic.id,
    story.epic.title,
    story.heading,
    story.body,
    story.ticketBatch ?? ""
  ].join("\n").toLowerCase();

  if (!haystack.includes(query)) {
    const tokens = query.split(/\s+/).filter(Boolean);
    if (!tokens.every((token) => haystack.includes(token))) {
      return 0;
    }
  }

  let score = 10;
  if (story.body.toLowerCase().includes(query)) score += 35;
  if (story.epic.title.toLowerCase().includes(query)) score += 10;
  if (story.heading.toLowerCase().includes(query)) score += 5;
  if (story.ticketBatch?.toLowerCase().includes(query)) score += 5;
  return score;
}

function inferModuleName(filePath) {
  const parts = String(filePath).split("/").filter(Boolean);
  if (!parts.length) {
    return null;
  }

  const [root, second] = parts;
  const sourceRoots = new Set(["src", "core", "cli", "runtime", "functions"]);
  const auxiliaryRoots = new Set(["tests", "scripts", "docs", "design", "public"]);
  const ignoredRoots = new Set([
    ".ai-workflow",
    ".claude",
    ".github",
    ".obsidian",
    "artifacts",
    "playwright-report",
    "test-results",
    "coverage",
    "output"
  ]);

  if (ignoredRoots.has(root)) {
    return null;
  }

  if (parts.length === 1) {
    return null;
  }

  if (sourceRoots.has(root)) {
    if (second && !looksLikeFileName(second)) {
      return `${root}/${second}`;
    }
    return root;
  }

  if (auxiliaryRoots.has(root)) {
    if (second && !looksLikeFileName(second)) {
      return `${root}/${second}`;
    }
    return root;
  }

  if (parts.length >= 2 && !looksLikeFileName(second)) {
    return `${root}/${second}`;
  }

  return root;
}

function looksLikeFileName(segment) {
  return /\.[A-Za-z0-9]+$/.test(segment);
}

function deriveCandidateScores(note, filePath) {
  const derived = deriveCandidateFromNote({
    ...note,
    id: note.id ?? stableId("note-score", filePath, note.noteType, note.line ?? 0, note.body),
    filePath
  });
  return {
    riskScore: derived.riskScore,
    leverageScore: derived.leverageScore,
    ticketValueScore: derived.ticketValueScore,
    candidateScore: derived.score
  };
}
