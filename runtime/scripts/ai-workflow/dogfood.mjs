#!/usr/bin/env node

import path from "node:path";
import { parseArgs, printAndExit, splitCsv } from "./lib/cli.mjs";
import { listOperatorSurfaceIds } from "./lib/operator-surfaces.mjs";
import { runDogfood } from "./lib/dogfood-utils.mjs";

const HELP = `Usage:
  node scripts/ai-workflow/dogfood.mjs [--surface <id[,id...]>] [--profile <bootstrap|full>] [--timeout-ms <n>] [--json]

Options:
  --root <path>         Project root. Defaults to current directory.
  --surface <list>      Operator surfaces to exercise. Defaults to all.
  --profile <name>      bootstrap or full. Defaults to full.
  --timeout-ms <n>      Per-scenario timeout in milliseconds. Defaults to 45000.
  --json                Emit JSON.

Surfaces:
  - shell
  - provider
  - workflow
  - init
`;

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printAndExit(HELP);
}

const root = path.resolve(String(args.root ?? process.cwd()));
const requestedSurfaces = args.surface ? splitCsv(args.surface) : listOperatorSurfaceIds();
const profile = String(args.profile ?? "full");
const timeoutMs = Number(args["timeout-ms"] ?? 45000);

const report = await runDogfood({
  root,
  surfaces: requestedSurfaces,
  profile,
  timeoutMs,
  writeReport: true
});

if (args.json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(0);
}

const lines = [
  `Dogfood report: ${path.resolve(root, ".ai-workflow", "generated", "dogfood-report.json")}`,
  `Profile: ${report.profile}`
];

for (const [surfaceId, surface] of Object.entries(report.surfaces ?? {})) {
  lines.push(`${surfaceId}: ${surface.status} (${surface.scenarioCount} scenarios, ${surface.fileCount} files)`);
  for (const scenario of surface.scenarios ?? []) {
    lines.push(`- ${scenario.ok ? "PASS" : "FAIL"} ${scenario.id}${scenario.model ? ` [${scenario.model}]` : ""}`);
  }
}

process.stdout.write(`${lines.join("\n")}\n`);
