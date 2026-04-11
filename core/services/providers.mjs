import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { openWorkflowStore } from "../db/sqlite-store.mjs";
import { getGlobalConfigPath, getProjectConfigPath, isConfigWriteAccessError, readConfig, readConfigSafe, replaceConfig, updateConfig, writeConfigValue } from "../../cli/lib/config-store.mjs";
import { loadKnowledge } from "./knowledge.mjs";
import { leanCtxInstallHint, probeLeanCtx } from "./lean-ctx.mjs";
import { sha1 } from "../lib/hash.mjs";

const execFileAsync = promisify(execFile);
const OLLAMA_DISCOVERY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const ollamaDiscoveryCache = new Map();

export async function discoverProviderState({ root = process.cwd(), forceRefresh = false, cacheTtlMs = OLLAMA_DISCOVERY_CACHE_TTL_MS } = {}) {
  const [projectConfigState, globalConfigState] = await Promise.all([
    readConfigSafe(getProjectConfigPath(root)),
    readConfigSafe(getGlobalConfigPath())
  ]);
  const projectConfig = projectConfigState.config;
  const globalConfig = globalConfigState.config;

  const knowledge = await loadKnowledge({ root, projectConfig, globalConfig });

  const ollamaConfig = resolveOllamaConfig({ projectConfig, globalConfig });
  const leanCtx = await probeLeanCtx();
  const ollamaHosts = resolveOllamaHosts(ollamaConfig);
  const configuredOllamaModels = normalizeConfiguredModels("ollama", ollamaConfig, []);
  const ollamaCacheKey = sha1(JSON.stringify({
    root,
    enabled: ollamaConfig.enabled !== false,
    host: ollamaConfig.host ?? null,
    endpoints: ollamaConfig.endpoints ?? [],
    plannerModel: ollamaConfig.plannerModel ?? null,
    plannerMaxQuality: ollamaConfig.plannerMaxQuality ?? null,
    hardwareClass: ollamaConfig.hardwareClass ?? null,
    maxModelSizeB: ollamaConfig.maxModelSizeB ?? null,
    hosts: ollamaHosts
  }));
  const cachedOllama = forceRefresh ? null : ollamaDiscoveryCache.get(ollamaCacheKey);
  let ollama = null;
  if (cachedOllama && Date.now() - cachedOllama.cachedAt < cacheTtlMs) {
    ollama = cachedOllama.value;
  } else {
    ollama = ollamaConfig.enabled === false
      ? {
        installed: false,
        models: [],
        details: "disabled by config",
        host: ollamaConfig.host,
        hosts: ollamaHosts
      }
      : await probeOllamaHosts({
        hosts: ollamaHosts,
        reference: knowledge.modelReference,
        cachedModels: configuredOllamaModels
      });
    ollamaDiscoveryCache.set(ollamaCacheKey, { cachedAt: Date.now(), value: ollama });
  }

  const configuredProviders = mergeProviderConfig(globalConfig.providers, projectConfig.providers);
  const providers = {};

  const store = await openWorkflowStore({ projectRoot: root });
  const metricsSummary = store.getMetricsSummary();
  store.close();

  const allProviderIds = new Set([...Object.keys(knowledge.models), ...Object.keys(configuredProviders)]);
  const configWarnings = [projectConfigState.warning, globalConfigState.warning].filter(Boolean);
  if (!leanCtx.installed) {
    configWarnings.push(leanCtxInstallHint());
  }

  for (const providerId of allProviderIds) {
    if (providerId === "ollama") {
      continue;
    }

    const config = configuredProviders[providerId] ?? {};
    const apiKey = config.apiKey ?? getEnvKey(providerId);
    const models = normalizeConfiguredModels(providerId, config, knowledge.models[providerId] ?? []);
    const quota = normalizeProviderQuota(config.quota);
    providers[providerId] = {
      available: config.enabled !== false && models.length > 0 && !!apiKey,
      local: false,
      configured: !!configuredProviders[providerId],
      apiKey: apiKey ?? null,
      baseUrl: config.baseUrl ?? null,
      quota,
      paidAllowed: config.paidAllowed !== false,
      models
    };
  }

  providers.ollama = {
    available: ollamaConfig.enabled !== false && ollama.installed && ollama.models.length > 0,
    installed: ollama.installed,
    local: true,
    configured: Boolean(ollamaConfig.host || ollamaConfig.endpoints?.length),
    host: ollama.host,
    endpoints: ollama.hosts?.filter((host) => host && host !== ollama.host) ?? [],
    hardwareClass: ollamaConfig.hardwareClass,
    plannerModel: ollamaConfig.plannerModel,
    plannerMaxQuality: ollamaConfig.plannerMaxQuality,
    maxModelSizeB: ollamaConfig.maxModelSizeB,
    models: ollama.models.map((model) => {
      const id = typeof model === "string" ? model : model.id;
      const sizeB = typeof model === "object" && model.sizeB ? model.sizeB : estimateOllamaModelSizeB(id);
      const profile = profileOllamaModel(id, sizeB, knowledge.modelReference);

      return {
        id,
        host: typeof model === "object" && model.host ? normalizeOllamaHost(model.host) : ollama.host,
        quality: profile.quality,
        costTier: 1,
        sizeB,
        capabilities: profile.capabilities,
        strengths: profile.strengths
      };
    }),
    details: ollama.details
  };

  return {
    root,
    knowledge,
    metricsSummary,
    leanCtx,
    configWarnings,
    routingPolicy: {
      capabilityMapping: knowledge.capabilityMapping,
      preferLocalFor: ["data", "summarization", "extraction", "note-normalization", "strategy", "artifact-evaluation"],
      minimumQuality: knowledge.minimumQuality,
      quotaStrategy: "prefer-free-remote",
      contextCompression: leanCtx.installed ? "lean-ctx" : "fallback",
      ...(globalConfig.routing ?? {}),
      ...(projectConfig.routing ?? {})
    },
    providers
  };
}

export async function refreshProviderQuotaState({ root = process.cwd(), providerId = "all", scope = "global", now = new Date() } = {}) {
  const configPath = scope === "global" ? getGlobalConfigPath() : getProjectConfigPath(root);
  const config = await readConfig(configPath);
  const providers = config.providers ?? {};
  const providerIds = providerId === "all"
    ? Object.keys(providers)
    : [providerId];
  const refreshed = [];

  for (const id of providerIds) {
    const provider = providers[id];
    if (!provider) continue;

    const result = refreshQuotaWindow(provider.quota, now);
    if (!result.changed) {
      refreshed.push({ providerId: id, changed: false, quota: normalizeProviderQuota(provider.quota) });
      continue;
    }

    await writeConfigValue(configPath, `providers.${id}.quota`, JSON.stringify(result.quota));
    refreshed.push({ providerId: id, changed: true, quota: normalizeProviderQuota(result.quota) });
  }

  return {
    scope,
    configPath,
    refreshed
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
  const host = normalizeOllamaHost(projectOllama.host ?? globalOllama.host ?? process.env.OLLAMA_HOST ?? null);
  return {
    ...merged,
    host,
    endpoints: normalizeOllamaEndpointList([
      ...(Array.isArray(globalOllama.endpoints) ? globalOllama.endpoints : []),
      ...(Array.isArray(projectOllama.endpoints) ? projectOllama.endpoints : [])
    ]).filter((endpoint) => endpoint && endpoint !== host),
    hardwareClass: normalizeHardwareClass(merged.hardwareClass),
    plannerModel: merged.plannerModel ? String(merged.plannerModel).trim() : null,
    plannerMaxQuality: normalizeQuality(merged.plannerMaxQuality) ?? null,
    maxModelSizeB: normalizeModelSize(merged.maxModelSizeB)
  };
}

export async function generateWithOllama({ model, prompt, system = "", host, format = null, contentParts = null, signal = null, generationOptions = null } = {}) {
  if (!model) {
    throw new Error("model is required");
  }

  const resolvedHost = normalizeOllamaHost(host ?? process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434");
  const hasImages = Array.isArray(contentParts) && contentParts.some((part) => part?.type === "image" && part.data);
  const extraText = Array.isArray(contentParts)
    ? contentParts
      .filter((part) => part?.type === "text" && String(part.text ?? "").trim())
      .map((part) => String(part.text ?? "").trim())
      .join("\n\n")
    : "";
  const promptText = [prompt, extraText].filter(Boolean).join("\n\n");
  if (hasImages) {
    const response = await fetch(`${resolvedHost}/api/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      signal,
      body: JSON.stringify({
        model,
        messages: buildOllamaMessages({ prompt, system, contentParts }),
        stream: false,
        format,
        options: {
          temperature: 0.1,
          ...(generationOptions ?? {})
        }
      })
    });

    if (!response.ok) {
      throw new Error(`ollama chat request failed with ${response.status}`);
    }

    const payload = await response.json();
    const text = payload.message?.content ?? payload.response ?? "";
    return {
      providerId: "ollama",
      host: resolvedHost,
      model,
      response: String(text ?? "").trim(),
      raw: payload
    };
  }

  const response = await fetch(`${resolvedHost}/api/generate`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    signal,
    body: JSON.stringify({
      model,
      prompt: promptText,
      system,
      stream: false,
      format,
      options: {
        temperature: 0.1,
        ...(generationOptions ?? {})
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

export async function generateWithGemini({ model, prompt, system = "", apiKey, contentParts = null, signal = null } = {}) {
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
    signal,
    body: JSON.stringify({
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: [{ parts: buildGeminiParts({ prompt, contentParts }) }],
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

export async function generateWithOpenAI({ model, prompt, system = "", apiKey, baseUrl, contentParts = null, signal = null } = {}) {
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
    signal,
    body: JSON.stringify({
      model,
      messages: [
        ...(system ? [{ role: "system", content: system }] : []),
        { role: "user", content: buildOpenAIMessageContent({ prompt, contentParts }) }
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

export async function generateWithAnthropic({ model, prompt, system = "", apiKey, baseUrl, contentParts = null, signal = null } = {}) {
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error("Anthropic API key is required (ANTHROPIC_API_KEY or config)");
  }

  const url = `${baseUrl ?? "https://api.anthropic.com/v1"}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01"
    },
    signal,
    body: JSON.stringify({
      model,
      system: system || undefined,
      max_tokens: 2048,
      temperature: 0.1,
      messages: [{ role: "user", content: buildAnthropicContent({ prompt, contentParts }) }]
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Anthropic request failed (${response.status}): ${errorBody}`);
  }

  const payload = await response.json();
  const text = Array.isArray(payload.content)
    ? payload.content
      .filter((item) => item?.type === "text")
      .map((item) => item.text ?? "")
      .join("\n")
    : "";
  return {
    providerId: "anthropic",
    model,
    response: text.trim(),
    raw: payload
  };
}

const CUSTOM_PROVIDERS = new Map();

export function registerProvider(providerId, implementation) {
  CUSTOM_PROVIDERS.set(providerId, implementation);
}

export async function generateCompletion({ providerId, modelId, prompt, system, config = {}, contentParts = null, signal = null } = {}) {
  const custom = CUSTOM_PROVIDERS.get(providerId);
  if (custom) {
    return custom.generate({ modelId, prompt, system, config, contentParts, signal });
  }

  switch (providerId) {
    case "ollama":
      return generateWithOllama({
        model: modelId,
        prompt,
        system,
        host: config.host,
        format: config.format,
        contentParts,
        signal,
        generationOptions: config.generationOptions ?? null
      });
    case "google":
      return generateWithGemini({ model: modelId, prompt, system, apiKey: config.apiKey, contentParts, signal });
    case "openai":
      return generateWithOpenAI({ model: modelId, prompt, system, apiKey: config.apiKey, baseUrl: config.baseUrl, contentParts, signal });
    case "anthropic":
      return generateWithAnthropic({ model: modelId, prompt, system, apiKey: config.apiKey, baseUrl: config.baseUrl, contentParts, signal });
    default:
      throw new Error(`Unsupported provider for completion: ${providerId}`);
  }
}

function buildOpenAIMessageContent({ prompt, contentParts = null }) {
  if (!Array.isArray(contentParts) || !contentParts.length) {
    return prompt;
  }

  return [
    { type: "text", text: prompt },
    ...contentParts.flatMap((part) => normalizeOpenAIContentPart(part))
  ];
}

function normalizeOpenAIContentPart(part) {
  if (part?.type === "image" && part.data && part.mimeType) {
    return [{
      type: "image_url",
      image_url: {
        url: `data:${part.mimeType};base64,${part.data}`
      }
    }];
  }

  if (part?.type === "text") {
    return [{
      type: "text",
      text: String(part.text ?? "")
    }];
  }

  return [];
}

function buildGeminiParts({ prompt, contentParts = null }) {
  const parts = [{ text: prompt }];
  for (const part of Array.isArray(contentParts) ? contentParts : []) {
    if (part?.type === "text") {
      parts.push({ text: String(part.text ?? "") });
      continue;
    }
    if (part?.type === "image" && part.data && part.mimeType) {
      parts.push({
        inline_data: {
          mime_type: part.mimeType,
          data: part.data
        }
      });
    }
  }
  return parts;
}

function buildAnthropicContent({ prompt, contentParts = null }) {
  const content = [{ type: "text", text: prompt }];
  for (const part of Array.isArray(contentParts) ? contentParts : []) {
    if (part?.type === "text") {
      content.push({ type: "text", text: String(part.text ?? "") });
      continue;
    }
    if (part?.type === "image" && part.data && part.mimeType) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: part.mimeType,
          data: part.data
        }
      });
    }
  }
  return content;
}

function buildOllamaMessages({ prompt, system = "", contentParts = null }) {
  const textParts = [];
  const images = [];
  for (const part of Array.isArray(contentParts) ? contentParts : []) {
    if (part?.type === "text" && String(part.text ?? "").trim()) {
      textParts.push(String(part.text ?? ""));
      continue;
    }
    if (part?.type === "image" && part.data) {
      images.push(String(part.data));
    }
  }

  const content = [prompt, ...textParts].filter(Boolean).join("\n\n");
  const messages = [];
  if (system) {
    messages.push({ role: "system", content: system });
  }
  messages.push(images.length ? { role: "user", content, images } : { role: "user", content });
  return messages;
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

export async function refreshProviderRegistry({
  root = process.cwd(),
  scope = "global",
  forceRefresh = true,
  ignoreWriteErrors = false
} = {}) {
  const configPath = scope === "global" ? getGlobalConfigPath() : getProjectConfigPath(root);
  const projectConfig = await readConfigSafe(getProjectConfigPath(root));
  const globalConfig = await readConfigSafe(getGlobalConfigPath());
  const providerState = await discoverProviderState({ root, forceRefresh });
  const refreshed = [];
  const configRead = scope === "global" ? globalConfig : projectConfig;
  const nextConfig = structuredClone(configRead.config ?? {});
  nextConfig.providers ??= {};

  const providers = providerState.providers ?? {};
  for (const [providerId, provider] of Object.entries(providers)) {
    if (!provider || !Array.isArray(provider.models) || !provider.models.length) {
      continue;
    }
    if (provider.available === false && !provider.configured) {
      continue;
    }

    nextConfig.providers[providerId] ??= {};
    nextConfig.providers[providerId].models = provider.models;
    refreshed.push({
      providerId,
      modelCount: provider.models.length
    });
  }

  const ollama = providers.ollama;
  if (ollama?.host) {
    const nextOllama = {
      ...(globalConfig.config.providers?.ollama ?? {}),
      ...(projectConfig.config.providers?.ollama ?? {})
    };
    if (!nextOllama.host) {
      nextConfig.providers.ollama ??= {};
      nextConfig.providers.ollama.host = ollama.host;
    }
    if (Array.isArray(ollama.endpoints) && ollama.endpoints.length) {
      nextConfig.providers.ollama ??= {};
      nextConfig.providers.ollama.endpoints = ollama.endpoints;
    }
  }

  try {
    await replaceConfig(configPath, nextConfig);
  } catch (error) {
    if (!ignoreWriteErrors || !isConfigWriteAccessError(error)) {
      throw error;
    }
    return {
      configPath,
      refreshed,
      providerState,
      warning: `Could not update ${configPath}: ${error.message}`
    };
  }

  return {
    configPath,
    refreshed,
    providerState,
    warning: null
  };
}

export function invalidateOllamaDiscoveryCache(root = null) {
  if (root) {
    ollamaDiscoveryCache.clear();
    return;
  }
  ollamaDiscoveryCache.clear();
}

function resolveOllamaHosts(config) {
  return normalizeOllamaHosts([config?.host, ...(config?.endpoints ?? [])]);
}

function normalizeOllamaHosts(hosts) {
  const seen = new Set();
  const result = [];

  for (const host of Array.isArray(hosts) ? hosts : []) {
    const normalized = normalizeOllamaHost(host);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }

  if (!result.length) {
    result.push(normalizeOllamaHost(process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434"));
  }

  return result.filter(Boolean);
}

function normalizeOllamaEndpointList(hosts) {
  const seen = new Set();
  const result = [];

  for (const host of Array.isArray(hosts) ? hosts : []) {
    const normalized = normalizeOllamaHost(host);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

async function probeOllamaHosts({ hosts = [], reference = [], cachedModels = [] } = {}) {
  const normalizedHosts = normalizeOllamaHosts(hosts);
  const probes = await Promise.all(normalizedHosts.map((host) => probeOllama({ host })));
  const liveModels = mergeOllamaModels(probes, reference);
  const configuredModels = mergeConfiguredOllamaModels(cachedModels, normalizedHosts, reference);
  const models = liveModels.length ? liveModels : configuredModels;
  const primaryProbe = probes.find((probe) => probe.installed && Array.isArray(probe.models) && probe.models.length) ?? probes[0] ?? null;

  return {
    installed: probes.some((probe) => probe.installed && Array.isArray(probe.models) && probe.models.length > 0),
    models,
    details: JSON.stringify({
      hostCount: normalizedHosts.length,
      installedHostCount: probes.filter((probe) => probe.installed).length,
      modelCount: models.length
    }),
    host: primaryProbe?.host ?? normalizedHosts[0] ?? null,
    hosts: normalizedHosts,
    probes
  };
}

function mergeOllamaModels(probes, reference = []) {
  const merged = new Map();

  for (const probe of probes) {
    if (!probe?.installed || !Array.isArray(probe.models)) {
      continue;
    }

    for (const model of probe.models) {
      const id = String(model?.id ?? "").trim();
      if (!id || merged.has(id)) {
        continue;
      }
      const sizeB = typeof model?.sizeB === "number" ? model.sizeB : estimateOllamaModelSizeB(id);
      const profile = profileOllamaModel(id, sizeB, reference);
      merged.set(id, {
        id,
        host: probe.host ?? null,
        quality: profile.quality,
        costTier: 1,
        sizeB,
        capabilities: profile.capabilities,
        strengths: profile.strengths
      });
    }
  }

  return [...merged.values()];
}

function mergeConfiguredOllamaModels(cachedModels, hosts, reference = []) {
  const merged = new Map();
  const fallbackHost = hosts[0] ?? null;

  for (const model of Array.isArray(cachedModels) ? cachedModels : []) {
    const id = String(model?.id ?? "").trim();
    if (!id || merged.has(id)) {
      continue;
    }

    const sizeB = typeof model?.sizeB === "number" ? model.sizeB : estimateOllamaModelSizeB(id);
    const profile = profileOllamaModel(id, sizeB, reference);
    merged.set(id, {
      id,
      host: normalizeOllamaHost(model?.host ?? fallbackHost) ?? fallbackHost,
      quality: model?.quality ?? profile.quality,
      costTier: model?.costTier ?? 1,
      sizeB,
      capabilities: model?.capabilities ?? profile.capabilities,
      strengths: Array.isArray(model?.strengths) ? model.strengths : profile.strengths
    });
  }

  return [...merged.values()];
}

export function profileOllamaModel(id, sizeB, reference = []) {
  const lower = id.toLowerCase();
  
  // 1. Exact or Prefix Match in Reference
  const ref = reference.find((m) => lower === m.id || lower.startsWith(`${m.id}:`));
  if (ref) {
    const { id: _ignored, speed: _speed, ...capabilities } = ref;
    return {
      quality: classifyOllamaModel(id, sizeB),
      capabilities,
      strengths: Object.entries(capabilities)
        .filter(([_, score]) => score >= 3.0)
        .map(([cap, _]) => cap)
    };
  }

  // 2. Heuristic Inference for Unknown Models
  const quality = classifyOllamaModel(id, sizeB);
  const base = quality === "high" ? 3.5 : (quality === "medium" ? 2.5 : 1.5);
  
  const inferred = {
    logic: lower.includes("coder") ? base + 1 : base,
    strategy: lower.includes("r1") || lower.includes("reasoning") ? base + 1.5 : base,
    prose: lower.includes("llama") || lower.includes("mistral") ? base + 0.5 : base,
    creative: lower.includes("hermes") || lower.includes("stheno") ? base + 1 : base,
    visual: lower.includes("vision") ? base + 2 : (lower.includes("moondream") ? 3.5 : 0)
  };

  return {
    quality,
    capabilities: inferred,
    strengths: Object.entries(inferred)
      .filter(([_, score]) => score >= 3.0)
      .map(([cap, _]) => cap)
  };
}

function classifyOllamaModel(model, sizeB) {
  const lower = model.toLowerCase();
  const effectiveSize = sizeB ?? estimateOllamaModelSizeB(model) ?? 0;

  if (effectiveSize >= 30 || lower.includes("70b") || lower.includes("large")) {
    return "high";
  }
  if (effectiveSize >= 7 || lower.includes("8b") || lower.includes("12b") || lower.includes("14b")) {
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

function normalizeProviderQuota(quota = {}) {
  const freeUsdRemaining = normalizeMoney(quota?.freeUsdRemaining);
  const monthlyFreeUsd = normalizeMoney(quota?.monthlyFreeUsd);
  const resetAt = quota?.resetAt ? String(quota.resetAt).trim() : null;

  return {
    freeUsdRemaining,
    monthlyFreeUsd,
    resetAt,
    exhausted: freeUsdRemaining !== null ? freeUsdRemaining <= 0 : false
  };
}

function refreshQuotaWindow(quota = {}, now = new Date()) {
  const normalized = normalizeProviderQuota(quota);
  if (normalized.monthlyFreeUsd === null || !normalized.resetAt) {
    return { changed: false, quota };
  }

  const resetDate = parseDateOnly(normalized.resetAt);
  if (!resetDate) {
    return { changed: false, quota };
  }

  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (today < resetDate) {
    return { changed: false, quota };
  }

  const nextReset = advanceMonth(resetDate);
  return {
    changed: true,
    quota: {
      ...quota,
      freeUsdRemaining: normalized.monthlyFreeUsd,
      monthlyFreeUsd: normalized.monthlyFreeUsd,
      resetAt: formatDateOnly(nextReset)
    }
  };
}

function parseDateOnly(value) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateOnly(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function advanceMonth(date) {
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  const targetDay = date.getUTCDate();
  const monthEnd = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(targetDay, monthEnd));
  return next;
}

function normalizeMoney(value) {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(2)) : null;
}
