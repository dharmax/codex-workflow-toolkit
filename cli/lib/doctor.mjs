import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getGlobalConfigPath, getProjectConfigPath, readConfigSafe } from "./config-store.mjs";
import { discoverProviderState, probeOllama, resolveOllamaConfig } from "../../core/services/providers.mjs";
import { applyModelFitMatrix, buildModelFitMatrix } from "../../core/services/model-fit.mjs";
import { leanCtxInstallHint, leanCtxSetupHint, probeLeanCtx } from "../../core/services/lean-ctx.mjs";
import { buildPackageUpdateAdvisory } from "../../core/services/package-updates.mjs";

const execFileAsync = promisify(execFile);

export async function runDoctor({ root = process.cwd(), json = false, forceRefresh = false } = {}) {
  const report = await buildDoctorReport({ root, forceRefresh });
  const rendered = json
    ? `${JSON.stringify(report, null, 2)}\n`
    : `${renderDoctorReport(report)}\n`;

  process.stdout.write(rendered);
  return report;
}

export async function buildDoctorReport({ root = process.cwd(), forceRefresh = false } = {}) {
  const [projectConfigState, globalConfigState, providerState] = await Promise.all([
    readConfigSafe(getProjectConfigPath(root)),
    readConfigSafe(getGlobalConfigPath()),
    discoverProviderState({ root, forceRefresh })
  ]);
  const modelFitMatrix = await buildModelFitMatrix({
    root,
    providerState,
    taskClass: "shell-planning",
    allowRemoteEnrichment: false
  });
  const enrichedState = applyModelFitMatrix(providerState, modelFitMatrix);
  const leanCtx = await probeLeanCtx();
  const packageUpdates = await buildPackageUpdateAdvisory({ root, forceRefresh });
  const projectConfig = projectConfigState.config;
  const globalConfig = globalConfigState.config;
  const ollamaConfig = resolveOllamaConfig({ projectConfig, globalConfig });
  const git = await probeBinary("git", ["--version"]);

  const providers = {};
  for (const [id, p] of Object.entries(enrichedState.providers)) {
    providers[id] = {
      available: p.available,
      modelCount: p.models.length,
      local: p.local
    };
  }

  return {
    cwd: root,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    cpuCount: os.cpus().length,
    totalMemoryGb: Number((os.totalmem() / (1024 ** 3)).toFixed(2)),
    leanCtx,
    git: {
      installed: git.ok,
      details: git.output
    },
    providers,
    ollama: {
      installed: enrichedState.providers.ollama.available,
      host: enrichedState.providers.ollama.host,
      hardwareClass: ollamaConfig.hardwareClass ?? null,
      plannerModel: ollamaConfig.plannerModel ?? null,
      plannerMaxQuality: ollamaConfig.plannerMaxQuality ?? null,
      maxModelSizeB: ollamaConfig.maxModelSizeB ?? null,
      models: enrichedState.providers.ollama.models.map(m => ({
        id: m.id,
        quality: m.quality,
        capabilities: m.capabilities,
        fitScore: m.fitScore ?? null,
        fitReasons: m.fitReasons ?? []
      })),
      details: enrichedState.providers.ollama.details,
      bestModel: enrichedState.providers.ollama.models?.[0]?.id ?? null,
      bestReason: enrichedState.providers.ollama.models?.[0]?.fitReasons?.join("; ") ?? null
    },
    config: {
      projectPath: getProjectConfigPath(root),
      globalPath: getGlobalConfigPath(),
      warnings: [projectConfigState.warning, globalConfigState.warning].filter(Boolean),
      projectKeys: Object.keys(projectConfig),
      globalKeys: Object.keys(globalConfig)
    },
    packageUpdates: {
      generatedAt: packageUpdates.generatedAt,
      comment: packageUpdates.comment,
      packages: packageUpdates.packages
    }
  };
}

export function renderDoctorReport(report) {
  const lines = [
    `cwd: ${report.cwd}`,
    `platform: ${report.platform}/${report.arch}`,
    `node: ${report.node}`,
    `cpu: ${report.cpuCount} cores`,
    `memory: ${report.totalMemoryGb} GB`,
    `lean-ctx: ${report.leanCtx.installed ? "installed" : "missing"}`,
    `git: ${report.git.installed ? "installed" : "missing"}`
  ];

  if (report.leanCtx.path) {
    lines.push(`lean-ctx path: ${report.leanCtx.path}`);
  }

  if (!report.leanCtx.installed) {
    lines.push(`lean-ctx install hint: ${leanCtxInstallHint()}`);
    lines.push(`lean-ctx setup hint: ${leanCtxSetupHint()}`);
  }

  for (const [id, p] of Object.entries(report.providers)) {
    if (id === "ollama") continue;
    lines.push(`${id}: ${p.available ? "available" : "missing key/config"} (${p.modelCount} models)`);
  }

  lines.push(`ollama: ${report.ollama.installed ? "installed" : "missing"}`);

  if (report.ollama.host) {
    lines.push(`ollama host: ${report.ollama.host}`);
  }

  if (report.ollama.installed) {
    lines.push("ollama models:");
    for (const m of report.ollama.models) {
      const caps = Object.entries(m.capabilities ?? {})
        .filter(([_, score]) => score > 0)
        .map(([c, s]) => `${c.charAt(0)}:${s.toFixed(1)}`)
        .join(" ");
      const fit = typeof m.fitScore === "number" ? ` fit:${m.fitScore}` : "";
      lines.push(`- ${m.id} (${m.quality})${fit} [${caps}]`);
    }
  }
  if (report.ollama.bestModel) {
    lines.push(`ollama best model: ${report.ollama.bestModel}`);
    if (report.ollama.bestReason) {
      lines.push(`ollama best reason: ${report.ollama.bestReason}`);
    }
  }
  if (report.ollama.hardwareClass) {
    lines.push(`ollama hardware class: ${report.ollama.hardwareClass}`);
  }
  if (report.ollama.maxModelSizeB) {
    lines.push(`ollama max model size: ${report.ollama.maxModelSizeB}B`);
  }
  if (report.ollama.plannerMaxQuality) {
    lines.push(`ollama planner max quality: ${report.ollama.plannerMaxQuality}`);
  }
  if (report.ollama.plannerModel) {
    lines.push(`ollama planner override: ${report.ollama.plannerModel}`);
  }
  if (!report.ollama.hardwareClass && !report.ollama.maxModelSizeB && !report.ollama.plannerModel) {
    lines.push("ollama planner hint: missing hardware/planner config; shell will use the live model-fit matrix and default to a small model if needed");
  }

  lines.push("upgrade advisory:");
  for (const item of report.packageUpdates?.packages ?? []) {
    const current = item.currentVersion ?? "unknown";
    const latest = item.latestVersion ?? "unavailable";
    if (item.status === "current") {
      lines.push(`- ${item.name}: ${current} is current`);
    } else {
      lines.push(`- ${item.name}: current ${current}, latest ${latest}`);
    }
  }
  if (report.packageUpdates?.comment) {
    lines.push(report.packageUpdates.comment);
  }

  lines.push(`project config: ${report.config.projectPath}`);
  lines.push(`global config: ${report.config.globalPath}`);
  for (const warning of report.config.warnings) {
    lines.push(`config warning: ${warning}`);
  }
  return lines.join("\n");
}

async function probeBinary(command, args) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { maxBuffer: 8 * 1024 * 1024 });
    return {
      ok: true,
      output: `${stdout}${stderr}`.trim()
    };
  } catch (error) {
    return {
      ok: false,
      output: error?.message ?? String(error)
    };
  }
}
