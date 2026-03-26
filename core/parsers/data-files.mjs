import { extractTaggedNotes } from "./shared.mjs";
import { findNotesFuzzily } from "../lib/fuzzy.mjs";

export function parseJsonFile({ filePath, content }) {
  let value = null;
  let error = null;

  try {
    value = JSON.parse(content);
  } catch (caughtError) {
    error = caughtError.message;
  }

  const topLevelKeys = value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : [];
  return {
    language: "json",
    fileKind: "data",
    symbols: topLevelKeys.map((key) => ({ name: key, kind: "json-key", exported: false })),
    facts: topLevelKeys.map((key) => ({ predicate: "has-key", objectText: key, confidence: 1 })),
    notes: [],
    metadata: {
      parseError: error,
      topLevelKeyCount: topLevelKeys.length
    },
    searchText: [content, ...topLevelKeys].join("\n")
  };
}

export function parseYamlFile({ filePath, content, language }) {
  const keys = [];
  for (const match of content.matchAll(/^([A-Za-z0-9_.-]+):/gm)) {
    keys.push(match[1]);
  }
  const notes = extractTaggedNotes(content, {
    commentPattern: /#([^\n]+)/g,
    filePath
  });
  return {
    language,
    fileKind: "data",
    symbols: keys.map((key) => ({ name: key, kind: "yaml-key", exported: false })),
    facts: keys.map((key) => ({ predicate: "has-key", objectText: key, confidence: 0.9 })),
    notes,
    metadata: {
      topLevelKeyCount: keys.length
    },
    searchText: [content, ...keys].join("\n")
  };
}

export function parseMarkdownFile({ filePath, content }) {
  const headings = [];
  for (const match of content.matchAll(/^(#{1,6})\s+(.+)$/gm)) {
    headings.push(match[2].trim());
  }

  const explicitLineNotes = extractExplicitMarkdownNotes(content, filePath);

  // Classic tagged notes (comments)
  const taggedNotes = extractTaggedNotes(content, {
    commentPattern: /<!--([\s\S]*?)-->/gm,
    filePath
  });

  const notes = [...explicitLineNotes, ...taggedNotes].filter((note, index, self) => 
    index === self.findIndex((t) => t.line === note.line && t.body === note.body)
  );

  return {
    language: "markdown",
    fileKind: "doc",
    symbols: headings.map((heading) => ({ name: heading, kind: "heading", exported: false })),
    facts: headings.map((heading) => ({ predicate: "has-heading", objectText: heading, confidence: 1 })),
    notes,
    metadata: {
      headingCount: headings.length
    },
    searchText: [content, ...headings].join("\n")
  };
}

function extractExplicitMarkdownNotes(content, filePath) {
  return findNotesFuzzily(content)
    .filter((note) => isExplicitMarkdownNote(note.rawLine))
    .map((note) => ({
      noteType: note.type,
      body: note.body,
      filePath,
      line: note.line,
      column: 1
    }));
}

function isExplicitMarkdownNote(line) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed) {
    return false;
  }

  if (/^(?:[-*]\s+)?(?:\[\s*(?:TODO|FIXME|HACK|BUG|RISK|NOTE)\s*\]|(?:TODO|FIXME|HACK|BUG|RISK|NOTE))[:\-\s]/i.test(trimmed)) {
    return true;
  }

  if (/^(?:[-*]\s+)?\[\s\]\s+(?:TODO|FIXME|HACK|BUG|RISK|NOTE)\b/i.test(trimmed)) {
    return true;
  }

  return false;
}
