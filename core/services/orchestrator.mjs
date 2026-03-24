import { routeTask } from "./router.mjs";
import { generateCompletion } from "./providers.mjs";

export async function decomposeTicket(ticket, { root = process.cwd() } = {}) {
  const context = `
Ticket ID: ${ticket.id}
Title: ${ticket.title}
Summary: ${ticket.data?.summary ?? "None"}
Lane: ${ticket.lane}
`;

  // Step 1: Attempt decomposition with a cheap model (Tech Lead Triage)
  let plan = await attemptDecomposition(context, { root, quality: "low" });

  // Step 2: Check for escalation
  if (plan.some(task => task.class === "requires-escalation")) {
    const reason = plan.find(task => task.class === "requires-escalation")?.reason ?? "Complex task structure.";
    console.log(`[orchestrator] Escalating decomposition for ${ticket.id}: ${reason}`);
    plan = await attemptDecomposition(context, { root, quality: "high", reason });
  }

  return plan;
}

async function attemptDecomposition(context, { root, quality, reason = "" }) {
  const route = await routeTask({ root, taskClass: "task-decomposition", allowWeak: quality === "low" });
  
  // Force high quality if requested
  const model = (quality === "high") 
    ? (await routeTask({ root, taskClass: "architectural-design" })).recommended 
    : route.recommended;

  if (!model) {
    throw new Error("No model available for task decomposition.");
  }

  const system = `
You are the Tech Lead orchestrator for ai-workflow.
Your job is to break down a development ticket into small, actionable, and highly specific sub-tasks.
Each task must be assigned a "class" and a "domain" from the following taxonomy:

## Taxonomy
1. Logic Domain (logic)
   - pure-function: Isolated logic/utilities.
   - refactoring: Structural changes without logic updates.
   - debugging: Fixing specific reported issues.
   - architectural-reasoning: System-wide flow or multi-module design.

2. Creative Domain (creative)
   - prose-composition: Documentation, READMEs, or copy.
   - ideation: Brainstorming or conceptual planning.
   - stylistic-polishing: Improving tone or readability.

3. Visual Domain (visual)
   - ui-layout: Riot.js component structure/CSS.
   - graphic-scaffolding: SVG/Icons/CSS Art.
   - design-tokens: Theme/Color/Font management.

4. Data Domain (data)
   - extraction: Pulling facts from text.
   - note-normalization: Cleaning up messy thought-notes.

## Critical Instruction: ESCALATION
If the ticket is too complex for you to break down with high confidence, 
return a single task with class "requires-escalation" and a clear reason.

Return ONLY a JSON array of tasks.
Example: [{"class": "ui-layout", "domain": "visual", "file": "src/btn.riot", "summary": "center the icon"}, {"class": "pure-function", "domain": "logic", "file": "src/math.js", "summary": "add fibonacci"}]
`;

  const prompt = `
${reason ? `Escalation Reason: ${reason}\n` : ""}
Decompose the following ticket context:
${context}
`;

  const completion = await generateCompletion({
    providerId: model.providerId,
    modelId: model.modelId,
    system,
    prompt,
    config: { host: model.host, apiKey: model.apiKey, format: "json" }
  });

  try {
    const parsed = JSON.parse(completion.response);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (error) {
    console.error("[orchestrator] Failed to parse decomposition plan:", completion.response);
    throw new Error("Invalid decomposition plan returned by model.");
  }
}
