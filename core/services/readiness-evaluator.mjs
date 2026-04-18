import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createEvaluateReadinessResponse, PROTOCOL_VERSION, validateEvaluateReadinessRequest } from "../contracts/dual-surface-protocol.mjs";
import { loadProjectActiveGuardrails, selectActiveGuardrails } from "../../runtime/scripts/ai-workflow/lib/active-guardrails.mjs";

const HIGH_BLOCKER_LANES = new Set(["Bugs P1", "Human Inspection"]);
const MEDIUM_BLOCKER_LANES = new Set(["Bugs P2/P3", "In Progress"]);
const ACTIVE_LANES = new Set(["Todo", "In Progress", "Bugs P1", "Bugs P2/P3", "Human Inspection", "Risk Watch"]);
const FRESHNESS = {
  verificationResultFreshMs: 3 * 24 * 60 * 60 * 1000,
  verificationSourceFreshMs: 14 * 24 * 60 * 60 * 1000,
  syncFreshMs: 24 * 60 * 60 * 1000,
  continuationMaxAgeMs: 24 * 60 * 60 * 1000
};

export async function evaluateReadiness(store, request) {
  const startedAt = Date.now();
  const lastSync = store.getMeta("lastSync");
  let normalized;
  try {
    normalized = validateEvaluateReadinessRequest(request);
  } catch (error) {
    return buildTerminalResponse({
      status: "error",
      summary: "Readiness evaluation failed due to a protocol contract mismatch.",
      verdict: "unknown",
      confidence: 0,
      blockers: [],
      evidence: [],
      assumptions: [],
      gaps: [String(error?.message ?? error)],
      recommendedNextActions: ["Retry with protocol_version 1.x and a valid evaluate_readiness request envelope."],
      guidelineFindings: [],
      continuationState: null,
      meta: {
        protocol_version: PROTOCOL_VERSION,
        elapsed_ms: Date.now() - startedAt,
        freshness: {
          last_sync_at: lastSync?.startedAt ?? null
        },
        error_kind: "contract_mismatch"
      }
    });
  }

  const traceId = createTraceId(normalized);
  const continuationCheck = validateContinuationState(normalized.continuation_state, { lastSync, now: startedAt });
  if (continuationCheck) {
    return buildTerminalResponse({
      status: "blocked",
      summary: "Readiness evaluation continuation state is no longer valid.",
      verdict: "unknown",
      confidence: 0.22,
      blockers: [],
      evidence: continuationCheck.evidence,
      assumptions: [],
      gaps: [continuationCheck.reason],
      recommendedNextActions: ["Rerun evaluate_readiness without the stale continuation state.", "Refresh project evidence with ai-workflow sync if the workspace changed."],
      guidelineFindings: [],
      continuationState: null,
      traceId,
      meta: {
        protocol_version: PROTOCOL_VERSION,
        elapsed_ms: Date.now() - startedAt,
        freshness: {
          last_sync_at: lastSync?.startedAt ?? null
        },
        blocked_reason: continuationCheck.code
      }
    });
  }

  const tickets = store.listEntities({ entityType: "ticket" }).filter(isActiveTicket);
  const notes = store.listNotes({ noteTypes: ["BUG", "RISK", "FIXME", "TODO"] });
  const files = store.db.prepare("SELECT path, indexed_at, mtime_ms FROM files ORDER BY path").all();

  const verificationArtifacts = files.filter((row) => isVerificationArtifact(row.path));
  const checklistArtifacts = files.filter((row) => isChecklistArtifact(row.path));
  const latestVerificationArtifact = getFreshestArtifact(verificationArtifacts);
  const latestRunArtifact = readLatestVerificationRunArtifact(store.projectRoot);
  const syncFreshness = describeFreshness(lastSync?.startedAt ?? null, startedAt, FRESHNESS.syncFreshMs);
  const verificationArtifactFreshness = latestVerificationArtifact
    ? describeFreshness(latestVerificationArtifact.indexed_at ?? latestVerificationArtifact.mtime_ms, startedAt, FRESHNESS.verificationSourceFreshMs)
    : { status: "missing", observed_at: null };
  const verificationSignal = resolveVerificationSignal({
    latestRunArtifact,
    latestVerificationArtifact,
    now: startedAt
  });
  const blockerTickets = tickets
    .filter((ticket) => isBlockerLane(ticket.lane))
    .map((ticket) => ({
      id: `ticket_${ticket.id.toLowerCase()}`,
      title: `${ticket.id} ${ticket.title}`,
      severity: HIGH_BLOCKER_LANES.has(ticket.lane) ? "high" : "medium",
      reason: `${ticket.id} is still active in ${ticket.lane}.`
    }));
  const highSignalNotes = notes.slice(0, 3).map((note) => ({
    id: `note_${note.id.slice(0, 12)}`,
    title: `${note.noteType} in ${note.filePath ?? "project"}`,
    severity: note.noteType === "BUG" || note.noteType === "RISK" ? "medium" : "low",
    reason: note.body
  }));

  const evidence = [];
  if (lastSync?.startedAt) {
    evidence.push({
      kind: "sync",
      ref: "workspace_meta:lastSync",
      claim: `Indexed project state was refreshed at ${lastSync.startedAt}.`,
      source: "workflow_db",
      freshness: syncFreshness
    });
  }
  for (const ticket of blockerTickets.slice(0, 3)) {
    evidence.push({
      kind: "ticket",
      ref: ticket.title.split(" ")[0],
      claim: ticket.reason,
      source: "workflow_db"
    });
  }
  if (verificationSignal.evidence) {
    evidence.push(verificationSignal.evidence);
  }
  for (const artifact of verificationArtifacts.slice(0, verificationSignal.evidence ? 2 : 3)) {
    evidence.push({
      kind: "verification",
      ref: artifact.path,
      claim: "Verification-related source artifact exists, but file presence alone is weaker than a passing run result.",
      source: "filesystem",
      freshness: describeFreshness(artifact.indexed_at ?? artifact.mtime_ms, startedAt, FRESHNESS.verificationSourceFreshMs)
    });
  }
  for (const artifact of checklistArtifacts.slice(0, 2)) {
    evidence.push({
      kind: "checklist",
      ref: artifact.path,
      claim: "Readiness criteria artifact exists in the repository.",
      source: "filesystem",
      freshness: describeFreshness(artifact.indexed_at ?? artifact.mtime_ms, startedAt, FRESHNESS.verificationSourceFreshMs)
    });
  }
  for (const note of highSignalNotes.slice(0, 2)) {
    evidence.push({
      kind: "risk_note",
      ref: note.title,
      claim: `Observed advisory note: ${note.reason}`,
      source: "workflow_db"
    });
  }

  const gaps = [];
  if (!verificationArtifacts.length) {
    gaps.push("No verification artifact proving recent critical-flow checks was found.");
  }
  if (!checklistArtifacts.length) {
    gaps.push("No beta/release checklist or explicit exit criteria artifact was found.");
  }
  if (!lastSync?.startedAt) {
    gaps.push("Workflow DB freshness metadata is missing.");
  } else if (syncFreshness.status !== "fresh") {
    gaps.push("Workflow DB evidence is stale; rerun sync before trusting a strong readiness verdict.");
  }
  if (verificationArtifacts.length && verificationArtifactFreshness.status === "stale" && !verificationSignal.hasFreshSignal) {
    gaps.push("Verification source artifacts are stale and no recent passing verification result was found.");
  }

  const assumptions = [
    "Readiness requires explicit verification evidence, not just ticket movement.",
    "Open high-priority blockers count against readiness unless they are explicitly waived."
  ];

  const recommendedNextActions = [];
  if (!verificationArtifacts.length) {
    recommendedNextActions.push("Add or surface a verification artifact for the critical user flows.");
  } else if (verificationArtifactFreshness.status === "stale" && !verificationSignal.hasFreshSignal) {
    recommendedNextActions.push("Run a current verification pass and record the result so readiness is backed by recent proof.");
  }
  if (!checklistArtifacts.length) {
    recommendedNextActions.push("Add an explicit beta or release checklist to the repo.");
  }
  if (blockerTickets.length) {
    recommendedNextActions.push("Resolve or explicitly waive the remaining active blockers before issuing a ready verdict.");
  }
  if (syncFreshness.status !== "fresh") {
    recommendedNextActions.push("Refresh the workflow DB with ai-workflow sync before relying on this verdict.");
  }
  if (!recommendedNextActions.length) {
    recommendedNextActions.push("Keep the readiness checklist and verification artifacts current as the project changes.");
  }

  let confidence = 0.55;
  if (checklistArtifacts.length) confidence += 0.12;
  else confidence -= 0.15;
  if (verificationArtifacts.length) confidence += 0.06;
  else confidence -= 0.2;
  if (verificationSignal.hasFreshSignal) confidence += 0.16;
  else if (verificationArtifactFreshness.status === "stale") confidence -= 0.08;
  if (lastSync?.startedAt) confidence += 0.05;
  else confidence -= 0.05;
  if (syncFreshness.status !== "fresh") confidence -= 0.08;
  if (blockerTickets.length) confidence -= Math.min(0.24, blockerTickets.length * 0.08);
  if (highSignalNotes.length) confidence -= Math.min(0.12, highSignalNotes.length * 0.04);
  if (!verificationArtifacts.length || (verificationArtifactFreshness.status === "stale" && !verificationSignal.hasFreshSignal)) {
    confidence = Math.min(confidence, 0.49);
  }
  confidence = clamp(confidence, 0.15, 0.92);

  const hasCriticalBlockers = blockerTickets.some((item) => item.severity === "high");
  const evidenceIsSufficient = verificationArtifacts.length > 0 && checklistArtifacts.length > 0 && syncFreshness.status === "fresh";
  const status = evidenceIsSufficient ? "complete" : "insufficient_evidence";
  const verdict = hasCriticalBlockers || gaps.length ? "not_ready" : "ready";
  const summary = verdict === "ready"
    ? `Ready for ${formatGoal(normalized.goal.type)}.`
    : `Not ready for ${formatGoal(normalized.goal.type)}${gaps.length ? " yet" : ""}.`;
  const activeGuardrails = normalized.constraints.active_guardrails.length
    ? normalized.constraints.active_guardrails
    : await loadProjectActiveGuardrails(store.projectRoot, { limit: 10 }).catch(() => []);
  const relevantGuardrails = selectActiveGuardrails(activeGuardrails, normalized.goal.question, { limit: 4, fallbackLimit: 2 });
  const guidelineFindings = buildGuidelineFindings({
    guardrails: relevantGuardrails,
    request: normalized,
    verificationSignal,
    syncFreshness
  });

  const elapsedMs = Date.now() - startedAt;
  return buildTerminalResponse({
    status,
    summary,
    verdict,
    confidence: Number(confidence.toFixed(2)),
    blockers: blockerTickets.slice(0, 6),
    evidence,
    assumptions,
    gaps,
    recommendedNextActions,
    guidelineFindings,
    continuationState: {
      token: `eval-readiness:${traceId}`,
      originating_operation: "evaluate_readiness",
      next_allowed_operations: ["discover_work_context", "investigate_artifact_map"],
      created_at: new Date().toISOString()
    },
    traceId,
    meta: {
      protocol_version: PROTOCOL_VERSION,
      elapsed_ms: elapsedMs,
      freshness: {
        last_sync_at: lastSync?.startedAt ?? null,
        sync_status: syncFreshness.status,
        verification_status: verificationSignal.hasFreshSignal
          ? verificationSignal.freshness?.status ?? "fresh"
          : verificationArtifactFreshness.status
      },
      evidence_sources: Array.from(new Set(evidence.map((item) => item.source))),
      verification_signal: verificationSignal.meta
    }
  });
}

function isActiveTicket(ticket) {
  return ticket.state !== "archived" && ACTIVE_LANES.has(ticket.lane);
}

function isBlockerLane(lane) {
  return HIGH_BLOCKER_LANES.has(lane) || MEDIUM_BLOCKER_LANES.has(lane);
}

function isVerificationArtifact(filePath) {
  const normalized = String(filePath ?? "").toLowerCase();
  return normalized.includes(".test.")
    || normalized.includes(".spec.")
    || normalized.startsWith("tests/")
    || normalized.includes("/tests/")
    || normalized.includes("/e2e/")
    || /verify|verification|smoke/.test(normalized);
}

function isChecklistArtifact(filePath) {
  const normalized = String(filePath ?? "").toLowerCase();
  return /checklist|exit-criteria|release|beta|handoff/.test(normalized);
}

function formatGoal(goalType) {
  const normalized = String(goalType ?? "readiness").trim().toLowerCase();
  if (normalized === "beta_readiness") return "beta testing";
  if (normalized === "release_readiness") return "release";
  if (normalized === "handoff_readiness") return "handoff";
  return normalized.replace(/_/g, " ");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function createTraceId(request) {
  return createHash("sha1")
    .update(JSON.stringify({
      operation: request.operation,
      goal: request.goal,
      continuation_state: request.continuation_state ?? null
    }))
    .digest("hex")
    .slice(0, 12);
}

function buildTerminalResponse({
  status,
  summary,
  verdict,
  confidence,
  blockers,
  evidence,
  assumptions,
  gaps,
  recommendedNextActions,
  guidelineFindings,
  continuationState,
  traceId = null,
  meta = {}
}) {
  return createEvaluateReadinessResponse({
    status,
    summary,
    opinion: {
      verdict,
      confidence
    },
    blockers,
    evidence,
    assumptions,
    gaps,
    recommended_next_actions: recommendedNextActions,
    guideline_findings: guidelineFindings,
    continuation_state: continuationState,
    meta: {
      trace_id: traceId,
      ...meta
    }
  });
}

function buildGuidelineFindings({ guardrails, request, verificationSignal, syncFreshness }) {
  return guardrails.map((guardrail) => {
    if (guardrail.tags?.includes("mutation") && request.constraints.allow_mutation === false) {
      return `[ok][${guardrail.severity}] ${guardrail.summary} This readiness evaluation stayed non-mutating.`;
    }
    if (guardrail.tags?.includes("testing") && /dogfood|workflow-audit/i.test(guardrail.summary) && !verificationSignal.hasFreshSignal) {
      return `[warning][${guardrail.severity}] ${guardrail.summary} Fresh verification evidence is still missing.`;
    }
    if (guardrail.tags?.includes("workflow") && syncFreshness.status !== "fresh") {
      return `[warning][${guardrail.severity}] ${guardrail.summary} Workflow state is stale until the next sync.`;
    }
    return `[active][${guardrail.severity}] ${guardrail.summary}`;
  });
}

function getFreshestArtifact(artifacts = []) {
  return artifacts
    .slice()
    .sort((left, right) => getArtifactTimestamp(right) - getArtifactTimestamp(left))[0] ?? null;
}

function getArtifactTimestamp(artifact) {
  const indexedAt = Date.parse(String(artifact?.indexed_at ?? ""));
  if (Number.isFinite(indexedAt)) return indexedAt;
  const mtime = Number(artifact?.mtime_ms);
  return Number.isFinite(mtime) ? mtime : 0;
}

function describeFreshness(value, now, thresholdMs) {
  const timestamp = typeof value === "number" ? value : Date.parse(String(value ?? ""));
  if (!Number.isFinite(timestamp)) {
    return {
      status: "unknown",
      observed_at: null
    };
  }
  const ageMs = Math.max(0, now - timestamp);
  return {
    status: ageMs <= thresholdMs ? "fresh" : "stale",
    observed_at: new Date(timestamp).toISOString(),
    age_ms: ageMs
  };
}

function resolveVerificationSignal({ latestRunArtifact, latestVerificationArtifact, now }) {
  if (latestRunArtifact) {
    const freshness = describeFreshness(latestRunArtifact.recordedAt ?? null, now, FRESHNESS.verificationResultFreshMs);
    const passed = latestRunArtifact.ok === true || latestRunArtifact.payload?.verificationRun?.ok === true;
    return {
      hasFreshSignal: passed && freshness.status === "fresh",
      freshness,
      evidence: {
        kind: "verification",
        ref: `.ai-workflow/state/run-artifacts/${latestRunArtifact.id}.json`,
        claim: passed
          ? `Recent verification run artifact ${latestRunArtifact.kind ?? "run"} recorded a passing result.`
          : `Recent verification run artifact ${latestRunArtifact.kind ?? "run"} did not record a clean pass.`,
        source: "test_results",
        freshness
      },
      meta: {
        kind: latestRunArtifact.kind ?? null,
        recorded_at: latestRunArtifact.recordedAt ?? null,
        ok: latestRunArtifact.ok === true
      }
    };
  }

  const freshness = latestVerificationArtifact
    ? describeFreshness(latestVerificationArtifact.indexed_at ?? latestVerificationArtifact.mtime_ms, now, FRESHNESS.verificationSourceFreshMs)
    : { status: "missing", observed_at: null };

  return {
    hasFreshSignal: false,
    freshness,
    evidence: null,
    meta: {
      kind: null,
      recorded_at: null,
      ok: null
    }
  };
}

function readLatestVerificationRunArtifact(projectRoot) {
  if (!projectRoot) return null;
  const stateDir = path.resolve(projectRoot, ".ai-workflow", "state", "run-artifacts");
  const latestPath = path.resolve(stateDir, "latest.json");
  if (!existsSync(latestPath)) return null;
  try {
    const latest = JSON.parse(readFileSync(latestPath, "utf8"));
    if (!latest?.id) return null;
    const artifactPath = path.resolve(stateDir, `${latest.id}.json`);
    if (!existsSync(artifactPath)) return null;
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
    if (!artifact || typeof artifact !== "object") return null;
    const kind = String(artifact.kind ?? "");
    if (!/verification|proving|dry-run/.test(kind)) return null;
    return artifact;
  } catch {
    return null;
  }
}

function validateContinuationState(continuationState, { lastSync, now }) {
  if (!continuationState) return null;
  const createdAt = Date.parse(String(continuationState.created_at ?? ""));
  if (!Number.isFinite(createdAt)) {
    return {
      code: "invalid_continuation_state",
      reason: "Continuation state is malformed and cannot be reused.",
      evidence: []
    };
  }
  if (now - createdAt > FRESHNESS.continuationMaxAgeMs) {
    return {
      code: "expired_continuation_state",
      reason: "Continuation state expired because it is older than the allowed freshness window.",
      evidence: [{
        kind: "continuation_state",
        ref: String(continuationState.token ?? "unknown"),
        claim: "Continuation state exceeded the allowed freshness window.",
        source: "manual_input",
        freshness: describeFreshness(createdAt, now, FRESHNESS.continuationMaxAgeMs)
      }]
    };
  }
  const lastSyncAt = Date.parse(String(lastSync?.startedAt ?? ""));
  if (Number.isFinite(lastSyncAt) && lastSyncAt > createdAt) {
    return {
      code: "stale_continuation_state",
      reason: "Continuation state was created before the latest sync and may no longer match project state.",
      evidence: [{
        kind: "continuation_state",
        ref: String(continuationState.token ?? "unknown"),
        claim: "Continuation state predates the latest indexed project state.",
        source: "workflow_db",
        freshness: describeFreshness(createdAt, now, FRESHNESS.continuationMaxAgeMs)
      }]
    };
  }
  return null;
}
