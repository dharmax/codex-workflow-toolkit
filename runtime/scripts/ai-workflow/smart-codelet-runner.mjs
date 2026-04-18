#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, printAndExit } from "./lib/cli.mjs";
import { addManualNote, withWorkflowStore } from "../../../core/services/sync.mjs";
import { routeTask } from "../../../core/services/router.mjs";
import { generateCompletion } from "../../../core/services/providers.mjs";
import { listToolkitCodelets } from "../../../core/services/codelets.mjs";
import { buildSmartCodeletRunContext } from "../../../core/services/codelet-runtime.mjs";

export async function runSmartCodelet(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  const root = path.resolve(String(args.root ?? process.cwd()));
  const codeletId = String(env.AIWF_CODELET_ID ?? args.codelet ?? "codelet-observer").trim();

  if (args.help) {
    return outputAndExit(await renderHelp(), 0);
  }

  const runtimeContext = await buildSmartCodeletRunContext({
    projectRoot: root,
    codeletId,
    ticketId: args.ticket ? String(args.ticket).trim() : null,
    filePath: args.file ? String(args.file).trim() : null,
    goal: args.goal ? String(args.goal).trim() : null
  }).catch((error) => {
    printAndExit(String(error?.message ?? error), 1);
  });

  const meta = runtimeContext.codelet;
  const projectSummary = runtimeContext.projectSummary;
  const target = runtimeContext.target;
  const route = await routeTask({
    root,
    taskClass: meta.taskClass ?? "task-decomposition",
    preferLocal: true,
    allowWeak: true
  });
  const routed = applyRouteOverride(route, args.provider, args.model);

  const payload = routed.recommended
    ? await buildRoutedPayload({ codeletId, meta, runtimeContext, root, route: routed, args })
    : buildFallbackPayload({ codeletId, meta, root, projectSummary, target, route: routed });

  if (meta.observer && args["no-document"] !== true) {
    const note = await addManualNote({
      projectRoot: root,
      note: {
        noteType: "NOTE",
        body: [
          `Smart codelet observer: ${codeletId}`,
          payload.result?.summary ? `Summary: ${payload.result.summary}` : null,
          Array.isArray(payload.result?.candidate_codelets) && payload.result.candidate_codelets.length
            ? `Candidate codelets: ${payload.result.candidate_codelets.map((item) => item.id ?? item).join(", ")}`
            : null
        ].filter(Boolean).join(" | "),
        filePath: null,
        symbolName: codeletId,
        provenance: "tool-dev-codelet-observer"
      }
    });
    payload.documentation = {
      noteId: note.id,
      provenance: note.provenance
    };
  }

  return emit(payload, args.json);
}

async function buildRoutedPayload({ codeletId, meta, runtimeContext, root, route, args }) {
  const prompt = buildPrompt({
    codeletId,
    meta,
    root,
    projectSummary: runtimeContext.projectSummary,
    target: runtimeContext.target,
    promptContext: runtimeContext.promptContext,
    route
  });
  const attempts = [];
  const candidates = buildRouteCandidates(route);
  const startedAt = Date.now();
  let result = null;
  let successfulCandidate = null;

  for (const candidate of candidates) {
    const attemptStartedAt = Date.now();
    try {
      const completion = await generateCompletion({
        providerId: candidate.providerId,
        modelId: candidate.modelId,
        prompt,
        system: "You are an ai-workflow smart codelet. Return concise JSON only unless the user explicitly asks for prose.",
        config: route.providers?.[candidate.providerId] ?? {}
      });
      const parsed = parseStructuredResponse(completion.response);
      if (!parsed.structuredResponse) {
        attempts.push({
          providerId: candidate.providerId,
          modelId: candidate.modelId,
          success: false,
          latencyMs: Date.now() - attemptStartedAt,
          error: "smart codelet returned unstructured output",
          rawResponse: parsed.rawResponse ?? null
        });
        continue;
      }

      attempts.push({
        providerId: candidate.providerId,
        modelId: candidate.modelId,
        success: true,
        latencyMs: Date.now() - attemptStartedAt,
        error: null
      });
      result = parsed.result;
      successfulCandidate = candidate;
      break;
    } catch (error) {
      attempts.push({
        providerId: candidate.providerId,
        modelId: candidate.modelId,
        success: false,
        latencyMs: Date.now() - attemptStartedAt,
        error: error?.message ?? String(error),
        rawResponse: null
      });
    }
  }

  if (!result) {
    const payload = buildFallbackPayload({
      codeletId,
      meta,
      root,
      projectSummary: runtimeContext.projectSummary,
      target: runtimeContext.target,
      route: sanitizeRoute(route),
      reason: buildAttemptFailureReason(attempts, "Smart codelet execution degraded because every routed candidate failed or returned unstructured output."),
      diagnostics: summarizeRouteAttempts(attempts, null)
    });
    await recordSmartCodeletMetric({
      root,
      route,
      meta,
      attempts,
      successfulCandidate: null,
      success: false,
      errorMessage: payload.result.summary,
      startedAt
    });
    return payload;
  }

  const payload = {
    codelet: {
      id: codeletId,
      summary: meta.summary,
      taskClass: meta.taskClass ?? "task-decomposition",
      observer: Boolean(meta.observer)
    },
    root,
    route: sanitizeRoute(route),
    target: runtimeContext.target,
    projectSummary: runtimeContext.projectSummary,
    diagnostics: summarizeRouteAttempts(attempts, successfulCandidate),
    result,
    args
  };
  await recordSmartCodeletMetric({
    root,
    route,
    meta,
    attempts,
    successfulCandidate,
    success: true,
    errorMessage: null,
    startedAt
  });
  return payload;
}

function buildPrompt({ codeletId: id, meta, root: projectRoot, projectSummary, target, promptContext, route }) {
  const activeTickets = Array.isArray(projectSummary.activeTickets) ? projectSummary.activeTickets.slice(0, 5) : [];
  const candidateTickets = Array.isArray(projectSummary.candidates) ? projectSummary.candidates.slice(0, 5) : [];
  const taskContext = [
    target.ticket ? `Ticket: ${target.ticket.id} ${target.ticket.title} [${target.ticket.lane}]` : null,
    target.filePath ? `File: ${target.filePath}` : null,
    target.goal ? `Goal: ${target.goal}` : null
  ].filter(Boolean).join("\n");

  return [
    `Codelet id: ${id}`,
    `Focus: ${meta.intent}`,
    `Task class: ${meta.taskClass}`,
    `Purpose: ${meta.summary}`,
    "",
    "Helper context:",
    promptContext || "No additional surgical context available.",
    target.ticket ? `Ticket summary: ${target.ticket.summary || "n/a"}` : "Ticket summary: n/a",
    target.filePath ? `Target file: ${target.filePath}` : "Target file: none",
    target.goal ? `Goal: ${target.goal}` : "Goal: none",
    `Project root: ${projectRoot}`,
    "",
    "Project summary:",
    JSON.stringify({
      fileCount: projectSummary.fileCount,
      symbolCount: projectSummary.symbolCount,
      noteCount: projectSummary.noteCount,
      activeTicketCount: activeTickets.length,
      candidateCount: candidateTickets.length
    }, null, 2),
    "",
    activeTickets.length ? `Active tickets:\n${activeTickets.map((ticket) => `- ${ticket.id} ${ticket.title} [${ticket.lane}]`).join("\n")}` : "Active tickets: none",
    candidateTickets.length ? `Candidates:\n${candidateTickets.map((ticket) => `- ${ticket.id} ${ticket.title} [${ticket.lane}]`).join("\n")}` : "Candidates: none",
    "",
    route.recommended ? `Route: ${route.recommended.providerId}:${route.recommended.modelId} (${route.recommended.reason})` : "Route: unavailable",
    "",
    taskContext || "No explicit file/ticket/goal target was provided.",
    "",
    "Return JSON with this shape:",
    "{ summary, observations[], candidate_codelets[{id,reason}], suggested_actions[], docs_to_update[], needs_human_review }",
    "Keep it short and concrete."
  ].join("\n");
}

async function renderHelp() {
  const codelets = await listToolkitCodelets();
  return [
    "Usage: ai-workflow run <smart-codelet> [--root <path>] [--ticket <id>] [--file <path>] [--goal <text>] [--json]",
    "",
    "Registered smart codelets:",
    ...codelets
      .filter((codelet) => codelet.runner === "node-script" && codelet.entry?.includes("smart-codelet-runner.mjs"))
      .map((codelet) => `- ${codelet.id}: ${codelet.summary}`)
  ].join("\n");
}

function parseStructuredResponse(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    return {
      structuredResponse: false,
      rawResponse: "",
      result: {
        summary: "",
        observations: [],
        candidate_codelets: [],
        suggested_actions: [],
        docs_to_update: [],
        needs_human_review: true
      }
    };
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return {
        structuredResponse: true,
        rawResponse: trimmed,
        result: normalizeStructuredResult(parsed)
      };
    }
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(trimmed.slice(start, end + 1));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return {
            structuredResponse: true,
            rawResponse: trimmed,
            result: normalizeStructuredResult(parsed)
          };
        }
      } catch {
        // Fall through to degraded result.
      }
    }
  }

  return {
    structuredResponse: false,
    rawResponse: trimmed,
    result: {
      summary: trimmed,
      observations: [],
      candidate_codelets: [],
      suggested_actions: [],
      docs_to_update: [],
      needs_human_review: true
    }
  };
}

function normalizeStructuredResult(parsed) {
  return {
    summary: String(parsed.summary ?? "").trim(),
    observations: normalizeStringArray(parsed.observations),
    candidate_codelets: Array.isArray(parsed.candidate_codelets) ? parsed.candidate_codelets : [],
    suggested_actions: normalizeStringArray(parsed.suggested_actions),
    docs_to_update: normalizeStringArray(parsed.docs_to_update),
    needs_human_review: Boolean(parsed.needs_human_review)
  };
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function buildFallbackPayload({ codeletId, meta, root, projectSummary, target, route, reason = null, diagnostics = null }) {
  return {
    codelet: {
      id: codeletId,
      summary: meta.summary,
      taskClass: meta.taskClass,
      observer: Boolean(meta.observer)
    },
    root,
    route,
    target,
    projectSummary,
    diagnostics,
    result: {
      summary: reason ?? `${meta.summary} (route unavailable)`,
      observations: [],
      candidate_codelets: [],
      suggested_actions: ["Connect a routeable provider or configure Ollama to use this smart codelet."],
      docs_to_update: [],
      needs_human_review: true
    }
  };
}

function applyRouteOverride(route, providerId, modelId) {
  const normalizedProvider = String(providerId ?? "").trim();
  const normalizedModel = String(modelId ?? "").trim();

  if (!normalizedProvider || !normalizedModel) {
    return route;
  }

  const providers = route.providers ?? {};
  const provider = providers[normalizedProvider] ?? {};
  const existing = route.recommended?.providerId === normalizedProvider && route.recommended?.modelId === normalizedModel
    ? route.recommended
    : null;

  return {
    ...route,
    recommended: existing ?? {
      providerId: normalizedProvider,
      modelId: normalizedModel,
      local: Boolean(provider.local),
      reason: "explicit provider/model override"
    },
    fallbackChain: buildRouteCandidates(route)
      .filter((candidate) => candidate.providerId !== normalizedProvider || candidate.modelId !== normalizedModel)
  };
}

function buildRouteCandidates(route, limit = 5) {
  const seen = new Set();
  const ordered = [];
  for (const candidate of [
    route?.recommended ?? null,
    ...(Array.isArray(route?.fallbackChain) ? route.fallbackChain : []),
    ...(Array.isArray(route?.candidates) ? route.candidates : [])
  ]) {
    if (!candidate?.providerId || !candidate?.modelId) {
      continue;
    }
    const key = `${candidate.providerId}:${candidate.modelId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    ordered.push(candidate);
    if (ordered.length >= limit) {
      break;
    }
  }
  return ordered;
}

function summarizeRouteAttempts(attempts, successfulCandidate) {
  const normalized = Array.isArray(attempts) ? attempts : [];
  return {
    attempts: normalized,
    failedAttempts: normalized.filter((attempt) => attempt.success === false).length,
    successfulProviderId: successfulCandidate?.providerId ?? null,
    successfulModelId: successfulCandidate?.modelId ?? null
  };
}

function buildAttemptFailureReason(attempts, fallback) {
  const failures = (Array.isArray(attempts) ? attempts : [])
    .filter((attempt) => attempt.success === false)
    .map((attempt) => `${attempt.providerId}:${attempt.modelId} ${attempt.error}`)
    .filter(Boolean);
  if (!failures.length) {
    return fallback;
  }
  return `${fallback}\n- ${failures.join("\n- ")}`;
}

async function recordSmartCodeletMetric({ root, route, meta, attempts, successfulCandidate, success, errorMessage, startedAt }) {
  const diagnostics = summarizeRouteAttempts(attempts, successfulCandidate);
  const failedLatencyMs = (Array.isArray(attempts) ? attempts : [])
    .filter((attempt) => attempt.success === false)
    .reduce((total, attempt) => total + Math.max(0, Number(attempt.latencyMs ?? 0)), 0);
  const metric = {
    taskClass: meta?.taskClass ?? "task-decomposition",
    capability: route?.capability ?? "strategy",
    providerId: successfulCandidate?.providerId ?? route?.recommended?.providerId ?? "unavailable",
    modelId: successfulCandidate?.modelId ?? route?.recommended?.modelId ?? "unavailable",
    latencyMs: Date.now() - startedAt,
    success,
    errorMessage: success ? null : errorMessage,
    details: {
      stage: "smart-codelet",
      attemptCount: Array.isArray(attempts) ? attempts.length : 0,
      fallbackUsed: diagnostics.failedAttempts > 0,
      failedAttempts: diagnostics.failedAttempts,
      failedLatencyMs,
      failedProviders: (Array.isArray(attempts) ? attempts : [])
        .filter((attempt) => attempt.success === false)
        .map((attempt) => `${attempt.providerId}:${attempt.modelId}`),
      successfulProviderId: diagnostics.successfulProviderId,
      successfulModelId: diagnostics.successfulModelId
    }
  };
  await withWorkflowStore(root, async (store) => {
    store.appendMetric(metric);
  }).catch(() => {});
}

function sanitizeRoute(route) {
  if (!route || typeof route !== "object") {
    return route;
  }

  const redactCandidate = (candidate) => candidate && typeof candidate === "object"
    ? {
        ...candidate,
        apiKey: candidate.apiKey ? "[redacted]" : candidate.apiKey
      }
    : candidate;

  const providers = {};
  for (const [providerId, provider] of Object.entries(route.providers ?? {})) {
    providers[providerId] = provider && typeof provider === "object"
      ? {
          ...provider,
          apiKey: provider.apiKey ? "[redacted]" : provider.apiKey
        }
      : provider;
  }

  return {
    ...route,
    recommended: redactCandidate(route.recommended),
    fallbackChain: Array.isArray(route.fallbackChain) ? route.fallbackChain.map(redactCandidate) : route.fallbackChain,
    candidates: Array.isArray(route.candidates) ? route.candidates.map(redactCandidate) : route.candidates,
    providers
  };
}

function emit(payload, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return payload;
  }

  const lines = [
    `Codelet: ${payload.codelet.id}`,
    `Route: ${payload.route.recommended ? `${payload.route.recommended.providerId}:${payload.route.recommended.modelId}` : "unavailable"}`,
    `Summary: ${payload.result?.summary ?? "n/a"}`
  ];

  if (Array.isArray(payload.result?.suggested_actions) && payload.result.suggested_actions.length) {
    lines.push("");
    lines.push("Suggested actions:");
    for (const item of payload.result.suggested_actions) {
      lines.push(`- ${item}`);
    }
  }

  if (Array.isArray(payload.result?.candidate_codelets) && payload.result.candidate_codelets.length) {
    lines.push("");
    lines.push("Candidate codelets:");
    for (const item of payload.result.candidate_codelets) {
      lines.push(`- ${item.id ?? item}: ${item.reason ?? ""}`.trim());
    }
  }

  if (payload.documentation) {
    lines.push("");
    lines.push(`Documentation note: ${payload.documentation.noteId}`);
  }

  process.stdout.write(`${lines.join("\n").trimEnd()}\n`);
  return payload;
}

function outputAndExit(text, code = 0) {
  process.stdout.write(`${text}\n`);
  process.exit(code);
}

const entryUrl = pathToFileURL(process.argv[1] ?? "").href;
if (process.env.AIWF_WRAPPED_RUNTIME === "1" || import.meta.url === entryUrl) {
  const exitCode = await runSmartCodelet();
  process.exitCode = exitCode && typeof exitCode === "number" ? exitCode : 0;
}
