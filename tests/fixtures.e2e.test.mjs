import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturesRoot = path.join(repoRoot, "tests", "fixtures");

const FIXTURE_MATRIX = [
  {
    name: "strict-default",
    fixturePath: "strict-default",
    scenario: "pass"
  },
  {
    name: "audit-extension",
    fixturePath: "audit-extension",
    scenario: "audit-extension"
  },
  {
    name: "legacy-kanban",
    fixturePath: "legacy-kanban",
    scenario: "legacy-kanban"
  }
];

for (const fixture of FIXTURE_MATRIX) {
  test(`fixture repo matrix: ${fixture.name}`, async () => {
    const targetRoot = await makeTempDir();

    try {
      await copyFixture(path.join(fixturesRoot, fixture.fixturePath), targetRoot);
      const initArgs = fixture.scenario === "legacy-kanban"
        ? ["scripts/init-project.mjs", "--target", targetRoot, "--no-sync"]
        : ["scripts/init-project.mjs", "--target", targetRoot];
      const initResult = await runNode(initArgs);
      assert.equal(initResult.code, 0, initResult.stderr || initResult.stdout);

      await assertWorkflowInstallFromRepo(targetRoot);

      if (fixture.scenario === "pass") {
        const auditResult = await runNode(["scripts/ai-workflow/workflow-audit.mjs"], { cwd: targetRoot });
        assert.equal(auditResult.code, 0, auditResult.stderr || auditResult.stdout);
        return;
      }

      if (fixture.scenario === "legacy-kanban") {
        const preMigrationAudit = await runNode(["scripts/ai-workflow/workflow-audit.mjs"], { cwd: targetRoot });
        assert.equal(preMigrationAudit.code, 1, preMigrationAudit.stderr || preMigrationAudit.stdout);

        const migrateResult = await runNode(["scripts/ai-workflow/kanban.mjs", "migrate"], { cwd: targetRoot });
        assert.equal(migrateResult.code, 0, migrateResult.stderr || migrateResult.stdout);

        const moveResult = await runNode(
          ["scripts/ai-workflow/kanban.mjs", "move", "--id", "TKT-010", "--to", "In Progress"],
          { cwd: targetRoot }
        );
        assert.equal(moveResult.code, 0, moveResult.stderr || moveResult.stdout);

        const nextResult = await runNode(["scripts/ai-workflow/kanban.mjs", "next"], { cwd: targetRoot });
        assert.equal(nextResult.code, 0, nextResult.stderr || nextResult.stdout);
        assert.match(nextResult.stdout, /TKT-010 \| In Progress \| TKT-010 Legacy ticket/);

        const newTicketResult = await runNode(
          [
            "scripts/ai-workflow/kanban.mjs",
            "new",
            "--id",
            "TKT-099",
            "--title",
            "New suggestion",
            "--to",
            "Suggestions",
            "--notes",
            "Optional"
          ],
          { cwd: targetRoot }
        );
        assert.equal(newTicketResult.code, 0, newTicketResult.stderr || newTicketResult.stdout);

        const doneMove = await runNode(
          ["scripts/ai-workflow/kanban.mjs", "move", "--id", "TKT-010", "--to", "Done", "--done-date", "2026-03-01"],
          { cwd: targetRoot }
        );
        assert.equal(doneMove.code, 0, doneMove.stderr || doneMove.stdout);

        const archiveResult = await runNode(["scripts/ai-workflow/kanban.mjs", "archive"], { cwd: targetRoot });
        assert.equal(archiveResult.code, 0, archiveResult.stderr || archiveResult.stdout);

        const archiveText = await readFile(path.join(targetRoot, "kanban-archive.md"), "utf8");
        assert.match(archiveText, /TKT-010 Legacy ticket/);

        const dogfoodResult = await runNode(
          ["scripts/ai-workflow/dogfood.mjs", "--surface", "workflow,init", "--profile", "bootstrap"],
          { cwd: targetRoot }
        );
        assert.equal(dogfoodResult.code, 0, dogfoodResult.stderr || dogfoodResult.stdout);

        const passingAudit = await runNode(["scripts/ai-workflow/workflow-audit.mjs"], { cwd: targetRoot });
        assert.equal(passingAudit.code, 0, passingAudit.stderr || passingAudit.stdout);
        return;
      }

      const failingAudit = await runNode(["scripts/ai-workflow/workflow-audit.mjs", "--json"], { cwd: targetRoot });
      assert.equal(failingAudit.code, 1, failingAudit.stderr || failingAudit.stdout);
      const summary = parseJsonStdout(failingAudit);
      assert.equal(
        summary.findings.some(
          (finding) => finding.file === "src/feature/bad.ts" && finding.ruleId === "no-source-todo"
        ),
        true
      );
      assert.equal(
        summary.findings.some(
          (finding) => finding.file === "src/legacy/allowed.ts" && finding.ruleId === "no-source-todo"
        ),
        false
      );

      await writeFile(
        path.join(targetRoot, "src", "feature", "bad.ts"),
        "/** Responsibility: Feature fixture Scope: Cleaned audit marker for pass. */\nexport const bad = 2;\n",
        "utf8"
      );
      const passingAudit = await runNode(["scripts/ai-workflow/workflow-audit.mjs"], { cwd: targetRoot });
      assert.equal(passingAudit.code, 0, passingAudit.stderr || passingAudit.stdout);
    } finally {
      await cleanup(targetRoot);
    }
  });
}

async function assertWorkflowInstallFromRepo(cwd) {
  const script = [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));",
    "const expected = {",
    "  'workflow:kanban': 'node scripts/ai-workflow/kanban.mjs',",
    "  'workflow:ticket': 'node scripts/ai-workflow/kanban-ticket.mjs',",
    "  'workflow:guidance': 'node scripts/ai-workflow/guidance-summary.mjs',",
    "  'workflow:review': 'node scripts/ai-workflow/review-summary.mjs',",
    "  'workflow:verify': 'node scripts/ai-workflow/verification-summary.mjs',",
    "  'workflow:dogfood': 'node scripts/ai-workflow/dogfood.mjs',",
    "  'workflow:guideline-audit': 'node scripts/ai-workflow/guideline-audit.mjs',",
    "  'workflow:audit': 'node scripts/ai-workflow/workflow-audit.mjs'",
    "};",
    "if (!pkg.scripts) throw new Error('package.json scripts missing');",
    "for (const [key, value] of Object.entries(expected)) {",
    "  if (pkg.scripts[key] !== value) {",
    "    throw new Error(`workflow script mismatch: ${key}`);",
    "  }",
    "}",
    "const workflowPath = path.join('.github', 'workflows', 'ai-workflow-audit.yml');",
    "const workflow = fs.readFileSync(workflowPath, 'utf8');",
    "if (!workflow.includes('workflow-audit')) throw new Error('workflow audit job missing');",
    "if (!workflow.includes('node scripts/ai-workflow/workflow-audit.mjs')) {",
    "  throw new Error('workflow audit command missing');",
    "}",
    "console.log('ok');"
  ].join("");

  const result = await runNodeInline(script, { cwd });
  assert.equal(result.code, 0, result.stderr || result.stdout);
}

async function copyFixture(sourceRoot, targetRoot) {
  await cp(sourceRoot, targetRoot, { recursive: true });
}

async function runNode(args, options = {}) {
  return runCommand(process.execPath, args, { cwd: repoRoot, ...options });
}

async function runNodeInline(script, options = {}) {
  return runCommand(process.execPath, ["-e", script], { cwd: options.cwd });
}

async function runCommand(command, args, options = {}) {
  const captureDir = await makeTempDir();
  const stdoutPath = path.join(captureDir, "stdout.log");
  const stderrPath = path.join(captureDir, "stderr.log");
  try {
    await execFileAsync("/usr/bin/bash", ["-lc", `${shellQuote(command)} ${args.map(shellQuote).join(" ")} > ${shellQuote(stdoutPath)} 2> ${shellQuote(stderrPath)}`], {
      cwd: options.cwd,
      env: {
        ...process.env,
        AI_WORKFLOW_TOOLKIT_ROOT: repoRoot
      }
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
    await cleanup(captureDir);
  }
}

function shellQuote(value) {
  return JSON.stringify(String(value));
}

function parseJsonStdout(result) {
  return JSON.parse(result.stdout || "{}");
}

async function makeTempDir() {
  return await mkdtemp(path.join(os.tmpdir(), "ai-workflow-fixture-"));
}

async function cleanup(targetRoot) {
  await rm(targetRoot, { recursive: true, force: true });
}
