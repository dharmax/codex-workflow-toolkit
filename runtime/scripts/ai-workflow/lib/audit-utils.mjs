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
    requiredPatterns: [],
    forbiddenImports: [],
    allowlists: []
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
      mergeRuleList(merged.forbiddenImports, parsed.forbiddenImports, { source: `${relativePath}:${block.line}` });
      mergeRuleList(merged.allowlists, parsed.allowlists, { source: `${relativePath}:${block.line}` });
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
  const findings = failures.map(configFailureToFinding);

  const readFileCached = async (relativePath) => {
    if (!texts.has(relativePath)) {
      texts.set(relativePath, await readText(path.resolve(root, relativePath)));
    }

    return texts.get(relativePath);
  };

  for (const rule of config.headers) {
    if (rule.__invalid) {
      findings.push(createConfigFinding({
        message: "audit rule entries must be JSON objects",
        ruleSource: rule.__source
      }));
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
          findings.push(createRuleFinding({
            file: relativePath,
            line: 1,
            ruleKind: "headers",
            rule,
            fallback: `missing required near-top snippet ${JSON.stringify(snippet)}`
          }));
        }
      }
    }
  }

  await runPatternAudit({
    files,
    rules: config.forbiddenPatterns,
    mode: "forbidden",
    readFileCached,
    findings
  });

  await runPatternAudit({
    files,
    rules: config.requiredPatterns,
    mode: "required",
    readFileCached,
    findings
  });

  await runForbiddenImportAudit({
    files,
    rules: config.forbiddenImports,
    readFileCached,
    findings
  });

  const filteredFindings = applyAllowlists(findings, config.allowlists);
  const filteredFailures = filteredFindings.map(formatAuditFinding);

  return {
    failures: filteredFailures,
    findings: filteredFindings,
    blockCount,
    markdownFiles,
    ruleCounts: {
      headers: config.headers.length,
      forbiddenPatterns: config.forbiddenPatterns.length,
      requiredPatterns: config.requiredPatterns.length,
      forbiddenImports: config.forbiddenImports.length,
      allowlists: config.allowlists.length
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

async function runPatternAudit({ files, rules, mode, readFileCached, findings }) {
  for (const rule of rules) {
    if (rule.__invalid) {
      findings.push(createConfigFinding({
        message: "audit rule entries must be JSON objects",
        ruleSource: rule.__source
      }));
      continue;
    }

    if (typeof rule.pattern !== "string" || !rule.pattern.trim()) {
      findings.push(createConfigFinding({
        message: "audit rule is missing a non-empty pattern",
        ruleSource: rule.__source
      }));
      continue;
    }

    let regex;
    try {
      regex = new RegExp(rule.pattern, String(rule.flags ?? ""));
    } catch (error) {
      findings.push(createConfigFinding({
        message: `invalid regex ${JSON.stringify(rule.pattern)} (${error.message})`,
        ruleSource: rule.__source
      }));
      continue;
    }

    const matchedFiles = files.filter((relativePath) => matchesFileRule(relativePath, rule));

    for (const relativePath of matchedFiles) {
      const text = await readFileCached(relativePath);
      const firstMatch = findRegexMatch(text, regex);

      if (mode === "forbidden" && firstMatch) {
        findings.push(createRuleFinding({
          file: relativePath,
          line: firstMatch.line,
          ruleKind: "forbiddenPatterns",
          rule,
          fallback: `matched forbidden pattern ${JSON.stringify(rule.pattern)}`,
          detail: firstMatch.match
        }));
      }

      if (mode === "required" && !firstMatch) {
        findings.push(createRuleFinding({
          file: relativePath,
          ruleKind: "requiredPatterns",
          rule,
          fallback: `missing required pattern ${JSON.stringify(rule.pattern)}`
        }));
      }
    }
  }
}

async function runForbiddenImportAudit({ files, rules, readFileCached, findings }) {
  for (const rule of rules) {
    if (rule.__invalid) {
      findings.push(createConfigFinding({
        message: "audit rule entries must be JSON objects",
        ruleSource: rule.__source
      }));
      continue;
    }

    const targets = normalizeList(rule.targets);
    if (!targets.length) {
      findings.push(createConfigFinding({
        message: "forbiddenImports rule must declare one or more targets",
        ruleSource: rule.__source
      }));
      continue;
    }

    const matchedFiles = files.filter((relativePath) => matchesFileRule(relativePath, rule));

    for (const relativePath of matchedFiles) {
      const text = await readFileCached(relativePath);
      const importSource = findForbiddenImport(text, targets);

      if (importSource) {
        findings.push(createRuleFinding({
          file: relativePath,
          line: importSource.line,
          ruleKind: "forbiddenImports",
          rule,
          fallback: `forbidden import ${JSON.stringify(importSource.source)}`,
          detail: importSource.source
        }));
      }
    }
  }
}

function applyAllowlists(findings, allowlists) {
  const activeAllowlists = [];
  const configFindings = [];

  for (const rule of allowlists) {
    if (rule.__invalid) {
      configFindings.push(createConfigFinding({
        message: "audit rule entries must be JSON objects",
        ruleSource: rule.__source
      }));
      continue;
    }

    activeAllowlists.push(rule);
  }

  const filtered = findings.filter((finding) => {
    if (!finding.file || finding.ruleKind === "config") {
      return true;
    }

    return !activeAllowlists.some((rule) => matchesAllowlist(finding, rule));
  });

  return [...configFindings, ...filtered];
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

function matchesAllowlist(finding, rule) {
  const normalizedPath = normalizePath(finding.file);
  const include = normalizeList(rule.include);
  const exclude = normalizeList(rule.exclude);
  const extensions = normalizeList(rule.extensions);
  const ruleIds = normalizeList(rule.ruleIds ?? rule.rules);
  const ruleKinds = normalizeList(rule.ruleKinds ?? rule.kinds);

  if (include.length && !include.some((value) => pathMatches(normalizedPath, value))) {
    return false;
  }

  if (exclude.some((value) => pathMatches(normalizedPath, value))) {
    return false;
  }

  if (extensions.length && !extensions.some((extension) => normalizedPath.endsWith(extension))) {
    return false;
  }

  if (ruleIds.length && !ruleIds.includes(String(finding.ruleId ?? ""))) {
    return false;
  }

  if (ruleKinds.length && !ruleKinds.includes(String(finding.ruleKind))) {
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

function findForbiddenImport(text, targets) {
  const importPattern = /\bimport\s+(?:[^"'()]+\s+from\s+)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

  for (const match of text.matchAll(importPattern)) {
    const importSource = match[1] ?? match[2] ?? "";
    if (targets.some((target) => importSource === target || importSource.startsWith(`${target}/`))) {
      return {
        source: importSource,
        line: indexToLine(text, match.index ?? 0)
      };
    }
  }

  return null;
}

function findRegexMatch(text, regex) {
  const flags = uniqueFlags(regex.flags, "g");
  const searchable = new RegExp(regex.source, flags);
  const match = searchable.exec(text);

  if (!match) {
    return null;
  }

  return {
    match: match[0],
    line: indexToLine(text, match.index ?? 0)
  };
}

function uniqueFlags(...values) {
  return [...new Set(values.join("").split("").filter(Boolean))].join("");
}

function indexToLine(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function createRuleFinding({ file, line = null, ruleKind, rule, fallback, detail = null }) {
  return {
    file,
    line,
    ruleKind,
    ruleId: rule.id ?? null,
    ruleSource: rule.__source ?? null,
    message: String(rule.message ?? fallback),
    detail
  };
}

function createConfigFinding({ message, ruleSource = null }) {
  return {
    file: null,
    line: null,
    ruleKind: "config",
    ruleId: null,
    ruleSource,
    message: String(message),
    detail: null
  };
}

function configFailureToFinding(message) {
  const match = String(message).match(/^([^:]+:\d+):\s+(.+)$/);

  if (!match) {
    return createConfigFinding({ message });
  }

  return createConfigFinding({
    message: match[2],
    ruleSource: match[1]
  });
}

export function formatAuditFinding(finding) {
  const location = finding.file
    ? `${finding.file}${finding.line ? `:${finding.line}` : ""}`
    : finding.ruleSource ?? "audit";
  const suffix = finding.ruleSource && finding.ruleSource !== location ? ` (${finding.ruleSource})` : "";
  const detail = finding.detail && finding.detail !== finding.message ? ` [${finding.detail}]` : "";
  return `${location}: ${finding.message}${detail}${suffix}`;
}
