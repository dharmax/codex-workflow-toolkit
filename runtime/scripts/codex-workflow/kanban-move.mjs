#!/usr/bin/env node

import path from "node:path";
import { writeFile } from "node:fs/promises";
import { parseArgs, printAndExit, requireArg } from "./lib/cli.mjs";
import { readText } from "./lib/fs-utils.mjs";
import { moveTicket, parseKanbanDocument, renderKanbanDocument } from "./lib/kanban-edit-utils.mjs";

const HELP = `Usage:
  node scripts/codex-workflow/kanban-move.mjs --id TKT-001 --to "In Progress"
  node scripts/codex-workflow/kanban-move.mjs --id TKT-001 --to Done

Options:
  --root <path>      Project root. Defaults to current directory.
  --file <path>      Kanban file path relative to root. Defaults to kanban.md.
  --id <ticket>      Ticket id to move.
  --to <section>     Destination lane name.
  --done-date <day>  Optional YYYY-MM-DD override when moving to Done.
  --dry-run          Print result without writing.
  --json             Emit JSON.
`;

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printAndExit(HELP);
}

const root = path.resolve(String(args.root ?? process.cwd()));
const kanbanPath = path.resolve(root, String(args.file ?? "kanban.md"));
const ticketId = requireArg(args, "id", HELP);
const targetSection = requireArg(args, "to", HELP);
const markdown = await readText(kanbanPath);

if (!markdown.trim()) {
  printAndExit(`Kanban file not found or empty: ${kanbanPath}`, 1);
}

const document = parseKanbanDocument(markdown);
const result = moveTicket(document, ticketId, targetSection, {
  doneDate: args["done-date"] ? String(args["done-date"]) : null
});
const nextMarkdown = renderKanbanDocument(document);

if (!args["dry-run"]) {
  await writeFile(kanbanPath, nextMarkdown, "utf8");
}

if (args.json) {
  process.stdout.write(`${JSON.stringify({ ...result, file: kanbanPath }, null, 2)}\n`);
  process.exit(0);
}

process.stdout.write(`${result.ticket.id ?? "NO-ID"} moved: ${result.from} -> ${result.to}\n`);
