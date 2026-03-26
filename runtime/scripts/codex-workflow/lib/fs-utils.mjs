import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";

export async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readText(filePath, fallback = "") {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return fallback;
    }

    throw error;
  }
}

export async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
}

export function resolveRootPath(root, relativePath) {
  return path.resolve(root, relativePath);
}

export function normalizePath(filePath) {
  return filePath.split(path.sep).join("/");
}

export function isWorkflowStatePath(filePath) {
  const normalized = normalizePath(String(filePath));
  return /^\.ai-workflow\/state\//.test(normalized);
}
