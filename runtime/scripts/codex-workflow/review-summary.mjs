#!/usr/bin/env node

import path from "node:path";
import { parseArgs, printAndExit, splitCsv } from "./lib/cli.mjs";
import { normalizePath } from "./lib/fs-utils.mjs";
import { getChanges, isGitRepo } from "./lib/git-utils.mjs";

const HELP = `Usage:
  node scripts/codex-workflow/review-summary.mjs
  node scripts/codex-workflow/review-summary.mjs --base origin/main
  node scripts/codex-workflow/review-summary.mjs --files src/app.ts,tests/app.spec.ts

Options:
  --root <path>      Project root. Defaults to current directory.
  --base <ref>       Compare against a base ref instead of the working tree.
  --files <list>     Comma-separated explicit file list.
  --json             Emit JSON.
`;

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printAndExit(HELP);
}

const root = path.resolve(String(args.root ?? process.cwd()));
const explicitFiles = splitCsv(args.files).map(normalizePath);
let changes = [];

if (explicitFiles.length) {
  changes = explicitFiles.map((filePath) => ({ path: filePath, status: "explicit", rawStatus: "explicit" }));
} else {
  if (!(await isGitRepo(root))) {
    printAndExit(`Not a git repository: ${root}`, 1);
  }

  changes = (await getChanges(root, args.base)).map((change) => ({
    ...change,
    path: normalizePath(change.path)
  }));
}

if (!changes.length) {
  printAndExit("No changed files found.");
}

const counts = {
  source: 0,
  tests: 0,
  docs: 0,
  config: 0,
  guidance: 0,
  other: 0
};

const focus = [];
const sourceFiles = [];
const testFiles = [];

for (const change of changes) {
  const type = classify(change.path);
  counts[type] += 1;

  if (type === "source") {
    sourceFiles.push(change.path);
  }

  if (type === "tests") {
    testFiles.push(change.path);
  }

  if (change.status === "deleted" || change.status === "renamed") {
    focus.push(`${change.status}: ${change.path}`);
  }

  if (type === "config") {
    focus.push(`config changed: ${change.path}`);
  }

  if (type === "guidance") {
    focus.push(`guidance changed: ${change.path}`);
  }
}

if (sourceFiles.length && testFiles.length === 0) {
  focus.push("source changed without matching test-file changes");
}

if (changes.length > 15) {
  focus.push(`wide change surface: ${changes.length} files`);
}

const summary = {
  root,
  base: args.base ? String(args.base) : null,
  counts,
  changes,
  focus: [...new Set(focus)]
};

if (args.json) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exit(0);
}

const lines = [];
lines.push(`Changed files: ${changes.length}`);
lines.push(
  `Counts: source ${counts.source}, tests ${counts.tests}, docs ${counts.docs}, config ${counts.config}, guidance ${counts.guidance}, other ${counts.other}`
);
lines.push("");
lines.push("Files");
for (const change of changes) {
  lines.push(`- [${change.status}] ${change.path}`);
}

lines.push("");
lines.push("Review Focus");
for (const item of summary.focus.length ? summary.focus : ["no special review hotspots detected by heuristics"]) {
  lines.push(`- ${item}`);
}

process.stdout.write(`${lines.join("\n")}\n`);

function classify(filePath) {
  const normalized = normalizePath(filePath);

  if (
    normalized === "AGENTS.md"
    || normalized === "CONTRIBUTING.md"
    || normalized === "execution-protocol.md"
    || normalized === "enforcement.md"
    || normalized === "kanban.md"
    || normalized === "project-guidelines.md"
    || normalized === "knowledge.md"
  ) {
    return "guidance";
  }

  if (/(^|\/)(tests?|__tests__)\//.test(normalized) || /\.(spec|test)\.[cm]?[jt]sx?$/.test(normalized)) {
    return "tests";
  }

  if (/\.(md|mdx|txt)$/i.test(normalized)) {
    return "docs";
  }

  if (
    /(^|\/)(package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|tsconfig.*\.json|vite\.config\.[cm]?[jt]s|vitest\.config\.[cm]?[jt]s|playwright.*\.config\.[cm]?[jt]s|eslint.*|prettier.*)$/.test(normalized)
  ) {
    return "config";
  }

  if (/\.[cm]?[jt]sx?$/.test(normalized) || /\.riot$/.test(normalized)) {
    return "source";
  }

  return "other";
}
