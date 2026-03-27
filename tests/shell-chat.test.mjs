import test from "node:test";
import assert from "node:assert/strict";
import { planShellRequestWithAgent } from "../cli/lib/shell.mjs";

test("Agentic planner correctly uses DB definitions, active tickets, and history", async () => {
  let lastPrompt = "";
  let lastSystem = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(init.body);
    lastPrompt = payload.prompt;
    lastSystem = payload.system;

        let replyText = "Generic reply.";
        if (payload.system.includes("## Available Actions")) {
          replyText = "Actions are available.";
        }
        if (payload.prompt.includes("You have TKT-001")) {
          replyText += " You mentioned TKT-001.";
        }

    return {
      ok: true,
      async json() {
        return { response: `{"kind": "reply", "reply": "${replyText}"}` };
      }
    };
  };

  const options = {
    plannerContext: { 
      toolkitCodelets: [],
      projectCodelets: [],
      summary: {
        activeTickets: [] // Empty to test the "No active tickets" fallback
      } 
    },
    planner: { providerId: "ollama", modelId: "mock-model", host: "http://mock-ollama.local" },
    history: [
      { role: "user", content: "what are the next tickets?" },
      { role: "ai", content: "You have TKT-001 in Todo." }
    ]
  };

  try {
    const plan = await planShellRequestWithAgent("what is it about?", options);
    
    assert.equal(plan.kind, "reply");
    
    // Check that the system prompt includes the planner contract and action catalog, not the old status dump.
    assert.match(lastSystem, /## Available Actions \(Your Capabilities\):/);
    assert.match(lastSystem, /## Operating Contract/);
    assert.match(lastSystem, /## Graph Contract/);
    assert.doesNotMatch(lastSystem, /## Project Current Status \(Smart Summary\)/);

    // Check that the prompt includes runtime context and history-derived notes
    assert.match(lastPrompt, /## Runtime Context/);
    assert.match(lastPrompt, /### Notes \/ Lore \/ Extra: Recent Interaction/);
    assert.match(lastPrompt, /You have TKT-001 in Todo\./);

    // Verify the mock server received enough context to formulate the correct reply
    assert.match(plan.reply, /Actions are available\. You mentioned TKT-001\./);

  } finally {
    globalThis.fetch = originalFetch;
  }
});
