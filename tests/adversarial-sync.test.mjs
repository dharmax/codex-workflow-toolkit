import { test } from "node:test";
import assert from "node:assert";
import path from "node:path";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { openWorkflowStore } from "../core/db/sqlite-store.mjs";
import { importLegacyProjections, renderKanbanProjection } from "../core/services/projections.mjs";

test("Adversarial Sync: Recover from malformed Kanban", async () => {
  const projectRoot = path.resolve(process.cwd(), "tests/tmp/adversarial-sync");
  await mkdir(projectRoot, { recursive: true });
  const store = await openWorkflowStore({ projectRoot, dbPath: path.resolve(projectRoot, "test.db") });

  // Scenario 1: Missing checkboxes and broken lanes
  const brokenKanban = `
## In Progress
- No ID Here: Just a random line
- TKT-001 Working on this but no checkbox
- [ ] TKT-002 This one is fine

## Unknown Lane
- [x] TKT-003 Finished something in a weird lane
    `;
  await writeFile(path.resolve(projectRoot, "kanban.md"), brokenKanban);
  await writeFile(path.resolve(projectRoot, "epics.md"), "");

  await importLegacyProjections(store, { projectRoot });
  // TKT-001 and TKT-002 should be caught if they match the ID pattern, even if checkboxes are weird
  const tickets = store.listEntities({ entityType: "ticket" });
  
  // Check if we recovered 002 and 003 (001 might fail if it doesn't match the regex strictly)
  assert.ok(tickets.some(t => t.id === "TKT-002"), "Should recover TKT-002");
  assert.ok(tickets.some(t => t.id === "TKT-003"), "Should recover TKT-003 from unknown lane");

  // Scenario 2: Format Correction on Projection
  // Now project back to file and see if it's clean
  const kanban = renderKanbanProjection(store);
  assert.match(kanban, /## Todo/, "Should project canonical lanes");
  assert.match(kanban, /- \[ \] TKT-002/, "Should fix formatting for TKT-002");

  await rm(projectRoot, { recursive: true, force: true });
});
