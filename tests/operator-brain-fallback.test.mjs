import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { openWorkflowStore } from "../core/db/sqlite-store.mjs";
import { planOperatorRequest } from "../core/services/operator-brain.mjs";

test("planOperatorRequest falls back to another candidate if the first one fails", async () => {
  const originalFetch = globalThis.fetch;
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "operator-brain-fallback-"));
  
  // Mock fetch to fail for the first (Gemini) request and succeed for the second (Ollama-like)
  let callCount = 0;
  globalThis.fetch = async (url) => {
    callCount++;
    const urlStr = String(url);
    if (urlStr.includes("generativelanguage.googleapis.com")) {
      return {
        ok: false,
        status: 403,
        async text() {
          return JSON.stringify({
            error: {
              reason: "API_KEY_SERVICE_BLOCKED",
              message: "Requests to this API are blocked."
            }
          });
        }
      };
    }
    
    // Assume other calls (like Ollama or OpenAI) succeed
    return {
      ok: true,
      async json() {
        if (urlStr.includes("/api/generate") || urlStr.includes("/chat/completions")) {
          const response = JSON.stringify({ kind: "plan", code: "console.log('fallback success')" });
          if (urlStr.includes("openai.com")) {
            return { choices: [{ message: { content: response } }] };
          }
          return { response };
        }
        return { models: [{ name: "fallback-model", size: 1000 }] };
      }
    };
  };

  try {
    await mkdir(path.join(targetRoot, ".ai-workflow"), { recursive: true });
    await writeFile(
      path.join(targetRoot, ".ai-workflow", "config.json"),
      JSON.stringify({
        providers: {
          google: { apiKey: "g-key" },
          openai: { apiKey: "o-key" },
          ollama: { enabled: false }
        }
      }, null, 2),
      "utf8"
    );

    const result = await planOperatorRequest("test prompt", { root: targetRoot });

    assert.ok(result);
    assert.equal(result.kind, "plan");
    assert.equal(result.code, "console.log('fallback success')");
    assert.ok(callCount > 1, "Should have called fetch multiple times");

    const store = await openWorkflowStore({ projectRoot: targetRoot });
    const metrics = store.getMetricsSummary();
    store.close();

    assert.equal(metrics.totalCalls, 1);
    assert.equal(metrics.windows.latestSession.diagnostics.fallbackRuns, 1);
    assert.equal(metrics.windows.latestSession.diagnostics.fallbackRecoveries, 1);
    assert.equal(metrics.windows.latestSession.diagnostics.failedAttempts, 2);
    assert.equal(metrics.windows.latestSession.diagnostics.byStage[0].stage, "operator-planning");
    assert.match(metrics.windows.latestSession.diagnostics.topFailures[0].label, /google:gemini-2.0-(pro-exp|flash)/i);

  } finally {
    globalThis.fetch = originalFetch;
    await rm(targetRoot, { recursive: true, force: true });
  }
});
