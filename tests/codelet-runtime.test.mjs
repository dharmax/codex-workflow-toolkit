import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { buildSmartCodeletRunContext } from "../core/services/codelet-runtime.mjs";
import { syncProject } from "../core/services/sync.mjs";

test("buildSmartCodeletRunContext resolves a registered codelet and packs lean-ctx-aware context", { concurrency: false }, async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "ai-workflow-codelet-runtime-"));

  try {
    await mkdir(path.join(targetRoot, "src"), { recursive: true });
    await mkdir(path.join(targetRoot, ".ai-workflow", "codelets"), { recursive: true });
    await writeFile(path.join(targetRoot, "src", "app.ts"), [
      "export function runApp() {",
      "  return 'ok';",
      "}"
    ].join("\n"), "utf8");
    await writeFile(path.join(targetRoot, ".ai-workflow", "codelets", "story-snap.json"), JSON.stringify({
      id: "story-snap",
      stability: "staged",
      category: "documentation",
      summary: "Generate a compact story summary from the current project state.",
      runner: "node-script",
      entry: "runtime/scripts/ai-workflow/smart-codelet-runner.mjs",
      status: "staged"
    }, null, 2), "utf8");

    await syncProject({ projectRoot: targetRoot });

    const context = await buildSmartCodeletRunContext({
      projectRoot: targetRoot,
      codeletId: "story-snap",
      filePath: "src/app.ts",
      goal: "summarize the current app"
    });

    assert.equal(context.codelet.id, "story-snap");
    assert.equal(context.codelet.summary, "Generate a compact story summary from the current project state.");
    assert.equal(context.tooling.leanCtx.installed, true);
    assert.match(context.promptContext, /## Files/);
    assert.match(context.promptContext, /File: src\/app\.ts/);
    assert.doesNotMatch(context.promptContext, /lean-ctx is missing/i);
    assert.equal(context.surgicalContext.files[0].path, "src/app.ts");
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});
