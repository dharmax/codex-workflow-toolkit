import assert from "node:assert/strict";
import test from "node:test";
import { compactGuidanceItems, summarizeGuidance } from "../runtime/scripts/ai-workflow/lib/guidance-utils.mjs";

test("summarizeGuidance skips placeholder scaffolding lines", () => {
  const markdown = `# Project Guidelines

## Architecture

- Runtime:
- State and data boundaries:
- Keep deterministic state mutation deterministic.
`;

  const summary = summarizeGuidance(markdown, [], { alwaysIncludeTop: true, limit: 4, fallbackLimit: 4 });
  assert.equal(summary.includes("Runtime:"), false);
  assert.equal(summary.includes("State and data boundaries:"), false);
  assert.equal(summary.includes("Keep deterministic state mutation deterministic."), true);
});

test("compactGuidanceItems deduplicates normalized guidance text", () => {
  const items = [
    "Use `ai-workflow` first for project status.",
    "Use ai-workflow first for project status",
    "Prefer the cheapest capable model route."
  ];

  const compact = compactGuidanceItems(items);
  assert.deepEqual(compact, [
    "Use `ai-workflow` first for project status.",
    "Prefer the cheapest capable model route."
  ]);
});

test("summarizeGuidance skips standalone file-reference bullets", () => {
  const markdown = `# Knowledge

## Load Order

1. \`kanban.md\`
2. \`execution-protocol.md\`

## Durable Lessons

- Prefer one coherent burst over many tiny unrelated edits.
`;

  const summary = summarizeGuidance(markdown, [], { alwaysIncludeTop: true, limit: 4, fallbackLimit: 4 });
  assert.equal(summary.includes("`kanban.md`"), false);
  assert.equal(summary.includes("`execution-protocol.md`"), false);
  assert.equal(summary.includes("Prefer one coherent burst over many tiny unrelated edits."), true);
});
