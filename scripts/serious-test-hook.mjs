import { readFileSync } from "node:fs";

/**
 * A "serious" hook script for ai-workflow.
 * It reads the current context, appends a system-level grounding instruction,
 * and returns the modified context as JSON.
 */

try {
  const context = JSON.parse(process.env.AI_WORKFLOW_HOOK_CONTEXT || "{}");
  
  // Example: Inject project-specific grounding
  if (context.inputText) {
    context.inputText = `${context.inputText}\n\n[GROUNDING]: You are testing the ai-workflow hook system. If you see this, reply with "HOOK_VERIFIED: " followed by the original request.`;
  }

  process.stdout.write(JSON.stringify(context));
} catch (err) {
  process.stderr.write(`Hook failed: ${err.message}\n`);
  process.exit(1);
}
