import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { sha1 } from "../lib/hash.mjs";

const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MAX_RESULTS = 5;

export async function searchWebEvidence({
  root = process.cwd(),
  query,
  forceRefresh = false,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  maxResults = DEFAULT_MAX_RESULTS,
  fetchImpl = globalThis.fetch
} = {}) {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) {
    return {
      source: "empty",
      query: "",
      generatedAt: new Date().toISOString(),
      fingerprint: null,
      results: [],
      signals: {}
    };
  }

  const fingerprint = sha1(JSON.stringify({
    query: normalizedQuery,
    maxResults
  }));
  const cached = forceRefresh ? null : await readWebSearchCache(root).catch(() => null);
  if (cached?.fingerprint === fingerprint && isFresh(cached.generatedAt, cacheTtlMs)) {
    return cached;
  }

  let results = [];
  let source = "duckduckgo";

  try {
    const html = await fetchWebResults({ query: normalizedQuery, fetchImpl });
    results = parseDuckDuckGoResults(html, maxResults);
  } catch (error) {
    source = "error";
    results = [];
  }

  const payload = {
    source,
    query: normalizedQuery,
    generatedAt: new Date().toISOString(),
    fingerprint,
    results,
    signals: buildSignals(results)
  };

  await writeWebSearchCache(root, payload).catch(() => {});
  return payload;
}

export async function invalidateWebSearchCache(root = process.cwd()) {
  const cachePath = getWebSearchCachePath(root);
  await rm(cachePath, { force: true });
}

async function fetchWebResults({ query, fetchImpl }) {
  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch is not available in this runtime.");
  }

  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetchImpl(url, {
    headers: {
      "User-Agent": "ai-workflow/1.0"
    }
  });
  if (!response?.ok) {
    throw new Error(`Search request failed with status ${response?.status ?? "unknown"}`);
  }
  return await response.text();
}

function parseDuckDuckGoResults(html, maxResults) {
  const results = [];
  const anchorPattern = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchorPattern)) {
    if (results.length >= maxResults) {
      break;
    }

    const href = normalizeResultUrl(match[1]);
    const title = stripHtml(match[2]);
    const around = html.slice(match.index, Math.min(html.length, match.index + 2500));
    const snippet = extractSnippet(around);

    results.push({
      title,
      url: href,
      snippet
    });
  }

  return results;
}

function extractSnippet(html) {
  const snippetMatch = html.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
    ?? html.match(/<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
    ?? html.match(/<span[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
  return stripHtml(snippetMatch?.[1] ?? "");
}

function buildSignals(results) {
  const text = results
    .map((result) => `${result.title ?? ""} ${result.snippet ?? ""}`)
    .join(" ")
    .toLowerCase();

  return {
    logic: countKeywords(text, ["code", "coding", "coder", "programming", "software", "benchmark", "math"]),
    strategy: countKeywords(text, ["reason", "reasoning", "plan", "planner", "agent", "analysis", "benchmark"]),
    prose: countKeywords(text, ["chat", "assistant", "instruction", "general", "conversation", "prose"]),
    visual: countKeywords(text, ["vision", "image", "multimodal", "visual"]),
    speed: countKeywords(text, ["fast", "small", "efficient", "low latency", "lightweight", "quantized"]),
    taskFit: countKeywords(text, ["local", "hardware", "context", "edge", "on-device"])
  };
}

function countKeywords(text, keywords = []) {
  let total = 0;
  for (const keyword of keywords) {
    if (!keyword) continue;
    if (text.includes(String(keyword).toLowerCase())) {
      total += 1;
    }
  }
  return total;
}

function normalizeQuery(query) {
  return String(query ?? "").trim().replace(/\s+/g, " ");
}

function normalizeResultUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }
  try {
    const decoded = new URL(raw, "https://duckduckgo.com");
    const uddg = decoded.searchParams.get("uddg");
    if (uddg) {
      return decodeURIComponent(uddg);
    }
    return decoded.toString();
  } catch {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
}

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function isFresh(generatedAt, ttlMs) {
  const started = Date.parse(generatedAt ?? "");
  if (!Number.isFinite(started)) {
    return false;
  }
  return Date.now() - started < ttlMs;
}

async function readWebSearchCache(root) {
  const cachePath = getWebSearchCachePath(root);
  const text = await readFile(cachePath, "utf8");
  return JSON.parse(text);
}

async function writeWebSearchCache(root, payload) {
  const cachePath = getWebSearchCachePath(root);
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function getWebSearchCachePath(root) {
  return path.resolve(root, ".ai-workflow", "cache", "web-search.json");
}
