#!/usr/bin/env node

import path from "node:path";
import { parseArgs, printAndExit } from "./lib/cli.mjs";
import { runGuidelineAudit } from "./lib/audit-utils.mjs";

const HELP = `Usage:
  node scripts/codex-workflow/guideline-audit.mjs

Options:
  --root <path>      Project root. Defaults to current directory.
  --json             Emit JSON.
`;

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printAndExit(HELP);
}

const root = path.resolve(String(args.root ?? process.cwd()));
const summary = await runGuidelineAudit(root);

if (args.json) {
  process.stdout.write(`${JSON.stringify({ root, ...summary }, null, 2)}\n`);
  process.exit(summary.failures.length ? 1 : 0);
}

if (summary.failures.length) {
  process.stderr.write("guideline-audit: FAIL\n");
  for (const failure of summary.failures) {
    process.stderr.write(`- ${failure}\n`);
  }
  process.exit(1);
}

process.stdout.write("guideline-audit: OK\n");
process.stdout.write(`- markdown docs scanned: ${summary.markdownFiles.length}\n`);
process.stdout.write(`- audit extension blocks: ${summary.blockCount}\n`);
process.stdout.write(`- header rules: ${summary.ruleCounts.headers}\n`);
process.stdout.write(`- forbidden patterns: ${summary.ruleCounts.forbiddenPatterns}\n`);
process.stdout.write(`- required patterns: ${summary.ruleCounts.requiredPatterns}\n`);
