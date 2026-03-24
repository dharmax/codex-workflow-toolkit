import os from "node:os";
import path from "node:path";
import { readFile, rm, writeFile } from "node:fs/promises";
import { ensureDir } from "../../runtime/scripts/codex-workflow/lib/fs-utils.mjs";

export function getProjectConfigPath(root = process.cwd()) {
  return path.resolve(root, ".ai-workflow", "config.json");
}

export function getGlobalConfigPath() {
  return path.resolve(os.homedir(), ".ai-workflow", "config.json");
}

export async function readConfig(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {};
    }

    throw new Error(`Could not parse config ${filePath}: ${error.message}`);
  }
}

export async function readConfigSafe(filePath) {
  try {
    return {
      config: await readConfig(filePath),
      warning: null
    };
  } catch (error) {
    return {
      config: {},
      warning: error?.message ?? String(error)
    };
  }
}

export async function writeConfigValue(filePath, keyPath, rawValue) {
  const config = await readConfig(filePath);
  const keys = splitKeyPath(keyPath);
  let cursor = config;

  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index];
    const current = cursor[key];
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }

  cursor[keys.at(-1)] = parseValue(rawValue);
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return config;
}

export async function removeConfigValue(filePath, keyPath) {
  const config = await readConfig(filePath);
  const keys = splitKeyPath(keyPath);
  let cursor = config;

  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index];
    if (!cursor[key] || typeof cursor[key] !== "object") {
      return config;
    }
    cursor = cursor[key];
  }

  delete cursor[keys.at(-1)];
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return config;
}

export async function removeConfigFile(filePath) {
  await rm(filePath, { force: true });
}

export function getConfigValue(config, keyPath) {
  if (!keyPath) {
    return config;
  }

  let cursor = config;
  for (const key of splitKeyPath(keyPath)) {
    if (cursor == null || typeof cursor !== "object" || !(key in cursor)) {
      return undefined;
    }
    cursor = cursor[key];
  }

  return cursor;
}

function splitKeyPath(keyPath) {
  return String(keyPath).split(".").map((item) => item.trim()).filter(Boolean);
}

function parseValue(rawValue) {
  const value = String(rawValue);

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  if (value === "null") {
    return null;
  }

  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
