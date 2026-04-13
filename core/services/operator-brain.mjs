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
  const history = options.history ?? [];
  const activeGraphState = options.activeGraphState ?? null;
  
  const catalog = buildActionCatalog(plannerContext);
  const runtimeContext = buildOperatorPlannerRuntimeContext(plannerContext, options);
  const groundingContext = await buildOperatorPlannerGroundingContext(inputText, options);
  const schemaPrompt = buildOperatorPlannerSchemaPrompt();

  const system = [
    "You are the operator brain inside ai-workflow.",
    "Behave like a strong operator that decides how to use tools, not like a chatty project summarizer.",
    "Choose the smallest truthful next step.",
    "",
    "## Operating Contract",
    "- Convert every user request into a typed intent envelope.",
    "- Use `kind=plan` for normal planning output.",
    "- Use `kind=reply` for simple conversational answers.",
    "",
    "## Available Actions (Your Capabilities):",
    catalog,
    "",
    "## Planning Rules",
    "- Use `await step(id, desc, fn)` for persistent operations.",
    "- Use `await transition(to, trigger, fn)` for state transitions.",
    "- Include comments and proper try/catch exception handling in the generated JS.",
    "- JSON only: your output must be valid JSON matching the schema.",
  ].join("\n");

  const promptSections = [
    "## Runtime Context",
    runtimeContext,
    groundingContext ? `\n## Grounded Repo Evidence\n${groundingContext}` : "",
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

async function buildOperatorPlannerGroundingContext(inputText, options = {}) {
  const sections = [];
  const root = options.root ?? process.cwd();
  
  // Heuristic grounding: if they ask about code, search for relevant symbols
  if (inputText.length > 10) {
    const payload = await resolveProjectStatus({
      projectRoot: root,
      selector: ".",
      includeRelated: true,
      rawQuestion: true,
      relatedLimit: 5
    }).catch(() => null);
    
    if (payload?.ok) {
      sections.push(`Current Project: ${payload.title}\n${payload.summary}`);
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
