import path from "node:path";
import { extractMarkdownCandidates, tokenize } from "./markdown-utils.mjs";

export function deriveKeywords({ ticketText = "", files = [] }) {
  const fromFiles = files.flatMap((filePath) => {
    const base = path.basename(filePath);
    return tokenize(`${filePath} ${base.replace(/\.[^.]+$/, "").replace(/[._-]/g, " ")}`);
  });

  return [...new Set([...tokenize(ticketText), ...fromFiles])];
}

export function summarizeGuidance(markdown, keywords, options = {}) {
  const {
    limit = 6,
    fallbackLimit = 4,
    alwaysIncludeTop = false
  } = options;
  const rawCandidates = extractMarkdownCandidates(markdown);
  const candidates = rawCandidates.some((candidate) => candidate.kind !== "heading")
    ? rawCandidates.filter((candidate) => candidate.kind !== "heading")
    : rawCandidates;

  if (!candidates.length) {
    return [];
  }

  const scored = candidates.map((candidate, index) => {
    const candidateTokens = tokenize(candidate.text);
    const overlap = candidateTokens.filter((token) => keywords.includes(token)).length;
    const score = overlap * 10 + candidate.weight - index * 0.001;
    return { ...candidate, overlap, score };
  });

  let chosen = scored.filter((candidate) => candidate.overlap > 0);

  if (!chosen.length || alwaysIncludeTop) {
    const rankedFallback = scored
      .slice()
      .sort((left, right) => {
        const leftPenalty = left.kind === "heading" ? 1 : 0;
        const rightPenalty = right.kind === "heading" ? 1 : 0;
        return leftPenalty - rightPenalty || right.weight - left.weight || left.line - right.line;
      });
    const fallback = rankedFallback.slice(0, fallbackLimit);
    chosen = mergeUnique(chosen, fallback);
  }

  return chosen
    .slice()
    .sort((left, right) => right.score - left.score || left.line - right.line)
    .slice(0, limit)
    .sort((left, right) => left.line - right.line)
    .map((candidate) => candidate.text);
}

export function inferValidationPlan({ ticket = null, files = [] }) {
  const normalizedFiles = files.map((filePath) => String(filePath).toLowerCase());
  const ticketText = `${ticket?.heading ?? ""}\n${ticket?.body ?? ""}`.toLowerCase();
  const touchesUi = normalizedFiles.some((filePath) => filePath.includes("/ui") || /\.(riot|tsx?|jsx?|css)$/.test(filePath))
    || /\b(ui|visual|screen|modal|component|css|layout|card|browser)\b/.test(ticketText);
  const touchesRuntime = normalizedFiles.some((filePath) =>
    /(engine|persist|store|state|router|session|firebase|db|api|auth)/.test(filePath)
  ) || /\b(persist|state|router|session|firebase|database|api|auth|engine)\b/.test(ticketText);
  const touchesWorkflow = normalizedFiles.some((filePath) =>
    /(kanban|execution-protocol|project-guidelines|knowledge|agents\.md|contributing\.md|enforcement|workflow)/.test(filePath)
  ) || /\b(kanban|workflow|guidance|contributing|execution protocol|project guidelines|knowledge)\b/.test(ticketText);
  const hintsBatch = /\b(batch|sweep|several|family|related tickets|larger ticket)\b/.test(ticketText);
  const hintsSpecial = /\b(import|export|migration|payment|sync|forge|simulation|emulator|special flow|ai)\b/.test(ticketText);
  const section = ticket?.section ?? null;
  const notes = [];
  let level = "small-ticket";
  let recommendation = "Run quick but meaningful unit or module tests for the touched behavior.";

  if (touchesWorkflow) {
    notes.push("workflow/docs changed -> include workflow-audit");
  }

  if (section === "Bugs P1" || touchesRuntime) {
    level = "large-or-risky";
    recommendation = "Run targeted unit/module tests plus E2E for the affected system path.";
  }

  if (hintsBatch && level === "small-ticket") {
    level = "batch-or-ui";
    recommendation = "Run quick unit/module checks plus targeted E2E for the related batch.";
  }

  if (section === "Human Inspection") {
    notes.push("leave residual eye/ear/product judgment in Human Inspection");
  }

  if (touchesUi) {
    notes.push("UI changed -> include visual check in the E2E layer when the change is user-visible");
    if (level === "small-ticket") {
      level = "batch-or-ui";
      recommendation = "Run quick unit/module checks plus a focused browser or visual E2E pass.";
    }
  }

  if (hintsSpecial) {
    notes.push("special flow detected -> add a special-purpose test for the exact mechanism");
  }

  return {
    level,
    recommendation,
    checks: buildValidationChecks({ level, touchesUi, touchesRuntime, touchesWorkflow }),
    notes
  };
}

function mergeUnique(primary, secondary) {
  const seen = new Set(primary.map((item) => item.line));
  const merged = [...primary];

  for (const item of secondary) {
    if (seen.has(item.line)) {
      continue;
    }

    seen.add(item.line);
    merged.push(item);
  }

  return merged;
}

function buildValidationChecks({ level, touchesUi, touchesRuntime, touchesWorkflow }) {
  const checks = [];

  if (touchesWorkflow) {
    checks.push("workflow-audit");
  }

  checks.push("targeted unit/module tests");

  if (level !== "small-ticket" || touchesUi || touchesRuntime) {
    checks.push("targeted E2E/system-path check");
  }

  if (touchesUi) {
    checks.push("visual check");
  }

  if (touchesRuntime) {
    checks.push("typecheck");
  }

  if (level === "large-or-risky") {
    checks.push("consider super-E2E/simulation/emulator run if this is part of an accumulated batch");
  }

  return checks;
}
