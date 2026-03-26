import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getGlobalConfigPath, getProjectConfigPath, readConfigSafe } from "./config-store.mjs";
import { discoverProviderState, probeOllama, resolveOllamaConfig } from "../../core/services/providers.mjs";

const execFileAsync = promisify(execFile);

export async function runDoctor({ root = process.cwd(), json = false } = {}) {
  const report = await buildDoctorReport({ root });
  const rendered = json
    ? `${JSON.stringify(report, null, 2)}\n`
    : `${renderDoctorReport(report)}\n`;

  process.stdout.write(rendered);
  return report;
}

export async function buildDoctorReport({ root = process.cwd() } = {}) {
  const [projectConfigState, globalConfigState, providerState] = await Promise.all([
    readConfigSafe(getProjectConfigPath(root)),
    readConfigSafe(getGlobalConfigPath()),
    discoverProviderState({ root })
  ]);
  const projectConfig = projectConfigState.config;
  const globalConfig = globalConfigState.config;
  const ollamaConfig = resolveOllamaConfig({ projectConfig, globalConfig });
  const git = await probeBinary("git", ["--version"]);

  const providers = {};
  for (const [id, p] of Object.entries(providerState.providers)) {
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
    git: {
      installed: git.ok,
      details: git.output
    },
    providers,
    ollama: {
      installed: providerState.providers.ollama.available,
      host: providerState.providers.ollama.host,
      hardwareClass: ollamaConfig.hardwareClass ?? null,
      plannerModel: ollamaConfig.plannerModel ?? null,
      plannerMaxQuality: ollamaConfig.plannerMaxQuality ?? null,
      maxModelSizeB: ollamaConfig.maxModelSizeB ?? null,
      models: providerState.providers.ollama.models.map(m => ({
        id: m.id,
        quality: m.quality,
        capabilities: m.capabilities
      })),
      details: providerState.providers.ollama.details
    },
    config: {
      projectPath: getProjectConfigPath(root),
      globalPath: getGlobalConfigPath(),
      warnings: [projectConfigState.warning, globalConfigState.warning].filter(Boolean),
      projectKeys: Object.keys(projectConfig),
      globalKeys: Object.keys(globalConfig)
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
    `git: ${report.git.installed ? "installed" : "missing"}`
  ];

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
      lines.push(`- ${m.id} (${m.quality}) [${caps}]`);
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
    lines.push(`ollama planner model: ${report.ollama.plannerModel}`);
  }
  if (!report.ollama.hardwareClass && !report.ollama.maxModelSizeB && !report.ollama.plannerModel) {
    lines.push("ollama planner hint: missing hardware/planner config; shell will default to a small model");
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
