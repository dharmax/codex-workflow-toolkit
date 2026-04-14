/**
 * Responsibility: Execute and manage lifecycle hooks for ai-workflow.
 * Scope: Handles shell command and JS-based hooks defined in the config.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export async function runHooks(hookType, { root = process.cwd(), config = {}, context = {} } = {}) {
  const hooks = config.hooks?.[hookType] ?? [];
  if (!Array.isArray(hooks) || hooks.length === 0) {
    return context;
  }

  let currentContext = { ...context };

  for (const hook of hooks) {
    if (typeof hook === "string") {
      // Shell command hook
      currentContext = await runShellHook(hook, { root, context: currentContext });
    } else if (typeof hook === "object" && hook.command) {
      // Structured shell hook
      currentContext = await runShellHook(hook.command, { root, context: currentContext });
    } else if (typeof hook === "object" && hook.js) {
      // JS hook (future proofing, if we want to run snippets)
      currentContext = await runJsHook(hook.js, { root, context: currentContext });
    }
  }

  return currentContext;
}

async function runShellHook(command, { root, context }) {
  try {
    const { stdout, stderr } = await execAsync(command, { 
      cwd: root,
      env: { 
        ...process.env, 
        AI_WORKFLOW_HOOK_CONTEXT: JSON.stringify(context) 
      } 
    });

    if (stderr && stderr.trim()) {
      console.warn(`[hook-stderr]: ${stderr.trim()}`);
    }

    // A hook can optionally return a JSON block to merge into the context
    try {
      const output = stdout.trim();
      if (output.startsWith("{") && output.endsWith("}")) {
        const result = JSON.parse(output);
        return { ...context, ...result };
      }
    } catch (e) {
      // Not JSON, just continue
    }

    return context;
  } catch (error) {
    console.error(`[hook-error] "${command}" failed:`, error.message);
    // Decide if hooks should be blocking. For now, non-blocking but log error.
    return context;
  }
}

async function runJsHook(js, { context }) {
  // Placeholder for safe VM execution if needed
  return context;
}
