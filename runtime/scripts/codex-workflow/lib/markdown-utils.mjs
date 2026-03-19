const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "if",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "with"
]);

export function compactWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

export function tokenize(value) {
  const tokens = value.toLowerCase().match(/[a-z0-9][a-z0-9/_-]*/g) ?? [];
  return [...new Set(tokens.filter((token) => token.length > 2 && !STOP_WORDS.has(token)))];
}

export function extractMarkdownCandidates(markdown) {
  const lines = markdown.split(/\r?\n/);
  const candidates = [];
  let inCodeFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();

    if (trimmed.startsWith("```")) {
      inCodeFence = !inCodeFence;
      continue;
    }

    if (inCodeFence || !trimmed) {
      continue;
    }

    const isHeading = /^#{1,6}\s+/.test(trimmed);
    const isBullet = /^[-*]\s+/.test(trimmed);
    const isNumbered = /^\d+\.\s+/.test(trimmed);
    const isParagraph = !trimmed.startsWith("|") && trimmed.length <= 160;

    if (!isHeading && !isBullet && !isNumbered && !isParagraph) {
      continue;
    }

    candidates.push({
      line: index + 1,
      text: compactWhitespace(trimmed.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "")),
      weight: isHeading ? 3 : isBullet || isNumbered ? 2 : 1,
      kind: isHeading ? "heading" : isBullet || isNumbered ? "list" : "paragraph"
    });
  }

  return candidates;
}

export function extractFencedBlocks(markdown, infoString) {
  const lines = markdown.split(/\r?\n/);
  const blocks = [];
  let capture = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = line.match(/^```(\S*)\s*$/);

    if (!capture) {
      if (fenceMatch && fenceMatch[1] === infoString) {
        capture = {
          line: index + 1,
          lines: []
        };
      }
      continue;
    }

    if (fenceMatch) {
      blocks.push({
        line: capture.line,
        content: capture.lines.join("\n").trim()
      });
      capture = null;
      continue;
    }

    capture.lines.push(line);
  }

  return blocks;
}
