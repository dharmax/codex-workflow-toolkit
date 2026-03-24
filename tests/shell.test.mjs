import test from "node:test";
import assert from "node:assert/strict";
import { chooseShellPlannerModel, compileShellAction, planShellRequestHeuristically, validateShellPlan } from "../cli/lib/shell.mjs";

const plannerContext = {
  toolkitCodelets: [
    { id: "review", summary: "Review changed files." },
    { id: "audit", summary: "Run workflow audit." }
  ],
  projectCodelets: [
    { id: "custom-check", summary: "Project-local check." }
  ],
  summary: {
    fileCount: 10,
    activeTickets: [{ id: "TKT-001", title: "Example" }]
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
