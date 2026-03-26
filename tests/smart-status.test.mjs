import test from "node:test";
import assert from "node:assert/strict";
import { buildSmartProjectStatus } from "../core/services/projections.mjs";

test("buildSmartProjectStatus generates a dense, high-signal report", () => {
  const mockStore = {
    projectRoot: "/home/user/my-project",
    getSummary: () => ({ files: 42, tickets: 5, candidates: 10 }),
    listEntities: ({ entityType }) => {
      if (entityType === "ticket") {
        return [
          { id: "TKT-001", title: "In Progress Task", lane: "In Progress" },
          { id: "TKT-002", title: "Todo Task", lane: "Todo" },
          { id: "TKT-003", title: "Another Todo", lane: "Todo" }
        ];
      }
      if (entityType === "epic") {
        return [{ id: "EPC-001", title: "Epic One", state: "open" }];
      }
      return [];
    },
    listMetrics: () => [
      { success: false, task_class: "sync", error_message: "Network error" }
    ]
  };

  const auditFindings = [
    { severity: "high", type: "circular_dependency", summary: "A -> B -> A" }
  ];

  const status = buildSmartProjectStatus(mockStore, { auditFindings });

  assert.match(status, /Environment:/);
  assert.match(status, /Project: my-project/);
  assert.match(status, /Epic: \[EPC-001\] Epic One/);
  assert.match(status, /Inventory: 42 files, 3 active tickets/);
  assert.match(status, /\[IN_PROGRESS\] TKT-001/);
  assert.match(status, /\[TODO\] TKT-002/);
  assert.match(status, /!! FAILURE in sync/);
  assert.match(status, /Audit Detects: 1 High, 0 Medium issues/);
});
