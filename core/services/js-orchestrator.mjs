/**
 * Responsibility: Provide a persistent, step-based execution environment for LLM-generated JavaScript.
 * Scope: Handles sandbox creation, execution logic, persistence, and recursive shell hooks.
 */

import vm from "node:vm";
import { stableId } from "../lib/hash.mjs";

/**
 * Orchestrates JS-based workflows with persistence and recovery.
 * Instead of JSON actions, we execute an async JS function with injected services.
 */
export async function executeJsOrchestrator(code, { 
  workflowStore, 
  prompt, 
  runId,
  services = {},
  initialState = {} 
} = {}) {
  const finalRunId = runId ?? stableId("run", prompt, Date.now());
  
  // 1. Initialize Run in DB
  workflowStore.upsertWorkflowRun({
    id: finalRunId,
    prompt,
    code,
    status: "running",
    result: null
  });

  const session = new WorkflowSession({ workflowStore, runId: finalRunId, services });

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
    
    // Services (Direct Access)
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

  // Wrap the code to support clean async execution and error handling
  const wrappedCode = `
    (async () => {
      try {
        ${code}
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message, stack: err.stack };
      }
    })()
  `;

  try {
    const script = new vm.Script(wrappedCode);
    const context = vm.createContext(sandbox);
    const runResult = await script.runInContext(context);

    if (runResult.ok) {
      workflowStore.upsertWorkflowRun({
        id: finalRunId,
        prompt,
        code,
        status: "completed",
        result: { finalState: session.getAllState() }
      });
    } else {
      // Log as a workflow issue
      session.issue("exception", "Workflow execution failed", runResult);
      workflowStore.upsertWorkflowRun({
        id: finalRunId,
        prompt,
        code,
        status: "failed",
        result: runResult
      });
    }

    return { runId: finalRunId, ...runResult };
  } catch (err) {
    const errorDetails = { error: err.message, stack: err.stack };
    session.issue("exception", "Sandbox crash", errorDetails);
    workflowStore.upsertWorkflowRun({
      id: finalRunId,
      prompt,
      code,
      status: "failed",
      result: errorDetails
    });
    throw err;
  }
}

class WorkflowSession {
  constructor({ workflowStore, runId, services }) {
    this.workflowStore = workflowStore;
    this.runId = runId;
    this.services = services;
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
    // Recursive shell call
    return this.services.shell.execute(prompt, { runId: this.runId });
  }

  async exec(command, args = []) {
    if (!this.services.sh) {
      throw new Error("Sh service not injected into JS Orchestrator");
    }
    // Direct shell command execution
    return this.services.sh.execute(command, args);
  }

  async executeCodelet(id, args = {}) {
    if (!this.services.codelets) {
      throw new Error("Codelets service not injected into JS Orchestrator");
    }
    // Direct in-memory codelet execution
    return this.services.codelets.execute(id, args);
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
