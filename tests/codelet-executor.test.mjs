import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function runNode(args, options = {}) {
  const captureDir = await mkdtemp(path.join(os.tmpdir(), "ai-workflow-capture-"));
  const stdoutPath = path.join(captureDir, "stdout.log");
  const stderrPath = path.join(captureDir, "stderr.log");
  try {
    const shellArgs = args.map(shellQuote).join(" ");
    await execFileAsync("/usr/bin/bash", ["-lc", `${shellQuote(process.execPath)} ${shellArgs} > ${shellQuote(stdoutPath)} 2> ${shellQuote(stderrPath)}`], options);
    return {
      code: 0,
      stdout: await readFile(stdoutPath, "utf8").catch(() => ""),
      stderr: await readFile(stderrPath, "utf8").catch(() => "")
    };
  } catch (error) {
    return {
      code: error.code ?? 1,
      stdout: await readFile(stdoutPath, "utf8").catch(() => error.stdout ?? ""),
      stderr: await readFile(stderrPath, "utf8").catch(() => error.stderr ?? error.message)
    };
  } finally {
    await rm(captureDir, { recursive: true, force: true });
  }
}

function shellQuote(value) {
  return JSON.stringify(String(value));
}

test("ai-workflow run uses in-process JS codelet exports when available", { concurrency: false }, async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "ai-workflow-executor-"));

  try {
    await runNode([path.join(repoRoot, "scripts", "init-project.mjs"), "--target", targetRoot]);
    await mkdir(path.join(targetRoot, ".ai-workflow", "codelets"), { recursive: true });
    await mkdir(path.join(targetRoot, "src"), { recursive: true });
    await writeFile(path.join(targetRoot, "src", "echo-codelet.mjs"), [
      "export async function runSmartCodelet(argv, env) {",
      "  process.stdout.write(JSON.stringify({",
      "    codeletId: env.AIWF_CODELET_ID,",
      "    argv,",
      "    mode: 'in-process'",
      "  }, null, 2) + '\\n');",
      "  return 0;",
      "}"
    ].join("\n"), "utf8");
    await writeFile(path.join(targetRoot, ".ai-workflow", "codelets", "echo-codelet.json"), JSON.stringify({
      id: "echo-codelet",
      stability: "staged",
      category: "documentation",
      summary: "Echo an in-process codelet response.",
      runner: "node-script",
      execution: "js",
      entry: "src/echo-codelet.mjs",
      status: "staged"
    }, null, 2), "utf8");

    const syncResult = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "sync", "--json"], { cwd: targetRoot });
    assert.equal(syncResult.code, 0, syncResult.stderr || syncResult.stdout);

    const runResult = await runNode([
      path.join(repoRoot, "cli", "ai-workflow.mjs"),
      "run",
      "echo-codelet",
      "--json"
    ], { cwd: targetRoot });

    assert.equal(runResult.code, 0, runResult.stderr || runResult.stdout);
    const payload = JSON.parse(runResult.stdout);
    assert.equal(payload.codeletId, "echo-codelet");
    assert.equal(payload.mode, "in-process");
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});
