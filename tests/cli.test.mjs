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
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, args, {
      ...options,
      maxBuffer: 8 * 1024 * 1024
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return {
      code: error.code ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? error.message
    };
  }
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
