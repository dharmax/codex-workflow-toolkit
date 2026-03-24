import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getGlobalConfigPath, getProjectConfigPath, readConfigSafe } from "./config-store.mjs";
import { probeOllama, resolveOllamaConfig } from "../../core/services/providers.mjs";

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
  const [projectConfigState, globalConfigState] = await Promise.all([
    readConfigSafe(getProjectConfigPath(root)),
    readConfigSafe(getGlobalConfigPath())
  ]);
  const projectConfig = projectConfigState.config;
  const globalConfig = globalConfigState.config;
  const ollamaConfig = resolveOllamaConfig({ projectConfig, globalConfig });
  const [git, ollama] = await Promise.all([
    probeBinary("git", ["--version"]),
    ollamaConfig.enabled === false
      ? Promise.resolve({
        installed: false,
        models: [],
        details: "disabled by config",
        host: ollamaConfig.host
      })
      : probeOllama({ host: ollamaConfig.host })
  ]);
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
    ollama: {
      installed: ollama.installed,
      host: ollama.host,
      hardwareClass: ollamaConfig.hardwareClass ?? null,
      plannerModel: ollamaConfig.plannerModel ?? null,
      plannerMaxQuality: ollamaConfig.plannerMaxQuality ?? null,
      maxModelSizeB: ollamaConfig.maxModelSizeB ?? null,
      models: ollama.models,
      details: ollama.details
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
    `git: ${report.git.installed ? "installed" : "missing"}`,
    `ollama: ${report.ollama.installed ? "installed" : "missing"}`
  ];

  if (report.ollama.host) {
    lines.push(`ollama host: ${report.ollama.host}`);
  }

  if (report.ollama.installed) {
    lines.push(`ollama models: ${report.ollama.models.length ? report.ollama.models.join(", ") : "none reported"}`);
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
