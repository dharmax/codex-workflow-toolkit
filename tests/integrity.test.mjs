import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import path from "node:path";
import { buildWorkflowAuditSummary } from "../runtime/scripts/ai-workflow/lib/workflow-audit-report.mjs";

test("Workflow Integrity: No Zombie Work", async () => {
  const root = process.cwd();
  const summary = await buildWorkflowAuditSummary(root);
  
  const zombieFindings = summary.findings.filter(f => f.category === "integrity" && f.message.includes("zombie work"));
  
  if (zombieFindings.length > 0) {
    console.error("Integrity Violation: Open tickets found in recent commit history!");
    for (const f of zombieFindings) {
      console.error(`- ${f.message}`);
    }
  }
  
  assert.equal(zombieFindings.length, 0, "Should have zero zombie tickets in Kanban board.");
});
