import { readFile } from "node:fs/promises";
import { parsePatch, applyPatch } from "../lib/patch.mjs";
import { buildSurgicalContext, formatContextForPrompt } from "./context-packer.mjs";
import { readProjectFile, writeProjectFile } from "../lib/filesystem.mjs";
import { routeTask } from "./router.mjs";
import { generateCompletion } from "./providers.mjs";
import { withWorkflowStore } from "./sync.mjs";
import { buildTicketEntity } from "./projections.mjs";
import { withSupergitTransaction } from "./supergit.mjs";

export async function sweepBugs(options) {
  const root = options.root;
  const bugs = await withWorkflowStore(root, async (store) => {
    return store.listEntities({ entityType: "ticket" }).filter(t => t.lane === "Todo" && (t.title.toLowerCase().includes("bug") || t.id.startsWith("BUG")));
  });

  if (!bugs.length) return "No pending bugs found in Todo lane.\n";

  let report = `Sweeping ${bugs.length} bugs...\n\n`;

  for (const bug of bugs) {
    console.log(`[orchestrator] Attempting fix for ${bug.id}...`);
    
    const result = await withSupergitTransaction(root, bug.id, async () => {
      const context = await buildSurgicalContext(root, { ticketId: bug.id });
      const model = (await routeTask({ root, taskClass: "debugging" })).recommended;
      if (!model) {
        return { success: false, error: "No debugging model available" };
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
      let prompt = `Context:\n${formatContextForPrompt(context)}\n\nFix this bug.`;
      
      let patchSuccess = false;
      let lastError = null;
      const MAX_RETRIES = 2; 

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const start = Date.now();
        let completion;
        let requestSuccess = true;
        let reqError = null;

        try {
          completion = await generateCompletion({
            providerId: model.providerId,
            modelId: model.modelId,
            system,
            prompt,
            config: { host: model.host, apiKey: model.apiKey }
          });
        } catch (error) {
          requestSuccess = false;
          reqError = error.message;
          lastError = reqError;
          break; // Stop retries on network/auth errors
        } finally {
          const latencyMs = Date.now() - start;
          await withWorkflowStore(root, async (store) => {
            store.appendMetric({
              taskClass: "debugging",
              capability: "logic",
              providerId: model.providerId,
              modelId: model.modelId,
              latencyMs,
              success: requestSuccess,
              errorMessage: reqError
            });
          }).catch(() => {});
        }

        if (!requestSuccess) break;

        const applyResult = await verifyAndApplyPatch(root, completion.response);
        if (applyResult.success) {
          patchSuccess = true;
          break;
        }

        console.log(`[orchestrator] Patch failed on attempt ${attempt + 1}: ${applyResult.error}. Retrying...`);
        lastError = applyResult.error;
        prompt += `\n\nYour previous patch failed with the following error:\n${applyResult.error}\nPlease provide a corrected SEARCH/REPLACE block. Ensure the SEARCH block exactly matches the current file content.`;
      }

      if (patchSuccess) {
        // Phase 4: Placeholder for "npm test" check
        // if (!runTests(root)) return { success: false, error: "Tests failed" };
        
        await withWorkflowStore(root, async (store) => {
          const updated = { ...bug, lane: "Done" };
          store.upsertEntity(updated);
        });
        return { success: true };
      } else {
        await withWorkflowStore(root, async (store) => {
          const updated = { ...bug, lane: "Blocked" };
          store.upsertEntity(updated);
        });
        return { success: false, error: lastError ?? "Patch application failed" };
      }
    });

    report += `- ${bug.id}: ${result?.success ? "Fixed" : `Failed (${result?.error}) -> Moved to Blocked`}\n`;
  }

  return report;
}

async function verifyAndApplyPatch(root, patchText) {
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
        const failedBlock = patchResult.summary.find(s => !s.ok);
        return { success: false, error: `Patch failed to apply cleanly to ${filePath}: ${failedBlock?.error}` };
      }

      await writeProjectFile(root, filePath, patchResult.content);
    } catch (error) {
      return { success: false, error: `Failed to process ${filePath}: ${error.message}` };
    }
  }

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

export async function ingestArtifact(filePath, options) {
  const root = options.root;
  const rl = options.rl;

  const content = await readFile(filePath, "utf8");
  const model = (await routeTask({ root, taskClass: "architectural-design" })).recommended;
  if (!model) throw new Error("No model available for artifact ingestion.");

  let chatContext = `Artifact Content from ${filePath}:\n\n${content.substring(0, 10000)}...\n\n`;
  let outlineResult = null;

  console.log(`[orchestrator] Assessing artifact ${filePath}...`);

  while (!outlineResult) {
    const system = `
You are an Architect for ai-workflow. Read the provided artifact (e.g., PRD).
Create a high-level outline of the Epic and Tickets needed to build it.
Do NOT generate final DB entities yet. Focus on human approval first.

If the artifact is clear enough to outline, return JSON:
{
  "status": "complete",
  "outline": "A markdown string showing your proposed Epic -> Tickets breakdown."
}
If vague, ask clarifying questions. Return JSON:
{ "status": "questioning", "reply": "your questions here" }
`;

    const start = Date.now();
    let completion;
    let success = true;
    try {
      completion = await generateCompletion({
        providerId: model.providerId,
        modelId: model.modelId,
        system,
        prompt: chatContext,
        config: { host: model.host, apiKey: model.apiKey, format: "json" }
      });
    } catch (e) {
      success = false;
      throw e;
    } finally {
      await withWorkflowStore(root, async (store) => {
        store.appendMetric({
          taskClass: "architectural-design",
          capability: "strategy",
          providerId: model.providerId,
          modelId: model.modelId,
          latencyMs: Date.now() - start,
          success,
          errorMessage: success ? null : "Failed"
        });
      }).catch(() => {});
    }

    const parsed = JSON.parse(completion.response);
    if (parsed.status === "complete") {
      outlineResult = parsed.outline;
    } else {
      if (!rl) throw new Error("Interaction required but no readline available.");
      const answer = await rl.question(`Architect> ${parsed.reply}\nUser: `);
      chatContext += `\nArchitect: ${parsed.reply}\nUser: ${answer}`;
    }
  }

  if (!rl) throw new Error("Human approval required for outline, but no TTY.");
  console.log(`\nProposed Outline:\n${outlineResult}\n`);
  const approval = (await rl.question("Approve outline and generate tickets? [y/N/edit] ")).trim().toLowerCase();
  
  let finalContext = `Outline:\n${outlineResult}\n`;
  
  if (approval === "edit") {
    const feedback = await rl.question("Provide feedback/edits: ");
    finalContext += `User Feedback: ${feedback}\n`;
  } else if (approval !== "y" && approval !== "yes") {
    throw new Error("Ingestion cancelled by user.");
  }

  console.log(`[orchestrator] Generating Kanban entities...`);
  const genSystem = `
You are a PM. Convert the approved outline into strict JSON Epic and Tickets.
{
  "epic": { "id": "EPC-XXX", "title": "...", "summary": "..." },
  "tickets": [ { "id": "TKT-XXX", "title": "...", "summary": "...", "domain": "logic|visual|creative|data" } ]
}
`;
  const genCompletion = await generateCompletion({
    providerId: model.providerId,
    modelId: model.modelId,
    system: genSystem,
    prompt: finalContext,
    config: { host: model.host, apiKey: model.apiKey, format: "json" }
  });

  const finalData = JSON.parse(genCompletion.response);
  await saveEpicsAndTickets(root, finalData);
  return finalData;
}
