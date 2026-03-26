import path from "node:path";
import { openWorkflowStore } from "../db/sqlite-store.mjs";
import { collectProjectFiles, readProjectFile } from "../lib/filesystem.mjs";
import { sha1, stableId } from "../lib/hash.mjs";
import { parseIndexedFile } from "../parsers/index.mjs";
import { deriveCandidateFromNote, reviewCandidates } from "./lifecycle.mjs";
import { buildProjectSummary, buildSmartProjectStatus, createSearchDocumentsForEntities, importLegacyProjections, writeProjectProjections } from "./projections.mjs";
import { auditArchitecture } from "./critic.mjs";
import { SEMANTICS } from "../lib/registry.mjs";

export async function syncProject({ projectRoot = process.cwd(), writeProjections = false } = {}) {
  const store = await openWorkflowStore({ projectRoot });
  const startedAt = new Date().toISOString();

  // LAY-003: Dynamic Artifact Detection
  const dynamicIgnores = await detectBuildArtifacts(projectRoot);

  try {
    const files = await collectProjectFiles(projectRoot, { ignore: dynamicIgnores });
    let symbolCount = 0;
    let claimCount = 0;
    let noteCount = 0;

    for (const relativePath of files) {
      const file = await readProjectFile(projectRoot, relativePath);
      if (file.isBinary) {
        continue;
      }
      const parsed = parseIndexedFile({ filePath: relativePath, content: file.content });
      const notes = parsed.notes.map((note) => ({
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
    // If we find code claims that match ticket keywords, boost confidence or auto-move
    const keywords = ticket.title.toLowerCase().split(" ").filter(w => w.length > 4);
    const matches = claims.filter(c => keywords.some(k => (c.object_text ?? "").toLowerCase().includes(k)));
    
    if (matches.length > 3 && ticket.lane === "Todo") {
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

export async function recordMetric({ projectRoot = process.cwd(), metric }) {
  return withWorkflowStore(projectRoot, async (store) => store.appendMetric(metric));
}

export async function searchProject({ projectRoot = process.cwd(), query, limit = 20 } = {}) {
  return withWorkflowStore(projectRoot, async (store) => store.search(query, { limit }));
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

  // Clear old architectural graph before rebuilding heuristic map
  store.db.prepare("DELETE FROM architectural_graph WHERE predicate = 'belongs_to'").run();

  for (const file of files) {
    const parts = file.path.split("/");
    if (parts.length < 2) continue;

    // Heuristic: first two segments as module name (e.g. core/db, cli/lib)
    const moduleName = (parts[0] === "src" || parts[0] === "core" || parts[0] === "cli") 
      ? parts.slice(0, 2).join("/") 
      : parts[0];

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
