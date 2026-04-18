export const PROTOCOL_VERSION = "1.0";

export const READINESS_OPERATION = "evaluate_readiness";

export const READINESS_STATUSES = new Set([
  "complete",
  "insufficient_evidence",
  "blocked",
  "error"
]);

export const READINESS_VERDICTS = new Set([
  "ready",
  "not_ready",
  "unknown"
]);

export const EVIDENCE_SOURCES = new Set([
  "workflow_db",
  "filesystem",
  "test_results",
  "metrics",
  "manual_input"
]);

export function validateEvaluateReadinessRequest(request) {
  const payload = request && typeof request === "object" ? request : {};
  const major = getMajorVersion(payload.protocol_version);
  if (major !== "1") {
    throw new Error(`Unsupported protocol version: ${payload.protocol_version ?? "missing"}`);
  }
  if (payload.operation !== READINESS_OPERATION) {
    throw new Error(`Unsupported operation: ${payload.operation ?? "missing"}`);
  }
  if (!payload.goal || typeof payload.goal !== "object") {
    throw new Error("evaluate_readiness request requires goal");
  }
  if (!String(payload.goal.type ?? "").trim()) {
    throw new Error("evaluate_readiness request requires goal.type");
  }
  if (!String(payload.goal.question ?? "").trim()) {
    throw new Error("evaluate_readiness request requires goal.question");
  }
  return {
    protocol_version: PROTOCOL_VERSION,
    operation: READINESS_OPERATION,
    goal: {
      type: String(payload.goal.type).trim(),
      target: String(payload.goal.target ?? "project").trim(),
      question: String(payload.goal.question).trim()
    },
    constraints: {
      allow_mutation: false,
      context_budget: String(payload.constraints?.context_budget ?? "medium"),
      time_budget_ms: Number.isFinite(Number(payload.constraints?.time_budget_ms))
        ? Math.max(0, Number(payload.constraints.time_budget_ms))
        : 15000,
      guideline_mode: String(payload.constraints?.guideline_mode ?? "advisory"),
      active_guardrails: normalizeActiveGuardrails(payload.constraints?.active_guardrails)
    },
    inputs: {
      tickets_scope: String(payload.inputs?.tickets_scope ?? "active_and_blocked"),
      artifact_scope: String(payload.inputs?.artifact_scope ?? "goal_relevant_only"),
      verification_scope: String(payload.inputs?.verification_scope ?? "tests_metrics_docs")
    },
    host: {
      surface: String(payload.host?.surface ?? "cli"),
      capabilities: {
        supports_json: payload.host?.capabilities?.supports_json !== false,
        supports_streaming: Boolean(payload.host?.capabilities?.supports_streaming),
        supports_followups: payload.host?.capabilities?.supports_followups !== false
      }
    },
    continuation_state: payload.continuation_state ?? null
  };
}

export function createEvaluateReadinessResponse(response) {
  const payload = {
    protocol_version: PROTOCOL_VERSION,
    operation: READINESS_OPERATION,
    ...response
  };
  validateEvaluateReadinessResponse(payload);
  return payload;
}

export function validateEvaluateReadinessResponse(response) {
  const payload = response && typeof response === "object" ? response : {};
  const major = getMajorVersion(payload.protocol_version);
  if (major !== "1") {
    throw new Error(`Unsupported protocol version: ${payload.protocol_version ?? "missing"}`);
  }
  if (payload.operation !== READINESS_OPERATION) {
    throw new Error(`Unsupported operation: ${payload.operation ?? "missing"}`);
  }
  if (!READINESS_STATUSES.has(payload.status)) {
    throw new Error(`Invalid readiness status: ${payload.status ?? "missing"}`);
  }
  if (!payload.opinion || typeof payload.opinion !== "object") {
    throw new Error("evaluate_readiness response requires opinion");
  }
  if (!String(payload.summary ?? "").trim()) {
    throw new Error("evaluate_readiness response requires summary");
  }
  if (!READINESS_VERDICTS.has(payload.opinion.verdict)) {
    throw new Error(`Invalid readiness verdict: ${payload.opinion.verdict ?? "missing"}`);
  }
  const confidence = Number(payload.opinion.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error("evaluate_readiness response confidence must be between 0 and 1");
  }
  validateEvidenceItems(payload.evidence);
  if (!Array.isArray(payload.blockers) || !Array.isArray(payload.gaps) || !Array.isArray(payload.recommended_next_actions)) {
    throw new Error("evaluate_readiness response requires blockers, gaps, and recommended_next_actions arrays");
  }
  if (!Array.isArray(payload.assumptions) || !Array.isArray(payload.guideline_findings)) {
    throw new Error("evaluate_readiness response requires assumptions and guideline_findings arrays");
  }
  if (payload.continuation_state !== null && typeof payload.continuation_state !== "object") {
    throw new Error("evaluate_readiness response continuation_state must be an object or null");
  }
  return payload;
}

function validateEvidenceItems(evidence) {
  if (!Array.isArray(evidence)) {
    throw new Error("evaluate_readiness response requires evidence array");
  }
  for (const item of evidence) {
    if (!item || typeof item !== "object") {
      throw new Error("evidence items must be objects");
    }
    if (!String(item.kind ?? "").trim() || !String(item.ref ?? "").trim() || !String(item.claim ?? "").trim()) {
      throw new Error("evidence items require kind, ref, and claim");
    }
    if (!EVIDENCE_SOURCES.has(item.source)) {
      throw new Error(`Invalid evidence source: ${item.source ?? "missing"}`);
    }
    if (item.freshness !== undefined) {
      if (!item.freshness || typeof item.freshness !== "object") {
        throw new Error("evidence freshness must be an object when provided");
      }
      if (item.freshness.age_ms !== undefined && (!Number.isFinite(Number(item.freshness.age_ms)) || Number(item.freshness.age_ms) < 0)) {
        throw new Error("evidence freshness age_ms must be a non-negative number when provided");
      }
    }
  }
}

function getMajorVersion(value) {
  return String(value ?? "").trim().split(".")[0];
}

function normalizeActiveGuardrails(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item, index) => normalizeActiveGuardrail(item, index))
    .filter(Boolean);
}

function normalizeActiveGuardrail(item, index) {
  if (typeof item === "string") {
    const summary = item.trim();
    if (!summary) {
      return null;
    }
    return {
      id: `guardrail_${index + 1}`,
      summary,
      severity: "advisory",
      source: "host"
    };
  }

  if (!item || typeof item !== "object") {
    return null;
  }

  const summary = String(item.summary ?? item.text ?? "").trim();
  if (!summary) {
    return null;
  }

  return {
    id: String(item.id ?? `guardrail_${index + 1}`),
    summary,
    severity: String(item.severity ?? "advisory"),
    source: String(item.sourceLabel ?? item.source ?? "host")
  };
}
