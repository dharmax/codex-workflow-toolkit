import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("ai-workflow list reports built-in codelets", async () => {
  const result = await runNode(["cli/ai-workflow.mjs", "list", "--json"]);

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.toolkitCodelets.some((item) => item.id === "guidelines"), true);
  assert.equal(payload.toolkitCodelets.some((item) => item.id === "context-pack"), true);
});

test("ai-workflow doctor reports local diagnostics and ollama absence cleanly", async () => {
  const result = await runNode(["cli/ai-workflow.mjs", "doctor", "--json"]);

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(typeof payload.cpuCount, "number");
  assert.equal(typeof payload.ollama.installed, "boolean");
});

test("ai-workflow can extract a ticket and build a context pack for an initialized repo", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "ai-workflow-"));

  try {
    await writeFile(path.join(targetRoot, "package.json"), "{\n  \"name\": \"fixture\"\n}\n", "utf8");
    const initResult = await runNode(["scripts/init-project.mjs", "--target", targetRoot]);
    assert.equal(initResult.code, 0);

    await mkdir(path.join(targetRoot, "src"), { recursive: true });
    await writeFile(path.join(targetRoot, "src", "app.ts"), "export const value = 1;\n", "utf8");

    const ticketResult = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "extract", "ticket", "TKT-001"], { cwd: targetRoot });
    assert.equal(ticketResult.code, 0);
    assert.match(ticketResult.stdout, /TKT-001/);

    const contextPackResult = await runNode(
      [path.join(repoRoot, "cli", "ai-workflow.mjs"), "run", "context-pack", "--ticket", "TKT-001", "--files", "src/app.ts", "--json"],
      { cwd: targetRoot }
    );
    assert.equal(contextPackResult.code, 0);
    const payload = JSON.parse(contextPackResult.stdout);
    assert.equal(payload.ticket.id, "TKT-001");
    assert.equal(payload.workingSet.includes("src/app.ts"), true);
    assert.equal(typeof payload.resumePrompt, "string");
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("ai-workflow install links agent skills and initializes project config", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "ai-workflow-install-"));

  try {
    const result = await runNode(
      [path.join(repoRoot, "cli", "ai-workflow.mjs"), "install", "codex", "--project", targetRoot],
      { cwd: targetRoot }
    );
    assert.equal(result.code, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.results.some((item) => item.status === "linked" || item.status === "identical"), true);

    const config = JSON.parse(await readFile(path.join(targetRoot, ".ai-workflow", "config.json"), "utf8"));
    assert.equal(config.installedAgents.includes("codex"), true);
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
      "process.stdout.write(JSON.stringify({ source: 'project' }) + '\\n');\n",
      "utf8"
    );

    const addResult = await runNode(
      [path.join(repoRoot, "cli", "ai-workflow.mjs"), "add", "doctor", "scripts/doctor.mjs"],
      { cwd: targetRoot }
    );
    assert.equal(addResult.code, 0);

    const runResult = await runNode(
      [path.join(repoRoot, "cli", "ai-workflow.mjs"), "run", "doctor"],
      { cwd: targetRoot }
    );
    assert.equal(runResult.code, 0);
    assert.match(runResult.stdout, /"source":"project"/);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

async function runNode(args, options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, args, {
      cwd: options.cwd ?? repoRoot,
      maxBuffer: 8 * 1024 * 1024
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return {
      code: error.code ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? ""
    };
  }
}
