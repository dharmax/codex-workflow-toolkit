#!/usr/bin/env node

import path from "node:path";
import { parseArgs, printAndExit } from "./lib/cli.mjs";
import { executeTicket } from "../../../core/services/orchestrator.mjs";
import { assertSafeRepairTarget, resolveOperatingContext } from "../../../core/lib/operating-context.mjs";
import { recordRunArtifact } from "../../../core/lib/run-artifacts.mjs";

const HELP = `Usage:
  node scripts/codex-workflow/execute-ticket.mjs --ticket BUG-123

Options:
  --root <path>       Project root. Defaults to current directory.
  --mode <name>       Operating mode: default or tool-dev.
  --evidence-root <path>
                      Optional evidence project root when mode differs from current directory.
  --allow-external-target
                      Allow tool-dev to operate on a non-toolkit repair target.
  --ticket <id>       Ticket id to plan or execute.
  --apply             Allow the executor to mutate files.
  --timeout-ms <ms>   Verification timeout. Defaults to 600000.
  --json              Emit JSON.
`;

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.ticket) {
  printAndExit(HELP, args.help ? 0 : 1);
}

try {
  const context = await resolveOperatingContext({
    cwd: process.cwd(),
    mode: args.mode ? String(args.mode) : null,
    root: args.root ? String(args.root) : null,
    evidenceRoot: args["evidence-root"] ? String(args["evidence-root"]) : null,
    allowExternalTarget: Boolean(args["allow-external-target"])
  });
  assertSafeRepairTarget(context, { action: args.apply ? "ticket execution" : "ticket planning" });
  const payload = await executeTicket({
    root: context.repairTargetRoot,
    ticketId: String(args.ticket),
    apply: Boolean(args.apply),
    verificationTimeoutMs: args["timeout-ms"]
  });
  payload.mode = context.mode;
  payload.repairTargetRoot = context.repairTargetRoot;
  payload.evidenceRoot = context.evidenceRoot;
  const artifactPayload = { ...payload };
  payload.runArtifact = await recordRunArtifact(context.repairTargetRoot, {
    kind: "execute-ticket",
    mode: context.mode,
    repairTargetRoot: context.repairTargetRoot,
    evidenceRoot: context.evidenceRoot,
    operationalRoot: context.repairTargetRoot,
    ticketId: String(args.ticket),
    ok: payload.success,
    payload: artifactPayload
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exit(payload.success ? 0 : 1);
  }

  const lines = [
    `Mode: ${context.mode}`,
    `Repair target: ${context.repairTargetRoot}`,
    context.evidenceRoot !== context.repairTargetRoot ? `Evidence root: ${context.evidenceRoot}` : null,
    `Ticket: ${args.ticket}`,
    `Status: ${payload.status ?? (payload.success ? "ok" : "failed")}`,
    `Apply: ${args.apply ? "yes" : "no"}`,
    `Ready: ${payload.executionPlan?.ready ? "yes" : "no"}`
  ].filter(Boolean);

  if (payload.executionPlan?.verificationCommands?.length) {
    lines.push(`Verification: ${payload.executionPlan.verificationCommands.map((item) => item.command).join(" | ")}`);
  }
  if (payload.executionPlan?.concerns?.length) {
    lines.push(`Concerns: ${payload.executionPlan.concerns.join(" | ")}`);
  }
  if (payload.verification?.results?.length) {
    lines.push(`Baseline: ${payload.verification.ok ? "green" : "red"}`);
    for (const result of payload.verification.results) {
      lines.push(`- ${result.exitCode === 0 ? "PASS" : "FAIL"} ${result.command} | ${result.snippet}`);
    }
  }
  if (payload.changedFiles?.length) {
    lines.push(`Changed files: ${payload.changedFiles.join(", ")}`);
  }
  if (payload.error) {
    lines.push(`Error: ${payload.error}`);
  }

  process.stdout.write(`${lines.join("\n")}\n`);
  process.exit(payload.success ? 0 : 1);
} catch (error) {
  printAndExit(String(error?.message ?? error), 1);
}
