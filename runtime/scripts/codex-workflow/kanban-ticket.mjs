#!/usr/bin/env node

import path from "node:path";
import { parseArgs, printAndExit } from "./lib/cli.mjs";
import { readText } from "./lib/fs-utils.mjs";
import { findTicket, parseKanban, renderTicket } from "./lib/kanban-utils.mjs";

const HELP = `Usage:
  node scripts/codex-workflow/kanban-ticket.mjs --id TKT-001
  node scripts/codex-workflow/kanban-ticket.mjs --section "Ready"

Options:
  --root <path>      Project root. Defaults to current directory.
  --file <path>      Kanban file path relative to root. Defaults to kanban.md.
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
const kanbanPath = path.resolve(root, String(args.file ?? "kanban.md"));
const markdown = await readText(kanbanPath);

if (!markdown.trim()) {
  printAndExit(`Kanban file not found or empty: ${kanbanPath}`, 1);
}

const parsed = parseKanban(markdown);
const ticket = findTicket(parsed, { id: args.id, section: args.section });

if (!ticket) {
  const query = args.id ? `id ${args.id}` : `section ${args.section}`;
  printAndExit(`No ticket found for ${query} in ${kanbanPath}`, 1);
}

if (args.json) {
  process.stdout.write(`${JSON.stringify(ticket, null, 2)}\n`);
  process.exit(0);
}

process.stdout.write(`${renderTicket(ticket)}\n`);

