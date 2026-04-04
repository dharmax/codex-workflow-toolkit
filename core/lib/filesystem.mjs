import path from "node:path";
import { existsSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { ensureDir } from "../../runtime/scripts/ai-workflow/lib/fs-utils.mjs";
import { getAllSupportedExtensions } from "./registry.mjs";

const DEFAULT_IGNORES = new Set([
  ".git",
  "node_modules",
  ".turbo",
  ".next",
  "artifacts",
  "dist",
  "build",
  "coverage",
  "playwright-report",
  "test-results",
  "output",
  ".idea",
  ".vscode"
]);

const GENERATED_FILE_PATTERNS = [
  /^e2e_.*\.(?:txt|json)$/i,
  /(?:^|[-_])(debug|output|report)\.(?:txt|json|md)$/i,
  /^playwright\..*\.json$/i,
  /^actual-test\.mjs$/i,
  /^test-.*\.mjs$/i
];

export function normalizePath(filePath) {
  return filePath.split(path.sep).join("/");
}

export async function collectProjectFiles(root, options = {}) {
  const files = [];
  const ignore = new Set([...DEFAULT_IGNORES, ...(options.ignore ?? [])]);
  const supported = new Set(getAllSupportedExtensions());
  const projectIgnore = await loadProjectIgnore(root);

  async function walk(currentDir) {
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.resolve(currentDir, entry.name);
      const relativePath = normalizePath(path.relative(root, absolutePath));

      if (entry.isDirectory()) {
        if (ignore.has(entry.name)) {
          continue;
        }
        if (relativePath.startsWith(".ai-workflow/cache") || relativePath.startsWith(".ai-workflow/generated")) {
          continue;
        }
        if (shouldIgnorePath(relativePath, projectIgnore)) {
          continue;
        }
        if (await isNestedProjectRoot(root, absolutePath, relativePath)) {
          continue;
        }
        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (shouldIgnoreFile(entry.name, relativePath)) {
        continue;
      }
      if (shouldIgnorePath(relativePath, projectIgnore)) {
        continue;
      }

      if (!supported.has(path.extname(entry.name).toLowerCase())) {
        continue;
      }

      files.push(relativePath);
    }
  }

  await walk(root);
  return files.sort((left, right) => left.localeCompare(right));
}

function shouldIgnoreFile(name, relativePath) {
  const normalizedPath = normalizePath(relativePath);
  if (normalizedPath.startsWith(".ai-workflow/")) {
    return true;
  }
  return GENERATED_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

async function loadProjectIgnore(root) {
  const ignorePath = path.resolve(root, ".ai-workflowignore");
  let text = "";
  try {
    text = await readFile(ignorePath, "utf8");
  } catch {
    return [];
  }

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => normalizeIgnorePattern(line));
}

function normalizeIgnorePattern(pattern) {
  const normalized = normalizePath(String(pattern).trim()).replace(/^\.?\//, "");
  if (!normalized) return "";
  return normalized.endsWith("/") ? normalized : normalized;
}

function shouldIgnorePath(relativePath, patterns) {
  const normalized = normalizePath(relativePath);
  return patterns.some((pattern) => matchesIgnorePattern(normalized, pattern));
}

function matchesIgnorePattern(relativePath, pattern) {
  if (!pattern) return false;
  if (pattern.endsWith("/")) {
    const prefix = pattern.replace(/\/+$/, "");
    return relativePath === prefix || relativePath.startsWith(`${prefix}/`);
  }
  return relativePath === pattern || relativePath.startsWith(`${pattern}/`);
}

async function isNestedProjectRoot(root, absolutePath, relativePath) {
  const normalized = normalizePath(relativePath);
  if (!normalized || normalized.startsWith(".git/") || normalized.startsWith(".ai-workflow/")) {
    return false;
  }

  const packageJsonPath = path.resolve(absolutePath, "package.json");
  const workflowConfigPath = path.resolve(absolutePath, ".ai-workflow", "config.json");
  const docsKanbanPath = path.resolve(absolutePath, "docs", "kanban.md");
  const rootKanbanPath = path.resolve(absolutePath, "kanban.md");
  const nestedScriptPath = path.resolve(absolutePath, "scripts", "ai-workflow");

  if (!existsSync(packageJsonPath)) {
    return false;
  }

  const hasProjectMarkers = existsSync(workflowConfigPath)
    || existsSync(docsKanbanPath)
    || existsSync(rootKanbanPath)
    || existsSync(nestedScriptPath);

  return hasProjectMarkers;
}

export async function readProjectFile(root, relativePath) {
  const absolutePath = path.resolve(root, relativePath);
  const stats = await stat(absolutePath);
  
  // Item 38: Binary Safety - Skip indexing for large or binary-looking files
  if (stats.size > 2 * 1024 * 1024) { // 2MB limit for text indexing
    return { 
      absolutePath, 
      relativePath: normalizePath(relativePath), 
      content: "", 
      sizeBytes: stats.size, 
      mtimeMs: Number(stats.mtimeMs.toFixed(0)),
      isBinary: true 
    };
  }

  const content = await readFile(absolutePath, "utf8");
  // Heuristic: check for null bytes
  const isBinary = content.includes("\0");
  
  return {
    absolutePath,
    relativePath: normalizePath(relativePath),
    content: isBinary ? "" : content,
    sizeBytes: stats.size,
    mtimeMs: Number(stats.mtimeMs.toFixed(0)),
    isBinary
  };
}

export async function writeProjectFile(root, relativePath, content) {
  const absolutePath = path.resolve(root, relativePath);
  const tempPath = `${absolutePath}.tmp-${Date.now()}`;
  const { rename, unlink } = await import("node:fs/promises");
  
  await ensureDir(path.dirname(absolutePath));
  
  try {
    await writeFile(tempPath, content, "utf8");
    await rename(tempPath, absolutePath);
  } catch (error) {
    await unlink(tempPath).catch(() => {}); // Cleanup on failure
    throw error;
  }
}
