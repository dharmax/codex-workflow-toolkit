import path from "node:path";
import { fileURLToPath } from "node:url";
import { readdir, readFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";

const cliDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(cliDir, "../..");

export function getToolkitRoot() {
  const fromEnv = process.env.AI_WORKFLOW_TOOLKIT_ROOT;
  if (fromEnv) {
    return path.resolve(fromEnv);
  }

  const homeAlias = path.resolve(process.env.HOME ?? "", "ai-workflow");
  if (homeAlias && existsSync(homeAlias)) {
    try {
      if (realpathSync(homeAlias) === realpathSync(repoRoot)) {
        return homeAlias;
      }
    } catch {}
  }

  return repoRoot;
}

export function getSharedCodeletsDir() {
  return path.resolve(getToolkitRoot(), "shared", "codelets");
}

export async function listToolkitCodelets() {
  const manifests = [];
  const entries = await readdir(getSharedCodeletsDir(), { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }

    const manifestPath = path.resolve(getSharedCodeletsDir(), entry.name);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifests.push(resolveManifest(manifest, manifestPath));
  }

  return manifests.sort((left, right) => left.id.localeCompare(right.id));
}

export async function getToolkitCodelet(name) {
  const manifestPath = path.resolve(getSharedCodeletsDir(), `${name}.json`);

  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    return resolveManifest(manifest, manifestPath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function resolveManifest(manifest, manifestPath) {
  const toolkitRoot = getToolkitRoot();
  const resolved = {
    source: "toolkit",
    manifestPath,
    ...manifest
  };

  if (manifest.entry) {
    resolved.entry = path.resolve(toolkitRoot, manifest.entry);
  }

  return resolved;
}
