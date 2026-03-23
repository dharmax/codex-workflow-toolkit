import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getGlobalConfigPath, getProjectConfigPath, readConfig } from "./config-store.mjs";

const execFileAsync = promisify(execFile);

export async function runDoctor({ root = process.cwd(), json = false } = {}) {
  const [git, ollama] = await Promise.all([
    probeBinary("git", ["--version"]),
    probeBinary("ollama", ["list"])
  ]);
  const [projectConfig, globalConfig] = await Promise.all([
    readConfig(getProjectConfigPath(root)),
    readConfig(getGlobalConfigPath())
  ]);
  const report = {
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
      installed: ollama.ok,
      models: ollama.ok ? parseOllamaList(ollama.output) : [],
      details: ollama.output
    },
    config: {
      projectPath: getProjectConfigPath(root),
      globalPath: getGlobalConfigPath(),
      projectKeys: Object.keys(projectConfig),
      globalKeys: Object.keys(globalConfig)
    }
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const lines = [
      `cwd: ${report.cwd}`,
      `platform: ${report.platform}/${report.arch}`,
      `node: ${report.node}`,
      `cpu: ${report.cpuCount} cores`,
      `memory: ${report.totalMemoryGb} GB`,
      `git: ${report.git.installed ? "installed" : "missing"}`,
      `ollama: ${report.ollama.installed ? "installed" : "missing"}`
    ];

    if (report.ollama.installed) {
      lines.push(`ollama models: ${report.ollama.models.length ? report.ollama.models.join(", ") : "none reported"}`);
    }

    lines.push(`project config: ${report.config.projectPath}`);
    lines.push(`global config: ${report.config.globalPath}`);
    process.stdout.write(`${lines.join("\n")}\n`);
  }

  return report;
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

function parseOllamaList(output) {
  return String(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(1)
    .map((line) => line.split(/\s+/)[0])
    .filter(Boolean);
}
