import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chooseShellPlannerModel, compileShellAction, planShellRequest, planShellRequestHeuristically, validateShellPlan, buildShellContext, planShellRequestWithAgent, resolveShellPlanners, runShellTurn } from "../cli/lib/shell.mjs";
import { registerProvider } from "../core/services/providers.mjs";

test("buildShellContext reads foundational project files", async (t) => {
  const root = path.resolve("/tmp/ai-workflow-test-" + Math.random().toString(36).slice(2));
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(path.join(root, ".gemini"), { recursive: true });
  await fs.mkdir(path.join(root, "templates"), { recursive: true });

  await fs.writeFile(path.join(root, "MISSION.md"), "Project Mission");
  await fs.writeFile(path.join(root, ".gemini", "KANBAN.md"), "Kanban State");
  await fs.writeFile(path.join(root, "templates", "project-guidelines.md"), "Project Guidelines");

  try {
    const context = await buildShellContext(root);
    assert.equal(context.mission, "Project Mission");
    assert.equal(context.kanban, "Kanban State");
    assert.equal(context.guidelines, "Project Guidelines");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("resolveShellPlanners prefers local shell planning when remote access is env-only", async () => {
  const root = path.resolve("/tmp/ai-workflow-shell-route-" + Math.random().toString(36).slice(2));
  const originalGoogleKey = process.env.GOOGLE_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.GOOGLE_API_KEY = "env-only-google-key";
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/api/tags")) {
      return {
        ok: true,
        async json() {
          return {
            models: [
              { name: "deepseek-r1:8b", size: 5 * 1024 ** 3 }
            ]
          };
        }
      };
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  await fs.mkdir(path.join(root, ".ai-workflow"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".ai-workflow", "config.json"),
    JSON.stringify({
      providers: {
        ollama: {
          host: "http://127.0.0.1:11434",
          hardwareClass: "tiny",
          maxModelSizeB: 4
        }
      }
    }, null, 2)
  );

  try {
    const planners = await resolveShellPlanners(root);
    assert.equal(planners.planners[0]?.providerId, "ollama");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalGoogleKey === undefined) {
      delete process.env.GOOGLE_API_KEY;
    } else {
      process.env.GOOGLE_API_KEY = originalGoogleKey;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("planShellRequestWithAgent uses sophisticated context and memory", async (t) => {
  // Mock provider
  let capturedPrompt = null;
  registerProvider("mock-planner", {
    local: false,
    available: true,
    models: [{ id: "brain-v1", quality: "high" }],
    generate: async ({ system, prompt }) => {
      capturedPrompt = { system, prompt };
      return {
        response: JSON.stringify({
          kind: "plan",
          confidence: 0.95,
          reason: "User wants to ingest a PRD",
          strategy: "Parse PRD and create tickets",
          actions: [{ type: "ingest_artifact", filePath: "docs/prd.md" }]
        })
      };
    }
  });

  const mockContext = {
    summary: { fileCount: 100 },
    smartStatus: "Smart status here.",
    mission: "Build the future.",
    kanban: "## Todo\n- TKT-001",
    gemini: "Focus on KISS.",
    guidelines: "Use ESM.",
    toolkitCodelets: [],
    projectCodelets: []
  };

  const options = {
    root: "/tmp",
    planner: { providerId: "mock-planner", modelId: "brain-v1" },
    plannerContext: mockContext,
    history: [{ role: "user", content: "Previous turn" }, { role: "ai", content: "Previous reply" }]
  };

  const plan = await planShellRequestWithAgent("Ingest the PRD at docs/prd.md", options);

  assert.equal(plan.kind, "plan");
  assert.equal(plan.actions[0].type, "ingest_artifact");
  assert.equal(plan.strategy, "Parse PRD and create tickets");

  // Verify context and memory
  assert.match(capturedPrompt.system, /### MISSION\.md\nBuild the future\./);
  assert.match(capturedPrompt.system, /## Project Current Status \(Smart Summary\)\nSmart status here\./);
  assert.match(capturedPrompt.prompt, /### Recent Interaction \(Last Turn\):\nUser: Previous turn\nBrain: Previous reply/);
});

test("planShellRequestWithAgent handles vague requests by asking for clarification", async (t) => {
  registerProvider("mock-vague", {
    local: false,
    available: true,
    models: [{ id: "brain-v1", quality: "high" }],
    generate: async () => ({
      response: JSON.stringify({
        kind: "reply",
        confidence: 0.9,
        reason: "User said 'fix it' without context",
        reply: "Fix what exactly? I see 3 open tickets."
      })
    })
  });

  const options = {
    root: "/tmp",
    planner: { providerId: "mock-vague", modelId: "brain-v1" },
    plannerContext: { summary: {}, toolkitCodelets: [], projectCodelets: [] },
    history: []
  };

  const result = await planShellRequestWithAgent("fix it", options);
  assert.equal(result.kind, "reply");
  assert.equal(result.reply, "Fix what exactly? I see 3 open tickets.");
});

test("planShellRequestWithAgent handles multi-step strategy", async (t) => {
  registerProvider("mock-multi", {
    local: false,
    available: true,
    models: [{ id: "brain-v1", quality: "high" }],
    generate: async () => ({
      response: JSON.stringify({
        kind: "plan",
        confidence: 0.98,
        reason: "User wants to start a new feature",
        strategy: "First ideate, then sync, then show the new tickets",
        actions: [{ type: "ideate_feature", intent: "New Auth" }, { type: "sync" }]
      })
    })
  });

  const options = {
    root: "/tmp",
    planner: { providerId: "mock-multi", modelId: "brain-v1" },
    plannerContext: { summary: {}, toolkitCodelets: [], projectCodelets: [] },
    history: []
  };

  const result = await planShellRequestWithAgent("start new auth feature", options);
  assert.equal(result.kind, "plan");
  assert.equal(result.actions.length, 2);
  assert.equal(result.strategy, "First ideate, then sync, then show the new tickets");
});

test("planShellRequestWithAgent handles plan with missing actions gracefully", async (t) => {
  registerProvider("mock-broken-plan", {
    local: false,
    available: true,
    models: [{ id: "brain-v1", quality: "high" }],
    generate: async () => ({
      response: JSON.stringify({
        kind: "plan",
        confidence: 0.8,
        reason: "Thinking...",
        strategy: "Do something",
        // actions is missing!
      })
    })
  });

  const options = {
    root: "/tmp",
    planner: { providerId: "mock-broken-plan", modelId: "brain-v1" },
    plannerContext: { summary: {}, toolkitCodelets: [], projectCodelets: [] },
    history: []
  };

  const result = await planShellRequestWithAgent("some request", options);
  assert.equal(result.kind, "reply");
  assert.match(result.reply, /I understood your strategy/);
});

test("planShellRequestWithAgent multi-turn grounding scenario", async (t) => {
  let capturedPrompt = null;
  registerProvider("mock-scenario", {
    local: false,
    available: true,
    models: [{ id: "brain-v1", quality: "high" }],
    generate: async ({ prompt }) => {
      capturedPrompt = prompt;
      return { response: JSON.stringify({ kind: "reply", reply: "I see those tickets.", strategy: "Thinking..." }) };
    }
  });

  const mockContext = {
    summary: {},
    smartStatus: "Status: 2 tickets [TKT-42, TKT-99]",
    toolkitCodelets: [],
    projectCodelets: []
  };

  // Turn 1 happened: user asked "status", AI ran "project summary", output was stored in history
  const history = [
    { role: "user", content: "what's the status?" },
    { 
      role: "ai", 
      content: "Strategy: Get status\n\nAction [project_summary] output:\nFiles: 10\nTickets: 2\n[TKT-42] Fix login\n[TKT-99] Add tests" 
    }
  ];

  const options = {
    root: "/tmp",
    planner: { providerId: "mock-scenario", modelId: "brain-v1" },
    plannerContext: mockContext,
    history
  };

  // Turn 2: User asks about the tickets mentioned in the OUTPUT of Turn 1
  await planShellRequestWithAgent("tell me about those two tickets", options);

  // Verify the AI "sees" the output of the previous command in its history
  assert.match(capturedPrompt, /Action \[project_summary\] output:/);
  assert.match(capturedPrompt, /\[TKT-42\] Fix login/);
  assert.match(capturedPrompt, /\[TKT-99\] Add tests/);
});

const plannerContext = {
  toolkitCodelets: [
    { id: "review", summary: "Review changed files." },
    { id: "audit", summary: "Run workflow audit." }
  ],
  projectCodelets: [
    { id: "custom-check", summary: "Project-local check." }
  ],
  root: "/tmp/example-project",
  providerState: {
    providers: {
      openai: { available: false },
      ollama: { available: true, host: "http://127.0.0.1:11434" },
      google: { available: true }
    }
  },
  summary: {
    fileCount: 10,
    activeTickets: [{ id: "TKT-001", title: "Example", lane: "Todo" }],
    modules: [{ name: "src/ui" }, { name: "src/engine" }]
  }
};

test("heuristic shell planner expands sync plus review requests into multiple actions", () => {
  const plan = planShellRequestHeuristically("sync and show review hotspots", plannerContext);
  assert.equal(plan.kind, "plan");
  assert.deepEqual(plan.actions, [
    { type: "sync" },
    { type: "run_review" }
  ]);
});

test("heuristic shell planner keeps help requests as replies and accepts question marks", () => {
  const plan = planShellRequestHeuristically("what can you do?", plannerContext);
  assert.equal(plan.kind, "reply");
  assert.match(plan.reply, /Examples:/);
});

test("heuristic shell planner recognizes set-ollama-hw shell commands", () => {
  const plan = planShellRequestHeuristically("set-ollama-hw --global", plannerContext);
  assert.equal(plan.kind, "plan");
  assert.deepEqual(plan.actions, [
    { type: "set_ollama_hw", global: true }
  ]);
});

test("heuristic shell planner handles provider status questions without AI planning", () => {
  const plan = planShellRequestHeuristically("what ai providers are you connected to right now?", plannerContext);
  assert.equal(plan.kind, "plan");
  assert.deepEqual(plan.actions, [
    { type: "provider_status" }
  ]);
});

test("heuristic shell planner handles version requests directly", () => {
  const plan = planShellRequestHeuristically("version", plannerContext);
  assert.equal(plan.kind, "plan");
  assert.deepEqual(plan.actions, [
    { type: "version" }
  ]);
});

test("shell planner can answer compound project-grounded questions", async () => {
  const plan = await planShellRequest("what project am i in and what should i work on next?", {
    plannerContext,
    noAi: true,
    planners: { planners: [], heuristic: { mode: "heuristic", reason: "fallback" } }
  });
  assert.equal(plan.kind, "reply");
  assert.match(plan.reply, /example-project/);
  assert.match(plan.reply, /TKT-001/);
});

test("heuristic shell planner can answer setup and troubleshooting questions", () => {
  const setup = planShellRequestHeuristically("help me set this up to use openai and ollama", plannerContext);
  assert.equal(setup.kind, "reply");
  assert.match(setup.reply, /set-provider-key openai --global/);
  assert.match(setup.reply, /set-ollama-hw --global/);

  const providerFailure = planShellRequestHeuristically("i think you did something wrong: gemini looks broken, investigate and tell me what to do", plannerContext);
  assert.equal(providerFailure.kind, "reply");
  assert.match(providerFailure.reply, /API_KEY_SERVICE_BLOCKED/);
  assert.match(providerFailure.reply, /doctor/);
});

test("heuristic shell planner answers capability and greeting prompts like an assistant", () => {
  const capability = planShellRequestHeuristically("what can you do here?", plannerContext);
  assert.equal(capability.kind, "reply");
  assert.match(capability.reply, /inspect project state/i);

  const greeting = planShellRequestHeuristically("how's it going? ready to help?", plannerContext);
  assert.equal(greeting.kind, "reply");
  assert.match(greeting.reply, /Ready\./);
});

test("runShellTurn narrates non-mutating tool results through the assistant layer", async () => {
  const root = path.resolve("/tmp/ai-workflow-shell-" + Math.random().toString(36).slice(2));
  await fs.mkdir(root, { recursive: true });

  registerProvider("mock-shell-reply", {
    local: false,
    available: true,
    models: [{ id: "brain-v1", quality: "high" }],
    generate: async ({ prompt }) => {
      assert.match(prompt, /Tool results:/);
      return { response: "Connected providers are ready." };
    }
  });

  try {
    const result = await runShellTurn("what ai providers are you connected to right now?", {
      root,
      json: false,
      yes: false,
      noAi: false,
      planOnly: false,
      plannerContext,
      planners: {
        planners: [{ providerId: "mock-shell-reply", modelId: "brain-v1" }],
        heuristic: { mode: "heuristic", reason: "fallback" }
      },
      history: []
    });

    assert.equal(result.plan.kind, "plan");
    assert.equal(result.assistantReply, "Connected providers are ready.");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("compileShellAction produces a safe mutating note command", () => {
  const compiled = compileShellAction({
    type: "add_note",
    noteType: "BUG",
    body: "shared router can race",
    filePath: "src/core/router.js",
    line: 12
  });

  assert.equal(compiled.mutation, true);
  assert.deepEqual(compiled.args, [
    "project",
    "note",
    "add",
    "--type",
    "BUG",
    "--body",
    "shared router can race",
    "--file",
    "src/core/router.js",
    "--line",
    "12"
  ]);
});

test("validateShellPlan accepts known codelets and rejects unknown ones", () => {
  const valid = validateShellPlan({
    kind: "plan",
    actions: [
      { type: "run_codelet", codeletId: "custom-check", args: ["--fast"] }
    ]
  }, plannerContext);
  assert.equal(valid.kind, "plan");
  assert.equal(valid.actions[0].codeletId, "custom-check");

  assert.throws(() => validateShellPlan({
    kind: "plan",
    actions: [
      { type: "run_codelet", codeletId: "missing-codelet" }
    ]
  }, plannerContext));
});

test("chooseShellPlannerModel defaults to a smaller model when hardware is unknown", () => {
  const selected = chooseShellPlannerModel({
    models: [
      { id: "qwen2.5:32b", quality: "high", sizeB: 32 },
      { id: "qwen2.5:7b", quality: "low", sizeB: 7 },
      { id: "qwen2.5:14b", quality: "medium", sizeB: 14 }
    ]
  });

  assert.equal(selected.id, "qwen2.5:7b");
  assert.equal(selected.needsHardwareHint, true);
});

test("chooseShellPlannerModel respects pinned planner models and hardware classes", () => {
  const pinned = chooseShellPlannerModel({
    plannerModel: "qwen2.5:14b",
    models: [
      { id: "qwen2.5:32b", quality: "high", sizeB: 32 },
      { id: "qwen2.5:14b", quality: "medium", sizeB: 14 }
    ]
  });
  assert.equal(pinned.id, "qwen2.5:14b");
  assert.equal(pinned.needsHardwareHint, false);

  const sized = chooseShellPlannerModel({
    hardwareClass: "medium",
    models: [
      { id: "qwen2.5:32b", quality: "high", sizeB: 32 },
      { id: "qwen2.5:14b", quality: "medium", sizeB: 14 },
      { id: "qwen2.5:7b", quality: "low", sizeB: 7 }
    ]
  });
  assert.equal(sized.id, "qwen2.5:7b");
  assert.match(sized.reason, /hardware class medium/);
});
