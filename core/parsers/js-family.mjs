import { countLineColumn } from "./shared.mjs";
import { findNotesFuzzily } from "../lib/fuzzy.mjs";

const KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "return", "new", "import", "function"]);

export function parseJsFamily({ filePath, content, language }) {
  const imports = [];
  const symbols = [];
  const calls = new Set();
  const seenSymbols = new Set();

  for (const match of content.matchAll(/^\s*import\s+(?:.+?\s+from\s+)?["']([^"']+)["']/gm)) {
    imports.push(match[1]);
  }

  for (const match of content.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) {
    imports.push(match[1]);
  }

  addSymbols(symbols, seenSymbols, content, /\b(export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g, "function");
  addSymbols(symbols, seenSymbols, content, /\b(export\s+)?class\s+([A-Za-z_$][\w$]*)\b/g, "class");
  addSymbols(symbols, seenSymbols, content, /\b(export\s+)?interface\s+([A-Za-z_$][\w$]*)\b/g, "interface");
  addSymbols(symbols, seenSymbols, content, /\b(export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/g, "type");
  addSymbols(symbols, seenSymbols, content, /\b(export\s+)?enum\s+([A-Za-z_$][\w$]*)\b/g, "enum");
  addSymbols(symbols, seenSymbols, content, /\b(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g, "function-value");
  addSymbols(symbols, seenSymbols, content, /\b(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?!\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/g, "variable");

  for (const match of content.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
    const candidate = match[1];
    if (!KEYWORDS.has(candidate)) {
      calls.add(candidate);
    }
  }

  const notes = extractJsNotes(content, filePath);

  return {
    language,
    fileKind: "code",
    symbols,
    facts: [
      ...imports.map((value) => ({ predicate: "imports", objectText: value, confidence: 1 })),
      ...Array.from(calls).map((value) => ({ predicate: "calls", objectText: value, confidence: 0.52 }))
    ],
    notes,
    metadata: {
      importCount: imports.length,
      symbolCount: symbols.length,
      approximateCallCount: calls.size
    },
    searchText: [content, ...imports, ...symbols.map((symbol) => symbol.name)].join("\n")
  };
}

function addSymbols(target, seenSymbols, content, regex, kind) {
  for (const match of content.matchAll(regex)) {
    const name = match[2];
    const key = `${kind}:${name}`;
    if (seenSymbols.has(key)) {
      continue;
    }
    seenSymbols.add(key);

    const location = countLineColumn(content, match.index ?? 0);
    const lineText = extractLine(content, location.line);
    target.push({
      name,
      kind,
      exported: Boolean(match[1]),
      line: location.line,
      column: location.column,
      metadata: {
        signature: lineText.trim(),
        declarationLine: location.line
      }
    });
  }
}

function extractLine(content, lineNumber) {
  return String(content).split("\n")[Math.max(0, lineNumber - 1)] ?? "";
}

function extractJsNotes(source, filePath) {
  const comments = [];
  let index = 0;
  let mode = "code";

  while (index < source.length) {
    const current = source[index];
    const next = source[index + 1];

    if (mode === "code") {
      if (current === "'" || current === "\"" || current === "`") {
        mode = current;
        index += 1;
        continue;
      }
      if (current === "/" && next === "/") {
        const start = index;
        index += 2;
        let body = "";
        while (index < source.length && source[index] !== "\n") {
          body += source[index];
          index += 1;
        }
        comments.push({ body, index: start });
        continue;
      }
      if (current === "/" && next === "*") {
        const start = index;
        index += 2;
        let body = "";
        while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
          body += source[index];
          index += 1;
        }
        index += 2;
        comments.push({ body, index: start });
        continue;
      }
      index += 1;
      continue;
    }

    if (current === "\\") {
      index += 2;
      continue;
    }

    if (current === mode) {
      mode = "code";
    }
    index += 1;
  }

  return comments
    .flatMap((comment) => {
      const location = countLineColumn(source, comment.index);
      return findNotesFuzzily(comment.body.replace(/^\*\s*/gm, "").trim())
        .map(found => ({
          noteType: found.type,
          body: found.body,
          filePath,
          line: location.line + (found.line - 1),
          column: location.column
        }));
    });
}
