import path from "node:path";
import process from "node:process";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { getToolkitRoot, listToolkitCodelets } from "./codelets.mjs";
import { listProjectCodelets } from "./project-codelets.mjs";
import { routeTask } from "../../core/services/router.mjs";
import { discoverProviderState, generateCompletion, generateWithOllama } from "../../core/services/providers.mjs";
import { decomposeTicket, ideateFeature, sweepBugs } from "../../core/services/orchestrator.mjs";
import { auditArchitecture } from "../../core/services/critic.mjs";
import { addManualNote, createTicket, getProjectMetrics, getProjectSummary, getSmartProjectStatus, recordMetric, searchProject, syncProject, withWorkflowStore } from "../../core/services/sync.mjs";
import { buildTicketEntity } from "../../core/services/projections.mjs";
import { buildTelegramPreview } from "../../core/services/telegram.mjs";
import { parseArgs, printAndExit } from "../../runtime/scripts/codex-workflow/lib/cli.mjs";
import { getConfigValue, getGlobalConfigPath, getProjectConfigPath, readConfig, removeConfigFile, removeConfigValue, writeConfigValue } from "./config-store.mjs";
import { buildDoctorReport, renderDoctorReport } from "./doctor.mjs";
import { configureOllamaHardware } from "./ollama-hw.mjs";

const execFileAsync = promisify(execFile);
const STREAMED_STDIO = "__STREAMED_STDIO__";

const MUTATING_ACTIONS = new Set(["sync", "add_note", "create_ticket", "set_ollama_hw", "ideate_feature", "sweep_bugs", "ingest_artifact"]);
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
  const args = parseShellArgs(rest);
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

function parseShellArgs(argv) {
  const args = { _: [] };
  const booleanFlags = new Set(["help", "json", "yes", "plan-only", "no-ai"]);
  for (const value of argv) {
    if (!String(value).startsWith("--")) {
      args._.push(value);
      continue;
    }
    const key = String(value).slice(2);
    if (booleanFlags.has(key)) {
      args[key] = true;
      continue;
    }
    args._.push(value);
  }
  return args;
}

export async function buildShellContext(root = process.cwd()) {
  const [toolkitCodelets, projectCodelets, summary, providerState, smartStatus] = await Promise.all([
    listToolkitCodelets(),
    listProjectCodelets(root),
    safeGetProjectSummary(root),
    discoverProviderState({ root }),
    getSmartProjectStatus({ projectRoot: root }).catch(() => "Status unavailable.")
  ]);

  const [mission, kanban, gemini, guidelines] = await Promise.all([
    readFileIfExists(path.resolve(root, "MISSION.md")),
    readFirstExisting([
      path.resolve(root, ".gemini", "KANBAN.md"),
      path.resolve(root, ".gemini", "kanban.md"),
      path.resolve(root, "KANBAN.md"),
      path.resolve(root, "kanban.md")
    ]),
    readFirstExisting([
      path.resolve(root, ".gemini", "GEMINI.md"),
      path.resolve(root, ".gemini", "gemini.md"),
      path.resolve(root, "GEMINI.md"),
      path.resolve(root, "gemini.md")
    ]),
    readFirstExisting([
      path.resolve(root, "project-guidelines.md"),
      path.resolve(root, "templates", "project-guidelines.md")
    ])
  ]);

  return {
    root,
    toolkitCodelets,
    projectCodelets,
    summary,
    smartStatus,
    providerState,
    knowledge: providerState.knowledge,
    mission,
    kanban,
    gemini,
    guidelines
  };
}

async function readFileIfExists(filePath) {
  try {
    const { readFile } = await import("node:fs/promises");
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function readFirstExisting(filePaths) {
  for (const filePath of filePaths) {
    const content = await readFileIfExists(filePath);
    if (content) {
      return content;
    }
  }
  return null;
}

export async function resolveShellPlanners(root = process.cwd()) {
  const route = await routeTask({ root, taskClass: "shell-planning" });
  const planners = [];
  const providers = route.providers ?? {};
  const configuredRemoteAvailable = Object.values(providers).some((provider) => !provider.local && provider.available && provider.configured);

  const ollamaProvider = providers.ollama;
  if (ollamaProvider?.available && !configuredRemoteAvailable) {
    try {
      const localShellModel = chooseShellPlannerModel(ollamaProvider);
      planners.push({
        mode: "ollama",
        providerId: "ollama",
        modelId: localShellModel.id,
        host: ollamaProvider.host,
        needsHardwareHint: Boolean(localShellModel.needsHardwareHint),
        reason: localShellModel.reason ?? "local shell fallback"
      });
    } catch {
      // keep route-derived planners only
    }
  }

  if (route.recommended) {
    planners.push(mapRouteCandidateToPlanner(route.recommended, providers));
  }

  for (const candidate of route.fallbackChain) {
    planners.push(mapRouteCandidateToPlanner(candidate, providers));
  }

  const deduped = [];
  const seen = new Set();
  for (const planner of planners) {
    const key = `${planner.providerId}:${planner.modelId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(planner);
  }

  return {
    planners: deduped,
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
  const segments = inputText.split(/\s+then\s+|\s+and\s+/i);
  if (segments.length > 1) {
    const plans = await Promise.all(segments.map(s => planSingleRequest(s.trim(), options)));
    const canSafelyCombine = plans.every((plan) => {
      if (!plan) return false;
      if ((plan.confidence ?? 0) < 0.7) return false;
      if (plan.kind === "reply" && /needs the AI planner or a more direct phrasing/i.test(String(plan.reply ?? ""))) {
        return false;
      }
      return true;
    });
    if (!canSafelyCombine) {
      return planSingleRequest(inputText, options);
    }
    const combinedActions = plans.flatMap(p => p.actions || []);
    const confidence = plans.reduce((acc, p) => acc * p.confidence, 1);
    
    if (combinedActions.length) {
      return {
        kind: "plan",
        actions: combinedActions.slice(0, 5), // Limit to 5 combined
        graph: buildActionGraph(combinedActions.slice(0, 5)),
        confidence,
        reason: `Combined multi-intent plan: ${plans.map(p => p.reason).join("; ")}`,
        strategy: plans.map(p => p.strategy).filter(Boolean).join(" Then ")
      };
    }

    if (plans.every((plan) => plan.kind === "reply")) {
      const combinedReply = plans
        .map((plan) => String(plan.reply ?? "").trim())
        .filter(Boolean)
        .join("\n\n");
      return {
        kind: "reply",
        actions: [],
        graph: buildActionGraph([]),
        confidence,
        reason: `Combined multi-intent reply: ${plans.map((plan) => plan.reason).join("; ")}`,
        reply: combinedReply || "I need a clearer request."
      };
    }
  }

  return planSingleRequest(inputText, options);
}

async function planSingleRequest(inputText, options) {
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
        if (!options.json && shouldSurfacePlannerFailure(inputText, heuristic)) {
          output.write(`${renderPlannerFailure(planner, error)}\n`);
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

function shouldSurfacePlannerFailure(inputText, heuristic) {
  const text = String(inputText ?? "").trim().toLowerCase();
  if (heuristic?.kind === "reply") {
    return false;
  }
  if (/\b(route|provider|model|quota|config|doctor|diagnostics)\b/.test(text)) {
    return true;
  }
  return false;
}

export function planShellRequestHeuristically(inputText, plannerContext) {
  const text = String(inputText ?? "").trim();
  const lower = text.toLowerCase();
  const normalizedQuestion = normalizeConversationText(text);

  if (!text) {
    return replyPlan("Tell me what you want to do. Example: `sync and show review hotspots`.");
  }

  if (["help", "/help", "what can you do", "commands"].includes(normalizedQuestion)) {
    return replyPlan(renderShellHelp(plannerContext));
  }

  const contextualReply = buildContextualShellReply(text, plannerContext);
  if (contextualReply) {
    return contextualReply;
  }

  if (["exit", "quit", "/exit", "/quit"].includes(lower)) {
    return {
      kind: "exit",
      actions: [],
      confidence: 1,
      reason: "Explicit exit request."
    };
  }

  if (/^(status|summary|project summary|show status|show tickets|list tickets)$/i.test(text)) {
    return actionPlan([{ type: "project_summary" }], 0.98, "Explicit summary/status/tickets request.");
  }

  if (/^(metrics|stats|usage)$/i.test(text)) {
    return actionPlan([{ type: "metrics" }], 0.98, "Usage metrics request.");
  }

  if (/^(version|--version|show version)$/i.test(text)) {
    return actionPlan([{ type: "version" }], 0.99, "Explicit version request.");
  }

  if (
    /\b(?:what|which|show|list)\b.*\b(?:ai\s+)?providers?\b/.test(lower) ||
    /\bproviders?\b.*\b(?:connected|configured|available|active|status)\b/.test(lower)
  ) {
    return actionPlan([{ type: "provider_status" }], 0.99, "Explicit provider status request.");
  }

  if (/^(connect|login|setup)\s+([a-zA-Z0-9_-]+)$/i.test(text)) {
    const match = text.match(/^(connect|login|setup)\s+([a-zA-Z0-9_-]+)$/i);
    return actionPlan([{ type: "provider_connect", providerId: match[2] }], 0.98, "Explicit provider connect request.");
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

export async function summarizeHistory(history) {
  if (!history.length) return { recentMemory: null, longTermMemorySummary: null };

  const recent = history.slice(-2);
  const older = history.slice(0, -2);

  const recentMemory = recent.map(h => `${h.role === "user" ? "User" : "Brain"}: ${h.content}`).join("\n");
  
  if (!older.length) return { recentMemory, longTermMemorySummary: null };

  const longTermMemorySummary = older.map(h => `- ${h.role === "user" ? "User" : "Brain"}: ${h.content.slice(0, 200)}${h.content.length > 200 ? "..." : ""}`).join("\n");

  return { recentMemory, longTermMemorySummary };
}

export async function planShellRequestWithAgent(inputText, options) {
  const catalog = buildActionCatalog(options.plannerContext);
  const { summary = {}, smartStatus, mission, kanban, gemini, guidelines } = options.plannerContext;
  const history = options.history ?? [];

  // Memory Strategy:
  // 1. One interaction back (User + AI Result)
  // 2. Summary of older history
  const { recentMemory, longTermMemorySummary } = await summarizeHistory(history);

  const system = [
    "You are the conversational coding assistant inside ai-workflow.",
    "Behave like a strong engineer with tools, not like a command classifier.",
    "Your goal is to satisfy the developer's intent with precision, initiative, and clear judgment.",
    "",
    "## Operating Style",
    "- Start from the user's real intent, not the nearest command shape.",
    "- If a direct answer is possible, prefer `kind=reply`.",
    "- Use actions when they materially improve the answer or are required to carry out work.",
    "- Ask for clarification only when it is genuinely blocking.",
    "- Hide tool mechanics unless they matter to the user.",
    "",
    "## Tool Judgment",
    "- To pull specific ticket info, use `extract_ticket` with the ID. If you don't have the ID, use `list_tickets` first.",
    "- To ensure fresh data, use `sync` when stale state is the blocker.",
    "- To investigate project structure, use `search` or `project_summary`.",
    "- For direct questions, you may answer with `kind=reply` after using tools, but synthesize the answer instead of dumping raw data.",
    "- Never invent facts. If a ticket or file is not in context, find it or say so.",
    "",
    "## System Philosophy",
    "- We use a 'Database-First' architecture where the Kanban and Epics are the source of truth.",
    "- We perform 'Surgical Strikes' using SEARCH/REPLACE blocks (in the main OS) to minimize token usage.",
    "",
    "## Project Foundation",
    mission ? `### MISSION.md\n${mission}\n` : "",
    gemini ? `### GEMINI.md\n${gemini}\n` : "",
    kanban ? `### KANBAN.md\n${kanban}\n` : "",
    guidelines ? `### GUIDELINES\n${guidelines}\n` : "",
    "",
    "## Project Current Status (Smart Summary)",
    smartStatus || "Status unavailable.",
    "",
    "## Available Actions (Your Capabilities):",
    catalog,
    "",
    "## Interaction Rules",
    "- Vague Request: Use `kind=reply` to ask clarifying questions. Reference existing state when helpful.",
    "- Multi-step Strategy: If a complex task is requested, use `strategy` to explain the next concrete approach, and `actions` for immediate steps.",
    "- Directives: If the user says 'go ahead', 'do it', or 'proceed', execute the next logical steps of your previously proposed strategy.",
    "- Sound like a serious assistant. Do not sound like a router, planner, or bureaucrat.",
    "- JSON only: Your output must be valid JSON matching the schema.",
  ].join("\n");

  const memoryBlock = [
    longTermMemorySummary ? `### Contextual Summary (Past Interactions):\n${longTermMemorySummary}\n` : "",
    recentMemory ? `### Recent Interaction (Last Turn):\n${recentMemory}\n` : ""
  ].filter(Boolean).join("\n");

  const prompt = [
    memoryBlock,
    "## Allowed JSON Schema:",
    JSON.stringify({
      kind: "plan|reply|exit",
      confidence: 0.8,
      reason: "Your internal strategic reasoning (mandatory)",
      strategy: "The long-term plan or next steps for the developer",
      reply: "human-friendly message (mandatory if kind=reply, optional if kind=plan)",
      actions: [{
        type: "project_summary|list_tickets|next_ticket|metrics|audit_architecture|sync|run_review|search|extract_ticket|decompose_ticket|ideate_feature|sweep_bugs|ingest_artifact|extract_guidelines|route|run_dynamic_codelet|telegram_preview|add_note|create_ticket|run_codelet|provider_connect|reprofile|set_provider_key",
        query: "for search",
        ticketId: "for extract_ticket/decompose_ticket/extract_guidelines",
        intent: "for ideate_feature",
        filePath: "for ingest_artifact/add_note",
        code: "for run_dynamic_codelet (JavaScript snippet)",
        providerId: "for provider_connect/set_provider_key",
        changed: true,
        taskClass: "for route",
        noteType: "NOTE|TODO|FIXME|HACK|BUG|RISK",
        body: "for add_note",
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
    `## Current User Request:\n"${inputText}"\n\nYour Response (JSON):`
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

    let parsed;
    try {
      parsed = JSON.parse(cleanJson);
    } catch {
      return replyPlan(completion.response, 0.5, "Model returned non-JSON text; treating as reply.");
    }

    try {
      return validateShellPlan(parsed, options.plannerContext);
    } catch (validationError) {
      // If the model gave a strategy but failed action mapping, salvage the strategy
      if (parsed && typeof parsed === "object" && parsed.strategy) {
        return {
          ...replyPlan(
            `I understood your strategy: "${parsed.strategy}", but I couldn't map it to CLI actions. Try being more specific or using a different command.`,
            0.4,
            `Validation failed: ${validationError.message}`
          ),
          strategy: String(parsed.strategy)
        };
      }
      throw validationError;
    }
  } catch (error) {
    return replyPlan(completion.response, 0.4, `Structural error: ${error.message}`);
  }
}

export function validateShellPlan(plan, plannerContext) {
  if (!plan || typeof plan !== "object") {
    throw new Error("shell planner returned non-object");
  }

  if (plan.kind === "reply") {
    return {
      ...replyPlan(String(plan.reply ?? "I need a clearer request."), Number(plan.confidence ?? 0.5), String(plan.reason ?? "Planner reply.")),
      strategy: plan.strategy ? String(plan.strategy) : null,
      graph: buildActionGraph([])
    };
  }

  if (plan.kind === "exit") {
    return {
      kind: "exit",
      actions: [],
      confidence: Number(plan.confidence ?? 1),
      reason: String(plan.reason ?? "Planner exit."),
      strategy: plan.strategy ? String(plan.strategy) : null,
      graph: buildActionGraph([])
    };
  }

  const actions = Array.isArray(plan.actions) ? plan.actions.slice(0, 3).map((action) => validateShellAction(action, plannerContext)) : [];
  if (!actions.length) {
    throw new Error("shell planner produced no actions");
  }

  return {
    kind: "plan",
    actions,
    graph: buildActionGraph(actions),
    confidence: Number(plan.confidence ?? 0.7),
    reason: String(plan.reason ?? "Planner produced a valid action plan."),
    strategy: plan.strategy ? String(plan.strategy) : null
  };
}

function shouldAutoNarratePlan(actions, options) {
  if (options.json || options.planOnly || options.yes) {
    return false;
  }
  if (!Array.isArray(actions) || !actions.length) {
    return false;
  }
  return actions.every((action) => !isMutatingAction(action));
}

async function synthesizeShellExecutionReply({ inputText, plan, executed, options, planner }) {
  const graphResults = Array.isArray(executed?.graphNodes)
    ? executed.graphNodes
    : [];
  const renderedOutputs = graphResults
    .map((node) => {
      const item = node.execution;
      if (!item) return null;
      const text = String(item.ok ? item.stdout : `${item.stdout}${item.stderr}`).trim();
      if (!text || text === STREAMED_STDIO) {
        return null;
      }
      return [
        `Node: ${node.id}`,
        `Action: ${item.action.type}`,
        node.dependsOn?.length ? `Depends on: ${node.dependsOn.join(", ")}` : null,
        `Output:\n${text}`
      ].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n\n");

  if (!renderedOutputs) {
    return null;
  }

  if (!planner || options.noAi) {
    return renderFallbackAssistantReply({ inputText, plan, executed });
  }

  try {
    const completion = await generateCompletion({
      providerId: planner.providerId,
      modelId: planner.modelId,
      system: [
        "You are the conversational shell for ai-workflow.",
        "Speak like a strong coding assistant, not a command router.",
        "You already have tool results. Answer the user's request directly and naturally.",
        "Do not mention JSON, schemas, planners, or internal routing.",
        "If tool output is partial or uncertain, say that briefly and concretely.",
        "Keep the answer concise but useful."
      ].join("\n"),
      prompt: [
        `User request:\n${inputText}`,
        "",
        `Action graph:\n${renderActionGraph(plan.graph)}`,
        "",
        `Node results:\n${renderedOutputs}`,
        "",
        "Write the final assistant reply:"
      ].join("\n"),
      config: {
        apiKey: planner.apiKey,
        baseUrl: planner.baseUrl,
        host: planner.host
      }
    });
    const text = String(completion.response ?? "").trim();
    return text || renderFallbackAssistantReply({ inputText, plan, executed });
  } catch {
    return renderFallbackAssistantReply({ inputText, plan, executed });
  }
}

function renderFallbackAssistantReply({ inputText, plan, executed }) {
  const first = executed?.graphNodes?.[0]?.execution ?? executed?.[0];
  const raw = String(first?.ok ? first?.stdout : `${first?.stdout ?? ""}${first?.stderr ?? ""}`).trim();
  if (!raw) {
    return null;
  }
  const actionType = plan.actions[0]?.type;
  if (actionType === "provider_status") {
    return raw;
  }
  if (actionType === "version") {
    return raw;
  }
  if (actionType === "project_summary") {
    return `Here is the current project status:\n${raw}`;
  }
  if (actionType === "metrics") {
    return `Here are the current workflow metrics:\n${raw}`;
  }
  if (actionType === "doctor") {
    return `Here is the current diagnostics report:\n${raw}`;
  }
  return raw;
}

function validateShellAction(action, plannerContext) {
  if (!action || typeof action !== "object") {
    throw new Error("shell action must be an object");
  }

  const type = String(action.type ?? "");
  switch (type) {
    case "project_summary":
    case "list_tickets":
    case "next_ticket":
    case "doctor":
    case "provider_status":
    case "version":
    case "sync":
    case "run_review":
    case "run_dynamic_codelet":
    case "telegram_preview":
    case "reprofile":
      return { type };
    case "provider_connect":
      if (!String(action.providerId ?? "").trim()) {
        throw new Error("provider_connect action requires providerId");
      }
      return { type, providerId: String(action.providerId).trim() };
    case "set_ollama_hw":
      return { type, global: Boolean(action.global) };
    case "search":
      if (!String(action.query ?? "").trim()) {
        throw new Error("search action requires query");
      }
      return { type, query: String(action.query).trim() };
    case "extract_ticket":
      return { type, ticketId: requireTicketId(action.ticketId) };
    case "decompose_ticket":
      return { type, ticketId: requireTicketId(action.ticketId) };
    case "ideate_feature":
      if (!String(action.intent ?? "").trim()) {
        throw new Error("ideate_feature action requires intent");
      }
      return { type, intent: String(action.intent).trim() };
    case "sweep_bugs":
      return { type };
    case "ingest_artifact":
      if (!String(action.filePath ?? "").trim()) {
        throw new Error("ingest_artifact action requires filePath");
      }
      return { type, filePath: String(action.filePath).trim() };
    case "extract_guidelines":
      return {
        type,
        ticketId: action.ticketId ? requireTicketId(action.ticketId) : null,
        changed: Boolean(action.changed)
      };
    case "run_dynamic_codelet":
      if (!String(action.code ?? "").trim()) {
        throw new Error("run_dynamic_codelet action requires code");
      }
      return { type, code: String(action.code).trim() };
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
    executedGraph: null,
    preRendered: false,
    history: options.history ?? [],
    options
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
  const shouldRenderRawPlan = !options.json && !shouldAutoNarratePlan(plan.actions, options);
  if (shouldRenderRawPlan) {
    const activePlanner = plan.planner ?? options.planners.planners[0] ?? options.planners.heuristic;
    output.write(`${renderPlannerLine(activePlanner)}\n${renderActionList(plan.actions)}\n`);
    preRendered = true;
  }

  const executed = [];
  const executedGraph = plan.graph ? await executeActionGraph(plan.graph, options) : { nodes: [], executions: [] };
  for (const node of executedGraph.nodes) {
    if (node.execution) {
      executed.push(node.execution);
    }
  }

  const failed = executed.find((item) => item.ok === false);
  let recovery = null;
  const anyAiPlanner = options.planners.planners[0];
  
  // Item 39: Circuit Breaker - Prevent infinite retry loops
  options._retryCount = (options._retryCount || 0) + 1;
  if (failed && anyAiPlanner && !options.noAi && options._retryCount <= 2) {
    recovery = await attemptShellRecovery({
      inputText,
      plan,
      failed,
      options,
      planner: anyAiPlanner
    });
  }

  const narrationPlanner = plan.planner?.providerId ? plan.planner : (anyAiPlanner ?? null);
  let assistantReply = null;
  if (!failed && !recovery && shouldAutoNarratePlan(plan.actions, options)) {
    assistantReply = await synthesizeShellExecutionReply({
      inputText,
      plan,
      executed: { graphNodes: executedGraph.nodes, executions: executed },
      options,
      planner: narrationPlanner
    });
  }

  return {
      input: inputText,
      plan,
      executed,
      executedGraph,
      preRendered,
      recovery,
      assistantReply
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
    case "list_tickets":
      return cliCommand(["project", "summary", ...(json ? ["--json"] : [])], false);
    case "next_ticket":
      return cliCommand(["project", "ticket", "next", ...(json ? ["--json"] : [])], false);
    case "metrics":
      return cliCommand(["project", "metrics", ...(json ? ["--json"] : [])], false);
    case "version":
      return cliCommand(["version", ...(json ? ["--json"] : [])], false);
    case "doctor":
      return cliCommand(["doctor", ...(json ? ["--json"] : [])], false);
    case "provider_status":
      return {
        args: [],
        mutation: false,
        display: "show connected provider status"
      };
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
    case "ingest_artifact":
      return cliCommand(["ingest", action.filePath], true);
    case "extract_guidelines":
      return cliCommand([
        "extract",
        "guidelines",
        ...(action.ticketId ? ["--ticket", action.ticketId] : []),
        ...(action.changed ? ["--changed"] : [])
      ], false);
    case "run_dynamic_codelet":
      return {
        args: [],
        mutation: true,
        display: `run dynamic codelet (${(action.code ?? "").length} bytes)`
      };
    case "reprofile":
      return cliCommand(["reprofile", ...(json ? ["--json"] : [])], true);
    case "provider_connect":
      return cliCommand(["provider", "connect", action.providerId], true);
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
    const primary = options.noAi
      ? { ...options.planners.heuristic, mode: "heuristic-forced", reason: "AI planning disabled for this shell session." }
      : options.planners.planners[0] ?? options.planners.heuristic;
    output.write(`ai-workflow shell\n${renderPlannerLine(primary)}\nType 'help' for examples. Type 'exit' to quit.\n\n`);

    if (!options.noAi && !options.planners.planners.length) {
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
    if (!options.noAi && primary.needsHardwareHint) {
      output.write([
        "Planner note: Ollama hardware is not configured, so the shell is defaulting to a smaller model.",
        "You can configure it now, or later with \`ai-workflow set-ollama-hw\`.",
        ""
      ].join("\n"));
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        output.write("\n");
      } else {
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

        // 0. Ensure bidirectional sync so manual edits are ingested and DB changes are projected
        await syncProject({ projectRoot: options.root, writeProjections: true });

        // 1. Refresh context before every turn so the Brain sees the latest state
        options.plannerContext = await buildShellContext(options.root);

        const result = await runShellTurn(line, options);
        if (result.plan.kind === "exit") {
          break;
        }

        // 2. Maintain high-signal history (max 10 messages)
        options.history.push({ role: "user", content: line });
        if (result.plan.reply) {
          options.history.push({ role: "ai", content: result.plan.reply });
        } else if (result.plan.actions?.length) {
          // Include actual command output in history so the Brain "sees" what happened
          const executionSummary = result.executed.map(e => {
            const out = (e.stdout || "").trim();
            const displayOut = out.length > 500 ? out.slice(0, 500) + "... [truncated]" : out;
            return `Action [${e.action.type}] output:\n${displayOut || "(no output)"}`;
          }).join("\n\n");
          
          options.history.push({ 
            role: "ai", 
            content: `Strategy: ${result.plan.strategy || "Execute actions"}\n\n${executionSummary}` 
          });
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
    case "list_tickets":
      return formatProjectSummary(await getProjectSummary({ projectRoot: options.root }), options.json);
    case "next_ticket":
      return runCodeletById("kanban-next", [], options);
    case "metrics":
      return formatProjectMetrics(await getProjectMetrics({ projectRoot: options.root }), options.json);
    case "version": {
      const packageJson = JSON.parse(await readFileIfExists(path.resolve(getToolkitRoot(), "package.json")));
      const payload = {
        name: packageJson.name,
        version: packageJson.version,
        toolkitRoot: getToolkitRoot()
      };
      return options.json
        ? `${JSON.stringify(payload, null, 2)}\n`
        : `${payload.name} ${payload.version}\n${payload.toolkitRoot}\n`;
    }
    case "doctor": {
      const report = await buildDoctorReport({ root: options.root });
      return options.json
        ? `${JSON.stringify(report, null, 2)}\n`
        : `${renderDoctorReport(report)}\n`;
    }
    case "provider_status": {
      const providerState = await discoverProviderState({ root: options.root });
      return options.json
        ? `${JSON.stringify(providerState, null, 2)}\n`
        : `${renderProviderStatus(providerState)}\n`;
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
    case "reprofile":
      await runDoctor({ root: options.root, json: options.json });
      return "";
    case "provider_connect":
      return await handleProviderConnect(action.providerId, { rl: options.rl }).then(code => code === 0 ? "Connected.\n" : "Connection failed.\n");
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
    case "ingest_artifact": {
      const rl = options.rl ?? readline.createInterface({ input, output });
      try {
        const result = await ingestArtifact(path.resolve(options.root, action.filePath), { root: options.root, rl });
        return options.json ? `${JSON.stringify(result, null, 2)}\n` : `Ingested ${action.filePath}: Generated ${result.epic.id} and ${result.tickets.length} tickets.\n`;
      } finally {
        if (!options.rl) rl.close();
      }
    }
    case "extract_guidelines":
      return runCodeletById("guidelines", [
        ...(action.ticketId ? ["--ticket", action.ticketId] : []),
        ...(action.changed ? ["--changed"] : [])
      ], options);
    case "run_dynamic_codelet": {
      const effects = analyzeCodeletSideEffects(action.code);
      if (effects.isMalicious) {
        throw new Error("Execution blocked: Malicious code pattern detected in forged codelet.");
      }
      if (!options.json) {
        output.write(`Side-Effect Analysis: ${formatSideEffects(effects)}\n`);
      }
      const stagedDir = path.resolve(options.root, ".ai-workflow", "staged-codelets");
      const entryPath = path.resolve(stagedDir, `dynamic-${Date.now()}.mjs`);
      const toolkitRoot = getToolkitRoot();
      const sqliteStoreUrl = pathToFileURL(path.resolve(toolkitRoot, "core", "db", "sqlite-store.mjs")).href;
      const syncUrl = pathToFileURL(path.resolve(toolkitRoot, "core", "services", "sync.mjs")).href;
      const source = [
        "/* Responsibility: Dynamic AI-forged codelet for on-the-fly execution.",
        "   Context: This script was forged to satisfy a specific user intent. */",
        "import path from \"node:path\";",
        `import { openWorkflowStore } from ${JSON.stringify(sqliteStoreUrl)};`,
        `import { getProjectSummary } from ${JSON.stringify(syncUrl)};`,
        "",
        "const root = process.cwd();",
        "async function run() {",
        action.code,
        "}",
        "run().catch(err => { console.error(err); process.exit(1); });"
      ].join("\n");
      const { writeFile, mkdir } = await import("node:fs/promises");
      await mkdir(stagedDir, { recursive: true });
      await writeFile(entryPath, source, "utf8");
      return runCodeletById("dynamic", [], { ...options, _dynamicEntry: entryPath });
    }
    case "run_review":
      return runCodeletById("review", [], options);
    case "run_codelet":
      return runCodeletById(action.codeletId, action.args, options);
    default:
      throw new Error(`No direct runner for action type: ${action.type}`);
  }
}

async function runCodeletById(codeletId, args, options) {
  let entry = null;
  if (codeletId === "dynamic" && options._dynamicEntry) {
    entry = options._dynamicEntry;
  } else {
    const codelet = [...options.plannerContext.projectCodelets, ...options.plannerContext.toolkitCodelets]
      .find((item) => item.id === codeletId);
    entry = codelet?.entry;
  }

  if (!entry) {
    throw new Error(`Codelet entry not found for ${codeletId}`);
  }

  const fullEntry = path.resolve(options.root, entry);
  if (!options.json) {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [fullEntry, ...args], {
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

  const { stdout, stderr } = await execFileAsync(process.execPath, [fullEntry, ...args], {
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
  if (!result.preRendered && result.plan.planner && !result.assistantReply && result.plan.kind !== "reply") {
    output.write(`${renderPlannerLine(result.plan.planner)}\n`);
  }
  if (result.plan.strategy && !result.options?.json) {
    output.write(`Strategy: ${result.plan.strategy}\n\n`);
  }
  if (result.plan.kind === "reply") {
    output.write(`${String(result.plan.reply ?? "").trim()}\n`);
    return;
  }

  if (!result.preRendered) {
    if (!result.assistantReply) {
      output.write(`${renderActionList(result.plan.actions)}\n`);
    }
  }
  if (result.assistantReply) {
    output.write(`${String(result.assistantReply).trim()}\n`);
    if (result.recovery) {
      output.write(`\nAI recovery:\n${renderRecovery(result.recovery)}`);
    }
    return;
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

function buildActionGraph(actions) {
  const nodes = [];
  let lastMutatingNodeId = null;
  let lastSyncNodeId = null;
  let previousNodeId = null;
  for (const [index, action] of actions.entries()) {
    const id = `n${index + 1}`;
    const dependsOn = new Set();
    if (action.type === "sync" && previousNodeId) {
      dependsOn.add(previousNodeId);
    } else if (isMutatingAction(action) && previousNodeId) {
      dependsOn.add(previousNodeId);
    } else {
      if (lastMutatingNodeId) dependsOn.add(lastMutatingNodeId);
      if (lastSyncNodeId && action.type !== "sync") dependsOn.add(lastSyncNodeId);
    }
    const node = {
      id,
      type: action.type,
      action,
      dependsOn: Array.from(dependsOn),
      status: "pending"
    };
    nodes.push(node);
    previousNodeId = id;
    if (action.type === "sync") lastSyncNodeId = id;
    if (isMutatingAction(action)) lastMutatingNodeId = id;
  }
  return { nodes };
}

async function executeActionGraph(graph, options) {
  const nodeMap = new Map((graph?.nodes ?? []).map((node) => [node.id, {
    ...node,
    dependsOn: Array.isArray(node.dependsOn) ? [...node.dependsOn] : [],
    status: "pending",
    execution: null
  }]));
  const executions = [];
  while (true) {
    const ready = Array.from(nodeMap.values()).filter((node) =>
      node.status === "pending"
      && node.dependsOn.every((depId) => nodeMap.get(depId)?.status === "ok")
    );
    if (!ready.length) {
      break;
    }
    for (const node of ready) {
      node.status = "running";
      node.execution = await executeShellAction(node.action, options);
      node.status = node.execution.ok ? "ok" : "failed";
      executions.push(node.execution);
      if (!node.execution.ok) {
        for (const waiting of nodeMap.values()) {
          if (waiting.status === "pending" && waiting.dependsOn.includes(node.id)) {
            waiting.status = "blocked";
          }
        }
        return { nodes: Array.from(nodeMap.values()), executions };
      }
    }
  }
  return { nodes: Array.from(nodeMap.values()), executions };
}

function renderActionGraph(graph) {
  const nodes = graph?.nodes ?? [];
  if (!nodes.length) return "(empty)";
  return nodes.map((node) => {
    const deps = node.dependsOn?.length ? ` <- ${node.dependsOn.join(", ")}` : "";
    return `${node.id}: ${node.type}${deps}`;
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

function renderProviderStatus(providerState) {
  const lines = ["AI providers:"];
  for (const [providerId, provider] of Object.entries(providerState.providers ?? {})) {
    const status = [];
    if (provider.local) {
      status.push(provider.available ? "available" : "unavailable");
      if (provider.host) {
        status.push(`host ${provider.host}`);
      }
      if (Array.isArray(provider.models) && provider.models.length) {
        status.push(`${provider.models.length} model${provider.models.length === 1 ? "" : "s"}`);
      }
      if (provider.details && !provider.available) {
        status.push(shortenProviderDetail(provider.details));
      }
    } else {
      if (provider.configured) {
        status.push("configured");
      } else if (provider.available) {
        status.push("available via env");
      } else {
        status.push("not configured");
      }
      status.push(provider.available ? "routeable" : "not routeable");
      if (provider.quota?.freeUsdRemaining != null) {
        status.push(`free quota ${provider.quota.freeUsdRemaining}`);
      }
      if (provider.paidAllowed === false) {
        status.push("paid disabled");
      }
    }
    lines.push(`- ${providerId}: ${status.join(", ")}`);
  }
  return lines.join("\n");
}

function shortenProviderDetail(detail) {
  const line = String(detail ?? "").split(/\r?\n/).find(Boolean) ?? "unavailable";
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}

function renderPlannerFailure(planner, error) {
  const message = String(error?.message ?? error ?? "");
  const statusMatch = message.match(/\((\d{3})\)/);
  const reasonMatch = message.match(/"reason":\s*"([^"]+)"/);
  const parts = [`Planner ${planner.providerId} failed`];
  if (statusMatch?.[1]) {
    parts.push(`HTTP ${statusMatch[1]}`);
  }
  if (reasonMatch?.[1]) {
    parts.push(reasonMatch[1]);
  } else {
    const firstLine = message.split(/\r?\n/)[0]?.trim();
    if (firstLine) {
      parts.push(firstLine.replace(/\s+/g, " ").slice(0, 160));
    }
  }
  return `${parts.join(": ")}. Switching to fallback...`;
}

function buildActionCatalog(plannerContext) {
  const lines = [
    "- project_summary: show overall project status, file/symbol counts, and recent friction",
    "- list_tickets: show all active tickets with summaries",
    "- doctor: local diagnostics and provider visibility",
    "- provider_status: show configured and routeable AI providers",
    "- version: show the current ai-workflow build and toolkit root",
    "- sync: sync the workflow DB",
    "- run_review: run the review summary codelet",
    "- search: search indexed project data",
    "- extract_ticket: extract a specific ticket",
    "- next_ticket: find the next priority ticket to work on",
    "- decompose_ticket: decompose a ticket into sub-tasks",
    "- ideate_feature: scope a new feature into an Epic and Tickets",
    "- sweep_bugs: automated bug-fixing loop for Todo lane",
    "- ingest_artifact: parse a file (e.g. PRD) into Epics/Tickets",
    "- extract_guidelines: extract task guidance",
    "- route: show provider/model routing for a task class",
    "- run_dynamic_codelet: execute an on-the-fly JavaScript code snippet to solve a custom problem",
    "- telegram_preview: render Telegram status text",
    "- add_note: add a project note",
    "- create_ticket: create a workflow ticket",
    "- run_codelet: execute a known codelet by id",
    "- provider_connect: connect to a new AI provider (browser/API key)",
    "- reprofile: refresh model capability matrix",
    "- set_provider_key: set API key for a provider"
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
    graph: buildActionGraph(actions),
    confidence,
    reason
  };
}

function replyPlan(reply, confidence = 1, reason = "Reply only.") {
  return {
    kind: "reply",
    actions: [],
    graph: buildActionGraph([]),
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
    "version",
    "sync and show review hotspots",
    "search router race condition",
    "ticket TKT-001",
    "what ai providers are you connected to right now?",
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

function buildContextualShellReply(inputText, plannerContext) {
  const text = String(inputText ?? "").trim();
  const normalized = normalizeConversationText(text);
  const summary = plannerContext?.summary ?? {};
  const activeTickets = Array.isArray(summary.activeTickets) ? summary.activeTickets : [];
  const modules = Array.isArray(summary.modules) ? summary.modules : [];
  const providerState = plannerContext?.providerState ?? {};
  const providerMap = providerState.providers ?? {};
  const projectName = path.basename(plannerContext?.root ?? process.cwd());
  const hasProjectQuestion = /\b(project|repo|repository|codebase)\b/.test(normalized);
  const asksWhere = /\b(where)\b/.test(normalized)
    || /\bwhich project\b/.test(normalized)
    || /\bwhat (?:project|repo|repository)\b/.test(normalized);
  const asksNext = /\b(work on|do next|focus on|start with|next task|next thing)\b/.test(normalized)
    || /what should i (work on|do) next/.test(normalized)
    || /\bwhat is next\b/.test(normalized);
  const asksCapabilities = /\b(what can you do|how can you help|what are you capable of|what do you do here)\b/.test(normalized);
  const asksGreeting = /\b(how are you|hows it going|how is it going|are you feeling well|ready to help|you there)\b/.test(normalized);
  const asksStatus = /\b(status|shape|state of the project|how is the project)\b/.test(normalized);
  const asksCodebaseAssessment = /\bwhat do you think about the codebase\b/.test(normalized)
    || /\bwhat do you think about this repo\b/.test(normalized);
  const asksActiveTickets = /\b(next tickets|active tickets|open tickets|current tickets|what tickets)\b/.test(normalized);
  const asksModules = /\b(modules|areas|major parts|subsystems)\b/.test(normalized);
  const asksClaims = /\bwhat does claims mean|what do claims mean|what are claims\b/.test(normalized);
  const asksSetupOpenAiOllama = /\b(set this up|setting this up|set up|setup|configure)\b/.test(normalized) && /\bopenai\b/.test(normalized) && /\bollama\b/.test(normalized);
  const asksGeminiTroubleshooting = /\bgemini\b/.test(normalized) && /\b(broken|failing|blocked|wrong|problem|issue|investigate)\b/.test(normalized);

  if (asksCapabilities || ["what can you do here", "what can you do"].includes(normalized)) {
    return replyPlan([
      "I can inspect project state, answer questions about the repo, search code and tickets, sync the workflow DB, prepare context, and run guided workflow actions.",
      "If you want to change code or project state, say that directly and I’ll plan or execute the next step."
    ].join("\n"), 0.7, "Capability explanation.");
  }

  if (asksActiveTickets || ["what are the next tickets", "what are the active tickets", "can you list the active tickets"].includes(normalized)) {
    if (!activeTickets.length) {
      return replyPlan("There are no active tickets right now.", 0.9, "Answered from current summary.");
    }
    const lines = ["Current active tickets:"];
    for (const ticket of activeTickets.slice(0, 8)) {
      lines.push(`- [${ticket.lane}] ${ticket.id}: ${ticket.title}`);
    }
    return replyPlan(lines.join("\n"), 0.9, "Answered from current summary.");
  }

  if (asksSetupOpenAiOllama) {
    const ollama = providerMap.ollama;
    const openai = providerMap.openai;
    const lines = [
      "Use this setup sequence:",
      "1. `ai-workflow set-provider-key openai --global`",
      "2. `ai-workflow set-ollama-hw --global`",
      "3. `ai-workflow doctor`",
      "4. `ai-workflow route shell-planning`"
    ];
    if (ollama?.available) {
      lines.push(`Ollama is already visible at ${ollama.host}.`);
    }
    if (openai?.available) {
      lines.push("OpenAI already looks available.");
    }
    return replyPlan(lines.join("\n"), 0.87, "Setup guidance from provider state.");
  }

  if (asksGeminiTroubleshooting) {
    return replyPlan([
      "Gemini looks unhealthy in this environment.",
      "If you are seeing `API_KEY_SERVICE_BLOCKED`, the Google key is present but blocked for the Generative Language API.",
      "Fix it by replacing/unsetting the Google key, or prefer OpenAI/Ollama until the key is valid.",
      "Useful checks: `ai-workflow doctor`, `ai-workflow route shell-planning`, `ai-workflow config get providers`."
    ].join("\n"), 0.9, "Provider troubleshooting reply.");
  }

  if (asksModules || ["what are my modules", "what modules do i have"].includes(normalized)) {
    if (!modules.length) {
      return replyPlan("I do not have module data yet. Run `sync` first if the index is stale.", 0.82, "Module summary unavailable.");
    }
    return replyPlan(`Current modules: ${modules.slice(0, 10).map((item) => item.name).join(", ")}.`, 0.88, "Answered from project summary.");
  }

  if (asksCodebaseAssessment) {
    if (!modules.length) {
      return replyPlan(`I can ground that better after a fresh sync. Right now I only know you are in \`${projectName}\`.`, 0.7, "Limited codebase assessment without module data.");
    }
    return replyPlan([
      `The codebase looks structured around ${modules.slice(0, 5).map((item) => item.name).join(", ")}.`,
      activeTickets[0] ? `The most obvious current pressure point is ${activeTickets[0].id}: ${activeTickets[0].title}.` : "I do not see an obvious active ticket yet."
    ].join("\n"), 0.82, "Grounded codebase assessment reply.");
  }

  if ((hasProjectQuestion || /\bproject am i in\b/.test(normalized)) && asksNext) {
    const top = activeTickets[0];
    if (!top) {
      return replyPlan(`You are in \`${projectName}\`. I do not see an obvious active ticket yet.`, 0.88, "Answered from project root and summary.");
    }
    return replyPlan([
      `You are in \`${projectName}\`.`,
      `Start with ${top.id}: ${top.title}. It is currently in ${top.lane}.`
    ].join("\n"), 0.9, "Compound project grounding reply.");
  }

  if (asksNext || ["what should i work on next", "what should i do next", "what is next"].includes(normalized)) {
    if (!activeTickets.length) {
      return replyPlan("I do not see an obvious active ticket yet. Run `sync` if the board may be stale, or ask me to inspect the project state.", 0.82, "No active tickets in summary.");
    }
    const top = activeTickets[0];
    return replyPlan(`Start with ${top.id}: ${top.title}. It is currently in ${top.lane}.`, 0.88, "Suggested next work from active tickets.");
  }

  if ((hasProjectQuestion && asksWhere) || ["what project am i in", "which project is this", "what repo is this"].includes(normalized)) {
    const ticketHint = activeTickets[0] ? ` The top active ticket looks like ${activeTickets[0].id}: ${activeTickets[0].title}.` : "";
    return replyPlan(`You are in \`${projectName}\`. Indexed modules and tickets are available here.${ticketHint}`, 0.88, "Answered from project root and summary.");
  }

  if (asksClaims) {
    return replyPlan("Claims are extracted relationships and facts in the workflow DB, such as imports, calls, ownership, and ticket-linked evidence.", 0.9, "Explained built-in terminology.");
  }

  if (asksGreeting || ["how are you", "tell me a joke"].includes(normalized) || /\bhow(?:'s| is) it going\b/.test(normalized) || /\bready to help\b/.test(normalized)) {
    return replyPlan("Ready. Point me at the code or the problem and I’ll work it through.", 0.45, "Light conversational reply.");
  }

  if (asksStatus && hasProjectQuestion) {
    const ticketHint = activeTickets[0] ? `Top active ticket: ${activeTickets[0].id} (${activeTickets[0].lane}).` : "No active ticket is obvious yet.";
    const moduleHint = modules.length ? `Main areas: ${modules.slice(0, 5).map((item) => item.name).join(", ")}.` : "Module summary is not available yet.";
    return replyPlan([
      `You are in \`${projectName}\`.`,
      ticketHint,
      moduleHint
    ].join("\n"), 0.84, "Project status grounding reply.");
  }

  return null;
}

function normalizeConversationText(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[?!.,;:()\[\]{}]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

import { attemptActionCorrection } from "../../core/lib/self-correction.mjs";
import { analyzeCodeletSideEffects, formatSideEffects } from "../../core/services/side-effects.mjs";

async function attemptShellRecovery({ inputText, plan, failed, options, planner }) {
  if (!options.json) {
    output.write(`Action failed: ${failed.stderr || "Unknown error"}. Attempting automatic correction...\n`);
  }

  const correctedAction = await attemptActionCorrection({
    failedAction: failed.action,
    error: { message: failed.stderr || "Unknown error" },
    options: { ...options, planner },
    history: options.history
  });

  if (correctedAction) {
    if (!options.json) {
      const compiled = compileShellAction(correctedAction);
      output.write(`Corrected to: ${compiled.display}. Running...\n`);
    }
    const result = await executeShellAction(correctedAction, options);
    return {
      kind: "plan",
      plan: { actions: [correctedAction] },
      executed: [result]
    };
  }

  return { kind: "reply", reply: "Automatic correction could not find a safe alternative." };
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
  const lines = [
    `Files indexed: ${summary.fileCount}`,
    `Symbols indexed: ${summary.symbolCount}`,
    `Notes tracked: ${summary.noteCount}`,
    `Tickets: ${summary.activeTickets.length}`,
    `Candidates: ${summary.candidates.length}`
  ];

  if (summary.activeTickets.length) {
    lines.push("\nActive Tickets:");
    for (const t of summary.activeTickets) {
      lines.push(`- [${t.lane}] ${t.id}: ${t.title}`);
    }
  }

  if (summary.candidates.length) {
    lines.push("\nRecent Candidates:");
    for (const c of summary.candidates) {
      lines.push(`- [${c.status}] ${c.id}: ${c.summary}`);
    }
  }

  return lines.join("\n") + "\n";
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
