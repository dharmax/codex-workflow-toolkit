import { readdir } from "node:fs/promises";
import path from "node:path";
import { exists, normalizePath, readText } from "./fs-utils.mjs";
import { extractFencedBlocks } from "./markdown-utils.mjs";

const IGNORED_DIRS = new Set([
  ".git",
  ".idea",
  ".next",
  ".turbo",
  ".vercel",
  "coverage",
  "dist",
  "build",
  "node_modules"
]);

export async function listRepoFiles(root, options = {}) {
  const { extensions = null } = options;
  const files = [];
  const stack = [root];

  while (stack.length) {
    const current = stack.pop();
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) {
        continue;
      }

      const absolutePath = path.resolve(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const relativePath = normalizePath(path.relative(root, absolutePath));
      if (extensions && !extensions.some((extension) => relativePath.endsWith(extension))) {
        continue;
      }

      files.push(relativePath);
    }
  }

  return files.sort();
}

export async function collectAuditConfig(root) {
  const markdownFiles = await listRepoFiles(root, { extensions: [".md", ".mdx"] });
  const merged = {
    headers: [],
    forbiddenPatterns: [],
    requiredPatterns: []
  };
  const failures = [];
  let blockCount = 0;

  for (const relativePath of markdownFiles) {
    const absolutePath = path.resolve(root, relativePath);
    const markdown = await readText(absolutePath);
    const blocks = extractFencedBlocks(markdown, "codex-workflow-audit");

    for (const block of blocks) {
      blockCount += 1;
      let parsed;

      try {
        parsed = JSON.parse(block.content);
      } catch (error) {
        failures.push(`${relativePath}:${block.line}: invalid codex-workflow-audit JSON (${error.message})`);
        continue;
      }

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        failures.push(`${relativePath}:${block.line}: codex-workflow-audit block must be a JSON object`);
        continue;
      }

      mergeRuleList(merged.headers, parsed.headers, { source: `${relativePath}:${block.line}` });
      mergeRuleList(merged.forbiddenPatterns, parsed.forbiddenPatterns, { source: `${relativePath}:${block.line}` });
      mergeRuleList(merged.requiredPatterns, parsed.requiredPatterns, { source: `${relativePath}:${block.line}` });
    }
  }

  return {
    config: merged,
    markdownFiles,
    blockCount,
    failures
  };
}

export async function runGuidelineAudit(root) {
  const files = await listRepoFiles(root);
  const { config, markdownFiles, blockCount, failures } = await collectAuditConfig(root);
  const texts = new Map();

  const readFileCached = async (relativePath) => {
    if (!texts.has(relativePath)) {
      texts.set(relativePath, await readText(path.resolve(root, relativePath)));
    }

    return texts.get(relativePath);
  };

  for (const rule of config.headers) {
    if (rule.__invalid) {
      failures.push(`${rule.__source}: audit rule entries must be JSON objects`);
      continue;
    }

    const matchedFiles = files.filter((relativePath) => matchesFileRule(relativePath, rule));

    for (const relativePath of matchedFiles) {
      const text = await readFileCached(relativePath);
      const maxLines = Number(rule.maxLines ?? (relativePath.endsWith(".md") ? 24 : 12));
      const head = text.split(/\r?\n/).slice(0, maxLines).join("\n");
      const requiredNearTop = Array.isArray(rule.requiredNearTop) ? rule.requiredNearTop : [];

      for (const snippet of requiredNearTop) {
        if (!head.includes(snippet)) {
          failures.push(
            `${relativePath}: missing required near-top snippet ${JSON.stringify(snippet)} (${rule.message ?? rule.__source})`
          );
        }
      }
    }
  }

  await runPatternAudit({
    files,
    rules: config.forbiddenPatterns,
    mode: "forbidden",
    readFileCached,
    failures
  });

  await runPatternAudit({
    files,
    rules: config.requiredPatterns,
    mode: "required",
    readFileCached,
    failures
  });

  return {
    failures,
    blockCount,
    markdownFiles,
    ruleCounts: {
      headers: config.headers.length,
      forbiddenPatterns: config.forbiddenPatterns.length,
      requiredPatterns: config.requiredPatterns.length
    }
  };
}

function mergeRuleList(target, value, metadata) {
  if (value === undefined) {
    return;
  }

  if (!Array.isArray(value)) {
    target.push({
      __invalid: true,
      __source: metadata.source
    });
    return;
  }

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      target.push({
        __invalid: true,
        __source: metadata.source
      });
      continue;
    }

    target.push({
      ...item,
      __source: metadata.source
    });
  }
}

async function runPatternAudit({ files, rules, mode, readFileCached, failures }) {
  for (const rule of rules) {
    if (rule.__invalid) {
      failures.push(`${rule.__source}: audit rule entries must be JSON objects`);
      continue;
    }

    if (typeof rule.pattern !== "string" || !rule.pattern.trim()) {
      failures.push(`${rule.__source}: audit rule is missing a non-empty pattern`);
      continue;
    }

    let regex;
    try {
      regex = new RegExp(rule.pattern, String(rule.flags ?? ""));
    } catch (error) {
      failures.push(`${rule.__source}: invalid regex ${JSON.stringify(rule.pattern)} (${error.message})`);
      continue;
    }

    const matchedFiles = files.filter((relativePath) => matchesFileRule(relativePath, rule));

    for (const relativePath of matchedFiles) {
      const text = await readFileCached(relativePath);
      regex.lastIndex = 0;
      const matched = regex.test(text);

      if (mode === "forbidden" && matched) {
        failures.push(`${relativePath}: ${rule.message ?? `matched forbidden pattern ${JSON.stringify(rule.pattern)}`}`);
      }

      if (mode === "required" && !matched) {
        failures.push(`${relativePath}: ${rule.message ?? `missing required pattern ${JSON.stringify(rule.pattern)}`}`);
      }
    }
  }
}

function matchesFileRule(relativePath, rule) {
  const normalizedPath = normalizePath(relativePath);
  const include = normalizeList(rule.include);
  const exclude = normalizeList(rule.exclude);
  const extensions = normalizeList(rule.extensions);

  if (include.length && !include.some((value) => pathMatches(normalizedPath, value))) {
    return false;
  }

  if (exclude.some((value) => pathMatches(normalizedPath, value))) {
    return false;
  }

  if (extensions.length && !extensions.some((extension) => normalizedPath.endsWith(extension))) {
    return false;
  }

  return true;
}

function normalizeList(value) {
  if (value === undefined) {
    return [];
  }

  return (Array.isArray(value) ? value : [value])
    .map((item) => String(item).trim())
    .filter(Boolean)
    .map(normalizePath);
}

function pathMatches(relativePath, pattern) {
  const normalizedPattern = normalizePath(pattern).replace(/\/+$/, "");

  if (!normalizedPattern || normalizedPattern === ".") {
    return true;
  }

  return relativePath === normalizedPattern || relativePath.startsWith(`${normalizedPattern}/`);
}

export async function fileExistsRelative(root, relativePath) {
  return await exists(path.resolve(root, relativePath));
}
