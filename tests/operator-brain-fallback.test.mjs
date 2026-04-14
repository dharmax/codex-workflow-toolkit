import test from "node:test";
import assert from "node:assert/strict";
import { planOperatorRequest } from "../core/services/operator-brain.mjs";

test("planOperatorRequest falls back to another candidate if the first one fails", async () => {
  const originalFetch = globalThis.fetch;
  
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
    const result = await planOperatorRequest("test prompt", { 
      root: process.cwd(),
      // Mocked routeTask is harder without mocking the module, 
      // but planOperatorRequest calls routeTask internally.
      // We can rely on providers.mjs discovering the mock state.
    });

    // If it worked, it should have tried Gemini (failed) and then something else.
    // Given my local env might have GOOGLE_API_KEY, it will try Gemini.
    
    assert.ok(result);
    assert.equal(result.kind, "plan");
    assert.equal(result.code, "console.log('fallback success')");
    assert.ok(callCount > 1, "Should have called fetch multiple times");

  } finally {
    globalThis.fetch = originalFetch;
  }
});
