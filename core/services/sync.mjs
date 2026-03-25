import path from "node:path";
import { openWorkflowStore } from "../db/sqlite-store.mjs";
import { collectProjectFiles, readProjectFile } from "../lib/filesystem.mjs";
import { sha1, stableId } from "../lib/hash.mjs";
import { parseIndexedFile } from "../parsers/index.mjs";
import { deriveCandidateFromNote, reviewCandidates } from "./lifecycle.mjs";
import { buildProjectSummary, createSearchDocumentsForEntities, importLegacyProjections, writeProjectProjections } from "./projections.mjs";

export async function syncProject({ projectRoot = process.cwd(), writeProjections = false } = {}) {
  const store = await openWorkflowStore({ projectRoot });
  const startedAt = new Date().toISOString();

  try {
    const files = await collectProjectFiles(projectRoot);
    let symbolCount = 0;
    let claimCount = 0;
    let noteCount = 0;

    for (const relativePath of files) {
      const file = await readProjectFile(projectRoot, relativePath);
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
