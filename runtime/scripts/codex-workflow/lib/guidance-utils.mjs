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
