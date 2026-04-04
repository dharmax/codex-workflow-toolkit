#!/usr/bin/env node

import path from "node:path";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs, printAndExit } from "./lib/cli.mjs";
import { readText } from "./lib/fs-utils.mjs";
import { getToolkitRoot } from "./lib/toolkit-root.mjs";
import { archiveOldDoneTickets, parseKanbanDocument } from "./lib/kanban-edit-utils.mjs";

const { syncProject } = await import(pathToFileURL(path.resolve(getToolkitRoot(), "core", "services", "sync.mjs")).href);

const HELP = `Usage:
  node scripts/codex-workflow/kanban-archive.mjs

Options:
  --root <path>       Project root. Defaults to current directory.
  --file <path>       Kanban file path relative to root. Defaults to kanban.md.
  --archive <path>    Archive file path relative to root. Defaults to kanban-archive.md.
  --older-than <n>    Archive Done tickets older than this many days. Defaults to 7.
  --dry-run           Print result without writing.
  --json              Emit JSON.
`;

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printAndExit(HELP);
}

const root = path.resolve(String(args.root ?? process.cwd()));
const kanbanPath = path.resolve(root, String(args.file ?? "kanban.md"));
const archivePath = path.resolve(root, String(args.archive ?? "kanban-archive.md"));
const kanbanMarkdown = await readText(kanbanPath);

if (!kanbanMarkdown.trim()) {
  printAndExit(`Kanban file not found or empty: ${kanbanPath}`, 1);
}

const archiveMarkdown = await readText(archivePath, "# Kanban Archive\n");
const document = parseKanbanDocument(kanbanMarkdown);
const result = archiveOldDoneTickets(document, archiveMarkdown, {
  olderThanDays: Number(args["older-than"] ?? 7)
});

if (!args["dry-run"]) {
  await writeFile(kanbanPath, result.kanbanMarkdown, "utf8");
  await writeFile(archivePath, result.archiveMarkdown, "utf8");
  await syncProject({ projectRoot: root, writeProjections: true });
}

if (args.json) {
  process.stdout.write(
    `${JSON.stringify({ archived: result.archived, file: kanbanPath, archive: archivePath }, null, 2)}\n`
  );
  process.exit(0);
}

if (!result.archived.length) {
  process.stdout.write("No done tickets needed archiving.\n");
  process.exit(0);
}

process.stdout.write(
  `Archived ${result.archived.length} ticket${result.archived.length === 1 ? "" : "s"} to ${archivePath}\n`
);
