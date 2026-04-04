import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncProject, getProjectSummary } from "../core/services/sync.mjs";
import { ingestArtifact, onboardProjectBrief } from "../core/services/orchestrator.mjs";
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

test("onboardProjectBrief normalizes a messy brief before generating epics", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "brief-onboard-test-"));

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
            const payload = {
              status: "questioning",
              briefMarkdown: "# Project Brief\n\n## Overview\nDraft\n",
              questions: ["Who are the first users?"],
              mvpReady: false
            };
            return {
              response: JSON.stringify(payload),
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify(payload)
                  }]
                }
              }]
            };
          }
          if (callCount === 2) {
            const payload = {
              status: "complete",
              briefMarkdown: "# Project Brief\n\n## Overview\nUpdated after questions\n\n## MVP Gate\n- Clear enough for epics\n",
              mvpReady: true
            };
            return {
              response: JSON.stringify(payload),
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify(payload)
                  }]
                }
              }]
            };
          }
          const payload = {
            epic: {
              id: "EPC-BRIEF",
              title: "Brief onboarding",
              summary: "Normalize a project brief and generate epics.",
              userStories: ["**As a developer**, I can turn a messy brief into a living project brief."],
              ticketBatches: ["Brief normalization"]
            },
            tickets: [{
              id: "TKT-BRIEF",
              title: "Normalize the brief",
              summary: "Create the living project brief and gate epic generation.",
              domain: "logic",
              story: "As a developer, I can get a normalized project brief before epics are created."
            }]
          };
          return {
            response: JSON.stringify(payload),
            candidates: [{
              content: {
                parts: [{
                  text: JSON.stringify(payload)
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
    const sourceBrief = path.join(targetRoot, "messy-brief.md");
    await writeFile(sourceBrief, "# messy idea\nShip something good.", "utf8");

    const mockRl = {
      question: async (prompt) => {
        if (/Who are the first users\?/i.test(prompt)) {
          return "Developers";
        }
        if (/Approve this brief/i.test(prompt)) {
          return "yes";
        }
        return "yes";
      }
    };

    const result = await onboardProjectBrief(sourceBrief, { root: targetRoot, rl: mockRl });
    assert.equal(result.epic.id, "EPC-BRIEF");
    assert.equal(result.tickets[0].id, "TKT-BRIEF");

    const briefText = await readFile(path.join(targetRoot, "project-brief.md"), "utf8");
    assert.match(briefText, /Updated after questions/);
    assert.match(briefText, /MVP Gate/);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.OLLAMA_HOST;
    await rm(targetRoot, { recursive: true, force: true });
  }
});
