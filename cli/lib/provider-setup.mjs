import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { getGlobalConfigPath, getProjectConfigPath, readConfigSafe, writeConfigValue } from "./config-store.mjs";
import { discoverProviderState, refreshProviderRegistry } from "../../core/services/providers.mjs";
import { handleProviderConnect } from "./provider-connect.mjs";

const REMOTE_PROVIDER_IDS = ["openai", "anthropic", "google"];

export async function runProviderSetupWizard({
  root = process.cwd(),
  scope = "global",
  interactive = false,
  rl: existingRl = null,
  promptRemoteProviders = true,
  discoverProviderStateImpl = discoverProviderState,
  refreshProviderRegistryImpl = refreshProviderRegistry,
  connectProviderImpl = handleProviderConnect
} = {}) {
  const configPath = scope === "global" ? getGlobalConfigPath() : getProjectConfigPath(root);
  const rl = interactive && !existingRl
    ? readline.createInterface({ input, output })
    : existingRl;
  const messages = [];
  const connectedProviders = [];
  const registeredEndpoints = [];

  try {
    let providerState = await discoverProviderStateImpl({ root });

    if (providerState.providers.ollama?.installed) {
      const ollama = providerState.providers.ollama;
      messages.push(`Found Ollama at ${ollama.host}.`);
      if (Array.isArray(ollama.models) && ollama.models.length) {
        messages.push(`Ollama models: ${formatModelList(ollama.models)}`);
      } else {
        messages.push("Ollama responded, but no models were listed.");
      }

      if (interactive && rl) {
        const currentConfig = await readConfigSafe(configPath);
        const storedOllama = currentConfig.config?.providers?.ollama ?? {};
        const storedEndpoints = normalizeHostList(storedOllama.endpoints ?? []);

        if (!storedOllama.host) {
          await writeConfigValue(configPath, "providers.ollama.host", ollama.host);
        }

        const answer = await rl.question(
          storedEndpoints.length
            ? `Other Ollama URLs to add (comma-separated, blank to skip) [current: ${storedEndpoints.join(", ")}]: `
            : "Other Ollama URLs (comma-separated, blank to skip): "
        );
        const nextEndpoints = normalizeHostList(parseCommaSeparatedList(answer))
          .filter((host) => host !== ollama.host && !storedEndpoints.includes(host));

        if (nextEndpoints.length) {
          const mergedEndpoints = normalizeHostList([...storedEndpoints, ...nextEndpoints]);
          await writeConfigValue(configPath, "providers.ollama.endpoints", JSON.stringify(mergedEndpoints));
          registeredEndpoints.push(...nextEndpoints);
          messages.push(`Registered ${nextEndpoints.length} additional Ollama endpoint${nextEndpoints.length === 1 ? "" : "s"}.`);
        }
      }
    } else {
      messages.push("No Ollama endpoint is currently reachable.");
    }

    if (interactive && rl && promptRemoteProviders) {
      const missingRemoteProviders = REMOTE_PROVIDER_IDS.filter((providerId) => {
        const provider = providerState.providers?.[providerId];
        return provider && !provider.available;
      });

      if (missingRemoteProviders.length) {
        const prompt = `Other AI services to connect now (${missingRemoteProviders.join(", ")}; comma-separated, blank to skip): `;
        const answer = await rl.question(prompt);
        for (const providerId of parseCommaSeparatedList(answer)) {
          if (!missingRemoteProviders.includes(providerId)) {
            continue;
          }
          const code = await connectProviderImpl(providerId, { rl });
          if (code === 0) {
            connectedProviders.push(providerId);
          }
        }
      }
    }

    providerState = await discoverProviderStateImpl({ root });
    const refreshResult = await refreshProviderRegistryImpl({ root, scope });

    return {
      configPath,
      providerState,
      refreshResult,
      connectedProviders,
      registeredEndpoints,
      messages
    };
  } finally {
    if (rl && rl !== existingRl) {
      rl.close();
    }
  }
}

function parseCommaSeparatedList(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeHostList(hosts) {
  const seen = new Set();
  const result = [];

  for (const host of Array.isArray(hosts) ? hosts : []) {
    const normalized = String(host ?? "").trim().replace(/\/+$/, "");
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized.startsWith("http://") || normalized.startsWith("https://")
      ? normalized
      : `http://${normalized}`);
  }

  return result;
}

function formatModelList(models) {
  return models.slice(0, 10).map((model) => model.id).join(", ");
}
