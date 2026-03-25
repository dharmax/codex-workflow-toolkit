import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { installAgents } from "../cli/lib/install.mjs";
import { routeTask } from "../core/services/router.mjs";
import { parseTelegramCommand } from "../core/services/telegram.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("routeTask falls back cleanly when only unavailable local providers exist", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "workflow-router-unavail-"));

  try {
    await mkdir(path.join(targetRoot, ".ai-workflow"), { recursive: true });
    await writeFile(
      path.join(targetRoot, ".ai-workflow", "config.json"),
      JSON.stringify({
        providers: {
          ollama: { enabled: false },
          google: { enabled: false },
          openai: { enabled: false },
          anthropic: { enabled: false }
        }
      }),
      "utf8"
    );

    const route = await routeTask({
      root: targetRoot,
      taskClass: "summarization"
    });

    assert.equal(route.recommended, null);
    assert.equal(route.providers.ollama.available, false);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("installAgents creates the DB-first project workspace directories and config defaults", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "workflow-install-"));

  try {
    const results = await installAgents({
      toolkitRoot: repoRoot,
      projectRoot: targetRoot,
      target: "codex"
    });

    assert.equal(results.length, 1);
    const config = JSON.parse(await readFile(path.join(targetRoot, ".ai-workflow", "config.json"), "utf8"));
    assert.equal(config.storage.dbPath, ".ai-workflow/state/workflow.db");
    assert.equal(config.lifecycle.candidateReviewIntervalHours, 36);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("routeTask picks up a configured remote Ollama host", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "workflow-ollama-host-"));

  try {
    await mkdir(path.join(targetRoot, ".ai-workflow"), { recursive: true });
    await writeFile(
      path.join(targetRoot, ".ai-workflow", "config.json"),
      JSON.stringify({
        providers: {
          ollama: {
            host: "http://192.168.1.50:11434"
          }
        }
      }, null, 2) + "\n",
      "utf8"
    );

    const route = await routeTask({
      root: targetRoot,
      taskClass: "summarization"
    });

    assert.equal(route.providers.ollama.host, "http://192.168.1.50:11434");
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("CLI sync, summary, ticket creation, note creation, route, and telegram preview work together", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "workflow-cli-"));
  const fixtureRoot = path.join(repoRoot, "tests", "fixtures", "workflow-repo");

  try {
    await cp(fixtureRoot, targetRoot, { recursive: true });

    const sync = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "sync", "--write-projections", "--json"], { cwd: targetRoot });
    assert.equal(sync.code, 0, sync.stderr || sync.stdout);
    const syncPayload = JSON.parse(sync.stdout);
    assert.equal(syncPayload.indexedFiles >= 8, true);

    const summary = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "project", "summary", "--json"], { cwd: targetRoot });
    assert.equal(summary.code, 0, summary.stderr || summary.stdout);
    const summaryPayload = JSON.parse(summary.stdout);
    assert.equal(summaryPayload.fileCount >= 8, true);

    const ticket = await runNode([
      path.join(repoRoot, "cli", "ai-workflow.mjs"),
      "project",
      "ticket",
      "create",
      "--id",
      "TKT-333",
      "--title",
      "CLI-created ticket",
      "--lane",
      "In Progress",
      "--json"
    ], { cwd: targetRoot });
    assert.equal(ticket.code, 0, ticket.stderr || ticket.stdout);

    const note = await runNode([
      path.join(repoRoot, "cli", "ai-workflow.mjs"),
      "project",
      "note",
      "add",
      "--type",
      "BUG",
      "--body",
      "shared provider route can break review promotion",
      "--file",
      "src/core/router.js",
      "--json"
    ], { cwd: targetRoot });
    assert.equal(note.code, 0, note.stderr || note.stdout);

    const search = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "project", "search", "provider route", "--json"], { cwd: targetRoot });
    assert.equal(search.code, 0, search.stderr || search.stdout);
    const searchPayload = JSON.parse(search.stdout);
    assert.equal(searchPayload.length >= 1, true);

    const route = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "route", "review", "--json"], { cwd: targetRoot });
    assert.equal(route.code, 0, route.stderr || route.stdout);

    const telegram = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "telegram", "preview", "--json"], { cwd: targetRoot });
    assert.equal(telegram.code, 0, telegram.stderr || telegram.stdout);
    const telegramPayload = JSON.parse(telegram.stdout);
    assert.match(telegramPayload.text, /AI Workflow Status/);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("telegram command parser remains thin and deterministic", () => {
  assert.deepEqual(parseTelegramCommand("/status now"), { command: "status", args: ["now"] });
  assert.deepEqual(parseTelegramCommand("status now"), { command: "unknown", args: [] });
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
      stderr: error.stderr ?? error.message
    };
  }
}
