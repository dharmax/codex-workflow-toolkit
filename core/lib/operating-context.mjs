import path from "node:path";
import { fileURLToPath } from "node:url";
import { getGlobalConfigPath, getProjectConfigPath, readConfigSafe } from "../../cli/lib/config-store.mjs";

const coreLibDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(coreLibDir, "../..");

export function getToolkitRoot() {
  const fromEnv = process.env.AI_WORKFLOW_TOOLKIT_ROOT;
  if (fromEnv) {
    return path.resolve(fromEnv);
  }
  return repoRoot;
}

export async function resolveOperatingContext({
  cwd = process.cwd(),
  mode = null,
  root = null,
  evidenceRoot = null,
  allowExternalTarget = false
} = {}) {
  const toolkitRoot = getToolkitRoot();
  const projectConfigPath = getProjectConfigPath(cwd);
  const globalConfigPath = getGlobalConfigPath();
  const [projectConfigResult, globalConfigResult] = await Promise.all([
    readConfigSafe(projectConfigPath),
    readConfigSafe(globalConfigPath)
  ]);

  const projectMode = projectConfigResult.config?.mode;
  const globalMode = globalConfigResult.config?.mode;
  const resolvedMode = normalizeMode(mode ?? projectMode ?? globalMode ?? "default");
  const requestedRoot = root ? path.resolve(String(root)) : null;
  const resolvedEvidenceRoot = evidenceRoot ? path.resolve(String(evidenceRoot)) : path.resolve(cwd);
  const repairTargetRoot = requestedRoot ?? (resolvedMode === "tool-dev" ? toolkitRoot : path.resolve(cwd));
  const externalTarget = path.resolve(repairTargetRoot) !== path.resolve(toolkitRoot);

  return {
    mode: resolvedMode,
    toolkitRoot,
    repairTargetRoot,
    evidenceRoot: resolvedEvidenceRoot,
    externalTarget,
    externalTargetAllowed: Boolean(allowExternalTarget),
    projectConfigPath,
    globalConfigPath
  };
}

export function assertSafeRepairTarget(context, options = {}) {
  if (!context) return;
  if (context.mode !== "tool-dev") return;
  if (!context.externalTarget) return;
  if (context.externalTargetAllowed) return;

  const action = options.action ? ` for ${options.action}` : "";
  throw new Error(`tool-dev mode refuses external repair target${action}: ${context.repairTargetRoot}. Use --allow-external-target to override.`);
}

function normalizeMode(value) {
  const normalized = String(value ?? "default").trim().toLowerCase();
  return normalized === "tool-dev" ? "tool-dev" : "default";
}
