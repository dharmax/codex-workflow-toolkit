import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { withWorkflowStore } from "../core/services/sync.mjs";
import { registerProvider } from "../core/services/providers.mjs";
import { runSmartCodelet } from "../runtime/scripts/ai-workflow/smart-codelet-runner.mjs";

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

test("ai-workflow list reports built-in codelets", { concurrency: false }, async () => {
  const result = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "list", "--json"]);
  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(Array.isArray(payload.toolkitCodelets), true);
  assert.equal(payload.toolkitCodelets.some((item) => item.id === "sync"), true);
  assert.equal(payload.toolkitCodelets.some((item) => item.id === "css-refactor"), true);
  assert.equal(payload.toolkitCodelets.some((item) => item.id === "codelet-observer"), true);
});

test("ai-workflow project codelet queries read from the DB registry", { concurrency: false }, async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "ai-workflow-codelet-registry-"));

  try {
    await runNode([path.join(repoRoot, "scripts", "init-project.mjs"), "--target", targetRoot]);

    const listResult = await runNode(
      [path.join(repoRoot, "cli", "ai-workflow.mjs"), "project", "codelet", "list", "--json"],
      { cwd: targetRoot }
    );
    assert.equal(listResult.code, 0);
    const listPayload = JSON.parse(listResult.stdout);
    assert.equal(Array.isArray(listPayload), true);
    assert.equal(listPayload.some((item) => item.id === "sync"), true);

    const showResult = await runNode(
      [path.join(repoRoot, "cli", "ai-workflow.mjs"), "project", "codelet", "show", "doctor", "--json"],
      { cwd: targetRoot }
    );
    assert.equal(showResult.code, 0);
    const showPayload = JSON.parse(showResult.stdout);
    assert.equal(showPayload.id, "doctor");
    assert.equal(showPayload.backing.status, "builtin");
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("ai-workflow doctor reports local diagnostics and ollama absence cleanly", { concurrency: false }, async () => {
  const result = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "doctor", "--json"]);
  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(typeof payload.cwd, "string");
  assert.equal(typeof payload.ollama, "object");
  assert.equal(typeof payload.leanCtx, "object");
  assert.equal(payload.leanCtx.installed, true);
});

test("ai-workflow can extract a ticket and build a context pack for an initialized repo", { concurrency: false }, async () => {
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

test("ai-workflow ticket helpers prefer the discovered real kanban source over stale root kanban", { concurrency: false }, async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "ai-workflow-real-kanban-"));

  try {
    await runNode([path.join(repoRoot, "scripts", "init-project.mjs"), "--target", targetRoot]);
    await mkdir(path.join(targetRoot, "docs"), { recursive: true });
    await writeFile(
      path.join(targetRoot, "docs", "kanban.md"),
      [
        "# Kanban",
        "",
        "## In Progress",
        "- [ ] **REF-APP-SHELL-01**: Continue app-shell and modal-surface refactor hardening after review findings.",
        "  - Outcome: restore overlay handling and deep-link routing",
        "",
        "## Priority 1 Bugs",
        "- [ ] **BUG-OVERLAY-01**: Restore global overlay handling for non-dialog modals after the app-shell refactor."
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(targetRoot, "kanban.md"),
      [
        "# Kanban",
        "",
        "## Todo",
        "- [ ] TKT-001 Replace this example ticket"
      ].join("\n"),
      "utf8"
    );

    const syncResult = await runNode(
      [path.join(repoRoot, "cli", "ai-workflow.mjs"), "sync", "--json"],
      { cwd: targetRoot }
    );
    assert.equal(syncResult.code, 0);

    const ticketResult = await runNode(
      [path.join(repoRoot, "cli", "ai-workflow.mjs"), "extract", "ticket", "REF-APP-SHELL-01", "--json"],
      { cwd: targetRoot }
    );
    assert.equal(ticketResult.code, 0);
    const ticketPayload = JSON.parse(ticketResult.stdout);
    assert.equal(ticketPayload.id, "REF-APP-SHELL-01");
    assert.equal(ticketPayload.section, "In Progress");
    assert.match(ticketPayload.body, /Outcome: restore overlay handling/i);

    const contextResult = await runNode(
      [path.join(repoRoot, "cli", "ai-workflow.mjs"), "run", "context-pack", "--ticket", "REF-APP-SHELL-01", "--json"],
      { cwd: targetRoot }
    );
    assert.equal(contextResult.code, 0);
    const contextPayload = JSON.parse(contextResult.stdout);
    assert.equal(contextPayload.ticket.id, "REF-APP-SHELL-01");
    assert.equal(contextPayload.ticket.section, "In Progress");
    assert.equal(contextPayload.ticketSourcePath, "docs/kanban.md");
    assert.equal(Array.isArray(contextPayload.workingSet), true);
    assert.equal(contextPayload.workingSet.length > 0, true);
    assert.equal(Array.isArray(contextPayload.relevantSymbols), true);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("ai-workflow config set rejects shell-channel execution", { concurrency: false }, async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "ai-workflow-shell-channel-"));

  try {
    await runNode([path.join(repoRoot, "scripts", "init-project.mjs"), "--target", targetRoot]);

    const result = await runNode(
      [path.join(repoRoot, "cli", "ai-workflow.mjs"), "config", "set", "workflow.mode", "tool-dev"],
      {
        cwd: targetRoot,
        env: {
          ...process.env,
          AIWF_COMMAND_CHANNEL: "shell"
        }
      }
    );

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /regular ai-workflow CLI/i);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("ai-workflow kanban new rejects shell-channel execution", { concurrency: false }, async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "ai-workflow-kanban-shell-channel-"));

  try {
    const result = await runNode(
      [
        path.join(repoRoot, "runtime", "scripts", "ai-workflow", "kanban.mjs"),
        "new",
        "--root",
        targetRoot,
        "--id",
        "TKT-001",
        "--title",
        "Channel guard regression",
        "--to",
        "Todo"
      ],
      {
        env: {
          ...process.env,
          AIWF_COMMAND_CHANNEL: "shell"
        }
      }
    );

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /regular ai-workflow CLI/i);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("ai-workflow project epic and story commands query the DB with heading-based epics", { concurrency: false }, async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "ai-workflow-epic-query-"));

  try {
    await writeFile(path.join(targetRoot, "epics.md"), [
      "# Epics",
      "",
      "## EPC-200 Direct edit reconciliation",
      "",
      "### Goal",
      "",
      "Keep file projections honest without flattening the narrative.",
      "",
      "### User stories",
      "",
      "#### Story 1",
      "",
      "As a user, I can edit epics.md or kanban.md directly and have ai-workflow detect drift before it overwrites my change.",
      "",
      "#### Story 2",
      "",
      "As a maintainer, I can reconcile missing or deleted DB entities from a file edit without losing the author’s intent.",
      "",
      "### Ticket batches",
      "",
      "- Detect file/DB drift and preview the delta.",
      "- Create, update, or delete DB entities from explicit user edits.",
      "",
      "### Kanban tickets",
      "",
      "- none linked yet"
    ].join("\n"), "utf8");
    await writeFile(path.join(targetRoot, "kanban.md"), [
      "# Kanban",
      "",
      "## Todo",
      "",
      "- [ ] TKT-200 Wire direct-edit reconciliation",
      "  - Epic: EPC-200",
      "  - Story: As a user, I can edit epics.md or kanban.md directly and have ai-workflow detect drift before it overwrites my change."
    ].join("\n"), "utf8");

    const syncResult = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "sync", "--write-projections", "--json"], { cwd: targetRoot });
    assert.equal(syncResult.code, 0, syncResult.stderr || syncResult.stdout);

    const epicList = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "project", "epic", "list", "--json"], { cwd: targetRoot });
    assert.equal(epicList.code, 0, epicList.stderr || epicList.stdout);
    const epics = JSON.parse(epicList.stdout);
    assert.equal(epics.some((item) => item.id === "EPC-200"), true);

    const epicShow = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "project", "epic", "show", "EPC-200", "--json"], { cwd: targetRoot });
    assert.equal(epicShow.code, 0, epicShow.stderr || epicShow.stdout);
    const epic = JSON.parse(epicShow.stdout);
    assert.equal(epic.userStories.length, 2);
    assert.match(epic.userStories[0], /edit epics\.md or kanban\.md directly/i);

    const storySearch = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "project", "story", "search", "drift", "--epic", "EPC-200", "--json"], { cwd: targetRoot });
    assert.equal(storySearch.code, 0, storySearch.stderr || storySearch.stdout);
    const stories = JSON.parse(storySearch.stdout);
    assert.equal(stories[0]?.epic.id, "EPC-200");
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("ai-workflow sync auto-archives epics whose linked tickets are already done", { concurrency: false }, async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "ai-workflow-epic-archive-"));

  try {
    await writeFile(path.join(targetRoot, "epics.md"), [
      "# Epics",
      "",
      "## EPC-201 Complete the graph backlog",
      "",
      "### Goal",
      "",
      "Close out a finished epic once its linked work is done.",
      "",
      "### User stories",
      "",
      "#### Story 1",
      "",
      "**As a maintainer**, I can see a completed epic auto-archive when its only linked ticket is already done.",
      "",
      "### Ticket batches",
      "",
      "- Archive completed epic state after linked ticket completion.",
      "",
      "### Kanban tickets",
      "",
      "- none linked yet"
    ].join("\n"), "utf8");
    await writeFile(path.join(targetRoot, "kanban.md"), [
      "# Kanban",
      "",
      "## Done",
      "",
      "- [ ] EXE-201 Close the graph backlog",
      "  - Epic: EPC-201",
      "  - Summary: Complete the semantic graph backlog and mark the epic archived."
    ].join("\n"), "utf8");

    const syncResult = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "sync", "--write-projections", "--json"], { cwd: targetRoot });
    assert.equal(syncResult.code, 0, syncResult.stderr || syncResult.stdout);

    const epicShow = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "project", "epic", "show", "EPC-201", "--json"], { cwd: targetRoot });
    assert.equal(epicShow.code, 0, epicShow.stderr || epicShow.stdout);
    const epic = JSON.parse(epicShow.stdout);
    assert.equal(epic.state, "archived");

    const epicsMarkdown = await readFile(path.join(targetRoot, "epics.md"), "utf8");
    assert.match(epicsMarkdown, /<!-- status: archived -->/);
    assert.match(epicsMarkdown, /\[x\] Archived/);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("ai-workflow sync keeps unchanged generated projections stable on repeated runs", { concurrency: false }, async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "ai-workflow-projection-stable-"));

  try {
    await writeFile(path.join(targetRoot, "epics.md"), [
      "# Epics",
      "",
      "## EPC-201 Complete the graph backlog",
      "",
      "### Goal",
      "",
      "Close out a finished epic once its linked work is done.",
      "",
      "### Status",
      "",
      "- [x] Archived",
      "<!-- status: archived -->",
      "",
      "### User stories",
      "",
      "#### Story 1",
      "",
      "**As a maintainer**, I can see a completed epic auto-archive when its only linked ticket is already done.",
      "",
      "### Ticket batches",
      "",
      "- Archive completed epic state after linked ticket completion.",
      "",
      "### Kanban tickets",
      "",
      "- EXE-201 Close the graph backlog [Done]"
    ].join("\n"), "utf8");
    await writeFile(path.join(targetRoot, "kanban.md"), [
      "# Kanban",
      "",
      "## Done",
      "",
      "- [ ] EXE-201 Close the graph backlog ✅ 2026-04-04",
      "  - Epic: EPC-201",
      "  - Summary: Complete the semantic graph backlog and mark the epic archived."
    ].join("\n"), "utf8");

    const firstSync = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "sync", "--write-projections", "--json"], { cwd: targetRoot });
    assert.equal(firstSync.code, 0, firstSync.stderr || firstSync.stdout);

    const secondSync = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "sync", "--write-projections", "--json"], { cwd: targetRoot });
    assert.equal(secondSync.code, 0, secondSync.stderr || secondSync.stdout);

    const epicShow = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "project", "epic", "show", "EPC-201", "--json"], { cwd: targetRoot });
    assert.equal(epicShow.code, 0, epicShow.stderr || epicShow.stdout);
    const epic = JSON.parse(epicShow.stdout);
    assert.equal(epic.state, "archived");

    const kanbanText = await readFile(path.join(targetRoot, "kanban.md"), "utf8");
    assert.match(kanbanText, /EXE-201 Close the graph backlog/);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("ai-workflow sync keeps unchanged generated epics stable on repeated runs", { concurrency: false }, async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "ai-workflow-epic-stable-"));

  try {
    await writeFile(path.join(targetRoot, "epics.md"), [
      "# Epics",
      "",
      "## EPC-201 Complete the graph backlog",
      "",
      "### Goal",
      "",
      "Close out a finished epic once its linked work is done.",
      "",
      "### Status",
      "",
      "- [x] Archived",
      "<!-- status: archived -->",
      "",
      "### User stories",
      "",
      "#### Story 1",
      "",
      "**As a maintainer**, I can see a completed epic auto-archive when its only linked ticket is already done.",
      "",
      "### Ticket batches",
      "",
      "- Archive completed epic state after linked ticket completion.",
      "",
      "### Kanban tickets",
      "",
      "- EXE-201 Close the graph backlog [Done]"
    ].join("\n"), "utf8");
    await writeFile(path.join(targetRoot, "kanban.md"), [
      "# Kanban",
      "",
      "## Done",
      "",
      "- [ ] EXE-201 Close the graph backlog ✅ 2026-04-04",
      "  - Epic: EPC-201",
      "  - Summary: Complete the semantic graph backlog and mark the epic archived."
    ].join("\n"), "utf8");

    const firstSync = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "sync", "--write-projections", "--json"], { cwd: targetRoot });
    assert.equal(firstSync.code, 0, firstSync.stderr || firstSync.stdout);

    const secondSync = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "sync", "--write-projections", "--json"], { cwd: targetRoot });
    assert.equal(secondSync.code, 0, secondSync.stderr || secondSync.stdout);

    const epicShow = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "project", "epic", "show", "EPC-201", "--json"], { cwd: targetRoot });
    assert.equal(epicShow.code, 0, epicShow.stderr || epicShow.stdout);
    const epic = JSON.parse(epicShow.stdout);
    assert.equal(epic.state, "archived");
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("ai-workflow project ticket create preserves an existing epic narrative", { concurrency: false }, async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "ai-workflow-ticket-epic-preserve-"));

  try {
    await writeFile(path.join(targetRoot, "epics.md"), [
      "# Epics",
      "",
      "## EPC-202 Preserve the epic narrative",
      "",
      "### Goal",
      "",
      "Keep the original epic title and summary when later tickets are added.",
      "",
      "### User stories",
      "",
      "#### Story 1",
      "",
      "**As a maintainer**, I can add a ticket to an existing epic without ai-workflow overwriting the epic title or summary.",
      "",
      "### Ticket batches",
      "",
      "- Preserve the existing epic record when creating a ticket.",
      "",
      "### Kanban tickets",
      "",
      "- none linked yet"
    ].join("\n"), "utf8");
    await writeFile(path.join(targetRoot, "kanban.md"), [
      "# Kanban",
      "",
      "## ToDo",
      "",
      "- No items"
    ].join("\n"), "utf8");

    const syncResult = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "sync", "--write-projections", "--json"], { cwd: targetRoot });
    assert.equal(syncResult.code, 0, syncResult.stderr || syncResult.stdout);

    const createResult = await runNode([
      path.join(repoRoot, "cli", "ai-workflow.mjs"),
      "project",
      "ticket",
      "create",
      "--id",
      "EXE-202",
      "--title",
      "Preserve the epic narrative",
      "--lane",
      "Done",
      "--epic",
      "EPC-202",
      "--summary",
      "Add a ticket without mutating the existing epic."
    ], { cwd: targetRoot });
    assert.equal(createResult.code, 0, createResult.stderr || createResult.stdout);

    const epicShow = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "project", "epic", "show", "EPC-202", "--json"], { cwd: targetRoot });
    assert.equal(epicShow.code, 0, epicShow.stderr || epicShow.stdout);
    const epic = JSON.parse(epicShow.stdout);
    assert.equal(epic.title, "Preserve the epic narrative");
    assert.match(epic.summary, /keep the original epic title and summary/i);
    assert.equal(epic.userStories.length, 1);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("smart codelet observer routes through the provider and documents candidate patterns", { concurrency: false }, async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "ai-workflow-smart-codelet-"));

  try {
    await runNode([path.join(repoRoot, "scripts", "init-project.mjs"), "--target", targetRoot]);
    await writeFile(path.join(targetRoot, ".ai-workflow", "config.json"), JSON.stringify({
      providers: {
        "mock-smart": {
          apiKey: "test-key",
          models: ["smart-v1"]
        }
      }
    }, null, 2), "utf8");

    registerProvider("mock-smart", {
      generate: async ({ modelId, prompt }) => {
        assert.equal(modelId, "smart-v1");
        assert.match(prompt, /Codelet id: codelet-observer/);
        return {
          providerId: "mock-smart",
          modelId,
          response: JSON.stringify({
            summary: "Recurring refactor and docs work should become explicit codelets.",
            observations: ["The project keeps surfacing the same refactor families."],
            candidate_codelets: [
              { id: "css-refactor", reason: "Frequent CSS cleanup patterns" },
              { id: "docs-refresh", reason: "Workflow docs keep needing refreshes" }
            ],
            suggested_actions: ["Promote css-refactor and docs-refresh as standard built-ins."],
            docs_to_update: ["epics.md", "knowledge.md"],
            needs_human_review: true
          })
        };
      }
    });

    const payload = await runSmartCodelet(
      ["--root", targetRoot, "--provider", "mock-smart", "--model", "smart-v1", "--json"],
      { AIWF_CODELET_ID: "codelet-observer" }
    );
    assert.equal(payload.codelet.id, "codelet-observer");
    assert.equal(payload.route.recommended.providerId, "mock-smart");
    assert.equal(payload.result.summary, "Recurring refactor and docs work should become explicit codelets.");

    const notes = await withWorkflowStore(targetRoot, async (store) => store.listNotes({ noteTypes: ["NOTE"] }));
    assert.equal(notes.some((note) => note.provenance === "tool-dev-codelet-observer"), true);
    assert.equal(notes.some((note) => /css-refactor/.test(note.body)), true);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("smart codelet runner resolves a project-registered codelet from the workflow registry", { concurrency: false }, async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "ai-workflow-smart-codelet-registry-"));

  try {
    await runNode([path.join(repoRoot, "scripts", "init-project.mjs"), "--target", targetRoot]);
    await mkdir(path.join(targetRoot, ".ai-workflow", "codelets"), { recursive: true });
    await writeFile(path.join(targetRoot, ".ai-workflow", "codelets", "story-snap.json"), JSON.stringify({
      id: "story-snap",
      stability: "staged",
      category: "documentation",
      summary: "Generate a compact story summary from the current project state.",
      runner: "node-script",
      entry: "runtime/scripts/ai-workflow/smart-codelet-runner.mjs",
      status: "staged"
    }, null, 2), "utf8");

    await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "sync", "--json"], { cwd: targetRoot });

    registerProvider("mock-smart-registry", {
      generate: async ({ modelId, prompt }) => {
        assert.equal(modelId, "smart-v1");
        assert.match(prompt, /Codelet id: story-snap/);
        assert.match(prompt, /Purpose: Generate a compact story summary from the current project state\./);
        return {
          providerId: "mock-smart-registry",
          modelId,
          response: JSON.stringify({
            summary: "Registry-backed smart codelets work without hard-coded runner branches.",
            observations: ["The helper resolved the project codelet from the synced registry."],
            candidate_codelets: [],
            suggested_actions: [],
            docs_to_update: [],
            needs_human_review: false
          })
        };
      }
    });

    const payload = await runSmartCodelet(
      ["--root", targetRoot, "--provider", "mock-smart-registry", "--model", "smart-v1", "--json"],
      { AIWF_CODELET_ID: "story-snap" }
    );
    assert.equal(payload.codelet.id, "story-snap");
    assert.equal(payload.codelet.summary, "Generate a compact story summary from the current project state.");
    assert.equal(payload.route.recommended.providerId, "mock-smart-registry");
    assert.equal(payload.result.summary, "Registry-backed smart codelets work without hard-coded runner branches.");
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("workflow mutations refresh kanban and DB projections immediately", { concurrency: false }, async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "ai-workflow-live-refresh-"));

  try {
    const createResult = await runNode([
      path.join(repoRoot, "cli", "ai-workflow.mjs"),
      "project",
      "ticket",
      "create",
      "--id",
      "EXE-900",
      "--title",
      "Refresh live projections after every workflow mutation",
      "--lane",
      "In Progress",
      "--epic",
      "EPC-900",
      "--summary",
      "Keep the live board and DB in sync after every state-changing command.",
      "--json"
    ], { cwd: targetRoot });
    assert.equal(createResult.code, 0, createResult.stderr || createResult.stdout);

    const kanbanAfterCreate = await readFile(path.join(targetRoot, "kanban.md"), "utf8");
    assert.match(kanbanAfterCreate, /## In Progress/);
    assert.match(kanbanAfterCreate, /EXE-900 Refresh live projections after every workflow mutation/);

    const epicsAfterCreate = await readFile(path.join(targetRoot, "epics.md"), "utf8");
    assert.match(epicsAfterCreate, /EPC-900/);

    const moveResult = await runNode([
      path.join(repoRoot, "runtime", "scripts", "ai-workflow", "kanban.mjs"),
      "move",
      "--id",
      "EXE-900",
      "--to",
      "Done"
    ], { cwd: targetRoot });
    assert.equal(moveResult.code, 0, moveResult.stderr || moveResult.stdout);

    const kanbanAfterMove = await readFile(path.join(targetRoot, "kanban.md"), "utf8");
    assert.match(kanbanAfterMove, /## Done/);
    assert.match(kanbanAfterMove, /EXE-900 Refresh live projections after every workflow mutation/);

    await withWorkflowStore(targetRoot, async (store) => {
      const ticket = store.getEntity("EXE-900");
      assert.equal(ticket?.lane, "Done");
      assert.equal(ticket?.state, "archived");
    });
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("ai-workflow ticket proving run evaluates multiple tickets against the real runtime helpers", { concurrency: false }, async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "ai-workflow-ticket-proving-"));

  try {
    await runNode([path.join(repoRoot, "scripts", "init-project.mjs"), "--target", targetRoot]);
    await mkdir(path.join(targetRoot, "docs"), { recursive: true });
    await mkdir(path.join(targetRoot, "src", "ui", "components", "dialog"), { recursive: true });
    await mkdir(path.join(targetRoot, "tests"), { recursive: true });
    await writeFile(
      path.join(targetRoot, "package.json"),
      JSON.stringify({
        name: "ticket-proving-runtime-test",
        type: "module",
        scripts: {
          "test:e2e": "node -e \"console.log('e2e ok')\"",
          "test:unit": "node -e \"console.log('unit ok')\""
        }
      }, null, 2),
      "utf8"
    );
    await writeFile(path.join(targetRoot, "src", "ui", "components", "dialog", "modal.riot"), "<modal><div>modal</div></modal>\n", "utf8");
    await writeFile(path.join(targetRoot, "tests", "modal.e2e.spec.ts"), "test('modal', () => {})\n", "utf8");
    await writeFile(
      path.join(targetRoot, "docs", "kanban.md"),
      [
        "# Kanban",
        "",
        "## In Progress",
        "- [ ] **REF-APP-SHELL-01**: Continue app-shell and modal-surface refactor hardening after review findings.",
        "",
        "## Priority 1 Bugs",
        "- [ ] **BUG-OVERLAY-01**: Restore global overlay handling for non-dialog modals after the app-shell refactor."
      ].join("\n"),
      "utf8"
    );

    const syncResult = await runNode(
      [path.join(repoRoot, "cli", "ai-workflow.mjs"), "sync", "--json"],
      { cwd: targetRoot }
    );
    assert.equal(syncResult.code, 0);

    const provingResult = await runNode(
      [path.join(repoRoot, "cli", "ai-workflow.mjs"), "run", "ticket-proving-run", "--tickets", "REF-APP-SHELL-01", "--json"],
      { cwd: targetRoot }
    );
    assert.equal(provingResult.code, 0);
    const provingPayload = JSON.parse(provingResult.stdout);
    assert.equal(provingPayload.total, 1);
    assert.equal(provingPayload.passed, 1);
    assert.equal(provingPayload.verificationPlanned, 1);
    assert.equal(Array.isArray(provingPayload.tickets), true);
    assert.equal(Array.isArray(provingPayload.tickets[0].executionPlan.verificationCommands), true);
    assert.equal(provingPayload.tickets[0].executionPlan.verificationCommands.length > 0, true);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("ai-workflow execution dry-run reports inferred plan without mutating files", { concurrency: false }, async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "ai-workflow-dry-run-"));

  try {
    await runNode([path.join(repoRoot, "scripts", "init-project.mjs"), "--target", targetRoot]);
    await mkdir(path.join(targetRoot, "docs"), { recursive: true });
    await mkdir(path.join(targetRoot, "src", "ui", "components", "dialog"), { recursive: true });
    await mkdir(path.join(targetRoot, "tests", "modal-smoke"), { recursive: true });
    await mkdir(path.join(targetRoot, "functions"), { recursive: true });
    await writeFile(path.join(targetRoot, "package.json"), JSON.stringify({
      name: "dry-run-test",
      packageManager: "pnpm@10.0.0",
      scripts: {
        "test:e2e": "playwright test -c playwright.config.ts",
        "test:unit": "playwright test -c playwright.unit.config.ts"
      }
    }, null, 2), "utf8");
    await writeFile(path.join(targetRoot, "playwright.config.ts"), "export default { testMatch: ['**/e2e.spec.ts'] };\n", "utf8");
    await writeFile(path.join(targetRoot, "playwright.unit.config.ts"), "export default { testMatch: ['**/*.unit.spec.ts'] };\n", "utf8");
    await writeFile(path.join(targetRoot, "src", "ui", "components", "dialog", "modal.riot"), "<modal></modal>\n", "utf8");
    await writeFile(path.join(targetRoot, "tests", "modal-smoke", "e2e.spec.ts"), "test('modal', () => {})\n", "utf8");
    await writeFile(path.join(targetRoot, "tests", "e2e.spec.ts"), "test('root e2e', () => {})\n", "utf8");
    await writeFile(path.join(targetRoot, "functions", "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");

    const syncResult = await runNode(
      [path.join(repoRoot, "cli", "ai-workflow.mjs"), "sync", "--json"],
      { cwd: targetRoot }
    );
    assert.equal(syncResult.code, 0);

    const ticketResult = await runNode(
      [
        path.join(repoRoot, "cli", "ai-workflow.mjs"),
        "project",
        "ticket",
        "create",
        "--id",
        "BUG-OVERLAY-01",
        "--title",
        "Restore global overlay handling for non-dialog modals after the app-shell refactor.",
        "--lane",
        "Bugs P1",
        "--summary",
        "Verification: pnpm exec playwright test -c playwright.config.ts tests/modal-smoke/e2e.spec.ts",
        "--json"
      ],
      { cwd: targetRoot }
    );
    assert.equal(ticketResult.code, 0);

    const dryRunResult = await runNode(
      [path.join(repoRoot, "cli", "ai-workflow.mjs"), "run", "execution-dry-run", "--ticket", "BUG-OVERLAY-01", "--json"],
      { cwd: targetRoot }
    );
    assert.equal(dryRunResult.code, 0);
    const payload = JSON.parse(dryRunResult.stdout);
    assert.equal(payload.ticket.id, "BUG-OVERLAY-01");
    assert.equal(Array.isArray(payload.executionPlan.verificationCommands), true);
    assert.equal(payload.executionPlan.verificationCommands.length > 0, true);
    assert.equal(
      payload.executionPlan.verificationCommands.some((entry) => /playwright\.config\.ts/.test(entry.command)),
      true
    );
    assert.equal(
      payload.executionPlan.verificationCommands.some((entry) => /playwright\.unit\.config\.ts/.test(entry.command)),
      false
    );
    assert.equal(payload.executionPlan.workingSet.includes("functions/pnpm-lock.yaml"), false);
    assert.equal(
      Array.isArray(payload.workingSetEvidence)
        && payload.workingSetEvidence.some((entry) => entry.kind === "selected-file"),
      true
    );
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("ai-workflow execution dry-run prefers primary source files over docs when enough code context exists", { concurrency: false }, async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "ai-workflow-dry-run-doc-filter-"));

  try {
    await runNode([path.join(repoRoot, "scripts", "init-project.mjs"), "--target", targetRoot]);
    await mkdir(path.join(targetRoot, "docs"), { recursive: true });
    await mkdir(path.join(targetRoot, "src", "engine"), { recursive: true });
    await mkdir(path.join(targetRoot, "src", "ui", "components"), { recursive: true });
    await mkdir(path.join(targetRoot, "tests"), { recursive: true });
    await writeFile(path.join(targetRoot, "package.json"), JSON.stringify({
      name: "dry-run-doc-filter",
      packageManager: "pnpm@10.0.0",
      scripts: {
        "test:e2e": "playwright test -c playwright.config.ts",
        "test:unit": "playwright test -c playwright.unit.config.ts",
        build: "vite build"
      }
    }, null, 2), "utf8");
    await writeFile(path.join(targetRoot, "playwright.config.ts"), "export default { testMatch: ['**/e2e.spec.ts'] };\n", "utf8");
    await writeFile(path.join(targetRoot, "playwright.unit.config.ts"), "export default { testMatch: ['**/*.unit.spec.ts'] };\n", "utf8");
    await writeFile(path.join(targetRoot, "src", "engine", "audio.ts"), "export function __getAudioDebugState() { return null; }\n", "utf8");
    await writeFile(path.join(targetRoot, "src", "engine", "gdrive-sync.ts"), "export const audioDebugSync = true;\n", "utf8");
    await writeFile(path.join(targetRoot, "src", "engine", "npc-logic-cache.ts"), "export const overlayDebugCache = new Map();\n", "utf8");
    await writeFile(path.join(targetRoot, "src", "ui", "components", "combat-modal.riot"), "<audio-debug-overlay></audio-debug-overlay>\n", "utf8");
    await writeFile(path.join(targetRoot, "src", "ui", "components", "tutorial-overlay.riot"), "<overlay-debug></overlay-debug>\n", "utf8");
    await writeFile(path.join(targetRoot, "tests", "e2e.spec.ts"), "test('audio debug overlay', () => {})\n", "utf8");
    await writeFile(path.join(targetRoot, "docs", "knowledge.md"), "# Audio debug overlay notes\n", "utf8");
    const syncResult = await runNode(
      [path.join(repoRoot, "cli", "ai-workflow.mjs"), "sync", "--json"],
      { cwd: targetRoot }
    );
    assert.equal(syncResult.code, 0);

    const ticketResult = await runNode(
      [
        path.join(repoRoot, "cli", "ai-workflow.mjs"),
        "project",
        "ticket",
        "create",
        "--id",
        "AUDIO-UX-03",
        "--title",
        "Add an audio-debug overlay.",
        "--lane",
        "Suggestions",
        "--json"
      ],
      { cwd: targetRoot }
    );
    assert.equal(ticketResult.code, 0);

    const dryRunResult = await runNode(
      [path.join(repoRoot, "cli", "ai-workflow.mjs"), "run", "execution-dry-run", "--ticket", "AUDIO-UX-03", "--json"],
      { cwd: targetRoot }
    );
    assert.equal(dryRunResult.code, 0);
    const payload = JSON.parse(dryRunResult.stdout);
    assert.equal(payload.executionPlan.workingSet.some((filePath) => String(filePath).startsWith("docs/")), false);
    assert.equal(payload.executionPlan.workingSet.includes("src/engine/audio.ts"), true);
    assert.equal(payload.executionPlan.workingSet.includes("tests/e2e.spec.ts"), true);
    assert.equal(payload.workingSetEvidence[0].kind, "selected-file");
    assert.equal(Array.isArray(payload.workingSetEvidence[0].reasons), true);
    assert.equal(payload.workingSetEvidence[0].reasons.length > 0, true);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("ai-workflow install creates the core OS workspace and initializes project config", { concurrency: false }, async () => {
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

test("project codelets override toolkit codelets by id", { concurrency: false }, async () => {
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

test("ai-workflow mode set/status stores explicit tool-dev mode", { concurrency: false }, async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "ai-workflow-mode-"));

  try {
    await runNode([path.join(repoRoot, "scripts", "init-project.mjs"), "--target", targetRoot]);

    const setResult = await runNode(
      [path.join(repoRoot, "cli", "ai-workflow.mjs"), "mode", "set", "tool-dev"],
      { cwd: targetRoot }
    );
    assert.equal(setResult.code, 0);

    const statusResult = await runNode(
      [path.join(repoRoot, "cli", "ai-workflow.mjs"), "mode", "status", "--json"],
      { cwd: targetRoot }
    );
    assert.equal(statusResult.code, 0);
    const payload = JSON.parse(statusResult.stdout);
    assert.equal(payload.mode, "tool-dev");
    assert.equal(typeof payload.repairTargetRoot, "string");
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("ai-workflow tool observe can infer and record a toolkit-style observation with explicit inputs", { concurrency: false }, async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "ai-workflow-tool-observe-"));

  try {
    await runNode([path.join(repoRoot, "scripts", "init-project.mjs"), "--target", targetRoot]);
    const result = await runNode(
      [
        path.join(repoRoot, "cli", "ai-workflow.mjs"),
        "tool",
        "observe",
        "--mode",
        "default",
        "--root",
        targetRoot,
        "--complaint",
        "it lied about readiness and picked useless verification",
        "--expected",
        "it should admit verification is weak and ask for better checks",
        "--create-ticket",
        "--json"
      ],
      { cwd: targetRoot }
    );
    assert.equal(result.code, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.observation.kind, "misleading-output");
    assert.equal(payload.observation.component, "shell");
    assert.equal(payload.observation.severity, "blocking");
    assert.equal(payload.ticket.id, "TKH-001");
    assert.equal(payload.note.provenance, "tool-dev-observe");
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("tool-dev mode blocks external execution targets unless explicitly allowed", { concurrency: false }, async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "ai-workflow-tool-dev-guard-"));

  try {
    await runNode([path.join(repoRoot, "scripts", "init-project.mjs"), "--target", targetRoot]);

    const result = await runNode(
      [
        path.join(repoRoot, "cli", "ai-workflow.mjs"),
        "run",
        "execution-dry-run",
        "--mode",
        "tool-dev",
        "--root",
        targetRoot,
        "--ticket",
        "TKT-001",
        "--json"
      ],
      { cwd: targetRoot }
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /tool-dev mode refuses external repair target/i);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("tool observe auto-attaches the latest recorded run artifact", { concurrency: false }, async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "ai-workflow-observe-run-artifact-"));

  try {
    await runNode([path.join(repoRoot, "scripts", "init-project.mjs"), "--target", targetRoot]);
    await mkdir(path.join(targetRoot, "docs"), { recursive: true });
    await mkdir(path.join(targetRoot, "src", "ui", "components", "dialog"), { recursive: true });
    await mkdir(path.join(targetRoot, "tests", "modal-smoke"), { recursive: true });
    await writeFile(path.join(targetRoot, "package.json"), JSON.stringify({
      name: "observe-run-artifact-test",
      packageManager: "pnpm@10.0.0",
      scripts: {
        "test:e2e": "playwright test -c playwright.config.ts",
        "test:unit": "playwright test -c playwright.unit.config.ts"
      }
    }, null, 2), "utf8");
    await writeFile(path.join(targetRoot, "playwright.config.ts"), "export default { testMatch: ['**/e2e.spec.ts'] };\n", "utf8");
    await writeFile(path.join(targetRoot, "playwright.unit.config.ts"), "export default { testMatch: ['**/*.unit.spec.ts'] };\n", "utf8");
    await writeFile(path.join(targetRoot, "src", "ui", "components", "dialog", "modal.riot"), "<modal></modal>\n", "utf8");
    await writeFile(path.join(targetRoot, "tests", "modal-smoke", "e2e.spec.ts"), "test('modal', () => {})\n", "utf8");

    let result = await runNode(
      [path.join(repoRoot, "cli", "ai-workflow.mjs"), "sync", "--json"],
      { cwd: targetRoot }
    );
    assert.equal(result.code, 0);

    result = await runNode(
      [
        path.join(repoRoot, "cli", "ai-workflow.mjs"),
        "project",
        "ticket",
        "create",
        "--id",
        "BUG-OVERLAY-01",
        "--title",
        "Restore global overlay handling for non-dialog modals after the app-shell refactor.",
        "--lane",
        "Bugs P1",
        "--json"
      ],
      { cwd: targetRoot }
    );
    assert.equal(result.code, 0);

    result = await runNode(
      [path.join(repoRoot, "cli", "ai-workflow.mjs"), "run", "execution-dry-run", "--ticket", "BUG-OVERLAY-01", "--json"],
      { cwd: targetRoot }
    );
    assert.equal(result.code, 0);
    const dryRunPayload = JSON.parse(result.stdout);
    assert.equal(typeof dryRunPayload.runArtifact?.id, "string");

    result = await runNode(
      [
        path.join(repoRoot, "cli", "ai-workflow.mjs"),
        "tool",
        "observe",
        "--mode",
        "default",
        "--root",
        targetRoot,
        "--complaint",
        "it picked weak verification",
        "--expected",
        "it should attach the exact run",
        "--json"
      ],
      { cwd: targetRoot }
    );
    assert.equal(result.code, 0);
    const observePayload = JSON.parse(result.stdout);
    assert.equal(observePayload.attachedRun.id, dryRunPayload.runArtifact.id);
    assert.equal(observePayload.attachedRun.kind, "execution-dry-run");
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("tool-dev proving keeps toolkit as repair target and external project as evidence root", { concurrency: false }, async () => {
  const toolkitRoot = repoRoot;
  const evidenceRoot = await mkdtemp(path.join(os.tmpdir(), "ai-workflow-tool-dev-evidence-"));

  try {
    await runNode([path.join(repoRoot, "scripts", "init-project.mjs"), "--target", evidenceRoot]);
    await mkdir(path.join(evidenceRoot, "src", "ui", "components", "dialog"), { recursive: true });
    await mkdir(path.join(evidenceRoot, "tests"), { recursive: true });
    await writeFile(
      path.join(evidenceRoot, "package.json"),
      JSON.stringify({
        name: "tool-dev-evidence",
        type: "module",
        scripts: {
          "test:e2e": "node -e \"console.log('e2e ok')\"",
          "test:unit": "node -e \"console.log('unit ok')\""
        }
      }, null, 2),
      "utf8"
    );
    await writeFile(path.join(evidenceRoot, "src", "ui", "components", "dialog", "modal.riot"), "<modal><div>modal</div></modal>\n", "utf8");
    await writeFile(path.join(evidenceRoot, "tests", "modal.e2e.spec.ts"), "test('modal', () => {})\n", "utf8");
    const syncResult = await runNode(
      [path.join(repoRoot, "cli", "ai-workflow.mjs"), "sync", "--json"],
      { cwd: evidenceRoot }
    );
    assert.equal(syncResult.code, 0);
    const ticketResult = await runNode(
      [
        path.join(repoRoot, "cli", "ai-workflow.mjs"),
        "project",
        "ticket",
        "create",
        "--id",
        "BUG-OVERLAY-01",
        "--title",
        "Restore global overlay handling for non-dialog modals after the app-shell refactor.",
        "--lane",
        "Bugs P1",
        "--summary",
        "Verification: npm run test:e2e",
        "--json"
      ],
      { cwd: evidenceRoot }
    );
    assert.equal(ticketResult.code, 0);

    const result = await runNode(
      [
        path.join(repoRoot, "cli", "ai-workflow.mjs"),
        "run",
        "ticket-proving-run",
        "--mode",
        "tool-dev",
        "--root",
        evidenceRoot,
        "--tickets",
        "BUG-OVERLAY-01",
        "--json"
      ],
      { cwd: toolkitRoot }
    );
    assert.equal(result.code, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.mode, "tool-dev");
    assert.equal(payload.repairTargetRoot, toolkitRoot);
    assert.equal(payload.evidenceRoot, evidenceRoot);
    assert.equal(payload.root, evidenceRoot);
    assert.equal(typeof payload.runArtifact?.id, "string");
  } finally {
    await rm(evidenceRoot, { recursive: true, force: true });
  }
});
