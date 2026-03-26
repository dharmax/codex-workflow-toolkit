#!/usr/bin/env node

import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { parseArgs, printAndExit } from "./lib/cli.mjs";
import { readText } from "./lib/fs-utils.mjs";
import { deriveKeywords, summarizeGuidance } from "./lib/guidance-utils.mjs";
import { inferTicketWorkingSet, loadTicketContext } from "./lib/workflow-store-utils.mjs";
import { buildTicketExecutionPlan, runVerificationPlan } from "../../../core/services/execution-planner.mjs";
import { resolveOperatingContext } from "../../../core/lib/operating-context.mjs";
import { recordRunArtifact } from "../../../core/lib/run-artifacts.mjs";

const HELP = `Usage:
  node scripts/codex-workflow/ticket-proving-run.mjs --limit 25

Options:
  --root <path>       Project root. Defaults to current directory.
  --mode <name>       Operating mode: default or tool-dev.
  --evidence-root <path>
                      Optional evidence root override. Defaults to --root/current directory.
  --limit <count>     Number of active tickets to evaluate. Defaults to 25.
  --tickets <csv>     Explicit ticket ids to evaluate instead of auto-selection.
  --run-checks <n>    Execute inferred verification commands for the first n ready tickets.
  --timeout-ms <ms>   Per-command timeout when --run-checks is used. Defaults to 600000.
  --json              Emit JSON.
`;

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printAndExit(HELP);
}

const requestedMode = args.mode ? String(args.mode) : null;
const context = await resolveOperatingContext({
  cwd: process.cwd(),
  mode: requestedMode,
  root: requestedMode === "tool-dev" ? null : (args.root ? String(args.root) : null),
  evidenceRoot: args["evidence-root"] ? String(args["evidence-root"]) : (args.root ? String(args.root) : null),
  allowExternalTarget: true
});
const root = context.mode === "tool-dev" ? context.evidenceRoot : context.repairTargetRoot;
const dbPath = path.resolve(root, ".ai-workflow", "state", "workflow.db");

if (!existsSync(dbPath)) {
  printAndExit(`Workflow DB not found: ${dbPath}. Run sync first.`, 1);
}

const explicitTicketIds = String(args.tickets ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const limit = Math.max(1, Number.parseInt(String(args.limit ?? "25"), 10) || 25);
const runChecks = Math.max(0, Number.parseInt(String(args["run-checks"] ?? "0"), 10) || 0);
const timeoutMs = Math.max(5_000, Number.parseInt(String(args["timeout-ms"] ?? "600000"), 10) || 600_000);

const selectedTickets = selectTickets({ dbPath, ticketIds: explicitTicketIds, limit });
if (!selectedTickets.length) {
  printAndExit("No active tickets available for proving run.", 1);
}

const ticketResults = [];
let checksRemaining = runChecks;
for (const ticket of selectedTickets) {
  ticketResults.push(await evaluateTicket(root, ticket, { runChecks: checksRemaining > 0, timeoutMs }));
  if (checksRemaining > 0 && ticketResults.at(-1)?.executionPlan?.ready) {
    checksRemaining -= 1;
  }
}

const summary = summarizeResults(ticketResults, {
  root,
  dbPath,
  limit,
  explicit: explicitTicketIds.length > 0,
  mode: context.mode,
  repairTargetRoot: context.repairTargetRoot,
  evidenceRoot: context.evidenceRoot
});
const artifactPayload = { ...summary };
summary.runArtifact = await recordRunArtifact(context.repairTargetRoot, {
  kind: "ticket-proving-run",
  mode: context.mode,
  repairTargetRoot: context.repairTargetRoot,
  evidenceRoot: context.evidenceRoot,
  operationalRoot: root,
  ok: summary.ok,
  payload: artifactPayload
});

if (args.json) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exit(summary.ok ? 0 : 1);
}

const lines = [
  `Mode: ${summary.mode}`,
  `Repair target: ${summary.repairTargetRoot}`,
  summary.evidenceRoot !== summary.repairTargetRoot ? `Evidence root: ${summary.evidenceRoot}` : null,
  `Ticket proving run: ${summary.passed}/${summary.total} actionable`,
  `Code-context coverage: ${summary.codeContextPassed}/${summary.total}`,
  `Tickets evaluated: ${summary.ticketIds.join(", ")}`
].filter(Boolean);

if (summary.failures.length) {
  lines.push("");
  lines.push("Failures");
  for (const failure of summary.failures) {
    lines.push(`- ${failure.id}: ${failure.reasons.join("; ")}`);
  }
}

process.stdout.write(`${lines.join("\n")}\n`);
process.exit(summary.ok ? 0 : 1);

function selectTickets({ dbPath, ticketIds, limit }) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    if (ticketIds.length) {
      return ticketIds.map((id) => loadTicketRow(db, id)).filter(Boolean);
    }

    return db.prepare(`
      SELECT id, title, lane, state, data_json
      FROM entities
      WHERE entity_type = 'ticket'
        AND state != 'archived'
      ORDER BY
        CASE COALESCE(lane, '')
          WHEN 'In Progress' THEN 0
          WHEN 'Bugs P1' THEN 1
          WHEN 'Bugs P2/P3' THEN 2
          WHEN 'Human Inspection' THEN 3
          WHEN 'Todo' THEN 4
          WHEN 'Suggestions' THEN 5
          WHEN 'Backlog' THEN 6
          WHEN 'Deep Backlog' THEN 7
          ELSE 8
        END,
        id
      LIMIT ?
    `).all(limit).map((row) => materializeTicket(row));
  } finally {
    db.close();
  }
}

function loadTicketRow(db, id) {
  const row = db.prepare(`
    SELECT id, title, lane, state, data_json
    FROM entities
    WHERE id = ?
      AND entity_type = 'ticket'
      AND state != 'archived'
  `).get(id);
  return row ? materializeTicket(row) : null;
}

function materializeTicket(row) {
  return {
    id: row.id,
    title: row.title,
    lane: row.lane,
    state: row.state,
    data: parseJson(row.data_json)
  };
}

async function evaluateTicket(root, ticket, options = {}) {
  const ticketResult = await buildTicketResult(root, ticket.id);
  const guidanceResult = await buildGuidanceResult(root, ticket.id);
  const contextResult = await buildContextResult(root, ticket.id);

  const payload = contextResult.payload ?? {};
  const workingSet = Array.isArray(payload.workingSet) ? payload.workingSet : [];
  const relevantSymbols = Array.isArray(payload.relevantSymbols) ? payload.relevantSymbols : [];
  const executionPlan = await buildTicketExecutionPlan({
    root,
    ticket: ticketResult.payload,
    entity: ticketResult.entity,
    workingSet,
    relevantSymbols
  });
  const hasCodeFile = workingSet.some((filePath) => /^(src|functions|tests)\//.test(String(filePath)));
  const expectedCodeContext = expectsCodeContext(ticket, payload);
  const verificationRun = options.runChecks && executionPlan.ready
    ? await runVerificationPlan(root, executionPlan, { timeoutMs: options.timeoutMs })
    : null;

  const reasons = [];
  if (!ticketResult.ok) reasons.push("ticket extraction failed");
  if (!guidanceResult.ok) reasons.push("guidance extraction failed");
  if (!contextResult.ok) reasons.push("context pack failed");
  if (!workingSet.length) reasons.push("empty working set");
  if (expectedCodeContext && !hasCodeFile) reasons.push("no code/test files in working set");
  if (expectedCodeContext && !hasCodeFile && !relevantSymbols.length) reasons.push("no relevant symbols");
  if (expectedCodeContext && !executionPlan.verificationCommands.length) reasons.push("no verification commands");
  if (verificationRun && !verificationRun.ok) reasons.push("verification baseline red");
  if (payload.ticketSourcePath && /(^|\/)kanban\.md$/.test(String(payload.ticketSourcePath)) && !/^docs\//.test(String(payload.ticketSourcePath)) && ticket.lane !== "Backlog") {
    reasons.push(`runtime resolved root board (${payload.ticketSourcePath})`);
  }

  return {
    id: ticket.id,
    title: ticket.title,
    lane: ticket.lane,
    expectedCodeContext,
    ok: reasons.length === 0,
    reasons,
    ticketSourcePath: payload.ticketSourcePath ?? null,
    workingSet,
    relevantSymbols,
    executionPlan,
    verificationRun,
    guidanceOk: guidanceResult.ok,
    contextOk: contextResult.ok
  };
}

function expectsCodeContext(ticket, payload) {
  const text = `${ticket.id} ${ticket.title} ${ticket.lane ?? ""} ${payload?.ticket?.title ?? ""}`.toLowerCase();
  if (["In Progress", "Bugs P1", "Bugs P2/P3", "Todo", "Human Inspection"].includes(ticket.lane)) return true;
  return /\b(app|ui|route|modal|overlay|dialog|session|state|auth|provider|combat|audio|atlas|admin|test|shell|refactor|bug|fix)\b/.test(text);
}

function summarizeResults(results, meta) {
  const failures = results.filter((item) => !item.ok);
  return {
    ok: failures.length === 0,
    mode: meta.mode,
    repairTargetRoot: meta.repairTargetRoot,
    evidenceRoot: meta.evidenceRoot,
    root: meta.root,
    dbPath: meta.dbPath,
    evaluatedFrom: meta.explicit ? "explicit" : "active-ticket-priority",
    requestedLimit: meta.limit,
    total: results.length,
    passed: results.length - failures.length,
    codeContextPassed: results.filter((item) => !item.expectedCodeContext || item.workingSet.some((filePath) => /^(src|functions|tests)\//.test(String(filePath)))).length,
    verificationPlanned: results.filter((item) => item.executionPlan?.verificationCommands?.length).length,
    verificationExecuted: results.filter((item) => item.verificationRun).length,
    verificationPassed: results.filter((item) => item.verificationRun?.ok).length,
    verificationBaselineRed: results.filter((item) => item.verificationRun && !item.verificationRun.ok).length,
    ticketIds: results.map((item) => item.id),
    failures: failures.map((item) => ({
      id: item.id,
      lane: item.lane,
      reasons: item.reasons,
      ticketSourcePath: item.ticketSourcePath,
      workingSet: item.workingSet.slice(0, 6),
      verificationCommands: item.executionPlan?.verificationCommands?.map((entry) => entry.command) ?? []
    })),
    tickets: results
  };
}

function parseJson(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

async function buildTicketResult(root, ticketId) {
  try {
    const resolved = await loadTicketContext({ root, ticketId });
    return { ok: !!resolved.ticket, payload: resolved.ticket, entity: resolved.entity ?? null };
  } catch (error) {
    return { ok: false, payload: null, entity: null, error: String(error?.message ?? error) };
  }
}

async function buildGuidanceResult(root, ticketId) {
  try {
    const resolved = await loadTicketContext({ root, ticketId });
    if (!resolved.ticket) return { ok: false, payload: null, error: "ticket not found" };
    const files = [
      "AGENTS.md",
      "CONTRIBUTING.md",
      "execution-protocol.md",
      "enforcement.md",
      "project-guidelines.md",
      "knowledge.md"
    ];
    const contents = await Promise.all(files.map((filePath) => readText(path.resolve(root, filePath))));
    const keywords = deriveKeywords({ ticketText: `${resolved.ticket.heading}\n${resolved.ticket.body}`, files: [] });
    const sections = contents.map((content) => summarizeGuidance(content, keywords, { limit: 2, fallbackLimit: 1 }));
    const count = sections.flat().filter(Boolean).length;
    return { ok: count > 0, payload: { sectionCount: count } };
  } catch (error) {
    return { ok: false, payload: null, error: String(error?.message ?? error) };
  }
}

async function buildContextResult(root, ticketId) {
  try {
    const resolved = await loadTicketContext({ root, ticketId });
    if (!resolved.ticket) return { ok: false, payload: null, error: "ticket not found" };
    const inferred = await inferTicketWorkingSet({ root, ticket: resolved.ticket, entity: resolved.entity });
    return {
      ok: true,
      payload: {
        ticket: {
          id: resolved.ticket.id,
          title: resolved.ticket.title,
          section: resolved.ticket.section
        },
        ticketSourcePath: resolved.sourcePath,
        workingSet: inferred.files,
        relevantSymbols: inferred.symbols
      }
    };
  } catch (error) {
    return { ok: false, payload: null, error: String(error?.message ?? error) };
  }
}
