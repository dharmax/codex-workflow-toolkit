import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("installer dry-run reports files without writing them", async () => {
  const targetRoot = await makeTempDir();

  try {
    const result = await runNode(["scripts/init-project.mjs", "--target", targetRoot, "--dry-run"]);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Mode: dry-run/);
    assert.match(result.stdout, new RegExp(`Installed: ${await countInstallableFiles()}`));
    await assert.rejects(access(path.join(targetRoot, "AGENTS.md")));
  } finally {
    await cleanup(targetRoot);
  }
});

test("installer writes files, makes scripts executable, and reports identical on rerun", async () => {
  const targetRoot = await makeTempDir();

  try {
    const firstRun = await runNode(["scripts/init-project.mjs", "--target", targetRoot]);
    assert.equal(firstRun.code, 0);
    assert.match(firstRun.stdout, new RegExp(`Installed: ${await countInstallableFiles()}`));

    const agentFile = await readFile(path.join(targetRoot, "AGENTS.md"), "utf8");
    assert.match(agentFile, /Use `codex-workflow-toolkit`/);
    const protocolFile = await readFile(path.join(targetRoot, "execution-protocol.md"), "utf8");
    assert.match(protocolFile, /Required Order/);

    const scriptStat = await stat(path.join(targetRoot, "scripts", "codex-workflow", "kanban-ticket.mjs"));
    assert.ok((scriptStat.mode & 0o111) !== 0, "expected generated .mjs script to be executable");

    const secondRun = await runNode(["scripts/init-project.mjs", "--target", targetRoot]);
    assert.equal(secondRun.code, 0);
    assert.match(secondRun.stdout, new RegExp(`Identical: ${await countInstallableFiles()}`));
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
    assert.match(`${guidelineAuditFail.stdout}\n${guidelineAuditFail.stderr}`, /TODO markers are banned in src during audit\./);

    await writeFile(path.join(targetRoot, "src", "app.ts"), "export const value = 2;\n", "utf8");
    const workflowAuditFinal = await runNode(["scripts/codex-workflow/workflow-audit.mjs"], { cwd: targetRoot });
    assert.equal(workflowAuditFinal.code, 0);
    assert.match(workflowAuditFinal.stdout, /audit extension blocks: 1/);
  } finally {
    await cleanup(targetRoot);
  }
});

test("workflow audit catches kanban state violations", async () => {
  const targetRoot = await makeTempDir();

  try {
    await writeFile(path.join(targetRoot, "package.json"), "{\n  \"name\": \"fixture\"\n}\n");
    const initResult = await runNode(["scripts/init-project.mjs", "--target", targetRoot]);
    assert.equal(initResult.code, 0);

    const kanbanPath = path.join(targetRoot, "kanban.md");
    const kanban = await readFile(kanbanPath, "utf8");
    const mutatedKanban = kanban.replace(
      "## In Progress\n",
      "## In Progress\n\n### TKT-101 First active ticket\n- Outcome: keep moving.\n\n### TKT-102 Second active ticket\n- Outcome: this should fail the audit.\n"
    );
    await writeFile(kanbanPath, mutatedKanban, "utf8");

    const auditResult = await runNode(["scripts/codex-workflow/workflow-audit.mjs"], { cwd: targetRoot });
    assert.equal(auditResult.code, 1);
    assert.match(`${auditResult.stdout}\n${auditResult.stderr}`, /expected at most 1 ticket in In Progress, found 2/);
  } finally {
    await cleanup(targetRoot);
  }
});

async function runNode(args, options = {}) {
  return runCommand(process.execPath, args, { cwd: repoRoot, ...options });
}

async function runGit(cwd, args) {
  const result = await runCommand("git", args, { cwd });
  assert.equal(result.code, 0, result.stderr || result.stdout);
  return result;
}

async function runCommand(command, args, options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: options.cwd,
      env: process.env
    });

    return {
      code: 0,
      stdout,
      stderr
    };
  } catch (error) {
    return {
      code: error.code ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? error.message
    };
  }
}

async function makeTempDir() {
  return await mkdtemp(path.join(os.tmpdir(), "codex-workflow-toolkit-"));
}

async function cleanup(targetRoot) {
  await rm(targetRoot, { recursive: true, force: true });
}

async function countInstallableFiles() {
  const templates = await walkFiles(path.join(repoRoot, "templates"));
  const runtime = await walkFiles(path.join(repoRoot, "runtime", "scripts", "codex-workflow"));
  return templates.length + runtime.length;
}

async function walkFiles(root) {
  const files = [];
  const entries = await readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await walkFiles(absolutePath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(absolutePath);
    }
  }

  return files;
}

async function appendAuditBlock(filePath, config) {
  const current = await readFile(filePath, "utf8");
  const block = [
    "",
    "## Audit Extensions",
    "",
    "```codex-workflow-audit",
    JSON.stringify(config, null, 2),
    "```",
    ""
  ].join("\n");
  await writeFile(filePath, `${current.trimEnd()}\n${block}`, "utf8");
}
