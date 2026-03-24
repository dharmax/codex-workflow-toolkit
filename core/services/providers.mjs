import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getGlobalConfigPath, getProjectConfigPath, readConfigSafe } from "../../cli/lib/config-store.mjs";

const execFileAsync = promisify(execFile);

const STATIC_MODEL_CATALOG = {
  openai: [
    { id: "gpt-5.4-mini", quality: "medium", costTier: 2, strengths: ["extraction", "summarization", "classification", "clustering", "ranking"] },
    { id: "gpt-5.4", quality: "high", costTier: 5, strengths: ["architectural-reasoning", "risky-planning", "code-generation", "review"] }
  ],
  anthropic: [
    { id: "claude-sonnet", quality: "high", costTier: 4, strengths: ["summarization", "architectural-reasoning", "review", "naming"] }
  ],
  google: [
    { id: "gemini-flash", quality: "medium", costTier: 2, strengths: ["extraction", "classification", "summarization"] },
    { id: "gemini-pro", quality: "high", costTier: 4, strengths: ["architectural-reasoning", "review", "code-generation"] }
  ]
};

export async function discoverProviderState({ root = process.cwd() } = {}) {
  const [projectConfigState, globalConfigState] = await Promise.all([
    readConfigSafe(getProjectConfigPath(root)),
    readConfigSafe(getGlobalConfigPath())
  ]);
  const projectConfig = projectConfigState.config;
  const globalConfig = globalConfigState.config;
  const ollamaConfig = resolveOllamaConfig({ projectConfig, globalConfig });
  const ollama = ollamaConfig.enabled === false
    ? {
      installed: false,
      models: [],
      details: "disabled by config",
      host: ollamaConfig.host
    }
    : await probeOllama({ host: ollamaConfig.host });

  const configuredProviders = mergeProviderConfig(globalConfig.providers, projectConfig.providers);
  const providers = {};

  for (const [providerId, config] of Object.entries(configuredProviders)) {
    const models = normalizeConfiguredModels(providerId, config);
    providers[providerId] = {
      available: config.enabled !== false && models.length > 0,
      local: false,
      configured: true,
      models
    };
  }

  providers.ollama = {
    available: ollamaConfig.enabled !== false && ollama.installed && ollama.models.length > 0,
    local: true,
    configured: true,
    host: ollama.host,
    hardwareClass: ollamaConfig.hardwareClass,
    plannerModel: ollamaConfig.plannerModel,
    plannerMaxQuality: ollamaConfig.plannerMaxQuality,
    maxModelSizeB: ollamaConfig.maxModelSizeB,
    models: ollama.models.map((model) => ({
      id: model,
      quality: classifyOllamaModel(model),
      costTier: 1,
      sizeB: estimateOllamaModelSizeB(model),
      strengths: ["summarization", "extraction", "classification", "clustering", "ranking", "note-normalization"]
    })),
    details: ollama.details
  };

  return {
    root,
    configWarnings: [projectConfigState.warning, globalConfigState.warning].filter(Boolean),
    routingPolicy: {
      preferLocalFor: ["summarization", "extraction", "classification", "clustering", "ranking", "note-normalization"],
      minimumQuality: {
        extraction: "medium",
        summarization: "medium",
        classification: "medium",
        clustering: "medium",
        ranking: "medium",
        "candidate-review": "medium",
        naming: "medium",
        "architectural-reasoning": "high",
        "risky-planning": "high",
        "code-generation": "high",
        review: "high"
      },
      ...(globalConfig.routing ?? {}),
      ...(projectConfig.routing ?? {})
    },
    providers
  };
}

export async function probeOllama({ host } = {}) {
  const resolvedHost = normalizeOllamaHost(host ?? process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434");

  try {
    const response = await fetch(`${resolvedHost}/api/tags`);
    if (!response.ok) {
      throw new Error(`ollama tags request failed with ${response.status}`);
    }
    const payload = await response.json();
    const models = Array.isArray(payload.models)
      ? payload.models
        .map((model) => model?.name ?? model?.model ?? "")
        .filter(Boolean)
      : [];
    return {
      installed: true,
      models,
      details: JSON.stringify({ host: resolvedHost, modelCount: models.length }),
      host: resolvedHost
    };
  } catch (error) {
    if (host) {
      return {
        installed: false,
        models: [],
        details: error?.message ?? String(error),
        host: resolvedHost
      };
    }
  }

  try {
    const env = resolvedHost ? { ...process.env, OLLAMA_HOST: resolvedHost } : process.env;
    const { stdout, stderr } = await execFileAsync("ollama", ["list"], {
      maxBuffer: 8 * 1024 * 1024,
      env
    });
    const output = `${stdout}${stderr}`.trim();
    const models = output
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.trim().split(/\s+/)[0])
      .filter(Boolean);
    return {
      installed: true,
      models,
      details: output,
      host: resolvedHost
    };
  } catch (error) {
    return {
      installed: false,
      models: [],
      details: error?.message ?? String(error),
      host: resolvedHost
    };
  }
}

export function resolveOllamaConfig({ projectConfig = {}, globalConfig = {} } = {}) {
  const globalOllama = globalConfig.providers?.ollama ?? {};
  const projectOllama = projectConfig.providers?.ollama ?? {};
  const merged = {
    ...globalOllama,
    ...projectOllama
  };
  return {
    ...merged,
    host: normalizeOllamaHost(projectOllama.host ?? globalOllama.host ?? process.env.OLLAMA_HOST ?? null),
    hardwareClass: normalizeHardwareClass(merged.hardwareClass),
    plannerModel: merged.plannerModel ? String(merged.plannerModel).trim() : null,
    plannerMaxQuality: normalizeQuality(merged.plannerMaxQuality) ?? null,
    maxModelSizeB: normalizeModelSize(merged.maxModelSizeB)
  };
}

export async function generateWithOllama({ model, prompt, system = "", host, format = null } = {}) {
  if (!model) {
    throw new Error("model is required");
  }

  const resolvedHost = normalizeOllamaHost(host ?? process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434");
  const response = await fetch(`${resolvedHost}/api/generate`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      prompt,
      system,
      stream: false,
      format,
      options: {
        temperature: 0.1
      }
    })
  });

  if (!response.ok) {
    throw new Error(`ollama generate request failed with ${response.status}`);
  }

  const payload = await response.json();
  return {
    host: resolvedHost,
    model,
    response: String(payload.response ?? "").trim(),
    raw: payload
  };
}

function normalizeOllamaHost(host) {
  if (!host) {
    return null;
  }

  const trimmed = String(host).trim().replace(/\/+$/, "");
  if (!trimmed) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `http://${trimmed}`;
}

function mergeProviderConfig(globalProviders = {}, projectProviders = {}) {
  return {
    ...globalProviders,
    ...Object.fromEntries(
      Object.entries(projectProviders).map(([key, value]) => [key, { ...(globalProviders[key] ?? {}), ...value }])
    )
  };
}

function normalizeConfiguredModels(providerId, config) {
  const configured = Array.isArray(config.models) ? config.models : STATIC_MODEL_CATALOG[providerId] ?? [];
  return configured.map((model) => typeof model === "string"
    ? {
      id: model,
      quality: "medium",
      costTier: 3,
      strengths: []
    }
    : model
  );
}

function classifyOllamaModel(model) {
  const lower = model.toLowerCase();
  if (/(70b|large|coder|qwen3:32b|deepseek-r1|llama3\.3:70b)/.test(lower)) {
    return "high";
  }
  if (/(14b|32b|8x7b|mixtral|qwen2\.5:14b|gemma3:12b)/.test(lower)) {
    return "medium";
  }
  return "low";
}

export function estimateOllamaModelSizeB(model) {
  const match = String(model ?? "").toLowerCase().match(/(\d+(?:\.\d+)?)b\b/);
  return match ? Number(match[1]) : null;
}

function normalizeHardwareClass(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["tiny", "small", "medium", "large"].includes(normalized) ? normalized : null;
}

function normalizeQuality(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["low", "medium", "high"].includes(normalized) ? normalized : null;
}

function normalizeModelSize(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}
