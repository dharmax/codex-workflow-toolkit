import test from "node:test";
import assert from "node:assert/strict";
import { parseIndexedFile } from "../core/parsers/index.mjs";

test("JS-family parser indexes imports, symbols, calls, and tagged notes without matching string literals", () => {
  const parsed = parseIndexedFile({
    filePath: "src/app.ts",
    content: [
      "import { value } from './dep.js';",
      "const text = 'TODO: should not count';",
      "// TODO: actual work item",
      "export function runApp() { return value(); }"
    ].join("\n")
  });

  assert.equal(parsed.language, "ts");
  assert.equal(parsed.symbols.some((item) => item.name === "runApp"), true);
  assert.equal(parsed.facts.some((item) => item.predicate === "imports" && item.objectText === "./dep.js"), true);
  assert.equal(parsed.notes.length, 1);
  assert.equal(parsed.notes[0].body, "actual work item");
});

test("JS-family parser captures interfaces, types, enums, and variables with locations", () => {
  const parsed = parseIndexedFile({
    filePath: "src/types.ts",
    content: [
      "export interface CombatUiState { ready: boolean }",
      "export type CombatAction = 'attack' | 'talk'",
      "export enum CombatStatus { Idle = 'idle' }",
      "export const DEFAULT_ROUND = 1"
    ].join("\n")
  });

  assert.equal(parsed.symbols.some((item) => item.name === "CombatUiState" && item.kind === "interface" && item.line === 1), true);
  assert.equal(parsed.symbols.some((item) => item.name === "CombatAction" && item.kind === "type" && item.line === 2), true);
  assert.equal(parsed.symbols.some((item) => item.name === "CombatStatus" && item.kind === "enum" && item.line === 3), true);
  assert.equal(parsed.symbols.some((item) => item.name === "DEFAULT_ROUND" && item.kind === "variable" && item.line === 4), true);
});

test("tagged note parsing does not treat incidental prose as a note", () => {
  const parsed = parseIndexedFile({
    filePath: "src/app.ts",
    content: [
      "// This bug fix should stay stable after refactor",
      "// TODO: actual tagged note"
    ].join("\n")
  });

  assert.equal(parsed.notes.length, 1);
  assert.equal(parsed.notes[0].body, "actual tagged note");
});

test("markdown parser only promotes explicit engineering markers to notes", () => {
  const parsed = parseIndexedFile({
    filePath: "docs/kanban.md",
    content: [
      "# Planning",
      "",
      "- **UI-123**: Add combat vignette transitions.",
      "BUG: actual tagged markdown note",
      "- [ ] TODO ship settings migration",
      "This bug write-up should stay prose, not a note."
    ].join("\n")
  });

  assert.equal(parsed.notes.length, 2);
  assert.deepEqual(parsed.notes.map((item) => item.body), [
    "actual tagged markdown note",
    "TODO ship settings migration"
  ]);
});

test("Riot parser merges script, style, and template indexing", () => {
  const parsed = parseIndexedFile({
    filePath: "src/ui/panel.riot",
    content: [
      "<panel>",
      "  <div class=\"shell\">ok</div>",
      "  <script>export function paint() { return 1 }</script>",
      "  <style>.shell { color: red; }</style>",
      "</panel>"
    ].join("\n")
  });

  assert.equal(parsed.language, "riot");
  assert.equal(parsed.symbols.some((item) => item.name === "paint"), true);
  assert.equal(parsed.symbols.some((item) => item.name === ".shell"), true);
});

test("data and markup parsers index keys and selectors", () => {
  const jsonParsed = parseIndexedFile({
    filePath: "config/view.json",
    content: JSON.stringify({ theme: "paper", enabled: true })
  });
  assert.equal(jsonParsed.symbols.some((item) => item.name === "theme"), true);

  const yamlParsed = parseIndexedFile({
    filePath: "config/settings.yaml",
    content: "workflow:\n  lane: Todo\n# NOTE: yaml comments should be indexed\n"
  });
  assert.equal(yamlParsed.symbols.some((item) => item.name === "workflow"), true);
  assert.equal(yamlParsed.notes.length, 1);

  const htmlParsed = parseIndexedFile({
    filePath: "index.html",
    content: "<div id=\"app\" class=\"shell main\"></div>"
  });
  assert.equal(htmlParsed.symbols.some((item) => item.name === "#app"), true);
  assert.equal(htmlParsed.symbols.some((item) => item.name === ".shell"), true);
});
