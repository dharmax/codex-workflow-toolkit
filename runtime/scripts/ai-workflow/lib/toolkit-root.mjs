import path from "node:path";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

export function getToolkitRoot() {
  const fromEnv = process.env.AI_WORKFLOW_TOOLKIT_ROOT;
  if (fromEnv) {
    return path.resolve(fromEnv);
  }

  const toolkitRootFile = path.resolve(scriptDir, "../toolkit-root.txt");
  if (existsSync(toolkitRootFile)) {
    const content = readFileSync(toolkitRootFile, "utf8").trim();
    if (content) {
      return path.resolve(content);
    }
  }

  const candidate = path.resolve(scriptDir, "../../../../");
  if (existsSync(path.resolve(candidate, "core", "services", "sync.mjs"))) {
    return candidate;
  }

  throw new Error("Unable to resolve ai-workflow toolkit root. Set AI_WORKFLOW_TOOLKIT_ROOT.");
}
