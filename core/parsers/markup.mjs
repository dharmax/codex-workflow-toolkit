import { extractTaggedNotes } from "./shared.mjs";
import { parseJsFamily } from "./js-family.mjs";
import { parseStyles } from "./styles.mjs";

export function parseHtml({ filePath, content, language = "html" }) {
  const ids = new Set();
  const classes = new Set();

  for (const match of content.matchAll(/\sid=["']([^"']+)["']/g)) {
    ids.add(`#${match[1]}`);
  }

  for (const match of content.matchAll(/\sclass=["']([^"']+)["']/g)) {
    for (const className of match[1].split(/\s+/)) {
      if (className) {
        classes.add(`.${className}`);
      }
    }
  }

  const selectors = [...ids, ...classes];
  const notes = extractTaggedNotes(content, {
    commentPattern: /<!--([\s\S]*?)-->/g,
    filePath
  });

  return {
    language,
    fileKind: "markup",
    symbols: selectors.map((selector) => ({ name: selector, kind: "selector", exported: false })),
    facts: selectors.map((selector) => ({ predicate: "uses-selector", objectText: selector, confidence: 0.95 })),
    notes,
    metadata: {
      selectorCount: selectors.length
    },
    searchText: [content, ...selectors].join("\n")
  };
}

export function parseRiot({ filePath, content }) {
  const scriptContent = content.match(/<script[^>]*>([\s\S]*?)<\/script>/i)?.[1] ?? "";
  const styleContent = content.match(/<style[^>]*>([\s\S]*?)<\/style>/i)?.[1] ?? "";
  const templateContent = content.replace(/<script[\s\S]*?<\/script>/ig, "").replace(/<style[\s\S]*?<\/style>/ig, "");
  const script = scriptContent ? parseJsFamily({ filePath, content: scriptContent, language: "riot-script" }) : emptyResult("riot-script");
  const style = styleContent ? parseStyles({ filePath, content: styleContent, language: "riot-style" }) : emptyResult("riot-style");
  const markup = parseHtml({ filePath, content: templateContent, language: "riot-template" });

  return {
    language: "riot",
    fileKind: "component",
    symbols: [...script.symbols, ...style.symbols, ...markup.symbols],
    facts: [...script.facts, ...style.facts, ...markup.facts],
    notes: [...script.notes, ...style.notes, ...markup.notes],
    metadata: {
      scriptSymbols: script.symbols.length,
      styleSelectors: style.symbols.length,
      templateSelectors: markup.symbols.length
    },
    searchText: [script.searchText, style.searchText, markup.searchText].filter(Boolean).join("\n")
  };
}

function emptyResult(language) {
  return {
    language,
    fileKind: "empty",
    symbols: [],
    facts: [],
    notes: [],
    metadata: {},
    searchText: ""
  };
}
