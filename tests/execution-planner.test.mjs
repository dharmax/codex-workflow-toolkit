import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { buildTicketExecutionPlan } from "../core/services/execution-planner.mjs";

test("execution planner prefers targeted playwright commands when exact test files are known", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "execution-plan-"));

  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      name: "execution-plan-test",
      packageManager: "pnpm@10.0.0",
      scripts: {
        "test:e2e": "playwright test -c playwright.config.ts",
        "test:unit": "playwright test -c playwright.unit.config.ts",
        build: "vite build"
      }
    }, null, 2), "utf8");
    await writeFile(path.join(root, "playwright.config.ts"), "export default {};\n", "utf8");
    await writeFile(path.join(root, "playwright.unit.config.ts"), "export default {};\n", "utf8");
    await mkdir(path.join(root, "tests", "modal-smoke"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(path.join(root, "tests", "modal-smoke", "e2e.spec.ts"), "test('e2e', () => {})\n", "utf8");
    await writeFile(path.join(root, "tests", "forge-hardening.unit.spec.ts"), "test('unit', () => {})\n", "utf8");

    const plan = await buildTicketExecutionPlan({
      root,
      ticket: {
        id: "BUG-EXAMPLE-01",
        title: "Restore modal behavior",
        heading: "BUG-EXAMPLE-01: Restore modal behavior",
        body: "Verification: modal and unit tests"
      },
      workingSet: [
        "tests/modal-smoke/e2e.spec.ts",
        "tests/forge-hardening.unit.spec.ts",
        "src/ui/components/dialog/modal.riot"
      ],
      relevantSymbols: ["dialog (src/ui/components/dialog/modal.riot:1)"]
    });

    assert.equal(plan.verificationCommands[0].source, "targeted-unit");
    assert.match(plan.verificationCommands[0].command, /playwright\.unit\.config\.ts/);
    assert.equal(plan.verificationCommands[1].source, "targeted-e2e");
    assert.match(plan.verificationCommands[1].command, /playwright\.config\.ts/);
    assert.doesNotMatch(plan.verificationCommands[0].command, /tests\/modal-smoke\/e2e\.spec\.ts/);
    assert.match(plan.verificationCommands[1].command, /tests\/modal-smoke\/e2e\.spec\.ts/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("execution planner classifies root e2e specs using playwright config testMatch", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "execution-plan-config-match-"));

  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      name: "execution-plan-config-match",
      packageManager: "pnpm@10.0.0",
      scripts: {
        "test:e2e": "playwright test -c playwright.config.ts",
        "test:unit": "playwright test -c playwright.unit.config.ts",
        build: "vite build"
      }
    }, null, 2), "utf8");
    await writeFile(path.join(root, "playwright.config.ts"), "export default { testMatch: ['**/e2e.spec.ts', '**/first-experience.spec.ts'] };\n", "utf8");
    await writeFile(path.join(root, "playwright.unit.config.ts"), "export default { testMatch: '**/*.unit.spec.ts' };\n", "utf8");
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(path.join(root, "tests", "e2e.spec.ts"), "test('e2e', () => {})\n", "utf8");
    await writeFile(path.join(root, "tests", "first-experience.spec.ts"), "test('first experience', () => {})\n", "utf8");
    await writeFile(path.join(root, "tests", "guidelines-enforcement.unit.spec.ts"), "test('unit', () => {})\n", "utf8");

    const plan = await buildTicketExecutionPlan({
      root,
      ticket: {
        id: "BUG-EXAMPLE-02",
        title: "Preserve e2e route coverage",
        heading: "BUG-EXAMPLE-02: Preserve e2e route coverage",
        body: "Verification: e2e and first experience coverage"
      },
      workingSet: [
        "tests/e2e.spec.ts",
        "tests/first-experience.spec.ts",
        "tests/guidelines-enforcement.unit.spec.ts",
        "src/session.ts"
      ],
      relevantSymbols: ["hasExplicitSignedInPath (src/session.ts:105)"]
    });

    assert.equal(plan.verificationCommands[0].source, "targeted-unit");
    assert.match(plan.verificationCommands[0].command, /playwright\.unit\.config\.ts/);
    assert.match(plan.verificationCommands[0].command, /guidelines-enforcement\.unit\.spec\.ts/);
    assert.equal(plan.verificationCommands[1].source, "targeted-e2e");
    assert.match(plan.verificationCommands[1].command, /playwright\.config\.ts/);
    assert.match(plan.verificationCommands[1].command, /tests\/e2e\.spec\.ts/);
    assert.match(plan.verificationCommands[1].command, /tests\/first-experience\.spec\.ts/);
    assert.doesNotMatch(plan.verificationCommands[0].command, /tests\/e2e\.spec\.ts/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
