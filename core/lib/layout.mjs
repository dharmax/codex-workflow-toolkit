import path from "node:path";
import { readdir } from "node:fs/promises";
import { isFolderRole } from "./registry.mjs";

/**
 * Abstraction for project layout and functional directory discovery.
 * Driven by the Semantic Registry.
 */

export async function findFunctionalDir(root, role) {
  const entries = await readdir(root, { withFileTypes: true });
  
  // 1. Semantic match based on registry
  for (const entry of entries.filter(e => e.isDirectory())) {
    if (isFolderRole(entry.name, role)) {
      return path.resolve(root, entry.name);
    }
  }
  
  // 2. Functional match (look inside directories for specific markers)
  if (role === "STATE") {
    for (const entry of entries.filter(e => e.isDirectory())) {
      const subEntries = await readdir(path.resolve(root, entry.name)).catch(() => []);
      if (subEntries.includes("state") || subEntries.includes("workflow.db")) {
        return path.resolve(root, entry.name);
      }
    }
  }
  
  // Fallback to reasonable defaults if nothing found
  const defaults = { STATE: ".ai-workflow", CONFIG: ".gemini", TEMPLATES: "templates" };
  return path.resolve(root, defaults[role] || role.toLowerCase());
}

export async function getProjectLayout(root) {
  const [state, config, templates] = await Promise.all([
    findFunctionalDir(root, "STATE"),
    findFunctionalDir(root, "CONFIG"),
    findFunctionalDir(root, "TEMPLATES")
  ]);
  
  return { root, state, config, templates };
}
