import { withWorkflowStore } from "../core/services/sync.mjs";
import { executeJsOrchestrator } from "../core/services/js-orchestrator.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

async function runTest() {
  const root = process.cwd();
  const prompt = "test js orchestration";
  const code = `
    await step("init", "Init workflow", async () => {
      console.log("Initializing...");
      return { ok: true };
    });
    
    // Transition to SYNCED state
    await transition("SYNCED", "initial sync", async () => {
      console.log("Syncing logic...");
      return { files: 10 };
    });

    // Conditional transition
    const check = true;
    if (check) {
      await transition("READY", "checks passed", async () => {
        console.log("System Ready");
      });
    } else {
      await transition("FAILED", "checks failed", async () => {
        issue("integrity", "System check failed");
      });
    }
    
    setState("finalState", getState("__current_state"));
  `;

  console.log("Starting JS Orchestrator Manual Test...");
  
  const result = await withWorkflowStore(root, async (workflowStore) => {
    const services = {
      sh: {
        execute: async (cmd, args) => {
          return { stdout: "hello from sh", stderr: "", ok: true };
        }
      }
    };
    
    return executeJsOrchestrator(code, {
      workflowStore,
      prompt,
      services
    });
  });

  console.log("Execution Result:", JSON.stringify(result, null, 2));

  // Save as a pseudo-artifact for the judge
  const artifact = {
    id: result.runId,
    prompt,
    code,
    result,
    recordedAt: new Date().toISOString()
  };
  
  const artifactPath = path.resolve(root, ".ai-workflow/state/run-artifacts/manual-test-js.json");
  mkdirSync(path.dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  console.log(`Artifact saved to ${artifactPath}`);
}

runTest().catch(console.error);
