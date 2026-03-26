import path from "node:path";
import { fileURLToPath } from "node:url";
import { readConfigSafe } from "../../cli/lib/config-store.mjs";
import { readText } from "../../runtime/scripts/codex-workflow/lib/fs-utils.mjs";

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

export async function updateKnowledgeRemote() {
  // TODO: Fetch from a remote URL (e.g. GitHub raw) and write to BUILTIN_KNOWLEDGE_PATH
  // This would be triggered weekly.
  return { success: true, note: "Remote update logic prepared but not yet pointing to a URL." };
}
