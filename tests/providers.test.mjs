import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { generateWithOllama, probeOllama, resolveOllamaConfig } from "../core/services/providers.mjs";
import { discoverProviderState } from "../core/services/providers.mjs";

test("probeOllama reads models from a configured HTTP host", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({
    ok: true,
    async json() {
      assert.equal(url, "http://127.0.0.1:11434/api/tags");
      return {
        models: [
          { name: "qwen2.5:14b" },
          { name: "llama3.2:3b" }
        ]
      };
    }
  });

  try {
    const result = await probeOllama({ host: "127.0.0.1:11434" });
    assert.equal(result.installed, true);
    assert.deepEqual(result.models, ["qwen2.5:14b", "llama3.2:3b"]);
    assert.equal(result.host, "http://127.0.0.1:11434");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generateWithOllama sends a direct HTTP request to the configured host", async () => {
  const originalFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (url, init) => {
    captured = {
      url,
      init
    };
    return {
      ok: true,
      async json() {
        return {
          response: "{\"kind\":\"reply\",\"reply\":\"ok\"}"
        };
      }
    };
  };

  try {
    const result = await generateWithOllama({
      host: "http://127.0.0.1:11434",
      model: "qwen2.5:14b",
      system: "planner",
      prompt: "status",
      format: "json"
    });

    assert.equal(result.host, "http://127.0.0.1:11434");
    assert.equal(result.model, "qwen2.5:14b");
    assert.equal(captured.url, "http://127.0.0.1:11434/api/generate");
    const body = JSON.parse(captured.init.body);
    assert.equal(body.model, "qwen2.5:14b");
    assert.equal(body.system, "planner");
    assert.equal(body.prompt, "status");
    assert.equal(body.format, "json");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resolveOllamaConfig merges hardware and planner hints", () => {
  const resolved = resolveOllamaConfig({
    globalConfig: {
      providers: {
        ollama: {
          host: "ollama-box:11434",
          hardwareClass: "small"
        }
      }
    },
    projectConfig: {
      providers: {
        ollama: {
          plannerModel: "qwen2.5:7b",
          maxModelSizeB: 8
        }
      }
    }
  });

  assert.equal(resolved.host, "http://ollama-box:11434");
  assert.equal(resolved.hardwareClass, "small");
  assert.equal(resolved.plannerModel, "qwen2.5:7b");
  assert.equal(resolved.maxModelSizeB, 8);
});

test("discoverProviderState tolerates malformed project config and reports a warning", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "providers-bad-config-"));
  try {
    await mkdir(path.join(root, ".ai-workflow"), { recursive: true });
    await writeFile(path.join(root, ".ai-workflow", "config.json"), "{\n  \"providers\": {}\n}\ntrailing", "utf8");
    const state = await discoverProviderState({ root });
    assert.equal(Array.isArray(state.configWarnings), true);
    assert.equal(state.configWarnings.length >= 1, true);
    assert.equal(typeof state.providers.ollama.available, "boolean");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
