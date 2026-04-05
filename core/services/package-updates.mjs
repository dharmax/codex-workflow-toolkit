import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sha1 } from "../lib/hash.mjs";

const execFileAsync = promisify(execFile);
const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export async function buildPackageUpdateAdvisory({
  root = process.cwd(),
  forceRefresh = false,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  fetchImpl = globalThis.fetch,
  leanCtxVersion = null
} = {}) {
  const current = await readCurrentPackageVersions(root);
  if (leanCtxVersion !== null) {
    current.leanCtx = normalizeVersion(leanCtxVersion);
  }
  const packages = [
    {
      name: "@dharmax/ai-workflow",
      currentVersion: current.aiWorkflow,
      latestVersion: current.aiWorkflow
    },
    {
      name: "lean-ctx",
      currentVersion: current.leanCtx,
      latestVersion: null
    }
  ];

  const fingerprint = sha1(JSON.stringify({
    packages: packages.map((item) => item.name),
    current: packages.map((item) => [item.name, item.currentVersion ?? null])
  }));
  const cached = forceRefresh ? null : await readPackageUpdateCache(root).catch(() => null);
  if (cached?.fingerprint === fingerprint && isFresh(cached.generatedAt, cacheTtlMs)) {
    return cached;
  }

  const refreshed = [];
  for (const item of packages) {
    const latestVersion = await fetchNpmLatestVersion(item.name, { fetchImpl }).catch(() => null);
    refreshed.push({
      ...item,
      latestVersion,
      status: classifyVersionState(item.currentVersion, latestVersion)
    });
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    fingerprint,
    packages: refreshed,
    comment: renderUpgradeComment(refreshed)
  };

  await writePackageUpdateCache(root, payload).catch(() => {});
  return payload;
}

export async function invalidatePackageUpdateCache(root = process.cwd()) {
  await rm(getPackageUpdateCachePath(root), { force: true });
}

async function readCurrentPackageVersions(root) {
  const packageJsonPath = path.resolve(root, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const aiWorkflow = String(packageJson.version ?? "").trim() || null;
  const leanCtx = await probeLeanCtxVersion().catch(() => null);
  return { aiWorkflow, leanCtx };
}

async function probeLeanCtxVersion() {
  try {
    const { stdout } = await execFileAsync("lean-ctx", ["--version"], { maxBuffer: 1024 * 1024 });
    return normalizeVersion(stdout);
  } catch {
    return null;
  }
}

async function fetchNpmLatestVersion(packageName, { fetchImpl }) {
  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch is not available in this runtime.");
  }

  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`;
  const response = await fetchImpl(url, {
    headers: {
      "Accept": "application/vnd.npm.install-v1+json"
    }
  });
  if (!response?.ok) {
    throw new Error(`Registry request failed for ${packageName} (${response?.status ?? "unknown"})`);
  }
  const payload = await response.json();
  return normalizeVersion(payload?.version ?? null);
}

function classifyVersionState(currentVersion, latestVersion) {
  if (!latestVersion) {
    return "unknown";
  }
  if (!currentVersion) {
    return "unknown";
  }
  if (normalizeVersion(currentVersion) === normalizeVersion(latestVersion)) {
    return "current";
  }
  return "update-available";
}

function renderUpgradeComment(packages) {
  const lines = ["Upgrade check:"];
  for (const item of packages) {
    const current = item.currentVersion ?? "unknown";
    const latest = item.latestVersion ?? "unavailable";
    if (item.status === "current") {
      lines.push(`- ${item.name}: ${current} is current.`);
    } else if (item.status === "update-available") {
      lines.push(`- ${item.name}: current ${current}, latest ${latest}.`);
    } else {
      lines.push(`- ${item.name}: current ${current}, latest ${latest}.`);
    }
  }
  lines.push("Keep ai-workflow and related tooling on the latest stable release before shipping changes.");
  return lines.join("\n");
}

function normalizeVersion(text) {
  const match = String(text ?? "").match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
  return match ? match[1] : String(text ?? "").trim() || null;
}

async function readPackageUpdateCache(root) {
  const cachePath = getPackageUpdateCachePath(root);
  const text = await readFile(cachePath, "utf8");
  return JSON.parse(text);
}

async function writePackageUpdateCache(root, payload) {
  const cachePath = getPackageUpdateCachePath(root);
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function getPackageUpdateCachePath(root) {
  return path.resolve(root, ".ai-workflow", "cache", "package-updates.json");
}

function isFresh(generatedAt, ttlMs) {
  const started = Date.parse(generatedAt ?? "");
  if (!Number.isFinite(started)) {
    return false;
  }
  return Date.now() - started < ttlMs;
}
