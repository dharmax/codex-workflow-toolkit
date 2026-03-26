import { getNoteRegex, SEMANTICS } from "./registry.mjs";

/** 
 * Fuzzy and sophisticated searching utilities for ai-workflow.
 * Now driven by the Semantic Registry.
 */

export function findNotesFuzzily(text) {
  const lines = text.split("\n");
  const results = [];
  const regex = getNoteRegex();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(regex);
    if (match) {
      const fullMatch = match[0];
      const body = match[1];
      
      // Determine type by matching the start of the match against aliases
      const type = inferNoteType(fullMatch);
      
      results.push({
        type,
        body: body.trim(),
        line: i + 1
      });
    }
  }

  return results;
}

function inferNoteType(matchText) {
  const lower = matchText.toLowerCase();
  for (const [canonical, aliases] of Object.entries(SEMANTICS.NOTES.aliases)) {
    if (aliases.some(a => lower.includes(a.toLowerCase()))) return canonical;
  }
  for (const marker of SEMANTICS.NOTES.markers) {
    if (lower.includes(marker.toLowerCase())) return marker;
  }
  return "TODO"; // Default
}

export function isPathSimilar(pathA, pathB) {
  const normA = pathA.toLowerCase().replace(/\\/g, "/");
  const normB = pathB.toLowerCase().replace(/\\/g, "/");
  if (normA === normB) return true;
  
  const partsA = normA.split("/");
  const partsB = normB.split("/");
  const lastA = partsA.at(-1);
  const lastB = partsB.at(-1);
  
  if (lastA === lastB) return true;
  if (lastA.replace(".", "") === lastB.replace(".", "")) return true;
  
  return false;
}

export function fuzzyMatchEntityId(query, entities) {
  const upper = query.toUpperCase();
  const exact = entities.find(e => e.id === upper);
  if (exact) return exact;
  
  if (/^\d+$/.test(query)) {
    const padded = query.padStart(3, "0");
    return entities.find(e => e.id.endsWith(`-${padded}`));
  }
  
  return entities.find(e => e.id.includes(upper));
}
