#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, printAndExit } from "./lib/cli.mjs";
import { addManualNote, getProjectSummary, withWorkflowStore } from "../../../core/services/sync.mjs";
import { routeTask } from "../../../core/services/router.mjs";
import { generateCompletion } from "../../../core/services/providers.mjs";

const SMART_CODELETS = {
  "css-refactor": {
    taskClass: "refactoring",
    summary: "Refactor CSS into smaller, reusable pieces.",
    intent: "CSS refactor"
  },
  "riot-simplify": {
    taskClass: "refactoring",
    summary: "Simplify a Riot component without losing behavior.",
    intent: "Riot component simplification"
  },
  "component-extract": {
    taskClass: "task-decomposition",
    summary: "Extract a component or module boundary from a larger surface.",
    intent: "component extraction"
  },
  "api-extract": {
    taskClass: "architectural-reasoning",
    summary: "Extract a clean API from a larger implementation surface.",
    intent: "API extraction"
  },
  "import-cleanup": {
    taskClass: "refactoring",
    summary: "Remove unused, duplicated, or overly broad imports.",
    intent: "import cleanup"
  },
  "test-heal": {
    taskClass: "bug-hunting",
    summary: "Repair failing or brittle tests with the smallest honest change.",
    intent: "test repair"
  },
  "docs-refresh": {
    taskClass: "summarization",
    summary: "Refresh docs to match the current workflow and project reality.",
    intent: "documentation refresh"
  },
  "kanban-reconcile": {
    taskClass: "task-decomposition",
    summary: "Reconcile kanban drift and keep board state consistent with the DB.",
    intent: "kanban reconciliation"
  },
  "route-diagnose": {
    taskClass: "architectural-reasoning",
    summary: "Diagnose provider routing and model selection problems.",
    intent: "provider routing diagnosis"
  },
  "dependency-prune": {
    taskClass: "architectural-reasoning",
    summary: "Prune unnecessary dependency edges or redundant architecture links.",
    intent: "dependency pruning"
  },
  "codelet-observer": {
    taskClass: "task-decomposition",
    summary: "Observe recurring work patterns and propose new codelets.",
    intent: "observer",
    observer: true
  }
};

export async function runSmartCodelet(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  const root = path.resolve(String(args.root ?? process.cwd()));
  const codeletId = String(env.AIWF_CODELET_ID ?? args.codelet ?? "codelet-observer").trim();
  const meta = SMART_CODELETS[codeletId] ?? SMART_CODELETS["codelet-observer"];

  if (args.help) {
    return outputAndExit(renderHelp(), 0);
  }

  const projectSummary = await getProjectSummary({ projectRoot: root });
  const target = await resolveTarget(root, args);
  const route = await routeTask({
    root,
    taskClass: meta.taskClass,
    preferLocal: true,
    allowWeak: true
  });
  const routed = applyRouteOverride(route, args.provider, args.model);

  const payload = routed.recommended
    ? await buildRoutedPayload({ codeletId, meta, root, projectSummary, target, route: routed, args })
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

async function buildRoutedPayload({ codeletId, meta, root, projectSummary, target, route, args }) {
  const provider = route.providers?.[route.recommended.providerId] ?? {};
  const prompt = buildPrompt({
    codeletId,
    meta,
    root,
    projectSummary,
    target,
    route
  });

  const completion = await generateCompletion({
    providerId: route.recommended.providerId,
    modelId: route.recommended.modelId,
    prompt,
    system: "You are an ai-workflow smart codelet. Return concise JSON only unless the user explicitly asks for prose.",
    config: provider
  });

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
    result: parseStructuredResponse(completion.response),
    args
  };
}

async function resolveTarget(rootDir, parsedArgs) {
  const target = {
    ticketId: parsedArgs.ticket ? String(parsedArgs.ticket).trim() : null,
    filePath: parsedArgs.file ? path.normalize(String(parsedArgs.file).trim()) : null,
    goal: parsedArgs.goal ? String(parsedArgs.goal).trim() : null
  };

  if (!target.ticketId) {
    return target;
  }

  return withWorkflowStore(rootDir, async (store) => {
    const entity = store.getEntity(target.ticketId);
    if (!entity) {
      return target;
    }

    return {
      ...target,
      ticket: {
        id: entity.id,
        title: entity.title,
        lane: entity.lane,
        state: entity.state,
        summary: String(entity.data?.summary ?? "").trim()
      }
    };
  });
}

function buildPrompt({ codeletId: id, meta, root: projectRoot, projectSummary, target, route }) {
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

function parseStructuredResponse(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    return {
      summary: "",
      observations: [],
      candidate_codelets: [],
      suggested_actions: [],
      docs_to_update: [],
      needs_human_review: false
    };
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return {
      summary: trimmed,
      observations: [],
      candidate_codelets: [],
      suggested_actions: [],
      docs_to_update: [],
      needs_human_review: false
    };
  }
}

function buildFallbackPayload({ codeletId, meta, root, projectSummary, target, route }) {
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
    result: {
      summary: `${meta.summary} (route unavailable)`,
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
    }
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

function renderHelp() {
  return [
    "Usage: ai-workflow run <smart-codelet> [--root <path>] [--ticket <id>] [--file <path>] [--goal <text>] [--json]",
    "",
    "Smart codelets:",
    ...Object.entries(SMART_CODELETS).map(([id, meta]) => `- ${id}: ${meta.summary}`)
  ].join("\n");
}

function outputAndExit(text, code = 0) {
  process.stdout.write(`${text}\n`);
  process.exit(code);
}

const entryUrl = pathToFileURL(process.argv[1] ?? "").href;
if (import.meta.url === entryUrl) {
  const exitCode = await runSmartCodelet();
  process.exitCode = exitCode && typeof exitCode === "number" ? exitCode : 0;
}
