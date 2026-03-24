import assert from "node:assert";
import { test } from "node:test";
import { parsePatch, applyPatch } from "../core/lib/patch.mjs";

test("parsePatch extracts blocks correctly", () => {
  const text = `
Here is a change:
<<<< SEARCH
old logic
====
new logic
>>>>
And another:
<<<< SEARCH
other stuff
====
better stuff
>>>>
`;
  const blocks = parsePatch(text);
  assert.strictEqual(blocks.length, 2);
  assert.strictEqual(blocks[0].search, "old logic");
  assert.strictEqual(blocks[0].replace, "new logic");
});

test("applyPatch handles exact match", () => {
  const content = "const x = 1;\nconst y = 2;";
  const blocks = [{ search: "const x = 1;", replace: "const x = 100;" }];
  const result = applyPatch(content, blocks);
  assert.strictEqual(result.content, "const x = 100;\nconst y = 2;");
  assert.strictEqual(result.allApplied, true);
});

test("applyPatch handles fuzzy whitespace match", () => {
  const content = "function foo()  {\n  return true\n}";
  const blocks = [{ search: "function foo() {\n return true\n}", replace: "function bar() { return false }" }];
  const result = applyPatch(content, blocks);
  assert.strictEqual(result.content, "function bar() { return false }");
  assert.strictEqual(result.summary[0].method, "fuzzy");
});

test("applyPatch reports failure for missing block", () => {
  const content = "nothing matches";
  const blocks = [{ search: "missing", replace: "data" }];
  const result = applyPatch(content, blocks);
  assert.strictEqual(result.allApplied, false);
  assert.strictEqual(result.summary[0].ok, false);
});
