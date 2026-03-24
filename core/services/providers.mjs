import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getGlobalConfigPath, getProjectConfigPath, readConfigSafe } from "../../cli/lib/config-store.mjs";
import { loadKnowledge } from "./knowledge.mjs";

const execFileAsync = promisify(execFile);

export async function discoverProviderState({ root = process.cwd() } = {}) {
  const [projectConfigState, globalConfigState] = await Promise.all([
    readConfigSafe(getProjectConfigPath(root)),
    readConfigSafe(getGlobalConfigPath())
  ]);
  const projectConfig = projectConfigState.config;
  const globalConfig = globalConfigState.config;

  const knowledge = await loadKnowledge({ root, projectConfig, globalConfig });

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

  const allProviderIds = new Set([...Object.keys(knowledge.models), ...Object.keys(configuredProviders)]);

  for (const providerId of allProviderIds) {
    if (providerId === "ollama") {
      continue;
    }

    const config = configuredProviders[providerId] ?? {};
    const apiKey = config.apiKey ?? getEnvKey(providerId);
    const models = normalizeConfiguredModels(providerId, config, knowledge.models[providerId] ?? []);
    providers[providerId] = {
      available: config.enabled !== false && models.length > 0 && !!apiKey,
      local: false,
      configured: !!configuredProviders[providerId],
      apiKey: apiKey ?? null,
      baseUrl: config.baseUrl ?? null,
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
    models: ollama.models.map((model) => {
      const id = typeof model === "string" ? model : model.id;
      const sizeB = (typeof model === "object" && model.sizeB) ? model.sizeB : estimateOllamaModelSizeB(id);
      return {
        id,
        quality: classifyOllamaModel(id),
        costTier: 1,
        sizeB,
        strengths: ["summarization", "extraction", "classification", "clustering", "ranking", "note-normalization"]
      };
    }),
    details: ollama.details
  };

  return {
    root,
    knowledge,
    configWarnings: [projectConfigState.warning, globalConfigState.warning].filter(Boolean),
    routingPolicy: {
      capabilityMapping: knowledge.capabilityMapping,
      preferLocalFor: ["data", "summarization", "extraction", "note-normalization", "strategy"],
      minimumQuality: knowledge.minimumQuality,
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
        .map((model) => ({
          id: model?.name ?? model?.model ?? "",
          sizeB: model?.size ? Number((model.size / (1024 ** 3)).toFixed(1)) : null
        }))
        .filter((m) => !!m.id)
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
      .map((line) => {
        const id = line.trim().split(/\s+/)[0];
        return id ? { id, sizeB: estimateOllamaModelSizeB(id) } : null;
      })
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
    providerId: "ollama",
    host: resolvedHost,
    model,
    response: String(payload.response ?? "").trim(),
    raw: payload
  };
}

export async function generateWithGemini({ model, prompt, system = "", apiKey } = {}) {
  const key = apiKey ?? process.env.GOOGLE_API_KEY;
  if (!key) {
    throw new Error("Gemini API key is required (GOOGLE_API_KEY or config)");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048
      }
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini request failed (${response.status}): ${errorBody}`);
  }

  const payload = await response.json();
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return {
    providerId: "google",
    model,
    response: text.trim(),
    raw: payload
  };
}

export async function generateWithOpenAI({ model, prompt, system = "", apiKey, baseUrl } = {}) {
  const key = apiKey ?? process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("OpenAI API key is required (OPENAI_API_KEY or config)");
  }

  const url = `${baseUrl ?? "https://api.openai.com/v1"}/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      model,
      messages: [
        ...(system ? [{ role: "system", content: system }] : []),
        { role: "user", content: prompt }
      ],
      temperature: 0.1
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${errorBody}`);
  }

  const payload = await response.json();
  const text = payload.choices?.[0]?.message?.content ?? "";
  return {
    providerId: "openai",
    model,
    response: text.trim(),
    raw: payload
  };
}

export async function generateCompletion({ providerId, modelId, prompt, system, config = {} } = {}) {
  switch (providerId) {
    case "ollama":
      return generateWithOllama({ model: modelId, prompt, system, host: config.host, format: config.format });
    case "google":
      return generateWithGemini({ model: modelId, prompt, system, apiKey: config.apiKey });
    case "openai":
      return generateWithOpenAI({ model: modelId, prompt, system, apiKey: config.apiKey, baseUrl: config.baseUrl });
    default:
      throw new Error(`Unsupported provider for completion: ${providerId}`);
  }
}

function normalizeOllamaHost(host) {
  if (!host) {
    return null;
  }

  let trimmed = String(host).trim().replace(/\/+$/, "");
  if (!trimmed) {
    return null;
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `http://${trimmed}`;
  }

  try {
    const url = new URL(trimmed);
    if (!url.port && url.protocol === "http:") {
      return `${trimmed}:11434`;
    }
  } catch {
    // Fallback if URL is invalid
  }

  return trimmed;
}

function mergeProviderConfig(globalProviders = {}, projectProviders = {}) {
  return {
    ...globalProviders,
    ...Object.fromEntries(
      Object.entries(projectProviders).map(([key, value]) => [key, { ...(globalProviders[key] ?? {}), ...value }])
    )
  };
}

function normalizeConfiguredModels(providerId, config, builtinModels = []) {
  const configured = Array.isArray(config.models) ? config.models : builtinModels;
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

function getEnvKey(providerId) {
  switch (providerId) {
    case "google":
      return process.env.GOOGLE_API_KEY;
    case "openai":
      return process.env.OPENAI_API_KEY;
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY;
    default:
      return null;
  }
}

function normalizeModelSize(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}
