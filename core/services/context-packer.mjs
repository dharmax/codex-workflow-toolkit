import { withWorkflowStore } from "./sync.mjs";
import { readProjectFile } from "../lib/filesystem.mjs";

/**
 * Context Packer
 * Builds surgical, minimal context for AI tasks by querying the SQLite graph.
 */

export async function buildSurgicalContext(projectRoot, { symbolNames = [], filePaths = [], ticketId = null } = {}) {
  return withWorkflowStore(projectRoot, async (store) => {
    const context = {
      files: [],
      symbols: [],
      guidelines: [],
      ticket: null
    };

    // 1. Pull Ticket if specified
    if (ticketId) {
      context.ticket = store.getEntity(ticketId);
    }

    // 2. Pull specified files
    for (const filePath of filePaths) {
      const file = await readProjectFile(projectRoot, filePath);
      const lines = file.content.split("\n");
      const truncated = lines.length > 500 ? lines.slice(0, 500).join("\n") + "\n... [TRUNCATED for token efficiency]" : file.content;
      context.files.push({
        path: filePath,
        content: truncated
      });
    }

    // 3. Pull specified symbols and their immediate neighbors (1-hop)
    for (const name of symbolNames) {
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
