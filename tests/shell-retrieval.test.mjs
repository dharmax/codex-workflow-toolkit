import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { syncProject, withWorkflowStore } from "../core/services/sync.mjs";
import { buildTicketEntity } from "../core/services/projections.mjs";
import { inferTicketRetrievalContextFromStore } from "../core/services/shell-retrieval.mjs";
import { buildSurgicalContext, formatContextForPrompt } from "../core/services/context-packer.mjs";
import { inferTicketWorkingSet } from "../runtime/scripts/ai-workflow/lib/workflow-store-utils.mjs";

test("retrieval prefers implementation files and caps tests for implementation-first profiles", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "shell-retrieval-impl-"));

  try {
    const entity = await seedImplementationFirstFixture(targetRoot);
    const result = await withWorkflowStore(targetRoot, async (store) => inferTicketRetrievalContextFromStore(store, {
      projectRoot: targetRoot,
      entity,
      profile: "execute",
      limit: 6
    }));

    assert.deepEqual(result.files.slice(0, 2), [
      "core/services/shell-retrieval.mjs",
      "core/services/context-packer.mjs"
    ]);
    assert.equal(result.files.filter((filePath) => filePath.startsWith("tests/")).length <= 2, true);
    assert.equal(result.symbols.some((symbol) => symbol.name === "inferTicketRetrievalContextFromStore"), true);
    assert.equal(result.fallbackStage, "graph+search");
    assert.equal(result.confidence >= 0.7, true);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("retrieval lowers confidence when only weak lexical evidence is available", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "shell-retrieval-weak-"));

  try {
    await seedWeakEvidenceFixture(targetRoot);
    const result = await withWorkflowStore(targetRoot, async (store) => {
      const entity = store.getEntity("TKT-WEAK-001");
      return inferTicketRetrievalContextFromStore(store, {
        projectRoot: targetRoot,
        entity,
        profile: "execute",
        limit: 5
      });
    });

    assert.equal(result.files.every((filePath) => !/^(core|cli|runtime|src|functions)\//.test(filePath)), true);
    assert.equal(result.confidence < 0.55, true);
    assert.match(result.fallbackStage, /weak-file-match|search-only/);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("buildSurgicalContext surfaces a warning when retrieval evidence is weak", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "shell-retrieval-warning-"));

  try {
    await seedWeakEvidenceFixture(targetRoot);
    const context = await buildSurgicalContext(targetRoot, {
      ticketId: "TKT-WEAK-001"
    });
    const prompt = formatContextForPrompt(context);

    assert.equal((context.retrieval?.confidence ?? 1) < 0.55, true);
    assert.match(prompt, /## Retrieval Warning/);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("inferTicketWorkingSet keeps plan-profile working sets implementation-first", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "shell-retrieval-workset-"));

  try {
    const entity = await seedImplementationFirstFixture(targetRoot);
    const result = await inferTicketWorkingSet({
      root: targetRoot,
      ticket: {
        id: entity.id,
        title: entity.title,
        heading: `${entity.id}: ${entity.title}`,
        body: entity.data?.summary ?? ""
      },
      entity,
      limit: 6
    });

    assert.deepEqual(result.files.slice(0, 2), [
      "core/services/shell-retrieval.mjs",
      "core/services/context-packer.mjs"
    ]);
    assert.equal(result.evidence.some((item) => item.kind === "selected-file" && item.target === "core/services/shell-retrieval.mjs"), true);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

async function seedImplementationFirstFixture(targetRoot) {
  await mkdir(path.join(targetRoot, "core", "services"), { recursive: true });
  await mkdir(path.join(targetRoot, "tests"), { recursive: true });
  await mkdir(path.join(targetRoot, "docs"), { recursive: true });
  await writeFile(path.join(targetRoot, "package.json"), JSON.stringify({ name: "retrieval-fixture", type: "module" }, null, 2), "utf8");
  await writeFile(path.join(targetRoot, "kanban.md"), "# Kanban\n\n## Todo\n- [ ] TKT-RET-001 Improve retrieval ranking\n", "utf8");
  await writeFile(path.join(targetRoot, "core", "services", "shell-retrieval.mjs"), [
    "export function inferTicketRetrievalContextFromStore() {",
    "  return 'retrieval';",
    "}",
    "",
    "export function rankImplementationFiles() {",
    "  return true;",
    "}"
  ].join("\n"), "utf8");
  await writeFile(path.join(targetRoot, "core", "services", "context-packer.mjs"), [
    "export function buildSurgicalContext() {",
    "  return 'context';",
    "}"
  ].join("\n"), "utf8");
  await writeFile(path.join(targetRoot, "tests", "workflow-noise.test.mjs"), "export const workflow = 'workflow retrieval workflow context';\n", "utf8");
  await writeFile(path.join(targetRoot, "tests", "context-noise.test.mjs"), "export const context = 'context workflow retrieval';\n", "utf8");
  await writeFile(path.join(targetRoot, "tests", "shell-retrieval.test.mjs"), "import { inferTicketRetrievalContextFromStore } from '../core/services/shell-retrieval.mjs';\nexport const covered = inferTicketRetrievalContextFromStore;\n", "utf8");
  await writeFile(path.join(targetRoot, "docs", "retrieval.md"), "# Retrieval\n\nworkflow retrieval context notes\n", "utf8");

  await syncProject({ projectRoot: targetRoot });
  return withWorkflowStore(targetRoot, async (store) => {
    const entity = buildTicketEntity({
      id: "TKT-RET-001",
      title: "Improve workflow retrieval ranking",
      lane: "In Progress",
      summary: "Improve workflow retrieval context selection and reduce noisy test-heavy ranking."
    });
    store.upsertEntity(entity);
    const retrievalSymbol = store.listSymbols({ name: "inferTicketRetrievalContextFromStore" })[0];
    store.appendArchitecturalPredicate({
      subjectId: entity.id,
      predicate: "relates_to",
      objectId: "file:core/services/shell-retrieval.mjs"
    });
    store.appendArchitecturalPredicate({
      subjectId: entity.id,
      predicate: "relates_to",
      objectId: "file:core/services/context-packer.mjs"
    });
    store.appendArchitecturalPredicate({
      subjectId: entity.id,
      predicate: "validated_by",
      objectId: "test:tests/shell-retrieval.test.mjs"
    });
    if (retrievalSymbol) {
      store.appendArchitecturalPredicate({
        subjectId: entity.id,
        predicate: "relates_to",
        objectId: `symbol:${retrievalSymbol.id}`
      });
    }
    return store.getEntity(entity.id);
  });
}

async function seedWeakEvidenceFixture(targetRoot) {
  await mkdir(path.join(targetRoot, "tests"), { recursive: true });
  await mkdir(path.join(targetRoot, "docs"), { recursive: true });
  await writeFile(path.join(targetRoot, "package.json"), JSON.stringify({ name: "retrieval-weak-fixture", type: "module" }, null, 2), "utf8");
  await writeFile(path.join(targetRoot, "kanban.md"), "# Kanban\n\n## Todo\n- [ ] TKT-WEAK-001 Workflow retrieval playbook\n", "utf8");
  await writeFile(path.join(targetRoot, "docs", "workflow-retrieval-playbook.md"), "# Workflow retrieval playbook\n\nworkflow retrieval context playbook\n", "utf8");
  await writeFile(path.join(targetRoot, "tests", "workflow-retrieval-noise.test.mjs"), "export const workflow = 'workflow retrieval playbook context';\n", "utf8");

  await syncProject({ projectRoot: targetRoot });
  await withWorkflowStore(targetRoot, async (store) => {
    store.upsertEntity(buildTicketEntity({
      id: "TKT-WEAK-001",
      title: "Workflow retrieval playbook",
      lane: "ToDo",
      summary: "Workflow retrieval playbook and context notes."
    }));
  });
}
