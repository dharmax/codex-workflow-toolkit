#!/usr/bin/env node

import path from "node:path";
import { parseArgs, printAndExit, splitCsv } from "./lib/cli.mjs";
import { exists, isWorkflowStatePath, normalizePath, readText } from "./lib/fs-utils.mjs";
import { compactGuidanceItems, deriveKeywords, inferValidationPlan, summarizeGuidance } from "./lib/guidance-utils.mjs";
import { getChanges, isGitRepo } from "./lib/git-utils.mjs";
import { loadTicketContext } from "./lib/workflow-store-utils.mjs";

const HELP = `Usage:
  node scripts/ai-workflow/guidance-summary.mjs --ticket TKT-001
  node scripts/ai-workflow/guidance-summary.mjs --ticket TKT-001 --changed
  node scripts/ai-workflow/guidance-summary.mjs --files src/app.ts,tests/app.spec.ts

Options:
  --root <path>      Project root. Defaults to current directory.
  --ticket <id>      Ticket id from the synced workflow DB or discovered kanban source.
  --kanban <path>    Kanban file path relative to root. Overrides source discovery.
  --files <list>     Comma-separated file paths to focus on.
  --changed          Include current git changes as file context.
  --json             Emit JSON.
`;

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printAndExit(HELP);
}

const root = path.resolve(String(args.root ?? process.cwd()));
const fileInputs = splitCsv(args.files);
const files = [...fileInputs];
let ticket = null;
let ticketSourcePath = null;

if (args.ticket) {
  const resolved = await loadTicketContext({ root, ticketId: args.ticket, kanbanPath: args.kanban ?? null });
  ticket = resolved.ticket;
  ticketSourcePath = resolved.sourcePath;
  if (!ticket) {
    printAndExit(`Ticket ${args.ticket} not found in ${ticketSourcePath ? path.resolve(root, ticketSourcePath) : root}`, 1);
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

const uniqueFiles = [...new Set(files.filter(Boolean).map(normalizePath).filter((filePath) => !isWorkflowStatePath(filePath)))];
const ticketText = ticket ? `${ticket.heading}\n${ticket.body}` : "";
const keywords = deriveKeywords({ ticketText, files: uniqueFiles });

const agentsPath = path.resolve(root, "AGENTS.md");
const contributingPath = path.resolve(root, "CONTRIBUTING.md");
const executionProtocolPath = path.resolve(root, "execution-protocol.md");
const enforcementPath = path.resolve(root, "enforcement.md");
const guidelinesPath = path.resolve(root, "project-guidelines.md");
const knowledgePath = path.resolve(root, "knowledge.md");
const [agents, contributing, executionProtocol, enforcement, guidelines, knowledge] = await Promise.all([
  readText(agentsPath),
  readText(contributingPath),
  readText(executionProtocolPath),
  readText(enforcementPath),
  readText(guidelinesPath),
  readText(knowledgePath)
]);

const seenGuidance = new Set();
const summary = {
  root,
  ticket: ticket ? { id: ticket.id, title: ticket.title, section: ticket.section } : null,
  ticketSourcePath,
  files: uniqueFiles,
  keywords,
  validationPlan: inferValidationPlan({ ticket, files: uniqueFiles }),
  sections: {
    agents: compactGuidanceItems(summarizeGuidance(agents, keywords, { alwaysIncludeTop: true, limit: 4, fallbackLimit: 4 }), { seenNormalized: seenGuidance }),
    contributing: compactGuidanceItems(summarizeGuidance(contributing, keywords, { limit: 4, fallbackLimit: 3 }), { seenNormalized: seenGuidance }),
    executionProtocol: compactGuidanceItems(summarizeGuidance(executionProtocol, keywords, { limit: 4, fallbackLimit: 3 }), { seenNormalized: seenGuidance }),
    enforcement: compactGuidanceItems(summarizeGuidance(enforcement, keywords, { limit: 3, fallbackLimit: 2 }), { seenNormalized: seenGuidance }),
    projectGuidelines: compactGuidanceItems(summarizeGuidance(guidelines, keywords, { limit: 4, fallbackLimit: 3 }), { seenNormalized: seenGuidance }),
    knowledge: compactGuidanceItems(summarizeGuidance(knowledge, keywords, { limit: 3, fallbackLimit: 2 }), { seenNormalized: seenGuidance })
  }
};

if (args.json) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exit(0);
}

const missingFiles = [];
for (const filePath of [agentsPath, contributingPath, executionProtocolPath, enforcementPath, guidelinesPath, knowledgePath]) {
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
lines.push("Suggested Validation");
lines.push(`- Level: ${summary.validationPlan.level}`);
lines.push(`- Recommendation: ${summary.validationPlan.recommendation}`);
for (const item of summary.validationPlan.checks) {
  lines.push(`- Check: ${item}`);
}
for (const item of summary.validationPlan.notes) {
  lines.push(`- Note: ${item}`);
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
lines.push("Enforcement");
for (const item of summary.sections.enforcement) {
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
