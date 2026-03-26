import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { getGlobalConfigPath, writeConfigValue } from "./config-store.mjs";
import { spawn } from "node:child_process";

export async function handleProviderConnect(providerId, { rl: existingRl } = {}) {
  if (!providerId) {
    console.error("Usage: ai-workflow provider connect <provider-id>");
    return 1;
  }

  const rl = existingRl ?? readline.createInterface({ input, output });

  try {
    switch (providerId.toLowerCase()) {
      case "openai":
      case "anthropic":
      case "google":
      case "gemini":
        return await connectWithApiKey(rl, providerId.toLowerCase());
      case "codex":
        return await connectCodex(rl);
      default:
        console.error(`Unsupported provider for connection: ${providerId}`);
        return 1;
    }
  } finally {
    if (!existingRl) {
      rl.close();
    }
  }
}

async function connectWithApiKey(rl, providerId) {
  const configPath = getGlobalConfigPath();
  const canonicalId = providerId === "gemini" ? "google" : providerId;
  const urlMap = {
    openai: "https://platform.openai.com/api-keys",
    anthropic: "https://console.anthropic.com/settings/keys",
    google: "https://aistudio.google.com/app/apikey"
  };

  console.log(`Connecting to ${canonicalId}...`);
  if (urlMap[canonicalId]) {
    console.log(`You can get your API key here: ${urlMap[canonicalId]}`);
    const openBrowser = await rl.question("Open browser to get key? [Y/n] ");
    if (openBrowser.toLowerCase() !== "n") {
      await openUrl(urlMap[canonicalId]);
    }
  }

  const apiKey = await rl.question(`Enter your ${canonicalId} API key: `);
  if (!apiKey.trim()) {
    console.error("API key cannot be empty.");
    return 1;
  }

  await writeConfigValue(configPath, `providers.${canonicalId}.apiKey`, apiKey.trim());
  const freeQuotaInput = await rl.question(`Enter remaining free quota in USD for ${canonicalId} (blank if unknown): `);
  if (freeQuotaInput.trim()) {
    const numeric = Number(freeQuotaInput);
    if (!Number.isFinite(numeric)) {
      console.error("Free quota must be numeric when provided.");
      return 1;
    }
    await writeConfigValue(configPath, `providers.${canonicalId}.quota.freeUsdRemaining`, String(Number(numeric.toFixed(2))));
  }
  const monthlyQuotaInput = await rl.question(`Enter monthly free quota in USD for ${canonicalId} (blank if unknown): `);
  if (monthlyQuotaInput.trim()) {
    const numeric = Number(monthlyQuotaInput);
    if (!Number.isFinite(numeric)) {
      console.error("Monthly free quota must be numeric when provided.");
      return 1;
    }
    await writeConfigValue(configPath, `providers.${canonicalId}.quota.monthlyFreeUsd`, String(Number(numeric.toFixed(2))));
  }
  const resetAt = await rl.question(`Enter quota reset date for ${canonicalId} (YYYY-MM-DD, blank if unknown): `);
  if (resetAt.trim()) {
    await writeConfigValue(configPath, `providers.${canonicalId}.quota.resetAt`, resetAt.trim());
  }
  const paidAllowed = await rl.question(`Allow paid usage after free quota is exhausted? [y/N] `);
  await writeConfigValue(configPath, `providers.${canonicalId}.paidAllowed`, String(/^y(es)?$/i.test(paidAllowed.trim())));
  console.log(`Successfully connected to ${canonicalId}!`);
  return 0;
}

async function connectCodex(rl) {
  const configPath = getGlobalConfigPath();
  console.log("Connecting to Codex (Browser Login Simulation)...");
  // In a real scenario, this might involve OAuth or a special login URL
  console.log("Opening browser for login...");
  await openUrl("https://codex.example.com/login?cli=true");
  
  const token = await rl.question("Enter the session token from your browser: ");
  if (!token.trim()) {
    console.error("Token cannot be empty.");
    return 1;
  }

  await writeConfigValue(configPath, "providers.codex.token", token.trim());
  console.log("Successfully connected to Codex!");
  return 0;
}

async function openUrl(url) {
  const start = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  return new Promise((resolve) => {
    const cp = spawn(start, [url], { detached: true, stdio: "ignore" });
    cp.on("error", () => {
      console.warn(`Failed to open browser automatically. Please visit: ${url}`);
      resolve();
    });
    cp.on("exit", () => resolve());
  });
}
