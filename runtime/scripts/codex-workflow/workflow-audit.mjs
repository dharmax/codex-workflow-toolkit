#!/usr/bin/env node

import path from "node:path";
import { parseArgs, printAndExit } from "./lib/cli.mjs";
import { fileExistsRelative, runGuidelineAudit } from "./lib/audit-utils.mjs";
import { readText } from "./lib/fs-utils.mjs";
import { parseKanban } from "./lib/kanban-utils.mjs";

const HELP = `Usage:
  node scripts/codex-workflow/workflow-audit.mjs

Options:
  --root <path>      Project root. Defaults to current directory.
  --json             Emit JSON.
`;

const REQUIRED_DOCS = [
  "AGENTS.md",
  "CONTRIBUTING.md",
  "execution-protocol.md",
  "project-guidelines.md",
  "knowledge.md",
  "kanban.md"
];

const DOC_SNIPPETS = {
  "AGENTS.md": ["## Read Order", "## Core Contract"],
  "CONTRIBUTING.md": ["## Burst Rule", "## Validation By Risk", "## Truthfulness Rules"],
  "execution-protocol.md": ["## Required Order", "## Validation Rules", "## Status Rules", "## Closure Gate"],
  "project-guidelines.md": ["## Non-Negotiables", "## Layer Boundaries", "## Test Strategy"],
  "knowledge.md": ["## Durable Lessons"]
};

const KANBAN_SECTIONS = ["Backlog", "Ready", "In Progress", "Review", "Blocked", "Done"];

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printAndExit(HELP);
}

const root = path.resolve(String(args.root ?? process.cwd()));
const failures = [];
const activeDocs = [];

for (const relativePath of REQUIRED_DOCS) {
  if (!(await fileExistsRelative(root, relativePath))) {
    failures.push(`missing required doc: ${relativePath}`);
    continue;
  }

  activeDocs.push(relativePath);
}

let packageScripts = new Set();
if (await fileExistsRelative(root, "package.json")) {
  try {
    const packageJson = JSON.parse(await readText(path.resolve(root, "package.json")));
    packageScripts = new Set(Object.keys(packageJson.scripts ?? {}));
  } catch (error) {
    failures.push(`package.json: invalid JSON (${error.message})`);
  }
}

for (const relativePath of activeDocs) {
  const text = await readText(path.resolve(root, relativePath));

  for (const snippet of DOC_SNIPPETS[relativePath] ?? []) {
    if (!text.includes(snippet)) {
      failures.push(`${relativePath}: missing required workflow snippet -> ${snippet}`);
    }
  }

  for (const target of collectMarkdownRefs(relativePath, text)) {
    if (!(await fileExistsRelative(root, target))) {
      failures.push(`${relativePath}: broken local ref -> ${target}`);
    }
  }

  for (const scriptName of collectPnpmScriptRefs(text)) {
    if (!packageScripts.has(scriptName)) {
      failures.push(`${relativePath}: unknown pnpm script -> ${scriptName}`);
    }
  }
}

if (activeDocs.includes("kanban.md")) {
  const kanban = await readText(path.resolve(root, "kanban.md"));
  const parsed = parseKanban(kanban);
  const sectionNames = new Set(parsed.sections.map((section) => section.name));

  for (const section of KANBAN_SECTIONS) {
    if (!sectionNames.has(section)) {
      failures.push(`kanban.md: missing section -> ${section}`);
    }
  }

  const inProgressTickets = parsed.tickets.filter((ticket) => ticket.section === "In Progress");
  if (inProgressTickets.length > 1) {
    failures.push(`kanban.md: expected at most 1 ticket in In Progress, found ${inProgressTickets.length}`);
  }
}

const guidelineAudit = await runGuidelineAudit(root);
failures.push(...guidelineAudit.failures);

const summary = {
  root,
  failures,
  activeDocs,
  packageScripts: [...packageScripts].sort(),
  guidelineAudit: {
    blockCount: guidelineAudit.blockCount,
    ruleCounts: guidelineAudit.ruleCounts
  }
};

if (args.json) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exit(failures.length ? 1 : 0);
}

if (failures.length) {
  process.stderr.write("workflow-audit: FAIL\n");
  for (const failure of failures) {
    process.stderr.write(`- ${failure}\n`);
  }
  process.exit(1);
}

process.stdout.write("workflow-audit: OK\n");
process.stdout.write(`- active docs checked: ${activeDocs.length}\n`);
process.stdout.write(`- package scripts checked: ${packageScripts.size}\n`);
process.stdout.write(`- audit extension blocks: ${guidelineAudit.blockCount}\n`);

function collectMarkdownRefs(docPath, text) {
  const targets = new Set();
  const markdownLinks = /\[[^\]]*]\((?!https?:\/\/|#|mailto:)([^)]+)\)/g;
  const codePathRefs = /`((?:\.\.\/|\.\/)?(?:AGENTS|CONTRIBUTING|execution-protocol|project-guidelines|knowledge|kanban|README|docs|src|tests|package)\S*)`/g;

  for (const match of text.matchAll(markdownLinks)) {
    const target = normalizeRef(docPath, match[1]);
    if (target) {
      targets.add(target);
    }
  }

  for (const match of text.matchAll(codePathRefs)) {
    const target = normalizeRef(docPath, match[1].replace(/[),.;:]+$/, ""));
    if (target) {
      targets.add(target);
    }
  }

  return [...targets];
}

function collectPnpmScriptRefs(text) {
  const scripts = [];
  const commandRefs = /`pnpm\s+-s\s+([a-z0-9:_-]+)(?:\s+[^`]*)?`/gi;

  for (const match of text.matchAll(commandRefs)) {
    scripts.push(match[1]);
  }

  return scripts;
}

function normalizeRef(docPath, target) {
  const clean = String(target).split("#")[0].trim();

  if (!clean || clean.endsWith("/*")) {
    return null;
  }

  if (clean.startsWith("./") || clean.startsWith("../")) {
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(docPath), clean));
    return resolved.startsWith("../") ? null : resolved;
  }

  if (clean.startsWith("/")) {
    return null;
  }

  return path.posix.normalize(clean);
}
