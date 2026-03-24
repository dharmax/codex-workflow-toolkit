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
