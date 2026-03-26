#!/usr/bin/env node

import path from "node:path";
import { parseArgs, printAndExit } from "./lib/cli.mjs";
import { readText } from "./lib/fs-utils.mjs";
import { findTicket, parseKanban, renderTicket } from "./lib/kanban-utils.mjs";
import { loadTicketContext, selectKanbanSource } from "./lib/workflow-store-utils.mjs";

const HELP = `Usage:
  node scripts/codex-workflow/kanban-ticket.mjs --id TKT-001
  node scripts/codex-workflow/kanban-ticket.mjs --section "ToDo"

Options:
  --root <path>      Project root. Defaults to current directory.
  --file <path>      Kanban file path relative to root. Overrides source discovery.
  --id <ticket>      Ticket id to extract.
  --section <name>   First ticket in a section.
  --json             Emit JSON.
`;

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printAndExit(HELP);
}

if (!args.id && !args.section) {
  printAndExit(HELP, 1);
}

const root = path.resolve(String(args.root ?? process.cwd()));
let ticket = null;
let ticketSourcePath = null;

if (args.id) {
  const resolved = await loadTicketContext({ root, ticketId: args.id, kanbanPath: args.file ?? null });
  ticket = resolved.ticket;
  ticketSourcePath = resolved.sourcePath;
} else {
  const source = await selectKanbanSource(root, args.file ?? null);
  const markdown = source.text;
  if (!markdown.trim()) {
    printAndExit(`Kanban file not found or empty: ${path.resolve(root, source.path)}`, 1);
  }
  const parsed = parseKanban(markdown);
  ticket = findTicket(parsed, { id: args.id, section: args.section });
  ticketSourcePath = source.path;
}

if (!ticket) {
  const query = args.id ? `id ${args.id}` : `section ${args.section}`;
  printAndExit(`No ticket found for ${query} in ${path.resolve(root, ticketSourcePath ?? ".")}`, 1);
}

if (args.json) {
  process.stdout.write(`${JSON.stringify(ticket, null, 2)}\n`);
  process.exit(0);
}

process.stdout.write(`${renderTicket(ticket)}\n`);
