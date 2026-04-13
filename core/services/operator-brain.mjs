/**
 * Responsibility: Provide a shared operator-brain backend for natural-language workflow handling.
 * Scope: Handles grounding, planning (NL-to-JS), and execution orchestration.
 */

import path from "node:path";
import { withWorkflowStore, getProjectSummary, syncProject, getProjectMetrics, getSmartProjectStatus } from "./sync.mjs";
import { resolveProjectStatus } from "./status.mjs";
import { executeTicket, decomposeTicket, ideateFeature, sweepBugs } from "./orchestrator.mjs";
import { executeCodelet } from "./codelet-executor.mjs";
import { executeJsOrchestrator } from "./js-orchestrator.mjs";
import { generateCompletion } from "./providers.mjs";
import { routeTask } from "./router.mjs";
import { stableId } from "../lib/hash.mjs";

/**
 * Executes a natural language request through the operator brain.
 */
export async function executeOperatorRequest(prompt, options = {}) {
  const root = options.root ?? process.cwd();
  
  // 1. Plan the request (NL -> JS)
  const plan = await planOperatorRequest(prompt, options);
  
  if (plan.kind !== "plan" || !plan.code) {
    return {
      ok: true,
      plan,
      assistantReply: plan.assistantReply ?? "I'm not sure how to handle that request."
    };
  }

  // 2. Execute the plan
  const services = buildOperatorServices(root, options);
  const workflowResult = await withWorkflowStore(root, async (workflowStore) => {
    return executeJsOrchestrator(plan.code, {
      workflowStore,
      prompt,
      runId: options.runId,
      services
    });
  });

  return {
    ok: workflowResult.ok,
    plan,
    workflowResult,
    assistantReply: workflowResult.ok ? "Workflow completed successfully." : `Workflow failed: ${workflowResult.error}`
  };
}

export async function planOperatorRequest(inputText, options = {}) {
  const root = options.root ?? process.cwd();
  
  const { system, prompt } = await buildOperatorPlannerPrompt(inputText, options);
  
  const model = options.planner ?? (await routeTask({ root, taskClass: "project-planning" })).recommended;
  if (!model) {
    return { kind: "reply", assistantReply: "No planning model available." };
  }

  try {
    const completion = await generateCompletion({
      providerId: model.providerId,
      modelId: model.modelId,
      system,
      prompt,
      config: { host: model.host, apiKey: model.apiKey, format: "json" }
    });

    const plan = JSON.parse(completion.response);
    return plan;
  } catch (error) {
    console.error("[operator-brain] Planning failed:", error);
    return { kind: "reply", assistantReply: `Planning failed: ${error.message}` };
  }
}

async function buildOperatorPlannerPrompt(inputText, options) {
  const plannerContext = options.plannerContext ?? {};
  
  const catalog = buildActionCatalog(plannerContext);
  const runtimeContext = buildOperatorPlannerRuntimeContext(plannerContext, options);
  const groundingContext = await buildOperatorPlannerGroundingContext(inputText, options);
  const schemaPrompt = buildOperatorPlannerSchemaPrompt();

  const system = [
    "You are the OPERATOR BRAIN, the high-level steering logic of ai-workflow.",
    "Behave like a Senior Principal Engineer taking control of a messy project.",
    "Goal: Reach a 'READY' state by identifying work, creating tickets, and executing code.",
    "",
    "## Operating Contract",
    "- Use `kind=plan` for almost everything. Only use `kind=reply` for simple greetings.",
    "- NEVER reply saying 'I do not see an active ticket' or 'Please create a ticket'. This is a failure state.",
    "- If no tickets exist and the user provides a goal, your FIRST STEP is to call `orchestrator.ideateFeature` or `sync.createTicket`.",
    "- If a ticket exists but isn't 'In Progress', your FIRST STEP is to call `exec('ai-workflow project ticket start <id>')`.",
    "- You have implicit permission to create and start tickets to get the job done.",
    "",
    "## Available Actions:",
    catalog,
    "",
    "## Planning Rules",
    "- Use `await step(id, desc, fn)` for persistent operations.",
    "- Use `await transition(to, trigger, fn)` for state transitions.",
    "- Use `await exec(cmd, [args])` for CLI/Git commands.",
    "- Include comments and proper try/catch exception handling in the generated JS.",
    "- JSON only: your output must be valid JSON matching the schema.",
  ].join("\n");

  const promptSections = [
    "## Environment",
    runtimeContext,
    groundingContext ? `\n## Evidence\n${groundingContext}` : "\n## Evidence\nNo active tickets or recent status found. This project is a blank slate.",
    "",
    "## Schema",
    schemaPrompt,
    "",
    `## Request:\n"${inputText}"\n\nYour Response (JSON):`
  ];

  return {
    system,
    prompt: promptSections.join("\n")
  };
}

async function buildOperatorPlannerGroundingContext(inputText, options = {}) {
  const sections = [];
  const root = options.root ?? process.cwd();
  const lower = inputText.toLowerCase();

  // Evaluative/Bootstrap Intent (Audit, Health, Quality, Mess, Regression)
  if (/\b(how is|audit|health|quality|metrics|checks?|status|doing|ready|readiness|mess|regression|broken)\b/i.test(lower)) {
    const status = await resolveProjectStatus({ projectRoot: root, selector: ".", includeRelated: true }).catch(() => null);
    if (status?.ok) {
      sections.push(`### Project Health / Status\n${status.title}\n${status.summary}\nActive Tickets: ${status.evidence?.filter(e => e.includes("ticket")).length ?? 0}`);
    }
    const metrics = await getProjectMetrics({ projectRoot: root }).catch(() => null);
    if (metrics) {
      sections.push(`### Performance Metrics\n- Success Rate: ${metrics.successRate}%\n- Avg Latency: ${metrics.avgLatencyMs}ms\n- Total Calls: ${metrics.totalCalls}`);
    }
  }

  // Workplan/Focus Intent (Next steps, Planning, Roadmap, Focus)
  if (/\b(plan|start|next|roadmap|todo|working on|tackle|sequence|order|focus|workplan)\b/i.test(lower)) {
    const summary = await getProjectSummary({ projectRoot: root }).catch(() => null);
    if (summary) {
      const topTickets = summary.activeTickets.slice(0, 5).map(t => `- [${t.lane}] ${t.id}: ${t.title}`).join("\n");
      sections.push(`### Current Working Set\n${topTickets || "No active tickets."}`);
    }
  }

  // Fallback Grounding (Heuristic search)
  if (sections.length === 0 && inputText.length > 15) {
    const payload = await resolveProjectStatus({
      projectRoot: root,
      selector: ".",
      includeRelated: true,
      rawQuestion: true,
      relatedLimit: 3
    }).catch(() => null);
    
    if (payload?.ok) {
      sections.push(`### Project Context\n${payload.summary}`);
    }
  }

  return sections.filter(Boolean).join("\n\n");
}

function buildOperatorPlannerRuntimeContext(plannerContext = {}, options = {}) {
  const lines = [
    `cwd: ${options.root ?? process.cwd()}`,
    `project: ${plannerContext.projectSummary?.title ?? "unknown"}`
  ];
  return lines.join("\n");
}

function buildOperatorPlannerSchemaPrompt() {
  return [
    '{"kind":"plan","confidence":0.9,"code":"async () => { ... }","intent":{...}}',
    'Field "code" must be an async JS function body.',
    'Helpers:',
    '- `await step(id, desc, fn)`: Persistent operation.',
    '- `await transition(toState, trigger, fn)`: State-machine move.',
    '- `await shell(prompt)`: Recursive NL call.',
    '- `await exec(cmd, [args])`: Raw shell command.',
    '- `await executeCodelet(id, args)`: Toolkit tool.',
    '- `issue(type, sum, {details})`: Log failure.',
    'Patterns:',
    '- Use `try/catch` & comments.',
    '- Use `transition` for branching logic.',
    'Simple replies: use kind:"reply" and omit "code".'
  ].join("\n");
}

function buildActionCatalog(plannerContext = {}) {
  const baseActions = [
    "sync", "status_query", "doctor", "execute_ticket", "decompose_ticket", "ideate_feature", "sweep_bugs"
  ];
  return `Valid actions: ${baseActions.join(", ")}`;
}

/**
 * Resolves a host request (e.g. from the 'ask' surface).
 */
export async function resolveHostRequest(options) {
  const { projectRoot, text, host } = options;
  
  // Reuse the execution logic
  const result = await executeOperatorRequest(text, {
    root: projectRoot,
    host
  });

  // Map result back to host-resolver format for compatibility
  return {
    status: result.ok ? "complete" : "failed",
    route: {
      intent: result.plan?.intent?.capability ?? "operator_request",
      operation: "operator_brain",
      reason: result.plan?.reason ?? "Handled by shared operator brain."
    },
    response_type: "reply",
    payload: {
      summary: result.assistantReply,
      answer: result.assistantReply,
      workflowResult: result.workflowResult
    }
  };
}

function buildOperatorServices(root, options) {
  return {
    sync: {
      syncProject: (args) => syncProject({ projectRoot: root, ...args }),
      getProjectSummary: (args) => getProjectSummary({ projectRoot: root, ...args }),
      getProjectMetrics: (args) => getProjectMetrics({ projectRoot: root, ...args }),
    },
    status: {
      resolveProjectStatus: (args) => resolveProjectStatus({ projectRoot: root, ...args }),
      getSmartProjectStatus: (args) => getSmartProjectStatus({ projectRoot: root, ...args }),
    },
    orchestrator: {
      executeTicket: (args) => executeTicket({ root, ...args }),
      decomposeTicket: (args) => decomposeTicket({ root, ...args }),
      ideateFeature: (args) => ideateFeature({ root, ...args }),
      sweepBugs: (args) => sweepBugs({ root, ...args }),
    },
    codelets: {
      execute: (id, args) => executeCodelet(id, args, { cwd: root }),
    },
    shell: {
      execute: (prompt, opts) => executeOperatorRequest(prompt, { ...options, ...opts }),
    },
    sh: {
      execute: async (command, args = []) => {
        const { execFile } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execFileAsync = promisify(execFile);
        const { stdout, stderr } = await execFileAsync(command, args, { cwd: root, shell: true });
        return { stdout: stdout.trim(), stderr: stderr.trim(), ok: true };
      }
    }
  };
}
