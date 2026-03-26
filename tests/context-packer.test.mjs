import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncProject } from "../core/services/sync.mjs";
import { buildSurgicalContext, formatContextForPrompt } from "../core/services/context-packer.mjs";

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

    const prompt = formatContextForPrompt(context);
    assert.match(prompt, /## Files/);
    assert.match(prompt, /File: src\/app\.ts/);
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
