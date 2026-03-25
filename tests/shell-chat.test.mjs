import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { planShellRequestWithAgent } from "../cli/lib/shell.mjs";

test("Agentic planner correctly uses DB definitions, active tickets, and history", async () => {
  let lastPrompt = "";
  let lastSystem = "";

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      if (req.url === "/api/generate") {
        const payload = JSON.parse(body);
        lastPrompt = payload.prompt;
        lastSystem = payload.system;
        
        let replyText = "Generic reply.";
        if (payload.system.includes("Claims: Architectural facts")) {
          replyText = "Claims are facts.";
        }
        if (payload.system.includes("No active tickets.")) {
          replyText += " No tickets.";
        }
        if (payload.prompt.includes("You have TKT-001")) {
          replyText += " You mentioned TKT-001.";
        }

        res.writeHead(200);
        res.end(JSON.stringify({ response: `{"kind": "reply", "reply": "${replyText}"}` }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  });

  server.listen(0);
  const port = server.address().port;
  const mockHost = `http://127.0.0.1:${port}`;

  const options = {
    plannerContext: { 
      toolkitCodelets: [],
      projectCodelets: [],
      summary: {
        activeTickets: [] // Empty to test the "No active tickets" fallback
      } 
    },
    planner: { providerId: "ollama", modelId: "mock-model", host: mockHost },
    history: [
      { role: "user", content: "what are the next tickets?" },
      { role: "ai", content: "You have TKT-001 in Todo." }
    ]
  };

  try {
    const plan = await planShellRequestWithAgent("what is it about?", options);
    
    assert.equal(plan.kind, "reply");
    
    // Check that the system prompt was injected with the correct definitions
    assert.match(lastSystem, /Claims: Architectural facts extracted via AST/);
    
    // Check that the system prompt correctly formatted the empty active tickets array
    assert.match(lastSystem, /### Active Tickets \(Next to handle\)\nNo active tickets\./);

    // Check that the prompt includes the history
    assert.match(lastPrompt, /You have TKT-001 in Todo\./);

    // Verify the mock server received enough context to formulate the correct reply
    assert.match(plan.reply, /Claims are facts\. No tickets\. You mentioned TKT-001\./);

  } finally {
    server.close();
  }
});
