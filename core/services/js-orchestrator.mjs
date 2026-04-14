/**
 * Responsibility: Provide a persistent, step-based execution environment for LLM-generated JavaScript.
 * Scope: Handles sandbox creation, execution logic, persistence, and recursive shell hooks.
 */

import vm from "node:vm";
import { stableId } from "../lib/hash.mjs";
import { runHooks } from "./hooks.mjs";
import { getGlobalConfigPath, getProjectConfigPath, readConfigSafe } from "../../cli/lib/config-store.mjs";

/**
 * Orchestrates JS-based workflows with persistence and recovery.
 * Instead of JSON actions, we execute an async JS function with injected services.
 */
export async function executeJsOrchestrator(code, { 
  workflowStore, 
  prompt, 
  runId,
  services = {},
  initialState = {},
  root = process.cwd()
} = {}) {
  const finalRunId = runId ?? stableId("run", prompt, Date.now());
  
  const [projectConfigState, globalConfigState] = await Promise.all([
    readConfigSafe(getProjectConfigPath(root)),
    readConfigSafe(getGlobalConfigPath())
  ]);
  const config = { 
    ...globalConfigState.config, 
    ...projectConfigState.config,
    hooks: {
      ...(globalConfigState.config?.hooks ?? {}),
      ...(projectConfigState.config?.hooks ?? {})
    }
  };

  const session = new WorkflowSession({ workflowStore, runId: finalRunId, services, config, root });

  const sandbox = {
    // Core Helpers
    step: session.step.bind(session),
    transition: session.transition.bind(session),
    issue: session.issue.bind(session),
    shell: session.shell.bind(session),
    exec: session.exec.bind(session),
    executeCodelet: session.executeCodelet.bind(session),
    
    // State Management
    getState: session.getState.bind(session),
    setState: session.setState.bind(session),
    
    // Services (Spread for direct access like sync.createTicket)
    ...services,
    
    // Legacy/Explicit Access
    services,
    db: workflowStore,
    
    // Environment
    console: {
      log: (...args) => console.log(`[Run:${finalRunId}]`, ...args),
      error: (...args) => console.error(`[Run:${finalRunId}]`, ...args),
    },
    process: {
      cwd: () => process.cwd(),
      env: { ...process.env }
    }
  };

  try {
    const trimmedCode = code.trim().replace(/^```javascript/, "").replace(/^```js/, "").replace(/^```/, "").replace(/```$/, "");
    
    // We create an async function that receives the sandbox keys as arguments.
    // This is the most robust way to handle any characters in the user's code.
    const argKeys = Object.keys(sandbox);
    const argValues = Object.values(sandbox);
    
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    
    let userFn;
    if (trimmedCode.startsWith("async") || trimmedCode.startsWith("function")) {
      // If it's a function string, we evaluate it in context to get the function object
      const context = vm.createContext(sandbox);
      userFn = vm.runInContext(`(${trimmedCode})`, context);
    } else {
      // If it's a block of code, we create an AsyncFunction from it
      userFn = new AsyncFunction(...argKeys, trimmedCode);
    }

    if (process.env.AI_WORKFLOW_DEBUG_JS) {
      console.log("[JS-Orchestrator] Executing generated code...");
    }

    // Call the function with sandbox values as arguments
    const result = await (trimmedCode.startsWith("async") || trimmedCode.startsWith("function") 
      ? userFn.call(sandbox) 
      : userFn(...argValues));

    workflowStore.upsertWorkflowRun({
      id: finalRunId,
      status: "completed",
      result_json: JSON.stringify({ finalState: session.getAllState(), result })
    });

    return { runId: finalRunId, ok: true, result };
  } catch (err) {
    const errorDetails = { error: err.message, stack: err.stack };
    session.issue("exception", "Sandbox crash", errorDetails);
    workflowStore.upsertWorkflowRun({
      id: finalRunId,
      status: "failed",
      result_json: JSON.stringify(errorDetails)
    });
    throw err;
  }
}

class WorkflowSession {
  constructor({ workflowStore, runId, services, config = {}, root = process.cwd() }) {
    this.workflowStore = workflowStore;
    this.runId = runId;
    this.services = services;
    this.config = config;
    this.root = root;
    this.completedSteps = new Set();
    
    // Load completed steps from DB to support recovery
    const steps = workflowStore.listWorkflowSteps(runId);
    for (const s of steps) {
      if (s.status === "completed") {
        this.completedSteps.add(s.stepId);
      }
    }
  }

  async step(id, description, fn) {
    if (this.completedSteps.has(id)) {
      console.log(`[Workflow] Resuming step: ${id}`);
      const steps = this.workflowStore.listWorkflowSteps(this.runId);
      return steps.find(s => s.stepId === id)?.result;
    }

    const now = new Date().toISOString();
    this.workflowStore.upsertWorkflowStep({
      runId: this.runId,
      stepId: id,
      description,
      status: "running",
      startedAt: now
    });

    try {
      const result = await fn();
      this.workflowStore.upsertWorkflowStep({
        runId: this.runId,
        stepId: id,
        status: "completed",
        result,
        completedAt: new Date().toISOString()
      });
      this.completedSteps.add(id);
      return result;
    } catch (err) {
      const errorDetails = { message: err.message, stack: err.stack };
      this.workflowStore.upsertWorkflowStep({
        runId: this.runId,
        stepId: id,
        status: "failed",
        error: errorDetails,
        completedAt: new Date().toISOString()
      });
      
      // Log to issues table for the refinement loop
      this.issue("step_failure", `Step failed: ${id} (${description})`, errorDetails);
      throw err;
    }
  }

  async transition(to, label, action, options = {}) {
    const from = this.getState("__current_state", "START");
    const stepId = `transition-${from}-to-${to}-${label.replace(/\s+/g, "-")}`;
    
    return this.step(stepId, `Transition: ${from} -> ${to} (${label})`, async () => {
      console.log(`[Workflow] Transitioning: ${from} -> ${to} [Trigger: ${label}]`);
      const result = await action();
      
      this.workflowStore.addWorkflowTransition({
        runId: this.runId,
        from,
        to,
        label,
        triggerType: options.triggerType ?? "success",
        payload: result
      });

      this.setState("__current_state", to);
      this.workflowStore.upsertWorkflowRun({
        id: this.runId,
        currentState: to
      });

      return result;
    });
  }

  issue(type, summary, details = {}) {
    this.workflowStore.upsertWorkflowIssue({
      id: stableId("issue", this.runId, type, summary, Date.now()),
      runId: this.runId,
      issueType: type,
      severity: details.severity ?? "medium",
      summary,
      details,
      status: "open"
    });
  }

  async shell(prompt) {
    if (!this.services.shell) {
      throw new Error("Shell service not injected into JS Orchestrator");
    }

    const preContext = await runHooks("BeforeAction", { 
      root: this.root, 
      config: this.config, 
      context: { actionType: "shell", prompt } 
    });

    const result = await this.services.shell.execute(preContext.prompt ?? prompt, { runId: this.runId });

    await runHooks("AfterAction", { 
      root: this.root, 
      config: this.config, 
      context: { actionType: "shell", prompt, result } 
    });

    return result;
  }

  async exec(command, args = []) {
    if (!this.services.sh) {
      throw new Error("Sh service not injected into JS Orchestrator");
    }

    const preContext = await runHooks("BeforeAction", { 
      root: this.root, 
      config: this.config, 
      context: { actionType: "exec", command, args } 
    });

    const result = await this.services.sh.execute(preContext.command ?? command, preContext.args ?? args);

    await runHooks("AfterAction", { 
      root: this.root, 
      config: this.config, 
      context: { actionType: "exec", command, args, result } 
    });

    return result;
  }

  async executeCodelet(id, args = {}) {
    if (!this.services.codelets) {
      throw new Error("Codelets service not injected into JS Orchestrator");
    }

    const preContext = await runHooks("BeforeAction", { 
      root: this.root, 
      config: this.config, 
      context: { actionType: "codelet", id, args } 
    });

    const result = await this.services.codelets.execute(preContext.id ?? id, preContext.args ?? args);

    await runHooks("AfterAction", { 
      root: this.root, 
      config: this.config, 
      context: { actionType: "codelet", id, args, result } 
    });

    return result;
  }

  setState(key, value) {
    this.workflowStore.setWorkflowState(this.runId, key, value);
  }

  getState(key, fallback = null) {
    return this.workflowStore.getWorkflowState(this.runId, key, fallback);
  }

  getAllState() {
    // This could be optimized to fetch all at once
    return {}; 
  }
}
