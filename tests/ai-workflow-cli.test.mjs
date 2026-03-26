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

test("ai-workflow list reports built-in codelets", async () => {
  const result = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "list", "--json"]);
  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(Array.isArray(payload.toolkitCodelets), true);
  assert.equal(payload.toolkitCodelets.some((item) => item.id === "sync"), true);
});

test("ai-workflow doctor reports local diagnostics and ollama absence cleanly", async () => {
  const result = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "doctor", "--json"]);
  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(typeof payload.cwd, "string");
  assert.equal(typeof payload.ollama, "object");
});

test("ai-workflow can extract a ticket and build a context pack for an initialized repo", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "ai-workflow-smoke-"));

  try {
    await runNode([path.join(repoRoot, "scripts", "init-project.mjs"), "--target", targetRoot]);
    
    const ticketResult = await runNode(
      [path.join(repoRoot, "cli", "ai-workflow.mjs"), "extract", "ticket", "TKT-001"],
      { cwd: targetRoot }
    );
    assert.equal(ticketResult.code, 0);
    assert.match(ticketResult.stdout, /TKT-001/);

    const contextResult = await runNode(
      [path.join(repoRoot, "cli", "ai-workflow.mjs"), "run", "context-pack", "--ticket", "TKT-001"],
      { cwd: targetRoot }
    );
    assert.equal(contextResult.code, 0);
    assert.match(contextResult.stdout, /TKT-001/);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("ai-workflow install creates the core OS workspace and initializes project config", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "ai-workflow-install-"));

  try {
    const result = await runNode(
      [path.join(repoRoot, "cli", "ai-workflow.mjs"), "install", "--project", targetRoot],
      { cwd: targetRoot }
    );
    assert.equal(result.code, 0);
    
    // Check for core directories
    const configPath = path.join(targetRoot, ".ai-workflow", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(config.storage.dbPath, ".ai-workflow/state/workflow.db");
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("project codelets override toolkit codelets by id", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "ai-workflow-override-"));

  try {
    await mkdir(path.join(targetRoot, "scripts"), { recursive: true });
    await writeFile(
      path.join(targetRoot, "scripts", "doctor.mjs"),
      "console.log('project override');\n"
    );
    await runNode([path.join(repoRoot, "scripts", "init-project.mjs"), "--target", targetRoot]);
    await runNode(
      [path.join(repoRoot, "cli", "ai-workflow.mjs"), "add", "doctor", "scripts/doctor.mjs"],
      { cwd: targetRoot }
    );

    const result = await runNode(
      [path.join(repoRoot, "cli", "ai-workflow.mjs"), "run", "doctor"],
      { cwd: targetRoot }
    );
    assert.equal(result.stdout.trim(), "project override");
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});
