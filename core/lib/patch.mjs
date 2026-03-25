/**
 * Unified Patch Engine
 * Implements a strict SEARCH/REPLACE block protocol for surgical code edits.
 * Format:
 * <<<< SEARCH
 * old code
 * ====
 * new code
 * >>>>
 */

export function parsePatch(text) {
  const blocks = [];
  const regex = /(?:File:\s*([^\r\n]+)\r?\n)?<<<< SEARCH\r?\n([\s\S]*?)\r?\n====\r?\n([\s\S]*?)\r?\n>>>>/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    blocks.push({
      file: match[1] ? match[1].trim() : null,
      search: match[2],
      replace: match[3]
    });
  }

  return blocks;
}

export function applyPatch(content, blocks) {
  let result = content;
  const results = [];

  for (const block of blocks) {
    const searchTrimmed = block.search.trim();
    if (!searchTrimmed) {
      // Handle "insert at end" or "append" if needed, but for now strict matching
      continue;
    }

    // Attempt exact match first
    if (result.includes(block.search)) {
      result = result.replace(block.search, block.replace);
      results.push({ ok: true, method: "exact" });
      continue;
    }

    // Attempt whitespace-insensitive fuzzy match
    const fuzzySearch = escapeRegExp(block.search).replace(/\s+/g, "\\s+");
    const fuzzyRegex = new RegExp(fuzzySearch, "m");
    
    if (fuzzyRegex.test(result)) {
      result = result.replace(fuzzyRegex, block.replace);
      results.push({ ok: true, method: "fuzzy" });
    } else {
      results.push({ ok: false, error: "Block not found in content." });
    }
  }

  return {
    content: result,
    summary: results,
    allApplied: results.every(r => r.ok)
  };
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
