#!/usr/bin/env node

import path from "node:path";
import { parseArgs, printAndExit, splitCsv } from "./lib/cli.mjs";
import { exists, normalizePath, readText } from "./lib/fs-utils.mjs";
import { deriveKeywords, summarizeGuidance } from "./lib/guidance-utils.mjs";
import { getChanges, isGitRepo } from "./lib/git-utils.mjs";
import { findTicket, parseKanban } from "./lib/kanban-utils.mjs";

const HELP = `Usage:
  node scripts/codex-workflow/guidance-summary.mjs --ticket TKT-001
  node scripts/codex-workflow/guidance-summary.mjs --ticket TKT-001 --changed
  node scripts/codex-workflow/guidance-summary.mjs --files src/app.ts,tests/app.spec.ts

Options:
  --root <path>      Project root. Defaults to current directory.
  --ticket <id>      Ticket id from kanban.md.
  --kanban <path>    Kanban file path relative to root. Defaults to kanban.md.
  --files <list>     Comma-separated file paths to focus on.
  --changed          Include current git changes as file context.
  --json             Emit JSON.
`;

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printAndExit(HELP);
}

const root = path.resolve(String(args.root ?? process.cwd()));
const kanbanPath = path.resolve(root, String(args.kanban ?? "kanban.md"));
const fileInputs = splitCsv(args.files);
const files = [...fileInputs];
let ticket = null;

if (args.ticket) {
  const kanban = await readText(kanbanPath);

  if (!kanban.trim()) {
    printAndExit(`Kanban file not found or empty: ${kanbanPath}`, 1);
  }

  const parsed = parseKanban(kanban);
  ticket = findTicket(parsed, { id: args.ticket });

  if (!ticket) {
    printAndExit(`Ticket ${args.ticket} not found in ${kanbanPath}`, 1);
  }
}

if (args.changed) {
  if (!(await isGitRepo(root))) {
    printAndExit(`Not a git repository: ${root}`, 1);
  }

  const changed = await getChanges(root);
  for (const change of changed) {
    files.push(change.path);
  }
}

const uniqueFiles = [...new Set(files.filter(Boolean).map(normalizePath))];
const ticketText = ticket ? `${ticket.heading}\n${ticket.body}` : "";
const keywords = deriveKeywords({ ticketText, files: uniqueFiles });

const agentsPath = path.resolve(root, "AGENTS.md");
const contributingPath = path.resolve(root, "CONTRIBUTING.md");
const executionProtocolPath = path.resolve(root, "execution-protocol.md");
const guidelinesPath = path.resolve(root, "project-guidelines.md");
const knowledgePath = path.resolve(root, "knowledge.md");
const [agents, contributing, executionProtocol, guidelines, knowledge] = await Promise.all([
  readText(agentsPath),
  readText(contributingPath),
  readText(executionProtocolPath),
  readText(guidelinesPath),
  readText(knowledgePath)
]);

const summary = {
  root,
  ticket: ticket ? { id: ticket.id, title: ticket.title, section: ticket.section } : null,
  files: uniqueFiles,
  keywords,
  sections: {
    agents: summarizeGuidance(agents, keywords, { alwaysIncludeTop: true, limit: 6, fallbackLimit: 6 }),
    contributing: summarizeGuidance(contributing, keywords, { limit: 6, fallbackLimit: 4 }),
    executionProtocol: summarizeGuidance(executionProtocol, keywords, { limit: 6, fallbackLimit: 4 }),
    projectGuidelines: summarizeGuidance(guidelines, keywords, { limit: 6, fallbackLimit: 4 }),
    knowledge: summarizeGuidance(knowledge, keywords, { limit: 6, fallbackLimit: 4 })
  }
};

if (args.json) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exit(0);
}

const missingFiles = [];
for (const filePath of [agentsPath, contributingPath, executionProtocolPath, guidelinesPath, knowledgePath]) {
  if (!(await exists(filePath))) {
    missingFiles.push(path.basename(filePath));
  }
}

const lines = [];

if (ticket) {
  lines.push(`Ticket: ${ticket.id} | ${ticket.section} | ${ticket.title}`);
}

if (uniqueFiles.length) {
  lines.push(`Files: ${uniqueFiles.join(", ")}`);
}

if (missingFiles.length) {
  lines.push(`Missing guidance files: ${missingFiles.join(", ")}`);
}

lines.push("");
lines.push("AGENTS");
for (const item of summary.sections.agents) {
  lines.push(`- ${item}`);
}

lines.push("");
lines.push("Contributing");
for (const item of summary.sections.contributing) {
  lines.push(`- ${item}`);
}

lines.push("");
lines.push("Execution Protocol");
for (const item of summary.sections.executionProtocol) {
  lines.push(`- ${item}`);
}

lines.push("");
lines.push("Project Guidelines");
for (const item of summary.sections.projectGuidelines) {
  lines.push(`- ${item}`);
}

lines.push("");
lines.push("Knowledge");
for (const item of summary.sections.knowledge) {
  lines.push(`- ${item}`);
}

process.stdout.write(`${lines.join("\n").trimEnd()}\n`);
