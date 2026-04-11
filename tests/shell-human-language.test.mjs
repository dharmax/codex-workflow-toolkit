import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { buildShellContext, planShellRequest, runShellTurn } from "../cli/lib/shell.mjs";
import { syncProject } from "../core/services/sync.mjs";
import { registerProvider } from "../core/services/providers.mjs";
import { runVerificationSummary } from "../runtime/scripts/ai-workflow/verification-summary.mjs";
import { SHELL_HUMAN_CORPUS } from "./fixtures/shell-human-corpus.mjs";
import { SHELL_CAPABILITY_CORPUS } from "./fixtures/shell-capability-corpus.mjs";
import { SHELL_QUALITY_BUG_CORPUS } from "./fixtures/shell-quality-corpus.mjs";

const BANNED_FALLBACK_RE = /needs the AI planner or a more direct phrasing/i;
const ORIGINAL_FETCH = globalThis.fetch;

async function stubDuckDuckGoOnly(url) {
  if (String(url).includes("duckduckgo")) {
    return {
      ok: true,
      async text() {
        return "<html><body></body></html>";
      }
    };
  }
  if (typeof ORIGINAL_FETCH === "function") {
    return ORIGINAL_FETCH(url);
  }
  throw new Error(`Unexpected fetch URL in shell capability test: ${url}`);
}

function makePlannerOptions(root, plannerContext) {
  return {
    root,
    noAi: true,
    plannerContext,
    planners: {
      planners: [],
      heuristic: {
        mode: "heuristic",
        reason: "test"
      }
    },
    history: [],
    json: false,
    shellMode: "plan"
  };
}

function renderVisibleShellText(result) {
  if (result.plan?.kind === "reply") {
    return String(result.plan.reply ?? "").trim();
  }
  if (result.assistantReply) {
    return String(result.assistantReply).trim();
  }
  return result.executed
    .map((item) => String(item.ok ? item.stdout : `${item.stdout}${item.stderr}`).trim())
    .filter(Boolean)
    .join("\n\n");
}

function withContinuationState(options) {
  return {
    ...options,
    activeGraphState: {
      request: "implement a safer fallback for shell planner replies that lose the user subject",
      active: false,
      intent: {
        capability: "coding",
        taskClass: "code-generation",
        subject: "shell planner replies",
        followUpMode: "continue-prior-work",
        references: {
          files: ["cli/lib/shell.mjs"],
          modules: ["cli/lib/shell"],
          graphNodeIds: ["n1", "n2", "n3"],
          evidence: ["cli/lib/shell search results"]
        }
      },
      lastReply: "Previous answer: inspect cli/lib/shell.mjs and keep the patch bounded.",
      focus: {
        taskClass: "code-generation",
        subject: "shell planner replies",
        searchQuery: "cli/lib/shell",
        statusQuery: null
      },
      references: {
        files: ["cli/lib/shell.mjs"],
        modules: ["cli/lib/shell"],
        graphNodeIds: ["n1", "n2", "n3"],
        evidence: ["cli/lib/shell search results"]
      },
      graph: {
        nodes: [
          { id: "n1", kind: "action", type: "route", status: "completed", result: { summary: "code-generation route selected" } },
          { id: "n2", kind: "action", type: "search", status: "completed", result: { summary: "cli/lib/shell search results" } },
          { id: "n3", kind: "synthesize", type: "synthesize", status: "completed", result: { summary: "reply emitted" } }
        ],
        branchPath: []
      },
      outcome: {
        planKind: "plan",
        failed: [],
        pending: []
      }
    }
  };
}

function withFailureState(options) {
  return {
    ...options,
    activeGraphState: {
      request: "inspect shell continuation failures and identify the risky step",
      active: false,
      intent: {
        capability: "debugging",
        taskClass: "bug-hunting",
        subject: "shell continuation failures",
        followUpMode: "continue-prior-work",
        references: {
          files: ["cli/lib/shell.mjs", "tests/shell.test.mjs"],
          modules: ["cli/lib/shell"],
          graphNodeIds: ["n1", "n2"],
          evidence: ["search step failed on shell continuation targets"]
        }
      },
      lastReply: "Previous answer: the search step failed while grounding shell continuation targets.",
      focus: {
        taskClass: "bug-hunting",
        subject: "shell continuation failures",
        searchQuery: "cli/lib/shell",
        statusQuery: null
      },
      references: {
        files: ["cli/lib/shell.mjs", "tests/shell.test.mjs"],
        modules: ["cli/lib/shell"],
        graphNodeIds: ["n1", "n2"],
        evidence: ["search step failed on shell continuation targets"]
      },
      graph: {
        nodes: [
          { id: "n1", kind: "action", type: "route", status: "completed", result: { summary: "bug-hunting route selected" } },
          { id: "n2", kind: "action", type: "search", status: "failed", result: { summary: "search step failed on shell continuation targets" } }
        ],
        branchPath: []
      },
      outcome: {
        planKind: "plan",
        failed: ["n2"],
        pending: []
      }
    }
  };
}

function withAnswerRevisionState(options) {
  return {
    ...options,
    activeGraphState: {
      request: "summarize the shell continuation work with exact file grounding",
      active: false,
      intent: {
        capability: "project-planning",
        taskClass: "summarization",
        subject: "shell continuation work",
        followUpMode: "continue-prior-work",
        references: {
          files: ["cli/lib/shell.mjs", "tests/shell-human-language.test.mjs"],
          modules: ["cli/lib/shell"],
          graphNodeIds: ["n1"],
          evidence: ["shell continuation work summary"]
        }
      },
      lastReply: "Shell continuation work currently centers on cli/lib/shell.mjs and tests/shell-human-language.test.mjs, with the next step being a smaller grounded fix.",
      focus: {
        taskClass: "summarization",
        subject: "shell continuation work",
        searchQuery: "cli/lib/shell",
        statusQuery: null
      },
      references: {
        files: ["cli/lib/shell.mjs", "tests/shell-human-language.test.mjs"],
        modules: ["cli/lib/shell"],
        graphNodeIds: ["n1"],
        evidence: ["shell continuation work summary"]
      },
      graph: {
        nodes: [
          { id: "n1", kind: "synthesize", type: "synthesize", status: "completed", result: { summary: "shell continuation work summary" } }
        ],
        branchPath: []
      },
      outcome: {
        planKind: "reply",
        failed: [],
        pending: []
      }
    }
  };
}

function withMutationSafetyState(options) {
  return {
    ...options,
    activeGraphState: {
      request: "prepare a bounded shell fix but do not mutate until the workflow gate is satisfied",
      active: false,
      intent: {
        capability: "coding",
        taskClass: "code-generation",
        subject: "bounded shell fix",
        followUpMode: "continue-prior-work",
        references: {
          files: ["cli/lib/shell.mjs"],
          modules: ["cli/lib/shell"],
          graphNodeIds: ["n1"],
          evidence: ["workflow gate still blocks mutation"]
        }
      },
      lastReply: "Previous answer: the bounded fix is identified, but the workflow gate still blocks auto-execution.",
      focus: {
        taskClass: "code-generation",
        subject: "bounded shell fix",
        searchQuery: "cli/lib/shell",
        statusQuery: null
      },
      references: {
        files: ["cli/lib/shell.mjs"],
        modules: ["cli/lib/shell"],
        graphNodeIds: ["n1"],
        evidence: ["workflow gate still blocks mutation"]
      },
      graph: {
        nodes: [
          { id: "n1", kind: "action", type: "route", status: "completed", result: { summary: "workflow gate still blocks mutation" } }
        ],
        branchPath: []
      },
      outcome: {
        planKind: "plan",
        failed: [],
        pending: []
      }
    }
  };
}

function applyStateFixture(baseOptions, stateFixture) {
  switch (stateFixture) {
    case "coding":
      return withContinuationState(baseOptions);
    case "failure":
      return withFailureState(baseOptions);
    case "answer":
      return withAnswerRevisionState(baseOptions);
    case "mutation":
      return withMutationSafetyState(baseOptions);
    default:
      return baseOptions;
  }
}

async function createShellHumanFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-workflow-shell-human-"));
  await mkdir(path.join(root, ".ai-workflow"), { recursive: true });
  await mkdir(path.join(root, "docs"), { recursive: true });
  await mkdir(path.join(root, "cli", "lib"), { recursive: true });
  await mkdir(path.join(root, "core", "services"), { recursive: true });
  await mkdir(path.join(root, "runtime", "scripts", "ai-workflow"), { recursive: true });
  await mkdir(path.join(root, "tests"), { recursive: true });

  await writeFile(path.join(root, ".ai-workflow", "config.json"), JSON.stringify({
    providers: {
      ollama: {
        enabled: false
      }
    }
  }, null, 2), "utf8");
  await writeFile(path.join(root, "package.json"), JSON.stringify({
    name: "shell-human-fixture",
    type: "module"
  }, null, 2), "utf8");
  await writeFile(path.join(root, "MISSION.md"), "Harden shell ergonomics and workflow confidence.\n", "utf8");
  await writeFile(path.join(root, "project-guidelines.md"), "- Treat shell output as operator-facing.\n", "utf8");
  await writeFile(path.join(root, "docs", "MANUAL.md"), [
    "# Manual",
    "",
    "- Use `ai-workflow shell` for planning.",
    "- Use `ai-workflow doctor` for diagnostics."
  ].join("\n"), "utf8");
  await writeFile(path.join(root, "cli", "lib", "shell.mjs"), "export const surface = 'shell';\n", "utf8");
  await writeFile(path.join(root, "core", "services", "projections.mjs"), [
    "export function buildProjectSummary() {",
    "  return { ok: true };",
    "}",
    "",
    "export function renderKanbanProjection() {",
    "  return '# Kanban';",
    "}"
  ].join("\n"), "utf8");
  await writeFile(path.join(root, "core", "services", "router.mjs"), "export function routeTask() { return 'router'; }\n", "utf8");
  await writeFile(path.join(root, "core", "services", "providers.mjs"), "export function discoverProviders() { return []; }\n", "utf8");
  await writeFile(path.join(root, "core", "services", "provider-routing.mjs"), "export function pickProviderRoute() { return 'providers'; }\n", "utf8");
  await writeFile(path.join(root, "core", "services", "sync.mjs"), "export function syncProjectState() { return true; }\n", "utf8");
  await writeFile(path.join(root, "runtime", "scripts", "ai-workflow", "sync.mjs"), "export const runtimeSync = true;\n", "utf8");
  await writeFile(path.join(root, "docs", "telegram-remote.md"), "# Telegram remote control\n", "utf8");
  await writeFile(path.join(root, "docs", "shell-fallback.md"), "# Shell fallback notes\n", "utf8");
  await mkdir(path.join(root, "src", "ui"), { recursive: true });
  await mkdir(path.join(root, "src", "ui", "dialog"), { recursive: true });
  await mkdir(path.join(root, "src", "theme"), { recursive: true });
  await writeFile(path.join(root, "src", "ui", "modal-overlay.tsx"), "export function ModalOverlay() { return null; }\n", "utf8");
  await writeFile(path.join(root, "src", "ui", "dialog", "escape-handler.ts"), "export function bindEscapeKey() { return true; }\n", "utf8");
  await writeFile(path.join(root, "src", "theme", "tokens.css"), ":root { --space-4: 16px; --shell-accent: #135; }\n", "utf8");
  await writeFile(path.join(root, "tests", "shell.fixture.test.mjs"), "export const fixture = true;\n", "utf8");
  await writeFile(path.join(root, "kanban.md"), [
    "# Kanban",
    "",
    "## ToDo",
    "- [ ] TKT-SHELL-NL-001 Enforce a mandatory structured intent envelope for every shell prompt",
    "  - Summary: Remove unstructured fallback behavior from shell planning.",
    "- [ ] TKT-SHELL-NL-002 Add multi-step execution graphs and final synthesis for paragraph requests",
    "  - Summary: Support long natural-language requests without leaking routing chatter.",
    "- [ ] TKT-SHELL-NL-003 Support coding-task paragraphs end to end through the shell",
    "  - Summary: Route implementation requests into grounded repo work.",
    "- [ ] TKT-SHELL-NL-004 Support debugging, review, and refactor paragraphs with grounded hotspots",
    "  - Summary: Preserve likely files and guardrails for risky work.",
    "- [ ] TKT-SHELL-NL-005 Support design and UI-direction requests in natural language",
    "  - Summary: Handle layout, styling, and visual-direction prompts credibly.",
    "- [ ] TKT-SHELL-NL-006 Adapt shell answer verbosity and format to user intent",
    "  - Summary: Match terse briefs, deep dives, and operator updates.",
    "- [ ] TKT-SHELL-NL-007 Strengthen conversational continuity and follow-up handling in shell sessions",
    "  - Summary: Preserve context across follow-up turns.",
    "- [ ] TKT-SHELL-NL-008 Expand AI-judged shell dogfood coverage across human-language corpora",
    "  - Summary: Keep growing transcript-based shell evaluation.",
    "",
    "## In Progress",
    "- [ ] REF-APP-SHELL-01 Continue shell surface hardening",
    "  - Summary: Keep shell answers grounded in workflow evidence.",
    "",
    "## Bugs P1",
    "- [ ] BUG-SHELL-INTELLIGENCE-01 Ground AI shell answers in retrieved repo evidence",
    "  - Summary: Remove generic fallback answers when evidence exists."
  ].join("\n"), "utf8");

  await syncProject({ projectRoot: root });
  return root;
}

test("human-like shell corpus avoids the generic planner apology and picks a sensible route", { concurrency: false }, async () => {
  const root = await createShellHumanFixture();

  try {
    const plannerContext = await buildShellContext(root);
    const options = makePlannerOptions(root, plannerContext);

    for (const item of SHELL_HUMAN_CORPUS) {
      const plan = await planShellRequest(item.prompt, options);
      const visible = plan.kind === "reply"
        ? String(plan.reply ?? "")
        : JSON.stringify(plan.actions ?? []);

      assert.doesNotMatch(visible, BANNED_FALLBACK_RE, `${item.id} should not surface the generic planner apology`);

      if (plan.kind === "plan") {
        assert.ok(plan.actions.length > 0, `${item.id} should produce at least one action`);
        if (item.acceptableActionTypes.length) {
          assert.equal(
            item.acceptableActionTypes.includes(plan.actions[0]?.type),
            true,
            `${item.id} should route to one of ${item.acceptableActionTypes.join(", ")} but got ${plan.actions[0]?.type}`
          );
        }
      } else {
        assert.match(String(plan.reply ?? ""), item.replyPattern, `${item.id} should return a grounded reply`);
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("shell ignores a planner reply that regresses to the generic apology and recovers into a grounded answer", { concurrency: false }, async () => {
  const root = await createShellHumanFixture();
  const providerId = `mock-shell-generic-fallback-${Date.now()}`;

  try {
    const plannerContext = await buildShellContext(root);
    registerProvider(providerId, {
      generate: async () => ({
        response: JSON.stringify({
          kind: "reply",
          confidence: 0.91,
          reason: "bad regression",
          reply: "I can turn requests into workflow actions, but this one needs the AI planner or a more direct phrasing."
        })
      })
    });

    const plan = await planShellRequest("how good is the shell?", {
      root,
      plannerContext,
      planners: {
        planners: [{ providerId, modelId: "brain-v1" }],
        heuristic: {
          mode: "heuristic",
          reason: "test"
        }
      },
      history: [],
      noAi: false,
      json: false,
      shellMode: "plan"
    });

    assert.equal(plan.kind, "reply");
    assert.doesNotMatch(String(plan.reply ?? ""), BANNED_FALLBACK_RE);
    assert.match(String(plan.reply ?? ""), /shell work|Not finished|Next step:/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("representative human shell prompts produce grounded user-facing answers", { concurrency: false }, async () => {
  const root = await createShellHumanFixture();

  try {
    const plannerContext = await buildShellContext(root);
    const options = makePlannerOptions(root, plannerContext);
    const representativeCases = SHELL_HUMAN_CORPUS.filter((item) => [
      "BUG-SHELL-HUMAN-004",
      "BUG-SHELL-HUMAN-009",
      "BUG-SHELL-HUMAN-016",
      "BUG-SHELL-HUMAN-020",
      "BUG-SHELL-HUMAN-023",
      "BUG-SHELL-HUMAN-028",
      "BUG-SHELL-HUMAN-030",
      "BUG-SHELL-HUMAN-032"
    ].includes(item.id));

    for (const item of representativeCases) {
      const result = await runShellTurn(item.prompt, options);
      const visible = renderVisibleShellText(result);

      assert.ok(visible.length > 0, `${item.id} should produce user-facing text`);
      assert.doesNotMatch(visible, BANNED_FALLBACK_RE, `${item.id} should not use the generic planner apology`);
      assert.match(visible, item.replyPattern, `${item.id} should mention the expected subject in the final answer`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verification summary can AI-judge shell transcripts from representative human prompts", { concurrency: false }, async () => {
  const root = await createShellHumanFixture();
  const providerId = `mock-shell-judge-${Date.now()}`;

  try {
    const plannerContext = await buildShellContext(root);
    const options = makePlannerOptions(root, plannerContext);
    await mkdir(path.join(root, "artifacts"), { recursive: true });

    const transcriptCases = SHELL_HUMAN_CORPUS.filter((item) => [
      "BUG-SHELL-HUMAN-004",
      "BUG-SHELL-HUMAN-009",
      "BUG-SHELL-HUMAN-028"
    ].includes(item.id));

    const transcriptPaths = [];
    for (const item of transcriptCases) {
      const result = await runShellTurn(item.prompt, options);
      const visible = renderVisibleShellText(result);
      const transcriptPath = path.join(root, "artifacts", `${item.id}.txt`);
      await writeFile(transcriptPath, [
        `Prompt: ${item.prompt}`,
        "",
        visible
      ].join("\n"), "utf8");
      transcriptPaths.push(transcriptPath);
    }

    registerProvider(providerId, {
      generate: async ({ modelId, prompt, contentParts }) => {
        assert.equal(modelId, "judge-v1");
        assert.match(prompt, /Judge the supplied shell transcripts/);
        const combined = (contentParts ?? [])
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
        assert.match(combined, /shell/i);
        assert.match(combined, /projections/i);
        assert.doesNotMatch(combined, BANNED_FALLBACK_RE);

        return {
          providerId,
          modelId,
          response: JSON.stringify({
            status: "pass",
            score: 95,
            confidence: 0.98,
            summary: "The shell transcripts answer directly, stay grounded, and avoid the generic planner fallback.",
            findings: ["Direct answers present", "Relevant subjects preserved", "No generic planner apology"],
            recommendations: [],
            dimensions: {
              intentCorrectness: { score: 96, status: "pass", reason: "The transcripts answer the intended request." },
              capabilityFit: { score: 95, status: "pass", reason: "The shell chooses a credible work mode." },
              grounding: { score: 95, status: "pass", reason: "Grounded in project evidence." },
              subjectPreservation: { score: 96, status: "pass", reason: "The original subject is preserved." },
              executionQuality: { score: 93, status: "pass", reason: "Execution is appropriately bounded." },
              synthesisQuality: { score: 95, status: "pass", reason: "The final answer is operator-friendly." },
              verbosityMatch: { score: 94, status: "pass", reason: "The response density matches the request." },
              codexAcceptance: { score: 95, status: "pass", reason: "A demanding Codex user would accept this." }
            },
            artifacts: transcriptPaths.map((artifactPath) => ({
              path: path.relative(root, artifactPath),
              status: "pass",
              score: 95,
              findings: ["Transcript remained grounded and direct"]
            })),
            needs_human_review: false
          })
        };
      }
    });

    const summary = await runVerificationSummary([
      "--root",
      root,
      "--artifact",
      path.relative(root, transcriptPaths[0]),
      "--artifact",
      path.relative(root, transcriptPaths[1]),
      "--artifact",
      path.relative(root, transcriptPaths[2]),
      "--judge",
      "shell-transcript",
      "--rubric",
      "Each shell transcript must answer the user's question directly, remain grounded in project/workflow evidence, preserve the subject of the question, and avoid saying that the request needs the AI planner or a more direct phrasing.",
      "--provider",
      providerId,
      "--model",
      "judge-v1",
      "--json"
    ]);

    assert.equal(summary.conclusion, "verified");
    assert.equal(summary.artifactJudgment.result.status, "pass");
    assert.equal(summary.artifactJudgment.result.dimensions.codexAcceptance.status, "pass");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("paragraph-style shell capability corpus routes complex prompts to concrete work classes", { concurrency: false }, async () => {
  const root = await createShellHumanFixture();
  globalThis.fetch = stubDuckDuckGoOnly;

  try {
    const plannerContext = await buildShellContext(root);
    const options = makePlannerOptions(root, plannerContext);

    for (const item of SHELL_CAPABILITY_CORPUS) {
      const plan = await planShellRequest(item.prompt, options);
      const visible = plan.kind === "reply"
        ? String(plan.reply ?? "")
        : JSON.stringify(plan.actions ?? []);

      assert.doesNotMatch(visible, BANNED_FALLBACK_RE, `${item.id} should not surface the generic planner apology`);
      assert.ok(["plan", "reply"].includes(plan.kind), `${item.id} should stay actionable`);
      if (plan.kind === "plan") {
        assert.equal(item.acceptableActionTypes.includes(plan.actions[0]?.type), true, `${item.id} should route through ${item.acceptableActionTypes.join(", ")}`);
        assert.equal(plan.actions[0]?.taskClass, item.expectedTaskClass, `${item.id} should infer ${item.expectedTaskClass}`);
      } else {
        assert.equal(plan.intent?.taskClass, item.expectedTaskClass, `${item.id} should preserve ${item.expectedTaskClass} even in a direct reply`);
      }
    }
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
    await rm(root, { recursive: true, force: true });
  }
});

test("paragraph-style shell capability prompts produce operator-friendly answers", { concurrency: false }, async () => {
  const root = await createShellHumanFixture();
  globalThis.fetch = stubDuckDuckGoOnly;

  try {
    const plannerContext = await buildShellContext(root);
    const options = makePlannerOptions(root, plannerContext);
    const representativeCases = SHELL_CAPABILITY_CORPUS.filter((item) => [
      "BUG-SHELL-HUMAN-033",
      "BUG-SHELL-HUMAN-035",
      "BUG-SHELL-HUMAN-036",
      "BUG-SHELL-HUMAN-040",
      "BUG-SHELL-HUMAN-042",
      "BUG-SHELL-HUMAN-048"
    ].includes(item.id));

    for (const item of representativeCases) {
      const result = await runShellTurn(item.prompt, options);
      const visible = renderVisibleShellText(result);

      assert.ok(visible.length > 0, `${item.id} should produce user-facing text`);
      assert.doesNotMatch(visible, BANNED_FALLBACK_RE, `${item.id} should not use the generic planner apology`);
      assert.match(visible, item.replyPattern, `${item.id} should preserve the task subject in the final answer`);
      assert.match(visible, /Best-fit route|I’d treat this as/i, `${item.id} should explain the shell's chosen work mode`);
    }
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
    await rm(root, { recursive: true, force: true });
  }
});

test("batch-1 shell quality bugs stay fixed across planning and answer synthesis", { concurrency: false }, async () => {
  const root = await createShellHumanFixture();
  globalThis.fetch = stubDuckDuckGoOnly;

  try {
    const plannerContext = await buildShellContext(root);
    const baseOptions = makePlannerOptions(root, plannerContext);
    const batchOneCases = SHELL_QUALITY_BUG_CORPUS.filter((item) => item.batch === 1);

    for (const item of batchOneCases) {
      const options = item.stateFixture ? applyStateFixture(baseOptions, item.stateFixture) : (item.usesContinuationState ? withContinuationState(baseOptions) : baseOptions);
      const plan = await planShellRequest(item.prompt, options);
      const result = await runShellTurn(item.prompt, options);
      const visible = renderVisibleShellText(result);

      assert.equal(plan.kind, item.expectedKind, `${item.id} should produce ${item.expectedKind}`);
      assert.equal(plan.intent?.capability, item.expectedCapability, `${item.id} should infer ${item.expectedCapability}`);
      if (item.expectedTaskClass) {
        assert.equal(plan.intent?.taskClass, item.expectedTaskClass, `${item.id} should infer ${item.expectedTaskClass}`);
      }
      if (item.expectedFollowUpMode) {
        assert.equal(plan.intent?.followUpMode, item.expectedFollowUpMode, `${item.id} should preserve ${item.expectedFollowUpMode}`);
      }
      assert.doesNotMatch(visible, BANNED_FALLBACK_RE, `${item.id} should not regress to the planner apology`);
      assert.match(visible, item.replyPattern, `${item.id} should render the expected answer shape`);
      if (item.expectsBullets) {
        assert.match(visible, /^Current shell work:\n- /m, `${item.id} should honor bullet formatting`);
      }
      if (item.expectsAbsolutePaths) {
        assert.match(visible, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${item.id} should include absolute file paths`);
      }
    }
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
    await rm(root, { recursive: true, force: true });
  }
});

test("batch-2 shell quality bugs stay fixed across planning and answer synthesis", { concurrency: false }, async () => {
  const root = await createShellHumanFixture();
  globalThis.fetch = stubDuckDuckGoOnly;

  try {
    const plannerContext = await buildShellContext(root);
    const baseOptions = makePlannerOptions(root, plannerContext);
    const batchTwoCases = SHELL_QUALITY_BUG_CORPUS.filter((item) => item.batch === 2);

    for (const item of batchTwoCases) {
      const options = item.stateFixture ? applyStateFixture(baseOptions, item.stateFixture) : baseOptions;
      const plan = await planShellRequest(item.prompt, options);
      const result = await runShellTurn(item.prompt, options);
      const visible = renderVisibleShellText(result);

      assert.equal(plan.kind, item.expectedKind, `${item.id} should produce ${item.expectedKind}`);
      assert.equal(plan.intent?.capability, item.expectedCapability, `${item.id} should infer ${item.expectedCapability}`);
      if (item.expectedTaskClass) {
        assert.equal(plan.intent?.taskClass, item.expectedTaskClass, `${item.id} should infer ${item.expectedTaskClass}`);
      }
      assert.doesNotMatch(visible, BANNED_FALLBACK_RE, `${item.id} should not regress to the planner apology`);
      assert.match(visible, item.replyPattern, `${item.id} should render the expected answer shape`);
      if (item.expectsAbsolutePaths) {
        assert.match(visible, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${item.id} should include absolute file paths`);
      }
      if (item.expectsSingleSentence) {
        assert.equal(visible.split(/[.!?]+/).filter((part) => part.trim()).length, 1, `${item.id} should stay within one sentence`);
      }
    }
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
    await rm(root, { recursive: true, force: true });
  }
});

test("batch-3 shell semantic continuation bugs stay fixed across planning and answer synthesis", { concurrency: false }, async () => {
  const root = await createShellHumanFixture();
  globalThis.fetch = stubDuckDuckGoOnly;

  try {
    const plannerContext = await buildShellContext(root);
    const baseOptions = makePlannerOptions(root, plannerContext);
    const batchThreeCases = SHELL_QUALITY_BUG_CORPUS.filter((item) => item.batch === 3);

    for (const item of batchThreeCases) {
      const options = applyStateFixture(baseOptions, item.stateFixture);
      const plan = await planShellRequest(item.prompt, options);
      const result = await runShellTurn(item.prompt, options);
      const visible = renderVisibleShellText(result);

      assert.equal(plan.kind, item.expectedKind, `${item.id} should produce ${item.expectedKind}`);
      assert.equal(plan.intent?.capability, item.expectedCapability, `${item.id} should infer ${item.expectedCapability}`);
      if (item.expectedTaskClass) {
        assert.equal(plan.intent?.taskClass, item.expectedTaskClass, `${item.id} should infer ${item.expectedTaskClass}`);
      }
      if (item.expectedFollowUpMode) {
        assert.equal(plan.intent?.followUpMode, item.expectedFollowUpMode, `${item.id} should preserve ${item.expectedFollowUpMode}`);
      }
      assert.doesNotMatch(visible, BANNED_FALLBACK_RE, `${item.id} should not regress to the planner apology`);
      assert.match(visible, item.replyPattern, `${item.id} should render the expected answer shape`);
      if (item.expectsBullets) {
        assert.match(visible, /^Current continuation state:\n- /m, `${item.id} should honor bullet formatting`);
      }
      if (item.expectsAbsolutePaths) {
        assert.match(visible, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${item.id} should include absolute file paths`);
      }
      if (item.expectsSingleSentence) {
        assert.equal(visible.split(/[.!?]+/).filter((part) => part.trim()).length, 1, `${item.id} should stay within one sentence`);
      }
    }
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
    await rm(root, { recursive: true, force: true });
  }
});

test("verification summary can AI-judge shell quality bug transcripts", { concurrency: false }, async () => {
  const root = await createShellHumanFixture();
  const providerId = `mock-shell-quality-judge-${Date.now()}`;
  globalThis.fetch = stubDuckDuckGoOnly;

  try {
    const plannerContext = await buildShellContext(root);
    const baseOptions = makePlannerOptions(root, plannerContext);
    await mkdir(path.join(root, "artifacts"), { recursive: true });

    const transcriptCases = SHELL_QUALITY_BUG_CORPUS.filter((item) => [
      "BUG-SHELL-HUMAN-049",
      "BUG-SHELL-HUMAN-050",
      "BUG-SHELL-HUMAN-060"
    ].includes(item.id));

    const transcriptPaths = [];
    for (const item of transcriptCases) {
      const result = await runShellTurn(item.prompt, baseOptions);
      const visible = renderVisibleShellText(result);
      const transcriptPath = path.join(root, "artifacts", `${item.id}.txt`);
      await writeFile(transcriptPath, [
        `Prompt: ${item.prompt}`,
        "",
        visible
      ].join("\n"), "utf8");
      transcriptPaths.push(transcriptPath);
    }

    registerProvider(providerId, {
      generate: async ({ modelId, prompt, contentParts }) => {
        assert.equal(modelId, "judge-v1");
        assert.match(prompt, /Judge the supplied shell transcripts/);
        const combined = (contentParts ?? [])
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
        assert.match(combined, /Parity plan|Top 3 risks/i);
        assert.doesNotMatch(combined, BANNED_FALLBACK_RE);

        return {
          providerId,
          modelId,
          response: JSON.stringify({
            status: "pass",
            score: 95,
            confidence: 0.98,
            summary: "The shell quality bug transcripts stay grounded, preserve the operator ask, and produce usable synthesized answers.",
            findings: ["Direct synthesized answers", "Grounded file targets", "No generic planner apology"],
            recommendations: [],
            dimensions: {
              intentCorrectness: { score: 96, status: "pass", reason: "The shell preserves the operator goal." },
              capabilityFit: { score: 95, status: "pass", reason: "The work mode matches the prompt." },
              grounding: { score: 95, status: "pass", reason: "Evidence remains repo-grounded." },
              subjectPreservation: { score: 96, status: "pass", reason: "The task subject stays intact." },
              executionQuality: { score: 94, status: "pass", reason: "The shell chooses bounded steps." },
              synthesisQuality: { score: 95, status: "pass", reason: "The answers are useful and direct." },
              verbosityMatch: { score: 94, status: "pass", reason: "The response density matches the request." },
              codexAcceptance: { score: 95, status: "pass", reason: "A demanding Codex user would accept this." }
            },
            artifacts: transcriptPaths.map((artifactPath) => ({
              path: path.relative(root, artifactPath),
              status: "pass",
              score: 95,
              findings: ["Transcript stayed operator-facing and grounded"]
            })),
            needs_human_review: false
          })
        };
      }
    });

    const summary = await runVerificationSummary([
      "--root",
      root,
      "--artifact",
      path.relative(root, transcriptPaths[0]),
      "--artifact",
      path.relative(root, transcriptPaths[1]),
      "--artifact",
      path.relative(root, transcriptPaths[2]),
      "--judge",
      "shell-transcript",
      "--rubric",
      "Each shell transcript must preserve the operator goal, choose a credible work mode, stay grounded in repo evidence, and synthesize a direct answer without planner-apology fallback.",
      "--provider",
      providerId,
      "--model",
      "judge-v1",
      "--json"
    ]);

    assert.equal(summary.conclusion, "verified");
    assert.equal(summary.artifactJudgment.result.status, "pass");
    assert.equal(summary.artifactJudgment.result.dimensions.synthesisQuality.status, "pass");
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
    await rm(root, { recursive: true, force: true });
  }
});

test("verification summary can AI-judge semantic shell continuation bug transcripts", { concurrency: false }, async () => {
  const root = await createShellHumanFixture();
  const providerId = `mock-shell-semantic-continuation-${Date.now()}`;
  globalThis.fetch = stubDuckDuckGoOnly;

  try {
    const plannerContext = await buildShellContext(root);
    const baseOptions = makePlannerOptions(root, plannerContext);
    await mkdir(path.join(root, "artifacts"), { recursive: true });

    const transcriptCases = SHELL_QUALITY_BUG_CORPUS.filter((item) => [
      "BUG-SHELL-HUMAN-066",
      "BUG-SHELL-HUMAN-067",
      "BUG-SHELL-HUMAN-069"
    ].includes(item.id));

    const transcriptPaths = [];
    for (const item of transcriptCases) {
      const options = applyStateFixture(baseOptions, item.stateFixture);
      const result = await runShellTurn(item.prompt, options);
      const visible = renderVisibleShellText(result);
      const transcriptPath = path.join(root, "artifacts", `${item.id}.txt`);
      await writeFile(transcriptPath, [`Prompt: ${item.prompt}`, "", visible].join("\n"), "utf8");
      transcriptPaths.push(transcriptPath);
    }

    registerProvider(providerId, {
      generate: async ({ modelId, prompt, contentParts }) => {
        assert.equal(modelId, "judge-v1");
        assert.match(prompt, /Judge the supplied shell transcripts/);
        const combined = (contentParts ?? [])
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
        assert.match(combined, /surgical|failed|absolute paths/i);
        assert.doesNotMatch(combined, BANNED_FALLBACK_RE);

        return {
          providerId,
          modelId,
          response: JSON.stringify({
            status: "pass",
            score: 95,
            confidence: 0.98,
            summary: "The semantic continuation transcripts preserve prior context without relying on stock continuation phrases.",
            findings: ["Prior-state carry-forward", "Result questions stay grounded", "Answer revisions preserve requested format"],
            recommendations: [],
            dimensions: {
              intentCorrectness: { score: 96, status: "pass", reason: "Follow-up intent is preserved semantically." },
              capabilityFit: { score: 95, status: "pass", reason: "The shell keeps the right work mode." },
              grounding: { score: 95, status: "pass", reason: "Replies stay grounded in prior files and results." },
              subjectPreservation: { score: 96, status: "pass", reason: "The prior subject remains intact." },
              executionQuality: { score: 94, status: "pass", reason: "Continuation steps stay bounded and truthful." },
              synthesisQuality: { score: 95, status: "pass", reason: "The answers are direct and useful." },
              verbosityMatch: { score: 94, status: "pass", reason: "The format follows the request." },
              codexAcceptance: { score: 95, status: "pass", reason: "The shell acts like an extension, not a downgrade." }
            },
            artifacts: transcriptPaths.map((artifactPath) => ({
              path: path.relative(root, artifactPath),
              status: "pass",
              score: 95,
              findings: ["Transcript preserved semantic continuation"]
            })),
            needs_human_review: false
          })
        };
      }
    });

    const summary = await runVerificationSummary([
      "--root",
      root,
      "--artifact",
      path.relative(root, transcriptPaths[0]),
      "--artifact",
      path.relative(root, transcriptPaths[1]),
      "--artifact",
      path.relative(root, transcriptPaths[2]),
      "--judge",
      "shell-transcript",
      "--rubric",
      "Each shell transcript must preserve prior turn context semantically, stay grounded in prior files or results, and avoid stock continuation trigger dependence.",
      "--provider",
      providerId,
      "--model",
      "judge-v1",
      "--json"
    ]);

    assert.equal(summary.conclusion, "verified");
    assert.equal(summary.artifactJudgment.result.status, "pass");
    assert.equal(summary.artifactJudgment.result.dimensions.intentCorrectness.status, "pass");
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
    await rm(root, { recursive: true, force: true });
  }
});

test("verification summary can AI-judge paragraph-style shell capability transcripts", { concurrency: false }, async () => {
  const root = await createShellHumanFixture();
  const providerId = `mock-shell-capability-judge-${Date.now()}`;
  globalThis.fetch = stubDuckDuckGoOnly;

  try {
    const plannerContext = await buildShellContext(root);
    const options = makePlannerOptions(root, plannerContext);
    await mkdir(path.join(root, "artifacts"), { recursive: true });

    const transcriptCases = SHELL_CAPABILITY_CORPUS.filter((item) => [
      "BUG-SHELL-HUMAN-033",
      "BUG-SHELL-HUMAN-036",
      "BUG-SHELL-HUMAN-042"
    ].includes(item.id));

    const transcriptPaths = [];
    for (const item of transcriptCases) {
      const result = await runShellTurn(item.prompt, options);
      const visible = renderVisibleShellText(result);
      const transcriptPath = path.join(root, "artifacts", `${item.id}.txt`);
      await writeFile(transcriptPath, [
        `Prompt: ${item.prompt}`,
        "",
        visible
      ].join("\n"), "utf8");
      transcriptPaths.push(transcriptPath);
    }

    registerProvider(providerId, {
      generate: async ({ modelId, prompt, contentParts }) => {
        assert.equal(modelId, "judge-v1");
        assert.match(prompt, /Judge the supplied shell transcripts/);
        const combined = (contentParts ?? [])
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
        assert.match(combined, /modal|telegram|tokens/i);
        assert.doesNotMatch(combined, BANNED_FALLBACK_RE);

        return {
          providerId,
          modelId,
          response: JSON.stringify({
            status: "pass",
            score: 94,
            confidence: 0.97,
            summary: "The shell transcripts classify the work, stay grounded in repo evidence, and answer the long-form operator request directly.",
            findings: ["Task class preserved", "Repo targets surfaced", "No generic planner apology"],
            recommendations: [],
            dimensions: {
              intentCorrectness: { score: 95, status: "pass", reason: "The shell captures the user’s intent." },
              capabilityFit: { score: 95, status: "pass", reason: "The work mode is credible." },
              grounding: { score: 94, status: "pass", reason: "Repo evidence is preserved." },
              subjectPreservation: { score: 95, status: "pass", reason: "The paragraph subject is preserved." },
              executionQuality: { score: 92, status: "pass", reason: "The shell chooses appropriate steps." },
              synthesisQuality: { score: 94, status: "pass", reason: "The final answer is useful." },
              verbosityMatch: { score: 93, status: "pass", reason: "The response density is appropriate." },
              codexAcceptance: { score: 94, status: "pass", reason: "This would satisfy a demanding operator." }
            },
            artifacts: transcriptPaths.map((artifactPath) => ({
              path: path.relative(root, artifactPath),
              status: "pass",
              score: 94,
              findings: ["Transcript stayed grounded and task-oriented"]
            })),
            needs_human_review: false
          })
        };
      }
    });

    const summary = await runVerificationSummary([
      "--root",
      root,
      "--artifact",
      path.relative(root, transcriptPaths[0]),
      "--artifact",
      path.relative(root, transcriptPaths[1]),
      "--artifact",
      path.relative(root, transcriptPaths[2]),
      "--judge",
      "shell-transcript",
      "--rubric",
      "Each shell transcript must classify the operator request into a credible work mode, stay grounded in repo/project evidence, preserve the subject of the paragraph, and avoid saying that the request needs the AI planner or a more direct phrasing.",
      "--provider",
      providerId,
      "--model",
      "judge-v1",
      "--json"
    ]);

    assert.equal(summary.conclusion, "verified");
    assert.equal(summary.artifactJudgment.result.status, "pass");
    assert.equal(summary.artifactJudgment.result.dimensions.capabilityFit.status, "pass");
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
    await rm(root, { recursive: true, force: true });
  }
});
