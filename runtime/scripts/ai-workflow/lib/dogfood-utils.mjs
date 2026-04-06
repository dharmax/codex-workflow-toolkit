import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { ensureDir, readText } from "./fs-utils.mjs";
import { getToolkitRoot } from "./toolkit-root.mjs";
import { collectOperatorSurfaceState, listOperatorSurfaceIds } from "./operator-surfaces.mjs";

export const DEFAULT_DOGFOOD_REPORT_PATH = ".ai-workflow/generated/dogfood-report.json";

export async function runDogfood({
  root = process.cwd(),
  surfaces = listOperatorSurfaceIds(),
  profile = "full",
  toolkitRoot = getToolkitRoot(),
  timeoutMs = 45000,
  writeReport = true
} = {}) {
  const normalizedRoot = path.resolve(root);
  const requestedSurfaces = dedupeSurfaceIds(surfaces);
  const cliPath = path.resolve(toolkitRoot, "cli", "ai-workflow.mjs");
  const startedAt = new Date().toISOString();
  const surfaceSnapshots = await collectOperatorSurfaceState(normalizedRoot, requestedSurfaces);
  const report = {
    version: 1,
    generatedAt: startedAt,
    root: normalizedRoot,
    toolkitRoot,
    profile,
    timeoutMs,
    surfaces: {}
  };

  for (const surfaceId of requestedSurfaces) {
    const snapshot = surfaceSnapshots[surfaceId] ?? { fileCount: 0, files: [], fileHashes: {} };
    const scenarios = await runSurfaceScenarios({
      surfaceId,
      profile,
      root: normalizedRoot,
      toolkitRoot,
      cliPath,
      timeoutMs
    });
    const passed = scenarios.every((scenario) => scenario.ok);

    report.surfaces[surfaceId] = {
      description: snapshot.description ?? null,
      fileCount: snapshot.fileCount ?? 0,
      files: snapshot.files ?? [],
      fileHashes: snapshot.fileHashes ?? {},
      scenarioCount: scenarios.length,
      status: passed ? "pass" : "fail",
      scenarios
    };
  }

  if (writeReport) {
    const reportPath = path.resolve(normalizedRoot, DEFAULT_DOGFOOD_REPORT_PATH);
    await ensureDir(path.dirname(reportPath));
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  return report;
}

export async function readDogfoodReport(root = process.cwd()) {
  const reportPath = path.resolve(root, DEFAULT_DOGFOOD_REPORT_PATH);
  const raw = await readText(reportPath, "");
  if (!raw.trim()) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function dedupeSurfaceIds(surfaceIds) {
  return Array.from(new Set((surfaceIds ?? []).map((value) => String(value).trim()).filter(Boolean)));
}

async function runSurfaceScenarios({ surfaceId, profile, root, toolkitRoot, cliPath, timeoutMs }) {
  switch (surfaceId) {
    case "shell":
      return buildShellScenarios({ profile, cliPath, root, timeoutMs });
    case "provider":
      return buildProviderScenarios({ cliPath, root, timeoutMs });
    case "workflow":
      return buildWorkflowScenarios({ cliPath, root, timeoutMs });
    case "init":
      if (profile === "bootstrap") {
        return [];
      }
      return buildInitScenarios({ cliPath, root, timeoutMs, toolkitRoot });
    default:
      return [];
  }
}

async function buildShellScenarios({ profile, cliPath, root, timeoutMs }) {
  const scenarios = [
    await runCliScenario({
      id: "doctor-command",
      description: "shell handles `doctor` locally",
      cwd: root,
      timeoutMs,
      cliPath,
      args: ["shell", "doctor", "--json", "--no-ai"]
    }),
    await runCliScenario({
      id: "doctor-help-command",
      description: "shell handles `doctor help` locally",
      cwd: root,
      timeoutMs,
      cliPath,
      args: ["shell", "doctor help", "--json", "--no-ai"]
    }),
    await runCliScenario({
      id: "incomplete-epic-request",
      description: "shell asks for the missing epic topic without AI",
      cwd: root,
      timeoutMs,
      cliPath,
      args: ["shell", "can you write an epic?", "--json", "--no-ai"]
    }),
    await runCliScenario({
      id: "epic-read-request",
      description: "shell answers `epic?` without AI",
      cwd: root,
      timeoutMs,
      cliPath,
      args: ["shell", "epic?", "--json", "--no-ai"]
    })
  ];

  if (profile !== "bootstrap") {
    scenarios.push(await runCliScenario({
      id: "ai-planning-read",
      description: "shell answers a planning question with trace enabled",
      cwd: root,
      timeoutMs,
      cliPath,
      args: ["shell", "Give me a concise operator brief grounded in the current workflow state, and justify the recommendation.", "--json", "--trace"]
    }));
  }

  return scenarios;
}

async function buildProviderScenarios({ cliPath, root, timeoutMs }) {
  return [
    await runCliScenario({
      id: "doctor-json",
      description: "doctor returns provider status",
      cwd: root,
      timeoutMs,
      cliPath,
      args: ["doctor", "--json"]
    }),
    await runCliScenario({
      id: "route-shell-planning",
      description: "route shell-planning returns the current planner chain",
      cwd: root,
      timeoutMs,
      cliPath,
      args: ["route", "shell-planning", "--json"]
    })
  ];
}

async function buildWorkflowScenarios({ cliPath, root, timeoutMs }) {
  return [
    await runCliScenario({
      id: "sync-json",
      description: "sync returns workflow summary",
      cwd: root,
      timeoutMs,
      cliPath,
      args: ["sync", "--json"]
    }),
    await runCliScenario({
      id: "project-summary-json",
      description: "project summary is available through the workflow CLI",
      cwd: root,
      timeoutMs,
      cliPath,
      args: ["project", "summary", "--json"]
    }),
    await runCliScenario({
      id: "guidelines-extract",
      description: "guideline extraction returns workflow-first guidance",
      cwd: root,
      timeoutMs,
      cliPath,
      args: ["extract", "guidelines", "dogfooding"]
    })
  ];
}

async function buildInitScenarios({ timeoutMs, toolkitRoot }) {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "ai-workflow-dogfood-init-"));
  const initScriptPath = path.resolve(toolkitRoot, "scripts", "init-project.mjs");
  const auditScriptPath = path.resolve(fixtureRoot, "scripts", "ai-workflow", "workflow-audit.mjs");
  try {
    const initResult = await runNodeProcess({
      cwd: toolkitRoot,
      timeoutMs,
      args: [initScriptPath, "--target", fixtureRoot]
    });
    const auditResult = initResult.code === 0
      ? await runNodeProcess({
          cwd: fixtureRoot,
          timeoutMs,
          args: [auditScriptPath, "--json"]
        })
      : {
          code: 1,
          stdout: "",
          stderr: "skipped workflow-audit because init failed",
          timedOut: false,
          durationMs: 0
        };

    return [
      buildScenarioResult({
        id: "init-project",
        description: "init installs workflow scaffolding and bootstrap dogfood report",
        command: `${process.execPath} ${initScriptPath} --target ${fixtureRoot}`,
        result: initResult
      }),
      buildScenarioResult({
        id: "init-audit",
        description: "initialized project passes workflow-audit immediately",
        command: `${process.execPath} ${auditScriptPath} --json`,
        result: auditResult
      })
    ];
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

async function runCliScenario({ id, description, cwd, timeoutMs, cliPath, args }) {
  const result = await runNodeProcess({
    cwd,
    timeoutMs,
    args: [cliPath, ...args]
  });
  return buildScenarioResult({
    id,
    description,
    command: `${process.execPath} ${cliPath} ${args.map(shellQuote).join(" ")}`,
    result
  });
}

function buildScenarioResult({ id, description, command, result }) {
  const model = extractModelTrace(result.stdout, result.stderr);
  const progressLines = extractProgressLines(result.stdout, result.stderr);
  const validation = validateScenarioResult({ id, result, model, progressLines });
  return {
    id,
    description,
    command,
    ok: validation.ok,
    code: result.code,
    timedOut: Boolean(result.timedOut),
    durationMs: result.durationMs,
    model,
    progressLines,
    stdout: truncateText(result.stdout),
    stderr: truncateText(validation.message ? `${result.stderr}\n${validation.message}`.trim() : result.stderr)
  };
}

function extractModelTrace(stdout, stderr) {
  const combined = `${stdout ?? ""}\n${stderr ?? ""}`;
  const match = combined.match(/\[trace\][^\n]*->\s*([^\n]+)/i);
  return match ? match[1].trim() : null;
}

function extractProgressLines(stdout, stderr) {
  const combined = `${stdout ?? ""}\n${stderr ?? ""}`;
  return combined
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("[progress] "));
}

function validateScenarioResult({ id, result, model, progressLines }) {
  if ([
    "doctor-command",
    "doctor-help-command",
    "incomplete-epic-request",
    "epic-read-request"
  ].includes(id)) {
    if (progressLines.length) {
      return { ok: false, message: "local shell scenario unexpectedly emitted planner progress output" };
    }
    if (model) {
      return { ok: false, message: "local shell scenario unexpectedly emitted an AI model trace" };
    }
  }
  if (id === "ai-planning-read") {
    if (!progressLines.length) {
      return { ok: false, message: "missing non-interactive shell progress output" };
    }
    if (!model) {
      return { ok: false, message: "missing AI model trace for live shell planning" };
    }
    if (result.code === 124 && result.timedOut) {
      return { ok: true, message: "live shell planning timed out, but progress and selected-model trace were surfaced" };
    }
  }
  if (result.code !== 0) {
    return { ok: false, message: "scenario process exited with a non-zero code" };
  }
  return { ok: true, message: "" };
}

function truncateText(value, maxLength = 1600) {
  const text = String(value ?? "");
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}\n... [truncated]`;
}

function shellQuote(value) {
  return JSON.stringify(String(value));
}

async function runNodeProcess({ cwd, args, timeoutMs }) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, args, {
      cwd,
      env: {
        ...process.env,
        FORCE_COLOR: "0"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const finish = (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        code: timedOut ? 124 : (code ?? 1),
        stdout,
        stderr,
        timedOut,
        durationMs: Date.now() - startedAt
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      stderr += error.message;
      finish(1);
    });
    child.on("close", (code) => {
      finish(code);
    });
  });
}
