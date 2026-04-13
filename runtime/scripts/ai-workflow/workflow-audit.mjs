#!/usr/bin/env node

import path from "node:path";
import { parseArgs, printAndExit } from "./lib/cli.mjs";
import { buildWorkflowAuditSummary } from "./lib/workflow-audit-report.mjs";

const HELP = `Usage:
  node scripts/ai-workflow/workflow-audit.mjs

Options:
  --root <path>      Project root. Defaults to current directory.
  --json             Emit JSON.
`;

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printAndExit(HELP);
}

const root = path.resolve(String(args.root ?? process.cwd()));
const summary = await buildWorkflowAuditSummary(root);

if (args.json) {
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.failures.length ? 1 : 0;
} else if (summary.failures.length) {
  console.error("workflow-audit: FAIL");
  console.error("Findings");
  for (const finding of summary.findings) {
    const location = finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ""}` : "audit";
    console.error(`- ${location}: ${finding.message}`);
  }
  process.exitCode = 1;
} else {
  console.log("workflow-audit: OK");
  console.log(`- active docs checked: ${summary.activeDocs.length}`);
  console.log(`- package scripts checked: ${summary.packageScripts.length}`);
  console.log(`- audit extension blocks: ${summary.guidelineAudit.blockCount}`);
}
