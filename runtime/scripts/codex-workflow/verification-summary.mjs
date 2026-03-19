#!/usr/bin/env node

import path from "node:path";
import { spawn } from "node:child_process";
import { parseArgs, asArray, printAndExit } from "./lib/cli.mjs";

const HELP = `Usage:
  node scripts/codex-workflow/verification-summary.mjs --cmd "pnpm test" --cmd "pnpm build"

Options:
  --root <path>      Project root. Defaults to current directory.
  --ticket <id>      Optional ticket id for the report header.
  --cmd <command>    Verification command. Repeat for multiple commands.
  --skip <note>      Explicit skipped check note. Repeat as needed.
  --json             Emit JSON.
`;

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printAndExit(HELP);
}

const commands = asArray(args.cmd).map(String).map((value) => value.trim()).filter(Boolean);
const skips = asArray(args.skip).map(String).map((value) => value.trim()).filter(Boolean);

if (!commands.length && !skips.length) {
  printAndExit(HELP, 1);
}

const root = path.resolve(String(args.root ?? process.cwd()));
const results = [];

for (const command of commands) {
  results.push(await runCommand(root, command));
}

const passed = results.filter((result) => result.exitCode === 0).length;
const failed = results.filter((result) => result.exitCode !== 0).length;
let conclusion = "not verified";

if (results.length && failed === 0 && skips.length === 0) {
  conclusion = "verified";
} else if (passed > 0 && failed === 0) {
  conclusion = "partially verified";
}

const summary = {
  root,
  ticket: args.ticket ? String(args.ticket) : null,
  conclusion,
  results,
  skips
};

if (args.json) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

const lines = [];

if (summary.ticket) {
  lines.push(`Ticket: ${summary.ticket}`);
}

for (const result of results) {
  lines.push(`- ${result.exitCode === 0 ? "PASS" : "FAIL"} ${result.command} (${result.durationMs}ms)`);
  lines.push(`  Evidence: exit ${result.exitCode}${result.snippet ? ` | ${result.snippet}` : ""}`);
}

for (const skip of skips) {
  lines.push(`- SKIP ${skip}`);
}

lines.push(`Conclusion: ${conclusion}`);
lines.push("Rule: never mark work complete without evidence.");

process.stdout.write(`${lines.join("\n")}\n`);
process.exit(failed === 0 ? 0 : 1);

function runCommand(rootPath, command) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, {
      cwd: rootPath,
      shell: true,
      env: process.env
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (exitCode) => {
      resolve({
        command,
        exitCode: exitCode ?? 1,
        durationMs: Date.now() - startedAt,
        snippet: buildSnippet(stdout, stderr)
      });
    });

    child.on("error", (error) => {
      resolve({
        command,
        exitCode: 1,
        durationMs: Date.now() - startedAt,
        snippet: error.message
      });
    });
  });
}

function buildSnippet(stdout, stderr) {
  const text = `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(" | ");

  return text.slice(0, 280);
}

