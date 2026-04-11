import { generateCompletion } from "../services/providers.mjs";

/**
 * Self-Correction and Proactive Clarification logic.
 */

export async function attemptActionCorrection({ failedAction, error, options, history }) {
  const system = [
    "You are the self-correction module for 'ai-workflow'.",
    "An action failed with an error. You must analyze the error and propose a corrected action or a diagnostic step.",
    "",
    `FAILED ACTION: ${JSON.stringify(failedAction)}`,
    `ERROR: ${error.message}`
  ].join("\n");

  const prompt = "Propose a fix. If the ID was wrong, try to search for the correct one. Output ONLY JSON.";

  try {
    const trace = typeof options?.traceAi === "function" ? options.traceAi : null;
    trace?.({
      phase: "request",
      stage: "correction",
      planner: options.planner,
      system,
      prompt
    });
    const start = Date.now();
    const completion = await generateCompletion({
      providerId: options.planner.providerId,
      modelId: options.planner.modelId,
      system,
      prompt,
      config: { apiKey: options.planner.apiKey, host: options.planner.host, format: "json" }
    });
    trace?.({
      phase: "response",
      stage: "correction",
      planner: options.planner,
      response: completion.response,
      elapsedMs: Date.now() - start
    });
    const parsed = JSON.parse(completion.response);
    if (parsed?.action && typeof parsed.action === "object") {
      return parsed.action;
    }
    if (parsed?.type && typeof parsed === "object") {
      return parsed;
    }
    return null;
  } catch (error) {
    if (typeof options?.traceAi === "function") {
      options.traceAi({
        phase: "error",
        stage: "correction",
        planner: options.planner,
        error: error?.message ?? String(error)
      });
    }
    return null;
  }
}

export function handleAmbiguousId(id, entities) {
  const matches = entities.filter(e => e.id.includes(id.toUpperCase()));
  if (matches.length > 1) {
    return {
      ambiguous: true,
      options: matches.map(m => m.id),
      message: `I found multiple matches for '${id}': ${matches.map(m => m.id).join(", ")}. Which one did you mean?`
    };
  }
  return { ambiguous: false, match: matches[0] || null };
}
