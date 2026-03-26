import test from "node:test";
import assert from "node:assert/strict";
import { planShellRequestHeuristically } from "../cli/lib/shell.mjs";

const plannerContext = {
  toolkitCodelets: [{ id: "review", summary: "Review changed files" }],
  projectCodelets: [],
  summary: {
    fileCount: 100,
    activeTickets: [],
    knowledge: { tasks: ["summarization", "review"] }
  }
};

const TEST_CASES = [
  // 1. Status / Summary
  { input: "status", expected: "project_summary" },
  { input: "summary", expected: "project_summary" },
  { input: "project summary", expected: "project_summary" },
  { input: "show status", expected: "project_summary" },

  // 2. Metrics
  { input: "metrics", expected: "metrics" },
  { input: "stats", expected: "metrics" },
  { input: "usage", expected: "metrics" },
  { input: "what ai providers are you connected to right now?", expected: "provider_status" },

  // 3. Diagnostics
  { input: "doctor", expected: "doctor" },
  { input: "diagnostics", expected: "doctor" },

  // 4. Sync
  { input: "sync", expected: "sync" },
  { input: "reindex", expected: "sync" },
  { input: "refresh index", expected: "sync" },

  // 5. Review
  { input: "review", expected: "run_review" },
  { input: "show review hotspots", expected: "run_review" },

  // 6. Config / HW
  { input: "set-ollama-hw", expected: "set_ollama_hw" },
  { input: "set-ollama-hw --global", expected: "set_ollama_hw" },
  { input: "set-provider-key google", expected: "set_provider_key" },
  { input: "config set providers.ollama.host 127.0.0.1", expected: "config" },
  { input: "config get providers.ollama.host", expected: "config" },

  // 7. Search
  { input: "search auth", expected: "search" },
  { input: "find router", expected: "search" },

  // 8. Tickets (Extract / Decompose)
  { input: "ticket TKT-123", expected: "extract_ticket" },
  { input: "extract ticket TKT-123", expected: "extract_ticket" },
  { input: "show ticket TKT-123", expected: "extract_ticket" },
  { input: "decompose ticket TKT-123", expected: "decompose_ticket" },
  { input: "break down TKT-123", expected: "decompose_ticket" },

  // 9. Guidelines
  { input: "guidelines", expected: "extract_guidelines" },
  { input: "extract guidelines", expected: "extract_guidelines" },
  { input: "guidelines for TKT-123", expected: "extract_guidelines" },

  // 10. Notes
  { input: "add bug note that says 'fix me'", expected: "add_note" },
  { input: "create todo note body 'do this' file src/app.js line 10", expected: "add_note" },

  // 11. Route
  { input: "route review", expected: "route" },
  { input: "pick model for review", expected: "route" },

  // 12. Ideation
  { input: "add feature user auth", expected: "ideate_feature" },
  { input: "create new epic for payments", expected: "ideate_feature" },
  { input: "new big task refactor db", expected: "ideate_feature" },

  // 13. Bugs / Sweeping
  { input: "sweep bugs", expected: "sweep_bugs" },
  { input: "fix bugs", expected: "sweep_bugs" },
  { input: "handle top priority bugs", expected: "sweep_bugs" },

  // 14. Architecture
  { input: "audit architecture", expected: "audit_architecture" },
  { input: "check wiring", expected: "audit_architecture" },
  { input: "arch audit", expected: "audit_architecture" },

  // 15. Telegram
  { input: "telegram preview", expected: "telegram_preview" },
  { input: "status preview", expected: "telegram_preview" }
];

test("Heuristic Planner 50-Case Coverage", () => {
  let failures = [];
  for (const { input, expected } of TEST_CASES) {
    const plan = planShellRequestHeuristically(input, plannerContext);
    if (plan.kind !== "plan" || !plan.actions || plan.actions[0].type !== expected) {
      failures.push(`Failed on "${input}": Expected ${expected}, got ${plan.kind === 'plan' ? plan.actions[0].type : plan.kind}`);
    }
  }

  if (failures.length > 0) {
    assert.fail(`Heuristic planner failed ${failures.length} cases:\n${failures.join("\n")}`);
  }
});

const CHAT_TEST_CASES = [
  "how are you?",
  "what are the next tickets?",
  "what do you think about that?",
  "tell me a joke",
  "what does claims mean?",
  "what are my modules?",
  "can you list the active tickets?"
];

test("Heuristic Planner gracefully falls back for conversational input", () => {
  let failures = [];
  for (const input of CHAT_TEST_CASES) {
    const plan = planShellRequestHeuristically(input, plannerContext);
    if (plan.confidence > 0.5) {
      failures.push(`False positive on conversational input "${input}" (Confidence: ${plan.confidence})`);
    }
  }

  if (failures.length > 0) {
    assert.fail(`Heuristic planner falsely matched conversational input:\n${failures.join("\n")}`);
  }
});
