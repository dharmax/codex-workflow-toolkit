/**
 * Semantic Registry for ai-workflow.
 * Centralizes engineering concepts to avoid hardcoding and enable dynamic regex generation.
 */

export const SEMANTICS = {
  NOTES: {
    markers: ["TODO", "FIXME", "BUG", "RISK", "HACK", "NOTE", "OPTIMIZE", "REVIEW", "DEBT", "PENDING", "FIXIT", "REVISIT"],
    aliases: {
      "TODO": ["to-do", "todo", "[ ]"],
      "BUG": ["bug", "error", "fault", "fixit"],
      "REVIEW": ["review", "revisit", "audit"]
    },
    imperatives: ["MUST", "SHOULD", "FIX", "CLEANUP", "REFACTOR", "REMOVE", "IMPLEMENT"]
  },
  BUDGET: {
    MAX_TOKENS: 12000,
    MAX_FILES: 10,
    MAX_SYMBOLS: 30
  },
  FOLDERS: {
    STATE: [".ai-workflow", "workflow-state", ".state"],
    CONFIG: [".gemini", "gemini-config", "config/gemini"],
    TEMPLATES: ["templates", "blueprints", "scaffolding"]
  },
  EXTENSIONS: {
    CODE: [".js", ".mjs", ".jsx", ".ts", ".tsx", ".py", ".go", ".rs", ".java", ".c", ".cpp"],
    STYLE: [".css", ".scss", ".less", ".styl"],
    MARKUP: [".html", ".riot", ".vue", ".svelte", ".xml"],
    DATA: [".json", ".yaml", ".yml", ".toml"],
    DOCS: [".md", ".txt", ".adoc", ".org"]
  },
  LANES: {
    ACTIVE: ["In Progress", "Doing", "Active", "Working"],
    BACKLOG: ["Todo", "To-Do", "Backlog", "Queue", "Pending"],
    DONE: ["Done", "Finished", "Complete", "Closed", "Archived"]
  }
};

/**
 * Lazily builds a regex for note discovery based on the semantic registry.
 */
export function getNoteRegex() {
  const allMarkers = [
    ...SEMANTICS.NOTES.markers,
    ...Object.values(SEMANTICS.NOTES.aliases).flat()
  ];
  const escaped = allMarkers.map(m => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // Matches "TODO: body", "[TODO] body", "- [ ] body", etc.
  return new RegExp(`(?:\\b(?:${escaped.join("|")})\\b[:\\]]?|\\-\\s+\\[\\s\\])\\s*(.+)`, "i");
}

export function isFolderRole(folderName, role) {
  const possible = SEMANTICS.FOLDERS[role] ?? [];
  const normalized = folderName.toLowerCase().replace(".", "");
  return possible.some(p => p.toLowerCase().replace(".", "") === normalized);
}

export function getAllSupportedExtensions() {
  return Object.values(SEMANTICS.EXTENSIONS).flat();
}
