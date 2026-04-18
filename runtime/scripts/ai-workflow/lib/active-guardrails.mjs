/**
 * Responsibility: Compile concise, action-oriented guardrails from the workflow guidance corpus.
 * Scope: Shared guardrail loading, ranking, and query-time selection for shell and host surfaces.
 */

import path from "node:path";
import { readText } from "./fs-utils.mjs";
import { extractMarkdownCandidates, tokenize } from "./markdown-utils.mjs";
import { getToolkitRoot } from "./toolkit-root.mjs";

const GUARDRAIL_SOURCE_ORDER = [
  { key: "agents", label: "AGENTS", path: "AGENTS.md", weight: 5 },
  { key: "executionProtocol", label: "Execution Protocol", path: "execution-protocol.md", weight: 4 },
  { key: "projectGuidelines", label: "Project Guidelines", path: "project-guidelines.md", weight: 4 },
  { key: "enforcement", label: "Enforcement", path: "enforcement.md", weight: 4 },
  { key: "manual", label: "Manual", path: path.join("docs", "MANUAL.md"), weight: 2 },
  { key: "knowledge", label: "Knowledge", path: "knowledge.md", weight: 2 },
  { key: "contributing", label: "Contributing", path: "CONTRIBUTING.md", weight: 1 }
];

const REQUIRED_GUARDRAIL_RE = /\b(must|do not|don't|not done until|blocked until|stop\b|non-negotiable|required|never)\b/i;
const STRONG_GUARDRAIL_RE = /\b(should|prefer|before|preserve|avoid|keep|treat|require|use\b|finish)\b/i;
const DIRECTIVE_RE = /\b(must|should|prefer|do not|don't|not done until|blocked until|stop\b|avoid|keep|preserve|use\b|require|treat|finish|run\b|resolve\b)\b/i;
const IMPORTANT_DECLARATION_RE = /\b(canonical|first-class|not done|definition of done|failure honesty|goe|governance|workflow state)\b/i;

export async function loadProjectActiveGuardrails(root, options = {}) {
  const resolvedRoot = path.resolve(String(root ?? process.cwd()));
  const toolkitRoot = getToolkitRoot();
  const manualFallback = await readText(path.resolve(toolkitRoot, "docs", "MANUAL.md"));
  const loadedEntries = await Promise.all(
    GUARDRAIL_SOURCE_ORDER.map(async (spec) => {
      const fallback = spec.key === "manual" ? manualFallback : "";
      const content = await readText(path.resolve(resolvedRoot, spec.path), fallback);
      return [spec.key, content];
    })
  );
  return compileActiveGuardrails(Object.fromEntries(loadedEntries), options);
}

export function compileActiveGuardrails(documents = {}, options = {}) {
  const keywords = normalizeKeywords(options.keywords);
  const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Number(options.limit)) : 8;
  const candidates = [];
  const seen = new Set();

  for (const spec of GUARDRAIL_SOURCE_ORDER) {
    const markdown = String(documents?.[spec.key] ?? "").trim();
    if (!markdown) {
      continue;
    }

    for (const candidate of extractMarkdownCandidates(markdown)) {
      const summary = compactText(candidate.text);
      if (!isPotentialGuardrail(summary)) {
        continue;
      }

      const normalizedSummary = normalizeGuardrailText(summary);
      if (!normalizedSummary || seen.has(normalizedSummary)) {
        continue;
      }

      const tags = inferGuardrailTags(summary, spec.key);
      const surfaces = inferGuardrailSurfaces(summary, spec.key);
      const severity = inferGuardrailSeverity(summary, spec.key);
      const overlap = tokenize(summary).filter((token) => keywords.includes(token) || tags.includes(token)).length;
      const id = `${spec.key}:${slugifyGuardrail(summary)}`;
      const score = overlap * 10 + severityWeight(severity) + spec.weight + candidate.weight - candidate.line * 0.0001;

      seen.add(normalizedSummary);
      candidates.push({
        id,
        summary,
        source: spec.key,
        sourceLabel: spec.label,
        severity,
        tags,
        surfaces,
        line: candidate.line,
        score
      });
    }
  }

  return candidates
    .sort((left, right) => right.score - left.score || left.line - right.line)
    .slice(0, limit);
}

export function selectActiveGuardrails(guardrails = [], queryText = "", options = {}) {
  const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Number(options.limit)) : 4;
  const fallbackLimit = Number.isFinite(Number(options.fallbackLimit)) ? Math.max(1, Number(options.fallbackLimit)) : Math.min(2, limit);
  const queryTokens = tokenize(String(queryText ?? ""));
  const scored = guardrails.map((guardrail, index) => {
    const tags = Array.isArray(guardrail.tags) ? guardrail.tags : [];
    const sourceLabel = String(guardrail.sourceLabel ?? guardrail.source ?? "");
    const tokens = tokenize(`${guardrail.summary} ${tags.join(" ")} ${sourceLabel}`);
    const overlap = tokens.filter((token) => queryTokens.includes(token)).length;
    return {
      ...guardrail,
      overlap,
      score: overlap * 10 + severityWeight(guardrail.severity) - index * 0.001
    };
  });

  let chosen = scored.filter((item) => item.overlap > 0);
  if (!chosen.length) {
    chosen = scored
      .slice()
      .sort((left, right) => severityWeight(right.severity) - severityWeight(left.severity) || right.score - left.score)
      .slice(0, fallbackLimit);
  }

  return chosen
    .slice()
    .sort((left, right) => right.score - left.score || left.line - right.line)
    .slice(0, limit);
}

function normalizeKeywords(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.flatMap((item) => tokenize(String(item ?? ""))))];
  }
  return tokenize(String(value ?? ""));
}

function isPotentialGuardrail(value) {
  const text = compactText(value);
  if (!text || text.length < 18 || text.length > 240) {
    return false;
  }
  if (/^(goal|scope|status|story|ticket batches|kanban tickets|none captured yet)[:.]?$/i.test(text)) {
    return false;
  }
  if (/^(###?|##)\s+/.test(text)) {
    return false;
  }
  return DIRECTIVE_RE.test(text) || IMPORTANT_DECLARATION_RE.test(text);
}

function inferGuardrailSeverity(text, sourceKey) {
  if (sourceKey === "enforcement" || REQUIRED_GUARDRAIL_RE.test(text)) {
    return "required";
  }
  if (STRONG_GUARDRAIL_RE.test(text)) {
    return "strong";
  }
  return "advisory";
}

function inferGuardrailTags(text, sourceKey) {
  const normalized = String(text ?? "").toLowerCase();
  const tags = new Set();
  if (/\b(shell|ask|status query|operator-brain|host|adapter|mcp|plugin|surface)\b/.test(normalized)) tags.add("surface");
  if (/\b(ai-workflow|ticket|sync|kanban|projection|workflow)\b/.test(normalized)) tags.add("workflow");
  if (/\b(mutating|mutation|in progress|board|state changes|shell execution)\b/.test(normalized)) tags.add("mutation");
  if (/\b(dogfood|workflow-audit|test|verification|proof)\b/.test(normalized)) tags.add("testing");
  if (/\b(canonical|db|stable api|module|architect|boundary|layer)\b/.test(normalized)) tags.add("architecture");
  if (/\b(goe|governance|model-governance|cheapest capable model|stronger-model|weaker|cheap route)\b/.test(normalized)) tags.add("governance");
  if (sourceKey === "enforcement") tags.add("enforcement");
  if (!tags.size) tags.add("general");
  return [...tags];
}

function inferGuardrailSurfaces(text, sourceKey) {
  const normalized = String(text ?? "").toLowerCase();
  const surfaces = new Set();
  if (/\bshell\b/.test(normalized)) surfaces.add("shell");
  if (/\b(host|plugin|mcp|ask|operator-brain|adapter)\b/.test(normalized)) surfaces.add("host");
  if (/\b(cli|codelet|workflow-audit)\b/.test(normalized)) surfaces.add("cli");
  if (sourceKey === "enforcement") surfaces.add("all");
  if (!surfaces.size) surfaces.add("all");
  return [...surfaces];
}

function severityWeight(severity) {
  if (severity === "required") return 9;
  if (severity === "strong") return 6;
  return 3;
}

function slugifyGuardrail(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "guardrail";
}

function normalizeGuardrailText(value) {
  return compactText(value)
    .toLowerCase()
    .replace(/[*_`]/g, "")
    .replace(/[.;:]+$/g, "");
}

function compactText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
