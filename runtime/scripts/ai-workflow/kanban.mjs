#!/usr/bin/env node

import path from "node:path";
import { writeFile } from "node:fs/promises";
import { parseArgs, printAndExit, requireArg, splitCsv } from "./lib/cli.mjs";
import { readText } from "./lib/fs-utils.mjs";
import { assertDirectCommandChannel } from "../../../core/lib/command-channel.mjs";
import { withWorkspaceMutation } from "../../../core/lib/workspace-mutation.mjs";
import {
  archiveOldDoneTickets,
  createTicket,
  getNextTicket,
  moveTicket,
  parseKanbanDocument,
  renderKanbanDocument
} from "./lib/kanban-edit-utils.mjs";

const HELP = `Usage:
  node scripts/ai-workflow/kanban.mjs <new|move|next|archive|migrate> [options]

Commands:
  new        Create a ticket card in a lane.
  move       Move a ticket card between lanes.
  next       Show the next actionable ticket.
  archive    Move aged Done cards into kanban-archive.md.
  migrate    Convert a legacy kanban format into Obsidian board format.

Options:
  --root <path>      Project root. Defaults to current directory.
  --file <path>      Kanban file path relative to root. Defaults to kanban.md.
  --json             Emit JSON.
`;

const rawArgs = process.argv.slice(2);
const [subcommand, ...tail] = rawArgs;

if (!subcommand || subcommand === "--help" || subcommand === "-h") {
  printAndExit(HELP);
}

switch (subcommand) {
  case "new":
    await runNew(tail);
    break;
  case "move":
    await runMove(tail);
    break;
  case "next":
    await runNext(tail);
    break;
  case "archive":
    await runArchive(tail);
    break;
  case "migrate":
    await runMigrate(tail);
    break;
  default:
    printAndExit(HELP, 1);
}

async function runNew(argv) {
  assertDirectCommandChannel("ai-workflow kanban new");
  const args = parseArgs(argv);
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
    await withWorkspaceMutation(root, "kanban new", async () => {
      await writeFile(kanbanPath, nextMarkdown, "utf8");
    });
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ ...result, file: kanbanPath }, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${result.ticket.id} created in ${result.section}\n`);
}

async function runMove(argv) {
  assertDirectCommandChannel("ai-workflow kanban move");
  const args = parseArgs(argv);
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
    await withWorkspaceMutation(root, "kanban move", async () => {
      await writeFile(kanbanPath, nextMarkdown, "utf8");
    });
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ ...result, file: kanbanPath }, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${result.ticket.id ?? "NO-ID"} moved: ${result.from} -> ${result.to}\n`);
}

async function runNext(argv) {
  const args = parseArgs(argv);
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
    return;
  }

  const body = result.ticket.body?.trim() ? `\n\n${result.ticket.body.trim()}` : "";
  process.stdout.write(`${result.ticket.id ?? "NO-ID"} | ${result.section} | ${result.ticket.heading}${body}\n`);
}

async function runArchive(argv) {
  assertDirectCommandChannel("ai-workflow kanban archive");
  const args = parseArgs(argv);
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
    await withWorkspaceMutation(root, "kanban archive", async () => {
      await writeFile(kanbanPath, result.kanbanMarkdown, "utf8");
      await writeFile(archivePath, result.archiveMarkdown, "utf8");
    });
  }

  if (args.json) {
    process.stdout.write(
      `${JSON.stringify({ archived: result.archived, file: kanbanPath, archive: archivePath }, null, 2)}\n`
    );
    return;
  }

  if (!result.archived.length) {
    process.stdout.write("No done tickets needed archiving.\n");
    return;
  }

  process.stdout.write(
    `Archived ${result.archived.length} ticket${result.archived.length === 1 ? "" : "s"} to ${archivePath}\n`
  );
}

async function runMigrate(argv) {
  assertDirectCommandChannel("ai-workflow kanban migrate");
  const args = parseArgs(argv);
  const root = path.resolve(String(args.root ?? process.cwd()));
  const kanbanPath = path.resolve(root, String(args.file ?? "kanban.md"));
  const markdown = await readText(kanbanPath);

  if (!markdown.trim()) {
    printAndExit(`Kanban file not found or empty: ${kanbanPath}`, 1);
  }

  if (/^%%\s*kanban:settings\s*$/im.test(markdown) && /\{"kanban-plugin":"board"\}/.test(markdown)) {
    printAndExit(`kanban.md already appears to use the Obsidian board format: ${kanbanPath}`);
  }

  const migrated = migrateLegacyKanban(markdown);

  if (!args["dry-run"]) {
    await withWorkspaceMutation(root, "kanban migrate", async () => {
      await writeFile(kanbanPath, migrated, "utf8");
    });
  }

  process.stdout.write(`Migrated kanban.md to Obsidian board format: ${kanbanPath}\n`);
}

function migrateLegacyKanban(markdownText) {
  const lines = String(markdownText).replace(/\r\n/g, "\n").split("\n");
  const sections = new Map();
  const prefixLines = [];
  let currentSection = null;
  let currentTicket = null;
  let seenSection = false;

  for (const line of lines) {
    const sectionMatch = line.match(/^##\s+(.+)$/);
    if (sectionMatch) {
      finalizeTicket(sections, currentSection, currentTicket);
      currentTicket = null;
      currentSection = normalizeLegacyLane(sectionMatch[1]);
      sections.set(currentSection, sections.get(currentSection) ?? []);
      seenSection = true;
      continue;
    }

    const ticketMatch = line.match(/^###\s+(.+)$/);
    if (ticketMatch) {
      finalizeTicket(sections, currentSection, currentTicket);
      currentTicket = {
        heading: ticketMatch[1].trim(),
        body: []
      };
      continue;
    }

    if (!seenSection) {
      prefixLines.push(line);
      continue;
    }

    if (currentTicket) {
      currentTicket.body.push(line);
    }
  }

  finalizeTicket(sections, currentSection, currentTicket);

  for (const lane of [
    "Deep Backlog",
    "Backlog",
    "ToDo",
    "Bugs P1",
    "Bugs P2/P3",
    "In Progress",
    "Human Inspection",
    "Suggestions",
    "Done"
  ]) {
    sections.set(lane, sections.get(lane) ?? []);
  }

  const parts = [];
  const cleanPrefix = prefixLines
    .filter((line) => !/^#\s+Kanban\s*$/.test(line.trim()))
    .join("\n")
    .trim();

  parts.push("# Kanban");
  parts.push("");

  if (cleanPrefix) {
    parts.push(cleanPrefix);
    parts.push("");
  } else {
    parts.push("Migrated to the Obsidian Kanban plugin format.");
    parts.push("");
  }

  for (const lane of [
    "Deep Backlog",
    "Backlog",
    "ToDo",
    "Bugs P1",
    "Bugs P2/P3",
    "In Progress",
    "Human Inspection",
    "Suggestions",
    "Done"
  ]) {
    parts.push(`## ${lane}`);
    parts.push("");

    for (const ticket of sections.get(lane) ?? []) {
      parts.push(...ticket);
      parts.push("");
    }
  }

  parts.push("%% kanban:settings");
  parts.push("```json");
  parts.push('{"kanban-plugin":"board"}');
  parts.push("```");
  parts.push("%%");

  return `${parts.join("\n").trimEnd()}\n`;
}

function finalizeTicket(sections, sectionName, ticket) {
  if (!sectionName || !ticket) {
    return;
  }

  const heading = ticket.heading.trim();
  const doneDate = extractLegacyDoneDate(ticket.body);
  const checked = sectionName === "Done";
  const bodyLines = ticket.body
    .map((line) => line.trimEnd())
    .filter((line) => !/^\s*-\s*Done:\s*\d{4}-\d{2}-\d{2}\s*$/i.test(line));

  const card = [];
  card.push(
    checked
      ? `- [x] ${stripDoneMarker(heading)}${doneDate ? ` ✅ ${doneDate}` : ""}`
      : `- [ ] ${stripDoneMarker(heading)}`
  );

  for (const line of bodyLines) {
    if (!line.trim()) {
      continue;
    }

    if (/^\s*-\s+/.test(line)) {
      card.push(`  ${line.trim()}`);
      continue;
    }

    card.push(`  - Notes: ${line.trim()}`);
  }

  sections.set(sectionName, [...(sections.get(sectionName) ?? []), card]);
}

function normalizeLegacyLane(value) {
  const name = value.trim();
  switch (name) {
    case "Ready":
      return "ToDo";
    case "Review":
      return "Human Inspection";
    case "Blocked":
      return "Bugs P1";
    default:
      return name;
  }
}

function extractLegacyDoneDate(lines) {
  for (const line of lines) {
    const match = line.match(/-\s*Done:\s*(\d{4}-\d{2}-\d{2})/i);
    if (match) {
      return match[1];
    }
  }

  return null;
}

function stripDoneMarker(value) {
  return String(value).replace(/\s+✅\s+\d{4}-\d{2}-\d{2}\s*$/i, "").trim();
}
