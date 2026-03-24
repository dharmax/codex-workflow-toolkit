import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addManualNote, getProjectSummary, reviewProjectCandidates, searchProject, syncProject, withWorkflowStore } from "../core/services/sync.mjs";
import { buildTicketEntity, renderKanbanProjection } from "../core/services/projections.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(repoRoot, "tests", "fixtures", "workflow-repo");

test("syncProject indexes a realistic fixture repo and imports legacy projections once", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "workflow-db-"));

  try {
    await cp(fixtureRoot, targetRoot, { recursive: true });
    const result = await syncProject({ projectRoot: targetRoot, writeProjections: true });

    assert.equal(result.indexedFiles >= 8, true);
    assert.equal(result.summary.fileCount >= 8, true);
    assert.equal(result.summary.symbolCount >= 10, true);
    assert.equal(result.summary.noteCount >= 4, true);
    assert.equal(result.importSummary.importedTickets, 2);

    const kanban = await readFile(path.join(targetRoot, "kanban.md"), "utf8");
    assert.match(kanban, /# Kanban/);
    assert.match(kanban, /TKT-100/);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("manual notes, candidate review, and search operate against the DB-first store", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "workflow-db-note-"));

  try {
    await cp(fixtureRoot, targetRoot, { recursive: true });
    await syncProject({ projectRoot: targetRoot });

    const note = await addManualNote({
      projectRoot: targetRoot,
      note: {
        noteType: "BUG",
        body: "shared router can corrupt candidate triage under race conditions",
        filePath: "src/core/router.js",
        line: 3
      }
    });
    assert.equal(note.noteType, "BUG");

    const review = await reviewProjectCandidates({ projectRoot: targetRoot });
    assert.equal(Array.isArray(review.reviewed), true);

    const results = await searchProject({
      projectRoot: targetRoot,
      query: "router"
    });
    assert.equal(results.some((item) => item.title.includes("src/core/router.js") || item.body.includes("router")), true);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("ticket entities render into the projection view", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "workflow-db-ticket-"));

  try {
    await cp(fixtureRoot, targetRoot, { recursive: true });
    await syncProject({ projectRoot: targetRoot });
    await withWorkflowStore(targetRoot, async (store) => {
      store.upsertEntity(buildTicketEntity({
        id: "TKT-222",
        title: "Add deterministic projection coverage",
        lane: "In Progress",
        epicId: "EPC-100",
        summary: "Keep this tied to the DB."
      }));
      store.upsertEntity({
        id: "EPC-100",
        entityType: "epic",
        title: "Fixture Indexing",
        lane: null,
        state: "open",
        confidence: 1,
        provenance: "manual",
        sourceKind: "manual",
        reviewState: "active",
        data: {}
      });

      const projection = renderKanbanProjection(store);
      assert.match(projection, /TKT-222 Add deterministic projection coverage/);
      assert.match(projection, /## In Progress/);
    });

    const summary = await getProjectSummary({ projectRoot: targetRoot });
    assert.equal(summary.activeTickets.some((ticket) => ticket.id === "TKT-222"), true);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("syncProject tolerates duplicate facts emitted from the same file", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "workflow-db-duplicate-facts-"));

  try {
    await writeFile(
      path.join(targetRoot, "README.md"),
      [
        "# Overview",
        "",
        "## Shared",
        "",
        "Repeated heading to force duplicate has-heading facts.",
        "",
        "## Shared"
      ].join("\n"),
      "utf8"
    );

    const result = await syncProject({ projectRoot: targetRoot });
    assert.equal(result.indexedFiles, 1);
    assert.equal(result.indexedClaims >= 3, true);

    const summary = await getProjectSummary({ projectRoot: targetRoot });
    assert.equal(summary.claimCount >= 3, true);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});
