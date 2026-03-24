#!/usr/bin/env node

import path from "node:path";
import { writeFile } from "node:fs/promises";
import { parseArgs, printAndExit, requireArg } from "./lib/cli.mjs";
import { readText } from "./lib/fs-utils.mjs";
import { createTicket, parseKanbanDocument, renderKanbanDocument } from "./lib/kanban-edit-utils.mjs";

const HELP = `Usage:
  node scripts/codex-workflow/kanban-new.mjs --id TKT-123 --title "Fix login bug" --to "Bugs P1"

Options:
  --root <path>         Project root. Defaults to current directory.
  --file <path>         Kanban file path relative to root. Defaults to kanban.md.
  --id <ticket>         Ticket id to create.
  --title <text>        Ticket title.
  --to <section>        Destination lane name.
  --outcome <text>      Optional Outcome field.
  --scope <text>        Optional Scope field.
  --verification <text> Optional Verification field.
  --notes <text>        Optional Notes field.
  --epic <id>           Required for Deep Backlog tickets.
  --done-date <day>     Optional YYYY-MM-DD when creating directly in Done.
  --dry-run             Print result without writing.
  --json                Emit JSON.
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
const result = createTicket(document, {
  id: requireArg(args, "id", HELP),
  title: requireArg(args, "title", HELP),
  section: requireArg(args, "to", HELP),
  outcome: args.outcome,
  scope: args.scope,
  verification: args.verification,
  notes: args.notes,
  epic: args.epic,
  doneDate: args["done-date"]
});
const nextMarkdown = renderKanbanDocument(document);

if (!args["dry-run"]) {
  await writeFile(kanbanPath, nextMarkdown, "utf8");
}

if (args.json) {
  process.stdout.write(`${JSON.stringify({ ...result, file: kanbanPath }, null, 2)}\n`);
  process.exit(0);
}

process.stdout.write(`${result.ticket.id} created in ${result.section}\n`);
