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
  const captureDir = await mkdtemp(path.join(os.tmpdir(), "ai-workflow-capture-"));
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
  return mkdtemp(path.join(os.tmpdir(), "ai-workflow-test-"));
}

async function cleanup(dir) {
  await rm(dir, { recursive: true, force: true });
}

async function countInstallableFiles() {
  const runtimeDir = path.resolve(repoRoot, "runtime", "scripts", "ai-workflow");
  const files = await walkFiles(runtimeDir);
  // + templates
  return files.length + 11;
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
    "```ai-workflow-audit",
    JSON.stringify(config, null, 2),
    "```",
    ""
  ].join("\n");
  const current = await readFile(knowledgePath, "utf8");
  await writeFile(knowledgePath, current + block, "utf8");
}

async function createShellFixtureProject() {
  const targetRoot = await makeTempDir();
  await runNode(["scripts/init-project.mjs", "--target", targetRoot], { cwd: repoRoot });
  await mkdir(path.join(targetRoot, "docs"), { recursive: true });
  await mkdir(path.join(targetRoot, "src", "ui", "components", "dialog"), { recursive: true });
  await mkdir(path.join(targetRoot, "tests"), { recursive: true });
  await writeFile(
    path.join(targetRoot, "package.json"),
    JSON.stringify({
      name: "shell-current-work-test",
      type: "module",
      scripts: {
        "test:e2e": "node -e \"console.log('e2e ok')\"",
        "test:unit": "node -e \"console.log('unit ok')\""
      }
    }, null, 2),
    "utf8"
  );
  await writeFile(
    path.join(targetRoot, "docs", "kanban.md"),
    [
      "# Kanban",
      "",
      "## In Progress",
      "- [ ] **REF-APP-SHELL-01**: Continue app-shell and modal-surface refactor hardening after review findings.",
      "  - Outcome: restore overlay handling and deep-link routing."
    ].join("\n"),
    "utf8"
  );
  await writeFile(path.join(targetRoot, "src", "ui", "components", "dialog", "modal.riot"), "<modal></modal>\n", "utf8");
  await writeFile(path.join(targetRoot, "tests", "modal.e2e.spec.ts"), "test('modal', () => {})\n", "utf8");
  return targetRoot;
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
    assert.match(firstRun.stdout, /Package scripts installed: 8/);

    const agents = await readFile(path.join(targetRoot, "AGENTS.md"), "utf8");
    assert.match(agents, /AI Agent Protocol: Autonomous Engineering OS/);

    const protocolFile = await readFile(path.join(targetRoot, "execution-protocol.md"), "utf8");
    assert.match(protocolFile, /Required Order/);
    const packageJson = JSON.parse(await readFile(path.join(targetRoot, "package.json"), "utf8"));
    assert.equal(packageJson.scripts["workflow:dogfood"], "node scripts/ai-workflow/dogfood.mjs");
    assert.equal(packageJson.scripts["workflow:audit"], "node scripts/ai-workflow/workflow-audit.mjs");
    assert.equal(packageJson.scripts["workflow:guideline-audit"], "node scripts/ai-workflow/guideline-audit.mjs");
    await access(path.join(targetRoot, ".ai-workflow", "state", "workflow.db"));
    await access(path.join(targetRoot, ".ai-workflow", "generated", "dogfood-report.json"));

    const ciWorkflow = await readFile(
      path.join(targetRoot, ".github", "workflows", "ai-workflow-audit.yml"),
      "utf8"
    );
    assert.match(ciWorkflow, /workflow-audit/);

    const auditScriptStat = await import("node:fs/promises").then(m => m.stat(path.join(targetRoot, "scripts", "ai-workflow", "workflow-audit.mjs")));
    assert.equal(auditScriptStat.mode & 0o111, 0o111);

    const secondRun = await runNode(["scripts/init-project.mjs", "--target", targetRoot]);
    assert.equal(secondRun.code, 0);
    assert.match(secondRun.stdout, new RegExp(`Identical: ${await countInstallableFiles()}`));
    assert.match(secondRun.stdout, /Skipped existing: 0/);
    assert.match(secondRun.stdout, /Package scripts identical: 8/);
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

test("setup is a top-level alias for install", async () => {
  const targetRoot = await makeTempDir();

  try {
    const result = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "setup", "--project", targetRoot], { cwd: repoRoot });
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Installation complete/);
    await access(path.join(targetRoot, ".ai-workflow"));
    await access(path.join(targetRoot, ".ai-workflow", "config.json"));
    await access(path.join(targetRoot, ".ai-workflow", "state"));
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

test("metrics command reports session, last active work hours, and trailing week slices", async () => {
  const targetRoot = await makeTempDir();

  try {
    const seed = await runNode([
      "--input-type=module",
      "-e",
      [
        `import { openWorkflowStore } from ${JSON.stringify(path.join(repoRoot, "core", "db", "sqlite-store.mjs"))};`,
        "const store = await openWorkflowStore({ projectRoot: process.cwd() });",
        "store.appendMetric({ taskClass: 'shell-planning', capability: 'strategy', providerId: 'ollama', modelId: 'hermes3:8b', promptTokens: 120, completionTokens: 40, latencyMs: 2200, success: true, createdAt: '2026-04-09T08:00:00.000Z' });",
        "store.appendMetric({ taskClass: 'summarization', capability: 'data', providerId: 'google', modelId: 'gemini-2.0-flash', promptTokens: 180, completionTokens: 70, latencyMs: 4500, success: false, errorMessage: 'timeout', createdAt: '2026-04-09T09:05:00.000Z' });",
        "store.appendMetric({ taskClass: 'review', capability: 'logic', providerId: 'ollama', modelId: 'hermes3:8b', promptTokens: 300, completionTokens: 90, latencyMs: 6800, success: true, createdAt: '2026-04-09T09:15:00.000Z' });",
        "store.close();"
      ].join(" ")
    ], { cwd: targetRoot });
    assert.equal(seed.code, 0, seed.stderr || seed.stdout);

    const jsonResult = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "metrics", "--json"], { cwd: targetRoot });
    assert.equal(jsonResult.code, 0, jsonResult.stderr || jsonResult.stdout);
    const payload = JSON.parse(jsonResult.stdout);
    assert.equal(payload.windows.latestSession.calls, 2);
    assert.equal(payload.windows.trailingWeek.calls, 3);

    const textResult = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "metrics"], { cwd: targetRoot });
    assert.equal(textResult.code, 0, textResult.stderr || textResult.stdout);
    assert.match(textResult.stdout, /Latest session/);
    assert.match(textResult.stdout, /Last 4 active work hours/);
    assert.match(textResult.stdout, /Trailing week/);
    assert.match(textResult.stdout, /Quality:/);
    assert.match(textResult.stdout, /Cost:/);
  } finally {
    await cleanup(targetRoot);
  }
});

test("metrics command explains real-vs-mock scoring and degraded real traffic", async () => {
  const targetRoot = await makeTempDir();

  try {
    const seed = await runNode([
      "--input-type=module",
      "-e",
      [
        `import { openWorkflowStore } from ${JSON.stringify(path.join(repoRoot, "core", "db", "sqlite-store.mjs"))};`,
        "const store = await openWorkflowStore({ projectRoot: process.cwd() });",
        "store.appendMetric({ taskClass: 'shell-planning', capability: 'strategy', providerId: 'ollama', modelId: 'mock-model', promptTokens: 20, completionTokens: 10, latencyMs: 1, success: true, createdAt: '2026-04-09T09:00:00.000Z' });",
        "store.appendMetric({ taskClass: 'shell-planning', capability: 'strategy', providerId: 'ollama', modelId: 'hermes3:8b', promptTokens: 100, completionTokens: 30, latencyMs: 20003, success: false, errorMessage: 'timeout', createdAt: '2026-04-09T09:15:00.000Z' });",
        "store.close();"
      ].join(" ")
    ], { cwd: targetRoot });
    assert.equal(seed.code, 0, seed.stderr || seed.stdout);

    const jsonResult = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "metrics", "--json"], { cwd: targetRoot });
    assert.equal(jsonResult.code, 0, jsonResult.stderr || jsonResult.stdout);
    const payload = JSON.parse(jsonResult.stdout);
    assert.equal(payload.windows.latestSession.quality.basis, "real-traffic");
    assert.equal(payload.windows.latestSession.realTraffic.calls, 1);
    assert.equal(payload.windows.latestSession.mockTraffic.calls, 1);
    assert.equal(payload.windows.latestSession.quality.successRate, 0);

    const textResult = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "metrics"], { cwd: targetRoot });
    assert.equal(textResult.code, 0, textResult.stderr || textResult.stdout);
    assert.match(textResult.stdout, /Quality basis:/);
    assert.match(textResult.stdout, /based on real traffic/);
    assert.match(textResult.stdout, /1 real \/ 1 mock calls/);
    assert.match(textResult.stdout, /Alert: Real traffic is degraded/);
  } finally {
    await cleanup(targetRoot);
  }
});

test("top-level --version reports the installed package version and toolkit root", async () => {
  const result = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "--version"], { cwd: repoRoot });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /@dharmax\/ai-workflow 0\.1\.0/);
  assert.match(result.stdout, new RegExp(repoRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
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

test("web tutorial readiness api exposes the shared readiness evaluator in tool-dev mode", async () => {
  const evidenceRoot = await createShellFixtureProject();
  const sync = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "sync", "--json"], { cwd: evidenceRoot });
  assert.equal(sync.code, 0, sync.stderr || sync.stdout);

  const child = spawn(process.execPath, [
    path.join(repoRoot, "cli", "ai-workflow.mjs"),
    "web",
    "tutorial",
    "--mode",
    "tool-dev",
    "--evidence-root",
    evidenceRoot,
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
      const timeout = setTimeout(() => reject(new Error(`tutorial readiness server timeout\nstdout: ${stdout}\nstderr: ${stderr}`)), 5000);
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
        reject(new Error(`tutorial readiness server exited early with code ${code}\nstdout: ${stdout}\nstderr: ${stderr}`));
      });
    });

    const response = await fetch(new URL("/api/readiness?goal=beta_readiness&question=Is%20this%20ready%20for%20beta%20testing%3F", started.url));
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.operation, "evaluate_readiness");
    assert.equal(payload.meta.mode, "tool-dev");
    assert.equal(payload.meta.evidence_root, evidenceRoot);
    assert.equal(payload.meta.operational_root, evidenceRoot);
    assert.equal(Array.isArray(payload.gaps), true);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.on("exit", resolve));
    await cleanup(evidenceRoot);
  }
});

test("web tutorial host ask api routes natural-language readiness requests through the shared host resolver", async () => {
  const evidenceRoot = await createShellFixtureProject();
  const sync = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "sync", "--json"], { cwd: evidenceRoot });
  assert.equal(sync.code, 0, sync.stderr || sync.stdout);

  const child = spawn(process.execPath, [
    path.join(repoRoot, "cli", "ai-workflow.mjs"),
    "web",
    "tutorial",
    "--mode",
    "tool-dev",
    "--evidence-root",
    evidenceRoot,
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
      const timeout = setTimeout(() => reject(new Error(`tutorial host server timeout\nstdout: ${stdout}\nstderr: ${stderr}`)), 5000);
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
        const trimmed = stdout.trim();
        if (!trimmed) return;
        try {
          const payload = JSON.parse(trimmed);
          clearTimeout(timeout);
          resolve(payload);
        } catch {
          // wait for full json
        }
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`tutorial host server exited early with code ${code}\nstdout: ${stdout}\nstderr: ${stderr}`));
      });
    });

    const response = await fetch(new URL("/api/ask?text=Is%20this%20project%20ready%20for%20beta%20testing%3F", started.url));
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.route.operation, "evaluate_readiness");
    assert.equal(payload.route.intent, "readiness_question");
    assert.equal(payload.response_type, "protocol");
    assert.equal(payload.payload.operation, "evaluate_readiness");
    assert.equal(payload.meta.mode, "tool-dev");
    assert.equal(payload.meta.evidence_root, evidenceRoot);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.on("exit", resolve));
    await cleanup(evidenceRoot);
  }
});

test("web tutorial host ask api routes current-work questions without shell-only behavior", async () => {
  const evidenceRoot = await createShellFixtureProject();
  const sync = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "sync", "--json"], { cwd: evidenceRoot });
  assert.equal(sync.code, 0, sync.stderr || sync.stdout);

  const child = spawn(process.execPath, [
    path.join(repoRoot, "cli", "ai-workflow.mjs"),
    "web",
    "tutorial",
    "--mode",
    "tool-dev",
    "--evidence-root",
    evidenceRoot,
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
      const timeout = setTimeout(() => reject(new Error(`tutorial host server timeout\nstdout: ${stdout}\nstderr: ${stderr}`)), 5000);
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
        const trimmed = stdout.trim();
        if (!trimmed) return;
        try {
          const payload = JSON.parse(trimmed);
          clearTimeout(timeout);
          resolve(payload);
        } catch {
          // wait for full json
        }
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`tutorial host server exited early with code ${code}\nstdout: ${stdout}\nstderr: ${stderr}`));
      });
    });

    const response = await fetch(new URL("/api/ask?text=What%20are%20we%20working%20on%20right%20now%3F", started.url));
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.route.operation, "project_summary");
    assert.equal(payload.route.intent, "current_work");
    assert.equal(payload.response_type, "summary");
    assert.match(payload.payload.answer, /REF-APP-SHELL-01/);
    assert.equal(payload.meta.mode, "tool-dev");
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.on("exit", resolve));
    await cleanup(evidenceRoot);
  }
});

test("ask command routes natural-language readiness requests for real host-style usage", async () => {
  const evidenceRoot = await createShellFixtureProject();
  const sync = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "sync", "--json"], { cwd: evidenceRoot });
  assert.equal(sync.code, 0, sync.stderr || sync.stdout);

  try {
    const result = await runNode([
      path.join(repoRoot, "cli", "ai-workflow.mjs"),
      "ask",
      "--mode",
      "tool-dev",
      "--evidence-root",
      evidenceRoot,
      "Is this project ready for beta testing?",
      "--json"
    ], { cwd: repoRoot });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.route.operation, "evaluate_readiness");
    assert.equal(payload.route.intent, "readiness_question");
    assert.equal(payload.response_type, "protocol");
    assert.equal(payload.payload.operation, "evaluate_readiness");
    assert.equal(payload.meta.mode, "tool-dev");
    assert.equal(payload.meta.evidence_root, evidenceRoot);
  } finally {
    await cleanup(evidenceRoot);
  }
});

test("ask command renders readiness in assistant-first language for plugin-style CLI use", async () => {
  const evidenceRoot = await createShellFixtureProject();
  const sync = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "sync", "--json"], { cwd: evidenceRoot });
  assert.equal(sync.code, 0, sync.stderr || sync.stdout);

  try {
    const result = await runNode([
      path.join(repoRoot, "cli", "ai-workflow.mjs"),
      "ask",
      "--mode",
      "tool-dev",
      "--evidence-root",
      evidenceRoot,
      "Is this project ready for beta testing?"
    ], { cwd: repoRoot });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Beta readiness: not ready yet/i);
    assert.match(result.stdout, /Next step:/);
    assert.doesNotMatch(result.stdout, /Status: complete/);
    assert.doesNotMatch(result.stdout, /Evidence basis:/);
  } finally {
    await cleanup(evidenceRoot);
  }
});

test("shell creates a Telegram remote-control epic end to end in mutating mode", async () => {
  const projectRoot = await makeTempDir();
  const preloadPath = path.join(projectRoot, "shell-preload.mjs");
  const prompt = "create epic for Telegram remote-control. it should be multi-phase. first think about the long-term vision, then break it into small, easy to achieve steps, each step adding a feature.";

  try {
    await mkdir(path.join(projectRoot, ".ai-workflow"), { recursive: true });
    await writeFile(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ name: "shell-doctor-test", type: "module" }, null, 2),
      "utf8"
    );
    await writeFile(
      path.join(projectRoot, ".ai-workflow", "config.json"),
      JSON.stringify({
        providers: {
          ollama: {
            host: "http://127.0.0.1:11434"
          }
        }
      }, null, 2),
      "utf8"
    );
    const seedTicket = await runNode([
      path.join(repoRoot, "cli", "ai-workflow.mjs"),
      "project",
      "ticket",
      "create",
      "--id",
      "TKT-TELEGRAM-SEED",
      "--title",
      "Seed ticket for mutating shell tests",
      "--lane",
      "In Progress",
      "--json"
    ], { cwd: projectRoot });
    assert.equal(seedTicket.code, 0, seedTicket.stderr || seedTicket.stdout);
    await writeFile(
      preloadPath,
      [
        "globalThis.fetch = async (url, init) => {",
        "  const text = String(url);",
        "  if (text.endsWith('/api/tags')) {",
        "    return {",
        "      ok: true,",
        "      async json() {",
        "        return {",
        "          models: [",
        "            { name: 'moondream:latest', size: 2 * 1024 ** 3 },",
        "            { name: 'qwen2.5-coder:7b', size: 7 * 1024 ** 3 }",
        "          ]",
        "        };",
        "      }",
        "    };",
        "  }",
        "  if (text.includes('duckduckgo')) {",
        "    return {",
        "      ok: true,",
        "      async text() {",
        "        return '<html><body></body></html>';",
        "      }",
        "    };",
        "  }",
        "  if (text.includes('generativelanguage.googleapis.com')) {",
        "    return {",
        "      ok: true,",
        "      async json() {",
        "        return {",
        "          candidates: [{",
        "            content: {",
        "              parts: [{",
        "                text: JSON.stringify({",
        "                  status: 'complete',",
        "                  epic: {",
        "                    id: 'EPIC-TELEGRAM-001',",
        "                    title: 'Telegram remote-control',",
        "                    summary: 'Build a Telegram-driven remote-control layer that lets trusted operators inspect status, trigger safe actions, and roll out mutating capabilities in phases with explicit confirmation, traceability, and rollback controls.',",
        "                    userStories: [",
        "                      'As an operator, I can pair a Telegram identity with the project so commands are only accepted from trusted senders.',",
        "                      'As an operator, I can ask for project status and current work from Telegram without leaving the chat.',",
        "                      'As an operator, I can request mutating actions through staged approvals and dry-runs before anything changes.',",
        "                      'As an operator, I can see trace output, audit history, and the selected AI model for each command.',",
        "                      'As an operator, I can gradually enable new control surfaces and disable them quickly if something misbehaves.'",
        "                    ],",
        "                    ticketBatches: [",
        "                      'Phase 1: Telegram identity, pairing, and trust boundaries.',",
        "                      'Phase 2: Read-only command routing and status responses.',",
        "                      'Phase 3: Mutating commands with explicit approval, dry-run, and confirmation.',",
        "                      'Phase 4: Trace logging, audit trail, safety checks, and rollback controls.',",
        "                      'Phase 5: Operator UX, rollout guardrails, and polish.'",
        "                    ]",
        "                  },",
        "                  tickets: [",
        "                    { id: 'TKT-TELEGRAM-001', title: 'Pair Telegram identity and trust gate', summary: 'Authorize a Telegram sender, persist the trust binding, and reject unknown chat commands.', domain: 'logic', story: 'As an operator, I can pair a Telegram identity with the project so remote commands are only accepted from trusted senders.' },",
        "                    { id: 'TKT-TELEGRAM-002', title: 'Route read-only Telegram commands', summary: 'Support status, summary, and current-work queries from Telegram without mutating state.', domain: 'logic', story: 'As an operator, I can ask for project status and current work from Telegram without leaving the chat.' },",
        "                    { id: 'TKT-TELEGRAM-003', title: 'Gate mutating Telegram commands with approval', summary: 'Require explicit approval, dry-run, and confirmation before a Telegram command changes project state.', domain: 'logic', story: 'As an operator, I can request mutating actions through staged approvals and dry-runs before anything changes.' },",
        "                    { id: 'TKT-TELEGRAM-004', title: 'Expose traces and audit history for remote actions', summary: 'Show the selected model, the prompt path, and audit records for each Telegram remote-control request.', domain: 'logic', story: 'As an operator, I can see trace output, audit history, and the selected AI model for each command.' },",
        "                    { id: 'TKT-TELEGRAM-005', title: 'Add rollout controls and kill switch', summary: 'Add feature flags, scope controls, and a fast disable path so remote control can be rolled out safely.', domain: 'logic', story: 'As an operator, I can gradually enable new control surfaces and disable them quickly if something misbehaves.' }",
        "                  ]",
        "                })",
        "              }]",
        "            }",
        "          }]",
        "        };",
        "      }",
        "    };",
        "  }",
        "  if (text.endsWith('/api/generate') || text.endsWith('/api/chat')) {",
        "    const payload = JSON.parse(String(init?.body ?? '{}'));",
        "    if (String(payload.system ?? '').includes('Product Manager') || String(payload.prompt ?? '').includes('User Intent:')) {",
        "      return {",
        "        ok: true,",
        "        async json() {",
        "          return {",
        "            response: JSON.stringify({",
        "              status: 'complete',",
        "              epic: {",
        "                id: 'EPIC-TELEGRAM-001',",
        "                title: 'Telegram remote-control',",
        "                summary: 'Build a Telegram-driven remote-control layer that lets trusted operators inspect status, trigger safe actions, and roll out mutating capabilities in phases with explicit confirmation, traceability, and rollback controls.',",
        "                userStories: [",
        "                  'As an operator, I can pair a Telegram identity with the project so commands are only accepted from trusted senders.',",
        "                  'As an operator, I can ask for project status and current work from Telegram without leaving the chat.',",
        "                  'As an operator, I can request mutating actions through staged approvals and dry-runs before anything changes.',",
        "                  'As an operator, I can see trace output, audit history, and the selected AI model for each command.',",
        "                  'As an operator, I can gradually enable new control surfaces and disable them quickly if something misbehaves.'",
        "                ],",
        "                ticketBatches: [",
        "                  'Phase 1: Telegram identity, pairing, and trust boundaries.',",
        "                  'Phase 2: Read-only command routing and status responses.',",
        "                  'Phase 3: Mutating commands with explicit approval, dry-run, and confirmation.',",
        "                  'Phase 4: Trace logging, audit trail, safety checks, and rollback controls.',",
        "                  'Phase 5: Operator UX, rollout guardrails, and polish.'",
        "                ]",
        "              },",
        "              tickets: [",
        "                { id: 'TKT-TELEGRAM-001', title: 'Pair Telegram identity and trust gate', summary: 'Authorize a Telegram sender, persist the trust binding, and reject unknown chat commands.', domain: 'logic', story: 'As an operator, I can pair a Telegram identity with the project so remote commands are only accepted from trusted senders.' },",
        "                { id: 'TKT-TELEGRAM-002', title: 'Route read-only Telegram commands', summary: 'Support status, summary, and current-work queries from Telegram without mutating state.', domain: 'logic', story: 'As an operator, I can ask for project status and current work from Telegram without leaving the chat.' },",
        "                { id: 'TKT-TELEGRAM-003', title: 'Gate mutating Telegram commands with approval', summary: 'Require explicit approval, dry-run, and confirmation before a Telegram command changes project state.', domain: 'logic', story: 'As an operator, I can request mutating actions through staged approvals and dry-runs before anything changes.' },",
        "                { id: 'TKT-TELEGRAM-004', title: 'Expose traces and audit history for remote actions', summary: 'Show the selected model, the prompt path, and audit records for each Telegram remote-control request.', domain: 'logic', story: 'As an operator, I can see trace output, audit history, and the selected AI model for each command.' },",
        "                { id: 'TKT-TELEGRAM-005', title: 'Add rollout controls and kill switch', summary: 'Add feature flags, scope controls, and a fast disable path so remote control can be rolled out safely.', domain: 'logic', story: 'As an operator, I can gradually enable new control surfaces and disable them quickly if something misbehaves.' }",
        "              ]",
        "            })",
        "          };",
        "        }",
        "      };",
        "    }",
        "  }",
        "  throw new Error(`Unexpected fetch URL: ${text}`);",
        "};"
      ].join("\n"),
      "utf8"
    );

    const result = await runNode([
      "--import",
      preloadPath,
      path.join(repoRoot, "cli", "ai-workflow.mjs"),
      "shell",
      prompt,
      "--yes"
    ], { cwd: projectRoot });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Feature scoped and added: EPIC-TELEGRAM-001 Telegram remote-control/);

    const epicResult = await runNode([
      path.join(repoRoot, "cli", "ai-workflow.mjs"),
      "project",
      "epic",
      "show",
      "EPIC-TELEGRAM-001",
      "--json"
    ], { cwd: projectRoot });

    assert.equal(epicResult.code, 0, epicResult.stderr || epicResult.stdout);
    const epic = JSON.parse(epicResult.stdout);
    assert.equal(epic.title, "Telegram remote-control");
    assert.equal(epic.userStories.length, 5);
    assert.equal(epic.ticketBatches.length, 5);
    assert.equal(epic.linkedTickets.length, 5);

    const epicsText = await readFile(path.join(projectRoot, "epics.md"), "utf8");
    const kanbanText = await readFile(path.join(projectRoot, "kanban.md"), "utf8");
    assert.match(epicsText, /EPIC-TELEGRAM-001 Telegram remote-control/);
    assert.match(kanbanText, /TKT-TELEGRAM-001 Pair Telegram identity and trust gate/);
    assert.match(kanbanText, /TKT-TELEGRAM-005 Add rollout controls and kill switch/);
  } finally {
    await cleanup(projectRoot);
  }
});

test("ask command handles combined project status and beta readiness questions", async () => {
  const evidenceRoot = await createShellFixtureProject();
  const sync = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "sync", "--json"], { cwd: evidenceRoot });
  assert.equal(sync.code, 0, sync.stderr || sync.stdout);

  try {
    const result = await runNode([
      path.join(repoRoot, "cli", "ai-workflow.mjs"),
      "ask",
      "--mode",
      "tool-dev",
      "--evidence-root",
      evidenceRoot,
      "what's the project status? how ready is it for beta test?"
    ], { cwd: repoRoot });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Project status:/);
    assert.match(result.stdout, /Current focus:/);
    assert.match(result.stdout, /Beta readiness: not ready yet/i);
    assert.doesNotMatch(result.stdout, /Routed to:/);
    assert.doesNotMatch(result.stdout, /Status: complete/);
  } finally {
    await cleanup(evidenceRoot);
  }
});

test("shell handles a bare epic question locally without calling the AI planner", async () => {
  const projectRoot = await makeTempDir();
  const preloadPath = path.join(projectRoot, "shell-preload.mjs");

  try {
    await mkdir(path.join(projectRoot, ".ai-workflow"), { recursive: true });
    await writeFile(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ name: "shell-doctor-test", type: "module" }, null, 2),
      "utf8"
    );
    await writeFile(
      path.join(projectRoot, ".ai-workflow", "config.json"),
      JSON.stringify({
        providers: {
          ollama: {
            host: "http://127.0.0.1:11434"
          }
        }
      }, null, 2),
      "utf8"
    );
    await writeFile(
      preloadPath,
      [
        "globalThis.fetch = async (url, init) => {",
        "  const text = String(url);",
        "  if (text.endsWith('/api/tags')) {",
        "    return {",
        "      ok: true,",
        "      async json() {",
        "        return { models: [{ name: 'qwen2.5-coder:7b', size: 7 * 1024 ** 3 }] };",
        "      }",
        "    };",
        "  }",
        "  if (text.endsWith('/api/generate') || text.endsWith('/api/chat') || text.includes('generativelanguage.googleapis.com') || text.includes('api.openai.com')) {",
        "    throw new Error(`Unexpected AI call: ${text}`);",
        "  }",
        "  throw new Error(`Unexpected fetch URL: ${text}`);",
        "};"
      ].join("\n"),
      "utf8"
    );

    const result = await runNode([
      "--import",
      preloadPath,
      path.join(repoRoot, "cli", "ai-workflow.mjs"),
      "shell",
      "epic?",
      "--no-ai"
    ], { cwd: projectRoot });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /There is no active epic yet\./);
    assert.match(result.stdout, /ai-workflow project epic list/);
    assert.doesNotMatch(result.stdout, /Unexpected AI call/);
    assert.doesNotMatch(result.stderr, /\[progress\]/);
  } finally {
    await cleanup(projectRoot);
  }
});

test("shell handles an incomplete epic request locally without calling the AI planner", async () => {
  const projectRoot = await makeTempDir();
  const preloadPath = path.join(projectRoot, "shell-preload.mjs");

  try {
    await mkdir(path.join(projectRoot, ".ai-workflow"), { recursive: true });
    await writeFile(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ name: "shell-doctor-test", type: "module" }, null, 2),
      "utf8"
    );
    await writeFile(
      path.join(projectRoot, ".ai-workflow", "config.json"),
      JSON.stringify({
        providers: {
          ollama: {
            host: "http://127.0.0.1:11434"
          }
        }
      }, null, 2),
      "utf8"
    );
    await writeFile(
      preloadPath,
      [
        "globalThis.fetch = async (url, init) => {",
        "  const text = String(url);",
        "  if (text.endsWith('/api/tags')) {",
        "    return {",
        "      ok: true,",
        "      async json() {",
        "        return { models: [{ name: 'qwen2.5-coder:7b', size: 7 * 1024 ** 3 }] };",
        "      }",
        "    };",
        "  }",
        "  if (text.endsWith('/api/generate') || text.endsWith('/api/chat') || text.includes('generativelanguage.googleapis.com') || text.includes('api.openai.com')) {",
        "    throw new Error(`Unexpected AI call: ${text}`);",
        "  }",
        "  throw new Error(`Unexpected fetch URL: ${text}`);",
        "};"
      ].join("\n"),
      "utf8"
    );

    const result = await runNode([
      "--import",
      preloadPath,
      path.join(repoRoot, "cli", "ai-workflow.mjs"),
      "shell",
      "can you write an epic?"
    ], { cwd: projectRoot });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Give me the epic topic/i);
    assert.match(result.stdout, /create epic for <topic>/i);
    assert.doesNotMatch(result.stdout, /Unexpected AI call/);
    assert.doesNotMatch(result.stderr, /\[progress\]/);
  } finally {
    await cleanup(projectRoot);
  }
});

test("shell handles doctor help locally without calling the AI planner", async () => {
  const projectRoot = await makeTempDir();
  const preloadPath = path.join(projectRoot, "shell-preload.mjs");

  try {
    await mkdir(path.join(projectRoot, ".ai-workflow"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ".ai-workflow", "config.json"),
      JSON.stringify({
        providers: {
          ollama: {
            host: "http://127.0.0.1:11434"
          }
        }
      }, null, 2),
      "utf8"
    );
    await writeFile(
      preloadPath,
      [
        "globalThis.fetch = async (url, init) => {",
        "  const text = String(url);",
        "  if (text.endsWith('/api/tags')) {",
        "    return {",
        "      ok: true,",
        "      async json() {",
        "        return { models: [{ name: 'qwen2.5-coder:7b', size: 7 * 1024 ** 3 }] };",
        "      }",
        "    };",
        "  }",
        "  if (text.endsWith('/api/generate') || text.endsWith('/api/chat') || text.includes('generativelanguage.googleapis.com') || text.includes('api.openai.com')) {",
        "    throw new Error(`Unexpected AI call: ${text}`);",
        "  }",
        "  throw new Error(`Unexpected fetch URL: ${text}`);",
        "};"
      ].join("\n"),
      "utf8"
    );

    const result = await runNode([
      "--import",
      preloadPath,
      path.join(repoRoot, "cli", "ai-workflow.mjs"),
      "shell",
      "doctor help"
    ], { cwd: projectRoot });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /doctor: run local diagnostics/i);
    assert.match(result.stdout, /Usage: `doctor`/);
    assert.doesNotMatch(result.stdout, /Unexpected AI call/);
    assert.doesNotMatch(result.stderr, /\[progress\]/);
  } finally {
    await cleanup(projectRoot);
  }
});

test("one-shot shell handles doctor locally without calling the AI planner", async () => {
  const projectRoot = await makeTempDir();
  const preloadPath = path.join(projectRoot, "shell-preload.mjs");

  try {
    await mkdir(path.join(projectRoot, ".ai-workflow"), { recursive: true });
    await writeFile(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ name: "shell-doctor-test", type: "module" }, null, 2),
      "utf8"
    );
    await writeFile(
      path.join(projectRoot, ".ai-workflow", "config.json"),
      JSON.stringify({
        providers: {
          ollama: {
            host: "http://127.0.0.1:11434"
          }
        }
      }, null, 2),
      "utf8"
    );
    await writeFile(
      preloadPath,
      [
        "globalThis.fetch = async (url, init) => {",
        "  const text = String(url);",
        "  if (text.endsWith('/api/tags')) {",
        "    return {",
        "      ok: true,",
        "      async json() {",
        "        return { models: [{ name: 'gemma4:e4b', size: Math.round(8.9 * 1024 ** 3) }] };",
        "      }",
        "    };",
        "  }",
        "  if (text.endsWith('/api/generate') || text.endsWith('/api/chat') || text.includes('generativelanguage.googleapis.com') || text.includes('api.openai.com')) {",
        "    throw new Error(`Unexpected AI call: ${text}`);",
        "  }",
        "  throw new Error(`Unexpected fetch URL: ${text}`);",
        "};"
      ].join("\n"),
      "utf8"
    );

    const result = await runNode([
      "--import",
      preloadPath,
      path.join(repoRoot, "cli", "ai-workflow.mjs"),
      "shell",
      "doctor"
    ], { cwd: projectRoot });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /cwd:/i);
    assert.match(result.stdout, /ollama:/i);
    assert.doesNotMatch(result.stdout, /Unexpected AI call/);
    assert.doesNotMatch(result.stderr, /\[progress\]/);
  } finally {
    await cleanup(projectRoot);
  }
});

test("one-shot shell handles project-status questions locally without planner fetches", async () => {
  const projectRoot = await createShellFixtureProject();
  const preloadPath = path.join(projectRoot, "shell-status-preload.mjs");

  try {
    await writeFile(
      preloadPath,
      [
        "globalThis.fetch = async (url, init) => {",
        "  throw new Error(`Unexpected fetch URL: ${String(url)}`);",
        "};"
      ].join("\n"),
      "utf8"
    );

    const result = await runNode([
      "--import",
      preloadPath,
      path.join(repoRoot, "cli", "ai-workflow.mjs"),
      "shell",
      "what's the project's status?"
    ], { cwd: projectRoot });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /You are in `/);
    assert.match(result.stdout, /Indexed state:/);
    assert.doesNotMatch(result.stdout, /Unexpected fetch URL/);
    assert.doesNotMatch(result.stderr, /\[progress\]/);
  } finally {
    await cleanup(projectRoot);
  }
});

test("one-shot AI shell requests report non-interactive progress and selected model", async () => {
  const projectRoot = await makeTempDir();
  const preloadPath = path.join(projectRoot, "shell-ai-preload.mjs");

  try {
    await writeFile(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ name: "shell-ai-progress-test", type: "module" }, null, 2),
      "utf8"
    );
    await mkdir(path.join(projectRoot, ".ai-workflow"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ".ai-workflow", "config.json"),
      JSON.stringify({
        providers: {
          ollama: {
            host: "http://127.0.0.1:11434"
          }
        }
      }, null, 2),
      "utf8"
    );
    await writeFile(
      preloadPath,
      [
        "const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));",
        "globalThis.fetch = async (url, init) => {",
        "  const text = String(url);",
        "  if (text.includes('duckduckgo')) {",
        "    return { ok: true, async text() { return '<html><body></body></html>'; } };",
        "  }",
        "  if (text.endsWith('/api/tags')) {",
        "    return {",
        "      ok: true,",
        "      async json() {",
        "        return { models: [{ name: 'qwen2.5-coder:7b', size: Math.round(4.4 * 1024 ** 3) }] };",
        "      }",
        "    };",
        "  }",
        "  if (text.endsWith('/api/generate')) {",
        "    await sleep(50);",
        "    return {",
        "      ok: true,",
        "      async json() {",
        "        return { response: JSON.stringify({ kind: 'reply', confidence: 0.93, reason: 'AI planning test', reply: 'Operator brief: focus on the shell progress path first.' }) };",
        "      }",
        "    };",
        "  }",
        "  throw new Error(`Unexpected fetch URL: ${text}`);",
        "};"
      ].join("\n"),
      "utf8"
    );

    const result = await runNode([
      "--import",
      preloadPath,
      path.join(repoRoot, "cli", "ai-workflow.mjs"),
      "shell",
      "Give me a concise operator brief grounded in the current workflow state, and justify the recommendation.",
      "--json",
      "--trace"
    ], { cwd: projectRoot });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.plan.kind, "reply");
    assert.match(result.stderr, /\[progress\] refreshing providers/);
    assert.match(result.stderr, /\[progress\] planning and running -> ollama:qwen2\.5-coder:7b @ http:\/\/127\.0\.0\.1:11434/);
    assert.match(result.stderr, /\[trace\] planner request -> ollama:qwen2\.5-coder:7b @ http:\/\/127\.0\.0\.1:11434/);

    const metricsResult = await runNode([
      path.join(repoRoot, "cli", "ai-workflow.mjs"),
      "metrics",
      "--json"
    ], { cwd: projectRoot });
    assert.equal(metricsResult.code, 0, metricsResult.stderr || metricsResult.stdout);
    const metrics = JSON.parse(metricsResult.stdout);
    assert.equal(metrics.totalCalls, 1);
    assert.equal(metrics.windows.latestSession.calls, 1);
    assert.equal(metrics.windows.latestSession.localCalls, 1);
    assert.equal(metrics.windows.latestSession.quality.successRate, 100);
  } finally {
    await cleanup(projectRoot);
  }
});

test("one-shot AI shell falls back cleanly after a bounded Ollama timeout", async () => {
  const projectRoot = await makeTempDir();
  const preloadPath = path.join(projectRoot, "shell-timeout-preload.mjs");

  try {
    await writeFile(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ name: "shell-timeout-test", type: "module" }, null, 2),
      "utf8"
    );
    await mkdir(path.join(projectRoot, ".ai-workflow"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ".ai-workflow", "config.json"),
      JSON.stringify({
        providers: {
          ollama: {
            host: "http://127.0.0.1:11434"
          }
        }
      }, null, 2),
      "utf8"
    );
    await writeFile(
      preloadPath,
      [
        "const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));",
        "globalThis.fetch = async (url, init) => {",
        "  const text = String(url);",
        "  if (text.includes('duckduckgo')) {",
        "    return { ok: true, async text() { return '<html><body></body></html>'; } };",
        "  }",
        "  if (text.endsWith('/api/tags')) {",
        "    return {",
        "      ok: true,",
        "      async json() {",
        "        return { models: [{ name: 'hermes3:8b', size: Math.round(4.3 * 1024 ** 3) }, { name: 'qwen2.5-coder:7b', size: Math.round(4.4 * 1024 ** 3) }] };",
        "      }",
        "    };",
        "  }",
        "  if (text.endsWith('/api/generate')) {",
        "    await new Promise((resolve, reject) => {",
        "      const timer = setTimeout(resolve, 100);",
        "      if (init?.signal) {",
        "        init.signal.addEventListener('abort', () => {",
        "          clearTimeout(timer);",
        "          reject(init.signal.reason ?? new Error('aborted'));",
        "        }, { once: true });",
        "      }",
        "    });",
        "    return { ok: true, async json() { return { response: JSON.stringify({ kind: 'reply', confidence: 0.9, reason: 'late', reply: 'late reply' }) }; } };",
        "  }",
        "  throw new Error(`Unexpected fetch URL: ${text}`);",
        "};"
      ].join("\n"),
      "utf8"
    );

    const result = await runNode([
      path.join(repoRoot, "cli", "ai-workflow.mjs"),
      "shell",
      "fix it",
      "--json",
      "--trace"
    ], {
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_OPTIONS: `--import=${preloadPath}`,
        AI_WORKFLOW_SHELL_PLANNER_TIMEOUT_MS: "25"
      }
    });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.plan.planner.mode, "ai-fallback-to-heuristic");
    assert.match(result.stderr, /planner timed out after 25ms/);
    assert.equal((result.stderr.match(/\[trace\] planner request ->/g) ?? []).length, 1);

    const metricsResult = await runNode([
      path.join(repoRoot, "cli", "ai-workflow.mjs"),
      "metrics",
      "--json"
    ], { cwd: projectRoot });
    assert.equal(metricsResult.code, 0, metricsResult.stderr || metricsResult.stdout);
    const metrics = JSON.parse(metricsResult.stdout);
    assert.equal(metrics.totalCalls, 1);
    assert.equal(metrics.windows.latestSession.calls, 1);
    assert.equal(metrics.windows.latestSession.localCalls, 1);
    assert.equal(metrics.windows.latestSession.quality.successRate, 0);
  } finally {
    await cleanup(projectRoot);
  }
});

test("ask command routes current-work questions without the tutorial server wrapper", async () => {
  const evidenceRoot = await createShellFixtureProject();
  const sync = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "sync", "--json"], { cwd: evidenceRoot });
  assert.equal(sync.code, 0, sync.stderr || sync.stdout);

  try {
    const result = await runNode([
      path.join(repoRoot, "cli", "ai-workflow.mjs"),
      "ask",
      "--mode",
      "tool-dev",
      "--evidence-root",
      evidenceRoot,
      "What are we working on right now?",
      "--json"
    ], { cwd: repoRoot });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.route.operation, "project_summary");
    assert.equal(payload.route.intent, "current_work");
    assert.equal(payload.response_type, "summary");
    assert.match(payload.payload.answer, /REF-APP-SHELL-01/);
  } finally {
    await cleanup(evidenceRoot);
  }
});

test("non-interactive shell reports configured Ollama registry without prompting for Ollama hardware", async () => {
  const targetRoot = await createShellFixtureProject();
  try {
    await mkdir(path.join(targetRoot, ".ai-workflow"), { recursive: true });
    await writeFile(path.join(targetRoot, ".ai-workflow", "config.json"), JSON.stringify({
      providers: {
        ollama: {
          host: "http://127.0.0.1:65535",
          models: [
            { id: "hermes3:8b" },
            { id: "qwen2.5-coder:7b" }
          ]
        }
      }
    }, null, 2), "utf8");

    const child = spawn(process.execPath, [
      path.join(repoRoot, "cli", "ai-workflow.mjs"),
      "shell",
      "--no-ai"
    ], {
      cwd: targetRoot,
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
    assert.match(stdout, /- ollama: unavailable, host http:\/\/127\.0\.0\.1:65535, 2 models/);
  } finally {
    await cleanup(targetRoot);
  }
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

test("one-shot shell in no-ai mode reports heuristic planning for workplan prompts", async () => {
  const targetRoot = await createShellFixtureProject();

  try {
    const result = await runNode([
      path.join(repoRoot, "cli", "ai-workflow.mjs"),
      "shell",
      "what's next on the workplan?",
      "--no-ai"
    ], { cwd: targetRoot });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Start with REF-APP-SHELL-01/i);
    assert.match(result.stderr, /\[progress\] planning and running -> heuristic-forced/i);
    assert.doesNotMatch(result.stderr, /\[progress\] planning and running -> (google|openai|ollama):/i);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("one-shot shell in no-ai mode keeps Telegram kickoff prompts on safe discovery", async () => {
  const result = await runNode([
    path.join(repoRoot, "cli", "ai-workflow.mjs"),
    "shell",
    "on a new branch, start working on the Telegram epic and tickets in the right order",
    "--no-ai"
  ], { cwd: repoRoot });

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /First inspect the telegram surface/i);
  assert.match(result.stdout, /Suggested ticket order:/i);
  assert.doesNotMatch(result.stdout, /No status target matched/i);
  assert.match(result.stderr, /\[progress\] planning and running -> heuristic-forced/i);
  assert.doesNotMatch(result.stderr, /\[progress\] planning and running -> (google|openai|ollama):/i);
});

test("one-shot shell can answer current-work questions with related artifacts", async () => {
  const targetRoot = await createShellFixtureProject();

  try {
    const result = await runNode([
      path.join(repoRoot, "cli", "ai-workflow.mjs"),
      "shell",
      "--no-ai",
      "tell me what we're working on right now and what should we do about it. which artifacts relates to it."
    ], { cwd: targetRoot });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /REF-APP-SHELL-01/);
    assert.match(result.stdout, /Files: .*modal\.riot.*modal\.e2e\.spec\.ts/i);
    assert.match(result.stdout, /Review focus/i);
    assert.doesNotMatch(result.stdout, /Action failed|AI recovery|couldn't map it to CLI actions/i);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("one-shot shell can answer in-progress questions from docs kanban without failure chatter", async () => {
  const targetRoot = await createShellFixtureProject();

  try {
    const result = await runNode([
      path.join(repoRoot, "cli", "ai-workflow.mjs"),
      "shell",
      "--no-ai",
      "what's in-progress?"
    ], { cwd: targetRoot });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /REF-APP-SHELL-01/);
    assert.doesNotMatch(result.stdout, /Action failed|AI recovery|couldn't map it to CLI actions/i);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("one-shot shell can explain the current ticket with artifacts instead of emitting a strategy error", async () => {
  const targetRoot = await createShellFixtureProject();

  try {
    const result = await runNode([
      path.join(repoRoot, "cli", "ai-workflow.mjs"),
      "shell",
      "--no-ai",
      "explain ticket. which artifacts it relates to and what functionality exactly."
    ], { cwd: targetRoot });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Ticket: REF-APP-SHELL-01/i);
    assert.match(result.stdout, /Files: .*modal\.riot.*modal\.e2e\.spec\.ts/i);
    assert.match(result.stdout, /Resume prompt/i);
    assert.doesNotMatch(result.stdout, /Action failed|AI recovery|couldn't map it to CLI actions/i);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("one-shot shell handles complex goal-driven ticket requests as staged planning instead of shallow status", async () => {
  const targetRoot = await createShellFixtureProject();

  try {
    await writeFile(
      path.join(targetRoot, "docs", "kanban.md"),
      [
        "# Kanban",
        "",
        "## In Progress",
        "- [ ] **REF-APP-SHELL-01**: Continue app-shell and modal-surface refactor hardening after review findings.",
        "",
        "## Todo",
        "- [ ] **BETA-STAB-01**: Stabilize beta-critical invite, auth, feedback, quota, and core UX flows without adding features.",
        "- [ ] **ADMIN-METRICS-01**: Replace estimated AI spend with real usage metrics and a detailed metrics screen."
      ].join("\n"),
      "utf8"
    );

    const result = await runNode([
      path.join(repoRoot, "cli", "ai-workflow.mjs"),
      "shell",
      "--no-ai",
      "resolve the in-progress ticket, prioritize the rest of the tickets according to the goal, which is preparing the system to a non-embaracing beta-testing and resolve what is needed to achieve that goal"
    ], { cwd: targetRoot });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /I treated this as a staged request/i);
    assert.match(result.stdout, /Ticket: REF-APP-SHELL-01/i);
    assert.match(result.stdout, /Apply: no/i);
    assert.match(result.stdout, /Suggested remaining priorities: BETA-STAB-01/i);
    assert.doesNotMatch(result.stdout, /^Tickets currently in progress:/m);
    assert.doesNotMatch(result.stdout, /Action failed|AI recovery|couldn't map it to CLI actions/i);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("one-shot shell combines project status and readiness into a conversational answer without protocol leakage", async () => {
  const targetRoot = await createShellFixtureProject();

  try {
    const result = await runNode([
      path.join(repoRoot, "cli", "ai-workflow.mjs"),
      "shell",
      "--no-ai",
      "what's the project status? how ready is it for beta test?"
    ], { cwd: targetRoot });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Project status:/);
    assert.match(result.stdout, /Beta readiness:/);
    assert.doesNotMatch(result.stdout, /Status: complete/);
    assert.doesNotMatch(result.stdout, /Not ready for beta readiness/i);
    assert.doesNotMatch(result.stdout, /Evidence basis:/);
    assert.doesNotMatch(result.stdout, /Action failed|AI recovery|assert node/i);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("project status command reports shell surface evidence and linked tests", async () => {
  const syncResult = await runNode([path.join(repoRoot, "cli", "ai-workflow.mjs"), "sync", "--json"], { cwd: repoRoot });
  assert.equal(syncResult.code, 0, syncResult.stderr || syncResult.stdout);

  const result = await runNode([
    path.join(repoRoot, "cli", "ai-workflow.mjs"),
    "project",
    "status",
    "shell",
    "--json"
  ], { cwd: repoRoot });

  assert.equal(result.code, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.id, "surface:shell");
  assert.equal(payload.type, "surface");
  assert.equal(Array.isArray(payload.related), true);
  assert.equal(Array.isArray(payload.tests), true);
  assert.equal(payload.related.some((item) => item.id === "file:cli/lib/shell.mjs"), true);
  assert.equal(payload.tests.some((item) => /dogfood shell|tests\/shell/.test(item.title)), true);
});

test("generated helper scripts work against initialized project state", async () => {
  const targetRoot = await makeTempDir();

  try {
    await writeFile(path.join(targetRoot, "package.json"), "{\n  \"name\": \"fixture\"\n}\n");
    const initResult = await runNode(["scripts/init-project.mjs", "--target", targetRoot]);
    assert.equal(initResult.code, 0);
    assert.match(initResult.stdout, /package\.json found/);
    assert.match(initResult.stdout, /Package scripts installed: 8/);

    const workflowAuditInitial = await runNode(["scripts/ai-workflow/workflow-audit.mjs"], { cwd: targetRoot });
    assert.equal(workflowAuditInitial.code, 0);
    assert.match(workflowAuditInitial.stdout, /workflow-audit: OK/);
    await access(path.join(targetRoot, ".ai-workflow", "generated", "dogfood-report.json"));

    const ticketResult = await runNode(
      ["scripts/ai-workflow/kanban-ticket.mjs", "--id", "TKT-001"],
      { cwd: targetRoot }
    );
    assert.equal(ticketResult.code, 0);
    assert.match(ticketResult.stdout, /TKT-001 \| Backlog \| Replace this example ticket/);

    await runGit(targetRoot, ["init", "-q"]);
    await runGit(targetRoot, ["add", "."]);
    await runGit(targetRoot, ["-c", "user.name=Workflow", "-c", "user.email=workflow@example.com", "commit", "-qm", "init"]);

    const knowledgePath = path.join(targetRoot, "knowledge.md");
    const knowledgeTemplate = await readFile(knowledgePath, "utf8");
    await writeFile(knowledgePath, knowledgeTemplate.replace("## Facts\n\n- ", "## Facts\n\n- smoke fact"), "utf8");
    await mkdir(path.join(targetRoot, "src"), { recursive: true });
    await writeFile(path.join(targetRoot, "src", "app.ts"), "export const value = 1;\n", "utf8");

    const guidanceResult = await runNode(
      ["scripts/ai-workflow/guidance-summary.mjs", "--ticket", "TKT-001", "--changed"],
      { cwd: targetRoot }
    );
    assert.equal(guidanceResult.code, 0);
    assert.match(guidanceResult.stdout, /Files: knowledge\.md, src\/app\.ts/);
    assert.match(guidanceResult.stdout, /Contributing/);
    assert.match(guidanceResult.stdout, /Execution Protocol/);
    assert.match(guidanceResult.stdout, /Enforcement/);

    const reviewResult = await runNode(["scripts/ai-workflow/review-summary.mjs"], { cwd: targetRoot });
    assert.equal(reviewResult.code, 0);
    assert.match(reviewResult.stdout, /\[modified\] knowledge\.md/);
    assert.match(reviewResult.stdout, /\[untracked\] src\/app\.ts/);
    assert.match(reviewResult.stdout, /source changed without matching test-file changes/);

    const verifyResult = await runNode(
      ["scripts/ai-workflow/verification-summary.mjs", "--cmd", "node -e \"console.log('ok')\""],
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

    const guidelineAuditFail = await runNode(["scripts/ai-workflow/guideline-audit.mjs"], { cwd: targetRoot });
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
    assert.equal(packageJsonOverwritten.scripts["workflow:audit"], "node scripts/ai-workflow/workflow-audit.mjs");
  } finally {
    await cleanup(targetRoot);
  }
});

test("dogfood report is regenerated through the runtime script and audit fails when the report is missing or stale", async () => {
  const targetRoot = await makeTempDir();

  try {
    await writeFile(path.join(targetRoot, "package.json"), "{\n  \"name\": \"fixture\"\n}\n");
    const initResult = await runNode(["scripts/init-project.mjs", "--target", targetRoot]);
    assert.equal(initResult.code, 0, initResult.stderr || initResult.stdout);

    const reportPath = path.join(targetRoot, ".ai-workflow", "generated", "dogfood-report.json");
    const initialReport = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(initialReport.profile, "bootstrap");
    assert.equal(initialReport.surfaces.shell.status, "pass");
    assert.equal(initialReport.surfaces.init.status, "pass");

    await rm(reportPath, { force: true });
    const missingAudit = await runNode(["scripts/ai-workflow/workflow-audit.mjs", "--json"], { cwd: targetRoot });
    assert.equal(missingAudit.code, 1);
    const missingSummary = JSON.parse(missingAudit.stdout);
    assert.equal(
      missingSummary.findings.some((finding) => String(finding.message).includes("missing dogfood report")),
      true
    );

    const dogfoodResult = await runNode(
      ["scripts/ai-workflow/dogfood.mjs", "--surface", "shell,provider,workflow,init", "--profile", "bootstrap", "--json"],
      { cwd: targetRoot }
    );
    assert.equal(dogfoodResult.code, 0, dogfoodResult.stderr || dogfoodResult.stdout);

    const scriptPath = path.join(targetRoot, "scripts", "ai-workflow", "workflow-audit.mjs");
    const currentAuditScript = await readFile(scriptPath, "utf8");
    await writeFile(scriptPath, `${currentAuditScript}\n// stale dogfood check\n`, "utf8");

    const staleAudit = await runNode(["scripts/ai-workflow/workflow-audit.mjs", "--json"], { cwd: targetRoot });
    assert.equal(staleAudit.code, 1);
    const staleSummary = JSON.parse(staleAudit.stdout);
    assert.equal(
      staleSummary.findings.some((finding) => String(finding.message).includes("dogfood report is stale")),
      true
    );
  } finally {
    await cleanup(targetRoot);
  }
});

test("dogfood full shell profile uses the local Ollama path for the soft shell scenario", async () => {
  const targetRoot = await createShellFixtureProject();
  const preloadPath = path.join(targetRoot, "dogfood-ollama-preload.mjs");

  try {
    await mkdir(path.join(targetRoot, ".ai-workflow"), { recursive: true });
    await writeFile(
      path.join(targetRoot, ".ai-workflow", "config.json"),
      JSON.stringify({
        providers: {
          ollama: {
            host: "http://127.0.0.1:11434"
          }
        }
      }, null, 2),
      "utf8"
    );
    await writeFile(
      preloadPath,
      [
        "globalThis.fetch = async (url, init) => {",
        "  const text = String(url);",
        "  if (text.includes('duckduckgo')) {",
        "    return { ok: true, async text() { return '<html><body></body></html>'; } };",
        "  }",
        "  if (text.endsWith('/api/tags')) {",
        "    return {",
        "      ok: true,",
        "      async json() {",
        "        return { models: [{ name: 'hermes3:8b', size: Math.round(4.3 * 1024 ** 3) }] };",
        "      }",
        "    };",
        "  }",
        "  if (text.endsWith('/api/generate')) {",
        "    const body = JSON.parse(init?.body ?? '{}');",
        "    return {",
        "      ok: true,",
        "      async json() {",
        "        if (String(body.system ?? '').includes('strict artifact judge') || String(body.system ?? '').includes('strict shell transcript judge') || String(body.prompt ?? '').includes('Judge the supplied shell transcripts')) {",
        "          return { response: JSON.stringify({ status: 'pass', score: 93, confidence: 0.97, summary: 'Transcript satisfies the rubric.', findings: ['Grounded operator-facing answer'], recommendations: [], artifacts: [{ path: 'scenario.txt', status: 'pass', score: 93, findings: ['Transcript stayed grounded'] }], needs_human_review: false }) };",
        "        }",
        "        return { response: JSON.stringify({ kind: 'reply', confidence: 0.94, reason: 'soft dogfood', reply: 'Operator brief: keep shell checks local-first.' }) };",
        "      }",
        "    };",
        "  }",
        "  throw new Error(`Unexpected fetch URL: ${text}`);",
        "};"
      ].join("\n"),
      "utf8"
    );

    const result = await runNode([
      "runtime/scripts/ai-workflow/dogfood.mjs",
      "--root",
      targetRoot,
      "--surface",
      "shell",
      "--profile",
      "full",
      "--json"
    ], {
      cwd: repoRoot,
      env: {
        ...process.env,
        NODE_OPTIONS: `--import=${preloadPath}`
      }
    });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    const scenario = report.surfaces.shell.scenarios.find((item) => item.id === "ai-planning-read");
    assert.equal(scenario.code, 0);
    assert.equal(scenario.timedOut, false);
    assert.equal(scenario.model, "ollama:hermes3:8b @ http://127.0.0.1:11434");
    assert.equal(scenario.semanticJudgment?.status, "pass");
  } finally {
    await cleanup(targetRoot);
  }
});
