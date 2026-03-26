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
      const matches = store.listSymbols({ name }).slice(0, 3);
      for (const symbol of matches) {
        const file = await readProjectFile(projectRoot, symbol.filePath);
        const snippet = extractSymbolSnippet(file.content, symbol);
        const snippetLines = snippet.split("\n");
        const truncatedSnippet = snippetLines.length > 200 ? snippetLines.slice(0, 200).join("\n") + "\n... [TRUNCATED]" : snippet;

        context.symbols.push({
          id: symbol.id,
          name: symbol.name,
          kind: symbol.kind,
          path: symbol.filePath,
          line: symbol.line,
          snippet: truncatedSnippet,
          signature: symbol.metadata?.signature ?? null
        });
      }
    }

    return context;
  });
}

function extractSymbolSnippet(content, symbol) {
  const lines = content.split("\n");
  const metadata = symbol.metadata ?? {};
  const startLine = metadata.declarationLine ?? symbol.line ?? 1;
  const start = Math.max(0, startLine - 1);
  const end = Math.min(lines.length, start + 20);
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
      const header = `${sym.kind ?? "symbol"} ${sym.name} (${sym.path}${sym.line ? `:${sym.line}` : ""})`;
      parts.push(`Symbol: ${header}\n\`\`\`\n${sym.snippet ?? sym.signature ?? ""}\n\`\`\``);
    }
  }

  return parts.join("\n\n");
}
