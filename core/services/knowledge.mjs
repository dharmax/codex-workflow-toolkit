import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { getGlobalConfigPath, getProjectConfigPath, readConfigSafe } from "../../cli/lib/config-store.mjs";
import { readText } from "../../runtime/scripts/ai-workflow/lib/fs-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILTIN_KNOWLEDGE_PATH = path.resolve(__dirname, "../../shared/knowledge.json");
const MODEL_REFERENCE_PATH = path.resolve(__dirname, "../../shared/model-reference.json");

export async function loadKnowledge({ root = process.cwd(), projectConfig = {}, globalConfig = {} } = {}) {
  const [builtinText, referenceText] = await Promise.all([
    readText(BUILTIN_KNOWLEDGE_PATH, "{}"),
    readText(MODEL_REFERENCE_PATH, "{\"models\":[]}")
  ]);
  const builtin = JSON.parse(builtinText);
  const reference = JSON.parse(referenceText);

  // Merge hierarchy: Builtin < Global < Project
  return {
    version: projectConfig.knowledge?.version ?? builtin.version,
    modelReference: reference.models,
    tasks: mergeLists(builtin.tasks, globalConfig.knowledge?.tasks, projectConfig.knowledge?.tasks),
    capabilityMapping: {
      ...builtin.capabilityMapping,
      ...(globalConfig.knowledge?.capabilityMapping ?? {}),
      ...(projectConfig.knowledge?.capabilityMapping ?? {})
    },
    minimumQuality: {
      ...builtin.minimumQuality,
      ...(globalConfig.knowledge?.minimumQuality ?? {}),
      ...(projectConfig.knowledge?.minimumQuality ?? {})
    },
    models: mergeModels(builtin.models, globalConfig.knowledge?.models, projectConfig.knowledge?.models)
  };
}

export async function updateKnowledgeRemote({
  root = process.cwd(),
  sourceUrl = null,
  destinationPath = BUILTIN_KNOWLEDGE_PATH,
  fetchImpl = globalThis.fetch,
  projectConfig = null,
  globalConfig = null
} = {}) {
  if (typeof fetchImpl !== "function") {
    return {
      success: false,
      skipped: false,
      reason: "Fetch is not available in this runtime.",
      destinationPath
    };
  }

  const resolvedUrl = await resolveKnowledgeRemoteUrl({
    root,
    sourceUrl,
    projectConfig,
    globalConfig
  });

  if (!resolvedUrl) {
    return {
      success: false,
      skipped: true,
      reason: "No remote knowledge URL configured.",
      destinationPath,
      hint: "Set AIWF_BUILTIN_KNOWLEDGE_URL or configure knowledge.remoteUrl in project/global config."
    };
  }

  const response = await fetchImpl(resolvedUrl);
  if (!response?.ok) {
    return {
      success: false,
      skipped: false,
      reason: `Fetch failed with status ${response?.status ?? "unknown"}.`,
      status: response?.status ?? null,
      statusText: response?.statusText ?? null,
      sourceUrl: resolvedUrl,
      destinationPath
    };
  }

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    return {
      success: false,
      skipped: false,
      reason: `Remote knowledge payload is not valid JSON: ${error.message}`,
      sourceUrl: resolvedUrl,
      destinationPath
    };
  }

  let normalized;
  try {
    normalized = normalizeKnowledgePayload(payload);
  } catch (error) {
    return {
      success: false,
      skipped: false,
      reason: error.message,
      sourceUrl: resolvedUrl,
      destinationPath
    };
  }

  await mkdir(path.dirname(destinationPath), { recursive: true });
  await writeFile(destinationPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");

  return {
    success: true,
    skipped: false,
    sourceUrl: resolvedUrl,
    destinationPath,
    version: normalized.version,
    taskCount: normalized.tasks.length,
    modelProviderCount: Object.keys(normalized.models ?? {}).length
  };
}

function mergeLists(...lists) {
  const set = new Set();
  for (const list of lists) {
    if (Array.isArray(list)) {
      for (const item of list) set.add(item);
    }
  }
  return [...set];
}

function mergeModels(builtin, global = {}, project = {}) {
  const providers = new Set([...Object.keys(builtin), ...Object.keys(global), ...Object.keys(project)]);
  const result = {};

  for (const id of providers) {
    // For now, we simple-merge the model arrays. 
    // In a more advanced version, we could merge specific model entries by ID.
    result[id] = project[id] ?? global[id] ?? builtin[id] ?? [];
  }

  return result;
}

async function resolveKnowledgeRemoteUrl({ root, sourceUrl, projectConfig, globalConfig }) {
  if (sourceUrl) {
    return String(sourceUrl).trim() || null;
  }

  const [projectResult, globalResult] = await Promise.all([
    projectConfig ? Promise.resolve({ config: projectConfig }) : readConfigSafe(getProjectConfigPath(root)),
    globalConfig ? Promise.resolve({ config: globalConfig }) : readConfigSafe(getGlobalConfigPath())
  ]);

  return (
    process.env.AIWF_BUILTIN_KNOWLEDGE_URL
    ?? projectResult.config?.knowledge?.remoteUrl
    ?? globalResult.config?.knowledge?.remoteUrl
    ?? null
  );
}

function normalizeKnowledgePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Remote knowledge payload must be a JSON object.");
  }

  return {
    ...payload,
    version: String(payload.version ?? "").trim() || "unknown",
    tasks: normalizeStringArray(payload.tasks),
    capabilityMapping: normalizeStringMap(payload.capabilityMapping),
    minimumQuality: normalizeStringMap(payload.minimumQuality),
    inferenceHeuristics: isPlainObject(payload.inferenceHeuristics) ? payload.inferenceHeuristics : {},
    models: normalizeModelGroups(payload.models)
  };
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))]
    : [];
}

function normalizeStringMap(value) {
  if (!isPlainObject(value)) {
    return {};
  }

  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = String(key ?? "").trim();
    const normalizedValue = String(entry ?? "").trim();
    if (normalizedKey && normalizedValue) {
      result[normalizedKey] = normalizedValue;
    }
  }
  return result;
}

function normalizeModelGroups(value) {
  if (!isPlainObject(value)) {
    return {};
  }

  const result = {};
  for (const [providerId, models] of Object.entries(value)) {
    if (!Array.isArray(models)) {
      continue;
    }
    result[providerId] = models.filter((model) => isPlainObject(model) && String(model.id ?? "").trim());
  }
  return result;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
