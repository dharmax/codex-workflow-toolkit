#!/usr/bin/env node

import path from "node:path";
import { parseArgs, printAndExit } from "./lib/cli.mjs";
import { fileExistsRelative, runGuidelineAudit } from "./lib/audit-utils.mjs";
import { readText } from "./lib/fs-utils.mjs";
import { parseKanban } from "./lib/kanban-utils.mjs";

const HELP = `Usage:
  node scripts/ai-workflow/workflow-audit.mjs

Options:
  --root <path>      Project root. Defaults to current directory.
  --json             Emit JSON.
`;

const REQUIRED_DOCS = [
  "AGENTS.md",
  "CONTRIBUTING.md",
  "execution-protocol.md",
  "enforcement.md",
  "project-guidelines.md",
  "knowledge.md",
  "kanban.md",
  "kanban-archive.md",
  "epics.md"
];

const DOC_SNIPPETS = {
  "AGENTS.md": ["## Read Order", "## Core Contract"],
  "CONTRIBUTING.md": ["## Burst Rule", "## Validation By Risk", "## Truthfulness Rules"],
  "execution-protocol.md": [
    "## Required Order",
    "## Ticket Ownership",
    "## Kanban Discipline",
    "## Validation Rules",
    "## Status Rules",
    "## Proof Standard",
    "## Closure Gate",
    "## Adversarial Self-Check"
  ],
  "enforcement.md": ["# Enforcement", "```ai-workflow-audit", "## How To Extend"],
  "epics.md": ["# Epics"],
  "kanban-archive.md": ["# Kanban Archive"],
  "project-guidelines.md": [
    "## Non-Negotiables",
    "## Layer Boundaries",
    "## File Responsibility Headers",
    "## Test Strategy"
  ],
  "knowledge.md": ["## Durable Lessons"]
};

const KANBAN_SECTIONS = [
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
const OPTIONAL_KANBAN_SECTIONS = [
  "AI Candidates",
  "Risk Watch",
  "Doubtful Relevancy",
  "Ideas"
];
const ALLOWED_KANBAN_SECTIONS = [...KANBAN_SECTIONS, ...OPTIONAL_KANBAN_SECTIONS];
const DONE_DATE_PATTERN = /✅\s*(\d{4}-\d{2}-\d{2})/i;
const EPIC_PATTERN = /(?:^|\n)-\s*Epic:\s*([A-Z][A-Z0-9]+-\d+)\s*(?:\n|$)/i;
const MAX_LIVE_DONE_DAYS = 7;

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printAndExit(HELP);
}

const root = path.resolve(String(args.root ?? process.cwd()));
const findings = [];
const activeDocs = [];

for (const relativePath of REQUIRED_DOCS) {
  if (!(await fileExistsRelative(root, relativePath))) {
    findings.push(createFinding({
      category: "workflow-docs",
      file: relativePath,
      message: "missing required doc"
    }));
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
    findings.push(createFinding({
      category: "scripts",
      file: "package.json",
      message: `invalid JSON (${error.message})`
    }));
  }
}

for (const relativePath of activeDocs) {
  const text = await readText(path.resolve(root, relativePath));

  for (const snippet of DOC_SNIPPETS[relativePath] ?? []) {
    if (!text.includes(snippet)) {
      findings.push(createFinding({
        category: "workflow-docs",
        file: relativePath,
        message: `missing required workflow snippet -> ${snippet}`
      }));
    }
  }

  for (const target of collectMarkdownRefs(relativePath, text)) {
    if (!(await fileExistsRelative(root, target))) {
      findings.push(createFinding({
        category: "references",
        file: relativePath,
        message: `broken local ref -> ${target}`
      }));
    }
  }

  for (const scriptName of collectPnpmScriptRefs(text)) {
    if (!packageScripts.has(scriptName)) {
      findings.push(createFinding({
        category: "scripts",
        file: relativePath,
        message: `unknown pnpm script -> ${scriptName}`
      }));
    }
  }
}

if (activeDocs.includes("kanban.md")) {
  const kanban = await readText(path.resolve(root, "kanban.md"));
  const parsed = parseKanban(kanban);
  const sectionNames = new Set(parsed.sections.map((section) => section.name));
  const epics = activeDocs.includes("epics.md")
    ? collectEpicIds(await readText(path.resolve(root, "epics.md")))
    : new Set();

  if (!/^%%\s*kanban:settings\s*$/im.test(kanban) || !/"kanban-plugin"\s*:\s*"board"/.test(kanban)) {
    findings.push(createFinding({
      category: "kanban",
      file: "kanban.md",
      message: 'missing Obsidian Kanban settings block (`%% kanban:settings` with `"kanban-plugin": "board"` )'
    }));
  }

  for (const section of KANBAN_SECTIONS) {
    if (!sectionNames.has(section)) {
      findings.push(createFinding({
        category: "kanban",
        file: "kanban.md",
        message: `missing section -> ${section}`
      }));
    }
  }

  const sectionOrder = parsed.sections
    .map((section) => section.name)
    .filter((name) => ALLOWED_KANBAN_SECTIONS.includes(name));
  const expectedSectionOrder = [
    ...KANBAN_SECTIONS,
    ...OPTIONAL_KANBAN_SECTIONS.filter((name) => sectionNames.has(name))
  ];

  if (sectionOrder.join("|") !== expectedSectionOrder.join("|")) {
    findings.push(createFinding({
      category: "kanban",
      file: "kanban.md",
      message: `expected lane order -> ${expectedSectionOrder.join(" -> ")}`
    }));
  }

  for (const section of parsed.sections) {
    if (!ALLOWED_KANBAN_SECTIONS.includes(section.name)) {
      findings.push(createFinding({
        category: "kanban",
        file: "kanban.md",
        line: section.headingLine + 1,
        message: `unexpected lane -> ${section.name}`
      }));
      continue;
    }

    if (OPTIONAL_KANBAN_SECTIONS.includes(section.name) && !section.tickets.length) {
      findings.push(createFinding({
        category: "kanban",
        file: "kanban.md",
        line: section.headingLine + 1,
        message: `optional lane should be omitted when empty -> ${section.name}`
      }));
    }
  }

  const inProgressTickets = parsed.tickets.filter((ticket) => ticket.section === "In Progress");
  if (inProgressTickets.length > 1) {
    findings.push(createFinding({
      category: "kanban",
      file: "kanban.md",
      message: `expected at most 1 ticket in In Progress, found ${inProgressTickets.length}`
    }));
  }

  for (const ticket of parsed.tickets) {
    if (ticket.section === "Deep Backlog") {
      const epicId = extractMetadata(ticket.body, EPIC_PATTERN);

      if (!epicId) {
        findings.push(createFinding({
          category: "kanban",
          file: "kanban.md",
          line: ticket.line,
          message: `${ticket.id ?? ticket.heading}: Deep Backlog tickets must include "- Epic: EPIC-###"`
        }));
        continue;
      }

      if (epics.size && !epics.has(epicId)) {
        findings.push(createFinding({
          category: "kanban",
          file: "kanban.md",
          line: ticket.line,
          message: `${ticket.id ?? ticket.heading}: references unknown epic -> ${epicId}`
        }));
      }
    }

    if (ticket.section !== "Done") {
      continue;
    }

    const doneDateValue = ticket.doneDate ?? extractMetadata(ticket.body, DONE_DATE_PATTERN);
    if (!doneDateValue) {
      findings.push(createFinding({
        category: "kanban",
        file: "kanban.md",
        line: ticket.line,
        message: `${ticket.id ?? ticket.heading}: Done tickets must use an Obsidian task line ending with "✅ YYYY-MM-DD"`
      }));
      continue;
    }

    const ageDays = diffDaysFromToday(doneDateValue);
    if (ageDays == null) {
      findings.push(createFinding({
        category: "kanban",
        file: "kanban.md",
        line: ticket.line,
        message: `${ticket.id ?? ticket.heading}: invalid Done date -> ${doneDateValue}`
      }));
      continue;
    }

    if (ageDays > MAX_LIVE_DONE_DAYS) {
      findings.push(createFinding({
        category: "kanban",
        file: "kanban.md",
        line: ticket.line,
        message: `${ticket.id ?? ticket.heading}: done ticket is ${ageDays} days old; move it to kanban-archive.md`
      }));
    }
  }
}

const guidelineAudit = await runGuidelineAudit(root);
for (const finding of guidelineAudit.findings) {
  findings.push({
    category: "guideline-rules",
    ...finding
  });
}
const failures = findings.map(formatWorkflowFinding);

const summary = {
  root,
  failures,
  findings,
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
  for (const [category, items] of groupFindings(findings)) {
    process.stderr.write(`${formatCategoryLabel(category)}\n`);
    for (const finding of items) {
      process.stderr.write(`- ${formatWorkflowFinding(finding)}\n`);
    }
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
  const codePathRefs = /`((?:\.\.\/|\.\/)?(?:AGENTS|CONTRIBUTING|execution-protocol|enforcement|project-guidelines|knowledge|kanban(?:-archive)?|epics|README|docs|src|tests|package)\S*)`/g;

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

function createFinding({ category, file = null, line = null, message }) {
  return {
    category,
    file,
    line,
    ruleKind: null,
    ruleId: null,
    ruleSource: null,
    message
  };
}

function formatWorkflowFinding(finding) {
  const location = finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ""}` : "audit";
  const source = finding.ruleSource ? ` (${finding.ruleSource})` : "";
  return `${location}: ${finding.message}${source}`;
}

function groupFindings(findingsList) {
  const order = ["workflow-docs", "references", "scripts", "kanban", "guideline-rules"];
  const grouped = new Map();

  for (const category of order) {
    grouped.set(category, []);
  }

  for (const finding of findingsList) {
    const bucket = grouped.get(finding.category) ?? [];
    bucket.push(finding);
    grouped.set(finding.category, bucket);
  }

  return [...grouped.entries()].filter(([, items]) => items.length);
}

function formatCategoryLabel(category) {
  switch (category) {
    case "workflow-docs":
      return "Workflow Docs";
    case "references":
      return "References";
    case "scripts":
      return "Scripts";
    case "kanban":
      return "Kanban";
    case "guideline-rules":
      return "Guideline Rules";
    default:
      return "Findings";
  }
}

function collectEpicIds(markdown) {
  const epics = new Set();
  const headingPattern = /^#{2,3}\s+([A-Z][A-Z0-9]+-\d+)\b/mg;

  for (const match of markdown.matchAll(headingPattern)) {
    epics.add(match[1]);
  }

  return epics;
}

function extractMetadata(text, pattern) {
  const match = String(text ?? "").match(pattern);
  return match ? match[1] : null;
}

function diffDaysFromToday(dateValue) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    return null;
  }

  const target = new Date(`${dateValue}T00:00:00Z`);
  if (Number.isNaN(target.getTime())) {
    return null;
  }

  const today = new Date();
  const current = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const diffMs = current.getTime() - target.getTime();
  if (diffMs < 0) {
    return 0;
  }

  return Math.floor(diffMs / 86400000);
}
