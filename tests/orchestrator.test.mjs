import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { syncProject, createTicket } from "../core/services/sync.mjs";
import { sweepBugs } from "../core/services/orchestrator.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(repoRoot, "tests", "fixtures", "workflow-repo");

test("sweepBugs finds tickets and calls verifyAndApplyPatch", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "orch-test-"));
  
  const server = http.createServer((req, res) => {
    if (req.url === "/api/tags") {
      res.writeHead(200);
      res.end(JSON.stringify({ models: [{ name: "mock-model:latest", size: 1000 }] }));
      return;
    }
    if (req.url === "/api/generate") {
      res.writeHead(200);
      res.end(JSON.stringify({ response: `File: src/app.ts\n<<<< SEARCH\nimport { mount } from "riot";\n====\nimport { mount, unmount } from "riot";\n>>>>` }));
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
    server.close();
    delete process.env.OLLAMA_HOST;
    await rm(targetRoot, { recursive: true, force: true });
  }
});
