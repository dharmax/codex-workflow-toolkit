import { withWorkflowStore } from "./sync.mjs";
import { readProjectFile } from "../lib/filesystem.mjs";
import { SEMANTICS } from "../lib/registry.mjs";

/**
 * Context Packer
 * Builds surgical, minimal context for AI tasks.
 * Includes ContextBudgeter logic to prune prompt for maximum efficiency.
 */

export async function buildSurgicalContext(projectRoot, { symbolNames = [], filePaths = [], ticketId = null } = {}) {
  const budget = SEMANTICS.BUDGET;

  return withWorkflowStore(projectRoot, async (store) => {
    const context = {
      files: [],
      symbols: [],
      guidelines: [],
      ticket: null,
      budgetReached: false
    };

    // 1. Pull Ticket (Highest Priority)
    if (ticketId) {
      context.ticket = store.getEntity(ticketId);
    }

    // 2. Pull specified files (with Budgeting)
    const limitedFilePaths = filePaths.slice(0, budget.MAX_FILES);
    if (filePaths.length > budget.MAX_FILES) context.budgetReached = true;

    for (const filePath of limitedFilePaths) {
      const file = await readProjectFile(projectRoot, filePath);
      const lines = file.content.split("\n");
      // Surgical Slice: Limit file size to 300 lines or 5000 chars
      const truncated = lines.slice(0, 300).join("\n");
      context.files.push({
        path: filePath,
        content: truncated.length > 5000 ? truncated.slice(0, 5000) + "... [TRUNCATED]" : truncated
      });
    }

    // 3. Pull specified symbols (with Budgeting)
    const limitedSymbols = symbolNames.slice(0, budget.MAX_SYMBOLS);
    for (const name of limitedSymbols) {
      const symbol = store.db.prepare("SELECT * FROM symbols WHERE name = ?").get(name);
      if (symbol) {
        const file = await readProjectFile(projectRoot, symbol.file_path);
        // Extract just the symbol's code block from the file
        const snippet = extractSymbolSnippet(file.content, symbol);
        // Limit snippet size
        const snippetLines = snippet.split("\n");
        const truncatedSnippet = snippetLines.length > 200 ? snippetLines.slice(0, 200).join("\n") + "\n... [TRUNCATED]" : snippet;

        context.symbols.push({
          name,
          path: symbol.file_path,
          snippet: truncatedSnippet
        });

        // Find dependencies (outgoing edges)
        const deps = store.db.prepare(`
          SELECT s.name, s.file_path 
          FROM symbols s
          JOIN facts f ON s.id = f.subject_id
          WHERE f.file_path = ? AND f.predicate = 'calls'
        `).all(symbol.file_path);
        
        // Add minimal metadata about dependencies
        context.symbols.push(...deps.map(d => ({ name: d.name, path: d.file_path, isDependency: true })));
      }
    }

    return context;
  });
}

function extractSymbolSnippet(content, symbol) {
  // Simple line-based extraction for now. 
  // Future: Use AST ranges from DB if available.
  const lines = content.split("\n");
  const start = Math.max(0, (symbol.start_line ?? 1) - 1);
  const end = symbol.end_line ?? lines.length;
  return lines.slice(start, end).join("\n");
}

export function formatContextForPrompt(context) {
  const parts = [];

  if (context.ticket) {
    parts.push(`## Ticket: ${context.ticket.id}\n${context.ticket.title}\n${context.ticket.data?.summary ?? ""}`);
  }

  if (context.files.length) {
    parts.push("## Files");
    for (const file of context.files) {
      parts.push(`File: ${file.path}\n\`\`\`\n${file.content}\n\`\`\``);
    }
  }

  if (context.symbols.length) {
    parts.push("## Relevant Symbols");
    for (const sym of context.symbols) {
      if (sym.snippet) {
        parts.push(`Symbol: ${sym.name} (${sym.path})\n\`\`\`\n${sym.snippet}\n\`\`\``);
      } else {
        parts.push(`Dependency: ${sym.name} in ${sym.path}`);
      }
    }
  }

  return parts.join("\n\n");
}
