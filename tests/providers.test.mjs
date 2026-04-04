import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { generateWithAnthropic, generateWithOllama, probeOllama, refreshProviderQuotaState, resolveOllamaConfig } from "../core/services/providers.mjs";
import { discoverProviderState } from "../core/services/providers.mjs";
import { runProviderSetupWizard } from "../cli/lib/provider-setup.mjs";

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
    assert.deepEqual(result.models, [{ id: "qwen2.5:14b", sizeB: null }, { id: "llama3.2:3b", sizeB: null }]);
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

test("discoverProviderState surfaces configured remote-provider quota metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "providers-quota-"));
  try {
    await mkdir(path.join(root, ".ai-workflow"), { recursive: true });
    await writeFile(path.join(root, ".ai-workflow", "config.json"), JSON.stringify({
      providers: {
        google: {
          apiKey: "g-key",
          quota: {
            freeUsdRemaining: "4.5",
            resetAt: "2026-04-01"
          },
          paidAllowed: false
        }
      }
    }, null, 2), "utf8");

    const state = await discoverProviderState({ root });
    assert.equal(state.providers.google.available, true);
    assert.equal(state.providers.google.quota.freeUsdRemaining, 4.5);
    assert.equal(state.providers.google.quota.resetAt, "2026-04-01");
    assert.equal(state.providers.google.paidAllowed, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("discoverProviderState merges models from multiple Ollama endpoints", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "providers-ollama-multi-"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url === "http://127.0.0.1:11434/api/tags") {
      return {
        ok: true,
        async json() {
          return {
            models: [
              { name: "tinyllama:1.1b" }
            ]
          };
        }
      };
    }
    if (url === "http://192.168.1.50:11434/api/tags") {
      return {
        ok: true,
        async json() {
          return {
            models: [
              { name: "qwen2.5:14b" }
            ]
          };
        }
      };
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  try {
    await mkdir(path.join(root, ".ai-workflow"), { recursive: true });
    await writeFile(path.join(root, ".ai-workflow", "config.json"), JSON.stringify({
      providers: {
        ollama: {
          host: "http://127.0.0.1:11434",
          endpoints: ["http://192.168.1.50:11434"]
        }
      }
    }, null, 2), "utf8");

    const state = await discoverProviderState({ root });
    assert.equal(state.providers.ollama.available, true);
    assert.deepEqual(state.providers.ollama.endpoints, ["http://192.168.1.50:11434"]);
    assert.deepEqual(
      state.providers.ollama.models.map((model) => [model.id, model.host]).sort(),
      [
        ["qwen2.5:14b", "http://192.168.1.50:11434"],
        ["tinyllama:1.1b", "http://127.0.0.1:11434"]
      ]
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});

test("runProviderSetupWizard registers Ollama endpoints and remote provider connections", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "providers-setup-wizard-"));
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "providers-setup-home-"));
  const originalFetch = globalThis.fetch;
  const originalHome = process.env.HOME;
  const originalOllamaHost = process.env.OLLAMA_HOST;
  const originalOpenAIKey = process.env.OPENAI_API_KEY;
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const originalGoogleKey = process.env.GOOGLE_API_KEY;
  const prompts = [];
  const connections = [];
  process.env.HOME = tempHome;
  process.env.OLLAMA_HOST = "http://127.0.0.1:11434";
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  globalThis.fetch = async (url) => {
    if (url === "http://127.0.0.1:11434/api/tags") {
      return {
        ok: true,
        async json() {
          return {
            models: [
              { name: "llama3.2:3b" }
            ]
          };
        }
      };
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const rl = {
    async question(prompt) {
      prompts.push(prompt);
      if (prompt.startsWith("Other Ollama URLs")) {
        return "http://192.168.1.50:11434";
      }
      if (prompt.startsWith("Other AI services to connect now")) {
        return "openai";
      }
      return "";
    }
  };

  try {
    await mkdir(path.join(root, ".ai-workflow"), { recursive: true });

    const result = await runProviderSetupWizard({
      root,
      scope: "project",
      interactive: true,
      rl,
      connectProviderImpl: async (providerId) => {
        connections.push(providerId);
        return 0;
      }
    });

    assert.deepEqual(prompts, [
      "Other Ollama URLs (comma-separated, blank to skip): ",
      "Other AI services to connect now (openai, anthropic, google; comma-separated, blank to skip): "
    ]);
    assert.deepEqual(connections, ["openai"]);
    assert.deepEqual(result.connectedProviders, ["openai"]);
    assert.deepEqual(result.registeredEndpoints, ["http://192.168.1.50:11434"]);
    assert.match(result.messages.join("\n"), /Found Ollama at http:\/\/127\.0\.0\.1:11434\./);
    assert.match(result.messages.join("\n"), /Ollama models: llama3\.2:3b/);

    const config = JSON.parse(await readFile(path.join(root, ".ai-workflow", "config.json"), "utf8"));
    assert.equal(config.providers.ollama.host, "http://127.0.0.1:11434");
    assert.deepEqual(config.providers.ollama.endpoints, ["http://192.168.1.50:11434"]);
    assert.equal(Array.isArray(config.providers.ollama.models), true);
    assert.equal(config.providers.ollama.models[0].id, "llama3.2:3b");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalOllamaHost === undefined) {
      delete process.env.OLLAMA_HOST;
    } else {
      process.env.OLLAMA_HOST = originalOllamaHost;
    }
    if (originalOpenAIKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAIKey;
    }
    if (originalAnthropicKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
    }
    if (originalGoogleKey === undefined) {
      delete process.env.GOOGLE_API_KEY;
    } else {
      process.env.GOOGLE_API_KEY = originalGoogleKey;
    }
    await rm(root, { recursive: true, force: true });
    await rm(tempHome, { recursive: true, force: true });
  }
});

test("generateWithAnthropic sends a direct API request", async () => {
  const originalFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      async json() {
        return {
          content: [{ type: "text", text: "hello from claude" }]
        };
      }
    };
  };

  try {
    const result = await generateWithAnthropic({
      model: "claude-3-5-sonnet-latest",
      prompt: "status",
      system: "planner",
      apiKey: "anthropic-key"
    });
    assert.equal(captured.url, "https://api.anthropic.com/v1/messages");
    const body = JSON.parse(captured.init.body);
    assert.equal(body.model, "claude-3-5-sonnet-latest");
    assert.equal(body.system, "planner");
    assert.equal(result.response, "hello from claude");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("refreshProviderQuotaState restores monthly free quota after reset date", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "providers-refresh-"));
  try {
    await mkdir(path.join(root, ".ai-workflow"), { recursive: true });
    await writeFile(path.join(root, ".ai-workflow", "config.json"), JSON.stringify({
      providers: {
        openai: {
          apiKey: "o-key",
          quota: {
            freeUsdRemaining: 0.4,
            monthlyFreeUsd: 5,
            resetAt: "2026-03-01"
          }
        }
      }
    }, null, 2), "utf8");

    const result = await refreshProviderQuotaState({
      root,
      providerId: "openai",
      scope: "project",
      now: new Date("2026-03-26T12:00:00Z")
    });
    assert.equal(result.refreshed[0].changed, true);
    assert.equal(result.refreshed[0].quota.freeUsdRemaining, 5);
    assert.equal(result.refreshed[0].quota.resetAt, "2026-04-01");

    const state = await discoverProviderState({ root });
    assert.equal(state.leanCtx.installed, true);
    assert.equal(state.routingPolicy.contextCompression, "lean-ctx");
    assert.equal(state.providers.openai.quota.freeUsdRemaining, 5);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
