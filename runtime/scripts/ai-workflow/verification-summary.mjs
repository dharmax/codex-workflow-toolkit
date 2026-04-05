#!/usr/bin/env node

import path from "node:path";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs, asArray, printAndExit } from "./lib/cli.mjs";
import { judgeArtifacts } from "../../../core/services/artifact-verification.mjs";

const HELP = `Usage:
  node scripts/ai-workflow/verification-summary.mjs --cmd "pnpm test" --cmd "pnpm build"
  node scripts/ai-workflow/verification-summary.mjs --artifact ./screenshot.png --rubric "Matches the reference layout"

Options:
  --root <path>      Project root. Defaults to current directory.
  --ticket <id>      Optional ticket id for the report header.
  --cmd <command>    Verification command. Repeat for multiple commands.
  --skip <note>      Explicit skipped check note. Repeat as needed.
  --artifact <path>  Artifact to judge. Repeat for multiple files.
  --rubric <text>    Required rubric text for artifact judgments.
  --rubric-file <path>  Read rubric text from a file.
  --goal <text>      Optional goal or target statement for the artifact judge.
  --provider <id>    Force the artifact judge provider.
  --model <id>       Force the artifact judge model.
  --json             Emit JSON.
`;

export async function runVerificationSummary(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

  if (args.help) {
    return outputAndExit(HELP);
  }

  const root = path.resolve(String(args.root ?? process.cwd()));
  const commands = asArray(args.cmd).map(String).map((value) => value.trim()).filter(Boolean);
  const skips = asArray(args.skip).map(String).map((value) => value.trim()).filter(Boolean);
  const artifactPaths = asArray(args.artifact).map(String).map((value) => value.trim()).filter(Boolean);
  const rubricText = await resolveRubricText({
    root,
    rubric: args.rubric,
    rubricFile: args["rubric-file"]
  });
  const goal = args.goal ? String(args.goal).trim() : null;
  const providerId = args.provider ? String(args.provider).trim() : null;
  const modelId = args.model ? String(args.model).trim() : null;

  if (!commands.length && !skips.length && !artifactPaths.length) {
    printAndExit(HELP, 1);
  }
  if (artifactPaths.length && !rubricText) {
    printAndExit("A rubric is required when judging artifacts. Use --rubric or --rubric-file.", 1);
  }

  const results = [];
  for (const command of commands) {
    results.push(await runCommand(root, command));
  }

  let artifactJudgment = null;
  if (artifactPaths.length) {
    const startedAt = Date.now();
    artifactJudgment = await judgeArtifacts({
      projectRoot: root,
      artifactPaths,
      rubric: rubricText,
      goal,
      providerId,
      modelId
    });
    artifactJudgment.durationMs = Date.now() - startedAt;
  }

  const passed = results.filter((result) => result.exitCode === 0).length;
  const failed = results.filter((result) => result.exitCode !== 0).length;
  const artifactFailed = artifactJudgment && artifactJudgment.result?.status !== "pass";
  const hasEvidence = results.length > 0 || Boolean(artifactJudgment);
  let conclusion = "not verified";

  if (hasEvidence && failed === 0 && skips.length === 0 && !artifactFailed) {
    conclusion = "verified";
  } else if (hasEvidence && failed === 0 && !artifactFailed) {
    conclusion = "partially verified";
  }

  const summary = {
    root,
    ticket: args.ticket ? String(args.ticket) : null,
    conclusion,
    results,
    artifactJudgment,
    skips
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return summary;
  }

  const lines = [];

  if (summary.ticket) {
    lines.push(`Ticket: ${summary.ticket}`);
  }

  for (const result of results) {
    lines.push(`- ${result.exitCode === 0 ? "PASS" : "FAIL"} ${result.command} (${result.durationMs}ms)`);
    lines.push(`  Evidence: exit ${result.exitCode}${result.snippet ? ` | ${result.snippet}` : ""}`);
  }

  if (artifactJudgment) {
    lines.push("Artifact judgment:");
    lines.push(`- ${artifactJudgment.result?.status === "pass" ? "PASS" : "FAIL"} artifact-judge (${artifactJudgment.durationMs}ms)`);
    lines.push(`  Evidence: ${formatArtifactEvidence(artifactJudgment.result)}`);
  }

  for (const skip of skips) {
    lines.push(`- SKIP ${skip}`);
  }

  lines.push(`Conclusion: ${conclusion}`);
  lines.push("Rule: never mark work complete without evidence.");

  process.stdout.write(`${lines.join("\n")}\n`);
  return summary;
}

if (process.env.AIWF_WRAPPED_RUNTIME === "1" || import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const summary = await runVerificationSummary();
  const commandFailed = Array.isArray(summary?.results) && summary.results.some((result) => result.exitCode !== 0);
  const artifactFailed = summary?.artifactJudgment && summary.artifactJudgment.result?.status !== "pass";
  process.exitCode = commandFailed || artifactFailed ? 1 : 0;
}

async function resolveRubricText({ root, rubric, rubricFile }) {
  const inline = String(rubric ?? "").trim();
  if (inline) {
    return inline;
  }

  const file = String(rubricFile ?? "").trim();
  if (!file) {
    return "";
  }

  const resolved = path.resolve(root, file);
  return String(await readFile(resolved, "utf8")).trim();
}

function formatArtifactEvidence(result = {}) {
  const parts = [
    `status ${result.status ?? "unknown"}`,
    typeof result.score === "number" ? `score ${result.score}` : null,
    typeof result.confidence === "number" ? `confidence ${result.confidence}` : null,
    result.summary ? `summary ${result.summary}` : null
  ].filter(Boolean);

  return parts.join(" | ");
}

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

function outputAndExit(text, code = 0) {
  process.stdout.write(`${text}\n`);
  process.exit(code);
}
