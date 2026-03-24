import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getGlobalConfigPath, getProjectConfigPath, readConfig } from "../../cli/lib/config-store.mjs";

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
  const [projectConfig, globalConfig, ollama] = await Promise.all([
    readConfig(getProjectConfigPath(root)),
    readConfig(getGlobalConfigPath()),
    probeOllama()
  ]);

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
    available: ollama.installed && ollama.models.length > 0,
    local: true,
    configured: true,
    models: ollama.models.map((model) => ({
      id: model,
      quality: classifyOllamaModel(model),
      costTier: 1,
      strengths: ["summarization", "extraction", "classification", "clustering", "ranking", "note-normalization"]
    })),
    details: ollama.details
  };

  return {
    root,
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

export async function probeOllama() {
  try {
    const { stdout, stderr } = await execFileAsync("ollama", ["list"], { maxBuffer: 8 * 1024 * 1024 });
    const output = `${stdout}${stderr}`.trim();
    const models = output
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.trim().split(/\s+/)[0])
      .filter(Boolean);
    return {
      installed: true,
      models,
      details: output
    };
  } catch (error) {
    return {
      installed: false,
      models: [],
      details: error?.message ?? String(error)
    };
  }
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
