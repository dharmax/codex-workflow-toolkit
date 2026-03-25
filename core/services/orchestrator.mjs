import { parsePatch, applyPatch } from "../lib/patch.mjs";
import { buildSurgicalContext, formatContextForPrompt } from "./context-packer.mjs";
import { readProjectFile, writeProjectFile } from "../lib/filesystem.mjs";
import { routeTask } from "./router.mjs";
import { generateCompletion } from "./providers.mjs";
import { withWorkflowStore } from "./sync.mjs";
import { buildTicketEntity } from "./projections.mjs";

export async function sweepBugs(options) {
  const root = options.root;
  const bugs = await withWorkflowStore(root, async (store) => {
    return store.listEntities({ entityType: "ticket" }).filter(t => t.lane === "Todo" && (t.title.toLowerCase().includes("bug") || t.id.startsWith("BUG")));
  });

  if (!bugs.length) return "No pending bugs found in Todo lane.\n";

  let report = `Sweeping ${bugs.length} bugs...\n\n`;

  for (const bug of bugs) {
    console.log(`[orchestrator] Attempting fix for ${bug.id}...`);
    const context = await buildSurgicalContext(root, { ticketId: bug.id });
    const model = (await routeTask({ root, taskClass: "debugging" })).recommended;
    if (!model) {
      report += `- ${bug.id}: Skipped (No debugging model available)\n`;
      continue;
    }

    const system = `You are a developer fixing a bug. Output ONLY SEARCH/REPLACE blocks.
Format each block exactly like this:
File: path/to/file.js
<<<< SEARCH
exact old code to replace
====
new code
>>>>
`;
    const prompt = `Context:\n${formatContextForPrompt(context)}\n\nFix this bug.`;
    
    const start = Date.now();
    let completion;
    let sweepSuccess = true;
    let errorMsg = null;

    try {
      completion = await generateCompletion({
        providerId: model.providerId,
        modelId: model.modelId,
        system,
        prompt,
        config: { host: model.host, apiKey: model.apiKey }
      });
    } catch (error) {
      sweepSuccess = false;
      errorMsg = error.message;
      throw error;
    } finally {
      const latencyMs = Date.now() - start;
      await withWorkflowStore(root, async (store) => {
        store.appendMetric({
          taskClass: "debugging",
          capability: "logic",
          providerId: model.providerId,
          modelId: model.modelId,
          latencyMs,
          success: sweepSuccess,
          errorMessage: errorMsg
        });
      }).catch(() => {});
    }

    const result = await verifyAndApplyPatch(root, bug, completion.response);
    report += `- ${bug.id}: ${result.success ? "Fixed" : `Failed (${result.error})`}\n`;
  }

  return report;
}

async function verifyAndApplyPatch(root, ticket, patchText) {
  const blocks = parsePatch(patchText);
  if (!blocks.length) return { success: false, error: "No patch blocks found" };

  // Group blocks by file
  const fileBlocks = new Map();
  for (const block of blocks) {
    if (!block.file) {
      return { success: false, error: "A patch block is missing the 'File: path' header" };
    }
    const list = fileBlocks.get(block.file) ?? [];
    list.push(block);
    fileBlocks.set(block.file, list);
  }

  for (const [filePath, fileSpecificBlocks] of fileBlocks.entries()) {
    try {
      const file = await readProjectFile(root, filePath);
      const patchResult = applyPatch(file.content, fileSpecificBlocks);

      if (!patchResult.allApplied) {
        return { success: false, error: `Patch failed to apply cleanly to ${filePath}` };
      }

      await writeProjectFile(root, filePath, patchResult.content);
    } catch (error) {
      return { success: false, error: `Failed to process ${filePath}: ${error.message}` };
    }
  }

  await withWorkflowStore(root, async (store) => {
    const updated = { ...ticket, lane: "Done" };
    store.upsertEntity(updated);
  });

  return { success: true };
}

export async function ideateFeature(intent, options) {
  const root = options.root;
  const rl = options.rl;

  const model = (await routeTask({ root, taskClass: "creative-thinking" })).recommended;
  if (!model) throw new Error("No model available for ideation.");

  let chatContext = `User Intent: ${intent}`;
  let result = null;

  while (!result) {
    const system = `
You are a Product Manager. Help the user scope their feature request into an Epic and Tickets.
If vague, ask 1-3 questions. If ready, return JSON:
{
  "status": "complete",
  "epic": { "id": "EPC-XXX", "title": "...", "summary": "..." },
  "tickets": [ { "id": "TKT-XXX", "title": "...", "summary": "...", "domain": "logic|visual|creative|data" } ]
}
Otherwise return JSON: { "status": "questioning", "reply": "..." }
`;

    const completion = await generateCompletion({
      providerId: model.providerId,
      modelId: model.modelId,
      system,
      prompt: chatContext,
      config: { host: model.host, apiKey: model.apiKey, format: "json" }
    });

    const parsed = JSON.parse(completion.response);
    if (parsed.status === "complete") {
      result = parsed;
    } else {
      if (!rl) throw new Error("Interaction required but no readline available.");
      const answer = await rl.question(`PM> ${parsed.reply}\nUser: `);
      chatContext += `\nPM: ${parsed.reply}\nUser: ${answer}`;
    }
  }

  await saveEpicsAndTickets(root, result);
  return `Feature scoped and added: ${result.epic.id} ${result.epic.title}\n`;
}

async function saveEpicsAndTickets(root, data) {
  await withWorkflowStore(root, async (store) => {
    store.upsertEntity({
      id: data.epic.id,
      entityType: "epic",
      title: data.epic.title,
      state: "open",
      confidence: 1,
      provenance: "ai-ideation",
      sourceKind: "manual",
      reviewState: "active",
      data: { summary: data.epic.summary }
    });

    for (const t of data.tickets) {
      const ticket = buildTicketEntity({
        id: t.id,
        title: t.title,
        lane: "Todo",
        epicId: data.epic.id,
        summary: t.summary
      });
      ticket.data.domain = t.domain;
      store.upsertEntity(ticket);
    }
  });
}

export async function decomposeTicket(ticket, { root = process.cwd() } = {}) {
  const context = `Ticket: ${ticket.id} ${ticket.title}\nSummary: ${ticket.data?.summary ?? "None"}`;
  let plan = await attemptDecomposition(context, { root, quality: "low" });

  if (plan.some(task => task.class === "requires-escalation")) {
    plan = await attemptDecomposition(context, { root, quality: "high" });
  }

  return plan;
}

async function attemptDecomposition(context, { root, quality }) {
  const model = (quality === "high") 
    ? (await routeTask({ root, taskClass: "architectural-design" })).recommended 
    : (await routeTask({ root, taskClass: "task-decomposition" })).recommended;

  if (!model) throw new Error("No model for decomposition.");

  const system = `You are a Tech Lead. Decompose the ticket into small sub-tasks. Return ONLY JSON array.`;
  const start = Date.now();
  let completion;
  let decompSuccess = true;
  let errorMsg = null;

  try {
    completion = await generateCompletion({
      providerId: model.providerId,
      modelId: model.modelId,
      system,
      prompt: context,
      config: { host: model.host, apiKey: model.apiKey, format: "json" }
    });
  } catch (error) {
    decompSuccess = false;
    errorMsg = error.message;
    throw error;
  } finally {
    const latencyMs = Date.now() - start;
    await withWorkflowStore(root, async (store) => {
      store.appendMetric({
        taskClass: quality === "high" ? "architectural-design" : "task-decomposition",
        capability: "strategy",
        providerId: model.providerId,
        modelId: model.modelId,
        latencyMs,
        success: decompSuccess,
        errorMessage: errorMsg
      });
    }).catch(() => {});
  }

  return JSON.parse(completion.response);
}
