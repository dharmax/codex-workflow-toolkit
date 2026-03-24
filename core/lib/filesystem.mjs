import path from "node:path";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { ensureDir } from "../../runtime/scripts/codex-workflow/lib/fs-utils.mjs";

const DEFAULT_IGNORES = new Set([
  ".git",
  "node_modules",
  ".turbo",
  ".next",
  "dist",
  "build",
  "coverage",
  ".idea",
  ".vscode"
]);

export const SUPPORTED_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".jsx",
  ".ts",
  ".tsx",
  ".css",
  ".scss",
  ".less",
  ".html",
  ".json",
  ".yaml",
  ".yml",
  ".riot",
  ".md"
]);

export function normalizePath(filePath) {
  return filePath.split(path.sep).join("/");
}

export async function collectProjectFiles(root, options = {}) {
  const files = [];
  const ignore = new Set([...DEFAULT_IGNORES, ...(options.ignore ?? [])]);

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

      if (!SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        continue;
      }

      files.push(relativePath);
    }
  }

  await walk(root);
  return files.sort((left, right) => left.localeCompare(right));
}

export async function readProjectFile(root, relativePath) {
  const absolutePath = path.resolve(root, relativePath);
  const [content, stats] = await Promise.all([
    readFile(absolutePath, "utf8"),
    stat(absolutePath)
  ]);
  return {
    absolutePath,
    relativePath: normalizePath(relativePath),
    content,
    sizeBytes: stats.size,
    mtimeMs: Number(stats.mtimeMs.toFixed(0))
  };
}

export async function writeProjectFile(root, relativePath, content) {
  const absolutePath = path.resolve(root, relativePath);
  await ensureDir(path.dirname(absolutePath));
  await writeFile(absolutePath, content, "utf8");
}
