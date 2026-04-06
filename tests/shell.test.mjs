import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chooseShellPlannerModel, compileShellAction, handleShellCommand, planShellRequest, planShellRequestHeuristically, validateShellPlan, buildShellContext, buildShellPlannerPrompt, planShellRequestWithAgent, resolveShellPlanners, runShellTurn } from "../cli/lib/shell.mjs";
import { registerProvider } from "../core/services/providers.mjs";

const defaultShellTestFetch = async (url) => {
  if (String(url).includes("duckduckgo")) {
    return {
      ok: true,
      async text() {
        return "<html><body></body></html>";
      }
    };
  }
  throw new Error(`Unexpected fetch URL in shell test: ${url}`);
};

globalThis.fetch = defaultShellTestFetch;

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

test("resolveShellPlanners keeps local Ollama first even when a remote provider is configured", async () => {
  const root = path.resolve("/tmp/ai-workflow-shell-route-local-first-" + Math.random().toString(36).slice(2));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/api/tags")) {
      return {
        ok: true,
        async json() {
          return {
            models: [
              { name: "qwen2.5-coder:7b", size: 7 * 1024 ** 3 }
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
          host: "http://127.0.0.1:11434"
        },
        openai: {
          apiKey: "openai-key"
        }
      }
    }, null, 2)
  );

  try {
    const planners = await resolveShellPlanners(root);
    assert.equal(planners.planners[0]?.providerId, "ollama");
    assert.equal(planners.planners[0]?.modelId, "qwen2.5-coder:7b");
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("resolveShellPlanners uses the live model-fit matrix to prefer gemma4 for shell planning", async () => {
  const root = path.resolve("/tmp/ai-workflow-shell-gemma4-" + Math.random().toString(36).slice(2));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/api/tags")) {
      return {
        ok: true,
        async json() {
          return {
            models: [
              { name: "qwen2.5-coder:7b", size: 7 * 1024 ** 3 },
              { name: "gemma4:9b", size: 9 * 1024 ** 3 }
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
          hardwareClass: "medium",
          maxModelSizeB: 14
        }
      }
    }, null, 2)
  );

  try {
    const planners = await resolveShellPlanners(root);
    assert.equal(planners.planners[0]?.providerId, "ollama");
    assert.equal(planners.planners[0]?.modelId, "gemma4:9b");
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("planShellRequestWithAgent uses operator-first prompt design and interaction memory", async (t) => {
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

  assert.match(capturedPrompt.system, /## Operating Contract/);
  assert.match(capturedPrompt.system, /## Available Actions \(Your Capabilities\):/);
  assert.match(capturedPrompt.system, /## Graph Contract/);
  assert.match(capturedPrompt.system, /## Planning Rules/);
  assert.doesNotMatch(capturedPrompt.system, /### MISSION\.md/);
  assert.doesNotMatch(capturedPrompt.system, /## Project Current Status \(Smart Summary\)/);
  assert.match(capturedPrompt.prompt, /## Runtime Context/);
  assert.match(capturedPrompt.prompt, /### Notes \/ Lore \/ Extra: Recent Interaction/);
  assert.match(capturedPrompt.prompt, /User: Previous turn\nBrain: Previous reply/);
});

test("buildShellPlannerPrompt keeps first-turn runtime context minimal by default", async () => {
  const { system, prompt } = await buildShellPlannerPrompt("what should we do next?", {
    root: "/tmp/example-project",
    plannerContext: {
      root: "/tmp/example-project",
      mission: "Build the future.",
      kanban: "## Todo\n- TKT-001",
      guidelines: "Use ESM.",
      smartStatus: "Smart status here.",
      providerState: {
        providers: {
          ollama: { available: true, local: true, host: "http://127.0.0.1:11434" }
        }
      },
      summary: {
        activeTickets: [{ id: "TKT-001", title: "Example", lane: "Todo" }]
      },
      toolkitCodelets: [],
      projectCodelets: []
    },
    history: []
  });

  assert.match(system, /## Operating Contract/);
  assert.match(system, /## Available Actions \(Your Capabilities\):/);
  assert.doesNotMatch(system, /MISSION\.md|KANBAN\.md|GUIDELINES|Smart status here\./);
  assert.match(prompt, /## Runtime Context\ncwd: \/tmp\/example-project\nproject: example-project\nactive-ticket-count: 1/);
  assert.match(prompt, /available-providers: ollama:local@http:\/\/127\.0\.0\.1:11434/);
  assert.doesNotMatch(prompt, /Build the future\.|## Todo|Use ESM\.|Smart status here\./);
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

test("planShellRequest prefers the AI graph planner for semantic paraphrases of complex requests", async () => {
  const seen = [];
  registerProvider("mock-complex-semantic", {
    local: false,
    available: true,
    models: [{ id: "brain-v1", quality: "high" }],
    generate: async ({ prompt }) => {
      seen.push(prompt);
      return {
        response: JSON.stringify({
          kind: "plan",
          confidence: 0.99,
          reason: "Complex goal-driven request requires graph planning",
          strategy: "Inspect current ticket, plan its execution, inspect remaining tickets, then rank them against the goal.",
          actions: [
            { type: "extract_ticket", ticketId: "REF-APP-SHELL-01" },
            { type: "execute_ticket", ticketId: "REF-APP-SHELL-01", apply: false },
            { type: "list_tickets" }
          ]
        })
      };
    }
  });

  const options = {
    root: "/tmp",
    planner: { providerId: "mock-complex-semantic", modelId: "brain-v1" },
    planners: {
      planners: [{ providerId: "mock-complex-semantic", modelId: "brain-v1" }],
      heuristic: { mode: "heuristic", reason: "fallback" }
    },
    plannerContext: {
      ...plannerContext,
      summary: {
        ...plannerContext.summary,
        activeTickets: [
          { id: "REF-APP-SHELL-01", title: "Continue app-shell hardening", lane: "In Progress" },
          { id: "BETA-STAB-01", title: "Stabilize beta-critical invite, auth, feedback, quota, and core UX flows without adding features.", lane: "Todo" }
        ]
      }
    },
    history: []
  };

  const paraphrases = [
    "resolve the in-progress ticket, prioritize the rest of the tickets according to the goal, which is preparing the system to a non-embaracing beta-testing and resolve what is needed to achieve that goal",
    "wrap up whatever is active now, then figure out what else should come first if the goal is a beta that is not embarrassing",
    "take care of the thing currently in flight and afterwards sort the remaining work around beta readiness rather than feature ambition",
    "finish what's underway, inspect the rest, and tell me the right order if we're trying to get to a solid beta",
    "work through the active item first, then rank everything else by what most reduces beta risk"
  ];

  for (const input of paraphrases) {
    const plan = await planShellRequest(input, options);
    assert.equal(plan.kind, "plan", input);
    assert.equal(plan.planner.providerId, "mock-complex-semantic", input);
    assert.equal(plan.actions[0].type, "extract_ticket", input);
    assert.equal(plan.actions[1].type, "execute_ticket", input);
    assert.equal(plan.actions[2].type, "list_tickets", input);
  }

  assert.equal(seen.length, paraphrases.length);
  assert.match(seen[0], /Current User Request:/);
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

test("handleShellCommand toggles plan, mutate, and trace state", () => {
  const options = {
    shellMode: "plan",
    trace: false,
    json: false
  };

  assert.deepEqual(handleShellCommand("mutate", options), { handled: true });
  assert.equal(options.shellMode, "mutate");

  assert.deepEqual(handleShellCommand("trace on", options), { handled: true });
  assert.equal(options.trace, true);

  assert.deepEqual(handleShellCommand("plan", options), { handled: true });
  assert.equal(options.shellMode, "plan");

  assert.deepEqual(handleShellCommand("trace off", options), { handled: true });
  assert.equal(options.trace, false);
});

test("planShellRequestWithAgent traces the selected model and response", async () => {
  const traceEvents = [];
  registerProvider("mock-trace", {
    local: false,
    available: true,
    models: [{ id: "brain-v1", quality: "high" }],
    generate: async () => ({
      response: JSON.stringify({
        kind: "reply",
        confidence: 0.91,
        reason: "Trace test",
        reply: "Tracing works."
      })
    })
  });

  const options = {
    root: "/tmp",
    planner: { providerId: "mock-trace", modelId: "brain-v1" },
    plannerContext: { summary: {}, toolkitCodelets: [], projectCodelets: [] },
    history: [],
    traceAi: (event) => traceEvents.push(event)
  };

  const result = await planShellRequestWithAgent("explain trace", options);

  assert.equal(result.kind, "reply");
  assert.equal(result.reply, "Tracing works.");
  assert.equal(traceEvents.length >= 2, true);
  assert.equal(traceEvents[0].phase, "request");
  assert.equal(traceEvents[0].stage, "planner");
  assert.equal(traceEvents[0].planner.modelId, "brain-v1");
  assert.equal(traceEvents.some((event) => event.phase === "response" && event.stage === "planner" && event.planner.modelId === "brain-v1"), true);
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
  knowledge: {
    tasks: ["review", "classification", "summarization"]
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
  assert.deepEqual(plan.graph.nodes.map((node) => ({ id: node.id, type: node.type, dependsOn: node.dependsOn })), [
    { id: "n1", type: "sync", dependsOn: [] },
    { id: "n2", type: "run_review", dependsOn: ["n1"] },
    { id: "n3", type: "synthesize", dependsOn: ["n1", "n2"] }
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

test("heuristic shell planner handles broad project-next questions and implicit in-progress ticket references", () => {
  const projectNext = planShellRequestHeuristically("so what can you tell me about the project? what do you think we should do next?", plannerContext);
  assert.equal(projectNext.kind, "reply");
  assert.match(projectNext.reply, /example-project/);
  assert.match(projectNext.reply, /TKT-001/);

  const inProgress = planShellRequestHeuristically("what's in-progress?", {
    ...plannerContext,
    summary: {
      ...plannerContext.summary,
      activeTickets: [{ id: "REF-APP-SHELL-01", title: "Continue app-shell hardening", lane: "In Progress" }]
    }
  });
  assert.equal(inProgress.kind, "reply");
  assert.match(inProgress.reply, /REF-APP-SHELL-01/);

  const explain = planShellRequestHeuristically("explain ticket. which artifacts it relates to and what functionality exactly.", {
    ...plannerContext,
    toolkitCodelets: [...plannerContext.toolkitCodelets, { id: "context-pack", summary: "Build ticket context." }],
    summary: {
      ...plannerContext.summary,
      activeTickets: [{ id: "REF-APP-SHELL-01", title: "Continue app-shell hardening", lane: "In Progress" }]
    }
  });
  assert.equal(explain.kind, "plan");
  assert.deepEqual(explain.actions, [
    { type: "run_codelet", codeletId: "context-pack", args: ["--ticket", "REF-APP-SHELL-01"] }
  ]);

  const currentWork = planShellRequestHeuristically("tell me what we're working on right now and what should we do about it. which artifacts relates to it.", {
    ...plannerContext,
    toolkitCodelets: [...plannerContext.toolkitCodelets, { id: "context-pack", summary: "Build ticket context." }],
    summary: {
      ...plannerContext.summary,
      activeTickets: [{ id: "REF-APP-SHELL-01", title: "Continue app-shell hardening", lane: "In Progress" }]
    }
  });
  assert.equal(currentWork.kind, "plan");
  assert.deepEqual(currentWork.actions, [
    { type: "run_codelet", codeletId: "context-pack", args: ["--ticket", "REF-APP-SHELL-01"] }
  ]);

  const execute = planShellRequestHeuristically("ok, complete the ticket in progress. resolve it.", {
    ...plannerContext,
    summary: {
      ...plannerContext.summary,
      activeTickets: [{ id: "REF-APP-SHELL-01", title: "Continue app-shell hardening", lane: "In Progress" }]
    }
  });
  assert.equal(execute.kind, "plan");
  assert.deepEqual(execute.actions, [
    { type: "execute_ticket", ticketId: "REF-APP-SHELL-01", apply: true }
  ]);
});

test("heuristic shell planner routes complex goal-directed ticket requests through staged planning", () => {
  const complexContext = {
    ...plannerContext,
    toolkitCodelets: [...plannerContext.toolkitCodelets, { id: "context-pack", summary: "Build ticket context." }],
    summary: {
      ...plannerContext.summary,
      activeTickets: [
        { id: "REF-APP-SHELL-01", title: "Continue app-shell hardening", lane: "In Progress" },
        { id: "BETA-STAB-01", title: "Stabilize beta-critical invite, auth, feedback, quota, and core UX flows without adding features.", lane: "Todo" },
        { id: "ADMIN-METRICS-01", title: "Replace estimated AI spend with real usage metrics and a detailed metrics screen.", lane: "Todo" }
      ]
    }
  };

  const requests = [
    "resolve the in-progress ticket, prioritize the rest of the tickets according to the goal, which is preparing the system to a non-embaracing beta-testing and resolve what is needed to achieve that goal",
    "finish the current ticket, then tell me what else must land before beta",
    "complete the current task and then reprioritize everything around stability, not features"
  ];

  for (const input of requests) {
    const plan = planShellRequestHeuristically(input, complexContext);
    assert.equal(plan.kind, "plan", input);
    assert.deepEqual(plan.actions, [
      { type: "run_codelet", codeletId: "context-pack", args: ["--ticket", "REF-APP-SHELL-01"] },
      { type: "execute_ticket", ticketId: "REF-APP-SHELL-01", apply: false },
      { type: "list_tickets" }
    ], input);
    assert.match(plan.strategy, /goal|beta|stability/i, input);
    assert.deepEqual(plan.graph.nodes.map((node) => ({ kind: node.kind, type: node.type, dependsOn: node.dependsOn })), [
      { kind: "action", type: "run_codelet", dependsOn: [] },
      { kind: "action", type: "execute_ticket", dependsOn: ["n1"] },
      { kind: "action", type: "list_tickets", dependsOn: ["n2"] },
      { kind: "synthesize", type: "synthesize", dependsOn: ["n1", "n2", "n3"] }
    ], input);
  }
});

test("heuristic shell planner routes readiness questions to the shared readiness evaluator", () => {
  const plan = planShellRequestHeuristically("is this project ready for beta testing?", plannerContext);
  assert.equal(plan.kind, "plan");
  assert.deepEqual(plan.actions, [{
    type: "evaluate_readiness",
    goalType: "beta_readiness",
    question: "is this project ready for beta testing?"
  }]);
});

test("heuristic shell planner combines project status and readiness questions into a single guided flow", () => {
  const plan = planShellRequestHeuristically("what's the project status? how ready is it for beta test?", plannerContext);
  assert.equal(plan.kind, "plan");
  assert.deepEqual(plan.actions, [
    { type: "project_summary" },
    {
      type: "evaluate_readiness",
      goalType: "beta_readiness",
      question: "what's the project status? how ready is it for beta test?"
    }
  ]);
  assert.equal(plan.presentation, "assistant-first");
});

test("heuristic shell planner turns 'make it ready' into execution against the latest readiness blockers", () => {
  const plan = planShellRequestHeuristically("make it ready", plannerContext, {
    activeGraphState: {
      graph: {
        nodes: [{
          id: "n1",
          kind: "action",
          type: "evaluate_readiness",
          status: "ok",
          result: {
            structuredPayload: {
              operation: "evaluate_readiness",
              question: "Is this project ready for beta testing?",
              goalType: "beta_readiness",
              blockers: [
                { title: "BUG-OVERLAY-01 Restore global overlay handling for non-dialog modals after the app-shell refactor.", severity: "high" },
                { title: "HUMAN-REF-APP-SHELL-01 Manual verification after fixes.", severity: "high" }
              ]
            }
          }
        }]
      }
    }
  });
  assert.equal(plan.kind, "plan");
  assert.deepEqual(plan.actions, [
    { type: "execute_ticket", ticketId: "BUG-OVERLAY-01", apply: true },
    { type: "evaluate_readiness", goalType: "beta_readiness", question: "Is this project ready for beta testing?" }
  ]);
  assert.equal(plan.presentation, "assistant-first");
});

test("heuristic shell planner treats blocker-resolution followups as readiness continuation", () => {
  const plan = planShellRequestHeuristically("can you resolve those 5 blockers?", plannerContext, {
    activeGraphState: {
      graph: {
        nodes: [{
          id: "n1",
          kind: "action",
          type: "evaluate_readiness",
          status: "ok",
          result: {
            structuredPayload: {
              operation: "evaluate_readiness",
              question: "Is this project ready for beta testing?",
              goalType: "beta_readiness",
              blockers: [
                { title: "BUG-OVERLAY-01 Restore global overlay handling for non-dialog modals after the app-shell refactor.", severity: "high" },
                { title: "BUG-MODAL-BACK-01 Browser back on a stacked dialog should pop to the previous dialog, not clear the whole stack.", severity: "medium" }
              ]
            }
          }
        }]
      }
    }
  });
  assert.equal(plan.kind, "plan");
  assert.deepEqual(plan.actions, [
    { type: "execute_ticket", ticketId: "BUG-OVERLAY-01", apply: true },
    { type: "evaluate_readiness", goalType: "beta_readiness", question: "Is this project ready for beta testing?" }
  ]);
});

test("heuristic shell planner accepts lowercase ticket ids for explicit execution", () => {
  const plan = planShellRequestHeuristically("fix bug-overlay-01", plannerContext);
  assert.equal(plan.kind, "plan");
  assert.deepEqual(plan.actions, [
    { type: "execute_ticket", ticketId: "BUG-OVERLAY-01", apply: true }
  ]);
});

test("shell conversation eval handles broader natural-language prompts", async () => {
  const cases = [
    {
      input: "Can you tell me what project this is and what I should work on next?",
      patterns: [/example-project/, /TKT-001/]
    },
    {
      input: "I'm new here. What can you do in this repo?",
      patterns: [/inspect project state/i, /search code and tickets/i]
    },
    {
      input: "How are you feeling? Are you ready to help me debug this thing?",
      patterns: [/Ready\./]
    },
    {
      input: "Walk me through setting this up with OpenAI and Ollama.",
      patterns: [/set-provider-key openai --global/, /set-ollama-hw --global/]
    },
    {
      input: "Gemini seems broken. Investigate what is likely wrong and tell me what I should do.",
      patterns: [/Gemini looks unhealthy/i, /doctor/, /route shell-planning/]
    },
    {
      input: "What shape is this project in right now?",
      patterns: [/example-project/, /Top active ticket:/]
    },
    {
      input: "What are the major parts of this codebase?",
      patterns: [/src\/ui, src\/engine/]
    },
    {
      input: "Could you list the current tickets I'm likely to care about?",
      patterns: [/Current active tickets:/, /TKT-001/]
    }
  ];

  for (const item of cases) {
    const plan = await planShellRequest(item.input, {
      plannerContext,
      noAi: true,
      planners: { planners: [], heuristic: { mode: "heuristic", reason: "fallback" } }
    });
    assert.equal(plan.kind, "reply", item.input);
    for (const pattern of item.patterns) {
      assert.match(plan.reply, pattern, item.input);
    }
  }
});

test("runShellTurn narrates non-mutating tool results through the assistant layer", async () => {
  const root = path.resolve("/tmp/ai-workflow-shell-" + Math.random().toString(36).slice(2));
  await fs.mkdir(root, { recursive: true });

  registerProvider("mock-shell-reply", {
    local: false,
    available: true,
    models: [{ id: "brain-v1", quality: "high" }],
    generate: async ({ prompt }) => {
      assert.match(prompt, /Node results:/);
      assert.match(prompt, /Action graph:/);
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
    assert.equal(Array.isArray(result.executedGraph?.nodes), true);
    assert.equal(result.executedGraph.nodes[0].id, "n1");
    assert.equal(result.executedGraph.nodes[0].status, "ok");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("runShellTurn blocks mutating shell plans until exactly one ticket is in progress", async () => {
  const root = path.resolve("/tmp/ai-workflow-shell-guard-" + Math.random().toString(36).slice(2));
  await fs.mkdir(root, { recursive: true });

  try {
    const result = await runShellTurn("fix bug-overlay-01", {
      root,
      json: false,
      yes: true,
      noAi: true,
      planOnly: false,
      shellMode: "mutate",
      plannerContext: {
        ...plannerContext,
        summary: {
          ...plannerContext.summary,
          activeTickets: [
            { id: "BUG-OVERLAY-01", title: "Restore global overlay handling", lane: "Todo" }
          ]
        }
      },
      planners: {
        planners: [],
        heuristic: { mode: "heuristic", reason: "fallback" }
      },
      history: []
    });

    assert.equal(result.plan.kind, "reply");
    assert.match(result.plan.reply, /In Progress/);
    assert.match(result.plan.reply, /BUG-OVERLAY-01/);
    assert.equal(result.executed.length, 0);
    assert.equal(result.executedGraph.nodes.length, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("runShellTurn asks to switch modes before mutating in plan mode", async () => {
  const root = path.resolve("/tmp/ai-workflow-shell-direct-guard-" + Math.random().toString(36).slice(2));
  await fs.mkdir(root, { recursive: true });

  try {
    const result = await runShellTurn("sync", {
      root,
      json: false,
      yes: false,
      noAi: true,
      planOnly: false,
      shellMode: "plan",
      plannerContext: {
        ...plannerContext,
        summary: {
          ...plannerContext.summary,
          activeTickets: [
            { id: "BUG-OVERLAY-01", title: "Restore global overlay handling", lane: "In Progress" }
          ]
        }
      },
      planners: {
        planners: [],
        heuristic: { mode: "heuristic", reason: "fallback" }
      },
      history: []
    });

    assert.equal(result.plan.kind, "reply");
    assert.match(result.plan.reply, /mutating mode/i);
    assert.match(result.plan.reply, /mutate/i);
    assert.match(result.plan.reply, /plan/i);
    assert.equal(result.executed.length, 0);
    assert.equal(result.executedGraph.nodes.length, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("runShellTurn executes mutating shell actions in mutating mode", async () => {
  const root = path.resolve("/tmp/ai-workflow-shell-mutate-mode-" + Math.random().toString(36).slice(2));
  await fs.mkdir(root, { recursive: true });

  try {
    const result = await runShellTurn("config set workflow.mode tool-dev", {
      root,
      json: false,
      yes: true,
      noAi: true,
      planOnly: false,
      shellMode: "mutate",
      plannerContext: {
        ...plannerContext,
        summary: {
          ...plannerContext.summary,
          activeTickets: [
            { id: "BUG-OVERLAY-01", title: "Restore global overlay handling", lane: "In Progress" }
          ]
        }
      },
      planners: {
        planners: [],
        heuristic: { mode: "heuristic", reason: "fallback" }
      },
      history: []
    });

    assert.equal(result.plan.kind, "plan");
    assert.equal(result.executed.length, 1);
    assert.equal(result.executedGraph.nodes.length > 0, true);
    assert.equal(result.executed.some((item) => item.action.type === "config"), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("runShellTurn can set up Ollama without hitting the missing provider_connect handler", async () => {
  const root = path.resolve("/tmp/ai-workflow-shell-ollama-setup-" + Math.random().toString(36).slice(2));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/api/tags")) {
      return {
        ok: true,
        async json() {
          return {
            models: [
              { name: "hermes3:8b", size: 4.3 * 1024 ** 3 }
            ]
          };
        }
      };
    }
    throw new Error(`Unexpected fetch URL in shell test: ${url}`);
  };

  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(path.join(root, ".ai-workflow"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".ai-workflow", "config.json"),
    JSON.stringify({
      providers: {
        ollama: {
          host: "http://lotus:11434"
        }
      }
    }, null, 2)
  );

  try {
    const result = await runShellTurn("setup ollama", {
      root,
      json: false,
      yes: true,
      noAi: true,
      planOnly: false,
      shellMode: "mutate",
      plannerContext: {
        ...plannerContext,
        summary: {
          ...plannerContext.summary,
          activeTickets: [
            { id: "BUG-OVERLAY-01", title: "Restore global overlay handling", lane: "In Progress" }
          ]
        }
      },
      planners: {
        planners: [],
        heuristic: { mode: "heuristic", reason: "fallback" }
      },
      history: []
    });

    assert.equal(result.plan.kind, "plan");
    assert.equal(result.executed.length, 1);
    assert.equal(result.executed[0].ok, true);
    assert.match(result.executed[0].stdout, /Ollama/i);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("runShellTurn executes branch/assert/replan nodes and exposes continuation state", async () => {
  const root = path.resolve("/tmp/ai-workflow-shell-graph-" + Math.random().toString(36).slice(2));
  await fs.mkdir(root, { recursive: true });

  registerProvider("mock-shell-graph", {
    local: false,
    available: true,
    models: [{ id: "brain-v1", quality: "high" }],
    generate: async () => ({
      response: JSON.stringify({
        kind: "plan",
        confidence: 0.97,
        reason: "Need conditional investigation",
        strategy: "Inspect providers, assert baseline health, branch, then append a follow-up check.",
        graph: {
          nodes: [
            { id: "lookup", kind: "action", action: { type: "provider_status" } },
            {
              id: "gate",
              kind: "assert",
              dependsOn: ["lookup"],
              condition: { node: "lookup", path: "ok", equals: true },
              message: "provider lookup should succeed"
            },
            {
              id: "branch",
              kind: "branch",
              dependsOn: ["gate"],
              condition: { node: "lookup", path: "summary", includes: "AI providers:" },
              ifTrue: [{ type: "version" }],
              ifFalse: [{ type: "doctor" }]
            },
            {
              id: "replan",
              kind: "replan",
              dependsOn: ["branch"],
              condition: { node: "branch", path: "structuredPayload.branch", equals: "ifTrue" },
              append: [{ type: "provider_status" }]
            }
          ]
        }
      })
    })
  });

  try {
    const result = await runShellTurn("inspect provider health deeply", {
      root,
      json: false,
      yes: false,
      noAi: false,
      planOnly: false,
      plannerContext,
      planners: {
        planners: [{ providerId: "mock-shell-graph", modelId: "brain-v1" }],
        heuristic: { mode: "heuristic", reason: "fallback" }
      },
      history: []
    });

    assert.equal(result.plan.kind, "plan");
    assert.deepEqual(result.executedGraph.branchPath, [{ nodeId: "branch", branch: "ifTrue" }]);
    assert.equal(result.executedGraph.nodes.find((node) => node.id === "gate")?.result?.classification, "asserted");
    assert.equal(result.executedGraph.nodes.find((node) => node.id === "branch")?.result?.structuredPayload?.branch, "ifTrue");
    assert.equal(result.executedGraph.nodes.some((node) => node.id.startsWith("branch_")), true);
    assert.equal(result.executedGraph.nodes.some((node) => node.id.startsWith("replan_")), true);
    assert.equal(result.continuationState.graph.branchPath.length, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("validateShellPlan builds an action graph for agent plans", () => {
  const valid = validateShellPlan({
    kind: "plan",
    actions: [
      { type: "sync" },
      { type: "search", query: "router" }
    ]
  }, plannerContext);
  assert.equal(valid.kind, "plan");
  assert.deepEqual(valid.graph.nodes.map((node) => ({ type: node.type, dependsOn: node.dependsOn })), [
    { type: "sync", dependsOn: [] },
    { type: "search", dependsOn: ["n1"] },
    { type: "synthesize", dependsOn: ["n1", "n2"] }
  ]);
});

test("validateShellPlan accepts planner-supplied action graphs", () => {
  const valid = validateShellPlan({
    kind: "plan",
    graph: {
      nodes: [
        { id: "lookup", kind: "action", action: { type: "provider_status" } },
        { id: "route", kind: "action", dependsOn: ["lookup"], action: { type: "route", taskClass: "review" } }
      ]
    }
  }, plannerContext);
  assert.equal(valid.kind, "plan");
  assert.deepEqual(valid.actions, [
    { type: "provider_status" },
    { type: "route", taskClass: "review" }
  ]);
  assert.deepEqual(valid.graph.nodes.map((node) => ({ id: node.id, type: node.type, dependsOn: node.dependsOn })), [
    { id: "lookup", type: "provider_status", dependsOn: [] },
    { id: "route", type: "route", dependsOn: ["lookup"] },
    { id: "n3", type: "synthesize", dependsOn: ["lookup", "route"] }
  ]);
});

test("validateShellPlan accepts conditional graph nodes", () => {
  const valid = validateShellPlan({
    kind: "plan",
    graph: {
      nodes: [
        { id: "lookup", kind: "action", action: { type: "provider_status" } },
        {
          id: "gate",
          kind: "assert",
          dependsOn: ["lookup"],
          condition: { node: "lookup", path: "ok", equals: true },
          message: "provider lookup must succeed"
        },
        {
          id: "branch",
          kind: "branch",
          dependsOn: ["gate"],
          condition: { node: "lookup", path: "summary", includes: "AI providers:" },
          ifTrue: [{ type: "version" }],
          ifFalse: [{ type: "doctor" }]
        },
        {
          id: "replan",
          kind: "replan",
          dependsOn: ["branch"],
          condition: { node: "branch", path: "structuredPayload.branch", equals: "ifTrue" },
          append: [{ type: "provider_status" }]
        }
      ]
    }
  }, plannerContext);

  assert.equal(valid.kind, "plan");
  assert.deepEqual(valid.graph.nodes.map((node) => node.kind), [
    "action",
    "assert",
    "branch",
    "replan",
    "synthesize"
  ]);
});

test("heuristic continuation replies can reference prior graph state", () => {
  const plan = planShellRequestHeuristically("continue", plannerContext, {
    activeGraphState: {
      graph: {
        nodes: [
          { id: "n1", kind: "action", status: "ok", result: { summary: "Provider lookup complete." } }
        ],
        branchPath: [{ nodeId: "branch", branch: "ifTrue" }]
      }
    }
  });

  assert.equal(plan.kind, "reply");
  assert.match(plan.reply, /last graph has already been executed/i);
  assert.match(plan.reply, /Branch path: branch:ifTrue/);
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

test("compileShellAction renders execute_ticket as a mutating shell action", () => {
  const compiled = compileShellAction({
    type: "execute_ticket",
    ticketId: "REF-APP-SHELL-01",
    apply: true
  });

  assert.equal(compiled.mutation, true);
  assert.equal(compiled.display, "execute ticket REF-APP-SHELL-01");
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

test("chooseShellPlannerModel ignores planner overrides when the matrix prefers a different model", () => {
  const selected = chooseShellPlannerModel({
    plannerModel: "qwen2.5:14b",
    models: [
      { id: "qwen2.5:32b", quality: "high", sizeB: 32, fitScore: 10 },
      { id: "qwen2.5:14b", quality: "medium", sizeB: 14, fitScore: 12 },
      { id: "gemma4:9b", quality: "medium", sizeB: 9, fitScore: 94 }
    ]
  });
  assert.equal(selected.id, "gemma4:9b");
  assert.equal(selected.needsHardwareHint, true);
  assert.match(selected.reason, /matrix fit 94/);

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
