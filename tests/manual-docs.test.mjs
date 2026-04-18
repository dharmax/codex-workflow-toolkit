import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildShellContext, buildShellPlannerPrompt } from "../cli/lib/shell.mjs";
import { renderManualHtml } from "../scripts/generate-manual-html.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function runNode(args, options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, args, {
      ...options,
      maxBuffer: 8 * 1024 * 1024
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

test("renderManualHtml emits semantic HTML with toc and source hash", () => {
  const markdown = [
    "# ai-workflow Manual",
    "",
    "## Shell Mode",
    "",
    "- Use `ai-workflow shell` for planning.",
    "",
    "## Configuration Reference",
    "",
    "```bash",
    "ai-workflow config set providers.ollama.host http://127.0.0.1:11434",
    "```"
  ].join("\n");

  const html = renderManualHtml(markdown, { sourcePath: "docs/MANUAL.md" });
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<nav aria-labelledby="manual-toc-heading">/);
  assert.match(html, /<section aria-labelledby="shell-mode"/);
  assert.match(html, /manual-source-sha1/);
  assert.match(html, /<pre data-block-kind="code"><code class="language-bash">/);
});

test("buildShellContext loads the canonical manual and planner prompt surfaces manual guidance", async () => {
  const root = path.resolve("/tmp/ai-workflow-manual-shell-" + Math.random().toString(36).slice(2));
  await mkdir(path.join(root, "docs"), { recursive: true });
  await writeFile(path.join(root, "docs", "MANUAL.md"), [
    "# ai-workflow Manual",
    "",
    "## Configuration Reference",
    "",
    "- `providers.ollama.host` sets the primary Ollama URL.",
    "- `providers.ollama.plannerModel` is a manual override."
  ].join("\n"), "utf8");

  try {
    await writeFile(path.join(root, "project-guidelines.md"), [
      "# Project Guidelines",
      "",
      "- Operator-surface changes are not done until `ai-workflow dogfood` and `workflow-audit` both pass."
    ].join("\n"), "utf8");
    const context = await buildShellContext(root);
    assert.match(context.manual, /providers\.ollama\.host/);
    assert.equal(Array.isArray(context.activeGuardrails), true);
    assert.equal(context.activeGuardrails.some((item) => /workflow-audit/.test(item.summary)), true);

    const prompt = await buildShellPlannerPrompt("how do i configure ollama host?", {
      root,
      plannerContext: {
        ...context,
        toolkitCodelets: [],
        projectCodelets: [],
        summary: { activeTickets: [] },
        providerState: { providers: {} }
      },
      history: []
    });

    assert.match(prompt.prompt, /## Guidance Highlights/);
    assert.match(prompt.prompt, /Active guardrail \[required\|Project Guidelines\]/);
    assert.match(prompt.prompt, /Manual: `providers\.ollama\.host` sets the primary Ollama URL\./);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("guidance-summary includes manual guidance from the toolkit fallback", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "ai-workflow-manual-guidance-"));

  try {
    const result = await runNode([
      path.join(repoRoot, "runtime", "scripts", "ai-workflow", "guidance-summary.mjs"),
      "--files",
      "cli/lib/shell.mjs",
      "--json"
    ], { cwd: targetRoot });
    assert.equal(result.code, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(Array.isArray(payload.sections.manual), true);
    assert.equal(payload.sections.manual.length > 0, true);
    assert.equal(Array.isArray(payload.activeGuardrails), true);
    assert.equal(payload.activeGuardrails.length > 0, true);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("workflow-audit fails when docs/manual.html is stale for an existing manual", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "ai-workflow-manual-audit-"));

  try {
    const initResult = await runNode([
      path.join(repoRoot, "scripts", "init-project.mjs"),
      "--target",
      targetRoot
    ], { cwd: repoRoot });
    assert.equal(initResult.code, 0, initResult.stderr || initResult.stdout);

    await mkdir(path.join(targetRoot, "docs"), { recursive: true });
    await writeFile(path.join(targetRoot, "docs", "MANUAL.md"), "# ai-workflow Manual\n\n## What It Is\n\nmanual body\n", "utf8");
    await writeFile(path.join(targetRoot, "docs", "manual.html"), "<!doctype html><html><body>stale</body></html>\n", "utf8");

    const auditResult = await runNode([
      path.join(repoRoot, "runtime", "scripts", "ai-workflow", "workflow-audit.mjs"),
      "--json"
    ], { cwd: targetRoot });
    assert.equal(auditResult.code, 1);
    const payload = JSON.parse(auditResult.stdout);
    assert.equal(
      payload.findings.some((finding) => String(finding.message).includes("generated semantic HTML manual is stale")),
      true
    );
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});
