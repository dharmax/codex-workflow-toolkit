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
import { discoverProviderState, generateWithOllama } from "../../core/services/providers.mjs";
import { addManualNote, createTicket, getProjectSummary, searchProject, syncProject } from "../../core/services/sync.mjs";
import { buildTicketEntity } from "../../core/services/projections.mjs";
import { buildTelegramPreview } from "../../core/services/telegram.mjs";
import { parseArgs, printAndExit } from "../../runtime/scripts/codex-workflow/lib/cli.mjs";
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
  "review"
];

export async function handleShell(rest, { cliPath } = {}) {
  const args = parseArgs(rest);
  if (args.help) {
    printAndExit(SHELL_HELP.trim());
  }

  const root = process.cwd();
  const plannerContext = await buildShellContext(root);
  const planner = await resolveShellPlanner(root);
  const options = {
    root,
    json: Boolean(args.json),
    yes: Boolean(args.yes),
    noAi: Boolean(args["no-ai"]),
    planOnly: Boolean(args["plan-only"]),
    cliPath: cliPath ?? path.resolve(root, "cli", "ai-workflow.mjs"),
    plannerContext,
    planner
  };

  const prompt = args._.join(" ").trim();
  if (prompt) {
    const result = await runShellTurn(prompt, options);
    return emitShellResult(result, options);
  }

  return runInteractiveShell(options);
}

export async function buildShellContext(root = process.cwd()) {
  const [toolkitCodelets, projectCodelets, summary] = await Promise.all([
    listToolkitCodelets(),
    listProjectCodelets(root),
    safeGetProjectSummary(root)
  ]);

  return {
    root,
    toolkitCodelets,
    projectCodelets,
    summary
  };
}

export async function resolveShellPlanner(root = process.cwd()) {
  const providerState = await discoverProviderState({ root });
  const ollama = providerState.providers.ollama;
  if (!ollama?.available || !ollama.models.length) {
    return {
      mode: "heuristic",
      reason: "No available Ollama models for shell planning."
    };
  }

  const selected = chooseShellPlannerModel(ollama);

  return {
    mode: "ollama",
    providerId: "ollama",
    modelId: selected.id,
    host: ollama.host,
    configWarnings: providerState.configWarnings ?? [],
    needsHardwareHint: selected.needsHardwareHint,
    reason: selected.reason
  };
}

export async function planShellRequest(inputText, options) {
  const heuristic = planShellRequestHeuristically(inputText, options.plannerContext);
  if (options.noAi || heuristic.confidence >= 0.92 || options.planner.mode !== "ollama") {
    return {
      ...heuristic,
      planner: {
        mode: options.noAi ? "heuristic-forced" : options.planner.mode,
        reason: heuristic.reason
      }
    };
  }

  try {
    const aiPlan = await planShellRequestWithOllama(inputText, options);
    return {
      ...aiPlan,
      planner: {
        mode: "ollama",
        providerId: options.planner.providerId,
        modelId: options.planner.modelId,
        host: options.planner.host,
        reason: options.planner.reason
      }
    };
  } catch {
    return {
      ...heuristic,
      planner: {
        mode: "heuristic-fallback",
        reason: heuristic.reason
      }
    };
  }
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
    }], 0.99, "Explicit Ollama hardware setup request.");
  }

  const routeMatch = text.match(/^(?:route|pick model for)\s+(.+)$/i);
  if (routeMatch) {
    return actionPlan([{ type: "route", taskClass: normalizeTaskClass(routeMatch[1]) }], 0.93, "Explicit routing request.");
  }

  const searchMatch = text.match(/^(?:search|find)\s+(.+)$/i);
  if (searchMatch) {
    return actionPlan([{ type: "search", query: searchMatch[1].trim() }], 0.95, "Explicit search request.");
  }

  const ticketMatch = text.match(/(?:extract\s+ticket|show\s+ticket|ticket)\s+([A-Z]+-\d+)/i);
  if (ticketMatch) {
    return actionPlan([{ type: "extract_ticket", ticketId: ticketMatch[1].toUpperCase() }], 0.94, "Explicit ticket extraction request.");
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

export async function planShellRequestWithOllama(inputText, options) {
  const catalog = buildActionCatalog(options.plannerContext);
  const system = [
    "You are a strict command planner for ai-workflow.",
    "Return JSON only. No markdown, no explanation.",
    "Choose from the allowed action types only.",
    "Prefer deterministic ai-workflow commands over freeform replies.",
    "Use at most 3 actions.",
    "If the request is ambiguous, return kind=reply with a short clarification question."
  ].join(" ");
  const prompt = [
    "Allowed action schema:",
    JSON.stringify({
      kind: "plan|reply|exit",
      confidence: 0.0,
      reason: "short string",
      reply: "only when kind=reply",
      actions: [
        {
          type: "project_summary|doctor|sync|run_review|search|extract_ticket|extract_guidelines|route|telegram_preview|add_note|create_ticket|run_codelet",
          query: "for search",
          ticketId: "for extract_ticket/extract_guidelines",
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
        }
      ]
    }, null, 2),
    "",
    "Available codelets:",
    catalog,
    "",
    "Project summary context:",
    JSON.stringify(options.plannerContext.summary ?? {}, null, 2),
    "",
    `User request: ${JSON.stringify(String(inputText))}`
  ].join("\n");

  const completion = await generateWithOllama({
    host: options.planner.host,
    model: options.planner.modelId,
    system,
    prompt,
    format: "json"
  });
  const parsed = JSON.parse(completion.response);
  return validateShellPlan(parsed, options.plannerContext);
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
      return { type, taskClass: normalizeTaskClass(action.taskClass) };
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
  if (plan.kind !== "plan") {
    return {
      input: inputText,
      plan,
      executed: [],
      preRendered: false
    };
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
    output.write(`${renderPlannerLine(plan.planner)}\n${renderActionList(plan.actions)}\n`);
    preRendered = true;
  }

  const executed = [];
  for (const action of plan.actions) {
    executed.push(await executeShellAction(action, options));
  }

  const failed = executed.find((item) => item.ok === false);
  let recovery = null;
  if (failed && options.planner.mode === "ollama" && !options.noAi) {
    recovery = await attemptShellRecovery({
      inputText,
      plan,
      failed,
      options
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
    case "doctor":
      return cliCommand(["doctor", ...(json ? ["--json"] : [])], false);
    case "sync":
      return cliCommand(["sync", ...(json ? ["--json"] : [])], true);
    case "run_review":
      return cliCommand(["run", "review"], false);
    case "search":
      return cliCommand(["project", "search", action.query, ...(json ? ["--json"] : [])], false);
    case "extract_ticket":
      return cliCommand(["extract", "ticket", action.ticketId], false);
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
  try {
    output.write(`ai-workflow shell\n${renderPlannerLine(options.planner)}\nType 'help' for examples. Type 'exit' to quit.\n\n`);
    for (const warning of options.planner.configWarnings ?? []) {
      output.write(`config warning: ${warning}\n`);
    }
    if ((options.planner.configWarnings ?? []).length) {
      output.write("\n");
    }
    if (options.planner.needsHardwareHint) {
      output.write([
        "Planner note: Ollama hardware is not configured, so the shell is defaulting to a smaller model.",
        "You can configure it now, or later with `ai-workflow set-ollama-hw`.",
        ""
      ].join("\n"));
      const answer = (await promptShellQuestion(rl, "Configure Ollama hardware now? [Y/n] ") ?? "").trim().toLowerCase();
      if (!answer || answer === "y" || answer === "yes") {
        rl.pause();
        await configureOllamaHardware({
          root: options.root,
          interactive: true
        });
        rl.resume();
        options.planner = await resolveShellPlanner(options.root);
        output.write(`\nUpdated planner: ${renderPlannerLine(options.planner)}\n\n`);
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
  const rl = readline.createInterface({ input, output });
  try {
    output.write(`Planned actions:\n${renderActionList(plan.actions)}\n`);
    const answer = (await promptShellQuestion(rl, "Run mutating actions? [y/N] ") ?? "").trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
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
    case "doctor": {
      const report = await buildDoctorReport({ root: options.root });
      return options.json
        ? `${JSON.stringify(report, null, 2)}\n`
        : `${renderDoctorReport(report)}\n`;
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

function normalizeTaskClass(value) {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/\s+/g, "-");
  return KNOWN_TASK_CLASSES.includes(normalized) ? normalized : "classification";
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
  - The shell turns natural-language requests into known ai-workflow actions.
  - It prefers a local Ollama planner when available.
  - Mutating actions ask for confirmation unless --yes is passed.
`;
