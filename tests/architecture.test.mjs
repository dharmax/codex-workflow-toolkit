import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncProject, withWorkflowStore } from "../core/services/sync.mjs";
import { auditArchitecture } from "../core/services/critic.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(repoRoot, "tests", "fixtures", "workflow-repo");

test("syncProject generates heuristic architectural map", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "arch-sync-"));

  try {
    await cp(fixtureRoot, targetRoot, { recursive: true });
    await syncProject({ projectRoot: targetRoot });

    await withWorkflowStore(targetRoot, async (store) => {
      const modules = store.listModules();
      assert.equal(modules.length > 0, true);
      assert.ok(modules.find(m => m.name === "src/core"));

      const graph = store.getArchitecturalGraph();
      assert.ok(graph.find(p => p.predicate === "belongs_to"));
    });
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("auditArchitecture detects direct circular dependencies", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "arch-audit-"));

  try {
    await cp(fixtureRoot, targetRoot, { recursive: true });
    await syncProject({ projectRoot: targetRoot });

    await withWorkflowStore(targetRoot, async (store) => {
      // Mock a circular dependency: A -> B and B -> A
      // Using existing files from fixture: src/app.ts and src/core/router.js
      const modA = "MOD-SRC";
      const modB = "MOD-SRC-CORE";
      
      store.upsertModule({ id: modA, name: "src" });
      store.upsertModule({ id: modB, name: "src/core" });

      const symA = { id: "sym-a", name: "a", file_path: "src/app.ts", kind: "function", exported: 1, metadata_json: "{}", source_kind: "js", updated_at: "now" };
      const symB = { id: "sym-b", name: "b", file_path: "src/core/router.js", kind: "function", exported: 1, metadata_json: "{}", source_kind: "js", updated_at: "now" };
      
      store.db.prepare("INSERT INTO symbols (id, name, file_path, kind, exported, metadata_json, source_kind, updated_at) VALUES (?,?,?,?,?,?,?,?)").run(symA.id, symA.name, symA.file_path, symA.kind, symA.exported, symA.metadata_json, symA.source_kind, symA.updated_at);
      store.db.prepare("INSERT INTO symbols (id, name, file_path, kind, exported, metadata_json, source_kind, updated_at) VALUES (?,?,?,?,?,?,?,?)").run(symB.id, symB.name, symB.file_path, symB.kind, symB.exported, symB.metadata_json, symB.source_kind, symB.updated_at);

      // A calls B
      store.db.prepare("INSERT INTO claims (id, subject_id, predicate, object_id, kind, confidence, provenance, source_kind, lifecycle_state, updated_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run("c1", symA.id, "calls", symB.id, "ast", 1, "test", "js", "active", "now", "now");
      // B calls A
      store.db.prepare("INSERT INTO claims (id, subject_id, predicate, object_id, kind, confidence, provenance, source_kind, lifecycle_state, updated_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run("c2", symB.id, "calls", symA.id, "ast", 1, "test", "js", "active", "now", "now");

      const findings = await auditArchitecture(targetRoot);
      assert.ok(findings.find(f => f.type === "circular-dependency"));
    });
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});
