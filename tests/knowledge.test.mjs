import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { updateKnowledgeRemote } from "../core/services/knowledge.mjs";

test("updateKnowledgeRemote writes a normalized builtin knowledge payload from a configured source", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "knowledge-remote-"));
  const destinationPath = path.join(targetRoot, "knowledge.json");

  try {
    const result = await updateKnowledgeRemote({
      sourceUrl: "https://example.com/knowledge.json",
      destinationPath,
      fetchImpl: async (url) => {
        assert.equal(url, "https://example.com/knowledge.json");
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            version: "2026.04.04",
            tasks: ["summarization", "summarization", "routing"],
            capabilityMapping: { summarization: "data", routing: "strategy" },
            minimumQuality: { summarization: "low", routing: "medium" },
            inferenceHeuristics: { strategy: { base: 3 } },
            models: {
              ollama: [
                { id: "mistral-nemo:12b", strength: "strategy" },
                null
              ]
            }
          })
        };
      }
    });

    assert.equal(result.success, true);
    assert.equal(result.destinationPath, destinationPath);
    assert.equal(result.version, "2026.04.04");
    assert.equal(result.taskCount, 2);
    assert.equal(result.modelProviderCount, 1);

    const written = JSON.parse(await readFile(destinationPath, "utf8"));
    assert.equal(written.version, "2026.04.04");
    assert.deepEqual(written.tasks, ["summarization", "routing"]);
    assert.deepEqual(written.capabilityMapping, { summarization: "data", routing: "strategy" });
    assert.deepEqual(written.minimumQuality, { summarization: "low", routing: "medium" });
    assert.deepEqual(written.models.ollama, [{ id: "mistral-nemo:12b", strength: "strategy" }]);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("updateKnowledgeRemote skips cleanly when no remote source is configured", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "knowledge-remote-skip-"));
  const destinationPath = path.join(targetRoot, "knowledge.json");
  const previousUrl = process.env.AIWF_BUILTIN_KNOWLEDGE_URL;

  try {
    delete process.env.AIWF_BUILTIN_KNOWLEDGE_URL;
    const result = await updateKnowledgeRemote({
      destinationPath,
      fetchImpl: async () => {
        throw new Error("fetch should not be called");
      },
      projectConfig: {},
      globalConfig: {},
      sourceUrl: null
    });

    assert.equal(result.success, false);
    assert.equal(result.skipped, true);
    assert.match(result.reason, /No remote knowledge URL configured/i);
    assert.match(result.hint, /knowledge\.remoteUrl/i);
  } finally {
    if (previousUrl === undefined) {
      delete process.env.AIWF_BUILTIN_KNOWLEDGE_URL;
    } else {
      process.env.AIWF_BUILTIN_KNOWLEDGE_URL = previousUrl;
    }
    await rm(targetRoot, { recursive: true, force: true });
  }
});
