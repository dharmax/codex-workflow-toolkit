import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { getGlobalConfigPath, getProjectConfigPath, readConfig, writeConfigValue } from "./config-store.mjs";
import { parseArgs, printAndExit } from "../../runtime/scripts/codex-workflow/lib/cli.mjs";

const HARDWARE_CLASS_TO_SIZE = {
  tiny: 4,
  small: 8,
  medium: 14,
  large: 32
};

const HARDWARE_ORDER = ["tiny", "small", "medium", "large"];

export async function handleSetOllamaHw(rest, { root = process.cwd() } = {}) {
  const args = parseArgs(rest);
  if (args.help) {
    printAndExit(SET_OLLAMA_HW_HELP.trim());
  }

  const result = await configureOllamaHardware({
    root,
    global: Boolean(args.global),
    host: args.host ? String(args.host) : null,
    probe: args.probe ? String(args.probe) : null,
    gpu: args.gpu ? String(args.gpu) : null,
    cpu: args.cpu ? Number(args.cpu) : null,
    vramGb: args["vram-gb"] ? Number(args["vram-gb"]) : null,
    ramGb: args["ram-gb"] ? Number(args["ram-gb"]) : null,
    hardwareClass: args["hardware-class"] ? String(args["hardware-class"]) : null,
    plannerModel: args["planner-model"] ? String(args["planner-model"]) : null,
    maxModelSizeB: args["max-model-size-b"] ? Number(args["max-model-size-b"]) : null,
    printProbeCmd: Boolean(args["print-probe-cmd"]),
    interactive: !args["print-probe-cmd"]
      && !args.probe
      && !args.gpu
      && !args.cpu
      && !args["vram-gb"]
      && !args["ram-gb"]
      && !args["hardware-class"]
      && !args["planner-model"]
      && !args["max-model-size-b"]
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(renderOllamaHardwareResult(result));
  }
  return 0;
}

export async function configureOllamaHardware({
  root = process.cwd(),
  global = false,
  host = null,
  probe = null,
  gpu = null,
  cpu = null,
  vramGb = null,
  ramGb = null,
  hardwareClass = null,
  plannerModel = null,
  maxModelSizeB = null,
  printProbeCmd = false,
  interactive = false,
  rl = null
} = {}) {
  if (printProbeCmd && !interactive && !host && !probe && !gpu && cpu == null && vramGb == null && ramGb == null && !hardwareClass && !plannerModel && maxModelSizeB == null) {
    return {
      configPath: global ? getGlobalConfigPath() : getProjectConfigPath(root),
      scope: global ? "global" : "project",
      host: null,
      probeCommand: buildOllamaHardwareProbeCommand(),
      probe: null,
      inferred: null,
      applied: {
        hardwareClass: null,
        maxModelSizeB: null,
        plannerModel: null
      }
    };
  }

  const configPath = global ? getGlobalConfigPath() : getProjectConfigPath(root);
  let existing = {};
  let configWarning = null;
  try {
    existing = await readConfig(configPath);
  } catch (error) {
    configWarning = error?.message ?? String(error);
  }
  const startingHost = host ?? existing.providers?.ollama?.host ?? null;

  let resolvedProbe = probe;
  let resolvedFields = normalizeHardwareFields({ gpu, cpu, vramGb, ramGb });
  let resolvedHardwareClass = normalizeHardwareClass(hardwareClass);
  let resolvedPlannerModel = plannerModel ? String(plannerModel).trim() : null;
  let resolvedMaxModelSizeB = normalizeSize(maxModelSizeB);

  if (interactive && process.stdin.isTTY && process.stdout.isTTY) {
    const prompted = await promptForOllamaHardware({
      host: startingHost,
      probeCommand: buildOllamaHardwareProbeCommand(),
      rl
    });
    resolvedProbe = resolvedProbe ?? prompted.probe ?? null;
    resolvedFields = pickHardwareFields(resolvedFields, prompted.fields);
    resolvedHardwareClass = resolvedHardwareClass ?? prompted.hardwareClass ?? null;
    resolvedPlannerModel = resolvedPlannerModel ?? prompted.plannerModel ?? null;
    resolvedMaxModelSizeB = resolvedMaxModelSizeB ?? prompted.maxModelSizeB ?? null;
    host = host ?? prompted.host ?? null;
  }

  const parsedProbe = resolvedProbe ? parseOllamaHardwareProbe(resolvedProbe) : null;
  const inferredSource = parsedProbe ?? (hasHardwareFields(resolvedFields) ? hardwareFieldsToProbe(resolvedFields) : null);
  const inferred = inferredSource ? inferOllamaHardwareConfig(inferredSource) : null;
  const finalHardwareClass = resolvedHardwareClass ?? inferred?.hardwareClass ?? null;
  const finalMaxModelSizeB = resolvedMaxModelSizeB ?? inferred?.maxModelSizeB ?? (finalHardwareClass ? HARDWARE_CLASS_TO_SIZE[finalHardwareClass] : null);

  await writeOllamaHardwareConfig({
    configPath,
    existing,
    configWarning,
    host: host ?? startingHost ?? null,
    hardwareClass: finalHardwareClass,
    maxModelSizeB: finalMaxModelSizeB,
    plannerModel: resolvedPlannerModel
  });

  return {
    configPath,
    scope: global ? "global" : "project",
    configWarning,
    host: host ?? startingHost ?? null,
    probeCommand: printProbeCmd || interactive ? buildOllamaHardwareProbeCommand() : null,
    probe: parsedProbe,
    fields: resolvedFields,
    inferred: inferred ?? null,
    applied: {
      hardwareClass: finalHardwareClass,
      maxModelSizeB: finalMaxModelSizeB,
      plannerModel: resolvedPlannerModel
    }
  };
}

export function buildOllamaHardwareProbeCommand() {
  return "printf 'cpu=%s ram_gb=%s gpu=' \"$(nproc)\" \"$(awk '/MemTotal/ {printf \\\"%d\\\", $2/1024/1024}' /proc/meminfo)\"; if command -v nvidia-smi >/dev/null 2>&1; then nvidia-smi --query-gpu=name,memory.total --format=csv,noheader | awk -F',' 'BEGIN{sep=\"\"} {gsub(/^[ \\t]+|[ \\t]+$/, \"\", $1); gsub(/ MiB/, \"\", $2); printf \"%s%s:%dGB\", sep, $1, int($2/1024+0.5); sep=\";\"} END{if (NR==0) printf \"none\"}'; else printf 'none'; fi; printf '\\n'";
}

export function parseOllamaHardwareProbe(text) {
  const trimmed = String(text ?? "").trim();
  const cpuMatch = trimmed.match(/\bcpu=(\d+)/i);
  const ramMatch = trimmed.match(/\bram_gb=(\d+)/i);
  const gpuMatch = trimmed.match(/\bgpu=([^\n]+)/i);

  return {
    raw: trimmed,
    cpu: cpuMatch ? Number(cpuMatch[1]) : null,
    ramGb: ramMatch ? Number(ramMatch[1]) : null,
    gpus: parseGpuList(gpuMatch?.[1] ?? "none")
  };
}

export function inferOllamaHardwareConfig(probe) {
  const maxGpuVramGb = probe.gpus.reduce((max, gpu) => Math.max(max, gpu.vramGb ?? 0), 0);
  const ramGb = probe.ramGb ?? 0;
  const cpu = probe.cpu ?? 0;

  let hardwareClass = "tiny";
  if (maxGpuVramGb >= 32 || ramGb >= 96 || cpu >= 32) {
    hardwareClass = "large";
  } else if (maxGpuVramGb >= 20 || ramGb >= 48 || cpu >= 16) {
    hardwareClass = "medium";
  } else if (maxGpuVramGb >= 10 || ramGb >= 24 || cpu >= 8) {
    hardwareClass = "small";
  }

  return {
    hardwareClass,
    maxModelSizeB: HARDWARE_CLASS_TO_SIZE[hardwareClass],
    summary: [
      `cpu ${probe.cpu ?? "?"}`,
      `ram ${probe.ramGb ?? "?"}GB`,
      `gpu ${probe.gpus.length ? probe.gpus.map((gpu) => `${gpu.name}:${gpu.vramGb}GB`).join(";") : "none"}`
    ].join(", ")
  };
}

function hardwareFieldsToProbe(fields) {
  return {
    raw: null,
    cpu: fields.cpu ?? null,
    ramGb: fields.ramGb ?? null,
    gpus: fields.gpu && fields.gpu.toLowerCase() !== "none"
      ? [{ name: fields.gpu, vramGb: fields.vramGb ?? null }]
      : []
  };
}

async function promptForOllamaHardware({ host, probeCommand, rl = null }) {
  const localRl = rl ?? readline.createInterface({ input, output });
  try {
    output.write([
      "Configure remote Ollama hardware for shell planning.",
      "Enter the basic hardware fields directly.",
      "If you need them, run this on the Ollama server in another terminal:",
      probeCommand,
      ""
    ].join("\n"));

    const nextHost = (await localRl.question(`Ollama host${host ? ` [${host}]` : ""}: `)).trim() || host || null;
    const gpu = (await localRl.question("GPU model (or none): ")).trim() || null;
    const cpu = normalizeSize((await localRl.question("CPU cores: ")).trim());
    const vramGb = normalizeSize((await localRl.question("GPU VRAM in GB (0 if none): ")).trim());
    const ramGb = normalizeSize((await localRl.question("System RAM in GB: ")).trim());
    const probe = (await localRl.question("Optional compact probe line (press Enter to skip): ")).trim();
    if (probe) {
      return {
        host: nextHost,
        probe,
        fields: normalizeHardwareFields({ gpu, cpu, vramGb, ramGb })
      };
    }

    const hardwareClass = normalizeHardwareClass((await localRl.question("Hardware class override [tiny/small/medium/large] (optional): ")).trim());
    const plannerModel = (await localRl.question("Planner model override (optional): ")).trim() || null;
    const maxModelSizeRaw = (await localRl.question("Planner max model size in B (optional): ")).trim();
    return {
      host: nextHost,
      fields: normalizeHardwareFields({ gpu, cpu, vramGb, ramGb }),
      hardwareClass,
      plannerModel,
      maxModelSizeB: normalizeSize(maxModelSizeRaw)
    };
  } finally {
    if (!rl) {
      localRl.close();
    }
  }
}

function parseGpuList(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed || trimmed.toLowerCase() === "none") {
    return [];
  }

  return trimmed.split(";").map((entry) => {
    const match = entry.trim().match(/(.+):(\d+)GB$/i);
    return {
      name: match ? match[1].trim() : entry.trim(),
      vramGb: match ? Number(match[2]) : null
    };
  });
}

function normalizeHardwareClass(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return HARDWARE_ORDER.includes(normalized) ? normalized : null;
}

function normalizeSize(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function normalizeHardwareFields({ gpu = null, cpu = null, vramGb = null, ramGb = null } = {}) {
  return {
    gpu: gpu ? String(gpu).trim() : null,
    cpu: normalizeSize(cpu),
    vramGb: normalizeSize(vramGb),
    ramGb: normalizeSize(ramGb)
  };
}

function hasHardwareFields(fields) {
  return Boolean(fields.gpu || fields.cpu != null || fields.vramGb != null || fields.ramGb != null);
}

function pickHardwareFields(current, next) {
  return {
    gpu: current.gpu ?? next?.gpu ?? null,
    cpu: current.cpu ?? next?.cpu ?? null,
    vramGb: current.vramGb ?? next?.vramGb ?? null,
    ramGb: current.ramGb ?? next?.ramGb ?? null
  };
}

function renderOllamaHardwareResult(result) {
  const lines = [
    `Scope: ${result.scope}`,
    `Config: ${result.configPath}`
  ];
  if (result.configWarning) {
    lines.push(`Config warning: ${result.configWarning}`);
  }
  if (result.host) {
    lines.push(`Ollama host: ${result.host}`);
  }
  if (result.probeCommand) {
    lines.push("");
    lines.push("Server probe command:");
    lines.push(result.probeCommand);
  }
  if (result.probe) {
    lines.push("");
    lines.push(`Probe: ${result.probe.raw}`);
  }
  if (result.fields && hasHardwareFields(result.fields)) {
    lines.push("");
    lines.push(`Fields: gpu=${result.fields.gpu ?? "none"} cpu=${result.fields.cpu ?? "?"} vram_gb=${result.fields.vramGb ?? "?"} ram_gb=${result.fields.ramGb ?? "?"}`);
  }
  if (result.inferred) {
    lines.push(`Inferred: ${result.inferred.summary}`);
  }
  lines.push("");
  lines.push(`Applied hardware class: ${result.applied.hardwareClass ?? "unchanged"}`);
  lines.push(`Applied max model size: ${result.applied.maxModelSizeB != null ? `${result.applied.maxModelSizeB}B` : "unchanged"}`);
  lines.push(`Applied planner model: ${result.applied.plannerModel ?? "unchanged"}`);
  return `${lines.join("\n")}\n`;
}

export const SET_OLLAMA_HW_HELP = `
Usage:
  ai-workflow set-ollama-hw [--global] [--host <url>] [--probe "<line>"]
  ai-workflow set-ollama-hw [--global] --hardware-class <tiny|small|medium|large>
  ai-workflow set-ollama-hw [--global] --planner-model <model>
  ai-workflow set-ollama-hw --print-probe-cmd

Options:
  --global                Write to ~/.ai-workflow/config.json instead of the project config.
  --host <url>            Ollama host for this server, e.g. http://lotus:11434
  --probe <line>          Paste the one-line server probe output to infer safe planner settings.
  --gpu <name>            GPU model, or "none".
  --cpu <n>               CPU core count.
  --vram-gb <n>           GPU VRAM in GB.
  --ram-gb <n>            System RAM in GB.
  --hardware-class <id>   Manual hardware class: tiny, small, medium, or large.
  --planner-model <id>    Pin the shell planner to a specific Ollama model.
  --max-model-size-b <n>  Cap the shell planner to models up to N billions of parameters.
  --print-probe-cmd       Show the Linux command to run on the Ollama server.
  --json                  Emit JSON.
`;

async function writeOllamaHardwareConfig({ configPath, existing, configWarning, host, hardwareClass, maxModelSizeB, plannerModel }) {
  if (!configWarning) {
    const writes = [];
    if (host) {
      writes.push(writeConfigValue(configPath, "providers.ollama.host", host));
    }
    if (hardwareClass) {
      writes.push(writeConfigValue(configPath, "providers.ollama.hardwareClass", hardwareClass));
    }
    if (maxModelSizeB != null) {
      writes.push(writeConfigValue(configPath, "providers.ollama.maxModelSizeB", String(maxModelSizeB)));
    }
    if (plannerModel) {
      writes.push(writeConfigValue(configPath, "providers.ollama.plannerModel", plannerModel));
    }
    await Promise.all(writes);
    return;
  }

  const nextConfig = {
    ...existing,
    providers: {
      ...(existing.providers ?? {}),
      ollama: {
        ...(existing.providers?.ollama ?? {}),
        ...(host ? { host } : {}),
        ...(hardwareClass ? { hardwareClass } : {}),
        ...(maxModelSizeB != null ? { maxModelSizeB } : {}),
        ...(plannerModel ? { plannerModel } : {})
      }
    }
  };
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
}
