#!/usr/bin/env node

import { parseArgs } from "../codex-workflow/lib/cli.mjs";
import { getProjectSummary } from "../../../core/services/sync.mjs";

const args = parseArgs(process.argv.slice(2));
const summary = await getProjectSummary({ projectRoot: process.cwd() });

if (args.json) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
  process.stdout.write([
    `Files indexed: ${summary.fileCount}`,
    `Symbols indexed: ${summary.symbolCount}`,
    `Notes tracked: ${summary.noteCount}`,
    `Tickets: ${summary.activeTickets.length}`,
    `Candidates: ${summary.candidates.length}`
  ].join("\n") + "\n");
}
