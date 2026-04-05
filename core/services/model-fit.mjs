import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { sha1 } from "../lib/hash.mjs";
import { searchWebEvidence } from "./web-search.mjs";

const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export async function buildModelFitMatrix({
  root = process.cwd(),
  providerState,
  taskClass = "shell-planning",
  forceRefresh = false,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  allowRemoteEnrichment = true,
  allowWebEnrichment = true
} = {}) {
  if (!providerState || typeof providerState !== "object") {
    return {
      taskClass,
      generatedAt: new Date().toISOString(),
      fingerprint: null,
      source: "empty",
      evaluator: null,
      models: []
    };
  }

  const fingerprint = computeMatrixFingerprint(providerState, taskClass);
  const cached = forceRefresh ? null : await readModelFitCache(root).catch(() => null);
  if (cached && cached.fingerprint === fingerprint && isFresh(cached.generatedAt, cacheTtlMs)) {
    return cached;
  }

  const webEvidence = allowWebEnrichment
    ? await collectWebEvidence({ root, providerState, taskClass, forceRefresh, cacheTtlMs })
    : null;
  const heuristics = buildHeuristicMatrix(providerState, taskClass, webEvidence);
  const evaluator = allowRemoteEnrichment ? selectMatrixEvaluator(providerState) : null;
  const enriched = evaluator
    ? await enrichMatrixWithRemoteEvaluator({ providerState, taskClass, evaluator, heuristics, webEvidence })
    : heuristics;
  const models = Array.isArray(enriched) ? enriched : Array.isArray(enriched?.models) ? enriched.models : [];

  const result = {
    taskClass,
    generatedAt: new Date().toISOString(),
    fingerprint,
    source: [
      "heuristic",
      webEvidence?.profiles?.length ? "web" : null,
      evaluator ? "ai" : null
    ].filter(Boolean).join("+"),
    evaluator: evaluator ? { providerId: evaluator.providerId, modelId: evaluator.modelId } : null,
    evidence: webEvidence,
    models
  };

  await writeModelFitCache(root, result).catch(() => {});
  return result;
}

export async function invalidateModelFitCache(root = process.cwd()) {
  const cachePath = getModelFitCachePath(root);
  await rm(cachePath, { force: true });
}

export function applyModelFitMatrix(providerState, matrix) {
  const clonedProviders = {};
  const entries = new Map();
  for (const item of Array.isArray(matrix?.models) ? matrix.models : []) {
    entries.set(`${item.providerId}:${item.modelId}`, item);
  }

  for (const [providerId, provider] of Object.entries(providerState?.providers ?? {})) {
    const providerClone = {
      ...provider,
      models: Array.isArray(provider.models)
        ? provider.models.map((model) => {
          const key = `${providerId}:${model.id}`;
          const fit = entries.get(key) ?? null;
          return {
            ...model,
            fitScore: fit?.fitScore ?? model.fitScore ?? null,
            fitReasons: fit?.fitReasons ?? model.fitReasons ?? [],
            fitSource: fit?.source ?? model.fitSource ?? null
          };
        }).sort((left, right) => {
          const leftScore = typeof left.fitScore === "number" ? left.fitScore : -1;
          const rightScore = typeof right.fitScore === "number" ? right.fitScore : -1;
          return rightScore - leftScore || qualityRank(right.quality) - qualityRank(left.quality) || (left.sizeB ?? Number.POSITIVE_INFINITY) - (right.sizeB ?? Number.POSITIVE_INFINITY) || left.id.localeCompare(right.id);
        })
        : []
    };

    clonedProviders[providerId] = providerClone;
  }

  return {
    ...providerState,
    providers: clonedProviders,
    modelFitMatrix: matrix
  };
}

function buildHeuristicMatrix(providerState, taskClass, webEvidence = null) {
  const providers = providerState.providers ?? {};
  const taskWeights = getTaskWeights(taskClass);
  const capabilities = providerState.knowledge?.inferenceHeuristics ?? {};
  const models = [];

  for (const [providerId, provider] of Object.entries(providers)) {
    for (const model of Array.isArray(provider.models) ? provider.models : []) {
      const family = extractModelFamily(model.id);
      const webProfile = webEvidence?.byFamily?.[family] ?? null;
      const fit = scoreModel({
        providerId,
        provider,
        model,
        taskClass,
        taskWeights,
        heuristics: capabilities,
        webProfile
      });

      models.push({
        providerId,
        modelId: model.id,
        local: Boolean(provider.local),
        quality: model.quality ?? "medium",
        costTier: model.costTier ?? (provider.local ? 1 : 3),
        sizeB: model.sizeB ?? null,
        capabilities: model.capabilities ?? {},
        fitScore: fit.fitScore,
        fitReasons: fit.reasons,
        source: webProfile ? "heuristic+web" : "heuristic"
      });
    }
  }

  models.sort((left, right) => right.fitScore - left.fitScore || left.providerId.localeCompare(right.providerId) || left.modelId.localeCompare(right.modelId));
  return { taskClass, models };
}

async function enrichMatrixWithRemoteEvaluator({ providerState, taskClass, evaluator, heuristics, webEvidence }) {
  const base = buildHeuristicMatrix(providerState, taskClass, webEvidence);
  const payload = {
    taskClass,
    hardware: describeHardware(providerState),
    webEvidence,
    models: base.models.map((model) => ({
      providerId: model.providerId,
      modelId: model.modelId,
      local: model.local,
      quality: model.quality,
      costTier: model.costTier,
      sizeB: model.sizeB,
      capabilities: model.capabilities,
      baseFitScore: model.fitScore,
      baseFitReasons: model.fitReasons
    })),
    knowledge: {
      minimumQuality: providerState.knowledge?.minimumQuality ?? {},
      inferenceHeuristics: heuristics
    }
  };

  try {
    const { generateCompletion } = await import("./providers.mjs");
    const response = await generateCompletion({
      providerId: evaluator.providerId,
      modelId: evaluator.modelId,
      prompt: [
        "Rank the installed models for the current task.",
        "Return JSON only with a top-level object containing `ranked`.",
        "Each ranked item must include `providerId`, `modelId`, `fitScore` (0-100), and `reasons` (string array).",
        "Do not invent models not listed in the input.",
        "Use the web evidence as a fresh signal when present, but keep the ranking conservative.",
        "",
        JSON.stringify(payload, null, 2)
      ].join("\n"),
      system: [
        "You are a model-routing analyst.",
        "Prefer the best currently available model for the current hardware and task.",
        "Be conservative when the hardware budget is tight.",
        "Return only JSON."
      ].join("\n"),
      config: evaluator.config
    });

    const parsed = parseRemoteMatrixResponse(response.response);
    if (!parsed?.ranked?.length) {
      return base.models;
    }

    const byKey = new Map(base.models.map((item) => [`${item.providerId}:${item.modelId}`, item]));
    for (const ranked of parsed.ranked) {
      const key = `${ranked.providerId}:${ranked.modelId}`;
      const current = byKey.get(key);
      if (!current) continue;
      const aiScore = normalizeScore(ranked.fitScore);
      if (aiScore === null) continue;

      current.fitScore = Math.round((current.fitScore * 0.6) + (aiScore * 0.4));
      current.fitReasons = mergeReasons(current.fitReasons, ranked.reasons);
      current.source = current.source === "heuristic+web" ? "heuristic+web+ai" : "heuristic+ai";
    }

    base.models.sort((left, right) => right.fitScore - left.fitScore || left.providerId.localeCompare(right.providerId) || left.modelId.localeCompare(right.modelId));
    return base.models;
  } catch {
    return base.models;
  }
}

function selectMatrixEvaluator(providerState) {
  const providers = providerState.providers ?? {};
  const candidates = [];

  for (const [providerId, provider] of Object.entries(providers)) {
    if (provider.local || provider.available === false || !provider.apiKey) {
      continue;
    }
    const models = Array.isArray(provider.models) ? provider.models : [];
    if (!models.length) {
      continue;
    }

    const bestModel = [...models].sort((left, right) => qualityRank(right.quality) - qualityRank(left.quality) || (right.costTier ?? 99) - (left.costTier ?? 99) || left.id.localeCompare(right.id))[0];
    if (!bestModel?.id) {
      continue;
    }

    candidates.push({
      providerId,
      modelId: bestModel.id,
      config: {
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl
      },
      score: (provider.quota?.freeUsdRemaining ?? 0) > 0 ? 2 : 1
    });
  }

  candidates.sort((left, right) => right.score - left.score || left.providerId.localeCompare(right.providerId) || left.modelId.localeCompare(right.modelId));
  return candidates[0] ?? null;
}

function scoreModel({ providerId, provider, model, taskClass, taskWeights, heuristics, webProfile }) {
  const inferred = inferModelCapabilities(model, heuristics);
  const capabilities = blendCapabilities(model.capabilities ?? {}, inferred);
  const capabilityScore = scoreCapabilities(capabilities, taskWeights);
  const qualityBonus = {
    low: 6,
    medium: 12,
    high: 18
  }[model.quality ?? "medium"] ?? 12;
  const localityBonus = provider.local ? 12 : 0;
  const hardwareBonus = provider.local ? scoreLocalHardware(provider, model) : 0;
  const familyBonus = scoreFamilyBonus(model.id, taskClass);
  const costBonus = scoreCostBonus(provider);
  const webBonus = scoreWebEvidence(webProfile, taskWeights);
  const fitScore = clampScore(capabilityScore + qualityBonus + localityBonus + hardwareBonus + familyBonus + costBonus + webBonus.score);

  const reasons = [
    `capability fit ${capabilityScore.toFixed(1)}/100`,
    `quality ${model.quality ?? "medium"}`,
    provider.local ? "local provider" : "remote provider"
  ];
  if (hardwareBonus > 0) {
    reasons.push(`hardware fit +${hardwareBonus.toFixed(1)}`);
  }
  if (familyBonus > 0) {
    reasons.push(`model family fit +${familyBonus.toFixed(1)}`);
  }
  if (costBonus !== 0) {
    reasons.push(`cost signal ${costBonus > 0 ? "+" : ""}${costBonus.toFixed(1)}`);
  }
  if (webBonus.score !== 0) {
    reasons.push(`web evidence ${webBonus.score > 0 ? "+" : ""}${webBonus.score.toFixed(1)}`);
    reasons.push(...webBonus.reasons);
  }

  return { fitScore, reasons };
}

async function collectWebEvidence({ root, providerState, taskClass, forceRefresh, cacheTtlMs }) {
  const models = collectModelFamilies(providerState);
  if (!models.length) {
    return null;
  }

  const taskQuery = getWebTaskQuery(taskClass);
  const queries = models.slice(0, 8).map((family) => ({
    family,
    query: `${family} ${taskQuery}`.trim()
  }));

  const profiles = await Promise.all(queries.map(async ({ family, query }) => {
    const result = await searchWebEvidence({
      root,
      query,
      forceRefresh,
      cacheTtlMs,
      maxResults: 4
    });
    return {
      family,
      query,
      ...result
    };
  }));

  const byFamily = {};
  for (const profile of profiles) {
    byFamily[profile.family] = {
      ...profile,
      signals: scoreWebSignals(profile.results ?? [], taskClass)
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    taskClass,
    profiles,
    byFamily
  };
}

function scoreWebEvidence(webProfile, taskWeights) {
  if (!webProfile || !Array.isArray(webProfile.results) || !webProfile.results.length) {
    return { score: 0, reasons: [] };
  }

  const signals = webProfile.signals ?? scoreWebSignals(webProfile.results, "shell-planning");
  const score = clampScoreFromSignals(signals, taskWeights);
  const reasons = [];
  if (signals.logic > 0) reasons.push("web search mentions coding / benchmark evidence");
  if (signals.strategy > 0) reasons.push("web search mentions reasoning / planning evidence");
  if (signals.prose > 0) reasons.push("web search mentions assistant / instruction evidence");
  if (signals.visual > 0) reasons.push("web search mentions vision evidence");
  if (signals.speed > 0) reasons.push("web search mentions speed / small-model evidence");

  return { score, reasons };
}

function scoreWebSignals(results = [], taskClass = "shell-planning") {
  const taskTerms = getTaskWebTerms(taskClass);
  const text = results
    .map((result) => `${result.title ?? ""} ${result.snippet ?? ""}`)
    .join(" ")
    .toLowerCase();

  return {
    logic: countSignalTerms(text, ["code", "coding", "coder", "programming", "software", "benchmark", "math", ...taskTerms.logic]),
    strategy: countSignalTerms(text, ["reason", "reasoning", "plan", "planner", "agent", "analysis", ...taskTerms.strategy]),
    prose: countSignalTerms(text, ["chat", "assistant", "instruction", "general", "conversation", "prose", ...taskTerms.prose]),
    visual: countSignalTerms(text, ["vision", "image", "multimodal", "visual", ...taskTerms.visual]),
    speed: countSignalTerms(text, ["fast", "small", "efficient", "low latency", "lightweight", "quantized", ...taskTerms.speed])
  };
}

function clampScoreFromSignals(signals, taskWeights) {
  if (!signals) {
    return 0;
  }

  const strategy = Number(signals.strategy ?? 0);
  const logic = Number(signals.logic ?? 0);
  const prose = Number(signals.prose ?? 0);
  const visual = Number(signals.visual ?? 0);
  const speed = Number(signals.speed ?? 0);
  const score = (
    strategy * (taskWeights.strategy ?? 0)
    + logic * (taskWeights.logic ?? 0)
    + prose * (taskWeights.prose ?? 0)
    + visual * (taskWeights.visual ?? 0)
    + speed * 0.15
  ) * 4;
  return Math.max(-6, Math.min(8, Number(score.toFixed(1))));
}

function getTaskWebTerms(taskClass) {
  switch (taskClass) {
    case "code-generation":
    case "refactoring":
    case "bug-hunting":
    case "pure-function":
      return { logic: ["coding", "code", "reasoning"], strategy: ["programming", "software"], prose: [], visual: [], speed: [] };
    case "summarization":
    case "note-normalization":
      return { logic: [], strategy: ["summarization"], prose: ["summary", "assistant"], visual: [], speed: [] };
    case "ui-styling":
    case "ui-layout":
    case "graphic-scaffolding":
    case "design-tokens":
    case "artifact-evaluation":
      return { logic: [], strategy: [], prose: [], visual: ["vision", "multimodal", "visual"], speed: [] };
    default:
      return { logic: [], strategy: ["reasoning", "planning"], prose: ["assistant"], visual: [], speed: [] };
  }
}

function collectModelFamilies(providerState) {
  const families = new Set();
  for (const provider of Object.values(providerState.providers ?? {})) {
    for (const model of Array.isArray(provider.models) ? provider.models : []) {
      const family = extractModelFamily(model.id);
      if (family) {
        families.add(family);
      }
    }
  }
  return [...families].sort((left, right) => left.localeCompare(right));
}

function extractModelFamily(modelId) {
  return String(modelId ?? "").trim().toLowerCase().split(":")[0];
}

function countSignalTerms(text, terms = []) {
  let total = 0;
  for (const term of terms) {
    if (!term) continue;
    if (text.includes(String(term).toLowerCase())) {
      total += 1;
    }
  }
  return total;
}

function inferModelCapabilities(model, heuristics = {}) {
  const lower = String(model.id ?? "").toLowerCase();
  const sizeB = typeof model.sizeB === "number" ? model.sizeB : estimateSizeB(model.id);
  const quality = model.quality ?? classifyQuality(sizeB);
  const base = quality === "high" ? 3.5 : quality === "medium" ? 2.5 : 1.5;
  const result = {};
  const entries = Object.entries({
    logic: ["coder", "code", "math", ...(heuristics.logic?.keywords ?? [])],
    strategy: ["reason", "reasoning", "plan", "planner", "agent", "analysis", ...(heuristics.strategy?.keywords ?? [])],
    prose: ["llama", "gemma", "chat", "assistant", ...(heuristics.prose?.keywords ?? [])],
    creative: ["hermes", "stheno", ...(heuristics.creative?.keywords ?? [])],
    visual: ["vision", "moondream", ...(heuristics.visual?.keywords ?? [])],
    data: ["extract", "summary", "json"]
  });

  for (const [capability, keywords] of entries) {
    const matched = keywords.some((keyword) => lower.includes(String(keyword).toLowerCase()));
    result[capability] = matched ? base + 1 : base;
  }

  if (lower.includes("gemma") || lower.includes("llama") || lower.includes("mistral")) {
    result.strategy += 0.5;
    result.prose += 0.5;
  }
  if (lower.includes("coder")) {
    result.logic += 1;
  }

  return result;
}

function scoreCapabilities(capabilities, taskWeights) {
  const totalWeight = Object.values(taskWeights).reduce((sum, weight) => sum + weight, 0) || 1;
  let sum = 0;
  for (const [capability, weight] of Object.entries(taskWeights)) {
    const value = Number(capabilities[capability] ?? 0);
    sum += (Math.max(0, Math.min(5, value)) / 5) * weight;
  }
  return (sum / totalWeight) * 100;
}

function blendCapabilities(primary = {}, secondary = {}) {
  const keys = new Set([...Object.keys(primary ?? {}), ...Object.keys(secondary ?? {})]);
  const blended = {};
  for (const key of keys) {
    const left = Number(primary?.[key] ?? 0);
    const right = Number(secondary?.[key] ?? 0);
    blended[key] = Math.max(left, right);
  }
  return blended;
}

function scoreLocalHardware(provider, model) {
  const maxModelSizeB = provider.maxModelSizeB ?? null;
  if (maxModelSizeB == null) {
    return 4;
  }
  if (model.sizeB == null) {
    return 2;
  }
  if (model.sizeB <= maxModelSizeB) {
    const headroom = maxModelSizeB - model.sizeB;
    return 6 + Math.min(6, headroom * 0.5);
  }
  return -25;
}

function scoreFamilyBonus(modelId, taskClass) {
  const lower = String(modelId ?? "").toLowerCase();
  const codeTask = ["code-generation", "refactoring", "bug-hunting", "pure-function"].includes(taskClass);
  const proseTask = ["shell-planning", "summarization", "prose-composition", "note-normalization"].includes(taskClass);
  let bonus = 0;

  if (codeTask && lower.includes("coder")) {
    bonus += 10;
  }
  if (proseTask && (lower.includes("gemma") || lower.includes("llama") || lower.includes("mistral") || lower.includes("hermes"))) {
    bonus += 8;
  }
  if (taskClass === "shell-planning" && (lower.includes("chat") || lower.includes("assistant") || lower.includes("gemma"))) {
    bonus += 6;
  }
  if (taskClass === "strategy" && (lower.includes("reason") || lower.includes("r1") || lower.includes("gemma"))) {
    bonus += 6;
  }
  if (taskClass === "artifact-evaluation" && (lower.includes("vision") || lower.includes("gemini") || lower.includes("gpt-4o") || lower.includes("claude"))) {
    bonus += 8;
  }

  return bonus;
}

function scoreCostBonus(provider) {
  if (provider.local) {
    return 8;
  }
  const free = provider.quota?.freeUsdRemaining;
  if (typeof free === "number") {
    return free > 0 ? 6 : -4;
  }
  return provider.configured ? 2 : -2;
}

function getTaskWeights(taskClass) {
  switch (taskClass) {
    case "shell-planning":
      return { strategy: 0.4, prose: 0.3, logic: 0.2, data: 0.1 };
    case "summarization":
    case "note-normalization":
      return { data: 0.45, prose: 0.35, strategy: 0.15, logic: 0.05 };
    case "extraction":
      return { data: 0.5, logic: 0.2, prose: 0.2, strategy: 0.1 };
    case "code-generation":
    case "refactoring":
    case "bug-hunting":
    case "pure-function":
      return { logic: 0.45, strategy: 0.3, prose: 0.15, data: 0.1 };
    case "strategy":
    case "task-decomposition":
      return { strategy: 0.45, logic: 0.25, prose: 0.2, data: 0.1 };
    case "ui-styling":
    case "ui-layout":
    case "graphic-scaffolding":
    case "design-tokens":
    case "artifact-evaluation":
      return { visual: 0.45, prose: 0.25, creative: 0.2, logic: 0.1 };
    default:
      return { strategy: 0.3, logic: 0.3, prose: 0.2, data: 0.2 };
  }
}

function getWebTaskQuery(taskClass) {
  switch (taskClass) {
    case "code-generation":
    case "refactoring":
    case "bug-hunting":
    case "pure-function":
      return "coding reasoning benchmark";
    case "summarization":
    case "note-normalization":
      return "summarization assistant benchmark";
    case "ui-styling":
    case "ui-layout":
    case "graphic-scaffolding":
    case "design-tokens":
    case "artifact-evaluation":
      return "vision multimodal benchmark";
    case "strategy":
    case "task-decomposition":
      return "reasoning planning benchmark";
    default:
      return "assistant planning benchmark";
  }
}

function computeMatrixFingerprint(providerState, taskClass) {
  const providers = providerState.providers ?? {};
  const summary = {
    taskClass,
    knowledgeVersion: providerState.knowledge?.version ?? null,
    minimumQuality: providerState.routingPolicy?.minimumQuality ?? {},
    referenceModels: Array.isArray(providerState.knowledge?.modelReference)
      ? providerState.knowledge.modelReference.map((entry) => ({
        id: entry.id,
        logic: entry.logic ?? null,
        strategy: entry.strategy ?? null,
        prose: entry.prose ?? null,
        visual: entry.visual ?? null,
        creative: entry.creative ?? null,
        speed: entry.speed ?? null
      })).sort((left, right) => left.id.localeCompare(right.id))
      : [],
    providers: Object.entries(providers)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([providerId, provider]) => ({
        providerId,
        local: Boolean(provider.local),
        available: provider.available !== false,
        configured: Boolean(provider.configured),
        hardwareClass: provider.hardwareClass ?? null,
        plannerModel: provider.plannerModel ?? null,
        maxModelSizeB: provider.maxModelSizeB ?? null,
        quota: provider.quota ?? null,
        models: Array.isArray(provider.models)
          ? provider.models.map((model) => ({
            id: model.id,
            quality: model.quality ?? null,
            sizeB: model.sizeB ?? null,
            costTier: model.costTier ?? null
          })).sort((left, right) => left.id.localeCompare(right.id))
          : []
      }))
  };
  return sha1(JSON.stringify(summary));
}

function describeHardware(providerState) {
  const ollama = providerState.providers?.ollama ?? {};
  return {
    local: true,
    hardwareClass: ollama.hardwareClass ?? null,
    maxModelSizeB: ollama.maxModelSizeB ?? null,
    plannerModel: ollama.plannerModel ?? null,
    host: ollama.host ?? null
  };
}

function parseRemoteMatrixResponse(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function mergeReasons(primary = [], secondary = []) {
  const seen = new Set();
  const result = [];
  for (const reason of [...primary, ...secondary]) {
    const text = String(reason ?? "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function normalizeScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.max(0, Math.min(100, numeric));
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function qualityRank(value) {
  switch (String(value ?? "").toLowerCase()) {
    case "low":
      return 1;
    case "medium":
      return 2;
    case "high":
      return 3;
    default:
      return 0;
  }
}

function classifyQuality(sizeB) {
  if (sizeB >= 30) return "high";
  if (sizeB >= 7) return "medium";
  return "low";
}

function estimateSizeB(modelId) {
  const match = String(modelId ?? "").toLowerCase().match(/(\d+(?:\.\d+)?)b\b/);
  return match ? Number(match[1]) : null;
}

function isFresh(generatedAt, ttlMs) {
  const started = Date.parse(generatedAt ?? "");
  if (!Number.isFinite(started)) {
    return false;
  }
  return Date.now() - started < ttlMs;
}

async function readModelFitCache(root) {
  const cachePath = getModelFitCachePath(root);
  const text = await readFile(cachePath, "utf8");
  return JSON.parse(text);
}

async function writeModelFitCache(root, payload) {
  const cachePath = getModelFitCachePath(root);
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function getModelFitCachePath(root) {
  return path.resolve(root, ".ai-workflow", "cache", "model-fit-matrix.json");
}
