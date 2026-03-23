#!/usr/bin/env node

import path from "node:path";
import { parseArgs, printAndExit, splitCsv } from "./lib/cli.mjs";
import { readText } from "./lib/fs-utils.mjs";
import { getNextTicket, parseKanbanDocument } from "./lib/kanban-edit-utils.mjs";

const HELP = `Usage:
  node scripts/codex-workflow/kanban-next.mjs
  node scripts/codex-workflow/kanban-next.mjs --lanes "Bugs P1,ToDo,Bugs P2/P3"

Options:
  --root <path>      Project root. Defaults to current directory.
  --file <path>      Kanban file path relative to root. Defaults to kanban.md.
  --lanes <list>     Optional comma-separated lane priority override.
  --json             Emit JSON.
`;

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printAndExit(HELP);
}

const root = path.resolve(String(args.root ?? process.cwd()));
const kanbanPath = path.resolve(root, String(args.file ?? "kanban.md"));
const markdown = await readText(kanbanPath);

if (!markdown.trim()) {
  printAndExit(`Kanban file not found or empty: ${kanbanPath}`, 1);
}

const document = parseKanbanDocument(markdown);
const result = getNextTicket(document, {
  priorities: splitCsv(args.lanes)
});

if (!result) {
  printAndExit("No ticket found in the prioritized lanes.", 1);
}

if (args.json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(0);
}

const body = result.ticket.body?.trim() ? `\n\n${result.ticket.body.trim()}` : "";
process.stdout.write(`${result.ticket.id ?? "NO-ID"} | ${result.section} | ${result.ticket.heading}${body}\n`);
