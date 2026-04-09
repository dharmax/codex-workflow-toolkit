import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncProject, withWorkflowStore } from "../core/services/sync.mjs";
import { buildSurgicalContext, formatContextForPrompt } from "../core/services/context-packer.mjs";
import { buildTicketEntity } from "../core/services/projections.mjs";
import { writeFile } from "node:fs/promises";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(repoRoot, "tests", "fixtures", "workflow-repo");

test("buildSurgicalContext pulls specific files and limits lines", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "ctx-packer-"));

  try {
    await cp(fixtureRoot, targetRoot, { recursive: true });
    await syncProject({ projectRoot: targetRoot });

    const context = await buildSurgicalContext(targetRoot, {
      filePaths: ["src/app.ts"]
    });

    assert.equal(context.files.length, 1);
    assert.equal(context.files[0].path, "src/app.ts");
    assert.equal(context.tooling.leanCtx.installed, true);

    const prompt = formatContextForPrompt(context);
    assert.match(prompt, /## Files/);
    assert.match(prompt, /File: src\/app\.ts/);
    assert.doesNotMatch(prompt, /lean-ctx is missing/i);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("buildSurgicalContext pulls symbol snippets from indexed symbol records", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "ctx-packer-symbol-"));

  try {
    await cp(fixtureRoot, targetRoot, { recursive: true });
    await syncProject({ projectRoot: targetRoot });

    const context = await buildSurgicalContext(targetRoot, {
      symbolNames: ["runApp"]
    });

    assert.equal(context.symbols.length >= 1, true);
    assert.equal(context.symbols[0].name, "runApp");
    assert.equal(context.symbols[0].kind, "function");
    assert.match(context.symbols[0].snippet, /export function runApp/);

    const prompt = formatContextForPrompt(context);
    assert.match(prompt, /## Relevant Symbols/);
    assert.match(prompt, /function runApp \(src\/app\.ts:9\)/);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("buildSurgicalContext infers retrieval-backed files for a ticket", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "ctx-packer-ticket-"));

  try {
    await cp(fixtureRoot, targetRoot, { recursive: true });
    await mkdir(path.join(targetRoot, "tests"), { recursive: true });
    await writeFile(
      path.join(targetRoot, "docs", "kanban.md"),
      [
        "# Kanban",
        "",
        "## In Progress",
        "- [ ] **REF-APP-SHELL-01**: Continue app-shell hardening",
        "  - Summary: Restore app shell overlay handling and deep-link routing.",
        "",
        "## Todo"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(targetRoot, "src", "app-shell.ts"),
      "export function restoreOverlayRouting() { return true; }\n",
      "utf8"
    );
    await writeFile(
      path.join(targetRoot, "tests", "app-shell.test.mjs"),
      "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { restoreOverlayRouting } from '../src/app-shell.ts';\ntest('restoreOverlayRouting', () => { assert.equal(restoreOverlayRouting(), true); });\n",
      "utf8"
    );
    await syncProject({ projectRoot: targetRoot });
    await withWorkflowStore(targetRoot, async (store) => {
      store.upsertEntity(buildTicketEntity({
        id: "REF-APP-SHELL-01",
        title: "Continue app-shell hardening",
        lane: "In Progress",
        summary: "Restore app shell overlay handling and deep-link routing."
      }));
    });

    const context = await buildSurgicalContext(targetRoot, {
      ticketId: "REF-APP-SHELL-01"
    });

    assert.equal(context.ticket.id, "REF-APP-SHELL-01");
    assert.equal(context.files.some((file) => file.path === "src/app-shell.ts"), true);
    assert.equal(Array.isArray(context.retrieval?.evidence), true);
    assert.equal(context.retrieval.evidence.length > 0, true);

    const prompt = formatContextForPrompt(context);
    assert.match(prompt, /## Retrieval Evidence/);
    assert.match(prompt, /src\/app-shell\.ts/);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});
