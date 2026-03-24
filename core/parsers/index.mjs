import path from "node:path";
import { parseJsFamily } from "./js-family.mjs";
import { parseStyles } from "./styles.mjs";
import { parseHtml, parseRiot } from "./markup.mjs";
import { parseJsonFile, parseMarkdownFile, parseYamlFile } from "./data-files.mjs";

export function parseIndexedFile({ filePath, content }) {
  const extension = path.extname(filePath).toLowerCase();

  if ([".js", ".mjs", ".jsx", ".ts", ".tsx"].includes(extension)) {
    return parseJsFamily({ filePath, content, language: extension.slice(1) });
  }

  if ([".css", ".scss", ".less"].includes(extension)) {
    return parseStyles({ filePath, content, language: extension.slice(1) });
  }

  if (extension === ".html") {
    return parseHtml({ filePath, content, language: "html" });
  }

  if (extension === ".riot") {
    return parseRiot({ filePath, content });
  }

  if (extension === ".json") {
    return parseJsonFile({ filePath, content });
  }

  if (extension === ".yaml" || extension === ".yml") {
    return parseYamlFile({ filePath, content, language: extension.slice(1) });
  }

  if (extension === ".md") {
    return parseMarkdownFile({ filePath, content });
  }

  return {
    language: "unknown",
    fileKind: "unknown",
    symbols: [],
    facts: [],
    notes: [],
    metadata: {},
    searchText: content
  };
}
