import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncProject, getProjectSummary } from "../core/services/sync.mjs";
import { ingestArtifact } from "../core/services/orchestrator.mjs";
import { withSupergitTransaction } from "../core/services/supergit.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(repoRoot, "tests", "fixtures", "workflow-repo");

test("ingestArtifact assesses and generates correct epics and tickets with mock HTTP", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "ingest-test-"));
  
  let callCount = 0;
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
    if (String(url).endsWith("/api/generate") || String(url).includes(":generateContent?key=")) {
      callCount++;
      return {
        ok: true,
        async json() {
          if (callCount === 1) {
            return {
              response: JSON.stringify({
                status: "complete",
                outline: "# Outline\n- Epic: EPC-NEW"
              }),
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      status: "complete",
                      outline: "# Outline\n- Epic: EPC-NEW"
                    })
                  }]
                }
              }]
            };
          }
          return {
            response: JSON.stringify({
              epic: { id: "EPC-NEW", title: "New Feature", summary: "Summary" },
              tickets: [{ id: "TKT-NEW", title: "New Ticket", summary: "Do it", domain: "logic" }]
            }),
            candidates: [{
              content: {
                parts: [{
                  text: JSON.stringify({
                    epic: { id: "EPC-NEW", title: "New Feature", summary: "Summary" },
                    tickets: [{ id: "TKT-NEW", title: "New Ticket", summary: "Do it", domain: "logic" }]
                  })
                }]
              }
            }]
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
    
    const prdPath = path.join(targetRoot, "PRD.md");
    await writeFile(prdPath, "# New PRD\nDo things.", "utf8");

    // Mock readline
    const mockRl = {
      question: async () => "yes"
    };

    const result = await ingestArtifact(prdPath, { root: targetRoot, rl: mockRl });
    assert.equal(result.epic.id, "EPC-NEW");
    assert.equal(result.tickets[0].id, "TKT-NEW");

    const summary = await getProjectSummary({ projectRoot: targetRoot });
    assert.equal(summary.activeTickets.some(t => t.id === "TKT-NEW"), true);

  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.OLLAMA_HOST;
    await rm(targetRoot, { recursive: true, force: true });
  }
});
