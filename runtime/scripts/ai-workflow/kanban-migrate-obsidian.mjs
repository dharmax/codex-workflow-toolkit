#!/usr/bin/env node

import path from "node:path";
import { writeFile } from "node:fs/promises";
import { parseArgs, printAndExit } from "./lib/cli.mjs";
import { readText } from "./lib/fs-utils.mjs";

const HELP = `Usage:
  node scripts/ai-workflow/kanban-migrate-obsidian.mjs

Options:
  --root <path>      Project root. Defaults to current directory.
  --file <path>      Kanban file path relative to root. Defaults to kanban.md.
  --dry-run          Print result without writing.
`;

const DEFAULT_LANES = [
  "Deep Backlog",
  "Backlog",
  "ToDo",
  "Bugs P1",
  "Bugs P2/P3",
  "In Progress",
  "Human Inspection",
  "Suggestions",
  "Done"
];

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

if (/^%%\s*kanban:settings\s*$/im.test(markdown) && /\{"kanban-plugin":"board"\}/.test(markdown)) {
  printAndExit(`kanban.md already appears to use the Obsidian board format: ${kanbanPath}`);
}

const migrated = migrateLegacyKanban(markdown);

if (!args["dry-run"]) {
  await writeFile(kanbanPath, migrated, "utf8");
}

process.stdout.write(`Migrated kanban.md to Obsidian board format: ${kanbanPath}\n`);

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

  for (const lane of DEFAULT_LANES) {
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

  for (const lane of DEFAULT_LANES) {
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
