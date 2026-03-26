import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncProject, createTicket } from "../core/services/sync.mjs";
import { sweepBugs } from "../core/services/orchestrator.mjs";
import { withWorkflowStore } from "../core/services/sync.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(repoRoot, "tests", "fixtures", "workflow-repo");

test("sweepBugs marks a bug done only after verification passes", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "orch-test-"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/api/tags")) {
      return {
        ok: true,
        async json() {
          return { models: [{ name: "mock-model:latest", size: 1000 }] };
        }
      };
    }
    if (String(url).endsWith("/api/generate")) {
      return {
        ok: true,
        async json() {
          return {
            response: `File: src/app.ts\n<<<< SEARCH\nimport "./styles/app.css";\n====\nimport "./styles/app.css";\nimport { readFileSync } from "node:fs";\n>>>>`
          };
        }
      };
    }
    if (String(url).includes("generateContent")) {
      return {
        ok: true,
        async json() {
          return {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: `File: src/app.ts\n<<<< SEARCH\nimport "./styles/app.css";\n====\nimport "./styles/app.css";\nimport { readFileSync } from "node:fs";\n>>>>`
                    }
                  ]
                }
              }
            ]
          };
        }
      };
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };
  process.env.OLLAMA_HOST = "http://mock-ollama.local";

  try {
    await cp(fixtureRoot, targetRoot, { recursive: true });
    
    await syncProject({ projectRoot: targetRoot });

    await createTicket({
      projectRoot: targetRoot,
      entity: {
        id: "BUG-999",
        entityType: "ticket",
        title: "Fix bug in src/app.ts",
        lane: "Todo",
        data: {
          summary: "Patch src/app.ts import handling."
        }
      }
    });

    const report = await sweepBugs({ root: targetRoot });
    assert.match(report, /Sweeping 1 bugs/);
    assert.match(report, /BUG-999/);
    assert.match(report, /verified 1\/1/);

    const storedTicket = await withWorkflowStore(targetRoot, async (store) => store.getEntity("BUG-999"));
    assert.equal(storedTicket.lane, "Done");
    assert.equal(storedTicket.data.executionResult.status, "verified");
    assert.equal(storedTicket.data.executionPlan.verificationCommands[0].command, "npm run --silent test");
    
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.OLLAMA_HOST;
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("sweepBugs blocks a bug when the verification baseline is already red", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "orch-test-fail-"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/api/tags")) {
      return {
        ok: true,
        async json() {
          return { models: [{ name: "mock-model:latest", size: 1000 }] };
        }
      };
    }
    if (String(url).endsWith("/api/generate")) {
      return {
        ok: true,
        async json() {
          return {
            response: `File: src/app.ts\n<<<< SEARCH\nimport "./styles/app.css";\n====\nimport "./styles/app.css";\nimport { readFileSync } from "node:fs";\n>>>>`
          };
        }
      };
    }
    if (String(url).includes("generateContent")) {
      return {
        ok: true,
        async json() {
          return {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: `File: src/app.ts\n<<<< SEARCH\nimport "./styles/app.css";\n====\nimport "./styles/app.css";\nimport { readFileSync } from "node:fs";\n>>>>`
                    }
                  ]
                }
              }
            ]
          };
        }
      };
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };
  process.env.OLLAMA_HOST = "http://mock-ollama.local";

  try {
    await cp(fixtureRoot, targetRoot, { recursive: true });
    await syncProject({ projectRoot: targetRoot });
    await createTicket({
      projectRoot: targetRoot,
      entity: {
        id: "BUG-1000",
        entityType: "ticket",
        title: "Fix failing bug in src/app.ts",
        lane: "Todo",
        data: {
          summary: "Patch src/app.ts import handling.",
          verification: "npm run definitely-missing-script"
        }
      }
    });

    const report = await sweepBugs({ root: targetRoot, verificationTimeoutMs: 10_000 });
    assert.match(report, /BUG-1000/);
    assert.match(report, /Verification baseline red/);

    const storedTicket = await withWorkflowStore(targetRoot, async (store) => store.getEntity("BUG-1000"));
    assert.equal(storedTicket.lane, "Blocked");
    assert.equal(storedTicket.data.executionResult.status, "baseline-red");
    assert.equal(storedTicket.data.executionPlan.verificationCommands[0].command, "npm run definitely-missing-script");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.OLLAMA_HOST;
    await rm(targetRoot, { recursive: true, force: true });
  }
});
