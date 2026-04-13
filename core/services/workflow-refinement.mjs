/**
 * Responsibility: Track and remediate workflow issues such as exceptions, failed tests, and user criticism.
 * Scope: Handles listing of issues, recording of new failures, and refinement loop analysis.
 */

import { stableId } from "../lib/hash.mjs";

/**
 * Service for addressing, querying, and fixing workflow issues.
 */
export async function listWorkflowIssues(workflowStore, filters = {}) {
  return workflowStore.listWorkflowIssues(filters);
}

export async function refineWorkflowIssue(issueId, { workflowStore, services }) {
  const issue = (await workflowStore.listWorkflowIssues()).find(i => i.id === issueId);
  if (!issue) throw new Error(`Issue not found: ${issueId}`);

  // 1. Analyze the issue
  console.log(`Refining Issue: ${issue.summary}`);
  console.log(`Type: ${issue.issueType} | Severity: ${issue.severity}`);
  
  if (issue.details?.error) {
    console.log(`Error: ${issue.details.error}`);
    if (issue.details.stack) console.log(`Stack: ${issue.details.stack}`);
  }

  // 2. Propose a refinement plan (In a real scenario, this would call an LLM)
  // For now, we'll mark it as investigating.
  workflowStore.upsertWorkflowIssue({
    ...issue,
    status: "investigating",
    updatedAt: new Date().toISOString()
  });

  return {
    issue,
    status: "investigating",
    message: "Issue marked for investigation. AI-driven refinement logic pending implementation."
  };
}

/**
 * Automatically logs a new issue if a command fails.
 */
export async function recordWorkflowFailure(workflowStore, { type, summary, details, runId }) {
  const id = stableId("issue", runId || "manual", type, summary, Date.now());
  workflowStore.upsertWorkflowIssue({
    id,
    runId,
    issueType: type,
    severity: "high",
    summary,
    details,
    status: "open"
  });
  return id;
}
