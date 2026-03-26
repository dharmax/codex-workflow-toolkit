import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile, spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { installAgents } from "../cli/lib/install.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function runNode(args, options = {}) {
  const captureDir = await mkdtemp(path.join(os.tmpdir(), "codex-workflow-capture-"));
  const stdoutPath = path.join(captureDir, "stdout.log");
  const stderrPath = path.join(captureDir, "stderr.log");
  try {
    await execFileAsync("/usr/bin/bash", ["-lc", `${shellQuote(process.execPath)} ${args.map(shellQuote).join(" ")} > ${shellQuote(stdoutPath)} 2> ${shellQuote(stderrPath)}`], {
      ...options,
      maxBuffer: 8 * 1024 * 1024
    });
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

async function makeTempDir() {
  return mkdtemp(path.join(os.tmpdir(), "codex-workflow-test-"));
}

async function cleanup(dir) {
  await rm(dir, { recursive: true, force: true });
}

async function countInstallableFiles() {
  const runtimeDir = path.resolve(repoRoot, "runtime", "scripts", "codex-workflow");
  const files = await walkFiles(runtimeDir);
  // + templates
  return files.length + 10; 
}

async function walkFiles(dir) {
  const { readdir, stat } = await import("node:fs/promises");
  const entries = await readdir(dir, { withFileTypes: true });
  let files = [];
  for (const entry of entries) {
    const res = path.resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(await walkFiles(res));
    } else {
      files.push(res);
    }
  }
  return files;
}

async function runGit(cwd, args) {
  return execFileAsync("git", args, { cwd });
}

async function appendAuditBlock(knowledgePath, config) {
  const block = [
    "",
    "```codex-workflow-audit",
    JSON.stringify(config, null, 2),
    "```",
    ""
  ].join("\n");
  const current = await readFile(knowledgePath, "utf8");
  await writeFile(knowledgePath, current + block, "utf8");
}

test("installer dry-run reports files without writing them", async () => {
  const targetRoot = await makeTempDir();

  try {
    const result = await runNode([path.join(repoRoot, "scripts", "init-project.mjs"), "--target", targetRoot, "--dry-run"]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Mode: dry-run/);
    assert.match(result.stdout, /Initial sync: skipped \(dry-run\)/);
    assert.match(result.stdout, new RegExp(`Installed: ${await countInstallableFiles()}`));
    await assert.rejects(access(path.join(targetRoot, "AGENTS.md")));
  } finally {
    await cleanup(targetRoot);
  }
});

test("installer writes files, installs CI scaffold, makes scripts executable, and reports identical on rerun", async () => {
  const targetRoot = await makeTempDir();

  try {
    await writeFile(path.join(targetRoot, "package.json"), "{\n  \"name\": \"fixture\"\n}\n");
    const firstRun = await runNode(["scripts/init-project.mjs", "--target", targetRoot]);
    assert.equal(firstRun.code, 0);
    assert.match(firstRun.stdout, /Initial sync: completed/);
    assert.match(firstRun.stdout, new RegExp(`Installed: ${await countInstallableFiles()}`));
    assert.match(firstRun.stdout, /Package scripts installed: 11/);

    const agents = await readFile(path.join(targetRoot, "AGENTS.md"), "utf8");
    assert.match(agents, /AI Agent Protocol: Autonomous Engineering OS/);

    const protocolFile = await readFile(path.join(targetRoot, "execution-protocol.md"), "utf8");
    assert.match(protocolFile, /Required Order/);
    const packageJson = JSON.parse(await readFile(path.join(targetRoot, "package.json"), "utf8"));
    assert.equal(packageJson.scripts["workflow:audit"], "node scripts/codex-workflow/workflow-audit.mjs");
    assert.equal(packageJson.scripts["workflow:guideline-audit"], "node scripts/codex-workflow/guideline-audit.mjs");
    await access(path.join(targetRoot, ".ai-workflow", "state", "workflow.db"));

    const ciWorkflow = await readFile(
      path.join(targetRoot, ".github", "workflows", "codex-workflow-audit.yml"),
      "utf8"
    );
    assert.match(ciWorkflow, /workflow-audit/);

    const auditScriptStat = await import("node:fs/promises").then(m => m.stat(path.join(targetRoot, "scripts", "codex-workflow", "workflow-audit.mjs")));
    assert.equal(auditScriptStat.mode & 0o111, 0o111);

    const secondRun = await runNode(["scripts/init-project.mjs", "--target", targetRoot]);
    assert.equal(secondRun.code, 0);
    assert.match(secondRun.stdout, new RegExp(`Identical: ${await countInstallableFiles()}`));
    assert.match(secondRun.stdout, /Package scripts identical: 11/);
  } finally {
    await cleanup(targetRoot);
  }
});

test("installer supports opting out of the default initial sync", async () => {
  const targetRoot = await makeTempDir();

  try {
    const result = await runNode(["scripts/init-project.mjs", "--target", targetRoot, "--no-sync"]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Initial sync: disabled/);
    await assert.rejects(access(path.join(targetRoot, ".ai-workflow", "state", "workflow.db")));
  } finally {
    await cleanup(targetRoot);
  }
});

test("version reports the installed package version and toolkit root", async () => {
  const result = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "version", "--json"], { cwd: repoRoot });
  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.name, "@dharmax/ai-workflow");
  assert.equal(payload.version, "0.1.0");
  assert.equal(payload.toolkitRoot, repoRoot);
});

test("web tutorial server serves tutorial html and mode-aware tutorial api", async () => {
  const child = spawn(process.execPath, [
    path.join(repoRoot, "cli", "ai-workflow.mjs"),
    "web",
    "tutorial",
    "--mode",
    "tool-dev",
    "--evidence-root",
    path.join(repoRoot, "adventure-machine2-playground"),
    "--port",
    "0",
    "--json"
  ], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    const started = await new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      const timeout = setTimeout(() => reject(new Error(`tutorial server timeout\nstdout: ${stdout}\nstderr: ${stderr}`)), 5000);
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
        const trimmed = stdout.trim();
        if (!trimmed) return;
        try {
          const payload = JSON.parse(trimmed);
          clearTimeout(timeout);
          resolve(payload);
        } catch {
          // wait for complete payload
        }
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`tutorial server exited early with code ${code}\nstdout: ${stdout}\nstderr: ${stderr}`));
      });
    });

    assert.equal(started.mode, "tool-dev");
    assert.equal(typeof started.url, "string");

    const htmlResponse = await fetch(started.url);
    assert.equal(htmlResponse.status, 200);
    const html = await htmlResponse.text();
    assert.match(html, /Use the tool without guessing/i);

    const apiResponse = await fetch(new URL("/api/tutorial", started.url));
    assert.equal(apiResponse.status, 200);
    const apiPayload = await apiResponse.json();
    assert.equal(apiPayload.mode, "tool-dev");
    assert.equal(apiPayload.repairTargetRoot, repoRoot);
    assert.equal(apiPayload.evidenceRoot, path.join(repoRoot, "adventure-machine2-playground"));
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.on("exit", resolve));
  }
});

test("non-interactive shell answers provider status directly without prompting for Ollama hardware", async () => {
  const child = spawn(process.execPath, [
    path.join(repoRoot, "cli", "ai-workflow.mjs"),
    "shell",
    "--no-ai"
  ], {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  child.stdin.write("what ai providers are you connected to right now?\n");
  child.stdin.write("exit\n");
  child.stdin.end();

  const code = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`shell timeout\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, 10000);
    child.on("exit", (exitCode) => {
      clearTimeout(timeout);
      resolve(exitCode ?? 0);
    });
  });

  assert.equal(code, 0, stderr || stdout);
  assert.doesNotMatch(stdout, /Configure Ollama hardware now\?/);
  assert.match(stdout, /AI providers:/);
});

test("non-interactive shell handles version directly", async () => {
  const child = spawn(process.execPath, [
    path.join(repoRoot, "cli", "ai-workflow.mjs"),
    "shell",
    "--no-ai"
  ], {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  child.stdin.write("version\n");
  child.stdin.write("exit\n");
  child.stdin.end();

  const code = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`shell timeout\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, 10000);
    child.on("exit", (exitCode) => {
      clearTimeout(timeout);
      resolve(exitCode ?? 0);
    });
  });

  assert.equal(code, 0, stderr || stdout);
  assert.match(stdout, /@dharmax\/ai-workflow 0\.1\.0/);
  assert.match(stdout, new RegExp(repoRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("one-shot shell request still works when boolean flags come before natural language", async () => {
  const result = await runNode([
    path.join(repoRoot, "cli", "ai-workflow.mjs"),
    "shell",
    "--no-ai",
    "what can you do here?"
  ], { cwd: repoRoot });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /inspect project state/i);
});

test("generated helper scripts work against initialized project state", async () => {
  const targetRoot = await makeTempDir();

  try {
    await writeFile(path.join(targetRoot, "package.json"), "{\n  \"name\": \"fixture\"\n}\n");
    const initResult = await runNode(["scripts/init-project.mjs", "--target", targetRoot]);
    assert.equal(initResult.code, 0);
    assert.match(initResult.stdout, /package\.json found/);
    assert.match(initResult.stdout, /Package scripts installed: 11/);

    const workflowAuditInitial = await runNode(["scripts/codex-workflow/workflow-audit.mjs"], { cwd: targetRoot });
    assert.equal(workflowAuditInitial.code, 0);
    assert.match(workflowAuditInitial.stdout, /workflow-audit: OK/);

    const ticketResult = await runNode(
      ["scripts/codex-workflow/kanban-ticket.mjs", "--id", "TKT-001"],
      { cwd: targetRoot }
    );
    assert.equal(ticketResult.code, 0);
    assert.match(ticketResult.stdout, /TKT-001 \| Backlog \| Replace this example ticket/);

    await runGit(targetRoot, ["init", "-q"]);
    await runGit(targetRoot, ["add", "."]);
    await runGit(targetRoot, ["-c", "user.name=Codex", "-c", "user.email=codex@example.com", "commit", "-qm", "init"]);

    const knowledgePath = path.join(targetRoot, "knowledge.md");
    const knowledgeTemplate = await readFile(knowledgePath, "utf8");
    await writeFile(knowledgePath, knowledgeTemplate.replace("## Facts\n\n- ", "## Facts\n\n- smoke fact"), "utf8");
    await mkdir(path.join(targetRoot, "src"), { recursive: true });
    await writeFile(path.join(targetRoot, "src", "app.ts"), "export const value = 1;\n", "utf8");

    const guidanceResult = await runNode(
      ["scripts/codex-workflow/guidance-summary.mjs", "--ticket", "TKT-001", "--changed"],
      { cwd: targetRoot }
    );
    assert.equal(guidanceResult.code, 0);
    assert.match(guidanceResult.stdout, /Files: knowledge\.md, src\/app\.ts/);
    assert.match(guidanceResult.stdout, /Contributing/);
    assert.match(guidanceResult.stdout, /Execution Protocol/);
    assert.match(guidanceResult.stdout, /Enforcement/);

    const reviewResult = await runNode(["scripts/codex-workflow/review-summary.mjs"], { cwd: targetRoot });
    assert.equal(reviewResult.code, 0);
    assert.match(reviewResult.stdout, /\[modified\] knowledge\.md/);
    assert.match(reviewResult.stdout, /\[untracked\] src\/app\.ts/);
    assert.match(reviewResult.stdout, /source changed without matching test-file changes/);

    const verifyResult = await runNode(
      ["scripts/codex-workflow/verification-summary.mjs", "--cmd", "node -e \"console.log('ok')\""],
      { cwd: targetRoot }
    );
    assert.equal(verifyResult.code, 0);
    assert.match(verifyResult.stdout, /Conclusion: verified/);

    await appendAuditBlock(knowledgePath, {
      forbiddenPatterns: [
        {
          include: ["src"],
          extensions: [".ts"],
          pattern: "TODO",
          message: "TODO markers are banned in src during audit."
        }
      ]
    });
    await writeFile(path.join(targetRoot, "src", "app.ts"), "export const value = 1; // TODO remove\n", "utf8");

    const guidelineAuditFail = await runNode(["scripts/codex-workflow/guideline-audit.mjs"], { cwd: targetRoot });
    assert.equal(guidelineAuditFail.code, 1);
    assert.match(guidelineAuditFail.stderr, /TODO markers are banned in src during audit/);
  } finally {
    await cleanup(targetRoot);
  }
});

test("installer does not overwrite conflicting workflow package scripts without force", async () => {
  const targetRoot = await makeTempDir();

  try {
    await writeFile(
      path.join(targetRoot, "package.json"),
      JSON.stringify({
        name: "fixture",
        scripts: {
          "workflow:audit": "echo 'custom audit'"
        }
      }, null, 2)
    );

    const result = await runNode(["scripts/init-project.mjs", "--target", targetRoot]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Package scripts skipped: 1/);

    const packageJson = JSON.parse(await readFile(path.join(targetRoot, "package.json"), "utf8"));
    assert.equal(packageJson.scripts["workflow:audit"], "echo 'custom audit'");

    const resultForce = await runNode(["scripts/init-project.mjs", "--target", targetRoot, "--force"]);
    assert.equal(resultForce.code, 0);
    assert.match(resultForce.stdout, /Package scripts overwritten: 1/);

    const packageJsonOverwritten = JSON.parse(await readFile(path.join(targetRoot, "package.json"), "utf8"));
    assert.equal(packageJsonOverwritten.scripts["workflow:audit"], "node scripts/codex-workflow/workflow-audit.mjs");
  } finally {
    await cleanup(targetRoot);
  }
});
