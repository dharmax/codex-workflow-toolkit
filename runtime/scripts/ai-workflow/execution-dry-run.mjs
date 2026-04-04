#!/usr/bin/env node

import path from "node:path";
import { parseArgs, printAndExit, splitCsv } from "./lib/cli.mjs";
import { inferTicketWorkingSet, loadTicketContext } from "./lib/workflow-store-utils.mjs";
import { buildTicketExecutionPlan, runVerificationPlan } from "../../../core/services/execution-planner.mjs";
import { assertSafeRepairTarget, resolveOperatingContext } from "../../../core/lib/operating-context.mjs";
import { recordRunArtifact } from "../../../core/lib/run-artifacts.mjs";

const HELP = `Usage:
  node scripts/ai-workflow/execution-dry-run.mjs --ticket TKT-001

Options:
  --root <path>       Project root. Defaults to current directory.
  --mode <name>       Operating mode: default or tool-dev.
  --evidence-root <path>
                      Optional evidence project root when mode differs from current directory.
  --allow-external-target
                      Allow tool-dev to operate on a non-toolkit repair target.
  --ticket <id>       Ticket id from workflow DB or discovered kanban source.
  --files <list>      Optional explicit file list.
  --run-checks        Execute inferred verification commands without mutating files.
  --timeout-ms <ms>   Per-command timeout when --run-checks is set.
  --json              Emit JSON.
`;

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printAndExit(HELP);
}

try {
  const context = await resolveOperatingContext({
    cwd: process.cwd(),
    mode: args.mode ? String(args.mode) : null,
    root: args.root ? String(args.root) : null,
    evidenceRoot: args["evidence-root"] ? String(args["evidence-root"]) : null,
    allowExternalTarget: Boolean(args["allow-external-target"])
  });
  assertSafeRepairTarget(context, { action: "execution dry-run" });
  const root = context.repairTargetRoot;
  const explicitFiles = splitCsv(args.files);
  if (!args.ticket) {
    printAndExit(HELP, 1);
  }

  const resolved = await loadTicketContext({ root, ticketId: String(args.ticket) });
  if (!resolved.ticket) {
    printAndExit(`Ticket ${args.ticket} not found`, 1);
  }

  const inferredWorkingSet = explicitFiles.length
    ? { files: explicitFiles, symbols: [], evidence: [{ query: "explicit-files", hits: explicitFiles.map((filePath) => ({ scope: "file", title: filePath, refId: filePath })) }] }
    : await inferTicketWorkingSet({ root, ticket: resolved.ticket, entity: resolved.entity });

  const executionPlan = await buildTicketExecutionPlan({
    root,
    ticket: resolved.ticket,
    entity: resolved.entity,
    workingSet: inferredWorkingSet.files,
    relevantSymbols: inferredWorkingSet.symbols
  });

  const verificationRun = args["run-checks"]
    ? await runVerificationPlan(root, executionPlan, { timeoutMs: args["timeout-ms"] })
    : null;

  const payload = {
    mode: context.mode,
    root,
    repairTargetRoot: context.repairTargetRoot,
    evidenceRoot: context.evidenceRoot,
    ticket: {
      id: resolved.ticket.id,
      title: resolved.ticket.title,
      section: resolved.ticket.section
    },
    ticketSourcePath: resolved.sourcePath,
    executionPlan,
    workingSetEvidence: inferredWorkingSet.evidence,
    verificationRun
  };
  const artifactPayload = { ...payload };
  payload.runArtifact = await recordRunArtifact(context.repairTargetRoot, {
    kind: "execution-dry-run",
    mode: context.mode,
    repairTargetRoot: context.repairTargetRoot,
    evidenceRoot: context.evidenceRoot,
    operationalRoot: root,
    ticketId: payload.ticket.id,
    ok: executionPlan.ready && (!verificationRun || verificationRun.ok),
    payload: artifactPayload
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exit(verificationRun && !verificationRun.ok ? 1 : 0);
  }

  const lines = [
    `Mode: ${context.mode}`,
    `Repair target: ${context.repairTargetRoot}`,
    context.evidenceRoot !== context.repairTargetRoot ? `Evidence root: ${context.evidenceRoot}` : null,
    `Ticket: ${payload.ticket.id} | ${payload.ticket.section} | ${payload.ticket.title}`,
    `Ready: ${executionPlan.ready ? "yes" : "no"}`,
    `Files: ${executionPlan.workingSet.join(", ") || "none"}`,
    `Verification: ${executionPlan.verificationCommands.map((item) => item.command).join(" | ") || "none"}`
  ].filter(Boolean);

  if (executionPlan.concerns.length) {
    lines.push(`Concerns: ${executionPlan.concerns.join(" | ")}`);
  }

  if (verificationRun) {
    lines.push(`Checks: ${verificationRun.ok ? "pass" : "fail"}`);
    for (const result of verificationRun.results) {
      lines.push(`- ${result.exitCode === 0 ? "PASS" : "FAIL"} ${result.command} | ${result.snippet}`);
    }
  }

  process.stdout.write(`${lines.join("\n")}\n`);
  process.exit(verificationRun && !verificationRun.ok ? 1 : 0);
} catch (error) {
  printAndExit(String(error?.message ?? error), 1);
}
