#!/usr/bin/env node

import path from "node:path";
import { parseArgs, printAndExit, splitCsv } from "./lib/cli.mjs";
import { normalizePath, readText } from "./lib/fs-utils.mjs";
import { deriveKeywords, inferValidationPlan, summarizeGuidance } from "./lib/guidance-utils.mjs";
import { getChanges, isGitRepo } from "./lib/git-utils.mjs";
import { findTicket, parseKanban } from "./lib/kanban-utils.mjs";

const HELP = `Usage:
  node scripts/codex-workflow/context-pack.mjs --ticket TKT-001 --changed
  node scripts/codex-workflow/context-pack.mjs --files src/app.ts,tests/app.spec.ts

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
const [agents, contributing, executionProtocol, enforcement, guidelines, knowledge] = await Promise.all([
  readText(path.resolve(root, "AGENTS.md")),
  readText(path.resolve(root, "CONTRIBUTING.md")),
  readText(path.resolve(root, "execution-protocol.md")),
  readText(path.resolve(root, "enforcement.md")),
  readText(path.resolve(root, "project-guidelines.md")),
  readText(path.resolve(root, "knowledge.md"))
]);

const guidanceSlices = compactGuidance([
  ...summarizeGuidance(agents, keywords, { alwaysIncludeTop: true, limit: 3, fallbackLimit: 2 }),
  ...summarizeGuidance(contributing, keywords, { limit: 2, fallbackLimit: 2 }),
  ...summarizeGuidance(executionProtocol, keywords, { limit: 3, fallbackLimit: 2 }),
  ...summarizeGuidance(enforcement, keywords, { limit: 2, fallbackLimit: 1 }),
  ...summarizeGuidance(guidelines, keywords, { limit: 3, fallbackLimit: 2 }),
  ...summarizeGuidance(knowledge, keywords, { limit: 2, fallbackLimit: 1 })
]);

const reviewFocus = buildReviewFocus(uniqueFiles);
const hygiene = recommendSessionHygiene({ fileCount: uniqueFiles.length, guidanceCount: guidanceSlices.length, ticket });
const summary = {
  root,
  ticket: ticket ? { id: ticket.id, title: ticket.title, section: ticket.section } : null,
  workingSet: uniqueFiles,
  guidanceSlices,
  reviewFocus,
  validationPlan: inferValidationPlan({ ticket, files: uniqueFiles }),
  risks: buildRisks({ files: uniqueFiles, reviewFocus }),
  openQuestions: buildOpenQuestions({ ticket, files: uniqueFiles }),
  sessionHygiene: hygiene,
  freshSessionRecommended: hygiene.recommendation === "/new",
  resumePrompt: buildResumePrompt({ ticket, files: uniqueFiles, guidanceSlices, reviewFocus, hygiene })
};

if (args.json) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exit(0);
}

const lines = [];
if (summary.ticket) {
  lines.push(`Ticket: ${summary.ticket.id} | ${summary.ticket.section} | ${summary.ticket.title}`);
}
if (summary.workingSet.length) {
  lines.push(`Files: ${summary.workingSet.join(", ")}`);
}
lines.push(`Session hygiene: ${summary.sessionHygiene.recommendation}`);
for (const reason of summary.sessionHygiene.reasons) {
  lines.push(`- Reason: ${reason}`);
}
lines.push("");
lines.push("Guidance bundle");
for (const item of summary.guidanceSlices) {
  lines.push(`- ${item}`);
}
lines.push("");
lines.push("Review focus");
for (const item of summary.reviewFocus) {
  lines.push(`- ${item}`);
}
lines.push("");
lines.push("Resume prompt");
lines.push(summary.resumePrompt);

process.stdout.write(`${lines.join("\n").trimEnd()}\n`);

function compactGuidance(items) {
  const seen = new Set();
  const compact = [];

  for (const item of items) {
    const value = String(item).trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    compact.push(value);
  }

  return compact.slice(0, 10);
}

function buildReviewFocus(files) {
  const focus = [];

  if (!files.length) {
    focus.push("no changed-file focus detected; avoid broad rereads unless the ticket truly requires them");
  }

  if (files.some((filePath) => /\.[cm]?[jt]sx?$/.test(filePath)) && !files.some((filePath) => /(^|\/)(tests?|__tests__)\//.test(filePath) || /\.(spec|test)\.[cm]?[jt]sx?$/.test(filePath))) {
    focus.push("source changed without matching test-file changes");
  }

  if (files.some((filePath) => /(^|\/)(package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|tsconfig.*\.json|vite\.config\.[cm]?[jt]s|vitest\.config\.[cm]?[jt]s|playwright.*\.config\.[cm]?[jt]s|eslint.*|prettier.*)$/.test(filePath))) {
    focus.push("config changed: verify the command surface and downstream contracts");
  }

  if (files.some((filePath) => /(AGENTS\.md|CONTRIBUTING\.md|execution-protocol\.md|enforcement\.md|kanban\.md|project-guidelines\.md|knowledge\.md)$/.test(filePath))) {
    focus.push("workflow guidance changed: rerun workflow audit before closure");
  }

  if (files.length > 10) {
    focus.push(`wide change surface: ${files.length} files`);
  }

  return focus.length ? focus : ["no special review hotspots detected by local heuristics"];
}

function recommendSessionHygiene({ fileCount, guidanceCount, ticket }) {
  const reasons = [];
  let recommendation = "stay";

  if (fileCount >= 10 || guidanceCount >= 8) {
    recommendation = "/compact";
    reasons.push("the working set is wide enough that a compact restatement is cheaper than carrying raw detail");
  }

  if (fileCount >= 16 || (ticket && fileCount >= 12)) {
    recommendation = "/new";
    reasons.push("the session is likely heavy enough that a fresh session with a compact handoff is safer");
  }

  if (recommendation === "stay") {
    reasons.push("the current working set is still small enough to keep in the active thread");
  }

  reasons.push("/clear should be treated as a human/operator choice only when the thread is disposable and required state is externalized");
  return { recommendation, reasons };
}

function buildRisks({ files, reviewFocus }) {
  const risks = [];

  if (reviewFocus.some((item) => item.includes("config changed"))) {
    risks.push("config churn can invalidate commands or workflow expectations");
  }

  if (reviewFocus.some((item) => item.includes("source changed without matching test-file changes"))) {
    risks.push("code changes may be under-verified");
  }

  if (files.some((filePath) => /(persist|store|state|router|session|db|api|auth)/.test(filePath))) {
    risks.push("stateful or boundary code changed; prefer deterministic tests before broader runs");
  }

  return risks;
}

function buildOpenQuestions({ ticket, files }) {
  const questions = [];

  if (!ticket) {
    questions.push("what is the explicit active ticket or work item?");
  }

  if (!files.length) {
    questions.push("which concrete files or changed paths define the working set?");
  }

  return questions;
}

function buildResumePrompt({ ticket, files, guidanceSlices, reviewFocus, hygiene }) {
  const parts = [];
  parts.push("Resume this work using the compact bundle below.");

  if (ticket) {
    parts.push(`Active ticket: ${ticket.id} | ${ticket.section} | ${ticket.title}.`);
  }

  if (files.length) {
    parts.push(`Working set: ${files.join(", ")}.`);
  }

  if (guidanceSlices.length) {
    parts.push(`Guidance: ${guidanceSlices.join(" | ")}.`);
  }

  if (reviewFocus.length) {
    parts.push(`Review focus: ${reviewFocus.join(" | ")}.`);
  }

  parts.push(`Session action: ${hygiene.recommendation}.`);
  return parts.join(" ");
}
