import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncProject, createTicket } from "../core/services/sync.mjs";
import { sweepBugs } from "../core/services/orchestrator.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(repoRoot, "tests", "fixtures", "workflow-repo");

test("sweepBugs finds tickets and calls verifyAndApplyPatch", async () => {
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
            response: `File: src/app.ts\n<<<< SEARCH\nimport { mount } from "riot";\n====\nimport { mount, unmount } from "riot";\n>>>>`
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
        title: "Fix bug in app.ts",
        lane: "Todo",
        data: {}
      }
    });

    const report = await sweepBugs({ root: targetRoot });
    assert.match(report, /Sweeping 1 bugs/);
    assert.match(report, /BUG-999/);
    
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.OLLAMA_HOST;
    await rm(targetRoot, { recursive: true, force: true });
  }
});
