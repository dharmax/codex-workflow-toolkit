import path from "node:path";
import process from "node:process";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { listToolkitCodelets } from "./codelets.mjs";
import { listProjectCodelets } from "./project-codelets.mjs";
import { routeTask } from "../../core/services/router.mjs";
import { discoverProviderState, generateCompletion, generateWithOllama } from "../../core/services/providers.mjs";
import { decomposeTicket, ideateFeature, sweepBugs } from "../../core/services/orchestrator.mjs";
import { auditArchitecture } from "../../core/services/critic.mjs";
import { addManualNote, createTicket, getProjectMetrics, getProjectSummary, recordMetric, searchProject, syncProject, withWorkflowStore } from "../../core/services/sync.mjs";
import { buildTicketEntity } from "../../core/services/projections.mjs";
import { buildTelegramPreview } from "../../core/services/telegram.mjs";
import { parseArgs, printAndExit } from "../../runtime/scripts/codex-workflow/lib/cli.mjs";
import { getConfigValue, getGlobalConfigPath, getProjectConfigPath, readConfig, removeConfigFile, removeConfigValue, writeConfigValue } from "./config-store.mjs";
import { buildDoctorReport, renderDoctorReport } from "./doctor.mjs";
import { configureOllamaHardware } from "./ollama-hw.mjs";

const execFileAsync = promisify(execFile);
const STREAMED_STDIO = "__STREAMED_STDIO__";

const MUTATING_ACTIONS = new Set(["sync", "add_note", "create_ticket", "set_ollama_hw"]);
const NOTE_TYPES = ["NOTE", "TODO", "FIXME", "HACK", "BUG", "RISK"];
const KNOWN_TASK_CLASSES = [
  "summarization",
  "extraction",
  "classification",
  "clustering",
  "ranking",
  "note-normalization",
  "candidate-review",
  "naming",
  "architectural-reasoning",
  "risky-planning",
  "code-generation",
  "review",
  "shell-planning",
  "task-decomposition",
  "architectural-design",
  "ui-styling",
  "templating",
  "pure-function",
  "refactoring",
  "bug-hunting"
];

export async function handleShell(rest, { cliPath } = {}) {
  const args = parseArgs(rest);
  if (args.help) {
    printAndExit(SHELL_HELP.trim());
  }

  const root = process.cwd();
  const plannerContext = await buildShellContext(root);
  const planners = await resolveShellPlanners(root);
  const options = {
    root,
    json: Boolean(args.json),
    yes: Boolean(args.yes),
    noAi: Boolean(args["no-ai"]),
    planOnly: Boolean(args["plan-only"]),
    cliPath: cliPath ?? path.resolve(root, "cli", "ai-workflow.mjs"),
    plannerContext,
    planners
  };

  const prompt = args._.join(" ").trim();
  if (prompt) {
    const result = await runShellTurn(prompt, options);
    return emitShellResult(result, options);
  }

  return runInteractiveShell(options);
}

export async function buildShellContext(root = process.cwd()) {
  const [toolkitCodelets, projectCodelets, summary, providerState] = await Promise.all([
    listToolkitCodelets(),
    listProjectCodelets(root),
    safeGetProjectSummary(root),
    discoverProviderState({ root })
  ]);

  return {
    root,
    toolkitCodelets,
    projectCodelets,
    summary,
    knowledge: providerState.knowledge
  };
}

export async function resolveShellPlanners(root = process.cwd()) {
  const route = await routeTask({ root, taskClass: "shell-planning" });
  const planners = [];

  if (route.recommended) {
    planners.push(mapRouteCandidateToPlanner(route.recommended, route.providers));
  }

  for (const candidate of route.fallbackChain) {
    planners.push(mapRouteCandidateToPlanner(candidate, route.providers));
  }

  return {
    planners,
    heuristic: {
      mode: "heuristic",
      reason: "No available AI models for shell planning."
    }
  };
}

function mapRouteCandidateToPlanner(candidate, providers) {
  const provider = providers[candidate.providerId];
  return {
    mode: provider.local ? "ollama" : "agentic",
    providerId: candidate.providerId,
    modelId: candidate.modelId,
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
    host: provider.host,
    needsHardwareHint: provider.local && !provider.hardwareClass && !provider.maxModelSizeB && !provider.plannerMaxQuality,
    reason: candidate.reason
  };
}

export async function planShellRequest(inputText, options) {
  const heuristic = planShellRequestHeuristically(inputText, options.plannerContext);
  const useHeuristicOnly = options.noAi || !options.planners.planners.length;

  if (useHeuristicOnly || heuristic.confidence >= 0.92) {
    return {
      ...heuristic,
      planner: {
        mode: options.noAi ? "heuristic-forced" : "heuristic",
        reason: heuristic.reason
      }
    };
  }

  const errors = [];
  for (const planner of options.planners.planners) {
    // Skip providers that have already failed in this session
    if (options.blacklist?.has(planner.providerId)) {
      continue;
    }

    try {
      const aiPlan = await planShellRequestWithAgent(inputText, { ...options, planner });
      return {
        ...aiPlan,
        planner
      };
    } catch (error) {
      const isFatal = String(error).includes("403") || String(error).includes("PERMISSION_DENIED") || String(error).includes("invalid_key");
      if (isFatal) {
        options.blacklist ??= new Set();
        options.blacklist.add(planner.providerId);
        if (!options.json) {
          output.write(`Planner ${planner.providerId} failed: ${error.message}. Switching to fallback...\n`);
        }
      }
      errors.push(`${planner.providerId}: ${error.message ?? String(error)}`);
    }
  }

  return {
    ...heuristic,
    planner: {
      mode: "heuristic-fallback",
      reason: errors.join("; ")
    }
  };
}

export function planShellRequestHeuristically(inputText, plannerContext) {
  const text = String(inputText ?? "").trim();
  const lower = text.toLowerCase();
  const normalizedQuestion = lower.replace(/[?!.\s]+$/g, "");

  if (!text) {
    return replyPlan("Tell me what you want to do. Example: `sync and show review hotspots`.");
  }

  if (["help", "/help", "what can you do", "commands"].includes(normalizedQuestion)) {
    return replyPlan(renderShellHelp(plannerContext));
  }

  if (["exit", "quit", "/exit", "/quit"].includes(lower)) {
    return {
      kind: "exit",
      actions: [],
      confidence: 1,
      reason: "Explicit exit request."
    };
  }

  if (/^(status|summary|project summary|show status)$/i.test(text)) {
    return actionPlan([{ type: "project_summary" }], 0.98, "Explicit summary/status request.");
  }

  if (/^(metrics|stats|usage)$/i.test(text)) {
    return actionPlan([{ type: "metrics" }], 0.98, "Usage metrics request.");
  }

  if (/^(audit\s+architecture|check\s+wiring|arch\s+audit)$/i.test(text)) {
    return actionPlan([{ type: "audit_architecture" }], 0.98, "Architectural audit request.");
  }

  if (/^(doctor|diagnostics)$/i.test(text)) {
    return actionPlan([{ type: "doctor" }], 0.98, "Explicit diagnostics request.");
  }

  if (/^(sync|reindex|refresh index)(\b.*)?$/i.test(text)) {
    const wantsReview = /\breview\b|\bhotspot\b/.test(lower);
    return actionPlan(
      wantsReview
        ? [{ type: "sync" }, { type: "run_review" }]
        : [{ type: "sync" }],
      wantsReview ? 0.95 : 0.98,
      wantsReview ? "Sync request followed by review request." : "Explicit sync request."
    );
  }

  if (/^(review|review hotspots|show review hotspots)$/i.test(text)) {
    return actionPlan([{ type: "run_review" }], 0.98, "Explicit review request.");
  }

  if (/^(telegram|telegram preview|preview telegram|status preview)$/i.test(text)) {
    return actionPlan([{ type: "telegram_preview" }], 0.96, "Explicit Telegram preview request.");
  }

  const ollamaHwMatch = text.match(/^set-ollama-hw\b(.*)$/i);
  if (ollamaHwMatch) {
    return actionPlan([{
      type: "set_ollama_hw",
      global: /\s--global\b/.test(ollamaHwMatch[1])
    }], 1.0, "Explicit Ollama hardware setup request.");
  }

  const providerKeyMatch = text.match(/^set-provider-key\s+([a-z0-9_-]+)(.*)$/i);
  if (providerKeyMatch) {
    return actionPlan([{
      type: "set_provider_key",
      providerId: providerKeyMatch[1].toLowerCase(),
      global: /\s--global\b/.test(providerKeyMatch[2])
    }], 1.0, "Explicit provider key setup request.");
  }

  const configMatch = text.match(/^config\s+(get|set|unset|clear)\b(.*)$/i);
  if (configMatch) {
    const action = configMatch[1].toLowerCase();
    const args = configMatch[2].trim().split(/\s+/).filter(Boolean);
    return actionPlan([{
      type: "config",
      action,
      key: args[0] ?? null,
      value: args[1] ?? null,
      global: configMatch[2].includes("--global")
    }], 1.0, "Explicit config request.");
  }

  const routeMatch = text.match(/^(?:route|pick model for)\s+(.+)$/i);
  if (routeMatch) {
    return actionPlan([{ type: "route", taskClass: normalizeTaskClass(routeMatch[1], plannerContext) }], 0.93, "Explicit routing request.");
  }

  const searchMatch = text.match(/^(?:search|find)\s+(.+)$/i);
  if (searchMatch) {
    return actionPlan([{ type: "search", query: searchMatch[1].trim() }], 0.95, "Explicit search request.");
  }

  const ticketMatch = text.match(/(?:extract\s+ticket|show\s+ticket|ticket|decompose\s+ticket|break\s+down)\s+([A-Z]+-\d+)/i);
  if (ticketMatch) {
    const isDecompose = /\b(?:decompose|break down|split)\b/i.test(text);
    return actionPlan([{
      type: isDecompose ? "decompose_ticket" : "extract_ticket",
      ticketId: ticketMatch[1].toUpperCase()
    }], 0.94, `Explicit ticket ${isDecompose ? "decomposition" : "extraction"} request.`);
  }

  const featureMatch = text.match(/^(?:add|create|new)\s+(?:new\s+)?(?:feature|epic|big task)\b\s*(?:for\s+)?(.*)$/i);
  if (featureMatch) {
    return actionPlan([{
      type: "ideate_feature",
      intent: featureMatch[1].trim()
    }], 0.95, "New feature ideation request.");
  }

  if (text.match(/^(?:sweep|fix|handle)\s+(?:all\s+)?(?:top\s+)?(?:priority\s+)?bugs\b/i)) {
    return actionPlan([{ type: "sweep_bugs" }], 0.98, "Automated bug sweeping request.");
  }

  const guidelinesMatch = text.match(/(?:extract\s+guidelines|guidelines)(?:\s+for)?(?:\s+([A-Z]+-\d+))?/i);
  if (guidelinesMatch && /guideline/i.test(text)) {
    return actionPlan([{
      type: "extract_guidelines",
      ticketId: guidelinesMatch[1]?.toUpperCase() ?? null,
      changed: /\bchanged\b/.test(lower)
    }], 0.9, "Explicit guideline extraction request.");
  }

  const noteMatch = text.match(/(?:add|create)\s+(note|bug|todo|fixme|hack|risk)\b/i);
  if (noteMatch) {
    const noteType = normalizeNoteType(noteMatch[1]);
    const bodyMatch = text.match(/(?:body|that says|saying)\s+["“]?(.+?)["”]?$/i);
    if (noteType && bodyMatch?.[1]) {
      const fileMatch = text.match(/\b(?:file|in)\s+([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)\b/);
      const lineMatch = text.match(/\bline\s+(\d+)\b/i);
      return actionPlan([{
        type: "add_note",
        noteType,
        body: bodyMatch[1].trim(),
        filePath: fileMatch?.[1] ?? null,
        line: lineMatch ? Number(lineMatch[1]) : null
      }], 0.84, "Structured note creation request.");
    }
  }

  return replyPlan([
    "I can turn requests into workflow actions, but this one needs the AI planner or a more direct phrasing.",
    "Try: `sync and show review hotspots`, `summary`, `search router`, `ticket TKT-001`, or `route review`."
  ].join("\n"), 0.45, "No high-confidence heuristic match.");
}

export async function planShellRequestWithAgent(inputText, options) {
  const catalog = buildActionCatalog(options.plannerContext);
  const summary = options.plannerContext.summary ?? {};
  const history = options.history ?? [];

  const ticketsSummary = (summary.activeTickets ?? [])
    .slice(0, 10)
    .map(t => `- [${t.lane}] ${t.id}: ${t.title}`)
    .join("\n");

  const candidatesSummary = (summary.candidates ?? [])
    .slice(0, 5)
    .map(c => `- Candidate: ${c.title} (Score: ${c.data?.score ?? 0})`)
    .join("\n");

  const system = [
    "You are the expert persona for 'ai-workflow', an Autonomous Engineering OS.",
    "Your goal is to help the developer manage their project workflow efficiently.",
    "You are friendly, robust, and reliable.",
    "",
    "## Project State Definitions",
    "- Claims: Architectural facts extracted via AST (e.g., 'File A calls Function B').",
    "- Modules: Architectural boundaries (e.g., 'core/db', 'ui/auth').",
    "- Features: User-facing capabilities mapped to code.",
    "- Kanban: The live workplan (Tickets and Epics).",
    "",
    "## Project Status",
    `- Indexed Files: ${summary.fileCount ?? 0}`,
    `- Unprocessed Notes: ${summary.noteCount ?? 0}`,
    "",
    "### Active Tickets (Next to handle)",
    ticketsSummary || "No active tickets.",
    "",
    "### Top Review Candidates (Potential bugs/tasks)",
    candidatesSummary || "No pending review candidates.",
    "",
    "## Instructions",
    "1. Analyze the user intent. Use the provided Project Status to answer questions accurately.",
    "2. If the user asks about tickets, ONLY list the tickets shown above. Do not invent tickets.",
    "3. If the user is just chatting or asking about status, use kind=reply.",
    "4. If the user wants to perform a task, use kind=plan and map it to available actions.",
    "5. Return ONLY valid JSON matching the schema.",
    "6. Use at most 3 actions per plan."
  ].join("\n");

  const historyText = history.length > 0
    ? "## Conversation History\n" + history.map(h => `${h.role === "user" ? "User" : "You"}: ${h.content}`).join("\n") + "\n\n"
    : "";

  const prompt = [
    historyText,
    "## Available Actions:",
    catalog,
    "",
    "## Allowed JSON Schema:",
    JSON.stringify({
      kind: "plan|reply|exit",
      confidence: 0.8,
      reason: "thinking process",
      reply: "human-friendly message (use when kind=reply)",
      actions: [{
        type: "project_summary|metrics|audit_architecture|sync|run_review|search|extract_ticket|decompose_ticket|ideate_feature|sweep_bugs|extract_guidelines|route|telegram_preview|add_note|create_ticket|run_codelet",
        query: "for search",
        ticketId: "for extract_ticket/decompose_ticket/extract_guidelines",
        intent: "for ideate_feature",
        changed: true,
        taskClass: "for route",
        noteType: "NOTE|TODO|FIXME|HACK|BUG|RISK",
        body: "for add_note",
        filePath: "optional",
        line: 12,
        id: "for create_ticket",
        title: "for create_ticket",
        lane: "optional",
        epicId: "optional",
        summary: "optional",
        codeletId: "for run_codelet",
        args: ["optional", "args"]
      }]
    }, null, 2),
    "",
    `## Current Request:\nUser: "${inputText}"\nYou (output JSON only):`
  ].join("\n");

  const start = Date.now();
  let completion;
  let success = true;
  let errorMsg = null;

  try {
    completion = await generateCompletion({
      providerId: options.planner.providerId,
      modelId: options.planner.modelId,
      system,
      prompt,
      config: {
        apiKey: options.planner.apiKey,
        baseUrl: options.planner.baseUrl,
        host: options.planner.host,
        format: "json"
      }
    });
  } catch (error) {
    success = false;
    errorMsg = error.message;
    throw error;
  } finally {
    const latencyMs = Date.now() - start;
    await recordMetric({
      projectRoot: options.root,
      metric: {
        taskClass: "shell-planning",
        capability: "strategy",
        providerId: options.planner.providerId,
        modelId: options.planner.modelId,
        latencyMs,
        success,
        errorMessage: errorMsg
      }
    }).catch(() => {}); // Fire and forget
  }

  try {
    const rawResponse = completion.response.trim();
    // Extract JSON block even if there's conversational filler around it
    const jsonMatch = rawResponse.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const cleanJson = jsonMatch ? jsonMatch[1].trim() : rawResponse;

    const parsed = JSON.parse(cleanJson);
    return validateShellPlan(parsed, options.plannerContext);
  } catch (error) {
    return replyPlan(completion.response, 0.5, "Model returned non-JSON text; treating as reply.");
  }
}

export function validateShellPlan(plan, plannerContext) {
  if (!plan || typeof plan !== "object") {
    throw new Error("shell planner returned non-object");
  }

  if (plan.kind === "reply") {
    return replyPlan(String(plan.reply ?? "I need a clearer request."), Number(plan.confidence ?? 0.5), String(plan.reason ?? "Planner reply."));
  }

  if (plan.kind === "exit") {
    return {
      kind: "exit",
      actions: [],
      confidence: Number(plan.confidence ?? 1),
      reason: String(plan.reason ?? "Planner exit.")
    };
  }

  const actions = Array.isArray(plan.actions) ? plan.actions.slice(0, 3).map((action) => validateShellAction(action, plannerContext)) : [];
  if (!actions.length) {
    throw new Error("shell planner produced no actions");
  }

  return {
    kind: "plan",
    actions,
    confidence: Number(plan.confidence ?? 0.7),
    reason: String(plan.reason ?? "Planner produced a valid action plan.")
  };
}

function validateShellAction(action, plannerContext) {
  if (!action || typeof action !== "object") {
    throw new Error("shell action must be an object");
  }

  const type = String(action.type ?? "");
  switch (type) {
    case "project_summary":
    case "doctor":
    case "sync":
    case "run_review":
    case "telegram_preview":
      return { type };
    case "set_ollama_hw":
      return { type, global: Boolean(action.global) };
    case "search":
      if (!String(action.query ?? "").trim()) {
        throw new Error("search action requires query");
      }
      return { type, query: String(action.query).trim() };
    case "extract_ticket":
      return { type, ticketId: requireTicketId(action.ticketId) };
    case "extract_guidelines":
      return {
        type,
        ticketId: action.ticketId ? requireTicketId(action.ticketId) : null,
        changed: Boolean(action.changed)
      };
    case "route":
      return { type, taskClass: normalizeTaskClass(action.taskClass, plannerContext) };
    case "add_note":
      if (!String(action.body ?? "").trim()) {
        throw new Error("add_note action requires body");
      }
      return {
        type,
        noteType: normalizeNoteType(action.noteType) ?? "NOTE",
        body: String(action.body).trim(),
        filePath: action.filePath ? String(action.filePath).trim() : null,
        line: Number.isFinite(Number(action.line)) ? Number(action.line) : null
      };
    case "create_ticket":
      if (!String(action.id ?? "").trim() || !String(action.title ?? "").trim()) {
        throw new Error("create_ticket action requires id and title");
      }
      return {
        type,
        id: requireTicketId(action.id),
        title: String(action.title).trim(),
        lane: action.lane ? String(action.lane).trim() : null,
        epicId: action.epicId ? requireTicketId(action.epicId) : null,
        summary: action.summary ? String(action.summary).trim() : null
      };
    case "run_codelet": {
      const codeletId = String(action.codeletId ?? "").trim();
      const known = new Set([
        ...plannerContext.toolkitCodelets.map((item) => item.id),
        ...plannerContext.projectCodelets.map((item) => item.id)
      ]);
      if (!known.has(codeletId)) {
        throw new Error(`unknown codelet: ${codeletId}`);
      }
      return {
        type,
        codeletId,
        args: Array.isArray(action.args) ? action.args.map((item) => String(item)) : []
      };
    }
    default:
      throw new Error(`unsupported shell action type: ${type}`);
  }
}

export async function runShellTurn(inputText, options) {
  const plan = await planShellRequest(inputText, options);
  const result = {
    input: inputText,
    plan,
    executed: [],
    preRendered: false,
    history: options.history ?? []
  };

  if (plan.kind !== "plan") {
    return result;
  }

  if (!options.yes && !options.planOnly && plan.actions.some((action) => isMutatingAction(action))) {
    const approved = await confirmPlan(plan, options);
    if (!approved) {
      return {
        input: inputText,
        plan: {
          ...plan,
          kind: "reply",
          reply: "Cancelled.",
          actions: []
        },
        executed: [],
        preRendered: false
      };
    }
  }

  if (options.planOnly) {
    return {
      input: inputText,
      plan,
      executed: [],
      preRendered: false
    };
  }

  let preRendered = false;
  if (!options.json) {
    const activePlanner = plan.planner ?? options.planners.planners[0] ?? options.planners.heuristic;
    output.write(`${renderPlannerLine(activePlanner)}\n${renderActionList(plan.actions)}\n`);
    preRendered = true;
  }

  const executed = [];
  for (const action of plan.actions) {
    executed.push(await executeShellAction(action, options));
  }

  const failed = executed.find((item) => item.ok === false);
  let recovery = null;
  const anyAiPlanner = options.planners.planners[0];
  if (failed && anyAiPlanner && !options.noAi) {
    recovery = await attemptShellRecovery({
      inputText,
      plan,
      failed,
      options,
      planner: anyAiPlanner
    });
  }

  return {
    input: inputText,
    plan,
    executed,
    preRendered,
    recovery
  };
}

export async function executeShellAction(action, options) {
  const compiled = compileShellAction(action, { json: options.json });
  try {
    const stdout = await runShellActionDirect(action, options);
    return {
      action,
      command: compiled.display,
      mutation: compiled.mutation,
      ok: true,
      stdout,
      stderr: ""
    };
  } catch (error) {
    return {
      action,
      command: compiled.display,
      mutation: compiled.mutation,
      ok: false,
      stdout: "",
      stderr: error?.message ?? String(error)
    };
  }
}

export function compileShellAction(action, { json = false } = {}) {
  switch (action.type) {
    case "project_summary":
      return cliCommand(["project", "summary", ...(json ? ["--json"] : [])], false);
    case "metrics":
      return cliCommand(["project", "metrics", ...(json ? ["--json"] : [])], false);
    case "doctor":
      return cliCommand(["doctor", ...(json ? ["--json"] : [])], false);
    case "audit_architecture":
      return cliCommand(["audit", "architecture", ...(json ? ["--json"] : [])], false);
    case "sync":
      return cliCommand(["sync", ...(json ? ["--json"] : [])], true);
    case "run_review":
      return cliCommand(["run", "review"], false);
    case "search":
      return cliCommand(["project", "search", action.query, ...(json ? ["--json"] : [])], false);
    case "extract_ticket":
      return cliCommand(["extract", "ticket", action.ticketId], false);
    case "decompose_ticket":
      return cliCommand(["decompose", "ticket", action.ticketId], false);
    case "ideate_feature":
      return cliCommand(["ideate", "feature", action.intent], true);
    case "sweep_bugs":
      return cliCommand(["sweep", "bugs"], true);
    case "extract_guidelines":
      return cliCommand([
        "extract",
        "guidelines",
        ...(action.ticketId ? ["--ticket", action.ticketId] : []),
        ...(action.changed ? ["--changed"] : [])
      ], false);
    case "route":
      return cliCommand(["route", action.taskClass, ...(json ? ["--json"] : [])], false);
    case "telegram_preview":
      return cliCommand(["telegram", "preview", ...(json ? ["--json"] : [])], false);
    case "set_ollama_hw":
      return cliCommand(["set-ollama-hw", ...(action.global ? ["--global"] : [])], true);
    case "set_provider_key":
      return cliCommand(["set-provider-key", action.providerId, "--global"], true);
    case "config":
      return cliCommand([
        "config",
        action.action,
        ...(action.key ? [action.key] : []),
        ...(action.value ? [action.value] : []),
        ...(action.global ? ["--global"] : [])
      ], action.action !== "get");
    case "add_note":
      return cliCommand([
        "project",
        "note",
        "add",
        "--type",
        action.noteType,
        "--body",
        action.body,
        ...(action.filePath ? ["--file", action.filePath] : []),
        ...(action.line ? ["--line", String(action.line)] : []),
        ...(json ? ["--json"] : [])
      ], true);
    case "create_ticket":
      return cliCommand([
        "project",
        "ticket",
        "create",
        "--id",
        action.id,
        "--title",
        action.title,
        ...(action.lane ? ["--lane", action.lane] : []),
        ...(action.epicId ? ["--epic", action.epicId] : []),
        ...(action.summary ? ["--summary", action.summary] : []),
        ...(json ? ["--json"] : [])
      ], true);
    case "run_codelet":
      return cliCommand(["run", action.codeletId, ...action.args], false);
    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }
}

export async function runInteractiveShell(options) {
  const rl = readline.createInterface({ input, output });
  options.rl = rl;
  options.blacklist = new Set();
  options.history = [];
  try {
    const primary = options.planners.planners[0] ?? options.planners.heuristic;
    output.write(`ai-workflow shell\n${renderPlannerLine(primary)}\nType 'help' for examples. Type 'exit' to quit.\n\n`);

    if (!options.planners.planners.length) {
      output.write([
        "Planner note: No AI models configured. Shell is running in limited regex-only mode.",
        "To enable full agentic reasoning, you can:",
        "- Configure local Ollama hardware: \`set-ollama-hw --global\`",
        "- Set up a high-power remote provider (recommended): \`set-provider-key google\` (Gemini)",
        ""
      ].join("\n"));
    }

    for (const warning of primary.configWarnings ?? []) {
      output.write(`config warning: ${warning}\n`);
    }
    if ((primary.configWarnings ?? []).length) {
      output.write("\n");
    }
    if (primary.needsHardwareHint) {
      output.write([
        "Planner note: Ollama hardware is not configured, so the shell is defaulting to a smaller model.",
        "You can configure it now, or later with \`ai-workflow set-ollama-hw\`.",
        ""
      ].join("\n"));
      const answer = (await promptShellQuestion(rl, "Configure Ollama hardware now? [Y/n] ") ?? "").trim().toLowerCase();
      if (!answer || answer === "y" || answer === "yes") {
        rl.pause();
        await configureOllamaHardware({
          root: options.root,
          interactive: true,
          rl
        });
        rl.resume();
        options.planners = await resolveShellPlanners(options.root);
        output.write(`\nUpdated planner: ${renderPlannerLine(options.planners.planners[0] ?? options.planners.heuristic)}\n\n`);
      } else {
        output.write("\n");
      }
    }
    while (true) {
      try {
        const answer = await promptShellQuestion(rl, "ai-workflow> ");
        if (answer == null) {
          break;
        }
        const line = answer.trim();
        if (!line) {
          continue;
        }
        const result = await runShellTurn(line, options);
        if (result.plan.kind === "exit") {
          break;
        }

        // Maintain history (max 10 messages)
        options.history.push({ role: "user", content: line });
        if (result.plan.reply) {
          options.history.push({ role: "ai", content: result.plan.reply });
        } else if (result.plan.actions?.length) {
          options.history.push({ role: "ai", content: `Executing plan: ${result.plan.actions.map(a => a.type).join(", ")}` });
        }
        if (options.history.length > 10) options.history = options.history.slice(-10);

        const mutated = result.executed.some(e => e.mutation);
        if (mutated) {
          options.planners = await resolveShellPlanners(options.root);
          if (!options.json) {
            output.write(`Planners updated: ${renderPlannerLine(options.planners.planners[0] ?? options.planners.heuristic)}\n\n`);
          }
        }

        if (options.json) {
          output.write(`${JSON.stringify(result, null, 2)}\n`);
          continue;
        }
        renderHumanShellResult(result);
      } catch (error) {
        output.write(`shell error: ${error?.message ?? String(error)}\n`);
        continue;
      }
    }
  } finally {
    rl.close();
  }
  return 0;
}

async function confirmPlan(plan, options) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }
  const rl = options.rl ?? readline.createInterface({ input, output });
  try {
    output.write(`Planned actions:\n${renderActionList(plan.actions)}\n`);
    const answer = (await promptShellQuestion(rl, "Run mutating actions? [y/N] ") ?? "").trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    if (!options.rl) {
      rl.close();
    }
  }
}

async function promptShellQuestion(rl, prompt) {
  if (rl.closed) {
    return null;
  }

  const closePromise = once(rl, "close").then(() => null);
  try {
    return await Promise.race([
      rl.question(prompt),
      closePromise
    ]);
  } catch (error) {
    if (error?.code === "ERR_USE_AFTER_CLOSE") {
      return null;
    }
    throw error;
  }
}

async function runShellActionDirect(action, options) {
  switch (action.type) {
    case "project_summary":
      return formatProjectSummary(await getProjectSummary({ projectRoot: options.root }), options.json);
    case "metrics":
      return formatProjectMetrics(await getProjectMetrics({ projectRoot: options.root }), options.json);
    case "doctor": {
      const report = await buildDoctorReport({ root: options.root });
      return options.json
        ? `${JSON.stringify(report, null, 2)}\n`
        : `${renderDoctorReport(report)}\n`;
    }
    case "audit_architecture": {
      const findings = await auditArchitecture(options.root);
      if (options.json) return `${JSON.stringify(findings, null, 2)}\n`;
      if (!findings.length) return "No architectural violations detected. Wiring looks clean!\n";
      return `Architectural Audit Report:\n${findings.map(f => `- [${f.severity.toUpperCase()}] ${f.type}: ${f.summary} (Subject: ${f.subject})`).join("\n")}\n`;
    }
    case "sync":
      return formatSyncResult(await syncProject({ projectRoot: options.root }), options.json);
    case "search":
      return formatSearchResults(await searchProject({ projectRoot: options.root, query: action.query }), options.json);
    case "route":
      return formatRoute(await routeTask({ root: options.root, taskClass: action.taskClass }), options.json);
    case "telegram_preview": {
      const preview = await buildTelegramPreview({ projectRoot: options.root });
      return options.json ? `${JSON.stringify(preview, null, 2)}\n` : preview.text;
    }
    case "set_ollama_hw": {
      const result = await configureOllamaHardware({
        root: options.root,
        global: Boolean(action.global),
        interactive: true
      });
      return options.json ? `${JSON.stringify(result, null, 2)}\n` : renderConfiguredOllamaHardware(result);
    }
    case "set_provider_key": {
      const rl = options.rl ?? readline.createInterface({ input, output });
      const prompt = action.providerId === "google"
        ? `Enter Gemini API key (from https://aistudio.google.com/): `
        : `Enter ${action.providerId} API key: `;
      const key = (await promptShellQuestion(rl, prompt) ?? "").trim();
      if (!options.rl) {
        rl.close();
      }
      if (!key) {
        throw new Error("API key is required.");
      }
      const filePath = getGlobalConfigPath();
      await writeConfigValue(filePath, `providers.${action.providerId}.apiKey`, key);
      return `Successfully saved API key for ${action.providerId} to global config.\n`;
    }
    case "config": {
      const scope = action.global ? "global" : "project";
      const configPath = action.global ? getGlobalConfigPath() : getProjectConfigPath(options.root);
      if (action.action === "get") {
        const config = await readConfig(configPath);
        const resolved = getConfigValue(config, action.key);
        return resolved === undefined ? "undefined\n" : (typeof resolved === "string" ? `${resolved}\n` : `${JSON.stringify(resolved, null, 2)}\n`);
      }
      if (action.action === "set") {
        if (!action.key || action.value === undefined) throw new Error("Key and value required.");
        const config = await writeConfigValue(configPath, action.key, action.value);
        return `${JSON.stringify({ path: configPath, value: getConfigValue(config, action.key) }, null, 2)}\n`;
      }
      if (action.action === "unset") {
        if (!action.key) throw new Error("Key required.");
        await removeConfigValue(configPath, action.key);
        return `Removed ${action.key} from ${scope} config.\n`;
      }
      if (action.action === "clear") {
        await removeConfigFile(configPath);
        return `Cleared ${scope} config.\n`;
      }
      throw new Error(`Unsupported config action: ${action.action}`);
    }
    case "add_note": {
      const note = await addManualNote({
        projectRoot: options.root,
        note: {
          noteType: action.noteType,
          body: action.body,
          filePath: action.filePath,
          line: action.line
        }
      });
      return options.json ? `${JSON.stringify(note, null, 2)}\n` : `${note.noteType} ${note.body}\n`;
    }
    case "create_ticket": {
      const entity = buildTicketEntity({
        id: action.id,
        title: action.title,
        lane: action.lane ?? "Todo",
        epicId: action.epicId,
        summary: action.summary ?? ""
      });
      const ticket = await createTicket({ projectRoot: options.root, entity });
      return options.json ? `${JSON.stringify(ticket, null, 2)}\n` : `${ticket.id} ${ticket.title} [${ticket.lane}]\n`;
    }
    case "extract_ticket":
      return runCodeletById("ticket", ["--id", action.ticketId], options);
    case "decompose_ticket": {
      const ticket = await withWorkflowStore(options.root, async (store) => store.getEntity(action.ticketId));
      if (!ticket) throw new Error(`Ticket ${action.ticketId} not found.`);
      const plan = await decomposeTicket(ticket, { root: options.root });
      return options.json 
        ? `${JSON.stringify(plan, null, 2)}\n` 
        : `Decomposition plan for ${action.ticketId}:\n${plan.map((t, i) => `${i + 1}. [${t.class}] ${t.summary}${t.file ? ` (${t.file})` : ""}`).join("\n")}\n`;
    }
    case "ideate_feature":
      return ideateFeature(action.intent, options);
    case "sweep_bugs":
      return sweepBugs(options);
    case "extract_guidelines":
      return runCodeletById("guidelines", [
        ...(action.ticketId ? ["--ticket", action.ticketId] : []),
        ...(action.changed ? ["--changed"] : [])
      ], options);
    case "run_review":
      return runCodeletById("review", [], options);
    case "run_codelet":
      return runCodeletById(action.codeletId, action.args, options);
    default:
      throw new Error(`No direct runner for action type: ${action.type}`);
  }
}

async function runCodeletById(codeletId, args, options) {
  const codelet = [...options.plannerContext.projectCodelets, ...options.plannerContext.toolkitCodelets]
    .find((item) => item.id === codeletId);
  if (!codelet?.entry) {
    throw new Error(`Codelet entry not found for ${codeletId}`);
  }

  if (!options.json) {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [codelet.entry, ...args], {
        cwd: options.root,
        stdio: "inherit"
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if ((code ?? 1) === 0) {
          resolve();
        } else {
          reject(new Error(`Codelet ${codeletId} exited with code ${code ?? 1}`));
        }
      });
    });
    return STREAMED_STDIO;
  }

  const { stdout, stderr } = await execFileAsync(process.execPath, [codelet.entry, ...args], {
    cwd: options.root,
    maxBuffer: 16 * 1024 * 1024
  });
  return `${stdout}${stderr}`.trimEnd() + "\n";
}

function emitShellResult(result, options) {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.executed.every((item) => item.ok !== false) ? 0 : 1;
  }

  renderHumanShellResult(result);
  return result.executed.every((item) => item.ok !== false) ? 0 : 1;
}

function renderHumanShellResult(result) {
  if (!result.preRendered && result.plan.planner) {
    output.write(`${renderPlannerLine(result.plan.planner)}\n`);
  }
  if (result.plan.kind === "reply") {
    output.write(`${String(result.plan.reply ?? "").trim()}\n`);
    return;
  }

  if (!result.preRendered) {
    output.write(`${renderActionList(result.plan.actions)}\n`);
  }
  for (const execution of result.executed) {
    const streamText = execution.ok ? execution.stdout : `${execution.stdout}${execution.stderr}`;
    const rendered = String(streamText ?? "").trim();
    if (rendered === STREAMED_STDIO) {
      continue;
    }
    output.write(`\n> ${execution.command}\n`);
    if (rendered && rendered !== STREAMED_STDIO) {
      output.write(`${rendered}\n`);
    } else if (!execution.ok) {
      output.write("Command failed.\n");
    }
  }
  if (result.recovery) {
    output.write(`\nAI recovery:\n${renderRecovery(result.recovery)}`);
  }
}

function renderActionList(actions) {
  return actions.map((action, index) => {
    const compiled = compileShellAction(action, { json: false });
    return `${index + 1}. ${compiled.display}${compiled.mutation ? " [mutates state]" : ""}`;
  }).join("\n");
}

function renderPlannerLine(planner) {
  if (!planner) {
    return "planner: unavailable";
  }

  if (planner.mode === "ollama") {
    return `planner: ollama:${planner.modelId} @ ${planner.host ?? "default"} (${planner.reason})`;
  }

  if (planner.providerId && planner.modelId) {
    return `planner: ${planner.providerId}:${planner.modelId} (${planner.reason})`;
  }

  return `planner: ${planner.mode} (${planner.reason})`;
}

function buildActionCatalog(plannerContext) {
  const lines = [
    "- project_summary: project summary/status",
    "- doctor: local diagnostics and provider visibility",
    "- sync: sync the workflow DB",
    "- run_review: run the review summary codelet",
    "- search: search indexed project data",
    "- extract_ticket: extract a specific ticket",
    "- extract_guidelines: extract task guidance",
    "- route: show provider/model routing for a task class",
    "- telegram_preview: render Telegram status text",
    "- add_note: add a project note",
    "- create_ticket: create a workflow ticket",
    "- run_codelet: execute a known codelet by id"
  ];

  lines.push("");
  lines.push("Known codelets:");
  for (const codelet of [...plannerContext.toolkitCodelets, ...plannerContext.projectCodelets]) {
    lines.push(`- ${codelet.id}: ${codelet.summary}`);
  }

  return lines.join("\n");
}

function cliCommand(args, mutation) {
  return {
    args,
    mutation,
    display: `ai-workflow ${args.map(shellQuote).join(" ")}`
  };
}

function shellQuote(value) {
  const text = String(value);
  return /[^A-Za-z0-9_./:-]/.test(text) ? JSON.stringify(text) : text;
}

function isMutatingAction(action) {
  return MUTATING_ACTIONS.has(action.type);
}

function normalizeTaskClass(value, plannerContext) {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/\s+/g, "-");
  const tasks = plannerContext?.knowledge?.tasks ?? [];
  return tasks.includes(normalized) ? normalized : "classification";
}

function normalizeNoteType(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  return NOTE_TYPES.includes(normalized) ? normalized : null;
}

function requireTicketId(value) {
  const id = String(value ?? "").trim().toUpperCase();
  if (!/^[A-Z]+-\d+$/.test(id)) {
    throw new Error(`invalid ticket id: ${value}`);
  }
  return id;
}

function actionPlan(actions, confidence, reason) {
  return {
    kind: "plan",
    actions,
    confidence,
    reason
  };
}

function replyPlan(reply, confidence = 1, reason = "Reply only.") {
  return {
    kind: "reply",
    actions: [],
    reply,
    confidence,
    reason
  };
}

async function safeGetProjectSummary(root) {
  try {
    return await getProjectSummary({ projectRoot: root });
  } catch {
    return null;
  }
}

function renderShellHelp(plannerContext) {
  const examples = [
    "summary",
    "sync and show review hotspots",
    "search router race condition",
    "ticket TKT-001",
    "route review",
    "set-ollama-hw --global",
    "add bug note body \"shared router can race\" file src/core/router.js line 12"
  ];
  const codelets = plannerContext.toolkitCodelets.map((item) => item.id).join(", ");
  return [
    "Examples:",
    ...examples.map((item) => `- ${item}`),
    "",
    `Known codelets: ${codelets || "none"}`
  ].join("\n");
}

function renderConfiguredOllamaHardware(result) {
  const lines = [
    `Configured Ollama hardware in ${result.scope} config.`,
    `Hardware class: ${result.applied.hardwareClass ?? "unchanged"}`,
    `Max model size: ${result.applied.maxModelSizeB != null ? `${result.applied.maxModelSizeB}B` : "unchanged"}`
  ];
  if (result.applied.plannerModel) {
    lines.push(`Planner model: ${result.applied.plannerModel}`);
  }
  return `${lines.join("\n")}\n`;
}

async function attemptShellRecovery({ inputText, plan, failed, options }) {
  try {
    const prompt = [
      "The previous ai-workflow action failed. Produce JSON only.",
      "Choose one of:",
      "- kind=reply with a short helpful explanation",
      "- kind=plan with at most 2 alternative actions from the same allowed shell action schema",
      "",
      `Original user request: ${JSON.stringify(inputText)}`,
      `Previous action: ${JSON.stringify(failed.action)}`,
      `Failed command: ${failed.command}`,
      `Error: ${failed.stderr || "unknown error"}`,
      "",
      "Do not repeat the same failing action unless you changed its arguments."
    ].join("\n");

    const completion = await generateWithOllama({
      host: options.planner.host,
      model: options.planner.modelId,
      system: "You are a strict recovery planner for ai-workflow. Return JSON only.",
      prompt,
      format: "json"
    });
    const recoveredPlan = validateShellPlan(JSON.parse(completion.response), options.plannerContext);
    if (recoveredPlan.kind !== "plan") {
      return {
        kind: "reply",
        reply: recoveredPlan.reply ?? "Recovery planner could not find a safer action."
      };
    }

    const executed = [];
    for (const action of recoveredPlan.actions) {
      executed.push(await executeShellAction(action, {
        ...options,
        yes: true
      }));
    }

    return {
      kind: "plan",
      plan: recoveredPlan,
      executed
    };
  } catch (error) {
    return {
      kind: "reply",
      reply: `Recovery attempt failed: ${error?.message ?? String(error)}`
    };
  }
}

function renderRecovery(recovery) {
  if (recovery.kind === "reply") {
    return `${recovery.reply}\n`;
  }

  const lines = [];
  lines.push(renderActionList(recovery.plan.actions));
  for (const execution of recovery.executed) {
    const rendered = String(execution.ok ? execution.stdout : `${execution.stdout}${execution.stderr}`).trim();
    if (rendered === STREAMED_STDIO) {
      continue;
    }
    lines.push("");
    lines.push(`> ${execution.command}`);
    lines.push(rendered || (execution.ok ? "OK" : "Command failed."));
  }
  return `${lines.join("\n")}\n`;
}

export function chooseShellPlannerModel(ollamaProvider) {
  const models = Array.isArray(ollamaProvider?.models) ? [...ollamaProvider.models] : [];
  if (!models.length) {
    throw new Error("No Ollama models available for shell planning.");
  }

  const pinned = ollamaProvider.plannerModel
    ? models.find((model) => model.id === ollamaProvider.plannerModel)
    : null;
  if (pinned) {
    return {
      ...pinned,
      needsHardwareHint: false,
      reason: `Pinned shell planner model from config.`
    };
  }

  const qualityCap = ollamaProvider.plannerMaxQuality ?? defaultPlannerQualityCap(ollamaProvider.hardwareClass);
  const sizeCap = ollamaProvider.maxModelSizeB ?? defaultPlannerSizeCap(ollamaProvider.hardwareClass);
  const sizeFiltered = models.filter((model) => model.sizeB == null || sizeCap == null || model.sizeB <= sizeCap);
  const qualityFiltered = sizeFiltered.filter((model) => qualityRank(model.quality) <= qualityRank(qualityCap));
  const pool = qualityFiltered.length
    ? qualityFiltered
    : sizeFiltered.length
      ? sizeFiltered
      : models;

  pool.sort((left, right) =>
    qualityRank(left.quality) - qualityRank(right.quality)
    || (left.sizeB ?? Number.POSITIVE_INFINITY) - (right.sizeB ?? Number.POSITIVE_INFINITY)
    || left.id.localeCompare(right.id)
  );

  const selected = pool[0];
  const needsHardwareHint = !ollamaProvider.hardwareClass && !ollamaProvider.maxModelSizeB && !ollamaProvider.plannerMaxQuality;
  const reasonParts = [];
  if (needsHardwareHint) {
    reasonParts.push("hardware unknown; defaulting to a smaller planner model");
  } else if (ollamaProvider.hardwareClass) {
    reasonParts.push(`hardware class ${ollamaProvider.hardwareClass}`);
  }
  if (sizeCap != null) {
    reasonParts.push(`planner size cap ${sizeCap}B`);
  }
  if (qualityCap) {
    reasonParts.push(`planner quality cap ${qualityCap}`);
  }
  return {
    ...selected,
    needsHardwareHint,
    reason: reasonParts.join(", ") || "using the lightest suitable local planner model"
  };
}

function defaultPlannerSizeCap(hardwareClass) {
  switch (hardwareClass) {
    case "tiny":
      return 4;
    case "small":
      return 8;
    case "medium":
      return 14;
    case "large":
      return 32;
    default:
      return 8;
  }
}

function defaultPlannerQualityCap(hardwareClass) {
  switch (hardwareClass) {
    case "large":
      return "high";
    case "medium":
      return "medium";
    case "small":
    case "tiny":
      return "low";
    default:
      return "medium";
  }
}

function qualityRank(value) {
  switch (value) {
    case "high":
      return 3;
    case "medium":
      return 2;
    default:
      return 1;
  }
}

function formatProjectSummary(summary, json) {
  if (json) {
    return `${JSON.stringify(summary, null, 2)}\n`;
  }
  return [
    `Files indexed: ${summary.fileCount}`,
    `Symbols indexed: ${summary.symbolCount}`,
    `Notes tracked: ${summary.noteCount}`,
    `Tickets: ${summary.activeTickets.length}`,
    `Candidates: ${summary.candidates.length}`
  ].join("\n") + "\n";
}

function formatProjectMetrics(metrics, json) {
  if (json) {
    return `${JSON.stringify(metrics, null, 2)}\n`;
  }
  const lines = [
    `Total AI Calls: ${metrics.totalCalls}`,
    `Success Rate: ${metrics.successRate}%`,
    `Avg Latency: ${metrics.avgLatencyMs}ms`,
    `Total Tokens: ${metrics.totalPromptTokens + metrics.totalCompletionTokens} (P: ${metrics.totalPromptTokens} / C: ${metrics.totalCompletionTokens})`,
    "",
    "Usage by Model:"
  ];
  for (const m of metrics.byModel) {
    lines.push(`- ${m.model_id}: ${m.count} calls, ${Math.round(m.success_rate)}% success, ${Math.round(m.avg_latency)}ms avg`);
  }
  return lines.join("\n") + "\n";
}

function formatSyncResult(result, json) {
  if (json) {
    return `${JSON.stringify(result, null, 2)}\n`;
  }
  return [
    `DB: ${result.dbPath}`,
    `Indexed files: ${result.indexedFiles}`,
    `Symbols: ${result.indexedSymbols}`,
    `Claims: ${result.indexedClaims}`,
    `Notes: ${result.indexedNotes}`,
    `Imported tickets: ${result.importSummary.importedTickets}`,
    `Reviewed candidates: ${result.lifecycle.reviewed.length}`
  ].join("\n") + "\n";
}

function formatSearchResults(results, json) {
  if (json) {
    return `${JSON.stringify(results, null, 2)}\n`;
  }
  return `${results.map((item) => `- [${item.scope}] ${item.title}`).join("\n")}\n`;
}

function formatRoute(route, json) {
  if (json) {
    return `${JSON.stringify(route, null, 2)}\n`;
  }
  if (!route.recommended) {
    return `No route available for ${route.taskClass}\n`;
  }
  return `${route.recommended.providerId}:${route.recommended.modelId}\n${route.recommended.reason}\n`;
}

const SHELL_HELP = `
Usage:
  ai-workflow shell
  ai-workflow shell <request...> [--yes] [--plan-only] [--no-ai] [--json]

Notes:
  - The shell turns natural-language requests into workflow actions.
  - It uses a high-power remote planner (Gemini/OpenAI) if available, falling back to local Ollama.
  - It can now "chat" and answer general project questions if a smart model is configured.
  - Mutating actions ask for confirmation unless --yes is passed.

Examples:
  - "are we synched?"
  - "what tickets are in Todo?"
  - "sync and show review hotspots"
  - "set-provider-key google"
`;
