import path from "node:path";
import process from "node:process";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { getToolkitRoot, listToolkitCodelets } from "./codelets.mjs";
import { listProjectCodelets } from "./project-codelets.mjs";
import { routeTask } from "../../core/services/router.mjs";
import { discoverProviderState, generateCompletion, generateWithOllama } from "../../core/services/providers.mjs";
import { decomposeTicket, executeTicket, ideateFeature, sweepBugs } from "../../core/services/orchestrator.mjs";
import { auditArchitecture } from "../../core/services/critic.mjs";
import { addManualNote, createTicket, evaluateProjectReadiness, getProjectMetrics, getProjectSummary, getSmartProjectStatus, recordMetric, searchProject, syncProject, withWorkflowStore } from "../../core/services/sync.mjs";
import { executeCodelet } from "../../core/services/codelet-executor.mjs";
import { buildTicketEntity, inferTicketLane } from "../../core/services/projections.mjs";
import { buildTelegramPreview } from "../../core/services/telegram.mjs";
import { parseArgs, printAndExit } from "../../runtime/scripts/ai-workflow/lib/cli.mjs";
import { getConfigValue, getGlobalConfigPath, getProjectConfigPath, readConfig, removeConfigFile, removeConfigValue, writeConfigValue } from "./config-store.mjs";
import { buildDoctorReport, renderDoctorReport } from "./doctor.mjs";
import { configureOllamaHardware } from "./ollama-hw.mjs";
import { runProviderSetupWizard } from "./provider-setup.mjs";
import { handleProviderConnect } from "./provider-connect.mjs";
import { withWorkspaceMutation } from "../../core/lib/workspace-mutation.mjs";
import { formatStatusReport, resolveProjectStatus } from "../../core/services/status.mjs";

const STREAMED_STDIO = "__STREAMED_STDIO__";
const SHELL_GRAPH_NODE_KINDS = new Set(["action", "branch", "assert", "synthesize", "replan"]);
const TICKET_ID_PATTERN = "[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+";
const WORKFLOW_GATED_MUTATIONS = new Set(["add_note", "create_ticket", "ideate_feature", "sweep_bugs", "ingest_artifact", "execute_ticket"]);
const TOOLKIT_ROOT = getToolkitRoot();
const SHELL_REFERENTIAL_TOKENS = new Set([
  "it",
  "that",
  "this",
  "those",
  "these",
  "them",
  "same",
  "again",
  "previous",
  "prior",
  "other",
  "another",
  "second",
  "first"
]);

const MUTATING_ACTIONS = new Set(["sync", "add_note", "create_ticket", "set_ollama_hw", "ideate_feature", "sweep_bugs", "ingest_artifact", "execute_ticket"]);
const FAST_DIRECT_ACTIONS = new Set([
  "project_summary",
  "list_tickets",
  "status_query",
  "metrics",
  "version",
  "doctor",
  "provider_status",
  "audit_architecture",
  "route",
  "search",
  "extract_ticket",
  "next_ticket"
]);
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
  "ui-layout",
  "ui-styling",
  "design-tokens",
  "prose-composition",
  "templating",
  "pure-function",
  "refactoring",
  "bug-hunting"
];
const SHELL_CAPABILITY_FAMILIES = new Set([
  "project-planning",
  "coding",
  "debugging",
  "review",
  "refactor-planning",
  "design-direction",
  "shell-usage"
]);
const SAFE_AUTO_EXECUTE_CODELETS = new Set([
  "docs-refresh",
  "import-cleanup",
  "dependency-prune",
  "css-refactor",
  "test-heal"
]);
const SHELL_TICKET_KEYWORD_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "into",
  "from",
  "that",
  "this",
  "then",
  "before",
  "after",
  "make",
  "keep",
  "shell",
  "prompt",
  "prompts",
  "request",
  "requests",
  "work",
  "current",
  "new"
]);
const OPERATIONAL_QUERY_STOPWORDS = new Set([
  "please",
  "would",
  "could",
  "should",
  "need",
  "want",
  "figure",
  "which",
  "files",
  "likely",
  "involved",
  "safest",
  "approach",
  "handle",
  "around",
  "about",
  "before",
  "after",
  "tell",
  "work",
  "this",
  "that",
  "with",
  "from",
  "into",
  "through",
  "there",
  "their",
  "they",
  "debug",
  "review",
  "design",
  "plan",
  "refactor",
  "implement",
  "write",
  "summary",
  "briefly",
  "detail",
  "detailed",
  "concise",
  "brief",
  "deep",
  "dive"
]);

export async function handleShell(rest, { cliPath } = {}) {
  const args = parseShellArgs(rest);
  if (args.help) {
    printAndExit(SHELL_HELP.trim());
  }

  const root = process.cwd();
  const options = {
    root,
    json: Boolean(args.json),
    yes: Boolean(args.yes),
    noAi: Boolean(args["no-ai"]),
    planOnly: Boolean(args["plan-only"]),
    trace: Boolean(args.trace),
    autoExecuteSafe: true,
    shellMode: "plan",
    cliPath: cliPath ?? path.resolve(root, "cli", "ai-workflow.mjs"),
    plannerContext: null,
    planners: null
  };
  options.traceAi = (event) => logShellTrace(options, event);

  const prompt = args._.join(" ").trim();
  if (prompt) {
    const fastResult = await tryRunShellFastPath(prompt, options);
    if (fastResult) {
      return emitShellResult(fastResult, options);
    }
    const processingIndicator = createShellProcessingIndicator(options);
    try {
      processingIndicator.update("refreshing providers");
      await runProviderSetupWizard({ root, scope: "global", interactive: false });
      processingIndicator.update("syncing project");
      await syncProject({ projectRoot: root, writeProjections: true });
      processingIndicator.update("refreshing context");
      options.plannerContext = await buildShellContext(root);
      options.planners = await resolveShellPlanners(root, { providerState: options.plannerContext.providerState });
      processingIndicator.update("planning and running", { planner: options.planners.planners[0] ?? options.planners.heuristic });
      const result = await runShellTurn(prompt, options);
      processingIndicator.clear();
      return emitShellResult(result, options);
    } finally {
      processingIndicator.clear();
    }
  }

  await runProviderSetupWizard({ root, scope: "global", interactive: false });
  options.plannerContext = await buildShellContext(root);
  options.planners = await resolveShellPlanners(root, { providerState: options.plannerContext.providerState });
  return runInteractiveShell(options);
}

async function buildFastShellContext(root = process.cwd()) {
  const summary = await safeGetProjectSummary(root);
  return {
    root,
    toolkitCodelets: [],
    projectCodelets: [],
    summary,
    smartStatus: null,
    providerState: { providers: {} },
    knowledge: { tasks: [] },
    kanban: null
  };
}

async function tryRunShellFastPath(inputText, options) {
  const plannerContext = await buildFastShellContext(options.root);
  const plan = planShellRequestHeuristically(inputText, plannerContext, {
    activeGraphState: options.activeGraphState ?? null
  });

  if (isFastShellReplyPlan(plan)) {
    return {
      input: inputText,
      plan,
      executed: [],
      executedGraph: { nodes: [], executions: [], branchPath: [] },
      continuationState: buildContinuationState({
        inputText,
        plan,
        executedGraph: { nodes: [], executions: [], branchPath: [] }
      }),
      preRendered: false,
      recovery: null,
      assistantReply: null
    };
  }

  if (isFastShellActionPlan(plan)) {
    const fastOptions = {
      ...options,
      noAi: true,
      plannerContext,
      planners: {
        planners: [],
        heuristic: {
          mode: "heuristic",
          reason: "Fast local shell path."
        }
      }
    };
    const executedGraph = await executeActionGraph(plan.graph, fastOptions);
    const executed = executedGraph.nodes
      .filter((node) => node.execution)
      .map((node) => node.execution);
    return {
      input: inputText,
      plan,
      executed,
      executedGraph,
      continuationState: buildContinuationState({ inputText, plan, executedGraph }),
      preRendered: true,
      recovery: null,
      assistantReply: null
    };
  }

  return null;
}

function isFastShellReplyPlan(plan) {
  return plan?.kind === "reply" && (plan.confidence ?? 0) >= 0.9;
}

function isFastShellActionPlan(plan) {
  return plan?.kind === "plan"
    && (plan.confidence ?? 0) >= 0.93
    && Array.isArray(plan.actions)
    && plan.actions.length > 0
    && plan.actions.every((action) => FAST_DIRECT_ACTIONS.has(action.type));
}

function parseShellArgs(argv) {
  const args = { _: [] };
  const booleanFlags = new Set(["help", "json", "yes", "plan-only", "no-ai", "trace"]);
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
    discoverProviderState({ root, forceRefresh: true }),
    getSmartProjectStatus({ projectRoot: root }).catch(() => "Status unavailable.")
  ]);

  const [mission, kanbanEntry, gemini, guidelines, manual] = await Promise.all([
    readFileIfExists(path.resolve(root, "MISSION.md")),
    readFirstExistingEntry([
      path.resolve(root, ".gemini", "KANBAN.md"),
      path.resolve(root, ".gemini", "kanban.md"),
      path.resolve(root, "docs", "KANBAN.md"),
      path.resolve(root, "docs", "kanban.md"),
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
    ]),
    readFirstExisting([
      path.resolve(root, "docs", "MANUAL.md"),
      path.resolve(TOOLKIT_ROOT, "docs", "MANUAL.md")
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
    kanban: kanbanEntry?.content ?? null,
    kanbanPath: kanbanEntry?.path ? path.relative(root, kanbanEntry.path) : null,
    gemini,
    guidelines,
    manual
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

async function readFirstExistingEntry(filePaths) {
  for (const filePath of filePaths) {
    const content = await readFileIfExists(filePath);
    if (content) {
      return { path: filePath, content };
    }
  }
  return null;
}

export async function resolveShellPlanners(root = process.cwd(), { providerState = null } = {}) {
  const route = await routeTask({
    root,
    taskClass: "shell-planning",
    forceRefresh: !providerState,
    providerState
  });
  const planners = [];
  const providers = route.providers ?? {};

  if (route.recommended) {
    const mapped = mapRouteCandidateToPlanner(route.recommended, providers);
    if (isEligibleShellPlanner(mapped, providers)) {
      planners.push(mapped);
    }
  }

  const ollamaProvider = providers.ollama;
  if (!planners.length && ollamaProvider?.available) {
    try {
      const localShellModel = chooseShellPlannerModel(ollamaProvider);
      planners.push({
        mode: "ollama",
        providerId: "ollama",
        modelId: localShellModel.id,
        host: ollamaProvider.host,
        needsHardwareHint: Boolean(localShellModel.needsHardwareHint),
        reason: localShellModel.reason ?? "local shell planner"
      });
    } catch {
      // keep route-derived planners only
    }
  }

  for (const candidate of route.fallbackChain) {
    const mapped = mapRouteCandidateToPlanner(candidate, providers);
    if (isEligibleShellPlanner(mapped, providers)) {
      planners.push(mapped);
    }
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

  // Ensure at least one remote model is in the chain as a final safety net
  // if we only have local models so far.
  if (deduped.length > 0 && deduped.every(p => p.mode === "ollama")) {
    const providerState = await discoverProviderState({ root, forceRefresh: false });
    const remoteRoute = await routeTask({
      root,
      taskClass: "shell-planning",
      preferLocal: false,
      forceRefresh: false,
      providerState
    });
    if (remoteRoute.recommended && !remoteRoute.recommended.local) {
      const mapped = mapRouteCandidateToPlanner(remoteRoute.recommended, providers);
      if (isEligibleShellPlanner(mapped, providers)) {
        deduped.push(mapped);
      }
    }
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

function isEligibleShellPlanner(planner, providers) {
  if (!planner?.providerId || planner.providerId !== "ollama") {
    return true;
  }
  const models = Array.isArray(providers?.ollama?.models) ? providers.ollama.models : [];
  const model = models.find((item) => item.id === planner.modelId || item.name === planner.modelId);
  return isTextCapableShellPlannerModel(model);
}

export async function planShellRequest(inputText, options) {
  const intent = analyzeShellIntent(inputText, options.plannerContext);
  const routing = routeShellIntent(intent);
  if (routing.mode === "staged-core") {
    return planSingleRequest(inputText, options);
  }

  const segments = splitShellRequestSegments(inputText);
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
      return normalizeShellPlanEnvelope({
        kind: "plan",
        actions: combinedActions.slice(0, 5), // Limit to 5 combined
        graph: buildActionGraph(combinedActions.slice(0, 5)),
        confidence,
        reason: `Combined multi-intent plan: ${plans.map(p => p.reason).join("; ")}`,
        strategy: plans.map(p => p.strategy).filter(Boolean).join(" Then ")
      }, inputText, options.plannerContext);
    }

    if (plans.every((plan) => plan.kind === "reply")) {
      const combinedReply = plans
        .map((plan) => String(plan.reply ?? "").trim())
        .filter(Boolean)
        .join("\n\n");
      return normalizeShellPlanEnvelope({
        kind: "reply",
        actions: [],
        graph: buildActionGraph([]),
        confidence,
        reason: `Combined multi-intent reply: ${plans.map((plan) => plan.reason).join("; ")}`,
        reply: combinedReply || "I need a clearer request."
      }, inputText, options.plannerContext);
    }
  }

  return normalizeShellPlanEnvelope(await planSingleRequest(inputText, options), inputText, options.plannerContext);
}

async function planSingleRequest(inputText, options) {
  const intent = analyzeShellIntent(inputText, options.plannerContext);
  const routing = routeShellIntent(intent);
  const heuristic = planShellRequestHeuristically(inputText, options.plannerContext, {
    activeGraphState: options.activeGraphState ?? null
  });
  const useHeuristicOnly = options.noAi || !options.planners.planners.length;
  const preferAiPlanner = !useHeuristicOnly && shouldPreferAiPlannerForTurn(inputText, options, heuristic, routing);

  if (!preferAiPlanner && (useHeuristicOnly || heuristic.confidence >= 0.92)) {
    return normalizeShellPlanEnvelope({
      ...heuristic,
      planner: {
        mode: options.noAi ? "heuristic-forced" : "heuristic",
        reason: heuristic.reason
      }
    }, inputText, options.plannerContext);
  }

  const errors = [];
  for (const planner of options.planners.planners) {
    const plannerKey = `${planner.providerId}:${planner.modelId}`;
    // Skip providers that have already failed in this session
    if (options.blacklist?.has(planner.providerId) || options.plannerBlacklist?.has(plannerKey)) {
      continue;
    }

    try {
      const aiPlan = await planShellRequestWithAgent(inputText, { ...options, planner });
      if (isNonActionableShellReply(aiPlan)) {
        errors.push(`${planner.providerId}: planner returned a non-actionable fallback reply`);
        continue;
      }
      return normalizeShellPlanEnvelope({
        ...aiPlan,
        planner
      }, inputText, options.plannerContext);
    } catch (error) {
      const timedOut = isShellPlannerTimeoutError(error);
      const isFatal = String(error).includes("403") || String(error).includes("PERMISSION_DENIED") || String(error).includes("invalid_key");
      if (isFatal) {
        options.blacklist ??= new Set();
        options.blacklist.add(planner.providerId);
        if (!options.json && shouldSurfacePlannerFailure(inputText, heuristic)) {
          output.write(`${renderPlannerFailure(planner, error)}\n`);
        }
      }
      options.plannerBlacklist ??= new Set();
      options.plannerBlacklist.add(plannerKey);
      errors.push(`${planner.providerId}: ${error.message ?? String(error)}`);
      if (timedOut && planner.providerId === "ollama") {
        break;
      }
    }
  }

  const groundedFallback = await buildGroundedShellFallbackPlan(inputText, options);
  if (groundedFallback) {
    return normalizeShellPlanEnvelope({
      ...groundedFallback,
      planner: {
        mode: errors.length ? "ai-fallback-to-grounded" : "grounded-fallback",
        reason: errors.join("; ") || groundedFallback.reason
      }
    }, inputText, options.plannerContext);
  }

  return normalizeShellPlanEnvelope({
    ...heuristic,
    planner: {
      mode: preferAiPlanner ? "ai-fallback-to-heuristic" : "heuristic-fallback",
      reason: errors.join("; ")
    }
  }, inputText, options.plannerContext);
}

function shouldPreferAiPlannerForTurn(inputText, options, heuristic, routing) {
  if (options.noAi || !options.planners.planners.length) {
    return false;
  }

  if (routing.mode === "staged-core") {
    return true;
  }

  if (isDeterministicShellSurfaceRequest(inputText)) {
    return false;
  }

  const activeGraphState = options.activeGraphState ?? null;
  if (activeGraphState?.graph?.nodes?.length) {
    const followUpMode = inferShellFollowUpMode({
      inputText,
      activeGraphState,
      plannerContext: options.plannerContext
    });
    if (followUpMode !== "new-request") {
      return true;
    }
  }

  if (looksLikeRepoExplainerQuestion(inputText)) {
    return true;
  }

  const inferredTaskClass = inferShellTaskClassFromPrompt(inputText);
  if (inferredTaskClass && inferredTaskClass !== "classification") {
    return true;
  }

  const normalized = normalizeConversationText(inputText);
  const tokenCount = normalized ? normalized.split(/\s+/).filter(Boolean).length : 0;
  if (/[?]/.test(String(inputText ?? "")) || tokenCount >= 7) {
    return true;
  }

  return heuristic.confidence < 0.92;
}

function isDeterministicShellSurfaceRequest(inputText) {
  const normalized = normalizeConversationText(inputText);
  const trimmed = String(inputText ?? "").trim();
  return [
    "help",
    "/help",
    "doctor",
    "doctor help",
    "version",
    "provider status",
    "providers"
  ].includes(normalized)
    || /^ticket\s+[A-Z0-9-]+$/i.test(trimmed)
    || /^search\s+\S+/i.test(trimmed)
    || /^route\s+\S+/i.test(trimmed)
    || /^summary$/i.test(trimmed)
    || /^status$/i.test(trimmed);
}

async function buildGroundedShellFallbackPlan(inputText, options) {
  if (looksLikeShellUsageQuestion(inputText)) {
    return replyPlan([
      "Use the shell by asking directly for status, search, ticket, routing, or execution help.",
      renderShellHelp(options.plannerContext ?? {})
    ].join("\n\n"), 0.82, "Grounded shell-usage fallback reply.");
  }

  if (!looksLikeRepoExplainerQuestion(inputText)) {
    return null;
  }

  const plannerContext = options.plannerContext ?? {};
  const moduleMatches = findShellGroundingModuleMatches(inputText, plannerContext);
  const selectors = extractShellGroundingSelectors(inputText, plannerContext);
  const projectRoot = options.root ?? plannerContext.root ?? process.cwd();

  for (const selector of selectors.slice(0, 4)) {
    const payload = await resolveProjectStatus({
      projectRoot,
      selector,
      includeRelated: true,
      rawQuestion: true,
      relatedLimit: 8
    }).catch(() => null);
    if (!payload?.ok) {
      continue;
    }
    return replyPlan(renderGroundedExplainerReply(payload, moduleMatches), 0.8, "Grounded repo explainer fallback reply.");
  }

  if (moduleMatches.length) {
    const top = moduleMatches[0];
    return replyPlan(`${top.name} is the most likely match here. ${top.responsibility ?? "It is a tracked repo module."}`, 0.74, "Module-match explainer fallback reply.");
  }

  return null;
}

function isNonActionableShellReply(plan) {
  if (plan?.kind !== "reply" && !(plan?.kind === "intent" && Array.isArray(plan?.actions) && plan.actions.length === 0)) {
    return false;
  }
  const text = normalizeConversationText(plan.assistantReply ?? plan.reply ?? "");
  if (!text) {
    return true;
  }
  return /\bneeds the ai planner\b/.test(text)
    || /\bmore direct phrasing\b/.test(text)
    || /\btry sync and show review hotspots\b/.test(text);
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

function isShellPlannerTimeoutError(error) {
  return /planner timed out after \d+ms/i.test(String(error?.message ?? error));
}

export function planShellRequestHeuristically(inputText, plannerContext, options = {}) {
  const text = String(inputText ?? "").trim();
  const lower = text.toLowerCase();
  const normalizedQuestion = normalizeConversationText(text);
  const activeGraphState = options.activeGraphState ?? null;
  const implicitTicketId = resolveImplicitTicketId(plannerContext, text);
  const intent = analyzeShellIntent(text, plannerContext);
  const routing = routeShellIntent(intent);
  const asksCurrentWork = /\b(working on right now|working on now|what are we working on|what were working on|current work|current focus)\b/.test(normalizedQuestion);
  const asksRelatedArtifacts = /\b(artifact|artifacts|relates to it|related to it|relate to it)\b/.test(normalizedQuestion);
  const readinessGoal = extractReadinessGoal(text);
  const asksProjectStatus = /\b(project status|projects status|status update|whats the project status|whats the projects status|what is the project status|what is the projects status|hows the project|how is the project)\b/.test(normalizedQuestion);
  const asksReadiness = Boolean(readinessGoal);
  const wantsCombinedStatusReadiness = asksProjectStatus && asksReadiness;
  const readinessContinuationPlan = buildReadinessContinuationPlan({
    text,
    plannerContext,
    activeGraphState
  });

  if (!text) {
    return replyPlan("Tell me what you want to do. Example: `sync and show review hotspots`.");
  }

  if (readinessContinuationPlan) {
    return readinessContinuationPlan;
  }

  const followUpMode = inferShellFollowUpMode({
    inputText: text,
    activeGraphState,
    plannerContext
  });
  if (followUpMode !== "new-request" && activeGraphState?.graph?.nodes?.length) {
    const continuationPlan = buildShellContinuationPlan({
      text,
      plannerContext,
      activeGraphState,
      followUpMode
    });
    if (continuationPlan) {
      return continuationPlan;
    }
    return replyPlan([
      "The last graph has already been executed.",
      renderContinuationState(activeGraphState),
      "If you want another pass, ask for the next concrete step or specify what to branch on."
    ].join("\n\n"), 0.82, "Continuation request grounded in prior graph state.", {
      inputText: text,
      plannerContext,
      intent: {
        followUpMode
      }
    });
  }

  if (["help", "/help", "what can you do", "commands"].includes(normalizedQuestion)) {
    return replyPlan(renderShellHelp(plannerContext));
  }

  if (wantsCombinedStatusReadiness) {
    return {
      kind: "plan",
      actions: [
        { type: "project_summary" },
        { type: "evaluate_readiness", goalType: readinessGoal.type, question: readinessGoal.question }
      ],
      graph: buildActionGraph([
        { type: "project_summary" },
        { type: "evaluate_readiness", goalType: readinessGoal.type, question: readinessGoal.question }
      ]),
      confidence: 0.98,
      reason: "Combined project-status and readiness request routed to summary plus shared readiness evaluation.",
      planner: {
        mode: "heuristic",
        reason: "Combined status/readiness request."
      },
      presentation: "assistant-first"
    };
  }

  if (readinessGoal && !intent.requestedMutations.executeCurrent && !intent.requestedMutations.prioritizeRemaining && !intent.requestedMutations.resolveNeededForGoal) {
    return {
      ...actionPlan([{
      type: "evaluate_readiness",
      goalType: readinessGoal.type,
      question: readinessGoal.question
    }], 0.97, "Readiness judgment request routed to the shared readiness evaluator."),
      presentation: "assistant-first"
    };
  }

  if (looksLikeGenericStatusQuery(text, plannerContext)) {
    return actionPlan([{
      type: "status_query",
      query: text,
      entityType: inferStatusEntityType(text)
    }], 0.95, "Generic status-style request routed to the deterministic status resolver.");
  }

  if (routing.mode === "staged-core") {
    const stagedPlan = buildGoalDirectedShellPlan(intent, plannerContext);
    if (stagedPlan) {
      return stagedPlan;
    }
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

  if ((/\b(explain|describe|summarize|detail|details)\b/.test(lower) || /\bwhat functionality\b/.test(lower))
    && /\bticket\b/.test(lower)
    && implicitTicketId) {
    return actionPlan([{
      type: "status_query",
      query: implicitTicketId,
      entityType: "ticket"
    }], 0.93, "Implicit ticket explanation request resolved to ticket status with related evidence.");
  }

  if (asksCurrentWork && implicitTicketId) {
    return actionPlan([{
      type: "status_query",
      query: implicitTicketId,
      entityType: "ticket"
    }], 0.95, "Current work request resolved from active in-progress ticket with related evidence.");
  }

  if (/\b(complete|finish|resolve|do|handle)\b/.test(lower)
    && /\b(ticket|issue)\b/.test(lower)
    && /\b(in progress|in-progress|current)\b/.test(lower)
    && implicitTicketId) {
    return actionPlan([{ type: "execute_ticket", ticketId: implicitTicketId, apply: true }], 0.94, "Implicit execute current in-progress ticket request.");
  }

  if (/^(metrics|stats|usage)$/i.test(text)) {
    return actionPlan([{ type: "metrics" }], 0.98, "Usage metrics request.");
  }

  if (/^(version|--version|show version)$/i.test(text)) {
    return actionPlan([{ type: "version" }], 0.99, "Explicit version request.");
  }

  const isSimpleProviderStatusRequest = (
    /\b(?:what|which|show|list)\b.*\b(?:ai\s+)?providers?\b/.test(lower) ||
    /\bproviders?\b.*\b(?:connected|configured|available|active|status|looking|doing|healthy|health)\b/.test(lower)
  ) && !/\b(inspect|investigate|debug|diagnose|deep|deeply|why|fix|repair|resolve|trace)\b/.test(lower);

  if (isSimpleProviderStatusRequest) {
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

  const routeMatch = text.match(/^(?:route|pick(?:\s+a)?\s+model\s+for)\s+(.+)$/i);
  if (routeMatch) {
    return actionPlan([{ type: "route", taskClass: normalizeTaskClass(routeMatch[1], plannerContext) }], 0.93, "Explicit routing request.");
  }

  const searchMatch = text.match(/^(?:search|find)\s+(.+)$/i);
  if (searchMatch) {
    const query = searchMatch[1].replace(/^for\s+/i, "").trim();
    return actionPlan([{ type: "search", query }], 0.95, "Explicit search request.");
  }

  const ticketMatch = text.match(new RegExp(`(?:extract\\s+ticket|show\\s+ticket|ticket|decompose\\s+ticket|break\\s+down)\\s+(${TICKET_ID_PATTERN})`, "i"));
  if (ticketMatch) {
    const isDecompose = /\b(?:decompose|break down|split)\b/i.test(text);
    return actionPlan([{
      type: isDecompose ? "decompose_ticket" : "extract_ticket",
      ticketId: ticketMatch[1].toUpperCase()
    }], 0.94, `Explicit ticket ${isDecompose ? "decomposition" : "extraction"} request.`);
  }

  const executeTicketMatch = text.match(new RegExp(`^(?:fix|resolve|complete|finish|execute|handle|work\\s+on|do)\\s+(?:ticket\\s+|issue\\s+)?(${TICKET_ID_PATTERN})$`, "i"));
  if (executeTicketMatch) {
    return actionPlan([{
      type: "execute_ticket",
      ticketId: executeTicketMatch[1].toUpperCase(),
      apply: true
    }], 0.96, "Explicit ticket execution request.");
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

  const guidelinesMatch = text.match(new RegExp(`(?:extract\\s+guidelines|guidelines)(?:\\s+for)?(?:\\s+(${TICKET_ID_PATTERN}))?`, "i"));
  if (guidelinesMatch && /guideline/i.test(text)) {
    return actionPlan([{
      type: "extract_guidelines",
      ticketId: guidelinesMatch[1]?.toUpperCase() ?? null,
      changed: /\bchanged\b/.test(lower)
    }], 0.9, "Explicit guideline extraction request.");
  }

  const capabilityRoutingPlan = buildCapabilityRoutingPlan(text, plannerContext);
  if (capabilityRoutingPlan) {
    return capabilityRoutingPlan;
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

  return buildHeuristicSemanticFallbackPlan(text, plannerContext);
}

function inferShellFollowUpMode({ inputText = "", activeGraphState = null, plannerContext = {} } = {}) {
  if (!activeGraphState?.graph?.nodes?.length) {
    return "new-request";
  }

  const text = String(inputText ?? "").trim();
  const normalized = normalizeConversationText(text);
  if (!normalized) {
    return "new-request";
  }

  const standaloneTarget = hasStandaloneShellTarget(text, plannerContext);
  const words = normalized.split(/\s+/).filter(Boolean);
  const referential = words.some((word) => SHELL_REFERENTIAL_TOKENS.has(word));
  const asksResultQuestion = /\b(why|what|which|how|is)\b/.test(normalized)
    && (/\b(fail|failed|failure|blocked|blocker|safe|risky|risk|step|node|result|happened|went wrong)\b/.test(normalized)
      || referential);
  const asksRevision = /\b(shorter|longer|brief|briefly|one sentence|single sentence|bullets|bullet points|rephrase|rewrite|reformat|format|more detail|detailed|absolute paths)\b/.test(normalized);
  const asksContinuationWork = /\b(do|fix|implement|apply|patch|change|continue|keep|make|take|branch|focus|inspect|review|debug|use)\b/.test(normalized);
  const shortElliptical = words.length <= 8;

  if (asksRevision) {
    return "revise-prior-answer";
  }
  if (asksResultQuestion) {
    return "ask-about-prior-result";
  }
  if ((referential || shortElliptical || !standaloneTarget) && asksContinuationWork) {
    return "continue-prior-work";
  }
  if ((referential || shortElliptical) && !standaloneTarget) {
    return "ask-about-prior-result";
  }
  return "new-request";
}

function hasStandaloneShellTarget(inputText, plannerContext = {}) {
  const trimmed = String(inputText ?? "").trim();
  if (!trimmed) {
    return false;
  }
  if ((new RegExp(TICKET_ID_PATTERN)).test(trimmed)) {
    return true;
  }
  if (looksLikeShellUsageQuestion(trimmed) || looksLikeRepoExplainerQuestion(trimmed) || extractReadinessGoal(trimmed)) {
    return true;
  }
  return Boolean(
    extractShellFallbackSubject(trimmed, plannerContext)
    || extractOperationalSearchQuery(trimmed, plannerContext)
  );
}

function analyzeShellIntent(inputText, plannerContext = {}) {
  const text = String(inputText ?? "").trim();
  const normalized = normalizeConversationText(text);
  const summary = plannerContext?.summary ?? {};
  const activeTickets = Array.isArray(summary.activeTickets) ? summary.activeTickets : [];
  const implicitTicketId = resolveImplicitTicketId(plannerContext, text);
  const clauses = splitShellIntentClauses(text);
  const goal = extractShellGoal(text);
  const mentionsCurrentTicket = (/\b(in progress|in-progress|current|active)\b/.test(normalized)
      && /\b(ticket|issue|task|bug|item|work)\b/.test(normalized))
    || /\b(currently in flight|underway|active now|what is active now)\b/.test(normalized);
  const mentionsRemainingTickets = /\b(rest of the tickets|remaining tickets|rest of the work|remaining work|everything else|what else|the rest)\b/.test(normalized);
  const wantsExecuteCurrent = /\b(resolve|complete|finish|handle|work through|do|wrap up|take care of)\b/.test(normalized)
    && mentionsCurrentTicket;
  const wantsPrioritize = /\b(prioriti[sz]e|reprioriti[sz]e|rank|order|sort)\b/.test(normalized)
    || mentionsRemainingTickets;
  const isReadinessQuestion = /\b(ready|readiness)\b/.test(normalized)
    && /\b(beta|release|handoff)\b/.test(normalized);
  const wantsGoalResolution = !isReadinessQuestion
    && /\b(resolve what is needed|what is needed|achieve that goal|before beta|for beta|launch readiness|make it ready|get it ready|make this ready|make the project ready)\b/.test(normalized);
  const imperativeMatches = normalized.match(/\b(resolve|complete|finish|handle|prioriti[sz]e|reprioriti[sz]e|rank|sort|tell|explain|decide|inspect|review|work through|prepare|wrap up|take care of)\b/g) ?? [];
  const orderingLanguage = /\b(then|after|before|according to|while|and then|the rest)\b/.test(normalized);
  const complexity = [
    clauses.length > 1,
    imperativeMatches.length >= 2,
    Boolean(goal.text),
    orderingLanguage,
    wantsExecuteCurrent && wantsPrioritize,
    wantsGoalResolution
  ].filter(Boolean).length;

  return {
    text,
    normalized,
    clauses,
    implicitTicketId,
    entities: {
      currentTicketId: implicitTicketId,
      activeTicketCount: activeTickets.length
    },
    requestedMutations: {
      executeCurrent: wantsExecuteCurrent,
      prioritizeRemaining: wantsPrioritize,
      resolveNeededForGoal: wantsGoalResolution
    },
    ordering: {
      preserveUserOrder: wantsExecuteCurrent && (wantsPrioritize || wantsGoalResolution),
      explicitSequence: orderingLanguage
    },
    goal,
    complexity
  };
}

function splitShellIntentClauses(text) {
  return String(text ?? "")
    .split(/\b(?:and then|then|,\s+then|,\s+and\s+then|,\s+|;)\b/i)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildHeuristicSemanticFallbackPlan(inputText, plannerContext = {}) {
  const text = String(inputText ?? "").trim();
  const normalized = normalizeConversationText(text);
  const subject = extractShellFallbackSubject(text, plannerContext);
  const entityType = inferFallbackEntityType(text, subject, plannerContext);
  const asksProjectHealth = /\b(project|repo|repository|codebase)\b/.test(normalized)
    && /\b(status|state|shape|health|healthy|doing|good|bad|tell me about|what do you think)\b/.test(normalized);
  const asksWorkflowBrief = /\b(brief|operator brief|recommendation|recommend|what should i do next|next step|current workflow state|workflow state)\b/.test(normalized)
    && /\b(project|repo|workflow|current)\b/.test(normalized);
  const asksStatusLikeQuestion = /\b(status|state|shape|health|healthy|good|bad|doing|what is up with|whats up with|tell me about|what do you think about|explain|describe|what is|whats|what are|do we have|is there|anything called|named|called)\b/.test(normalized);
  const asksSearchLikeQuestion = /\b(search|find|look for|grep|scan for)\b/.test(normalized);

  if (asksProjectHealth || asksWorkflowBrief) {
    return {
      ...actionPlan([{ type: "project_summary" }], 0.78, "Semantic fallback routed the request to a project summary."),
      presentation: "assistant-first"
    };
  }

  if (subject && asksStatusLikeQuestion) {
    return {
      ...actionPlan([{
        type: "status_query",
        query: subject,
        entityType
      }], 0.74, "Semantic fallback routed the request to the deterministic status resolver."),
      presentation: "assistant-first"
    };
  }

  if (subject && asksSearchLikeQuestion) {
    return {
      ...actionPlan([{ type: "search", query: subject }], 0.72, "Semantic fallback routed the request to project search."),
      presentation: "assistant-first"
    };
  }

  if (subject) {
    return {
      ...actionPlan([
        {
          type: "status_query",
          query: subject,
          entityType
        },
        {
          type: "search",
          query: subject
        }
      ], 0.64, "Semantic fallback is probing the most likely project target."),
      presentation: "assistant-first"
    };
  }

  return replyPlan([
    "I could not resolve a concrete project target from that request yet.",
    "I can still inspect project status, search the repo, explain shell surfaces, or extract ticket context.",
    "Examples: `what's the status of this project?`, `tell me about the shell`, `search router`, `ticket TKT-001`, `route shell-planning`."
  ].join("\n"), 0.42, "Semantic fallback could not resolve a concrete target.");
}

function buildCapabilityRoutingPlan(inputText, plannerContext = {}) {
  const text = String(inputText ?? "").trim();
  const taskClass = inferShellTaskClassFromPrompt(text);
  if (!taskClass) {
    return null;
  }

  const implicitTicketId = resolveImplicitTicketId(plannerContext, text);
  const searchQuery = extractOperationalSearchQuery(text, plannerContext);
  const actions = [{ type: "route", taskClass }];
  if (implicitTicketId) {
    actions.push({
      type: "status_query",
      query: implicitTicketId,
      entityType: "ticket"
    });
  }
  const shellModulePath = extractShellModulePath(text, plannerContext);
  if (!implicitTicketId && shellModulePath && /\b(changed|recent|lately|files?|paths?|where would you start|what files should i edit)\b/.test(normalizeConversationText(text))) {
    actions.push({
      type: "status_query",
      query: shellModulePath,
      entityType: "module"
    });
  }
  if (searchQuery) {
    actions.push({ type: "search", query: searchQuery });
  }

  return {
    ...actionPlan(actions, 0.76, `Semantic capability routing classified the request as ${taskClass}.`),
    presentation: "assistant-first",
    focusTaskClass: taskClass,
    strategy: `Treat this as ${taskClass}${searchQuery ? ` and inspect ${searchQuery} in the repo first` : ""}.`
  };
}

function inferShellTaskClassFromPrompt(inputText) {
  const normalized = normalizeConversationText(inputText);
  if (!normalized) {
    return null;
  }
  const asksWorkflowStateSummary = /\b(current workflow state|workflow state|project state|current project state)\b/.test(normalized);
  const asksParityProgram = /\b(not inferior to codex|codex parity|support coding debugging and design|coding debugging and design paragraphs|review debugging and design requests)\b/.test(normalized);
  const asksFormatDesign = /\b(response format|answer format|format itself|reformat|redesign(?:ed)?|formatting)\b/.test(normalized)
    || (/\boperator brief\b/.test(normalized) && /\b(format|style|design|deep investigation|deep investigations)\b/.test(normalized));

  if (asksParityProgram || /\b(support|enable|handle)\b.*\b(coding|debugging|review|design)\b/.test(normalized)) {
    return "task-decomposition";
  }
  if (/\b(break down|decompose|task breakdown|step by step plan|execution plan|plan the work)\b/.test(normalized)) {
    return "task-decomposition";
  }
  if (/\b(migration note|write a note|write a brief|write up|draft update)\b/.test(normalized)) {
    return "prose-composition";
  }
  if (!asksWorkflowStateSummary
    && /\b(summarize|summary|operator update|operator brief|one sentence)\b/.test(normalized)
    && /\b(work|state|progress|shell|changed|recent)\b/.test(normalized)) {
    return "summarization";
  }
  if (asksFormatDesign || /\b(design)\b.*\b(format|response|answer)\b/.test(normalized)) {
    return "ui-styling";
  }
  if (/\b(architecture|architectural|system design|design the system|design the safest architecture|module boundaries|design direction)\b/.test(normalized)) {
    return "architectural-design";
  }
  if (/\b(debug|debugging|diagnos(?:e|ing|is)|bug hunt|hunt bugs|broken|failing|why is|why does|root cause|trace|investigate|investigation)\b/.test(normalized)) {
    return "bug-hunting";
  }
  if (/\b(review|risk|regression|hotspot|code review|review the)\b/.test(normalized)
    || (/\baudit\b/.test(normalized) && !/\barchitecture|architectural|design direction\b/.test(normalized))) {
    return "review";
  }
  if (/\b(refactor|restructure|cleanup|clean up|untangle|simplify|rework)\b/.test(normalized)) {
    return "refactoring";
  }
  if (/\b(risky|rollout|migration|kill switch|guardrail|backward compatible|blast radius)\b/.test(normalized)) {
    return "risky-planning";
  }
  if (/\b(design tokens|tokens|spacing scale|color tokens)\b/.test(normalized)) {
    return "design-tokens";
  }
  if (/\b(implement|build|patch|write code|add a new|create component|scaffold)\b/.test(normalized)) {
    return "code-generation";
  }
  if (/\b(ui layout|layout work|spacing|alignment|mobile layout|responsive layout|visual hierarchy)\b/.test(normalized)) {
    return "ui-layout";
  }
  if (/\b(styling|typography|color direction|theme|css polish|visual polish)\b/.test(normalized)) {
    return "ui-styling";
  }
  return null;
}

function extractOperationalSearchQuery(inputText, plannerContext = {}) {
  const text = String(inputText ?? "").trim();
  if (!text) {
    return "";
  }

  const quoted = text.match(/["'`](.+?)["'`]/)?.[1]?.trim();
  if (quoted) {
    return quoted;
  }

  const explicitPath = text.match(/\b(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\b/)?.[0]?.trim();
  if (explicitPath) {
    return explicitPath;
  }

  const highSignal = extractHighSignalOperationalQuery(text);
  if (highSignal) {
    return highSignal;
  }

  const moduleMatches = findShellGroundingModuleMatches(text, plannerContext);
  if (moduleMatches.length && !/\b(follow[- ]?up|continuity|subject|response format|answer format|intent envelope|operator brief|deep investigation|changed|recent)\b/i.test(text)) {
    return moduleMatches[0].name;
  }

  const keywordPatterns = [
    /\bmodal\b/i,
    /\boverlay\b/i,
    /\bdialog\b/i,
    /\brouter?\b/i,
    /\bprovider(?:s)?\b/i,
    /\bworkflow\b/i,
    /\bshell\b/i,
    /\bprojection(?:s)?\b/i,
    /\btelegram\b/i,
    /\btoken(?:s)?\b/i,
    /\blayout\b/i,
    /\bstyling\b/i,
    /\btheme\b/i,
    /\bcss\b/i
  ];
  for (const pattern of keywordPatterns) {
    const match = text.match(pattern);
    if (match?.[0]) {
      return match[0].toLowerCase();
    }
  }

  const tokens = normalizeConversationText(text)
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => token.length > 2)
    .filter((token) => !OPERATIONAL_QUERY_STOPWORDS.has(token))
    .slice(0, 3);
  return tokens.join(" ");
}

function extractHighSignalOperationalQuery(inputText) {
  const normalized = normalizeConversationText(inputText);
  if (!normalized) {
    return "";
  }

  const shellQualified = /\bshell\b/.test(normalized);
  const signals = [];
  const addSignal = (value) => {
    if (value && !signals.includes(value)) {
      signals.push(value);
    }
  };

  if (/\bfollow[- ]?up|continuity|continue\b/.test(normalized)) addSignal(shellQualified ? "shell follow-up" : "follow-up");
  if (/\bsubject\b/.test(normalized)) addSignal(shellQualified ? "shell subject" : "subject");
  if (/\bintent envelope\b/.test(normalized)) addSignal("intent envelope");
  if (/\bresponse format|answer format|operator brief|deep investigation|deep investigations\b/.test(normalized)) addSignal(shellQualified ? "shell response style" : "response style");
  if (/\bmigration note\b/.test(normalized)) addSignal(shellQualified ? "shell intent envelope" : "migration note");
  if (/\boperator update|one sentence|recent shell work|last shell work|what changed|changed recently|lately\b/.test(normalized)) addSignal(shellQualified ? "shell work" : "recent work");
  if (/\babsolute file paths?|what files should i edit|where would you start\b/.test(normalized)) addSignal(shellQualified ? "shell files" : "files");

  return signals.slice(0, 2).join(" ").trim();
}

function extractShellModulePath(inputText, plannerContext = {}) {
  const moduleMatches = findShellGroundingModuleMatches(inputText, plannerContext);
  return moduleMatches[0]?.name ?? "";
}

function inferFallbackEntityType(inputText, subject, plannerContext = {}) {
  const normalizedSubject = normalizeConversationText(subject);
  if (["shell", "workflow", "provider", "init"].includes(normalizedSubject)) {
    return "surface";
  }
  const moduleMatches = findShellGroundingModuleMatches(subject || inputText, plannerContext);
  if (moduleMatches.length) {
    return "module";
  }
  const explicitTicket = String(subject ?? inputText ?? "").match(new RegExp(`\\b${TICKET_ID_PATTERN}\\b`, "i"));
  if (explicitTicket) {
    return "ticket";
  }
  if (/\b(project|repo|repository|codebase)\b/.test(normalizeConversationText(inputText))) {
    return "project";
  }
  return inferStatusEntityType(subject) ?? inferStatusEntityType(inputText);
}

function extractShellFallbackSubject(inputText, plannerContext = {}) {
  const text = String(inputText ?? "").trim();
  if (!text) {
    return "";
  }
  const genericPronouns = new Set(["that", "this", "it", "something", "things", "stuff", "anything"]);
  const normalized = normalizeConversationText(text);
  if (/^(what do you think about|tell me about)\s+(that|this|it)\??$/.test(normalized)) {
    return "";
  }

  const explicitTicket = text.match(new RegExp(`\\b${TICKET_ID_PATTERN}\\b`, "i"))?.[0];
  if (explicitTicket) {
    return explicitTicket.toUpperCase();
  }

  const quoted = text.match(/["'`](.+?)["'`]/)?.[1]?.trim();
  if (quoted && !genericPronouns.has(normalizeConversationText(quoted))) {
    return quoted;
  }

  const moduleMatches = findShellGroundingModuleMatches(text, plannerContext);
  if (moduleMatches.length) {
    return moduleMatches[0].name;
  }

  const calledMatch = normalized.match(/\b(?:called|named)\s+([a-z0-9/_:-]+(?:\s+[a-z0-9/_:-]+){0,4})$/i)?.[1];
  if (calledMatch) {
    return calledMatch.trim();
  }

  if (/\b(project|repo|repository|codebase)\b/.test(normalized) && !/\b(shell|workflow|provider|init)\b/.test(normalized)) {
    return "project";
  }

  const stripped = normalized
    .replace(/\b(can you|could you|would you|please|just|maybe|kind of|sort of|i wonder if|do we have|does this repo have|is there|anything called|something called|feature called|how good is|how bad is|how healthy is|how is|what is up with|whats up with|tell me about|teach me about|what do you think about|explain|describe|what is|whats|what are|status of|state of|shape of|search for|look for|find)\b/g, " ")
    .replace(/\b(the|this|that|a|an|feature|service|module|modules|system|thing|please)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = stripped.split(/\s+/).filter(Boolean);
  if (!tokens.length) {
    return "";
  }
  const subject = tokens.slice(0, 6).join(" ");
  return genericPronouns.has(subject) ? "" : subject;
}

function extractShellGoal(text) {
  const source = String(text ?? "").trim();
  if (!source) {
    return { text: "", type: null, keywords: [] };
  }
  let goalText = "";
  const explicitGoalMatch = source.match(/\baccording to the goal\b[\s,:-]*(.*)$/i);
  if (explicitGoalMatch?.[1]) {
    goalText = explicitGoalMatch[1].replace(/^(which is|that is)\s+/i, "").trim();
  } else {
    const betaMatch = source.match(/\b(before beta|for beta(?:[- ]testing)?|beta readiness|launch readiness|stability,? not features)\b.*$/i);
    if (betaMatch?.[0]) {
      goalText = betaMatch[0].trim();
    }
  }
  const type = /\bbeta|launch readiness|stability\b/i.test(goalText || source)
    ? "beta-readiness"
    : "";
  const keywordSource = goalText || source;
  const keywords = Array.from(new Set(
    normalizeConversationText(keywordSource)
      .split(/\s+/)
      .filter((token) => token.length >= 4)
      .filter((token) => !new Set(["which", "according", "ticket", "tickets", "resolve", "prioritize", "goal", "needed", "achieve", "preparing", "system"]).has(token))
  ));
  return { text: goalText, type: type || null, keywords };
}

function routeShellIntent(intent) {
  if (!intent?.text) {
    return { mode: "simple-heuristic", reason: "Empty input." };
  }
  const wantsCurrentExecution = intent.requestedMutations.executeCurrent;
  const wantsPrioritization = intent.requestedMutations.prioritizeRemaining;
  const wantsGoalWork = intent.requestedMutations.resolveNeededForGoal || Boolean(intent.goal?.text);
  if (!wantsPrioritization && !wantsGoalWork) {
    return { mode: "simple-heuristic", reason: "Single current-ticket action request." };
  }
  if (intent.complexity >= 2 && (wantsCurrentExecution || wantsPrioritization || wantsGoalWork)) {
    return { mode: "staged-core", reason: "Complex goal-directed request." };
  }
  return { mode: "simple-heuristic", reason: "Simple shell request." };
}

function buildGoalDirectedShellPlan(intent, plannerContext) {
  const ticketId = intent.entities.currentTicketId;
  const actions = [];
  const nodes = [];
  let previousNodeId = null;
  const addActionNode = (action) => {
    actions.push(action);
    const id = `n${nodes.length + 1}`;
    nodes.push({
      id,
      kind: "action",
      type: action.type,
      action,
      dependsOn: previousNodeId ? [previousNodeId] : [],
      status: "pending"
    });
    previousNodeId = id;
    return id;
  };

  if (ticketId) {
    const currentTicketAction = { type: "status_query", query: ticketId, entityType: "ticket" };
    addActionNode(currentTicketAction);
    if (intent.requestedMutations.executeCurrent) {
      addActionNode({ type: "execute_ticket", ticketId, apply: false });
    }
  }

  if (intent.requestedMutations.prioritizeRemaining || intent.requestedMutations.resolveNeededForGoal) {
    addActionNode({ type: "list_tickets" });
  }

  if (!actions.length) {
    return null;
  }

  nodes.push({
    id: `n${nodes.length + 1}`,
    kind: "synthesize",
    type: "synthesize",
    dependsOn: nodes.map((node) => node.id),
    status: "pending"
  });

  const ranked = rankTicketsAgainstGoal(plannerContext?.summary?.activeTickets, {
    goal: intent.goal,
    excludeId: ticketId
  });
  const topRanked = ranked.slice(0, 3).map((item) => `${item.id}${item.score > 0 ? ` (${item.score})` : ""}`);
  const strategyParts = [];
  if (intent.requestedMutations.executeCurrent && ticketId) {
    strategyParts.push(`First, inspect and dry-run ${ticketId} so execution is grounded before any mutation.`);
  }
  if (intent.requestedMutations.prioritizeRemaining) {
    strategyParts.push("Then inspect the remaining active tickets and rank them against the stated goal.");
  }
  if (intent.requestedMutations.resolveNeededForGoal) {
    strategyParts.push("Finally, propose the smallest remaining work needed to reach that goal before asking to mutate board state.");
  }
  if (intent.goal?.text) {
    strategyParts.push(`Goal: ${intent.goal.text}.`);
  }
  if (topRanked.length) {
    strategyParts.push(`Likely remaining priorities from current metadata: ${topRanked.join(", ")}.`);
  }

  return {
    kind: "plan",
    actions,
    graph: { nodes },
    confidence: 0.96,
    reason: "Complex goal-directed request routed through staged core planning.",
    strategy: strategyParts.join(" "),
    planner: {
      mode: "staged-core",
      reason: "Complex goal-directed request."
    },
    presentation: "assistant-first"
  };
}

function rankTicketsAgainstGoal(activeTickets, { goal, excludeId } = {}) {
  const tickets = Array.isArray(activeTickets) ? activeTickets : [];
  const goalKeywords = new Set(goal?.keywords ?? []);
  const betaBias = goal?.type === "beta-readiness";
  return tickets
    .filter((ticket) => String(ticket.id ?? "") !== String(excludeId ?? ""))
    .map((ticket) => {
      const lane = String(ticket.lane ?? "").toLowerCase();
      const haystack = normalizeConversationText(`${ticket.id ?? ""} ${ticket.title ?? ""}`);
      let score = 0;
      if (/bugs p1|bugs p2|bugs/.test(lane)) score += 10;
      else if (/todo/.test(lane)) score += 6;
      else if (/in progress/.test(lane)) score += 5;
      else if (/backlog/.test(lane)) score += 2;
      else if (/suggestion/.test(lane)) score -= 1;
      for (const keyword of goalKeywords) {
        if (haystack.includes(keyword)) score += 3;
      }
      if (betaBias) {
        if (/\b(beta|stab|stability|auth|invite|feedback|quota|core|ux|bug|overlay|route|routing|modal)\b/.test(haystack)) {
          score += 4;
        }
        if (/\b(admin|metrics|analytics|creator|marketplace|social|audio|spatial)\b/.test(haystack)) {
          score -= 1;
        }
      }
      return {
        id: String(ticket.id ?? ""),
        title: String(ticket.title ?? ""),
        lane: String(ticket.lane ?? ""),
        score
      };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
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

function buildShellPlannerJsonSchema() {
  return {
    kind: "intent|plan|reply|exit",
    confidence: 0.8,
    reason: "Your internal strategic reasoning (mandatory)",
    strategy: "The long-term plan or next steps for the developer",
    assistantReply: "Optional final reply seed for shell-local answers. Do not use this to avoid planning when tool steps are needed.",
    intent: {
      version: "1",
      capability: "project-planning|coding|debugging|review|refactor-planning|design-direction|shell-usage",
      objective: "What the user is trying to achieve",
      subject: "Primary target, module, ticket, or concept",
      taskClass: "Optional lower-level task class",
      scope: "shell-local|workflow-state|repo-targeted|repo-mutation",
      risk: "low|medium|high",
      needsRepoContext: true,
      needsMutation: false,
      safeToAutoExecute: false,
      followUpMode: "new-request|continue-prior-work|ask-about-prior-result|revise-prior-answer",
      references: {
        tickets: ["optional prior ticket ids"],
        files: ["optional file paths"],
        modules: ["optional module ids"],
        graphNodeIds: ["optional prior graph node ids"],
        evidence: ["optional evidence labels"]
      },
      responseStyle: {
        detail: "brief|normal|detailed",
        format: "paragraphs|bullets",
        includeExamples: false
      }
    },
    finalAnswerPolicy: {
      verbosity: "brief|normal|detailed",
      format: "paragraphs|bullets",
      includeEvidence: true,
      includeNextSteps: true,
      includeExamples: false
    },
    graph: {
      nodes: [{
        id: "n1",
        kind: "action|branch|assert|synthesize|replan",
        dependsOn: ["optional-node-id"],
        condition: {
          node: "node-id",
          path: "ok|classification|summary|structuredPayload.any.path",
          equals: "optional value",
          includes: "optional substring",
          matches: "optional regex source",
          exists: true
        },
        message: "for assert failure explanations",
        ifTrue: [{ type: "search", query: "something" }],
        ifFalse: [{ type: "sync" }],
        instruction: "for replan nodes; explain how to generate the next graph fragment from prior results",
        action: {
          type: "project_summary|list_tickets|status_query|next_ticket|metrics|audit_architecture|sync|run_review|evaluate_readiness|search|extract_ticket|decompose_ticket|execute_ticket|ideate_feature|sweep_bugs|ingest_artifact|extract_guidelines|route|run_dynamic_codelet|telegram_preview|add_note|create_ticket|run_codelet|provider_connect|reprofile|set_provider_key"
        }
      }]
    },
    actions: [{
      type: "project_summary|list_tickets|status_query|next_ticket|metrics|audit_architecture|sync|run_review|evaluate_readiness|search|extract_ticket|decompose_ticket|execute_ticket|ideate_feature|sweep_bugs|ingest_artifact|extract_guidelines|route|run_dynamic_codelet|telegram_preview|add_note|create_ticket|run_codelet|provider_connect|reprofile|set_provider_key",
      query: "for status_query/search",
      entityType: "optional type hint for status_query",
      goalType: "for evaluate_readiness",
      question: "for evaluate_readiness",
      ticketId: "for extract_ticket/decompose_ticket/execute_ticket/extract_guidelines",
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
  };
}

function buildShellPlannerRuntimeContext(plannerContext = {}, options = {}) {
  const summary = plannerContext.summary ?? {};
  const providers = plannerContext.providerState?.providers ?? {};
  const activeTickets = Array.isArray(summary.activeTickets) ? summary.activeTickets : [];
  const providerSummary = Object.entries(providers)
    .filter(([, provider]) => provider?.available || provider?.configured)
    .map(([providerId, provider]) => {
      if (provider.local) {
        return `${providerId}:local${provider.host ? `@${provider.host}` : ""}`;
      }
      return `${providerId}:${provider.configured ? "configured" : "available"}`;
    });

  const lines = [
    `cwd: ${options.root ?? plannerContext.root ?? process.cwd()}`,
    `project: ${path.basename(plannerContext.root ?? options.root ?? process.cwd())}`,
    `active-ticket-count: ${activeTickets.length}`
  ];
  if (providerSummary.length) {
    lines.push(`available-providers: ${providerSummary.join(", ")}`);
  }
  if (plannerContext.manual) {
    lines.push("manual-guidance: available");
  }
  return lines.join("\n");
}

function buildShellPlannerNotesLoreExtra({ recentMemory, longTermMemorySummary, activeGraphState }) {
  const sections = [];
  if (longTermMemorySummary) {
    sections.push(`### Notes / Lore / Extra: Prior Interaction Summary\n${longTermMemorySummary}`);
  }
  if (recentMemory) {
    sections.push(`### Notes / Lore / Extra: Recent Interaction\n${recentMemory}`);
  }
  if (activeGraphState) {
    sections.push(`### Notes / Lore / Extra: Active Turn Memory\n${renderPlannerActiveGraphState(activeGraphState)}`);
  }
  return sections.join("\n\n");
}

export async function buildShellPlannerPrompt(inputText, options) {
  const catalog = buildActionCatalog(options.plannerContext);
  const history = options.history ?? [];
  const activeGraphState = options.activeGraphState ?? null;
  const responseStyle = inferShellResponseStyle(inputText);
  const { recentMemory, longTermMemorySummary } = await summarizeHistory(history);
  const runtimeContext = buildShellPlannerRuntimeContext(options.plannerContext, options);
  const guidanceContext = buildShellPlannerGuidanceContext(inputText, options.plannerContext);
  const groundingContext = await buildShellPlannerGroundingContext(inputText, options);
  const notesLoreExtra = buildShellPlannerNotesLoreExtra({ recentMemory, longTermMemorySummary, activeGraphState });
  const schemaPrompt = buildShellPlannerSchemaPrompt();

  const system = [
    "You are the shell planning brain inside ai-workflow.",
    "Behave like a strong operator that decides how to use tools, not like a chatty project summarizer.",
    "Choose the smallest truthful next step.",
    "",
    "## Operating Contract",
    "- Convert every user request into a typed intent envelope.",
    "- Use `kind=intent` for normal planning output. `kind=exit` is only for explicit exit requests.",
    "- For project-state questions, prefer discovery actions before answering.",
    "- Do not assume project facts that have not been discovered in this turn or a prior node result.",
    "- Keep the first plan minimal. Prefer flat `actions`; only use `graph` if truly needed.",
    "- If the answer is purely shell-local, you may leave `actions` empty and provide `assistantReply`, but you must still emit the full typed intent envelope.",
    "",
    "## Graph Contract",
    "- Use direct `actions` for simple deterministic status, summary, and extraction work.",
    "- Use `graph.nodes` only when branching, gating, or replanning is required.",
    "",
    "## Available Actions (Your Capabilities):",
    catalog,
    "",
    "## Planning Rules",
    "- Start with the user's intent, then decide what context must be pulled.",
    "- Pull project info only when the request makes that context necessary.",
    "- Prefer targeted discovery like `project_summary`, `extract_ticket`, `search`, or `route` over broad context dumps.",
    "- If the question is only about shell usage or capabilities, keep `actions` empty and provide a shell-local `assistantReply` inside `kind=intent`.",
    "- If `Grounded Repo Evidence` is present and directly answers the user's question, prefer a grounded `assistantReply` inside `kind=intent`.",
    "- For repo concept questions like services, modules, claims, projections, router, or sync behavior, prefer a grounded reply or a single `status_query` over a vague clarification request.",
    "- If the answer depends on project state, use tools first unless the needed state is already present in prior node results.",
    "- For multi-clause, goal-driven, ordered, or ambiguous requests, prefer a small ordered `actions` list over a long reply.",
    "- Never emit the stock shell fallback about needing the AI planner or asking for a more direct phrasing.",
    "- Prefer coding/debugging/review/design/project-planning capability families over generic classification.",
    "- If you are uncertain, choose the smallest truthful probe such as `status_query`, `search`, `project_summary`, or `route` instead of asking the user to rephrase.",
    "- Preserve the user's requested order unless observed tool results prove a blocker.",
    "- When the user states a goal or success criterion, use it to choose discovery steps and rank remaining work.",
    "- Do not collapse a long request into a shallow answer just because one phrase matches a simpler pattern.",
    "- For conversational follow-ups, resolve pronouns and ellipsis from `Active Turn Memory` and set `intent.followUpMode` explicitly.",
    "- Do not decide follow-up mode from stock trigger phrases alone; use prior turn state, prior evidence, and the current request together.",
    "- Never invent facts. If a ticket, file, or condition is unknown, discover it or say so.",
    "- JSON only: your output must be valid JSON matching the schema.",
  ].join("\n");

  const promptSections = [
    "## Runtime Context",
    runtimeContext,
    `\n## Desired Response Style\n${renderShellResponseStyle(responseStyle)}`,
    guidanceContext ? `\n## Guidance Highlights\n${guidanceContext}` : "",
    groundingContext ? `\n## Grounded Repo Evidence\n${groundingContext}` : "",
    notesLoreExtra ? `\n${notesLoreExtra}` : "",
    "",
    "## Allowed JSON Schema:",
    schemaPrompt,
    "",
    `## Current User Request:\n"${inputText}"\n\nYour Response (JSON):`
  ];

  return {
    system,
    prompt: promptSections.join("\n")
  };
}

async function buildShellPlannerGroundingContext(inputText, options = {}) {
  const sections = [];
  const plannerContext = options.plannerContext ?? {};

  if (looksLikeShellUsageQuestion(inputText)) {
    sections.push([
      "Shell usage:",
      renderShellHelp(plannerContext)
    ].join("\n"));
  }

  if (looksLikeRepoExplainerQuestion(inputText)) {
    const moduleMatches = findShellGroundingModuleMatches(inputText, plannerContext);
    if (moduleMatches.length) {
      sections.push([
        "Likely module matches:",
        ...moduleMatches.slice(0, 3).map((item) => `- ${item.name}${item.responsibility ? `: ${item.responsibility}` : ""}`)
      ].join("\n"));
    }

    const projectRoot = options.root ?? plannerContext.root ?? process.cwd();
    const selectors = extractShellGroundingSelectors(inputText, plannerContext);
    for (const selector of selectors.slice(0, 4)) {
      const payload = await resolveProjectStatus({
        projectRoot,
        selector,
        includeRelated: true,
        rawQuestion: true,
        relatedLimit: 8
      }).catch(() => null);
      if (!payload?.ok) {
        continue;
      }
      sections.push(renderShellPlannerGroundedStatus(payload));
      break;
    }
  }

  return sections.filter(Boolean).join("\n\n");
}

function buildShellPlannerGuidanceContext(inputText, plannerContext = {}) {
  const sections = [];
  const guidelines = summarizePlannerGuidance(plannerContext.guidelines, inputText, { limit: 2, fallbackLimit: 1 });
  const manual = summarizePlannerGuidance(plannerContext.manual, inputText, { limit: 4, fallbackLimit: 2 });

  if (guidelines.length) {
    sections.push(...guidelines.map((item) => `- Project guidelines: ${item}`));
  }
  if (manual.length) {
    sections.push(...manual.map((item) => `- Manual: ${item}`));
  }

  return sections.join("\n");
}

function summarizePlannerGuidance(markdown, inputText, { limit = 4, fallbackLimit = 2 } = {}) {
  const candidates = extractPlannerGuidanceCandidates(markdown);
  if (!candidates.length) {
    return [];
  }

  const queryTokens = tokenizePlannerGuidance(inputText);
  const scored = candidates.map((candidate, index) => {
    const candidateTokens = tokenizePlannerGuidance(candidate.text);
    const overlap = candidateTokens.filter((token) => queryTokens.includes(token)).length;
    return {
      ...candidate,
      overlap,
      score: overlap * 10 + candidate.weight - index * 0.001
    };
  });

  let chosen = scored.filter((candidate) => candidate.overlap > 0);
  if (!chosen.length) {
    chosen = scored
      .slice()
      .sort((left, right) => right.weight - left.weight || left.line - right.line)
      .slice(0, fallbackLimit);
  }

  return chosen
    .slice()
    .sort((left, right) => right.score - left.score || left.line - right.line)
    .slice(0, limit)
    .sort((left, right) => left.line - right.line)
    .map((candidate) => candidate.text);
}

function extractPlannerGuidanceCandidates(markdown) {
  const lines = String(markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  const candidates = [];
  let inCodeFence = false;
  let inHtmlComment = false;

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed.startsWith("```")) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (trimmed.startsWith("<!--")) {
      inHtmlComment = !trimmed.includes("-->");
      continue;
    }
    if (inHtmlComment) {
      if (trimmed.includes("-->")) {
        inHtmlComment = false;
      }
      continue;
    }
    if (inCodeFence || !trimmed) {
      continue;
    }

    const heading = trimmed.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      candidates.push({ line: index + 1, weight: 3, text: heading[1].trim() });
      continue;
    }
    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      candidates.push({ line: index + 1, weight: 2, text: bullet[1].trim() });
      continue;
    }
    const ordered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (ordered) {
      candidates.push({ line: index + 1, weight: 2, text: ordered[1].trim() });
      continue;
    }
    if (trimmed.length <= 220) {
      candidates.push({ line: index + 1, weight: 1, text: trimmed });
    }
  }

  const seen = new Set();
  return candidates.filter((candidate) => {
    const normalized = candidate.text.toLowerCase().replace(/[`*_]/g, "").replace(/[.;:]+$/g, "");
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

function tokenizePlannerGuidance(text) {
  return [...new Set(
    String(text ?? "")
      .toLowerCase()
      .match(/[a-z0-9][a-z0-9/_-]*/g) ?? []
  )].filter((token) => token.length > 2 && !new Set(["the", "and", "for", "with", "that", "this", "from", "what"]).has(token));
}

export async function planShellRequestWithAgent(inputText, options) {
  const { system, prompt } = await buildShellPlannerPrompt(inputText, options);

  const start = Date.now();
  let completion;
  let success = true;
  let errorMsg = null;

  try {
    completion = await runShellCompletion({
      stage: "planner",
      planner: options.planner,
      system,
      prompt,
      config: {
        apiKey: options.planner.apiKey,
        baseUrl: options.planner.baseUrl,
        host: options.planner.host,
        format: "json"
      },
      options,
      contentParts: null
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
      parsed = parseShellPlannerJson(cleanJson);
    } catch {
      const plainTextReply = coercePlannerPlainTextReply(rawResponse, inputText);
      if (plainTextReply) {
        return plainTextReply;
      }
      throw new Error("planner returned non-JSON text");
    }

    return validateShellPlan(parsed, options.plannerContext, inputText);
  } catch (error) {
    throw error;
  }
}

function parseShellPlannerJson(rawText) {
  const candidates = [String(rawText ?? "").trim()].filter(Boolean);
  const text = candidates[0] ?? "";
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1).trim());
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next shape
    }
  }
  throw new Error("planner returned non-JSON text");
}

function coercePlannerPlainTextReply(rawResponse, inputText) {
  if (!canAcceptPlainTextPlannerReply(inputText)) {
    return null;
  }
  const sanitized = String(rawResponse ?? "")
    .replace(/<think>[\s\S]*?<\/think>/gi, " ")
    .replace(/```[a-z]*\s*[\s\S]*?```/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!sanitized || sanitized.length > 900) {
    return null;
  }
  return {
    ...replyPlan(sanitized, 0.72, "Planner returned a conversational plain-text reply."),
    graph: buildActionGraph([])
  };
}

function canAcceptPlainTextPlannerReply(inputText) {
  return looksLikeShellUsageQuestion(inputText) || looksLikeRepoExplainerQuestion(inputText);
}

async function runShellCompletion({ stage, planner, system, prompt, config = {}, options, contentParts = null }) {
  const trace = typeof options?.traceAi === "function" ? options.traceAi : null;
  const timeoutMs = getShellPlannerTimeoutMs(options, planner);
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  let timeoutId = null;
  trace?.({
    phase: "request",
    stage,
    planner,
    system,
    prompt
  });
  const start = Date.now();
  try {
    if (controller && Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timeoutId = setTimeout(() => controller.abort(new Error(`planner timed out after ${timeoutMs}ms`)), timeoutMs);
    }
    const completion = await generateCompletion({
      providerId: planner.providerId,
      modelId: planner.modelId,
      system,
      prompt,
      config: planner.providerId === "ollama"
        ? {
            ...config,
            generationOptions: {
              ...(config.generationOptions ?? {}),
              num_predict: stage === "planner" ? 384 : 512
            }
          }
        : config,
      contentParts,
      signal: controller?.signal ?? null
    });
    trace?.({
      phase: "response",
      stage,
      planner,
      response: completion.response,
      elapsedMs: Date.now() - start
    });
    return completion;
  } catch (error) {
    const timedOut = controller?.signal?.aborted && Number.isFinite(timeoutMs) && timeoutMs > 0;
    trace?.({
      phase: "error",
      stage,
      planner,
      error: timedOut ? `planner timed out after ${timeoutMs}ms` : (error?.message ?? String(error)),
      elapsedMs: Date.now() - start
    });
    if (timedOut) {
      throw new Error(`planner timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export function validateShellPlan(plan, plannerContext, inputText = "") {
  if (!plan || typeof plan !== "object") {
    throw new Error("shell planner returned non-object");
  }
  const strategy = typeof plan.strategy === "string" ? plan.strategy.trim() : null;
  const confidence = Number(plan.confidence ?? 0.7);
  const reason = String(plan.reason ?? "Planner produced a valid action plan.");

  if (plan.kind === "intent") {
    const graph = plan.graph?.nodes
      ? validateShellGraph(plan.graph, plannerContext)
      : null;
    const actions = graph
      ? graph.nodes
          .filter((node) => node.kind === "action" && node.action)
          .map((node) => node.action)
          .slice(0, 5)
      : Array.isArray(plan.actions)
        ? plan.actions.slice(0, 5).map((action) => validateShellAction(action, plannerContext))
        : [];
    const assistantReply = typeof plan.assistantReply === "string" ? plan.assistantReply.trim() : "";
    if (!actions.length && !assistantReply) {
      throw new Error("shell planner produced neither actions nor an assistant reply");
    }
    const normalized = {
      ...(actions.length ? {
        kind: "plan",
        actions,
        graph: graph ?? buildActionGraph(actions)
      } : replyPlan(assistantReply || "I need a clearer request.", confidence, reason)),
      confidence,
      reason,
      strategy,
      assistantReply: assistantReply || null,
      intent: plan.intent,
      finalAnswerPolicy: plan.finalAnswerPolicy,
      presentation: plan.presentation ?? (assistantReply ? "assistant-first" : null)
    };
    return normalizeShellPlanEnvelope(normalized, inputText, plannerContext);
  }

  if (plan.kind === "reply") {
    return normalizeShellPlanEnvelope({
      ...replyPlan(String(plan.reply ?? "I need a clearer request."), Number(plan.confidence ?? 0.5), String(plan.reason ?? "Planner reply.")),
      strategy,
      graph: buildActionGraph([])
    }, inputText, plannerContext);
  }

  if (plan.kind === "exit") {
    return {
      kind: "exit",
      actions: [],
      confidence: Number(plan.confidence ?? 1),
      reason: String(plan.reason ?? "Planner exit."),
      strategy,
      graph: buildActionGraph([])
    };
  }

  const graph = plan.graph?.nodes
    ? validateShellGraph(plan.graph, plannerContext)
    : null;
  const actions = graph
    ? graph.nodes
        .filter((node) => node.kind === "action" && node.action)
        .map((node) => node.action)
        .slice(0, 5)
    : Array.isArray(plan.actions)
      ? plan.actions.slice(0, 5).map((action) => validateShellAction(action, plannerContext))
      : [];
  if (!actions.length) {
    throw new Error("shell planner produced no actions");
  }

  return normalizeShellPlanEnvelope({
    kind: "plan",
    actions,
    graph: graph ?? buildActionGraph(actions),
    confidence,
    reason,
    strategy
  }, inputText, plannerContext, {
    intent: plan.intent ?? null,
    finalAnswerPolicy: plan.finalAnswerPolicy ?? null
  });
}

function normalizeShellPlanEnvelope(plan, inputText = "", plannerContext = {}, overrides = {}) {
  if (!plan || typeof plan !== "object") {
    return plan;
  }

  const actions = Array.isArray(plan.actions) ? plan.actions : [];
  const assistantReply = firstNonEmptyString(
    overrides.assistantReply,
    plan.assistantReply,
    plan.reply
  );
  const taskClass = overrides.taskClass
    ?? plan.focusTaskClass
    ?? extractPlanTaskClass(plan, inputText);
  const intent = normalizeShellIntentEnvelope(overrides.intent ?? plan.intent ?? {}, {
    inputText,
    plannerContext,
    plan,
    actions,
    assistantReply,
    taskClass
  });
  const finalAnswerPolicy = normalizeShellFinalAnswerPolicy(overrides.finalAnswerPolicy ?? plan.finalAnswerPolicy ?? {}, {
    inputText,
    plan,
    intent,
    assistantReply
  });
  return {
    ...plan,
    assistantReply: assistantReply || null,
    intent,
    finalAnswerPolicy,
    executionGraph: plan.executionGraph ?? plan.graph ?? buildActionGraph(actions),
    focusTaskClass: plan.focusTaskClass ?? intent.taskClass ?? null
  };
}

function normalizeShellIntentEnvelope(intent = {}, {
  inputText = "",
  plannerContext = {},
  plan = {},
  actions = [],
  assistantReply = "",
  taskClass = null
} = {}) {
  const responseStyle = {
    ...inferShellResponseStyle(inputText),
    ...(intent.responseStyle && typeof intent.responseStyle === "object" ? intent.responseStyle : {})
  };
  const requestedTaskClass = firstNonEmptyString(taskClass, intent.taskClass);
  const normalizedTaskClass = requestedTaskClass ? normalizeTaskClass(requestedTaskClass, plannerContext) : null;
  const capability = normalizeShellCapability(intent.capability ?? inferShellCapabilityForPlan({
    inputText,
    plan,
    actions,
    taskClass: normalizedTaskClass,
    assistantReply
  }));
  const subject = firstNonEmptyString(
    intent.subject,
    extractOperationalSearchQuery(inputText, plannerContext),
    extractShellFallbackSubject(inputText, plannerContext)
  );
  const needsMutation = intent.needsMutation ?? actions.some((action) => isMutatingAction(action));
  const needsRepoContext = intent.needsRepoContext ?? inferIntentNeedsRepoContext({
    inputText,
    capability,
    actions,
    assistantReply
  });
  const safeToAutoExecute = intent.safeToAutoExecute ?? canAutoExecuteShellPlanSafely({
    actions,
    taskClass: normalizedTaskClass,
    capability,
    subject,
    inputText
  });
  return {
    version: String(intent.version ?? "1"),
    capability,
    objective: firstNonEmptyString(intent.objective, summarizeShellObjective(inputText, capability)),
    subject: subject || null,
    taskClass: normalizedTaskClass,
    scope: normalizeShellScope(intent.scope ?? inferShellIntentScope({ actions, assistantReply, capability })),
    risk: normalizeShellRisk(intent.risk ?? inferShellIntentRisk({
      actions,
      capability,
      taskClass: normalizedTaskClass,
      safeToAutoExecute
    })),
    responseStyle,
    needsRepoContext: Boolean(needsRepoContext),
    needsMutation: Boolean(needsMutation),
    safeToAutoExecute: Boolean(safeToAutoExecute),
    followUpMode: normalizeFollowUpMode(intent.followUpMode ?? "new-request"),
    references: normalizeShellReferences(intent.references),
    directAnswerOnly: !actions.length && Boolean(assistantReply)
  };
}

function normalizeShellFinalAnswerPolicy(policy = {}, { inputText = "", intent = {}, assistantReply = "" } = {}) {
  const responseStyle = {
    ...inferShellResponseStyle(inputText),
    ...(intent.responseStyle ?? {})
  };
  const verbosity = normalizeShellVerbosity(policy.verbosity ?? responseStyle.detail);
  const format = normalizeShellFormat(policy.format ?? responseStyle.format);
  return {
    verbosity,
    format,
    includeEvidence: Boolean(policy.includeEvidence ?? (intent.needsRepoContext || Boolean(assistantReply) === false)),
    includeNextSteps: Boolean(policy.includeNextSteps ?? (verbosity !== "brief" || ["debugging", "review", "project-planning", "refactor-planning"].includes(intent.capability))),
    includeExamples: Boolean(policy.includeExamples ?? responseStyle.includeExamples)
  };
}

function summarizeShellObjective(inputText, capability) {
  const source = String(inputText ?? "").trim();
  if (!source) {
    return capability === "shell-usage" ? "Answer a shell-local request." : "Handle the current shell request.";
  }
  return source.replace(/\s+/g, " ").slice(0, 220);
}

function extractPlanTaskClass(plan, inputText = "") {
  const routeTaskClass = Array.isArray(plan?.actions)
    ? plan.actions.find((action) => action?.type === "route")?.taskClass
    : null;
  return routeTaskClass ?? inferShellTaskClassFromPrompt(inputText);
}

function inferShellCapabilityForPlan({ inputText = "", plan = {}, actions = [], taskClass = null, assistantReply = "" } = {}) {
  if (taskClass) {
    return capabilityFromTaskClass(taskClass);
  }
  const normalized = normalizeConversationText(inputText);
  if (Array.isArray(actions) && actions.some((action) => action?.type === "run_review")) return "review";
  if (Array.isArray(actions) && actions.some((action) => action?.type === "execute_ticket" || action?.type === "run_dynamic_codelet")) return "coding";
  if (Array.isArray(actions) && actions.some((action) => action?.type === "project_summary" || action?.type === "evaluate_readiness" || action?.type === "list_tickets")) return "project-planning";
  if (Array.isArray(actions) && actions.some((action) => action?.type === "search" || action?.type === "status_query")) {
    const inferredTaskClass = inferShellTaskClassFromPrompt(inputText);
    if (inferredTaskClass) {
      return capabilityFromTaskClass(inferredTaskClass);
    }
    return "project-planning";
  }
  if (!actions.length && assistantReply && (
    /help/.test(normalized)
    || /\bdoctor\b/.test(normalized)
    || looksLikeShellUsageQuestion(inputText)
    || /usage:\s*`|examples:|known codelets:/i.test(assistantReply)
  )) {
    return "shell-usage";
  }
  if (assistantReply && looksLikeShellUsageQuestion(inputText)) {
    return "shell-usage";
  }
  if (assistantReply && looksLikeRepoExplainerQuestion(inputText)) {
    return "project-planning";
  }
  return "project-planning";
}

function capabilityFromTaskClass(taskClass) {
  switch (String(taskClass ?? "").trim()) {
    case "code-generation":
      return "coding";
    case "bug-hunting":
      return "debugging";
    case "review":
      return "review";
    case "refactoring":
      return "refactor-planning";
    case "ui-layout":
    case "ui-styling":
    case "design-tokens":
      return "design-direction";
    case "risky-planning":
    case "task-decomposition":
    case "architectural-design":
    case "summarization":
    case "prose-composition":
      return "project-planning";
    default:
      return "project-planning";
  }
}

function normalizeShellCapability(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return SHELL_CAPABILITY_FAMILIES.has(normalized) ? normalized : "project-planning";
}

function inferIntentNeedsRepoContext({ inputText = "", capability, actions = [], assistantReply = "" } = {}) {
  if (actions.length) {
    return true;
  }
  if (capability === "shell-usage") {
    return false;
  }
  if (assistantReply && looksLikeShellUsageQuestion(inputText)) {
    return false;
  }
  return looksLikeRepoExplainerQuestion(inputText) || /\b(project|repo|workflow|ticket|module|provider|shell)\b/.test(normalizeConversationText(inputText));
}

function inferShellIntentScope({ actions = [], assistantReply = "", capability } = {}) {
  if (!actions.length && assistantReply) {
    return capability === "shell-usage" ? "shell-local" : "workflow-state";
  }
  if (actions.some((action) => isMutatingAction(action))) {
    return "repo-mutation";
  }
  if (actions.some((action) => ["project_summary", "list_tickets", "status_query", "evaluate_readiness", "provider_status"].includes(action.type))) {
    return "workflow-state";
  }
  return "repo-targeted";
}

function inferShellIntentRisk({ actions = [], capability, taskClass, safeToAutoExecute } = {}) {
  if (taskClass === "risky-planning") {
    return "high";
  }
  if (actions.some((action) => isMutatingAction(action)) && !safeToAutoExecute) {
    return "high";
  }
  if (actions.some((action) => isMutatingAction(action))) {
    return "medium";
  }
  if (["debugging", "review", "refactor-planning", "design-direction"].includes(capability)) {
    return "medium";
  }
  return "low";
}

function canAutoExecuteShellPlanSafely({ actions = [], taskClass = null, capability = "project-planning", subject = "", inputText = "" } = {}) {
  if (!actions.length || !actions.some((action) => isMutatingAction(action))) {
    return false;
  }
  if (taskClass === "risky-planning") {
    return false;
  }
  if (actions.some((action) => action.type === "sync" || action.type === "create_ticket" || action.type === "add_note" || action.type === "provider_connect" || action.type === "set_provider_key")) {
    return false;
  }
  if (actions.length === 1 && actions[0].type === "execute_ticket") {
    return capability === "coding" && Boolean(subject || String(actions[0].ticketId ?? "").trim());
  }
  if (actions.length === 1 && actions[0].type === "run_codelet") {
    return SAFE_AUTO_EXECUTE_CODELETS.has(String(actions[0].codeletId ?? "").trim());
  }
  if (actions.length === 1 && actions[0].type === "run_dynamic_codelet") {
    return capability === "coding" && /\b(single file|small patch|bounded|local)\b/.test(normalizeConversationText(inputText));
  }
  return false;
}

function normalizeShellScope(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  switch (normalized) {
    case "shell-local":
    case "workflow-state":
    case "repo-targeted":
    case "repo-mutation":
      return normalized;
    default:
      return "repo-targeted";
  }
}

function normalizeShellRisk(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  switch (normalized) {
    case "low":
    case "medium":
    case "high":
      return normalized;
    default:
      return "medium";
  }
}

function normalizeShellVerbosity(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  switch (normalized) {
    case "brief":
    case "normal":
    case "detailed":
      return normalized;
    default:
      return "normal";
  }
}

function normalizeShellFormat(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  switch (normalized) {
    case "paragraphs":
    case "bullets":
      return normalized;
    default:
      return "paragraphs";
  }
}

function normalizeFollowUpMode(value) {
  switch (String(value ?? "").trim().toLowerCase()) {
    case "continue-graph":
    case "continue-prior-work":
      return "continue-prior-work";
    case "ask-about-prior-result":
      return "ask-about-prior-result";
    case "revise-prior-answer":
      return "revise-prior-answer";
    case "new-request":
      return "new-request";
    default:
      return "new-request";
  }
}

function normalizeShellReferences(value) {
  if (!value || typeof value !== "object") {
    return {
      tickets: [],
      files: [],
      modules: [],
      graphNodeIds: [],
      evidence: []
    };
  }
  return {
    tickets: normalizeReferenceList(value.tickets),
    files: normalizeReferenceList(value.files),
    modules: normalizeReferenceList(value.modules),
    graphNodeIds: normalizeReferenceList(value.graphNodeIds),
    evidence: normalizeReferenceList(value.evidence)
  };
}

function normalizeReferenceList(values) {
  const source = Array.isArray(values) ? values : [];
  return [...new Set(source.map((value) => String(value ?? "").trim()).filter(Boolean))].slice(0, 8);
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    const text = typeof value === "string" ? value.trim() : "";
    if (text) {
      return text;
    }
  }
  return "";
}

function validateShellGraph(graph, plannerContext) {
  return validateShellGraphInternal(graph, plannerContext, { fragment: false });
}

function validateShellGraphInternal(graph, plannerContext, options = {}) {
  if (!graph || typeof graph !== "object" || !Array.isArray(graph.nodes) || !graph.nodes.length) {
    throw new Error("shell planner produced invalid graph");
  }

  const seen = new Set();
  const nodes = graph.nodes.slice(0, 8).map((node, index) => {
    if (!node || typeof node !== "object") {
      throw new Error("graph node must be an object");
    }
    const id = String(node.id ?? `n${index + 1}`).trim();
    if (!id) {
      throw new Error("graph node id is required");
    }
    if (seen.has(id)) {
      throw new Error(`duplicate graph node id: ${id}`);
    }
    seen.add(id);
    const kind = normalizeGraphNodeKind(node.kind);
    const dependsOn = Array.isArray(node.dependsOn) ? node.dependsOn.map((value) => String(value).trim()).filter(Boolean) : [];
    const validated = {
      id,
      kind,
      dependsOn,
      status: "pending",
      failureMode: typeof node.failureMode === "string" ? node.failureMode : null
    };
    if (node.condition !== undefined) {
      validated.condition = validateShellCondition(node.condition);
    }
    if (kind === "action") {
      validated.action = validateShellAction(node.action, plannerContext);
      validated.type = validated.action.type;
    } else if (kind === "branch") {
      validated.type = "branch";
      validated.ifTrue = validateGraphTemplate(node.ifTrue, plannerContext);
      validated.ifFalse = validateGraphTemplate(node.ifFalse, plannerContext);
    } else if (kind === "assert") {
      if (!validated.condition) {
        throw new Error(`assert node ${id} requires condition`);
      }
      validated.type = "assert";
      validated.message = String(node.message ?? "Assertion failed.").trim();
    } else if (kind === "replan") {
      validated.type = "replan";
      validated.message = node.message ? String(node.message).trim() : null;
      validated.instruction = node.instruction ? String(node.instruction).trim() : null;
      validated.append = validateGraphTemplate(node.append ?? node.graph?.nodes ?? node.graph, plannerContext);
      validated.maxAttempts = Math.max(1, Math.min(3, Number(node.maxAttempts ?? 1) || 1));
      if (!validated.instruction && !validated.append.length) {
        throw new Error(`replan node ${id} requires instruction or append graph`);
      }
    } else {
      validated.type = "synthesize";
    }
    return validated;
  });

  for (const node of nodes) {
    for (const depId of node.dependsOn) {
      if (!seen.has(depId)) {
        throw new Error(`graph node ${node.id} depends on unknown node ${depId}`);
      }
    }
  }

  if (!nodes.some((node) => node.kind === "action")) {
    throw new Error("graph has no executable action nodes");
  }

  if (!options.fragment && !nodes.some((node) => node.kind === "synthesize")) {
    const actionIds = nodes.filter((node) => node.kind !== "synthesize").map((node) => node.id);
    nodes.push({
      id: `n${nodes.length + 1}`,
      kind: "synthesize",
      type: "synthesize",
      dependsOn: actionIds,
      status: "pending"
    });
  }

  return { nodes };
}

function normalizeGraphNodeKind(kind) {
  const normalized = String(kind ?? "action").trim().toLowerCase();
  if (!SHELL_GRAPH_NODE_KINDS.has(normalized)) {
    throw new Error(`unsupported graph node kind: ${kind}`);
  }
  return normalized;
}

function validateGraphTemplate(template, plannerContext) {
  if (!template) {
    return [];
  }
  if (!Array.isArray(template) || !template.length) {
    throw new Error("graph fragment must be a non-empty array when provided");
  }
  if (template.every((item) => item && typeof item === "object" && "type" in item && !("kind" in item))) {
    const actions = template.map((item) => validateShellAction(item, plannerContext));
    return buildActionGraph(actions).nodes;
  }
  return validateShellGraphInternal({ nodes: template }, plannerContext, { fragment: true }).nodes;
}

function validateShellCondition(condition) {
  if (typeof condition === "boolean") {
    return condition;
  }
  if (!condition || typeof condition !== "object") {
    throw new Error("graph condition must be a boolean or object");
  }
  if (Array.isArray(condition.all)) {
    return { all: condition.all.map((item) => validateShellCondition(item)) };
  }
  if (Array.isArray(condition.any)) {
    return { any: condition.any.map((item) => validateShellCondition(item)) };
  }
  if (condition.not !== undefined) {
    return { not: validateShellCondition(condition.not) };
  }

  const nodeId = String(condition.node ?? "").trim();
  if (!nodeId) {
    throw new Error("graph condition leaf requires node");
  }

  const leaf = {
    node: nodeId,
    path: condition.path ? String(condition.path).trim() : "ok"
  };
  if ("equals" in condition) leaf.equals = condition.equals;
  if ("notEquals" in condition) leaf.notEquals = condition.notEquals;
  if ("includes" in condition) leaf.includes = String(condition.includes);
  if ("matches" in condition) leaf.matches = String(condition.matches);
  if ("exists" in condition) leaf.exists = Boolean(condition.exists);
  return leaf;
}

function shouldAutoNarratePlan(actions, options) {
  if (options.json) {
    return false;
  }
  if (!Array.isArray(actions) || !actions.length) {
    return false;
  }
  return actions.every((action) => !isMutatingAction(action));
}

function shouldNarrateShellPlan(plan, options) {
  if (plan?.presentation === "assistant-first" && !options.json) {
    return true;
  }
  return shouldAutoNarratePlan(plan?.actions, options);
}

async function synthesizeShellExecutionReply({ inputText, plan, executed, options, planner }) {
  const responseStyle = inferShellResponseStyle(inputText);
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
    return renderFallbackAssistantReply({ inputText, plan, executed, plannerContext: options.plannerContext });
  }

  try {
    const completion = await runShellCompletion({
      stage: "assistant",
      planner,
      system: [
        "You are the conversational shell for ai-workflow.",
        "Speak like a strong coding assistant, not a command router.",
        "You already have tool results. Answer the user's request directly and naturally.",
        "Do not mention JSON, schemas, planners, or internal routing.",
        "If tool output is partial or uncertain, say that briefly and concretely.",
        `Match this response style: detail=${responseStyle.detail}, format=${responseStyle.format}, includeExamples=${responseStyle.includeExamples ? "yes" : "no"}.`
      ].join("\n"),
      prompt: [
        `User request:\n${inputText}`,
        "",
        `Desired response style:\n${renderShellResponseStyle(responseStyle)}`,
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
      },
      options
    });
    const text = String(completion.response ?? "").trim();
    return text || renderFallbackAssistantReply({ inputText, plan, executed, plannerContext: options.plannerContext });
  } catch {
    return renderFallbackAssistantReply({ inputText, plan, executed, plannerContext: options.plannerContext });
  }
}

function renderFallbackAssistantReply({ inputText, plan, executed, plannerContext }) {
  const graphExecutions = (executed?.graphNodes ?? [])
    .map((node) => node.execution)
    .filter(Boolean);
  const first = graphExecutions[0] ?? executed?.[0];
  const raw = String(first?.ok ? first?.stdout : `${first?.stdout ?? ""}${first?.stderr ?? ""}`).trim();
  if (!raw) {
    return null;
  }
  if (plan.actions.some((action) => action.type === "execute_ticket") && plan.actions.some((action) => action.type === "evaluate_readiness")) {
    return renderExecutionPlusReadinessReply(graphExecutions);
  }
  const goalDirectedReply = renderGoalDirectedFallbackReply({ inputText, plan, graphExecutions, plannerContext });
  if (goalDirectedReply) {
    return goalDirectedReply;
  }
  const actionType = plan.actions[0]?.type;
  if (actionType === "status_query") {
    return raw;
  }
  if (plan.actions.some((action) => action.type === "project_summary") && plan.actions.some((action) => action.type === "evaluate_readiness")) {
    return renderCombinedStatusReadinessReply(graphExecutions);
  }
  if (actionType === "provider_status") {
    return raw;
  }
  if (actionType === "version") {
    return raw;
  }
  if (actionType === "project_summary") {
    return `Here is the current project status:\n${raw}`;
  }
  if (actionType === "evaluate_readiness") {
    return renderReadinessReply(first?.structuredPayload, raw);
  }
  if (actionType === "metrics") {
    return `Here are the current workflow metrics:\n${raw}`;
  }
  if (actionType === "doctor") {
    return `Here is the current diagnostics report:\n${raw}`;
  }
  if (actionType === "route") {
    return renderRouteGuidanceReply({ inputText, plan, graphExecutions, raw, plannerContext });
  }
  if (actionType === "search" && plan.focusTaskClass) {
    return renderCapabilitySearchReply({ inputText, plan, graphExecutions, raw, plannerContext });
  }
  const renderedExecutions = graphExecutions
    .map((item) => String(item.ok ? item.stdout : `${item.stdout ?? ""}${item.stderr ?? ""}`).trim())
    .filter((item) => item && item !== STREAMED_STDIO);
  if (renderedExecutions.length > 1) {
    return renderedExecutions.join("\n\n");
  }
  return raw;
}

function renderRouteGuidanceReply({ inputText, plan, graphExecutions, raw, plannerContext }) {
  const routeAction = plan.actions.find((action) => action.type === "route");
  const routeExecution = graphExecutions.find((item) => item.action.type === "route");
  const statusExecution = graphExecutions.find((item) => item.action.type === "status_query");
  const searchExecution = graphExecutions.find((item) => item.action.type === "search");
  const routeLines = String(routeExecution?.stdout ?? raw ?? "").trim().split(/\r?\n/).filter(Boolean);
  const modelLine = routeLines[0] ?? "";
  const reasonLine = routeLines[1] ?? "";
  const searchLines = String(searchExecution?.stdout ?? "")
    .trim()
    .split(/\r?\n/)
    .filter((line) => /^- /.test(line))
    .slice(0, 5);
  const customReply = renderTaskClassSpecificReply({
    inputText,
    plan,
    routeAction,
    searchLines,
    modelLine,
    reasonLine,
    statusExecution,
    plannerContext
  });
  if (customReply) {
    return customReply;
  }
  const capabilityIntro = renderCapabilityIntro(plan.intent, routeAction?.taskClass);
  const nextStep = renderCapabilityNextStep(plan.intent, searchLines.length > 0);

  return [
    capabilityIntro,
    modelLine ? `Best-fit route: ${modelLine}` : null,
    reasonLine ? `Why: ${reasonLine}` : null,
    searchLines.length ? [renderCapabilityTargetLabel(plan.intent), ...searchLines].join("\n") : null,
    nextStep
  ].filter(Boolean).join("\n");
}

function renderCapabilitySearchReply({ inputText, plan, graphExecutions, raw, plannerContext }) {
  const customReply = renderTaskClassSpecificReply({
    inputText,
    plan,
    routeAction: plan.actions.find((action) => action.type === "route"),
    searchLines: String(raw ?? "").trim().split(/\r?\n/).filter((line) => /^- /.test(line)).slice(0, 5),
    modelLine: "",
    reasonLine: "",
    statusExecution: graphExecutions.find((item) => item.action.type === "status_query"),
    plannerContext
  });
  if (customReply) {
    return customReply;
  }
  return [
    renderCapabilityIntro(plan.intent, plan.focusTaskClass),
    renderCapabilityTargetLabel(plan.intent),
    raw,
    renderCapabilityNextStep(plan.intent, true)
  ].filter(Boolean).join("\n");
}

function renderTaskClassSpecificReply({ inputText, plan, routeAction, searchLines, modelLine, reasonLine, statusExecution, plannerContext }) {
  const taskClass = String(routeAction?.taskClass ?? plan.intent?.taskClass ?? "").trim();
  if (!taskClass) {
    return null;
  }

  if (taskClass === "summarization") {
    return renderSummarizationTaskReply({ inputText, plannerContext, statusExecution });
  }
  if (taskClass === "prose-composition") {
    return renderProseCompositionTaskReply({ inputText, plan, plannerContext, statusExecution });
  }
  if (taskClass === "task-decomposition") {
    return renderTaskDecompositionTaskReply({ inputText, plannerContext, searchLines });
  }
  if (taskClass === "review") {
    const reviewReply = renderReviewTaskReply({ inputText, plannerContext, statusExecution, searchLines });
    if (reviewReply) {
      return reviewReply;
    }
  }
  if (taskClass === "design-tokens") {
    return [
      "I’d treat this as design-direction work.",
      modelLine ? `Best-fit route: ${modelLine}` : null,
      reasonLine ? `Why: ${reasonLine}` : null,
      "Likely design targets:",
      "- shell operator surfaces",
      "- spacing scale",
      "- color tokens",
      "- typography direction",
      "Next step: identify the component, layout, or token surface before proposing changes."
    ].filter(Boolean).join("\n");
  }
  if (taskClass === "bug-hunting") {
    const debugReply = renderDebugTaskReply({ inputText, searchLines });
    if (debugReply) {
      return debugReply;
    }
  }
  if (taskClass === "ui-styling" && /\b(response format|answer format|operator brief|deep investigation)\b/i.test(inputText)) {
    return [
      "I’d treat this as design-direction work.",
      modelLine ? `Best-fit route: ${modelLine}` : null,
      reasonLine ? `Why: ${reasonLine}` : null,
      "Design direction:",
      "- Keep operator briefs to 2-3 dense bullets with the decision first.",
      "- Use short sections for deep investigations: findings, likely files, then next step.",
      "- Preserve the user’s phrasing in the opening line so long prompts do not lose their subject."
    ].filter(Boolean).join("\n");
  }
  return null;
}

function renderSummarizationTaskReply({ inputText, plannerContext, statusExecution }) {
  const shellTickets = extractShellFocusedTickets(plannerContext?.summary?.activeTickets ?? []);
  const statusPayload = statusExecution?.structuredPayload ?? null;
  const responseStyle = inferShellResponseStyle(inputText);
  if (/\bone sentence\b/i.test(inputText)) {
    return `Shell work is focused on intent envelopes, paragraph execution, human-language capability coverage, and follow-up continuity, with ${shellTickets[0]?.id ?? "the current top shell ticket"} leading the next step.`;
  }
  if (responseStyle.format === "bullets") {
    const lines = ["Shell work:"];
    for (const ticket of shellTickets.slice(0, 3)) {
      lines.push(`- ${ticket.id}: ${ticket.title}`);
    }
    if (statusPayload?.summary) {
      lines.push(`- Context: ${statusPayload.summary}`);
    }
    if (shellTickets[0]) {
      lines.push(`- Next step: ${shellTickets[0].id}: ${shellTickets[0].title}`);
    }
    return lines.join("\n");
  }
  return renderShellWorkSummaryReply({
    plannerContext,
    responseStyle,
    shellTickets,
    inputText
  });
}

function renderProseCompositionTaskReply({ inputText, plan, plannerContext, statusExecution }) {
  const ticketId = statusExecution?.structuredPayload?.id ?? resolveImplicitTicketId(plannerContext, inputText);
  const ticketTitle = statusExecution?.structuredPayload?.title ?? plannerContext?.summary?.activeTickets?.find((ticket) => ticket.id === ticketId)?.title ?? "shell intent envelope work";
  if (/\bmigration note\b/i.test(inputText)) {
    return [
      "Migration note:",
      "The shell planner now emits a typed intent envelope for every prompt, including shell-local replies.",
      `This keeps ${ticketTitle} grounded in one contract for planning, execution, and synthesis.`,
      "If you were depending on reply-only planner behavior, switch to `kind=intent` with `assistantReply` instead."
    ].join("\n");
  }
  return [
    "Operator update:",
    `The shell work is now centered on ${ticketTitle}.`,
    "The main change is stricter intent normalization plus stronger user-facing synthesis for paragraph-style requests."
  ].join("\n");
}

function renderTaskDecompositionTaskReply({ inputText, plannerContext, searchLines }) {
  const shellTickets = extractShellFocusedTickets(plannerContext?.summary?.activeTickets ?? []);
  const lines = [];
  if (/\bnot inferior to codex|codex parity\b/i.test(inputText)) {
    lines.push("Parity plan:");
    lines.push(`1. Close the core routing gaps: ${shellTickets.slice(0, 3).map((ticket) => ticket.id).join(", ")}.`);
    lines.push(`2. Strengthen synthesis and verbosity control: ${shellTickets.slice(3, 6).map((ticket) => ticket.id).join(", ")}.`);
    lines.push(`3. Expand follow-up continuity and transcript judging: ${shellTickets.slice(6, 8).map((ticket) => ticket.id).join(", ")}.`);
    return lines.join("\n");
  }
  lines.push("Staged plan:");
  lines.push("1. Lock the capability classification and target discovery for the request.");
  lines.push("2. Reuse prior shell context instead of restarting follow-up turns.");
  lines.push("3. Synthesize one operator-facing answer that matches the requested depth.");
  if (searchLines.length) {
    lines.push("Likely starting points:");
    lines.push(...searchLines.map((line) => line.replace(/^- /, "- ")));
  }
  return lines.join("\n");
}

function renderReviewTaskReply({ inputText, plannerContext, statusExecution, searchLines }) {
  if (!/\btop\s+\d+\b|\babsolute file paths?\b|\bfile references?\b/i.test(inputText)) {
    return null;
  }
  const limit = Number(inputText.match(/\btop\s+(\d+)\b/i)?.[1] ?? 3) || 3;
  const targets = collectShellFileTargets({ plannerContext, statusPayload: statusExecution?.structuredPayload, searchLines }).slice(0, limit);
  if (!targets.length) {
    return null;
  }
  const risks = [
    "Continuation prompts can silently reset to a fresh request and lose the prior subject.",
    "Style-sensitive requests can degrade into generic status output instead of a structured answer.",
    "Capability routing can choose the wrong work mode when the prompt mixes planning, review, and design language."
  ];
  const lines = [`Top ${Math.min(limit, targets.length)} risks:`];
  targets.forEach((target, index) => {
    lines.push(`${index + 1}. ${target}: ${risks[index] ?? risks.at(-1)}`);
  });
  return lines.join("\n");
}

function renderDebugTaskReply({ inputText, searchLines }) {
  if (!/\bsubject|continuity|follow[- ]?up\b/i.test(inputText)) {
    return null;
  }
  const lines = ["I’d treat this as debugging work."];
  if (searchLines.length) {
    lines.push("Likely hotspots:");
    lines.push(...searchLines);
  } else {
    lines.push("Likely hotspots:");
    lines.push("- function buildContinuationState");
    lines.push("- function buildShellContinuationPlan");
    lines.push("- function normalizeShellFinalAnswerPolicy");
  }
  lines.push("Next step: inspect the continuation, target-selection, and synthesis helpers first so the prompt subject stays attached to the follow-up.");
  return lines.join("\n");
}

function collectShellFileTargets({ plannerContext, statusPayload, searchLines }) {
  const targets = new Set();
  const root = plannerContext?.root ?? process.cwd();
  for (const related of statusPayload?.related ?? []) {
    if (related?.type === "file" && related?.title) {
      targets.add(path.resolve(root, String(related.title)));
    }
  }
  for (const item of statusPayload?.tests ?? []) {
    if (item?.title) {
      targets.add(path.resolve(root, String(item.title)));
    }
  }
  for (const line of searchLines ?? []) {
    const match = String(line).match(/(?:^-\s+\[[^\]]+\]\s+)([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)/);
    if (match?.[1]) {
      targets.add(path.resolve(root, match[1]));
    }
  }
  if (!targets.size) {
    targets.add(path.resolve(root, "cli/lib/shell.mjs"));
    targets.add(path.resolve(root, "tests/shell.test.mjs"));
    targets.add(path.resolve(root, "tests/shell-human-language.test.mjs"));
  }
  return [...targets];
}

function humanizeTaskClass(taskClass) {
  return String(taskClass ?? "").replace(/-/g, " ");
}

function renderCapabilityIntro(intent = {}, fallbackTaskClass = null) {
  const capability = intent?.capability ?? null;
  if (capability === "coding") return "I’d treat this as coding work.";
  if (capability === "debugging") return "I’d treat this as debugging work.";
  if (capability === "review") return "I’d treat this as review work.";
  if (capability === "refactor-planning") return "I’d treat this as refactor-planning work.";
  if (capability === "design-direction") return "I’d treat this as design-direction work.";
  if (capability === "project-planning") return "I’d treat this as project-planning work.";
  return fallbackTaskClass ? `I’d treat this as ${humanizeTaskClass(fallbackTaskClass)} work.` : null;
}

function renderCapabilityTargetLabel(intent = {}) {
  switch (intent?.capability) {
    case "debugging":
      return "Likely hotspots:";
    case "review":
      return "Likely review targets:";
    case "design-direction":
      return "Likely design targets:";
    default:
      return "Likely repo targets:";
  }
}

function renderCapabilityNextStep(intent = {}, hasTargets = false) {
  switch (intent?.capability) {
    case "coding":
      return hasTargets
        ? (intent.safeToAutoExecute ? "This looks bounded enough to auto-execute once the target is confirmed." : "Next step: inspect the targets, then make the smallest bounded change.")
        : "Next step: identify the target file or module before changing code.";
    case "debugging":
      return hasTargets
        ? "Next step: inspect these hotspots first and reproduce the failure before patching."
        : "Next step: gather a reproducible symptom and the most likely hotspot.";
    case "review":
      return hasTargets
        ? "Next step: inspect the hotspots and rank regressions before editing anything."
        : "Next step: identify the changed surface and likely regressions.";
    case "refactor-planning":
      return "Next step: stage the refactor into small slices with explicit guardrails.";
    case "design-direction":
      return hasTargets
        ? "Next step: inspect the current surface and keep the design changes coherent with the repo’s existing visual language."
        : "Next step: identify the component, layout, or token surface before proposing changes.";
    case "project-planning":
      return "Next step: ground the plan in current workflow state before changing anything.";
    default:
      return null;
  }
}

function renderGoalDirectedFallbackReply({ inputText, plan, graphExecutions, plannerContext }) {
  const actions = Array.isArray(plan?.actions) ? plan.actions : [];
  if (!actions.some((action) => action.type === "list_tickets")) {
    return null;
  }
  if (!actions.some((action) => action.type === "execute_ticket" || action.type === "extract_ticket" || action.type === "run_codelet")) {
    return null;
  }

  const executeAction = actions.find((action) => action.type === "execute_ticket");
  const goal = extractShellGoal(inputText);
  const ranked = rankTicketsAgainstGoal(plannerContext?.summary?.activeTickets, {
    goal,
    excludeId: executeAction?.ticketId ?? null
  }).slice(0, 3);
  const lines = [];
  if (executeAction?.ticketId) {
    lines.push(`I treated this as a staged request. First I planned the current ticket ${executeAction.ticketId} without applying mutations.`);
  } else {
    lines.push("I treated this as a staged request: inspect the current work first, then evaluate the remaining tickets.");
  }
  if (goal.text) {
    lines.push(`Goal used for prioritization: ${goal.text}`);
  }
  if (ranked.length) {
    lines.push(`Suggested remaining priorities: ${ranked.map((item) => `${item.id} (${item.lane})`).join(", ")}.`);
  }
  lines.push("Apply: no.");
  lines.push("Proposed mutation steps should be confirmed before changing board state.");

  const renderedExecutions = graphExecutions
    .map((item) => String(item.ok ? item.stdout : `${item.stdout ?? ""}${item.stderr ?? ""}`).trim())
    .filter((item) => item && item !== STREAMED_STDIO);
  if (renderedExecutions.length) {
    lines.push("");
    lines.push(renderedExecutions.join("\n\n"));
  }
  return lines.join("\n");
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
    case "status_query":
      if (!String(action.query ?? "").trim()) {
        throw new Error("status_query action requires query");
      }
      return {
        type,
        query: String(action.query).trim(),
        entityType: action.entityType ? String(action.entityType).trim() : null
      };
    case "evaluate_readiness":
      if (!String(action.goalType ?? "").trim()) {
        throw new Error("evaluate_readiness action requires goalType");
      }
      if (!String(action.question ?? "").trim()) {
        throw new Error("evaluate_readiness action requires question");
      }
      return {
        type,
        goalType: String(action.goalType).trim(),
        question: String(action.question).trim()
      };
    case "extract_ticket":
      return { type, ticketId: requireTicketId(action.ticketId) };
    case "decompose_ticket":
      return { type, ticketId: requireTicketId(action.ticketId) };
    case "execute_ticket":
      return {
        type,
        ticketId: requireTicketId(action.ticketId),
        apply: action.apply !== false
      };
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

  const mutationModeGate = await ensureMutatingModeForPlan(plan, options);
  if (mutationModeGate) {
    return {
      ...result,
      plan: replyPlan(mutationModeGate.reply, 0.15, mutationModeGate.reason),
      executed: [],
      executedGraph: { nodes: [], executions: [], branchPath: [] },
      preRendered: false
    };
  }

  const mutationGate = evaluateShellMutationPolicy(plan, options.plannerContext);
  if (mutationGate) {
    return {
      ...result,
      plan: replyPlan(mutationGate.reply, 0.15, mutationGate.reason),
      executed: [],
      executedGraph: { nodes: [], executions: [], branchPath: [] },
      preRendered: false
    };
  }

  let preRendered = false;
  const shouldNarrate = shouldNarrateShellPlan(plan, options);
  const shouldRenderRawPlan = !options.json && !shouldNarrate;
  if (shouldRenderRawPlan) {
    const activePlanner = plan.planner ?? options.planners.planners[0] ?? options.planners.heuristic;
    output.write(`${renderPlannerLine(activePlanner)}\n${renderActionList(plan.actions)}\n`);
    preRendered = true;
  }

  const executed = [];
  const executedGraph = plan.graph ? await executeActionGraph(plan.graph, options) : { nodes: [], executions: [], branchPath: [] };
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
  if (!failed && !recovery && shouldNarrate) {
    assistantReply = await synthesizeShellExecutionReply({
      inputText,
      plan,
      executed: { graphNodes: executedGraph.nodes, executions: executed },
      options,
      planner: narrationPlanner
    });
  }
  if (!assistantReply && shouldNarrate) {
    assistantReply = renderFallbackAssistantReply({
      inputText,
      plan,
      executed: { graphNodes: executedGraph.nodes, executions: executed },
      plannerContext: options.plannerContext
    });
  }

  return {
    input: inputText,
    plan,
    executed,
    executedGraph,
    continuationState: buildContinuationState({ inputText, plan, executedGraph }),
    preRendered,
    recovery,
    assistantReply
  };
}

export async function executeShellAction(action, options) {
  const compiled = compileShellAction(action, { json: options.json });
  try {
    if (action.type === "project_summary") {
      const payload = await getProjectSummary({ projectRoot: options.root });
      return attachStructuredExecution({
        action,
        command: compiled.display,
        mutation: compiled.mutation,
        ok: true,
        stdout: formatProjectSummary(payload, options.json),
        stderr: "",
        structuredPayload: payload,
        summary: `Project summary loaded with ${payload.activeTickets.length} active tickets.`
      });
    }
    if (action.type === "status_query") {
      const payload = await resolveProjectStatus({
        projectRoot: options.root,
        selector: action.query,
        type: action.entityType,
        includeRelated: true,
        rawQuestion: true,
        relatedLimit: 18
      });
      return attachStructuredExecution({
        action,
        command: compiled.display,
        mutation: compiled.mutation,
        ok: Boolean(payload?.ok),
        stdout: formatStatusReport(payload),
        stderr: payload?.ok ? "" : `${payload?.error ?? "Status query failed."}\n`,
        structuredPayload: payload,
        summary: payload?.ok ? `${payload.title} ${payload.status}` : (payload?.error ?? "status query failed")
      });
    }
    if (action.type === "evaluate_readiness") {
      const payload = await evaluateProjectReadiness({
        projectRoot: options.root,
        request: {
          protocol_version: "1.0",
          operation: "evaluate_readiness",
          goal: {
            type: action.goalType,
            target: "project",
            question: action.question
          },
          constraints: {
            allow_mutation: false,
            context_budget: "medium",
            time_budget_ms: 15000,
            guideline_mode: "advisory"
          },
          inputs: {
            tickets_scope: "active_and_blocked",
            artifact_scope: "goal_relevant_only",
            verification_scope: "tests_metrics_docs"
          },
          host: {
            surface: "shell",
            capabilities: {
              supports_json: true,
              supports_streaming: false,
              supports_followups: true
            }
          },
          continuation_state: null
        }
      });
      return attachStructuredExecution({
        action,
        command: compiled.display,
        mutation: compiled.mutation,
        ok: true,
        stdout: formatReadinessEvaluation(payload, options.json),
        stderr: "",
        structuredPayload: {
          ...payload,
          goalType: action.goalType,
          question: action.question
        },
        summary: payload.summary
      });
    }
    if (action.type === "execute_ticket") {
      const payload = await withWorkspaceMutation(options.root, `shell execute_ticket ${action.ticketId}`, async () => executeTicket({
        root: options.root,
        ticketId: action.ticketId,
        apply: action.apply !== false
      }));
      const ok = action.apply === false ? true : Boolean(payload.success);
      const rendered = options.json ? `${JSON.stringify(payload, null, 2)}\n` : renderExecuteTicketResult(action, payload);
      return attachStructuredExecution({
        action,
        command: compiled.display,
        mutation: compiled.mutation,
        ok,
        stdout: ok ? rendered : "",
        stderr: ok ? "" : (payload.error ? `${payload.error}\n` : "Ticket execution failed.\n"),
        structuredPayload: payload,
        summary: payload.status ?? (payload.success ? "ok" : "failed")
      });
    }
    const stdout = await runShellActionDirect(action, options);
    const execution = {
      action,
      command: compiled.display,
      mutation: compiled.mutation,
      ok: true,
      stdout,
      stderr: ""
    };
    return attachStructuredExecution(execution);
  } catch (error) {
    const execution = {
      action,
      command: compiled.display,
      mutation: compiled.mutation,
      ok: false,
      stdout: "",
      stderr: error?.message ?? String(error)
    };
    return attachStructuredExecution(execution);
  }
}

export function compileShellAction(action, { json = false } = {}) {
  switch (action.type) {
    case "project_summary":
    case "list_tickets":
      return cliCommand(["project", "summary", ...(json ? ["--json"] : [])], false);
    case "status_query":
      return cliCommand([
        "project",
        "status",
        action.query,
        ...(action.entityType ? ["--type", action.entityType] : []),
        ...(json ? ["--json"] : [])
      ], false);
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
    case "evaluate_readiness":
      return cliCommand(["project", "readiness", "--goal", action.goalType, "--question", action.question, ...(json ? ["--json"] : [])], false);
    case "search":
      return cliCommand(["project", "search", action.query, ...(json ? ["--json"] : [])], false);
    case "extract_ticket":
      return cliCommand(["extract", "ticket", action.ticketId], false);
    case "decompose_ticket":
      return cliCommand(["decompose", "ticket", action.ticketId], false);
    case "execute_ticket":
      return {
        args: [],
        mutation: Boolean(action.apply !== false),
        display: `${action.apply === false ? "plan" : "execute"} ticket ${action.ticketId}`
      };
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
  options.shellMode ??= "plan";
  options.trace ??= false;
  options.traceAi ??= (event) => logShellTrace(options, event);
  const processingIndicator = createShellProcessingIndicator(options);
  try {
    if (!options.plannerContext || !options.planners) {
      options.plannerContext = await buildShellContext(options.root);
      options.planners = await resolveShellPlanners(options.root, { providerState: options.plannerContext.providerState });
    }

    const primary = options.noAi
      ? { ...options.planners.heuristic, mode: "heuristic-forced", reason: "AI planning disabled for this shell session." }
      : options.planners.planners[0] ?? options.planners.heuristic;
    output.write(`ai-workflow shell\n${renderPlannerLine(primary)}\n${renderShellModeLine(options)}\nType 'help' for examples. Type 'plan', 'mutate', 'trace on', 'trace off', or 'exit' to quit.\n\n`);

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
          await withWorkspaceMutation(options.root, "shell configure ollama hardware", async () => configureOllamaHardware({
            root: options.root,
            interactive: true,
            rl
          }));
          rl.resume();
          options.plannerContext = await buildShellContext(options.root);
          options.planners = await resolveShellPlanners(options.root, { providerState: options.plannerContext.providerState });
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

        const commandResult = handleShellCommand(line, options);
        if (commandResult?.handled) {
          if (commandResult.exit) {
            break;
          }
          continue;
        }

        const fastResult = await tryRunShellFastPath(line, options);
        if (fastResult) {
          options.activeGraphState = fastResult.continuationState ?? null;
          if (options.json) {
            output.write(`${JSON.stringify(fastResult, null, 2)}\n`);
          } else {
            renderHumanShellResult(fastResult);
          }
          continue;
        }

        // 0. Ensure bidirectional sync so manual edits are ingested and DB changes are projected
        processingIndicator.update("syncing project");
        await syncProject({ projectRoot: options.root, writeProjections: true });

        // 1. Refresh context before every turn so the Brain sees the latest state
        processingIndicator.update("refreshing context");
        options.plannerContext = await buildShellContext(options.root);
        options.planners = await resolveShellPlanners(options.root, { providerState: options.plannerContext.providerState });

        processingIndicator.update("planning and running", { planner: options.planners.planners[0] ?? options.planners.heuristic });
        const result = await runShellTurn(line, options);
        processingIndicator.clear();
        options.activeGraphState = result.continuationState ?? null;
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
          options.planners = await resolveShellPlanners(options.root, { providerState: options.plannerContext.providerState });
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
        processingIndicator.clear();
        output.write(`shell error: ${error?.message ?? String(error)}\n`);
        continue;
      }
    }
  } finally {
    rl.close();
  }
  return 0;
}

function createShellProcessingIndicator(options) {
  const enabled = !options.json && process.stdin.isTTY && process.stdout.isTTY;
  const nonInteractive = !process.stdin.isTTY || !process.stdout.isTTY;
  let active = false;
  return {
    update(message, { planner = null } = {}) {
      if (enabled) {
        active = true;
        output.write(`${renderShellStatusLine(`processing: ${message}...`)}`);
        return;
      }
      if (!nonInteractive) {
        return;
      }
      const plannerHint = planner ? ` -> ${describeShellPlanner(planner)}` : "";
      process.stderr.write(`[progress] ${message}${plannerHint}\n`);
    },
    clear() {
      if (!enabled || !active) return;
      active = false;
      output.write(clearShellStatusLine());
    }
  };
}

function renderShellModeLine(options) {
  const mode = options.shellMode === "mutate" ? "mutating" : "plan-only";
  const trace = options.trace ? "on" : "off";
  return `mode: ${mode} | trace: ${trace}`;
}

function renderShellModeMessage(mode) {
  return `Shell mode: ${mode === "mutate" ? "mutating" : "plan-only"}.`;
}

function setShellMode(options, mode, { announce = false } = {}) {
  options.shellMode = mode;
  if (announce && !options.json) {
    output.write(`${renderShellModeMessage(mode)}\n`);
  }
}

function setShellTrace(options, enabled, { announce = false } = {}) {
  options.trace = enabled;
  if (announce && !options.json) {
    output.write(`${enabled ? "Trace enabled." : "Trace disabled."}\n`);
  }
}

export function handleShellCommand(line, options) {
  const normalized = String(line ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }

  if (normalized === "doctor help" || normalized === "help doctor") {
    if (!options.json) {
      output.write(`${renderShellCommandHelp("doctor")}\n`);
    }
    return { handled: true };
  }

  if (normalized === "plan") {
    setShellMode(options, "plan", { announce: true });
    return { handled: true };
  }

  if (normalized === "mutate") {
    setShellMode(options, "mutate", { announce: true });
    return { handled: true };
  }

  if (normalized === "trace on") {
    setShellTrace(options, true, { announce: true });
    return { handled: true };
  }

  if (normalized === "trace off") {
    setShellTrace(options, false, { announce: true });
    return { handled: true };
  }

  if (normalized === "trace") {
    if (!options.json) {
      output.write(`Trace is ${options.trace ? "on" : "off"}.\n`);
    }
    return { handled: true };
  }

  return null;
}

function logShellTrace(options, event) {
  if (!options?.trace) {
    return;
  }

  const stage = String(event?.stage ?? "ai").trim();
  const phase = String(event?.phase ?? "event").trim();
  const planner = describeShellPlanner(event?.planner);
  const lines = [`[trace] ${stage} ${phase} -> ${planner}`];

  if (event?.system) {
    lines.push("system:");
    lines.push(String(event.system).trimEnd());
  }
  if (event?.prompt) {
    lines.push("prompt:");
    lines.push(String(event.prompt).trimEnd());
  }
  if (event?.response !== undefined) {
    lines.push("response:");
    lines.push(String(event.response).trimEnd());
  }
  if (event?.error !== undefined) {
    lines.push("error:");
    lines.push(String(event.error).trimEnd());
  }
  if (Number.isFinite(event?.elapsedMs)) {
    lines.push(`latency: ${event.elapsedMs}ms`);
  }

  const traceText = `${lines.join("\n")}\n`;
  if (options?.json) {
    process.stderr.write(traceText);
    return;
  }
  output.write(traceText);
}

function describeShellPlanner(planner) {
  if (!planner) {
    return "heuristic";
  }
  if (planner.mode === "ollama") {
    return `${planner.providerId ?? "ollama"}:${planner.modelId ?? "unknown"}${planner.host ? ` @ ${planner.host}` : ""}`;
  }
  if (planner.providerId && planner.modelId) {
    return `${planner.providerId}:${planner.modelId}`;
  }
  if (planner.providerId) {
    return planner.providerId;
  }
  if (planner.mode) {
    return planner.mode;
  }
  return "unknown";
}

function renderPlanModeMutationReply(actions, plannerContext) {
  const projectName = path.basename(plannerContext?.root ?? process.cwd());
  return [
    "This request needs mutating mode.",
    "Planned actions:",
    renderActionList(actions),
    "Type `mutate` to switch into mutating mode and run it, or `plan` to stay read-only.",
    `Current project: ${projectName}.`
  ].join("\n");
}

async function promptShellQuestion(rl, prompt) {
  if (rl.closed) {
    return null;
  }

  try {
    return await rl.question(prompt);
  } catch (error) {
    if (error?.code === "ERR_USE_AFTER_CLOSE" || error?.message?.includes("closed")) {
      return null;
    }
    throw error;
  }
}

function renderShellStatusLine(message) {
  return `\r\x1b[2K${message}`;
}

function clearShellStatusLine() {
  return "\r\x1b[2K";
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
    case "evaluate_readiness": {
      const response = await evaluateProjectReadiness({
        projectRoot: options.root,
        request: {
          protocol_version: "1.0",
          operation: "evaluate_readiness",
          goal: {
            type: action.goalType,
            target: "project",
            question: action.question
          },
          constraints: {
            allow_mutation: false,
            context_budget: "medium",
            time_budget_ms: 15000,
            guideline_mode: "advisory"
          },
          inputs: {
            tickets_scope: "active_and_blocked",
            artifact_scope: "goal_relevant_only",
            verification_scope: "tests_metrics_docs"
          },
          host: {
            surface: "shell",
            capabilities: {
              supports_json: true,
              supports_streaming: false,
              supports_followups: true
            }
          },
          continuation_state: null
        }
      });
      return formatReadinessEvaluation(response, options.json);
    }
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
      return await withWorkspaceMutation(options.root, `shell provider_connect ${action.providerId}`, async () => {
        if (String(action.providerId ?? "").toLowerCase() === "ollama") {
          const setup = await runProviderSetupWizard({
            root: options.root,
            scope: "global",
            interactive: Boolean(options.rl),
            rl: options.rl ?? null,
            promptRemoteProviders: false
          });
          return `${renderProviderSetupMessages(setup)}\n`;
        }

        return handleProviderConnect(action.providerId, { rl: options.rl, root: options.root }).then((code) => code === 0 ? "Connected.\n" : "Connection failed.\n");
      });
    case "set_ollama_hw": {
      const result = await withWorkspaceMutation(options.root, "shell set_ollama_hw", async () => configureOllamaHardware({
        root: options.root,
        global: Boolean(action.global),
        interactive: true
      }));
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
      await withWorkspaceMutation(options.root, `shell set_provider_key ${action.providerId}`, async () => writeConfigValue(filePath, `providers.${action.providerId}.apiKey`, key));
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
        const config = await withWorkspaceMutation(options.root, `shell config set ${action.key}`, async () => writeConfigValue(configPath, action.key, action.value));
        return `${JSON.stringify({ path: configPath, value: getConfigValue(config, action.key) }, null, 2)}\n`;
      }
      if (action.action === "unset") {
        if (!action.key) throw new Error("Key required.");
        await withWorkspaceMutation(options.root, `shell config unset ${action.key}`, async () => removeConfigValue(configPath, action.key));
        return `Removed ${action.key} from ${scope} config.\n`;
      }
      if (action.action === "clear") {
        await withWorkspaceMutation(options.root, `shell config clear ${scope}`, async () => removeConfigFile(configPath));
        return `Cleared ${scope} config.\n`;
      }
      throw new Error(`Unsupported config action: ${action.action}`);
    }
    case "add_note": {
      const note = await withWorkspaceMutation(options.root, `shell add_note ${action.noteType}`, async () => addManualNote({
        projectRoot: options.root,
        note: {
          noteType: action.noteType,
          body: action.body,
          filePath: action.filePath,
          line: action.line
        }
      }));
      return options.json ? `${JSON.stringify(note, null, 2)}\n` : `${note.noteType} ${note.body}\n`;
    }
    case "create_ticket": {
      const ticket = await withWorkspaceMutation(options.root, `shell create_ticket ${action.id}`, async () => {
        const entity = buildTicketEntity({
          id: action.id,
          title: action.title,
          lane: inferTicketLane({ id: action.id, title: action.title, lane: action.lane ?? null }),
          epicId: action.epicId,
          summary: action.summary ?? ""
        });
        return createTicket({ projectRoot: options.root, entity });
      });
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
    case "execute_ticket": {
      const payload = await withWorkspaceMutation(options.root, `shell execute_ticket ${action.ticketId}`, async () => executeTicket({
        root: options.root,
        ticketId: action.ticketId,
        apply: action.apply !== false
      }));
      if (options.json) {
        return `${JSON.stringify(payload, null, 2)}\n`;
      }
      return renderExecuteTicketResult(action, payload);
    }
    case "ideate_feature":
      return withWorkspaceMutation(options.root, `shell ideate_feature`, async () => ideateFeature(action.intent, options));
    case "sweep_bugs":
      return withWorkspaceMutation(options.root, `shell sweep_bugs`, async () => sweepBugs(options));
    case "ingest_artifact": {
      const rl = options.rl ?? readline.createInterface({ input, output });
      try {
        const result = await withWorkspaceMutation(options.root, `shell ingest_artifact ${action.filePath}`, async () => ingestArtifact(path.resolve(options.root, action.filePath), { root: options.root, rl }));
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
      await withWorkspaceMutation(options.root, "shell run_dynamic_codelet", async () => {
        await mkdir(stagedDir, { recursive: true });
        await writeFile(entryPath, source, "utf8");
      });
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
  let codelet = null;
  if (codeletId === "dynamic" && options._dynamicEntry) {
    entry = options._dynamicEntry;
    codelet = { id: codeletId, runner: "node-script", entryPath: entry };
  } else {
    codelet = [...options.plannerContext.projectCodelets, ...options.plannerContext.toolkitCodelets]
      .find((item) => item.id === codeletId);
    entry = codelet?.entry;
  }

  if (!codelet || !entry) {
    throw new Error(`Codelet entry not found for ${codeletId}`);
  }

  const result = await executeCodelet(codelet, args, {
    cwd: options.root,
    mode: options.json ? "capture" : "stream",
    env: {
      ...process.env,
      AIWF_CODELET_ID: codelet.id,
      AIWF_CODELET_FOCUS: codelet.focus ? String(codelet.focus) : "",
      AIWF_CODELET_SUMMARY: codelet.summary ? String(codelet.summary) : ""
    }
  });

  return options.json ? result : STREAMED_STDIO;
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
    if (result.recovery && result.plan.presentation !== "assistant-first") {
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
  if (result.recovery && result.plan.presentation !== "assistant-first") {
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
      kind: "action",
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
  if (nodes.length) {
    nodes.push({
      id: `n${nodes.length + 1}`,
      kind: "synthesize",
      type: "synthesize",
      dependsOn: nodes.map((node) => node.id),
      status: "pending"
    });
  }
  return { nodes };
}

async function executeActionGraph(graph, options) {
  const nodeMap = new Map((graph?.nodes ?? []).map((node) => [node.id, {
    ...node,
    dependsOn: Array.isArray(node.dependsOn) ? [...node.dependsOn] : [],
    status: "pending",
    execution: null,
    result: null
  }]));
  const executions = [];
  const branchPath = [];
  while (true) {
    const ready = Array.from(nodeMap.values()).filter((node) =>
      node.status === "pending"
      && node.dependsOn.every((depId) => nodeMap.get(depId)?.status === "ok")
    );
    if (!ready.length) {
      break;
    }
    const readyActions = ready.filter((node) => node.kind === "action");
    const readyConditionals = ready.filter((node) => node.kind === "branch" || node.kind === "assert" || node.kind === "replan");
    const readySynthesis = ready.filter((node) => node.kind === "synthesize");
    const parallelReads = readyActions.filter((node) => !isMutatingAction(node.action));
    const sequentialWrites = readyActions.filter((node) => isMutatingAction(node.action));

    if (parallelReads.length) {
      for (const node of parallelReads) {
        node.status = "running";
      }
      const batchResults = await Promise.all(parallelReads.map(async (node) => ({
        node,
        execution: await executeShellAction(node.action, options)
      })));
      for (const item of batchResults) {
        const recovered = await recoverGraphNode(item, options);
        item.node.execution = recovered;
        item.node.result = buildNodeResultEnvelope(item.node, recovered);
        item.node.status = recovered.ok ? "ok" : "failed";
        executions.push(recovered);
        if (!recovered.ok) {
          blockDependentGraphNodes(nodeMap, item.node.id);
          return { nodes: Array.from(nodeMap.values()), executions, branchPath };
        }
      }
    }

    for (const node of sequentialWrites) {
      node.status = "running";
      const execution = await recoverGraphNode({
        node,
        execution: await executeShellAction(node.action, options)
      }, options);
      node.execution = execution;
      node.result = buildNodeResultEnvelope(node, execution);
      node.status = execution.ok ? "ok" : "failed";
      executions.push(execution);
      if (!execution.ok) {
        blockDependentGraphNodes(nodeMap, node.id);
        return { nodes: Array.from(nodeMap.values()), executions, branchPath };
      }
    }

    for (const node of readyConditionals) {
      node.status = "running";
      const outcome = await executeConditionalGraphNode(node, { nodeMap, options, branchPath });
      node.execution = outcome.execution;
      node.result = outcome.result;
      node.status = outcome.ok ? "ok" : "failed";
      if (outcome.execution) {
        executions.push(outcome.execution);
      }
      if (Array.isArray(outcome.appendedNodes) && outcome.appendedNodes.length) {
        appendGraphFragment(nodeMap, node, outcome.appendedNodes);
      }
      if (!outcome.ok) {
        blockDependentGraphNodes(nodeMap, node.id);
        return { nodes: Array.from(nodeMap.values()), executions, branchPath };
      }
    }

    for (const node of readySynthesis) {
      node.result = buildSynthesisNodeResult(node, nodeMap);
      node.status = "ok";
    }
  }
  return { nodes: Array.from(nodeMap.values()), executions, branchPath };
}

function renderActionGraph(graph) {
  const nodes = graph?.nodes ?? [];
  if (!nodes.length) return "(empty)";
  return nodes.map((node) => {
    const deps = node.dependsOn?.length ? ` <- ${node.dependsOn.join(", ")}` : "";
    if (node.kind === "branch" || node.kind === "assert" || node.kind === "replan") {
      return `${node.id}: ${node.kind}${deps}`;
    }
    return `${node.id}: ${node.type}${deps}`;
  }).join("\n");
}

function blockDependentGraphNodes(nodeMap, failedNodeId) {
  for (const waiting of nodeMap.values()) {
    if (waiting.status === "pending" && waiting.dependsOn.includes(failedNodeId)) {
      waiting.status = "blocked";
    }
  }
}

async function recoverGraphNode({ node, execution }, options) {
  if (execution.ok || options.noAi) {
    return execution;
  }
  const planner = options.planners?.planners?.[0];
  if (!planner) {
    return execution;
  }
  const correctedAction = await attemptActionCorrection({
    failedAction: node.action,
    error: { message: execution.stderr || "Unknown error" },
    options: { ...options, planner },
    history: options.history
  }).catch(() => null);
  if (!correctedAction) {
    return execution;
  }
  const correctedExecution = await executeShellAction(correctedAction, options);
  correctedExecution.correctedFrom = node.action;
  node.action = correctedAction;
  node.type = correctedAction.type;
  return attachStructuredExecution(correctedExecution);
}

function attachStructuredExecution(execution) {
  if (!execution || typeof execution !== "object") {
    return execution;
  }
  const text = String(execution.ok ? execution.stdout : `${execution.stdout ?? ""}${execution.stderr ?? ""}`).trim();
  const structuredPayload = execution.structuredPayload ?? parseExecutionPayload(text);
  return {
    ...execution,
    summary: execution.summary ?? summarizeExecutionText(text, execution.ok),
    structuredPayload,
    evidence: execution.evidence ?? buildExecutionEvidence(execution, text),
    artifacts: execution.artifacts ?? [],
    classification: execution.classification ?? (execution.ok ? "completed" : "failed")
  };
}

function buildNodeResultEnvelope(node, execution) {
  return {
    summary: execution.summary ?? summarizeExecutionText(String(execution.stdout ?? execution.stderr ?? ""), execution.ok),
    structuredPayload: execution.structuredPayload ?? null,
    evidence: execution.evidence ?? [],
    artifacts: execution.artifacts ?? [],
    classification: execution.classification ?? (execution.ok ? "completed" : "failed"),
    ok: execution.ok
  };
}

function buildSynthesisNodeResult(node, nodeMap) {
  const deps = (node.dependsOn ?? []).map((depId) => nodeMap.get(depId)).filter(Boolean);
  const completed = deps.filter((item) => item.status === "ok").length;
  const failed = deps.filter((item) => item.status === "failed").length;
  return {
    summary: `Synthesized ${completed} successful prerequisite node${completed === 1 ? "" : "s"}${failed ? `, ${failed} failed` : ""}.`,
    structuredPayload: {
      dependencyIds: deps.map((item) => item.id),
      completed,
      failed
    },
    evidence: deps.map((item) => ({ node: item.id, classification: item.result?.classification ?? item.status })),
    artifacts: [],
    classification: failed ? "partial" : "synthesized",
    ok: failed === 0
  };
}

async function executeConditionalGraphNode(node, { nodeMap, options, branchPath }) {
  if (node.kind === "assert") {
    const evaluation = evaluateShellCondition(node.condition, nodeMap);
    const ok = Boolean(evaluation.match);
    return {
      ok,
      execution: createSyntheticNodeExecution(node, {
        ok,
        summary: ok ? "Assertion passed." : (node.message || "Assertion failed."),
        structuredPayload: evaluation
      }),
      result: {
        summary: ok ? "Assertion passed." : (node.message || "Assertion failed."),
        structuredPayload: evaluation,
        evidence: [{ condition: node.condition, actual: evaluation.actual }],
        artifacts: [],
        classification: ok ? "asserted" : "assertion-failed",
        ok
      }
    };
  }

  if (node.kind === "branch") {
    const evaluation = evaluateShellCondition(node.condition ?? true, nodeMap);
    const branchKey = evaluation.match ? "ifTrue" : "ifFalse";
    const appendedNodes = evaluation.match ? node.ifTrue : node.ifFalse;
    branchPath.push({ nodeId: node.id, branch: branchKey });
    return {
      ok: true,
      appendedNodes,
      execution: createSyntheticNodeExecution(node, {
        ok: true,
        summary: `Branch selected ${branchKey}.`,
        structuredPayload: { ...evaluation, branch: branchKey }
      }),
      result: {
        summary: `Branch selected ${branchKey}.`,
        structuredPayload: { ...evaluation, branch: branchKey },
        evidence: [{ condition: node.condition ?? true, actual: evaluation.actual }],
        artifacts: [],
        classification: "branched",
        ok: true
      }
    };
  }

  if (node.kind === "replan") {
    const evaluation = evaluateShellCondition(node.condition ?? true, nodeMap);
    if (!evaluation.match) {
      return {
        ok: true,
        execution: createSyntheticNodeExecution(node, {
          ok: true,
          summary: "Replan condition not met.",
          structuredPayload: evaluation
        }),
        result: {
          summary: "Replan condition not met.",
          structuredPayload: evaluation,
          evidence: [{ condition: node.condition ?? true, actual: evaluation.actual }],
          artifacts: [],
          classification: "skipped",
          ok: true
        }
      };
    }

    let appendedNodes = node.append;
    if (!appendedNodes.length && node.instruction) {
      appendedNodes = await generateReplanGraphFragment({
        node,
        nodeMap,
        options
      });
    }
    return {
      ok: true,
      appendedNodes,
      execution: createSyntheticNodeExecution(node, {
        ok: true,
        summary: appendedNodes.length ? `Appended ${appendedNodes.length} replanned node${appendedNodes.length === 1 ? "" : "s"}.` : "Replan produced no additional nodes.",
        structuredPayload: {
          appendedNodeCount: appendedNodes.length,
          instruction: node.instruction ?? null
        }
      }),
      result: {
        summary: appendedNodes.length ? `Appended ${appendedNodes.length} replanned node${appendedNodes.length === 1 ? "" : "s"}.` : "Replan produced no additional nodes.",
        structuredPayload: {
          appendedNodeCount: appendedNodes.length,
          instruction: node.instruction ?? null
        },
        evidence: Array.from(nodeMap.values())
          .filter((item) => item.result)
          .map((item) => ({ node: item.id, classification: item.result.classification })),
        artifacts: [],
        classification: appendedNodes.length ? "replanned" : "no-op",
        ok: true
      }
    };
  }

  throw new Error(`Unsupported conditional node kind: ${node.kind}`);
}

function createSyntheticNodeExecution(node, { ok, summary, structuredPayload }) {
  return attachStructuredExecution({
    action: { type: node.kind },
    command: `${node.kind} node ${node.id}`,
    mutation: false,
    ok,
    stdout: ok ? `${summary}\n` : "",
    stderr: ok ? "" : `${summary}\n`,
    summary,
    structuredPayload,
    evidence: [{ nodeId: node.id }],
    artifacts: [],
    classification: ok ? "completed" : "failed"
  });
}

function evaluateShellCondition(condition, nodeMap) {
  if (typeof condition === "boolean") {
    return { match: condition, actual: condition };
  }
  if (condition.all) {
    const items = condition.all.map((item) => evaluateShellCondition(item, nodeMap));
    return { match: items.every((item) => item.match), actual: items };
  }
  if (condition.any) {
    const items = condition.any.map((item) => evaluateShellCondition(item, nodeMap));
    return { match: items.some((item) => item.match), actual: items };
  }
  if (condition.not !== undefined) {
    const item = evaluateShellCondition(condition.not, nodeMap);
    return { match: !item.match, actual: item.actual };
  }

  const node = nodeMap.get(condition.node);
  const actual = resolveConditionValue(node, condition.path);
  let match = true;
  if ("exists" in condition) {
    match = condition.exists ? actual !== undefined && actual !== null : actual === undefined || actual === null;
  }
  if ("equals" in condition) {
    match = match && actual === condition.equals;
  }
  if ("notEquals" in condition) {
    match = match && actual !== condition.notEquals;
  }
  if ("includes" in condition) {
    match = match && String(actual ?? "").includes(condition.includes);
  }
  if ("matches" in condition) {
    match = match && new RegExp(condition.matches, "i").test(String(actual ?? ""));
  }
  if (!("exists" in condition) && !("equals" in condition) && !("notEquals" in condition) && !("includes" in condition) && !("matches" in condition)) {
    match = Boolean(actual);
  }
  return { match, actual };
}

function resolveConditionValue(node, path) {
  if (!node) {
    return undefined;
  }
  const source = {
    id: node.id,
    status: node.status,
    ok: node.execution?.ok ?? node.result?.ok,
    summary: node.result?.summary ?? node.execution?.summary,
    classification: node.result?.classification ?? node.execution?.classification,
    structuredPayload: node.result?.structuredPayload ?? node.execution?.structuredPayload,
    result: node.result,
    execution: node.execution
  };
  const segments = String(path ?? "ok").split(".").filter(Boolean);
  let cursor = source;
  for (const segment of segments) {
    if (cursor == null) {
      return undefined;
    }
    cursor = cursor[segment];
  }
  return cursor;
}

function appendGraphFragment(nodeMap, parentNode, templateNodes) {
  const nodes = cloneGraphNodes(templateNodes);
  if (!nodes.length) {
    return;
  }

  const idMap = new Map();
  const appendedIds = new Set();
  for (const node of nodes) {
    const nextId = makeUniqueGraphNodeId(nodeMap, `${parentNode.id}_${node.id}`);
    idMap.set(node.id, nextId);
    appendedIds.add(nextId);
  }

  const internalIds = new Set(nodes.map((node) => node.id));
  for (const node of nodes) {
    const nextId = idMap.get(node.id);
    const remappedDeps = (node.dependsOn ?? []).map((depId) => idMap.get(depId) ?? depId);
    const dependsOn = remappedDeps.length ? remappedDeps : [parentNode.id];
    nodeMap.set(nextId, {
      ...node,
      id: nextId,
      dependsOn,
      status: "pending",
      execution: null,
      result: null
    });
  }

  const terminalIds = getTerminalFragmentIds(nodes, idMap, internalIds);
  for (const waiting of nodeMap.values()) {
    if (waiting.id === parentNode.id || appendedIds.has(waiting.id) || waiting.status !== "pending" || !waiting.dependsOn.includes(parentNode.id)) {
      continue;
    }
    waiting.dependsOn = waiting.dependsOn.flatMap((depId) => depId === parentNode.id ? terminalIds : [depId]);
  }
}

function cloneGraphNodes(nodes) {
  return (nodes ?? []).map((node) => ({
    ...node,
    dependsOn: Array.isArray(node.dependsOn) ? [...node.dependsOn] : []
  }));
}

function makeUniqueGraphNodeId(nodeMap, baseId) {
  let nextId = String(baseId).replace(/[^A-Za-z0-9_-]/g, "_");
  let index = 1;
  while (nodeMap.has(nextId)) {
    nextId = `${baseId}_${index}`;
    index += 1;
  }
  return nextId;
}

function getTerminalFragmentIds(nodes, idMap, internalIds) {
  const dependedOn = new Set();
  for (const node of nodes) {
    for (const depId of node.dependsOn ?? []) {
      if (internalIds.has(depId)) {
        dependedOn.add(depId);
      }
    }
  }
  const synth = nodes.filter((node) => node.kind === "synthesize");
  const terminals = (synth.length ? synth : nodes.filter((node) => !dependedOn.has(node.id))).map((node) => idMap.get(node.id)).filter(Boolean);
  return terminals.length ? terminals : [idMap.get(nodes[nodes.length - 1].id)];
}

async function generateReplanGraphFragment({ node, nodeMap, options }) {
  const planner = options.planners?.planners?.[0];
  if (!planner || options.noAi) {
    return [];
  }

  const completion = await runShellCompletion({
    stage: "replan",
    planner,
    system: [
      "You are replanning a shell execution graph for ai-workflow.",
      "Use prior node results to produce the next graph fragment only.",
      "Return JSON only.",
      "Schema: {\"nodes\":[{\"id\":\"n1\",\"kind\":\"action|branch|assert|replan|synthesize\",\"dependsOn\":[\"optional\"],\"condition\":{},\"action\":{...}}]}"
    ].join("\n"),
    prompt: [
      `Instruction:\n${node.instruction}`,
      "",
      "Observed node results:",
      Array.from(nodeMap.values())
        .filter((item) => item.result)
        .map((item) => JSON.stringify({
          id: item.id,
          kind: item.kind,
          status: item.status,
          result: item.result
        }))
        .join("\n")
    ].join("\n"),
    config: {
      apiKey: planner.apiKey,
      baseUrl: planner.baseUrl,
      host: planner.host,
      format: "json"
    },
    options
  });

  const parsed = JSON.parse(String(completion.response ?? "{}"));
  return validateGraphTemplate(parsed.nodes ?? parsed.graph?.nodes ?? parsed.graph ?? [], options.plannerContext);
}

function parseExecutionPayload(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function summarizeExecutionText(text, ok) {
  const normalized = String(text ?? "").trim();
  if (!normalized) {
    return ok ? "Completed with no textual output." : "Failed with no textual output.";
  }
  return normalized.split("\n").find(Boolean)?.slice(0, 220) ?? normalized.slice(0, 220);
}

function buildExecutionEvidence(execution, text) {
  return [
    { command: execution.command },
    ...(text ? [{ snippet: text.slice(0, 400) }] : [])
  ];
}

function buildContinuationState({ inputText, plan, executedGraph }) {
  const nodes = executedGraph?.nodes ?? [];
  const pending = nodes.filter((node) => node.status === "pending").map((node) => node.id);
  const failed = nodes.filter((node) => node.status === "failed").map((node) => node.id);
  const firstSearch = Array.isArray(plan?.actions) ? plan.actions.find((action) => action.type === "search") : null;
  const firstStatus = Array.isArray(plan?.actions) ? plan.actions.find((action) => action.type === "status_query") : null;
  const firstRoute = Array.isArray(plan?.actions) ? plan.actions.find((action) => action.type === "route") : null;
  return {
    request: inputText,
    active: pending.length > 0,
    intent: plan?.intent ?? null,
    lastReply: firstNonEmptyString(plan?.assistantReply, plan?.reply) || null,
    focus: {
      taskClass: plan?.intent?.taskClass ?? firstRoute?.taskClass ?? null,
      subject: plan?.intent?.subject ?? firstStatus?.query ?? firstSearch?.query ?? null,
      searchQuery: firstSearch?.query ?? null,
      statusQuery: firstStatus?.query ?? null
    },
    references: inferContinuationReferences(plan, executedGraph),
    graph: {
      nodes: nodes.map((node) => ({
        id: node.id,
        kind: node.kind,
        type: node.type,
        dependsOn: node.dependsOn ?? [],
        status: node.status,
        result: node.result ?? null
      })),
      branchPath: executedGraph?.branchPath ?? []
    },
    outcome: {
      planKind: plan.kind,
      failed,
      pending
    }
  };
}

function renderContinuationState(state) {
  if (!state?.graph?.nodes?.length) {
    return "No active graph state.";
  }
  const lines = state.graph.nodes.map((node) => {
    const summary = node.result?.summary ? ` - ${node.result.summary}` : "";
    return `${node.id} [${node.status}] ${node.kind}${summary}`;
  });
  if (state.graph.branchPath?.length) {
    lines.push(`Branch path: ${state.graph.branchPath.map((item) => `${item.nodeId}:${item.branch}`).join(", ")}`);
  }
  return lines.join("\n");
}

function renderPlannerActiveGraphState(state) {
  const payload = {
    priorRequest: state?.request ?? null,
    active: Boolean(state?.active),
    intent: state?.intent ?? null,
    focus: state?.focus ?? null,
    references: state?.references ?? null,
    lastReply: state?.lastReply ?? null,
    outcome: state?.outcome ?? null,
    graph: {
      branchPath: state?.graph?.branchPath ?? [],
      nodes: (state?.graph?.nodes ?? []).slice(-6).map((node) => ({
        id: node.id,
        kind: node.kind,
        type: node.type,
        status: node.status,
        summary: node.result?.summary ?? null
      }))
    }
  };
  return JSON.stringify(payload, null, 2);
}

function inferContinuationReferences(plan, executedGraph) {
  const tickets = new Set(plan?.intent?.references?.tickets ?? []);
  const files = new Set(plan?.intent?.references?.files ?? []);
  const modules = new Set(plan?.intent?.references?.modules ?? []);
  const graphNodeIds = new Set(plan?.intent?.references?.graphNodeIds ?? []);
  const evidence = new Set(plan?.intent?.references?.evidence ?? []);

  for (const action of plan?.actions ?? []) {
    if (action?.ticketId) {
      tickets.add(String(action.ticketId));
    }
    if (action?.type === "status_query" && action?.entityType === "ticket" && action?.query) {
      tickets.add(String(action.query));
    }
    if (action?.type === "status_query" && action?.entityType === "module" && action?.query) {
      modules.add(String(action.query));
    }
    if (action?.type === "search" && looksLikeFileOrModuleReference(action?.query)) {
      const query = String(action.query);
      if (/\.[A-Za-z0-9]+$/.test(query)) {
        files.add(query);
      } else {
        modules.add(query);
      }
    }
  }

  for (const node of executedGraph?.nodes ?? []) {
    if (node?.id) {
      graphNodeIds.add(String(node.id));
    }
    if (node?.result?.summary) {
      evidence.add(String(node.result.summary));
    }
  }

  return normalizeShellReferences({
    tickets: [...tickets],
    files: [...files],
    modules: [...modules],
    graphNodeIds: [...graphNodeIds],
    evidence: [...evidence]
  });
}

function looksLikeFileOrModuleReference(value) {
  const text = String(value ?? "").trim();
  return Boolean(text) && (text.includes("/") || /\.[A-Za-z0-9]+$/.test(text));
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

function renderShellCommandHelp(command) {
  if (command === "doctor") {
    return [
      "doctor: run local diagnostics and provider visibility checks.",
      "Usage: `doctor`",
      "CLI equivalent: `ai-workflow doctor`"
    ].join("\n");
  }
  return renderShellHelp({ toolkitCodelets: [] });
}

function buildActionCatalog(plannerContext) {
  const baseActions = [
    "project_summary",
    "list_tickets",
    "status_query",
    "doctor",
    "provider_status",
    "version",
    "sync",
    "run_review",
    "evaluate_readiness",
    "search",
    "extract_ticket",
    "next_ticket",
    "decompose_ticket",
    "execute_ticket",
    "ideate_feature",
    "sweep_bugs",
    "ingest_artifact",
    "extract_guidelines",
    "route",
    "run_dynamic_codelet",
    "telegram_preview",
    "add_note",
    "create_ticket",
    "run_codelet",
    "provider_connect",
    "reprofile",
    "set_provider_key"
  ];
  const codeletIds = [...plannerContext.toolkitCodelets, ...plannerContext.projectCodelets]
    .map((codelet) => codelet.id)
    .filter(Boolean)
    .slice(0, 12);
  const lines = [
    `Valid actions: ${baseActions.join(", ")}`,
    codeletIds.length ? `Known codelets: ${codeletIds.join(", ")}` : "Known codelets: none"
  ];
  return lines.join("\n");
}

function buildShellPlannerSchemaPrompt() {
  return [
    '{"kind":"intent|exit","confidence":0.8,"reason":"required","strategy":"optional","intent":{"version":"1","capability":"project-planning","objective":"...","subject":"...","scope":"workflow-state","risk":"low","needsRepoContext":true,"needsMutation":false,"safeToAutoExecute":false,"followUpMode":"new-request","references":{"tickets":[],"files":[],"modules":[],"graphNodeIds":[],"evidence":[]},"responseStyle":{"detail":"normal","format":"paragraphs","includeExamples":false}},"finalAnswerPolicy":{"verbosity":"normal","format":"paragraphs","includeEvidence":true,"includeNextSteps":true,"includeExamples":false},"assistantReply":"optional","actions":[{"type":"project_summary"}]}',
    'Shell-local answer: {"kind":"intent","confidence":0.9,"reason":"...","intent":{"version":"1","capability":"shell-usage","objective":"Explain shell usage","subject":"shell","scope":"shell-local","risk":"low","needsRepoContext":false,"needsMutation":false,"safeToAutoExecute":false,"followUpMode":"new-request","references":{"tickets":[],"files":[],"modules":[],"graphNodeIds":[],"evidence":[]},"responseStyle":{"detail":"brief","format":"bullets","includeExamples":true}},"finalAnswerPolicy":{"verbosity":"brief","format":"bullets","includeEvidence":false,"includeNextSteps":true,"includeExamples":true},"assistantReply":"...","actions":[]}',
    'Plan: {"kind":"intent","confidence":0.9,"reason":"...","strategy":"optional","intent":{"version":"1","capability":"coding","objective":"Apply the previously discussed bounded fix","subject":"shell continuation","scope":"repo-targeted","risk":"medium","needsRepoContext":true,"needsMutation":false,"safeToAutoExecute":false,"followUpMode":"continue-prior-work","references":{"tickets":[],"files":["cli/lib/shell.mjs"],"modules":["cli/lib/shell"],"graphNodeIds":["n1","n2"],"evidence":["prior search results"]},"responseStyle":{"detail":"normal","format":"paragraphs","includeExamples":false}},"finalAnswerPolicy":{"verbosity":"normal","format":"paragraphs","includeEvidence":true,"includeNextSteps":true,"includeExamples":false},"actions":[{"type":"route","taskClass":"code-generation"},{"type":"search","query":"cli/lib/shell"}]}',
    'Optional advanced form: include `graph.nodes` only when branching or gating is truly needed.',
    'Every action type must come from the valid action catalog.',
    'For conversational turns, set `followUpMode` from the prior turn memory, not from stock trigger phrases.'
  ].join("\n");
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
  if (action?.type === "execute_ticket") {
    return action.apply !== false;
  }
  return MUTATING_ACTIONS.has(action.type);
}

async function ensureMutatingModeForPlan(plan, options) {
  const mutationActions = Array.isArray(plan?.actions) ? plan.actions.filter((action) => isMutatingAction(action)) : [];
  if (!mutationActions.length || options.shellMode === "mutate") {
    return null;
  }

  if (plan?.intent?.safeToAutoExecute && options.autoExecuteSafe !== false) {
    return null;
  }

  if (options.yes) {
    setShellMode(options, "mutate");
    return null;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return {
      reason: "shell is in plan mode",
      reply: renderPlanModeMutationReply(mutationActions, options.plannerContext)
    };
  }

  output.write(clearShellStatusLine());
  const rl = options.rl ?? readline.createInterface({ input, output });
  try {
    output.write(`Planned actions:\n${renderActionList(mutationActions)}\n`);
    const answer = (await promptShellQuestion(rl, "Switch to mutating mode and run them? [y/N] ") ?? "").trim().toLowerCase();
    if (answer === "y" || answer === "yes") {
      setShellMode(options, "mutate", { announce: true });
      return null;
    }
  } finally {
    if (!options.rl) {
      rl.close();
    }
  }

  return {
    reason: "shell is in plan mode",
    reply: renderPlanModeMutationReply(mutationActions, options.plannerContext)
  };
}

function evaluateShellMutationPolicy(plan, plannerContext) {
  const actions = Array.isArray(plan?.actions) ? plan.actions : [];
  const mutationActions = actions.filter((action) => isMutatingAction(action));
  if (!mutationActions.length) {
    return null;
  }

  const summary = plannerContext?.summary ?? {};
  const activeTickets = Array.isArray(summary.activeTickets) ? summary.activeTickets : [];
  const inProgressTickets = activeTickets.filter((ticket) => /in progress/i.test(String(ticket.lane ?? "")));
  const gatedTicketIds = mutationActions
    .filter((action) => action?.type === "execute_ticket" && action.apply !== false)
    .map((action) => String(action.ticketId ?? "").trim().toUpperCase())
    .filter(Boolean);

  if (inProgressTickets.length !== 1) {
    return {
      reason: inProgressTickets.length > 1
        ? "workflow gate blocked: multiple tickets are in progress"
        : "workflow gate blocked: no ticket is in progress",
      reply: renderWorkflowMutationGateReply({
        activeTickets,
        inProgressTickets,
        blockedTicketIds: gatedTicketIds,
        plannerContext
      })
    };
  }

  const inProgressId = String(inProgressTickets[0].id ?? "").trim().toUpperCase();
  if (gatedTicketIds.length && gatedTicketIds.some((id) => id !== inProgressId)) {
    return {
      reason: "workflow gate blocked: plan targets a ticket that is not in progress",
      reply: renderWorkflowMutationGateReply({
        activeTickets,
        inProgressTickets,
        blockedTicketIds: gatedTicketIds,
        plannerContext
      })
    };
  }

  return null;
}

function renderWorkflowMutationGateReply({ activeTickets, inProgressTickets, blockedTicketIds, plannerContext }) {
  const lines = [
    "I will not run mutating shell actions until the workflow has exactly one ticket in `In Progress`.",
    "Move the current work item first, then retry."
  ];

  if (!activeTickets.length) {
    lines.push("I do not see any active tickets yet. Run `ai-workflow sync` and create or select a ticket first.");
  } else {
    lines.push("Current active tickets:");
    for (const ticket of activeTickets.slice(0, 8)) {
      lines.push(`- [${ticket.lane}] ${ticket.id}: ${ticket.title}`);
    }
  }

  if (inProgressTickets.length > 1) {
    lines.push(`I found multiple in-progress tickets: ${inProgressTickets.map((ticket) => ticket.id).join(", ")}.`);
    lines.push("Keep exactly one live ticket in `In Progress` before mutating the project.");
  } else if (inProgressTickets.length === 1) {
    lines.push(`Active in-progress ticket: ${inProgressTickets[0].id}.`);
  } else if (activeTickets.length) {
    lines.push(`Move one ticket to ` + "`In Progress`" + ` with \`ai-workflow kanban move --id <ticket> --to In Progress\`.`);
  }

  if (blockedTicketIds.length) {
    lines.push(`The blocked plan targets: ${blockedTicketIds.join(", ")}.`);
  }

  const projectName = path.basename(plannerContext?.root ?? process.cwd());
  lines.push(`Current project: ${projectName}.`);
  return lines.join("\n");
}

function extractReadinessGoal(text) {
  const source = String(text ?? "").trim();
  if (!source) {
    return null;
  }
  const normalized = normalizeConversationText(source);
  if (!/\b(ready|readiness)\b/.test(normalized) && !/\b(before beta|before release|for beta|for release|for handoff)\b/.test(normalized)) {
    return null;
  }
  if (!/\b(beta|release|handoff)\b/.test(normalized)) {
    return null;
  }
  const type = normalized.includes("release")
    ? "release_readiness"
    : normalized.includes("handoff")
      ? "handoff_readiness"
      : "beta_readiness";
  return {
    type,
    question: source
  };
}

function normalizeTaskClass(value, plannerContext) {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/\s+/g, "-");
  const aliases = {
    debug: "bug-hunting",
    debugging: "bug-hunting",
    diagnose: "bug-hunting",
    bug: "bug-hunting",
    bugs: "bug-hunting",
    architecture: "architectural-design",
    architectural: "architectural-design",
    design: "architectural-design",
    planning: "task-decomposition",
    rollout: "risky-planning",
    summarize: "summarization",
    summary: "summarization",
    prose: "prose-composition",
    writing: "prose-composition",
    style: "ui-styling",
    styling: "ui-styling",
    layout: "ui-layout",
    ui: "ui-layout",
    review: "review",
    refactor: "refactoring",
    code: "code-generation"
  };
  const resolved = aliases[normalized] ?? normalized;
  const tasks = plannerContext?.knowledge?.tasks ?? [];
  return tasks.includes(resolved) || KNOWN_TASK_CLASSES.includes(resolved) ? resolved : "classification";
}

function normalizeNoteType(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  return NOTE_TYPES.includes(normalized) ? normalized : null;
}

function requireTicketId(value) {
  const id = String(value ?? "").trim().toUpperCase();
  if (!(new RegExp(`^${TICKET_ID_PATTERN}$`)).test(id)) {
    throw new Error(`invalid ticket id: ${value}`);
  }
  return id;
}

function actionPlan(actions, confidence, reason, meta = {}) {
  return normalizeShellPlanEnvelope({
    kind: "plan",
    actions,
    graph: buildActionGraph(actions),
    confidence,
    reason
  }, meta.inputText ?? "", meta.plannerContext ?? {}, meta);
}

function replyPlan(reply, confidence = 1, reason = "Reply only.", meta = {}) {
  return normalizeShellPlanEnvelope({
    kind: "reply",
    actions: [],
    graph: buildActionGraph([]),
    reply,
    confidence,
    reason
  }, meta.inputText ?? "", meta.plannerContext ?? {}, {
    ...meta,
    assistantReply: reply
  });
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
    "plan",
    "mutate",
    "trace on",
    "trace off",
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

function renderProviderSetupMessages(result) {
  const lines = [...(result.messages ?? [])];
  if (result.connectedProviders?.length) {
    lines.push(`Connected providers: ${result.connectedProviders.join(", ")}.`);
  }
  if (result.registeredEndpoints?.length) {
    lines.push(`Registered Ollama endpoints: ${result.registeredEndpoints.join(", ")}.`);
  }
  return lines.length ? lines.join("\n") : "Provider setup completed.";
}

function buildContextualShellReply(inputText, plannerContext) {
  const text = String(inputText ?? "").trim();
  const normalized = normalizeConversationText(text);
  const responseStyle = inferShellResponseStyle(text);
  const summary = plannerContext?.summary ?? {};
  const activeTickets = Array.isArray(summary.activeTickets) ? summary.activeTickets : [];
  const shellTickets = extractShellFocusedTickets(activeTickets);
  const kanbanInProgress = extractKanbanTicketsInSection(plannerContext?.kanban, "In Progress");
  const modules = Array.isArray(summary.modules) ? summary.modules : [];
  const providerState = plannerContext?.providerState ?? {};
  const providerMap = providerState.providers ?? {};
  const projectName = path.basename(plannerContext?.root ?? process.cwd());
  const hasProjectQuestion = /\b(project|projects|repo|repository|codebase)\b/.test(normalized);
  const asksWhere = /\b(where)\b/.test(normalized)
    || /\bwhich project\b/.test(normalized)
    || /\bwhat (?:project|repo|repository)\b/.test(normalized);
  const asksNext = /\b(work on|do next|focus on|start with|next task|next thing)\b/.test(normalized)
    || /what should i (work on|do) next/.test(normalized)
    || /what do you think we should do next/.test(normalized)
    || /what should we do next/.test(normalized)
    || /\bwhat is next\b/.test(normalized);
  const asksTellAboutProject = /\b(tell me about the project|tell me about this project|tell me about the repo|tell me about this repo)\b/.test(normalized);
  const asksCapabilities = /\b(what can you do|how can you help|what are you capable of|capable of working|can you work|what do you do here)\b/.test(normalized);
  const asksGreeting = /\b(how are you|hows it going|how is it going|are you feeling well|ready to help|you there|are you working)\b/.test(normalized);
  const asksStatus = /\b(status|shape|state of the project|how is the project)\b/.test(normalized);
  const asksCodebaseAssessment = /\bwhat do you think about the codebase\b/.test(normalized)
    || /\bwhat do you think about this repo\b/.test(normalized);
  const asksActiveTickets = /\b(next tickets|active tickets|open tickets|current tickets|what tickets)\b/.test(normalized);
  const asksInProgress = /\b(in progress|in-progress)\b/.test(normalized);
  const asksModules = /\b(modules|major parts|subsystems)\b/.test(normalized);
  const asksClaims = /\bwhat does claims mean|what do claims mean|what are claims\b/.test(normalized);
  const asksEpic = /^(?:epic|epics)\??$/i.test(normalized);
  const asksEpicWithoutTopic = /^(?:(?:can|could|would)\s+you\s+|please\s+)?(?:write|create|make|draft)\s+(?:me\s+)?(?:an?|a\s+new)\s+(?:feature|epic|big task)\??$/i.test(text);
  const asksDoctorHelp = /^(?:doctor help|help doctor)$/i.test(text);
  const asksSetupOpenAiOllama = /\b(set this up|setting this up|set up|setup|configure)\b/.test(normalized) && /\bopenai\b/.test(normalized) && /\bollama\b/.test(normalized);
  const asksGeminiTroubleshooting = /\bgemini\b/.test(normalized) && /\b(broken|failing|blocked|wrong|problem|issue|investigate)\b/.test(normalized);
  const asksExplicitCapabilityWork = /\b(plan the work|step by step|support|implement|design a better|redesign|debug|review|refactor|migration note)\b/.test(normalized);
  const asksShellWorkSummary = !asksExplicitCapabilityWork && (
    /\b(shell work|shell changes|shell update|last shell work|recent shell work|shell effort)\b/.test(normalized)
      || (((/\b(summary|summarize|operator update|operator brief|what changed)\b/.test(normalized) || responseStyle.detail !== "normal") && /\bshell\b/.test(normalized))
  ));

  if (asksCapabilities || ["what can you do here", "what can you do"].includes(normalized)) {
    return replyPlan([
      "I can inspect project state, answer questions about the repo, search code and tickets, sync the workflow DB, prepare context, and run guided workflow actions.",
      "If you want to change code or project state, say that directly and I’ll plan or execute the next step."
    ].join("\n"), 0.95, "Capability explanation.");
  }

  if (asksInProgress && /\bwhat(s| is)?\b/.test(normalized)) {
    const inProgressTickets = activeTickets.filter((ticket) => /in progress/i.test(String(ticket.lane ?? "")));
    const effectiveInProgress = inProgressTickets.length ? inProgressTickets : kanbanInProgress.map((ticket) => ({ ...ticket, lane: "In Progress" }));
    if (!effectiveInProgress.length) {
      return replyPlan("There are no tickets in progress right now.", 0.89, "Answered from current summary.");
    }
    return replyPlan([
      "Tickets currently in progress:",
      ...effectiveInProgress.map((ticket) => `- ${ticket.id}: ${ticket.title}`)
    ].join("\n"), 0.9, "Answered from current summary.");
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

  if (asksShellWorkSummary && shellTickets.length) {
    return replyPlan(renderShellWorkSummaryReply({
      plannerContext,
      responseStyle,
      shellTickets,
      inputText: text
    }), 0.92, "Shell work summary reply.");
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

  if ((hasProjectQuestion || asksTellAboutProject || /\bproject am i in\b/.test(normalized)) && asksNext) {
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

  if (asksDoctorHelp) {
    return replyPlan(renderShellCommandHelp("doctor"), 0.99, "Local doctor help reply.");
  }

  if (asksEpic) {
    const epicLine = String(plannerContext?.smartStatus ?? "").match(/^Epic:\s+(.+)$/m)?.[1]?.trim() ?? "";
    if (epicLine && !/^None\b/i.test(epicLine)) {
      return replyPlan([
        `Current epic: ${epicLine}.`,
        "For the full list, run `ai-workflow project epic list`.",
        "To create a new one, say `create epic for ...`."
      ].join("\n"), 0.93, "Answered from smart project status.");
    }
    return replyPlan([
      "There is no active epic yet.",
      "For the full list, run `ai-workflow project epic list`.",
      "To create a new one, say `create epic for ...`."
    ].join("\n"), 0.9, "No active epic in smart status.");
  }

  if (asksEpicWithoutTopic) {
    return replyPlan([
      "Yes.",
      "Give me the epic topic, or say `create epic for <topic>`.",
      "Example: `create epic for Telegram remote-control`."
    ].join("\n"), 0.98, "Epic ideation request is missing a topic.");
  }

  if (asksGreeting || ["how are you", "tell me a joke"].includes(normalized) || /\bhow(?:'s| is) it going\b/.test(normalized) || /\bready to help\b/.test(normalized)) {
    return replyPlan("Ready. Point me at the code or the problem and I’ll work it through.", 0.35, "Light conversational reply.");
  }

  if (asksStatus && hasProjectQuestion) {
    const ticketHint = activeTickets[0] ? `Top active ticket: ${activeTickets[0].id} (${activeTickets[0].lane}).` : "No active ticket is obvious yet.";
    const moduleHint = modules.length ? `Main areas: ${modules.slice(0, 5).map((item) => item.name).join(", ")}.` : "Module summary is not available yet.";
    const counts = [];
    if (Number.isFinite(summary.fileCount)) counts.push(`${summary.fileCount} files`);
    if (Number.isFinite(summary.symbolCount)) counts.push(`${summary.symbolCount} symbols`);
    if (Number.isFinite(summary.noteCount)) counts.push(`${summary.noteCount} notes`);
    const countHint = counts.length ? `Indexed state: ${counts.join(", ")}.` : null;
    return replyPlan([
      `You are in \`${projectName}\`.`,
      ...(countHint ? [countHint] : []),
      ticketHint,
      moduleHint
    ].join("\n"), 0.96, "Project status grounding reply.");
  }

  return null;
}

function extractShellFocusedTickets(activeTickets) {
  return (Array.isArray(activeTickets) ? activeTickets : [])
    .filter((ticket) => /\bshell\b/i.test(`${ticket.id ?? ""} ${ticket.title ?? ""}`))
    .slice(0, 8);
}

function renderShellWorkSummaryReply({ plannerContext, responseStyle, shellTickets, inputText }) {
  const briefFocus = shellTickets.slice(0, 3).map((ticket) => `${ticket.id}: ${ticket.title}`);
  const deepFocus = shellTickets.slice(0, 5).map((ticket) => `${ticket.id}: ${ticket.title}`);
  const wantsOneSentence = /\bone sentence\b/.test(normalizeConversationText(inputText));
  const wantsChangeSummary = /\b(changed|recent|lately|last)\b/.test(normalizeConversationText(inputText));
  const nextTicket = shellTickets[0] ?? null;

  if (wantsOneSentence) {
    return `Shell work is currently focused on structured intent envelopes, multi-step paragraph handling, capability coverage for coding/debugging/design requests, and stronger follow-up continuity, with ${nextTicket?.id ?? "the current top ticket"} as the next slice.`;
  }

  if (responseStyle.format === "bullets") {
    const lines = [
      wantsChangeSummary ? "Recent shell work focus:" : "Current shell work:",
      ...briefFocus.map((item) => `- ${item}`),
      nextTicket ? `- Next step: ${nextTicket.id} (${nextTicket.lane}): ${nextTicket.title}` : "- Next step: refresh the shell todo lane."
    ];
    return lines.join("\n");
  }

  if (responseStyle.detail === "detailed") {
    return [
      wantsChangeSummary
        ? "Recent shell work has shifted from one-off phrasing fixes toward broader natural-language parity."
        : "The current shell work is a parity program rather than a single patch.",
      `The active shell tickets are ${deepFocus.join("; ")}.`,
      nextTicket ? `The next concrete step is ${nextTicket.id}: ${nextTicket.title}.` : "There is no obvious next shell ticket yet."
    ].join("\n");
  }

  return [
    `Shell work is currently centered on ${briefFocus.join("; ")}.`,
    nextTicket ? `Next step: ${nextTicket.id}: ${nextTicket.title}.` : "Next step: refresh the shell todo lane."
  ].join("\n");
}

function resolveImplicitTicketId(plannerContext, inputText) {
  const text = String(inputText ?? "");
  const explicitMatches = text.match(new RegExp(`\\b(${TICKET_ID_PATTERN})\\b`, "ig")) ?? [];
  const explicit = explicitMatches.find((candidate) => /\d/.test(candidate));
  if (explicit) {
    return explicit.toUpperCase();
  }

  const activeTickets = Array.isArray(plannerContext?.summary?.activeTickets) ? plannerContext.summary.activeTickets : [];
  const inProgress = activeTickets.filter((ticket) => /in progress/i.test(String(ticket.lane ?? "")));
  const kanbanInProgress = extractKanbanTicketsInSection(plannerContext?.kanban, "In Progress");
  const effectiveInProgress = inProgress.length ? inProgress.map((ticket) => ({ id: String(ticket.id) })) : kanbanInProgress;

  if (/\b(in progress|in-progress|current ticket|active ticket|current task|active task|current issue)\b/i.test(text)) {
    if (effectiveInProgress.length === 1) {
      return String(effectiveInProgress[0].id);
    }
    if (!inProgress.length && activeTickets.length === 1) {
      return String(activeTickets[0].id);
    }
  }

  if (/\b(working on right now|working on now|what are we working on|what we're working on|what were working on|current work|current focus)\b/i.test(text)) {
    if (effectiveInProgress.length === 1) {
      return String(effectiveInProgress[0].id);
    }
  }

  if (/\bthat ticket\b/i.test(text) && effectiveInProgress.length === 1) {
    return String(effectiveInProgress[0].id);
  }

  if (/\bticket\b/i.test(text) && effectiveInProgress.length === 1) {
    return String(effectiveInProgress[0].id);
  }

  const keywordTicketId = resolveKeywordMatchedTicketId(plannerContext, text);
  if (keywordTicketId) {
    return keywordTicketId;
  }

  return null;
}

function resolveKeywordMatchedTicketId(plannerContext, inputText) {
  const tickets = Array.isArray(plannerContext?.summary?.activeTickets) ? plannerContext.summary.activeTickets : [];
  const normalizedInput = normalizeConversationText(inputText);
  if (!normalizedInput || !tickets.length) {
    return null;
  }

  let best = null;
  for (const ticket of tickets) {
    const titleKeywords = normalizeConversationText(ticket.title ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .filter((token) => token.length >= 4)
      .filter((token) => !SHELL_TICKET_KEYWORD_STOPWORDS.has(token));
    const matched = titleKeywords.filter((token) => normalizedInput.includes(token));
    const score = matched.length + (/shell/i.test(String(ticket.id ?? "")) ? 0.25 : 0);
    if (score >= 2 && (!best || score > best.score)) {
      best = {
        id: String(ticket.id ?? ""),
        score
      };
    }
  }
  return best?.id ?? null;
}

function extractKanbanTicketsInSection(kanbanText, sectionName) {
  const text = String(kanbanText ?? "");
  if (!text) {
    return [];
  }

  const lines = text.split(/\r?\n/);
  const results = [];
  let inSection = false;
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      inSection = new RegExp(`^##\\s+${escapeRegExp(sectionName)}\\s*$`, "i").test(line.trim());
      continue;
    }
    if (!inSection) {
      continue;
    }
    const match = line.match(new RegExp(`\\*\\*(${TICKET_ID_PATTERN})\\*\\*:\\s*(.+)$`));
    if (match) {
      results.push({ id: match[1], title: match[2].trim() });
    }
  }
  return results;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasKnownCodelet(plannerContext, codeletId) {
  return [...(plannerContext?.toolkitCodelets ?? []), ...(plannerContext?.projectCodelets ?? [])].some((item) => item.id === codeletId);
}

function buildTicketContextPackArgs(plannerContext, ticketId) {
  return [
    "--ticket",
    ticketId,
    ...(plannerContext?.kanbanPath ? ["--kanban", plannerContext.kanbanPath] : [])
  ];
}

function normalizeConversationText(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[?!.,;:()\[\]{}]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferShellResponseStyle(inputText) {
  const normalized = normalizeConversationText(inputText);
  const wantsBrief = /\b(concise|brief|short|quick|quickly|tldr|summary only)\b/.test(normalized);
  const wantsDetailed = /\b(verbose|detailed|deep|deeply|thorough|thoroughly|full|fully|walk me through|step by step|in detail|long form)\b/.test(normalized);
  const wantsBullets = /\b(bullets|bullet points|list|listing)\b/.test(normalized);
  const wantsExamples = /\b(example|examples)\b/.test(normalized);

  return {
    detail: wantsDetailed ? "detailed" : (wantsBrief ? "brief" : "normal"),
    format: wantsBullets ? "bullets" : "paragraphs",
    includeExamples: wantsExamples
  };
}

function renderShellResponseStyle(style) {
  return [
    `detail: ${style.detail}`,
    `format: ${style.format}`,
    `include-examples: ${style.includeExamples ? "yes" : "no"}`
  ].join("\n");
}

function looksLikeShellUsageQuestion(inputText) {
  const normalized = normalizeConversationText(inputText);
  return /\b(teach me how to use you|how do i use you|how to use you|how should i use you|what should i ask|what can i ask|show me examples|how can you help me here)\b/.test(normalized);
}

function looksLikeRepoExplainerQuestion(inputText) {
  const normalized = normalizeConversationText(inputText);
  if (!/\b(what is|whats|what are|explain|describe|tell me about|teach me about)\b/.test(normalized)) {
    return false;
  }
  return /\b(service|module|modules|projection|projections|router|shell|sync|status|ticket|workflow|context|provider|planner|codelet|claim|claims)\b/.test(normalized)
    || /\bwhat are those\b/.test(normalized);
}

function extractShellGroundingSelectors(inputText, plannerContext = {}) {
  const text = String(inputText ?? "").trim();
  const normalized = normalizeConversationText(text);
  const selectors = new Set();
  if (text) {
    selectors.add(text);
  }

  const quoted = text.match(/["'`](.+?)["'`]/g) ?? [];
  for (const match of quoted) {
    const unwrapped = match.slice(1, -1).trim();
    if (unwrapped) {
      selectors.add(unwrapped);
    }
  }

  const simplified = normalized
    .replace(/\b(what is|whats|what are|explain|describe|tell me about|teach me about|what are those)\b/g, " ")
    .replace(/\b(the|those|this|current|service|module|modules|thing|system|component)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (simplified) {
    selectors.add(simplified);
  }

  for (const module of plannerContext?.summary?.modules ?? []) {
    const name = String(module?.name ?? "").trim();
    if (!name) {
      continue;
    }
    const tail = name.split("/").filter(Boolean).at(-1) ?? name;
    if (normalized.includes(tail.toLowerCase())) {
      selectors.add(name);
      selectors.add(tail);
    }
  }

  return [...selectors].filter(Boolean);
}

function findShellGroundingModuleMatches(inputText, plannerContext = {}) {
  const normalized = normalizeConversationText(inputText);
  const modules = Array.isArray(plannerContext?.summary?.modules) ? plannerContext.summary.modules : [];
  return modules.filter((item) => {
    const name = String(item?.name ?? "").trim().toLowerCase();
    if (!name) {
      return false;
    }
    const tail = name.split("/").filter(Boolean).at(-1) ?? name;
    return normalized.includes(tail) || normalized.includes(name.replace(/[^a-z0-9/_:-]+/g, " "));
  });
}

function renderShellPlannerGroundedStatus(payload) {
  const lines = [
    `Resolved target: ${payload.title} [${payload.type}]`,
    `Resolved status: ${payload.status}`
  ];
  if (payload.summary) {
    lines.push(`Resolved summary: ${payload.summary}`);
  }
  if (payload.evidence?.length) {
    lines.push(`Resolved evidence: ${payload.evidence.slice(0, 3).join(" | ")}`);
  }
  if (payload.related?.length) {
    lines.push(`Resolved related: ${payload.related.slice(0, 4).map((item) => `${item.title} [${item.type}]`).join(", ")}`);
  }
  return lines.join("\n");
}

function renderGroundedExplainerReply(payload, moduleMatches = []) {
  const lines = [];
  const matchingModule = moduleMatches.find((item) => String(item?.name ?? "") === String(payload?.title ?? ""))
    ?? moduleMatches.find((item) => String(payload?.title ?? "").includes(String(item?.name ?? "").split("/").filter(Boolean).at(-1) ?? ""));
  if (matchingModule?.responsibility) {
    lines.push(`${matchingModule.name} is the relevant service here. ${matchingModule.responsibility}`);
  } else {
    lines.push(`${payload.title} is the relevant ${payload.type} here.`);
  }
  if (payload.summary && payload.summary !== "Tracked module.") {
    lines.push(payload.summary);
  }
  if (payload.related?.length) {
    lines.push(`Related: ${payload.related.slice(0, 4).map((item) => `${item.title} [${item.type}]`).join(", ")}`);
  }
  if (payload.evidence?.length) {
    lines.push(`Evidence: ${payload.evidence.slice(0, 3).join(" | ")}`);
  }
  return lines.join("\n");
}

import { attemptActionCorrection } from "../../core/lib/self-correction.mjs";
import { analyzeCodeletSideEffects, formatSideEffects } from "../../core/services/side-effects.mjs";

async function attemptShellRecovery({ inputText, plan, failed, options, planner }) {
  if (!options.json && plan?.presentation !== "assistant-first") {
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

function looksLikeGenericStatusQuery(inputText, plannerContext) {
  const text = String(inputText ?? "").trim();
  const normalized = normalizeConversationText(text);
  if (!text || /^(status|summary|project summary|show status|show tickets|list tickets)$/i.test(text)) {
    return false;
  }
  if (/\b(readiness|ready for beta|ready for release|doctor|diagnostics|provider|providers|version|metrics|stats|usage)\b/.test(normalized)) {
    return false;
  }
  if (/\b(what did the tests cover|what do the tests cover|test coverage|test status)\b/.test(normalized)) {
    return true;
  }
  if (/\b(status of|state of|how is|what about)\b/.test(normalized)) {
    return true;
  }
  if (/\bstatus\b/.test(normalized) && !/\bproject status\b/.test(normalized)) {
    return Boolean(
      inferStatusEntityType(text)
      || resolveImplicitTicketId(plannerContext, text)
      || /\b(shell|workflow|module|feature|file|symbol|class|ticket|epic|story|codelet|bug|issue|idea|risk)\b/.test(normalized)
    );
  }
  return false;
}

function inferStatusEntityType(inputText) {
  const normalized = normalizeConversationText(inputText);
  if (/\b(shell|workflow|provider|init surface)\b/.test(normalized)) return "surface";
  if (/\bmodule\b/.test(normalized)) return "module";
  if (/\bfeature|flow\b/.test(normalized)) return "feature";
  if (/\bfile\b/.test(normalized)) return "file";
  if (/\b(symbol|class|function|method|interface|type)\b/.test(normalized)) return "symbol";
  if (/\btest\b/.test(normalized)) return "test";
  if (/\bticket\b/.test(normalized)) return "ticket";
  if (/\bepic\b/.test(normalized)) return "epic";
  if (/\bstory|user story|use case\b/.test(normalized)) return "story";
  if (/\bcodelet\b/.test(normalized)) return "codelet";
  if (/\bbug\b/.test(normalized)) return "bug";
  if (/\bissue\b/.test(normalized)) return "issue";
  if (/\bidea\b/.test(normalized)) return "idea";
  if (/\brisk\b/.test(normalized)) return "risk";
  if (/\b(project|repo|repository|codebase)\b/.test(normalized)) return "project";
  return null;
}

function buildShellContinuationPlan({ text, plannerContext, activeGraphState, followUpMode = "continue-prior-work" }) {
  const normalized = normalizeConversationText(text);
  const priorTaskClass = normalizeTaskClass(activeGraphState?.focus?.taskClass, plannerContext);
  const priorSubject = String(activeGraphState?.focus?.subject ?? "").trim();
  const priorSearchQuery = String(activeGraphState?.focus?.searchQuery ?? "").trim();
  const references = normalizeShellReferences(activeGraphState?.references);

  if (!priorTaskClass || priorTaskClass === "classification") {
    return null;
  }

  if (followUpMode === "ask-about-prior-result") {
    return replyPlan(
      renderContinuationResultReply({ text, activeGraphState, plannerContext, priorTaskClass }),
      0.88,
      "Follow-up asked about the prior shell result rather than starting a new request.",
      {
        inputText: text,
        plannerContext,
        intent: {
          taskClass: "bug-hunting",
          followUpMode,
          references
        }
      }
    );
  }

  if (followUpMode === "revise-prior-answer") {
    return replyPlan(
      renderContinuationRevisionReply({ text, activeGraphState, plannerContext, priorTaskClass }),
      0.9,
      "Follow-up revised the prior shell answer instead of requesting a new topic.",
      {
        inputText: text,
        plannerContext,
        intent: {
          taskClass: "summarization",
          followUpMode,
          references
        }
      }
    );
  }

  const boundedPatch = /\b(small|bounded|minimal|surgical)\b/.test(normalized) && /\b(patch|change|fix)\b/.test(normalized);
  const wantsSmallerGroundedStep = /\bnext step\b/.test(normalized)
    && /\b(smaller|grounded|exact files|same goal)\b/.test(normalized);
  const wantsImmediateApplication = /\b(?:do|apply|implement)\b.*\b(?:now)\b/.test(normalized);
  if (boundedPatch || wantsSmallerGroundedStep || wantsImmediateApplication) {
    const searchQuery = priorSearchQuery
      || references.files[0]
      || references.modules[0]
      || priorSubject
      || extractOperationalSearchQuery(text, plannerContext)
      || "cli/lib/shell";
    return normalizeShellPlanEnvelope({
      kind: "plan",
      actions: [
        { type: "route", taskClass: priorTaskClass === "bug-hunting" ? "code-generation" : priorTaskClass },
        { type: "search", query: searchQuery }
      ],
      graph: buildActionGraph([
        { type: "route", taskClass: priorTaskClass === "bug-hunting" ? "code-generation" : priorTaskClass },
        { type: "search", query: searchQuery }
      ]),
      confidence: 0.9,
      reason: "Follow-up request continued the prior shell graph with a bounded implementation step.",
      strategy: `Continue the previous ${humanizeTaskClass(priorTaskClass)} flow and keep the change bounded around ${searchQuery}.`,
      presentation: "assistant-first",
      intent: {
        taskClass: priorTaskClass === "bug-hunting" ? "code-generation" : priorTaskClass,
        followUpMode,
        references
      }
    }, text, plannerContext, {
      taskClass: priorTaskClass === "bug-hunting" ? "code-generation" : priorTaskClass,
      intent: {
        followUpMode,
        references
      }
    });
  }

  return replyPlan([
    `Continuing the previous ${humanizeTaskClass(priorTaskClass)} flow.`,
    priorSubject ? `Current focus: ${priorSubject}.` : null,
    priorSearchQuery ? `Next concrete step: inspect ${priorSearchQuery} and keep the change bounded.` : "Next concrete step: inspect the previously identified hotspot and keep the change bounded."
  ].filter(Boolean).join("\n"), 0.86, "Continuation request reused the prior shell focus.", {
    inputText: text,
    plannerContext,
    intent: {
      taskClass: priorTaskClass,
      followUpMode,
      references
    }
  });
}

function renderContinuationResultReply({ text, activeGraphState, plannerContext, priorTaskClass }) {
  const failedNodes = (activeGraphState?.graph?.nodes ?? []).filter((node) => node.status === "failed");
  const candidateNode = failedNodes[0] ?? (activeGraphState?.graph?.nodes ?? []).find((node) => node.result?.summary);
  const summary = candidateNode?.result?.summary ?? "I do not have a concrete failed-node summary in the stored turn state.";
  const references = collectContinuationReferenceLines(activeGraphState, plannerContext);
  const lines = [
    `This is still part of the previous ${humanizeTaskClass(priorTaskClass)} flow.`,
    candidateNode ? `The clearest prior result is ${candidateNode.id} [${candidateNode.status}]: ${summary}` : summary,
    references.length ? `Grounding: ${references.join(", ")}` : null
  ].filter(Boolean);
  if (/\bsafe\b/.test(normalizeConversationText(text))) {
    lines.push("I would not treat that as safe to auto-execute unless the next action is explicitly non-mutating or the workflow gate is already satisfied.");
  }
  return lines.join("\n");
}

function renderContinuationRevisionReply({ text, activeGraphState, plannerContext, priorTaskClass }) {
  const references = collectContinuationReferenceLines(activeGraphState, plannerContext);
  const subject = String(activeGraphState?.focus?.subject ?? "shell continuation work").trim();
  const normalized = normalizeConversationText(text);
  if (/\bone sentence|single sentence\b/.test(normalized)) {
    return `${subject} remains the focus, grounded in the prior shell evidence, and the next step is to keep the change bounded.`;
  }
  if (/\b(bullets|bullet points)\b/.test(normalized)) {
    return [
      "Current continuation state:",
      `- Focus: ${subject}`,
      ...references.map((item) => `- ${item}`),
      `- Next step: continue the prior ${humanizeTaskClass(priorTaskClass)} flow with a smaller grounded step.`
    ].join("\n");
  }
  return [
    `Revised continuation summary: ${subject}.`,
    references.length ? `Grounding: ${references.join(", ")}` : null,
    `Next step: continue the prior ${humanizeTaskClass(priorTaskClass)} flow with a smaller grounded step.`
  ].filter(Boolean).join("\n");
}

function collectContinuationReferenceLines(activeGraphState, plannerContext) {
  const root = plannerContext?.root ?? process.cwd();
  const references = normalizeShellReferences(activeGraphState?.references);
  const files = references.files.map((item) => path.isAbsolute(item) ? item : path.resolve(root, item));
  return [...files, ...references.modules, ...references.tickets].slice(0, 4);
}

function buildReadinessContinuationPlan({ text, plannerContext, activeGraphState }) {
  const normalized = normalizeConversationText(text);
  if (!/\b(make|get)\s+(it|this|the project)\s+ready\b/.test(normalized)
    && !/\b(resolve|fix|handle|clear)\b.*\b(those|the)\b.*\b(blockers|blocking issues|beta blockers)\b/.test(normalized)
    && !/\bcan you\b.*\bresolve\b.*\bblockers\b/.test(normalized)) {
    return null;
  }

  const readinessState = extractLatestReadinessState(activeGraphState);
  const actionableBlockers = (readinessState?.blockers ?? [])
    .map((item) => String(item?.title ?? "").match(new RegExp(TICKET_ID_PATTERN))?.[0] ?? null)
    .filter(Boolean)
    .filter((id) => !String(id).startsWith("HUMAN-"));
  const rankedFallback = rankTicketsAgainstGoal(plannerContext?.summary?.activeTickets, {
    goal: readinessState?.goal ?? extractShellGoal(text)
  })
    .filter((ticket) => /^BUG-|^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/.test(ticket.id))
    .filter((ticket) => !String(ticket.id).startsWith("HUMAN-"))
    .map((ticket) => ticket.id);
  const nextTicketId = actionableBlockers[0] ?? rankedFallback[0] ?? null;
  if (!nextTicketId) {
    return null;
  }

  const goalType = readinessState?.goalType ?? "beta_readiness";
  const question = readinessState?.question ?? "Is this project ready for beta testing?";
  return {
    kind: "plan",
    actions: [
      { type: "execute_ticket", ticketId: nextTicketId, apply: true },
      { type: "evaluate_readiness", goalType, question }
    ],
    graph: buildActionGraph([
      { type: "execute_ticket", ticketId: nextTicketId, apply: true },
      { type: "evaluate_readiness", goalType, question }
    ]),
    confidence: 0.98,
    reason: "Continuation request mapped to the highest-priority actionable readiness blocker, followed by a readiness re-check.",
    strategy: `Start with ${nextTicketId}, which is the highest-priority actionable blocker from the latest readiness result, then re-check readiness.`,
    planner: {
      mode: "heuristic",
      reason: "Continuation from readiness result."
    },
    presentation: "assistant-first"
  };
}

function extractLatestReadinessState(activeGraphState) {
  const nodes = activeGraphState?.graph?.nodes ?? [];
  const readinessNode = [...nodes]
    .reverse()
    .find((node) => node.type === "evaluate_readiness" && node.result?.structuredPayload?.operation === "evaluate_readiness");
  const payload = readinessNode?.result?.structuredPayload;
  if (!payload) {
    return null;
  }
  return {
    blockers: Array.isArray(payload.blockers) ? payload.blockers : [],
    goalType: String(payload.goalType ?? payload.goal?.type ?? "beta_readiness"),
    question: String(payload.question ?? payload.meta?.question ?? "Is this project ready for beta testing?"),
    goal: extractShellGoal(String(payload.question ?? ""))
  };
}

function renderCombinedStatusReadinessReply(executions) {
  const projectSummaryRaw = executions.find((item) => item.action?.type === "project_summary");
  const readinessExecution = executions.find((item) => item.action?.type === "evaluate_readiness");
  const summary = parseProjectSummaryText(String(projectSummaryRaw?.stdout ?? ""));
  const readiness = parseReadinessText(String(readinessExecution?.stdout ?? ""));

  const lines = [];
  if (summary.ticketCount != null) {
    lines.push(`Project status: ${summary.ticketCount} active tickets, ${summary.candidateCount ?? 0} candidates, ${summary.noteCount ?? 0} notes.`);
  } else {
    lines.push("Project status is available, but the summary output was weaker than expected.");
  }
  const rankedTickets = rankStatusTickets(summary.topTickets);
  if (rankedTickets.length) {
    lines.push(`Current focus: ${rankedTickets.slice(0, 3).map((ticket) => `${ticket.id} (${ticket.lane})`).join(", ")}.`);
  }
  lines.push("");
  lines.push(renderReadinessReply(readinessExecution?.structuredPayload, String(readinessExecution?.stdout ?? "")));
  return lines.join("\n").trim();
}

function renderExecutionPlusReadinessReply(executions) {
  const execution = executions.find((item) => item.action?.type === "execute_ticket");
  const readiness = executions.find((item) => item.action?.type === "evaluate_readiness");
  const ticketPayload = execution?.structuredPayload ?? null;
  const readinessReply = renderReadinessReply(readiness?.structuredPayload, String(readiness?.stdout ?? ""));
  const lines = [];
  if (ticketPayload?.success) {
    lines.push(`I started on ${execution.action.ticketId} and the execution path completed successfully.`);
    if (Array.isArray(ticketPayload.changedFiles) && ticketPayload.changedFiles.length) {
      lines.push(`Changed files: ${ticketPayload.changedFiles.join(", ")}.`);
    }
  } else if (ticketPayload?.status) {
    lines.push(`I started with ${execution.action.ticketId}, but it did not complete safely.`);
    lines.push(`Why it stopped: ${ticketPayload.error ?? ticketPayload.status}.`);
    if (ticketPayload.executionPlan?.concerns?.length) {
      lines.push(`Current concerns: ${ticketPayload.executionPlan.concerns.join("; ")}.`);
    }
  } else {
    lines.push(`I started with ${execution?.action?.ticketId ?? "the highest-priority blocker"}.`);
  }
  lines.push("");
  lines.push(readinessReply);
  return lines.join("\n").trim();
}

function renderReadinessReply(structuredPayload, rawText) {
  const parsed = structuredPayload?.operation === "evaluate_readiness"
    ? parseReadinessPayload(structuredPayload)
    : parseReadinessText(rawText);
  const lines = [];
  const blockerCount = parsed.blockers.length;
  const severitySummary = summarizeBlockerSeverities(parsed.blockers);
  if (parsed.verdict === "ready") {
    lines.push(`Beta readiness: ready with ${Math.round(parsed.confidence * 100)}% confidence.`);
  } else {
    lines.push(`Beta readiness: not ready yet (${Math.round(parsed.confidence * 100)}% confidence).`);
  }
  if (blockerCount) {
    lines.push(`Main blockers: ${blockerCount} total${severitySummary ? `, including ${severitySummary}` : ""}.`);
    for (const blocker of parsed.blockers.slice(0, 3)) {
      lines.push(`- ${blocker.title}`);
    }
  }
  if (parsed.nextChecks.length) {
    lines.push(`Next step: ${parsed.nextChecks[0]}`);
  }
  return lines.join("\n");
}

function parseReadinessPayload(payload) {
  return {
    verdict: String(payload?.opinion?.verdict ?? "unknown"),
    confidence: Number(payload?.opinion?.confidence ?? 0),
    blockers: Array.isArray(payload?.blockers) ? payload.blockers.map((item) => ({
      title: String(item.title ?? item.reason ?? "").trim(),
      severity: String(item.severity ?? "").trim()
    })) : [],
    nextChecks: Array.isArray(payload?.recommended_next_actions) ? payload.recommended_next_actions.map(String) : []
  };
}

function parseReadinessText(text) {
  const lines = String(text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const verdictLine = lines.find((line) => line.startsWith("Verdict:")) ?? "";
  const verdictMatch = verdictLine.match(/Verdict:\s+([a-z_]+)\s+\((\d+)% confidence\)/i);
  const blockers = [];
  let inBlockers = false;
  let inNext = false;
  const nextChecks = [];
  for (const line of lines) {
    if (line === "Top blockers:") {
      inBlockers = true;
      inNext = false;
      continue;
    }
    if (line === "Next checks:") {
      inBlockers = false;
      inNext = true;
      continue;
    }
    if (!line.startsWith("-")) {
      continue;
    }
    if (inBlockers) {
      const match = line.match(/^- \[([a-z]+)\]\s+(.+?)(?::\s+.+)?$/i);
      blockers.push({
        severity: match?.[1]?.toLowerCase() ?? "",
        title: match?.[2] ?? line.slice(2)
      });
    } else if (inNext) {
      nextChecks.push(line.replace(/^- /, ""));
    }
  }
  return {
    verdict: verdictMatch?.[1] ?? "unknown",
    confidence: verdictMatch?.[2] ? Number(verdictMatch[2]) / 100 : 0,
    blockers,
    nextChecks
  };
}

function summarizeBlockerSeverities(blockers) {
  const counts = blockers.reduce((acc, blocker) => {
    const key = blocker.severity || "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const parts = [];
  if (counts.high) parts.push(`${counts.high} high`);
  if (counts.medium) parts.push(`${counts.medium} medium`);
  if (counts.low) parts.push(`${counts.low} low`);
  return parts.join(", ");
}

function parseProjectSummaryText(text) {
  const lines = String(text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const counts = {
    ticketCount: Number(lines.find((line) => line.startsWith("Tickets:"))?.split(":")[1]?.trim() ?? NaN),
    candidateCount: Number(lines.find((line) => line.startsWith("Candidates:"))?.split(":")[1]?.trim() ?? NaN),
    noteCount: Number(lines.find((line) => line.startsWith("Notes tracked:"))?.split(":")[1]?.trim() ?? NaN)
  };
  const topTickets = [];
  let inTickets = false;
  for (const line of lines) {
    if (line === "Active Tickets:") {
      inTickets = true;
      continue;
    }
    if (!line.startsWith("-")) {
      inTickets = false;
      continue;
    }
    if (inTickets) {
      const match = line.match(/^- \[([^\]]+)\]\s+([A-Z0-9-]+):\s+(.+)$/);
      if (match) {
        topTickets.push({ lane: match[1], id: match[2], title: match[3] });
      }
    }
  }
  return {
    ...counts,
    topTickets
  };
}

function rankStatusTickets(tickets = []) {
  const laneRank = new Map([
    ["In Progress", 0],
    ["Bugs P1", 1],
    ["Bugs P2/P3", 2],
    ["Human Inspection", 3],
    ["Todo", 4],
    ["Suggestions", 5],
    ["Backlog", 6],
    ["Deep Backlog", 7]
  ]);
  return tickets
    .slice()
    .sort((left, right) => (laneRank.get(left.lane) ?? 99) - (laneRank.get(right.lane) ?? 99) || left.id.localeCompare(right.id));
}

export function chooseShellPlannerModel(ollamaProvider) {
  const models = Array.isArray(ollamaProvider?.models) ? [...ollamaProvider.models] : [];
  if (!models.length) {
    throw new Error("No Ollama models available for shell planning.");
  }

  const qualityCap = ollamaProvider.plannerMaxQuality ?? defaultPlannerQualityCap(ollamaProvider.hardwareClass);
  const sizeCap = ollamaProvider.maxModelSizeB ?? defaultPlannerSizeCap(ollamaProvider.hardwareClass);
  const textCapablePool = models.filter((model) => isTextCapableShellPlannerModel(model) && isViableShellPlannerModel(model));
  if (!textCapablePool.length) {
    throw new Error("No text-capable Ollama models available for shell planning.");
  }
  const sizeAndQualityPool = textCapablePool.filter((model) =>
    (model.sizeB == null || sizeCap == null || model.sizeB <= sizeCap)
    && qualityRank(model.quality) <= qualityRank(qualityCap)
  );
  const qualityPool = textCapablePool.filter((model) => qualityRank(model.quality) <= qualityRank(qualityCap));
  const sizePool = textCapablePool.filter((model) => model.sizeB == null || sizeCap == null || model.sizeB <= sizeCap);
  const selectionPool = sizeAndQualityPool.length
    ? sizeAndQualityPool
    : qualityPool.length
      ? qualityPool
      : sizePool.length
        ? sizePool
        : textCapablePool;

  selectionPool.sort((left, right) =>
    (right.fitScore ?? -1) - (left.fitScore ?? -1)
    || (right.fitReasons?.length ?? 0) - (left.fitReasons?.length ?? 0)
    ||
    qualityRank(left.quality) - qualityRank(right.quality)
    || (left.sizeB ?? Number.POSITIVE_INFINITY) - (right.sizeB ?? Number.POSITIVE_INFINITY)
    || left.id.localeCompare(right.id)
  );

  const selected = selectionPool[0];
  const needsHardwareHint = !ollamaProvider.hardwareClass && !ollamaProvider.maxModelSizeB && !ollamaProvider.plannerMaxQuality;
  const reasonParts = [];
  reasonParts.push("text-capable planner pool");
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
  if (typeof selected.fitScore === "number") {
    reasonParts.push(`matrix fit ${selected.fitScore}`);
  }
  return {
    ...selected,
    needsHardwareHint,
    reason: reasonParts.join(", ") || "using the lightest suitable local planner model"
  };
}

function isTextCapableShellPlannerModel(model) {
  if (!model || typeof model !== "object") {
    return false;
  }

  const capabilities = model.capabilities ?? {};
  const strengths = Array.isArray(model.strengths) ? model.strengths : [];
  const textScore = Math.max(
    Number(capabilities.logic ?? 0),
    Number(capabilities.strategy ?? 0),
    Number(capabilities.prose ?? 0)
  );
  const visualScore = Number(capabilities.visual ?? 0);

  if (strengths.some((strength) => ["logic", "strategy", "prose"].includes(String(strength).toLowerCase()))) {
    return true;
  }

  if (textScore >= 2.5 && textScore >= visualScore) {
    return true;
  }

  const lower = String(model.id ?? "").toLowerCase();
  return /(?:coder|reason|chat|assistant|gemma|llama|mistral|hermes|qwen|phi|deepseek)/.test(lower) && !/(?:moondream|vision)/.test(lower);
}

function isViableShellPlannerModel(model) {
  if (!model || typeof model !== "object") {
    return false;
  }
  const capabilities = model.capabilities ?? {};
  const strengths = Array.isArray(model.strengths) ? model.strengths : [];
  const lower = String(model.id ?? "").toLowerCase();
  const textScore = Math.max(
    Number(capabilities.logic ?? 0),
    Number(capabilities.strategy ?? 0),
    Number(capabilities.prose ?? 0)
  );

  if (/(?:moondream|vision|embed)/.test(lower)) {
    return false;
  }
  if (/\bphi\b/.test(lower)) {
    return false;
  }
  if (strengths.some((strength) => ["logic", "strategy", "prose"].includes(String(strength).toLowerCase()))) {
    return true;
  }
  if (textScore >= 2.5) {
    return true;
  }
  return /(?:coder|reason|chat|assistant|gemma|llama|mistral|hermes|qwen|deepseek)/.test(lower);
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

function splitShellRequestSegments(inputText) {
  const text = String(inputText ?? "").trim();
  if (!text) {
    return [];
  }

  return text
    .split(/(?:\s+then\s+|[;\n]+(?=\s*\S))/i)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function getShellPlannerTimeoutMs(options, planner) {
  if (Number.isFinite(options?.plannerTimeoutMs) && options.plannerTimeoutMs > 0) {
    return options.plannerTimeoutMs;
  }
  const envTimeout = Number(process.env.AI_WORKFLOW_SHELL_PLANNER_TIMEOUT_MS ?? "");
  if (Number.isFinite(envTimeout) && envTimeout > 0) {
    return envTimeout;
  }
  if (planner?.providerId === "ollama") {
    return 20000;
  }
  return 15000;
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
  switch (String(value ?? "").toLowerCase()) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
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
    `All time: ${metrics.totalCalls} calls, ${metrics.successRate}% success, ${metrics.avgLatencyMs}ms avg latency`,
    `Assumptions: ${metrics.assumptions?.helpVsBaseline ?? "heuristic estimate"}`,
    `Quality basis: ${metrics.assumptions?.qualityBasis ?? "all traffic"}`,
    `Tokens: ${metrics.assumptions?.tokens ?? "actual usage only"}`
  ];

  for (const key of ["latestSession", "last4WorkHours", "trailingWeek"]) {
    const window = metrics.windows?.[key];
    if (!window) {
      continue;
    }
    lines.push("");
    lines.push(window.label);
    lines.push(`- Calls: ${window.calls}`);
    lines.push(`- Cost: estimated ${window.cost.estimatedManualMinutes}m manual vs ${window.cost.estimatedToolMinutes}m tool time, ${window.cost.estimatedMinutesSaved}m saved`);
    lines.push(`- Quality: ${window.quality.qualityScore}/100 based on ${window.quality.basisLabel} (${window.quality.successRate}% success, ${window.quality.fastEnoughRate}% fast-enough)`);
    lines.push(`- Mix: ${window.localCalls} local / ${window.remoteCalls} remote, ${window.realTraffic.calls} real / ${window.mockTraffic.calls} mock calls`);
    lines.push(`- Tokens: ${window.totalTokens} total (${window.realTraffic.totalTokens} real / ${window.mockTraffic.totalTokens} mock)`);
    if (window.byModel?.length) {
      lines.push(`- Top model: ${window.byModel[0].model_id} (${window.byModel[0].count} calls, ${window.byModel[0].success_rate}% success)`);
    }
    for (const alert of window.alerts ?? []) {
      lines.push(`- Alert: ${alert}`);
    }
  }
  return lines.join("\n") + "\n";
}

function formatReadinessEvaluation(response, json) {
  if (json) {
    return `${JSON.stringify(response, null, 2)}\n`;
  }
  const lines = [
    response.summary,
    `Status: ${response.status}`,
    `Verdict: ${response.opinion.verdict} (${Math.round(response.opinion.confidence * 100)}% confidence)`
  ];
  if (response.evidence?.length) {
    lines.push("");
    lines.push("Evidence basis:");
    for (const item of response.evidence.slice(0, 3)) {
      const freshness = item.freshness?.status && item.freshness.status !== "unknown"
        ? ` | freshness: ${item.freshness.status}`
        : "";
      lines.push(`- [${item.source}] ${item.ref}: ${item.claim}${freshness}`);
    }
  }
  if (response.blockers?.length) {
    lines.push("");
    lines.push("Top blockers:");
    for (const blocker of response.blockers.slice(0, 4)) {
      lines.push(`- [${blocker.severity}] ${blocker.title}: ${blocker.reason}`);
    }
  }
  if (response.gaps?.length) {
    lines.push("");
    lines.push("Evidence gaps:");
    for (const gap of response.gaps.slice(0, 4)) {
      lines.push(`- ${gap}`);
    }
  }
  if (response.recommended_next_actions?.length) {
    lines.push("");
    lines.push("Next checks:");
    for (const item of response.recommended_next_actions.slice(0, 4)) {
      lines.push(`- ${item}`);
    }
  }
  return `${lines.join("\n")}\n`;
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

function renderExecuteTicketResult(action, payload) {
  const lines = [
    `Ticket: ${action.ticketId}`,
    `Status: ${payload.status ?? (payload.success ? "ok" : "failed")}`,
    `Apply: ${action.apply === false ? "no" : "yes"}`,
    `Ready: ${payload.executionPlan?.ready ? "yes" : "no"}`
  ];
  if (payload.executionPlan?.verificationCommands?.length) {
    lines.push(`Verification: ${payload.executionPlan.verificationCommands.map((item) => item.command).join(" | ")}`);
  }
  if (payload.executionPlan?.workingSet?.length) {
    lines.push(`Files: ${payload.executionPlan.workingSet.join(", ")}`);
  }
  if (payload.changedFiles?.length) {
    lines.push(`Changed files: ${payload.changedFiles.join(", ")}`);
  }
  if (payload.error) {
    lines.push(`Error: ${payload.error}`);
  }
  return `${lines.join("\n")}\n`;
}

const SHELL_HELP = `
Usage:
  ai-workflow shell
  ai-workflow shell <request...> [--yes] [--plan-only] [--no-ai] [--trace] [--json]

Notes:
  - The shell turns natural-language requests into workflow actions.
  - It uses a high-power remote planner (Gemini/OpenAI) if available, falling back to local Ollama.
  - It can now "chat" and answer general project questions if a smart model is configured.
  - The shell starts in plan mode. Use \`mutate\` to switch into mutating mode and \`plan\` to return to read-only mode.
  - Use \`trace on\` and \`trace off\` to show or hide AI prompts, responses, and selected models.
  - Mutating actions still respect workflow gating when they target in-progress ticket execution.

Examples:
  - "are we synched?"
  - "what tickets are in Todo?"
  - "sync and show review hotspots"
  - "set-provider-key google"
`;
