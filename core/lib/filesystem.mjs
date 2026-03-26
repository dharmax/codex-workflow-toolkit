import path from "node:path";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { ensureDir } from "../../runtime/scripts/codex-workflow/lib/fs-utils.mjs";
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
        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (shouldIgnoreFile(entry.name, relativePath)) {
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
