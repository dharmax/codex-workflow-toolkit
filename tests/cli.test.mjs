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

test("installer writes files, installs CI scaffold, makes scripts executable, and reports identical on rerun", async () => {
  const targetRoot = await makeTempDir();

  try {
    await writeFile(path.join(targetRoot, "package.json"), "{\n  \"name\": \"fixture\"\n}\n");
    const firstRun = await runNode(["scripts/init-project.mjs", "--target", targetRoot]);
    assert.equal(firstRun.code, 0);
    assert.match(firstRun.stdout, new RegExp(`Installed: ${await countInstallableFiles()}`));
    assert.match(firstRun.stdout, /Package scripts installed: 11/);

    const agentFile = await readFile(path.join(targetRoot, "AGENTS.md"), "utf8");
    assert.match(agentFile, /Use `codex-workflow-toolkit`/);
    const protocolFile = await readFile(path.join(targetRoot, "execution-protocol.md"), "utf8");
    assert.match(protocolFile, /Required Order/);
    const packageJson = JSON.parse(await readFile(path.join(targetRoot, "package.json"), "utf8"));
    assert.equal(packageJson.scripts["workflow:audit"], "node scripts/codex-workflow/workflow-audit.mjs");
    assert.equal(packageJson.scripts["workflow:guideline-audit"], "node scripts/codex-workflow/guideline-audit.mjs");

    const ciWorkflow = await readFile(
      path.join(targetRoot, ".github", "workflows", "codex-workflow-audit.yml"),
      "utf8"
    );
    assert.match(ciWorkflow, /workflow-audit/);
    assert.match(ciWorkflow, /node scripts\/codex-workflow\/workflow-audit\.mjs/);

    const scriptStat = await stat(path.join(targetRoot, "scripts", "codex-workflow", "kanban-ticket.mjs"));
    assert.ok((scriptStat.mode & 0o111) !== 0, "expected generated .mjs script to be executable");

    const secondRun = await runNode(["scripts/init-project.mjs", "--target", targetRoot]);
    assert.equal(secondRun.code, 0);
    assert.match(secondRun.stdout, new RegExp(`Identical: ${await countInstallableFiles()}`));
    assert.match(secondRun.stdout, /Package scripts identical: 11/);
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
    assert.match(`${guidelineAuditFail.stdout}\n${guidelineAuditFail.stderr}`, /TODO markers are banned in src during audit\./);

    await writeFile(
      path.join(targetRoot, "src", "app.ts"),
      withHeader("export const value = 2;\n", "Provide a small fixture value for audit coverage.")
    );
    const workflowAuditFinal = await runNode(["scripts/codex-workflow/workflow-audit.mjs"], { cwd: targetRoot });
    assert.equal(workflowAuditFinal.code, 0);
    assert.match(workflowAuditFinal.stdout, /audit extension blocks: 2/);
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
      "## In Progress\n\n- [ ] TKT-101 First active ticket\n  - Outcome: keep moving.\n\n- [ ] TKT-102 Second active ticket\n  - Outcome: this should fail the audit.\n"
    );
    await writeFile(kanbanPath, mutatedKanban, "utf8");

    const auditResult = await runNode(["scripts/codex-workflow/workflow-audit.mjs"], { cwd: targetRoot });
    assert.equal(auditResult.code, 1);
    assert.match(`${auditResult.stdout}\n${auditResult.stderr}`, /expected at most 1 ticket in In Progress, found 2/);
  } finally {
    await cleanup(targetRoot);
  }
});

test("installer does not overwrite conflicting workflow package scripts without force", async () => {
  const targetRoot = await makeTempDir();

  try {
    await writeFile(
      path.join(targetRoot, "package.json"),
      JSON.stringify(
        {
          name: "fixture",
          scripts: {
            "workflow:audit": "echo custom"
          }
        },
        null,
        2
      ) + "\n",
      "utf8"
    );

    const initResult = await runNode(["scripts/init-project.mjs", "--target", targetRoot]);
    assert.equal(initResult.code, 0);
    assert.match(initResult.stdout, /Package scripts skipped: 1/);
    assert.match(initResult.stdout, /workflow:audit/);

    const packageJsonAfterInit = JSON.parse(await readFile(path.join(targetRoot, "package.json"), "utf8"));
    assert.equal(packageJsonAfterInit.scripts["workflow:audit"], "echo custom");

    const forcedResult = await runNode(["scripts/init-project.mjs", "--target", targetRoot, "--force"]);
    assert.equal(forcedResult.code, 0);
    assert.match(forcedResult.stdout, /Package scripts overwritten: 1/);

    const packageJsonAfterForce = JSON.parse(await readFile(path.join(targetRoot, "package.json"), "utf8"));
    assert.equal(packageJsonAfterForce.scripts["workflow:audit"], "node scripts/codex-workflow/workflow-audit.mjs");
  } finally {
    await cleanup(targetRoot);
  }
});

test("strict baseline audit fails on missing headers and forbidden imports", async () => {
  const targetRoot = await makeTempDir();

  try {
    await writeFile(path.join(targetRoot, "package.json"), "{\n  \"name\": \"fixture\"\n}\n");
    const initResult = await runNode(["scripts/init-project.mjs", "--target", targetRoot]);
    assert.equal(initResult.code, 0);

    await mkdir(path.join(targetRoot, "src", "engine"), { recursive: true });
    await mkdir(path.join(targetRoot, "src", "ui"), { recursive: true });
    await writeFile(path.join(targetRoot, "src", "app.ts"), "export const value = 1;\n", "utf8");

    const missingHeaderAudit = await runNode(["scripts/codex-workflow/workflow-audit.mjs"], { cwd: targetRoot });
    assert.equal(missingHeaderAudit.code, 1);
    assert.match(`${missingHeaderAudit.stdout}\n${missingHeaderAudit.stderr}`, /Missing Responsibility\/Scope header near the top of the file/);

    await writeFile(
      path.join(targetRoot, "src", "app.ts"),
      withHeader("export const value = 1;\n", "Provide a test fixture value.")
    );
    await writeFile(
      path.join(targetRoot, "src", "engine", "core.ts"),
      withHeader("import { uiThing } from \"../ui/thing\"\n\nexport const core = uiThing\n", "Exercise engine import boundary auditing.")
    );
    await writeFile(
      path.join(targetRoot, "src", "ui", "thing.ts"),
      withHeader("export const uiThing = 1\n", "Provide a UI-owned fixture for import boundary tests.")
    );

    const forbiddenImportAudit = await runNode(["scripts/codex-workflow/workflow-audit.mjs"], { cwd: targetRoot });
    assert.equal(forbiddenImportAudit.code, 1);
    assert.match(`${forbiddenImportAudit.stdout}\n${forbiddenImportAudit.stderr}`, /Engine-layer code must not import from UI-owned paths/);
  } finally {
    await cleanup(targetRoot);
  }
});

test("workflow audit json reports realistic documentation drift and grouped failure output", async () => {
  const targetRoot = await makeTempDir();

  try {
    await writeFile(path.join(targetRoot, "package.json"), "{\n  \"name\": \"fixture\"\n}\n");
    await runNode(["scripts/init-project.mjs", "--target", targetRoot]);

    const contributingPath = path.join(targetRoot, "CONTRIBUTING.md");
    const contributing = await readFile(contributingPath, "utf8");
    await writeFile(
      contributingPath,
      `${contributing.trimEnd()}\n\nSee [missing note](docs/missing.md).\nRun \`pnpm -s workflow:ghost\` before closing work.\n`,
      "utf8"
    );

    const kanbanPath = path.join(targetRoot, "kanban.md");
    const kanban = await readFile(kanbanPath, "utf8");
    await writeFile(
      kanbanPath,
      kanban.replace(
        "## In Progress\n",
        "## In Progress\n\n- [ ] TKT-200 Drift one\n  - Outcome: first active item.\n\n- [ ] TKT-201 Drift two\n  - Outcome: second active item.\n"
      ),
      "utf8"
    );

    const jsonResult = await runNode(["scripts/codex-workflow/workflow-audit.mjs", "--json"], { cwd: targetRoot });
    assert.equal(jsonResult.code, 1);
    const summary = parseJsonStdout(jsonResult);
    assert.equal(summary.findings.some((finding) => finding.category === "references" && finding.file === "CONTRIBUTING.md"), true);
    assert.equal(summary.findings.some((finding) => finding.category === "scripts" && /workflow:ghost/.test(finding.message)), true);
    assert.equal(summary.findings.some((finding) => finding.category === "kanban" && /In Progress/.test(finding.message)), true);

    const textResult = await runNode(["scripts/codex-workflow/workflow-audit.mjs"], { cwd: targetRoot });
    assert.equal(textResult.code, 1);
    assert.match(textResult.stderr, /References\n- CONTRIBUTING\.md: broken local ref -> docs\/missing\.md/);
    assert.match(textResult.stderr, /Scripts\n- CONTRIBUTING\.md: unknown pnpm script -> workflow:ghost/);
    assert.match(textResult.stderr, /Kanban\n- kanban\.md: expected at most 1 ticket in In Progress, found 2/);
  } finally {
    await cleanup(targetRoot);
  }
});

test("guideline audit json reports structured findings, respects allowlists, and surfaces malformed blocks", async () => {
  const targetRoot = await makeTempDir();

  try {
    await writeFile(path.join(targetRoot, "package.json"), "{\n  \"name\": \"fixture\"\n}\n");
    await runNode(["scripts/init-project.mjs", "--target", targetRoot]);

    await mkdir(path.join(targetRoot, "src", "legacy"), { recursive: true });
    await mkdir(path.join(targetRoot, "src", "feature"), { recursive: true });
    await writeFile(
      path.join(targetRoot, "src", "legacy", "allowed.ts"),
      withHeader("export const allowed = 1; // TODO intentional legacy follow-up\n", "Legacy fixture with narrow allowlist coverage.")
    );
    await writeFile(
      path.join(targetRoot, "src", "feature", "bad.ts"),
      withHeader("export const bad = 1; // TODO still forbidden\n", "Feature fixture that should fail no-source-todo.")
    );

    await appendAuditBlock(path.join(targetRoot, "project-guidelines.md"), {
      allowlists: [
        {
          include: ["src/legacy"],
          extensions: [".ts"],
          ruleIds: ["no-source-todo"]
        }
      ]
    });
    await appendRawAuditBlock(path.join(targetRoot, "knowledge.md"), "{ invalid json");

    const jsonResult = await runNode(["scripts/codex-workflow/guideline-audit.mjs", "--json"], { cwd: targetRoot });
    assert.equal(jsonResult.code, 1);
    const summary = parseJsonStdout(jsonResult);

    assert.equal(summary.ruleCounts.allowlists, 1);

    const todoFinding = summary.findings.find((finding) => finding.file === "src/feature/bad.ts" && finding.ruleId === "no-source-todo");
    assert.ok(todoFinding, "expected non-allowlisted TODO finding");
    assert.equal(todoFinding.ruleKind, "forbiddenPatterns");
    assert.equal(todoFinding.line, 2);
    assert.match(todoFinding.ruleSource, /enforcement\.md:/);

    assert.equal(
      summary.findings.some((finding) => finding.file === "src/legacy/allowed.ts" && finding.ruleId === "no-source-todo"),
      false
    );

    const malformedFinding = summary.findings.find((finding) => finding.ruleKind === "config" && /invalid codex-workflow-audit JSON/.test(finding.message));
    assert.ok(malformedFinding, "expected malformed audit block to be reported");

    const textResult = await runNode(["scripts/codex-workflow/guideline-audit.mjs"], { cwd: targetRoot });
    assert.equal(textResult.code, 1);
    assert.match(textResult.stderr, /\[forbiddenPatterns] src\/feature\/bad\.ts:2: Do not leave TODO\/FIXME markers/);
    assert.match(textResult.stderr, /\[config] knowledge\.md:/);
  } finally {
    await cleanup(targetRoot);
  }
});

test("review summary and verification summary simulate rename, config churn, and partial verification", async () => {
  const targetRoot = await makeTempDir();

  try {
    await writeFile(
      path.join(targetRoot, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0" }, null, 2) + "\n",
      "utf8"
    );
    await runNode(["scripts/init-project.mjs", "--target", targetRoot]);
    await mkdir(path.join(targetRoot, "src"), { recursive: true });
    await writeFile(
      path.join(targetRoot, "src", "old.ts"),
      withHeader("export const oldValue = 1;\n", "Tracked source file for rename coverage.")
    );

    await runGit(targetRoot, ["init", "-q"]);
    await runGit(targetRoot, ["add", "."]);
    await runGit(targetRoot, ["-c", "user.name=Codex", "-c", "user.email=codex@example.com", "commit", "-qm", "init"]);

    await runGit(targetRoot, ["mv", "src/old.ts", "src/new.ts"]);
    await writeFile(
      path.join(targetRoot, "src", "new.ts"),
      withHeader("export const newValue = 2;\n", "Renamed source file for review-summary coverage.")
    );
    await writeFile(
      path.join(targetRoot, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.1", scripts: { lint: "node -e \"process.exit(0)\"" } }, null, 2) + "\n",
      "utf8"
    );

    const reviewResult = await runNode(["scripts/codex-workflow/review-summary.mjs", "--json"], { cwd: targetRoot });
    assert.equal(reviewResult.code, 0);
    const reviewSummary = parseJsonStdout(reviewResult);
    assert.equal(reviewSummary.counts.source, 1);
    assert.equal(reviewSummary.counts.config, 1);
    assert.equal(reviewSummary.changes.some((change) => change.status === "renamed" && change.path === "src/new.ts"), true);
    assert.equal(reviewSummary.focus.includes("renamed: src/new.ts"), true);
    assert.equal(reviewSummary.focus.includes("config changed: package.json"), true);
    assert.equal(reviewSummary.focus.includes("source changed without matching test-file changes"), true);

    const verifyPartial = await runNode(
      [
        "scripts/codex-workflow/verification-summary.mjs",
        "--json",
        "--cmd",
        "node -e \"console.log('pass')\"",
        "--skip",
        "manual browser pass still pending"
      ],
      { cwd: targetRoot }
    );
    assert.equal(verifyPartial.code, 0);
    const partialSummary = parseJsonStdout(verifyPartial);
    assert.equal(partialSummary.conclusion, "partially verified");
    assert.equal(partialSummary.results[0].exitCode, 0);

    const verifyFail = await runNode(
      ["scripts/codex-workflow/verification-summary.mjs", "--json", "--cmd", "node -e \"process.exit(2)\""],
      { cwd: targetRoot }
    );
    assert.equal(verifyFail.code, 1);
    const failSummary = parseJsonStdout(verifyFail);
    assert.equal(failSummary.conclusion, "not verified");
    assert.equal(failSummary.results[0].exitCode, 2);
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

function parseJsonStdout(result) {
  return JSON.parse(result.stdout || "{}");
}

function withHeader(body, responsibility) {
  return `/** Responsibility: ${responsibility} Scope: Test-only ownership boundary. */\n${body}`;
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

async function appendRawAuditBlock(filePath, rawContent) {
  const current = await readFile(filePath, "utf8");
  const block = [
    "",
    "## Broken Audit Extensions",
    "",
    "```codex-workflow-audit",
    rawContent,
    "```",
    ""
  ].join("\n");
  await writeFile(filePath, `${current.trimEnd()}\n${block}`, "utf8");
}
