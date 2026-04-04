import path from "node:path";
import { readFile } from "node:fs/promises";
import { parsePatch, applyPatch } from "../lib/patch.mjs";
import { buildSurgicalContext, formatContextForPrompt } from "./context-packer.mjs";
import { readProjectFile, writeProjectFile } from "../lib/filesystem.mjs";
import { routeTask } from "./router.mjs";
import { generateCompletion } from "./providers.mjs";
import { withWorkflowStore } from "./sync.mjs";
import { buildTicketEntity, writeProjectProjections } from "./projections.mjs";
import { withSupergitTransaction } from "./supergit.mjs";
import { buildTicketExecutionPlan, runVerificationPlan } from "./execution-planner.mjs";

export async function sweepBugs(options) {
  const root = options.root;
  const baselineVerificationCache = new Map();
  const bugs = await withWorkflowStore(root, async (store) => {
    return store.listEntities({ entityType: "ticket" }).filter(t => t.lane === "Todo" && (t.title.toLowerCase().includes("bug") || t.id.startsWith("BUG")));
  });

  if (!bugs.length) return "No pending bugs found in Todo lane.\n";

  let report = `Sweeping ${bugs.length} bugs...\n\n`;

  for (const bug of bugs) {
    console.log(`[orchestrator] Attempting fix for ${bug.id}...`);
    const result = await executeTicket({
      root,
      ticketId: bug.id,
      apply: true,
      verificationTimeoutMs: options.verificationTimeoutMs,
      baselineVerificationCache
    });

    const verificationSummary = formatVerificationSummary(result?.verification);
    report += `- ${bug.id}: ${result?.success ? `Fixed${verificationSummary}` : `Failed (${result?.error}) -> Moved to Blocked`}\n`;
  }

  return report;
}

export async function executeTicket(options) {
  const root = options.root;
  const ticketId = options.ticketId;
  const apply = Boolean(options.apply);
  const verificationTimeoutMs = options.verificationTimeoutMs;
  const baselineVerificationCache = options.baselineVerificationCache ?? new Map();
  const ticket = await withWorkflowStore(root, async (store) => store.getEntity(ticketId));

  if (!ticket || ticket.entityType !== "ticket") {
    return {
      success: false,
      error: `Ticket not found: ${ticketId}`,
      status: "missing-ticket"
    };
  }

  const context = await buildSurgicalContext(root, { ticketId: ticket.id });
  const executionPlan = await buildTicketExecutionPlan({
    root,
    entity: ticket,
    workingSet: context.files.map((file) => file.path).filter(Boolean),
    relevantSymbols: context.symbols.map((symbol) => symbol.name).filter(Boolean)
  });

  if (!executionPlan.ready) {
    if (apply) {
      await updateTicketState(root, ticket, "Blocked", {
        executionPlan,
        executionResult: {
          status: "blocked",
          reason: executionPlan.concerns.join("; ")
        }
      });
    }
    return {
      success: false,
      status: "blocked",
      error: `Unsafe to execute: ${executionPlan.concerns.join("; ")}`,
      executionPlan
    };
  }

  if (apply) {
    await updateTicketState(root, ticket, "In Progress", {
      executionPlan,
      executionResult: {
        status: "running"
      }
    });
  }

  const baselineVerification = await getBaselineVerification(root, executionPlan, baselineVerificationCache, verificationTimeoutMs);
  if (!baselineVerification.ok) {
    if (apply) {
      await updateTicketState(root, ticket, "Blocked", {
        executionPlan,
        executionResult: {
          status: "baseline-red",
          verification: baselineVerification
        }
      });
    }
    const failure = baselineVerification.results.find((item) => item.exitCode !== 0);
    return {
      success: false,
      status: "baseline-red",
      error: `Verification baseline red: ${failure?.command ?? "unknown command"}`,
      executionPlan,
      verification: baselineVerification
    };
  }

  if (!apply) {
    return {
      success: true,
      status: "planned",
      executionPlan,
      verification: baselineVerification
    };
  }

  return withSupergitTransaction(root, ticket.id, async () => {
    const model = (await routeTask({ root, taskClass: "debugging" })).recommended;
    if (!model) {
      await updateTicketState(root, ticket, "Blocked", {
        executionPlan,
        executionResult: {
          status: "blocked",
          reason: "No debugging model available"
        }
      });
      return { success: false, status: "blocked", error: "No debugging model available", executionPlan };
    }

    const system = `You are a developer fixing a bug. Output ONLY SEARCH/REPLACE blocks.
Format each block exactly like this:
File: path/to/file.js
<<<< SEARCH
exact old code to replace
====
new code
>>>>

Only edit files that are already in the provided working set.

## Architectural Refinement (Optional)
If you gain insights about the architectural mapping, you may ALSO output a JSON block like this:
{ "action": "refine_map", "file": "path/to/file.js", "module": "module-name", "features": ["feature-a", "feature-b"] }
`;
    let prompt = `Context:\n${formatContextForPrompt(context)}\n\nAllowed files:\n${executionPlan.workingSet.join("\n")}\n\nFix this bug.`;
    let patchSuccess = false;
    let lastError = null;
    let patchResult = null;
    const MAX_RETRIES = 2;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
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
        break;
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

      patchResult = await verifyAndApplyPatch(root, completion.response, {
        allowedFiles: executionPlan.workingSet
      });
      if (patchResult.success) {
        await processRefinements(root, completion.response);
        patchSuccess = true;
        break;
      }

      lastError = patchResult.error;
      prompt += `\n\nYour previous patch failed with the following error:\n${patchResult.error}\nPlease provide a corrected SEARCH/REPLACE block. Ensure the SEARCH block exactly matches the current file content and do not edit files outside the allowed set.`;
    }

    if (!patchSuccess) {
      await updateTicketState(root, ticket, "Blocked", {
        executionPlan,
        executionResult: {
          status: "patch-failed",
          reason: lastError ?? "Patch application failed"
        }
      });
      return { success: false, status: "patch-failed", error: lastError ?? "Patch application failed", executionPlan };
    }

    const verification = await runVerificationPlan(root, executionPlan, { timeoutMs: verificationTimeoutMs });
    if (!verification.ok) {
      await updateTicketState(root, ticket, "Blocked", {
        executionPlan,
        executionResult: {
          status: "verification-failed",
          verification
        }
      });
      const failure = verification.results.find((item) => item.exitCode !== 0);
      return {
        success: false,
        status: "verification-failed",
        error: `Verification failed: ${failure?.command ?? "unknown command"}`,
        executionPlan,
        verification
      };
    }

    await updateTicketState(root, ticket, "Done", {
      executionPlan,
      executionResult: {
        status: "verified",
        verification,
        changedFiles: patchResult?.changedFiles ?? []
      }
    });
    return {
      success: true,
      status: "verified",
      executionPlan,
      verification,
      changedFiles: patchResult?.changedFiles ?? []
    };
  });
}

async function updateTicketState(root, bug, lane, payload = {}) {
  await withWorkflowStore(root, async (store) => {
    const updated = {
      ...bug,
      lane,
      data: {
        ...(bug.data ?? {}),
        ...payload
      }
    };
    store.upsertEntity(updated);
    await writeProjectProjections(store, { projectRoot: root });
  });
}

function formatVerificationSummary(verification) {
  if (!verification?.results?.length) return "";
  const passed = verification.results.filter((item) => item.exitCode === 0).length;
  return ` [verified ${passed}/${verification.results.length}]`;
}

async function getBaselineVerification(root, executionPlan, cache, timeoutMs) {
  const cacheKey = executionPlan.verificationCommands.map((item) => item.command).join(" || ");
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const verification = await runVerificationPlan(root, executionPlan, { timeoutMs });
  cache.set(cacheKey, verification);
  return verification;
}

async function verifyAndApplyPatch(root, patchText, options = {}) {
  const blocks = parsePatch(patchText);
  if (!blocks.length) return { success: false, error: "No patch blocks found" };
  const allowedFiles = new Set((options.allowedFiles ?? []).map((filePath) => String(filePath)));

  // Group blocks by file
  const fileBlocks = new Map();
  for (const block of blocks) {
    if (!block.file) {
      return { success: false, error: "A patch block is missing the 'File: path' header" };
    }
    if (allowedFiles.size && !allowedFiles.has(block.file)) {
      return { success: false, error: `Patch attempted to edit file outside working set: ${block.file}` };
    }
    const list = fileBlocks.get(block.file) ?? [];
    list.push(block);
    fileBlocks.set(block.file, list);
  }

  const changedFiles = [];
  for (const [filePath, fileSpecificBlocks] of fileBlocks.entries()) {
    try {
      const file = await readProjectFile(root, filePath);
      const patchResult = applyPatch(file.content, fileSpecificBlocks);

      if (!patchResult.allApplied) {
        const failedBlock = patchResult.summary.find(s => !s.ok);
        return { success: false, error: `Patch failed to apply cleanly to ${filePath}: ${failedBlock?.error}` };
      }

      await writeProjectFile(root, filePath, patchResult.content);
      changedFiles.push(filePath);
    } catch (error) {
      return { success: false, error: `Failed to process ${filePath}: ${error.message}` };
    }
  }

  return { success: true, changedFiles };
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
  "epic": {
    "id": "EPC-XXX",
    "title": "...",
    "summary": "...",
    "userStories": ["As a ...", "As a ..."],
    "ticketBatches": ["Batch 1", "Batch 2"]
  },
  "tickets": [ { "id": "TKT-XXX", "title": "...", "summary": "...", "domain": "logic|visual|creative|data", "story": "As a ..." } ]
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
      data: {
        summary: data.epic.summary,
        userStories: Array.isArray(data.epic.userStories) ? data.epic.userStories : [],
        ticketBatches: Array.isArray(data.epic.ticketBatches) ? data.epic.ticketBatches : []
      }
    });

    for (const t of data.tickets) {
      const ticket = buildTicketEntity({
        id: t.id,
        title: t.title,
        lane: "Todo",
        epicId: data.epic.id,
        summary: t.summary,
        userStory: t.story ?? null
      });
      ticket.data.domain = t.domain;
      store.upsertEntity(ticket);
    }

    await writeProjectProjections(store, { projectRoot: root });
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

export async function onboardProjectBrief(filePath, options) {
  const root = options.root;
  const rl = options.rl;
  const workingBriefPath = path.resolve(root, options.briefPath ?? "project-brief.md");
  const workingBriefLabel = path.relative(root, workingBriefPath) || path.basename(workingBriefPath);
  const sourceContent = await readFile(filePath, "utf8");
  const sourceExcerpt = sourceContent.slice(0, 12000);
  const existingBrief = await readFile(workingBriefPath, "utf8").catch(() => "");
  const model = (await routeTask({ root, taskClass: "architectural-design" })).recommended;

  if (!model) throw new Error("No model available for artifact ingestion.");

  let briefDraft = normalizeBriefDraft(existingBrief || "# Project Brief\n");
  let chatContext = [
    `Raw project description from ${filePath}:`,
    "",
    sourceExcerpt,
    "",
    existingBrief.trim() ? `Existing working brief from ${workingBriefLabel}:` : null,
    existingBrief.trim() || null
  ].filter(Boolean).join("\n");

  console.log(`[orchestrator] Onboarding project brief ${filePath}...`);

  while (true) {
    const system = `
You are an onboarding architect for ai-workflow.
Turn the messy project description into a living project brief that the user can edit.
The brief should be clear enough to decide whether the project has an MVP-ready scope.

Return JSON in one of these forms:
{
  "status": "questioning",
  "briefMarkdown": "# Project Brief\\n...",
  "questions": ["...", "..."],
  "mvpReady": false,
  "reason": "What is still unclear."
}
or
{
  "status": "complete",
  "briefMarkdown": "# Project Brief\\n...",
  "mvpReady": true,
  "reason": "Why the brief is ready for epic generation."
}

Rules:
- Preserve the user's intent and uncertainty.
- Always keep the output in markdown with headings.
- Include sections for Overview, Problem, Users, Goals, Non-Goals, Constraints, MVP Gate, and Open Questions.
- Ask 1-3 concise questions when gaps remain.
- The brief is the editable working artifact; do not generate epics yet.
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
    } catch (error) {
      success = false;
      throw error;
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
    if (parsed.briefMarkdown) {
      briefDraft = normalizeBriefDraft(parsed.briefMarkdown);
      await writeProjectFile(root, workingBriefLabel, briefDraft);
    }

    if (parsed.status === "questioning") {
      if (!rl) throw new Error("Interaction required but no readline available.");
      const questions = normalizeBriefQuestions(parsed.questions, parsed.reason);
      const answers = [];
      for (const question of questions) {
        const answer = await rl.question(`Brief> ${question}\nUser: `);
        answers.push({ question, answer });
      }
      chatContext += `\n\nQuestions and answers:\n${answers.map((item) => `Q: ${item.question}\nA: ${item.answer}`).join("\n\n")}`;
      continue;
    }

    if (!rl) throw new Error("Human approval required for brief onboarding, but no TTY.");
    console.log(`\nNormalized Project Brief written to ${workingBriefLabel}\n`);
    const approval = (await rl.question("Approve this brief and generate epics? [y/N/edit] ")).trim().toLowerCase();

    if (approval === "edit") {
      console.log(`Edit ${workingBriefLabel}, then press Enter to continue.`);
      await rl.question("Press Enter after edits: ");
      briefDraft = normalizeBriefDraft(await readFile(workingBriefPath, "utf8").catch(() => briefDraft));
      chatContext += `\n\nUser-edited project brief:\n${briefDraft}`;
      continue;
    }

    if (approval !== "y" && approval !== "yes") {
      throw new Error("Brief onboarding cancelled by user.");
    }
    break;
  }

  const generationContext = [
    "Approved project brief:",
    "",
    briefDraft,
    "",
    `Source description file: ${filePath}`
  ].join("\n");

  console.log(`[orchestrator] Generating Kanban entities...`);
  const genSystem = `
You are a PM. Convert the approved project brief into strict JSON Epic and Tickets.
{
  "epic": { "id": "EPC-XXX", "title": "...", "summary": "...", "userStories": ["As a ..."], "ticketBatches": ["Batch 1"] },
  "tickets": [ { "id": "TKT-XXX", "title": "...", "summary": "...", "domain": "logic|visual|creative|data", "story": "As a ..." } ]
}
`;
  const genCompletion = await generateCompletion({
    providerId: model.providerId,
    modelId: model.modelId,
    system: genSystem,
    prompt: generationContext,
    config: { host: model.host, apiKey: model.apiKey, format: "json" }
  });

  const finalData = JSON.parse(genCompletion.response);
  await saveEpicsAndTickets(root, finalData);
  return {
    ...finalData,
    briefPath: workingBriefPath,
    briefDraft
  };
}

export async function ingestArtifact(filePath, options) {
  return onboardProjectBrief(filePath, options);
}

async function processRefinements(root, text) {
  const regex = /\{ "action": "refine_map"[\s\S]*?\}/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      const refinement = JSON.parse(match[0]);
      await withWorkflowStore(root, async (store) => {
        if (refinement.module && refinement.file) {
          const moduleId = `MOD-${refinement.module.toUpperCase().replace(/\//g, "-")}`;
          store.upsertModule({ id: moduleId, name: refinement.module });
          store.db.prepare("DELETE FROM architectural_graph WHERE subject_id = ? AND predicate = 'belongs_to'").run(refinement.file);
          store.appendArchitecturalPredicate({
            subjectId: refinement.file,
            predicate: "belongs_to",
            objectId: moduleId
          });
        }
        if (Array.isArray(refinement.features) && refinement.file) {
          for (const featureName of refinement.features) {
            const featureId = `FEAT-${featureName.toUpperCase().replace(/\s+/g, "-")}`;
            store.upsertFeature({ id: featureId, name: featureName });
            store.appendArchitecturalPredicate({
              subjectId: refinement.file,
              predicate: "implements",
              objectId: featureId
            });
          }
        }
      });
    } catch (e) {
      console.warn("[orchestrator] Failed to parse refinement JSON:", e.message);
    }
  }
}

function normalizeBriefDraft(text) {
  return `${String(text ?? "").trimEnd()}\n`;
}

function normalizeBriefQuestions(questions, fallbackReason) {
  const normalizedQuestions = Array.isArray(questions)
    ? questions.map((question) => String(question ?? "").trim()).filter(Boolean)
    : [];

  if (normalizedQuestions.length) {
    return normalizedQuestions.slice(0, 3);
  }

  const fallback = String(fallbackReason ?? "").trim();
  return fallback ? [fallback] : ["What is still unclear about the project brief?"];
}
