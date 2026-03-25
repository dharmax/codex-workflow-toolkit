import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { syncProject, getProjectSummary } from "../core/services/sync.mjs";
import { ingestArtifact } from "../core/services/orchestrator.mjs";
import { withSupergitTransaction } from "../core/services/supergit.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(repoRoot, "tests", "fixtures", "workflow-repo");

test("ingestArtifact assesses and generates correct epics and tickets with mock HTTP", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "ingest-test-"));
  
  let callCount = 0;
  const server = http.createServer((req, res) => {
    if (req.url === "/api/tags") {
      res.writeHead(200);
      res.end(JSON.stringify({ models: [{ name: "mock-model:latest", size: 1000 }] }));
      return;
    }
    if (req.url === "/api/generate") {
      callCount++;
      res.writeHead(200);
      if (callCount === 1) {
        // Outline phase
        res.end(JSON.stringify({ response: JSON.stringify({
          status: "complete",
          outline: "# Outline\n- Epic: EPC-NEW"
        }) }));
      } else {
        // Generation phase
        res.end(JSON.stringify({ response: JSON.stringify({
          epic: { id: "EPC-NEW", title: "New Feature", summary: "Summary" },
          tickets: [{ id: "TKT-NEW", title: "New Ticket", summary: "Do it", domain: "logic" }]
        }) }));
      }
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.listen(0);
  const port = server.address().port;
  process.env.OLLAMA_HOST = `http://127.0.0.1:${port}`;

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
    server.close();
    delete process.env.OLLAMA_HOST;
    await rm(targetRoot, { recursive: true, force: true });
  }
});
