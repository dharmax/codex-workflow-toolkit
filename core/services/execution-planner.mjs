import path from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export async function buildTicketExecutionPlan({
  root,
  ticket,
  entity = null,
  workingSet = [],
  relevantSymbols = []
} = {}) {
  const normalizedTicket = normalizeTicket(ticket, entity);
  const enrichedWorkingSet = await expandWorkingSetHints(root, normalizedTicket, entity, workingSet);
  const packageMeta = await loadPackageMeta(root);
  const verificationCommands = inferVerificationCommands({
    root,
    ticket: normalizedTicket,
    entity,
    workingSet: enrichedWorkingSet,
    packageMeta
  });
  const concerns = buildConcerns({ ticket: normalizedTicket, workingSet: enrichedWorkingSet, relevantSymbols, verificationCommands, packageMeta });

  return {
    ticketId: normalizedTicket.id,
    packageManager: packageMeta.packageManager.command,
    verificationCommands,
    ready: concerns.length === 0 && verificationCommands.length > 0,
    concerns,
    workingSet: [...enrichedWorkingSet],
    relevantSymbols: [...relevantSymbols]
  };
}

export async function runVerificationPlan(root, plan, options = {}) {
  const commands = Array.isArray(plan?.verificationCommands) ? plan.verificationCommands : [];
  const timeoutMs = clampTimeout(options.timeoutMs);
  const results = [];

  for (const item of commands) {
    results.push(await runShellCommand(root, item.command, timeoutMs));
  }

  return {
    ok: commands.length > 0 && results.every((result) => result.exitCode === 0),
    timeoutMs,
    results
  };
}

function normalizeTicket(ticket, entity) {
  if (ticket?.heading || ticket?.body) {
    return {
      id: ticket.id,
      title: ticket.title,
      heading: ticket.heading ?? `${ticket.id}: ${ticket.title ?? ""}`.trim(),
      body: ticket.body ?? renderEntityBody(entity),
      section: ticket.section ?? entity?.lane ?? "Todo"
    };
  }

  return {
    id: entity?.id ?? "UNKNOWN",
    title: entity?.title ?? "",
    heading: `${entity?.id ?? "UNKNOWN"}: ${entity?.title ?? ""}`.trim(),
    body: renderEntityBody(entity),
    section: entity?.lane ?? "Todo"
  };
}

async function loadPackageMeta(root) {
  const packageJsonPath = path.resolve(root, "package.json");
  let packageJson = null;

  try {
    const text = await readFile(packageJsonPath, "utf8");
    packageJson = JSON.parse(text);
  } catch {
    packageJson = null;
  }

  return {
    packageJsonPath,
    scripts: packageJson?.scripts ?? {},
    packageManager: detectPackageManager(root, packageJson?.packageManager)
  };
}

function detectPackageManager(root, packageManagerField = "") {
  const packageManager = String(packageManagerField ?? "").toLowerCase();
  if (packageManager.startsWith("pnpm") || existsSync(path.resolve(root, "pnpm-lock.yaml"))) {
    return { id: "pnpm", command: "pnpm", runScript: (name) => `pnpm -s ${name}` };
  }
  if (packageManager.startsWith("yarn") || existsSync(path.resolve(root, "yarn.lock"))) {
    return { id: "yarn", command: "yarn", runScript: (name) => `yarn ${name}` };
  }
  if (packageManager.startsWith("bun") || existsSync(path.resolve(root, "bun.lockb"))) {
    return { id: "bun", command: "bun", runScript: (name) => `bun run ${name}` };
  }
  return { id: "npm", command: "npm", runScript: (name) => `npm run --silent ${name}` };
}

function inferVerificationCommands({ root, ticket, entity, workingSet, packageMeta }) {
  const commands = [];
  const seen = new Set();
  const scripts = packageMeta.scripts;
  const packageManager = packageMeta.packageManager;
  const rawTicketText = [
    ticket?.heading,
    ticket?.body,
    entity?.data?.summary,
    entity?.data?.outcome,
    entity?.data?.verification
  ].map((value) => String(value ?? "")).join("\n");
  const ticketText = compact(rawTicketText);

  const explicitCommands = extractExplicitCommands(rawTicketText);
  for (const explicit of explicitCommands) {
    pushCommand(commands, seen, explicit, "ticket-verification");
  }

  const lowerText = ticketText.toLowerCase();
  const lowerFiles = workingSet.map((filePath) => String(filePath).toLowerCase());
  const uiTicket = lowerFiles.some((filePath) => filePath.endsWith(".riot") || filePath.startsWith("src/ui/"))
    || /\b(app-shell|overlay|modal|dialog|route|routing|session|screen|hud|ui)\b/.test(lowerText);
  const backendTicket = lowerFiles.some((filePath) => filePath.startsWith("functions/"))
    || /\b(functions|firebase|backend|server|webhook)\b/.test(lowerText);
  const docsOnly = lowerFiles.length > 0 && lowerFiles.every((filePath) => filePath.startsWith("docs/"));
  const targetedCommands = inferTargetedVerificationCommands({ root, workingSet: lowerFiles, packageMeta });
  const hasExplicitVerification = explicitCommands.length > 0;
  const hasTargetedUnit = targetedCommands.some((item) => item.source === "targeted-unit" || item.source === "targeted-node-test");
  const hasTargetedE2e = targetedCommands.some((item) => item.source === "targeted-e2e");
  const hasSourceCoverageTargets = lowerFiles.some((filePath) => filePath.startsWith("src/") || filePath.startsWith("functions/"));

  for (const targeted of targetedCommands) {
    pushCommand(commands, seen, targeted.command, targeted.source);
  }

  if (uiTicket && scripts["test:e2e"]) {
    pushCommand(commands, seen, packageManager.runScript("test:e2e"), "ui-flow");
  }
  const shouldAddBroadUnitCoverage = Boolean(
    scripts["test:unit"]
    && (
      hasTargetedUnit
      || backendTicket
      || (!hasExplicitVerification && !hasTargetedE2e && hasSourceCoverageTargets)
    )
  );
  if (shouldAddBroadUnitCoverage) {
    pushCommand(commands, seen, packageManager.runScript("test:unit"), "unit-coverage");
  }
  if ((backendTicket || uiTicket || hasSourceCoverageTargets) && scripts.build) {
    pushCommand(commands, seen, packageManager.runScript("build"), "build");
  }
  if (!commands.length && scripts.test) {
    pushCommand(commands, seen, packageManager.runScript("test"), "fallback-test");
  }
  if (!commands.length && docsOnly && scripts["workflow:audit"]) {
    pushCommand(commands, seen, packageManager.runScript("workflow:audit"), "workflow-audit");
  }

  return commands.slice(0, 4);
}

function buildConcerns({ ticket, workingSet, relevantSymbols, verificationCommands, packageMeta }) {
  const concerns = [];
  if (!workingSet.length) {
    concerns.push("empty working set");
  }
  if (!verificationCommands.length) {
    concerns.push("no verification commands inferred");
  }
  if (!Object.keys(packageMeta.scripts).length) {
    concerns.push("package scripts unavailable");
  }
  const text = `${ticket?.heading ?? ""}\n${ticket?.body ?? ""}`.toLowerCase();
  const codeTicket = /\b(bug|fix|route|overlay|modal|dialog|session|state|ui|refactor|build|compile|test)\b/.test(text);
  const hasCodeFile = workingSet.some((filePath) => /\.(m?[jt]sx?|cjs|mts|cts|riot)$/.test(String(filePath).toLowerCase()));
  if (codeTicket && !relevantSymbols.length && !hasCodeFile) {
    concerns.push("no relevant symbols");
  }
  return concerns;
}

async function expandWorkingSetHints(root, ticket, entity, workingSet) {
  const files = new Set((workingSet ?? []).map((filePath) => String(filePath).trim()).filter(Boolean));
  const text = [ticket?.heading, ticket?.body, entity?.data?.summary, entity?.data?.verification]
    .map((value) => String(value ?? ""))
    .join("\n");
  const matches = text.match(/\b(?:src|tests|functions)\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+\b/g) ?? [];

  for (const match of matches) {
    const normalized = String(match).replace(/^[./]+/, "");
    if (existsSync(path.resolve(root, normalized))) {
      files.add(normalized);
    }
  }

  return [...files];
}

function extractExplicitCommands(text) {
  const commands = [];
  const patterns = [
    /\b(?:pnpm|npm|yarn|bun)\b[^\n`]+/g,
    /`((?:pnpm|npm|yarn|bun)\b[^`]+)`/g
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = compact(match[1] ?? match[0]);
      if (value) commands.push(value);
    }
  }

  return commands;
}

function pushCommand(list, seen, command, source) {
  const normalized = compact(command);
  if (!normalized || seen.has(normalized)) return;
  seen.add(normalized);
  list.push({ command: normalized, source });
}

function inferTargetedVerificationCommands({ root, workingSet, packageMeta }) {
  const commands = [];
  const packageManagerId = packageMeta.packageManager.id;
  const playwrightMatches = classifyPlaywrightFiles(root, workingSet);
  const unitFiles = playwrightMatches.unitFiles;
  const e2eFiles = playwrightMatches.e2eFiles;

  if (packageManagerId === "pnpm" || packageManagerId === "npm" || packageManagerId === "yarn") {
    const execPrefix = packageManagerId === "pnpm"
      ? "pnpm exec"
      : packageManagerId === "yarn"
        ? "yarn exec"
        : "npx";

    const unitConfig = detectConfig(root, ["playwright.unit.config.ts", "playwright.unit.config.js", "playwright.unit.config.mjs"]);
    const e2eConfig = detectConfig(root, ["playwright.config.ts", "playwright.config.js", "playwright.config.mjs"]);

    if (unitFiles.length && unitConfig) {
      commands.push({
        command: `${execPrefix} playwright test -c ${unitConfig} ${unitFiles.slice(0, 3).join(" ")}`,
        source: "targeted-unit"
      });
    }

    if (e2eFiles.length && e2eConfig) {
      commands.push({
        command: `${execPrefix} playwright test -c ${e2eConfig} ${e2eFiles.slice(0, 3).join(" ")}`,
        source: "targeted-e2e"
      });
    }
  }

  const nodeTestFiles = workingSet.filter((filePath) => /\.(spec|test)\.(?:[cm]?js|mjs|cjs)$/.test(filePath));
  if (nodeTestFiles.length && packageMeta.scripts.test && /node\s+--test/.test(String(packageMeta.scripts.test))) {
    commands.push({
      command: `node --test ${nodeTestFiles.slice(0, 5).join(" ")}`,
      source: "targeted-node-test"
    });
  }

  return commands;
}

function detectConfig(root, names) {
  for (const name of names) {
    if (existsSync(path.resolve(root, name))) {
      return name;
    }
  }
  return null;
}

function isUnitTestFile(filePath) {
  return /(^|\/)(tests?|__tests__)\/.*(\.unit\.|\.spec\.|\.test\.)/.test(filePath) && !isE2eTestFile(filePath);
}

function isE2eTestFile(filePath) {
  return /(^|\/)(tests?|__tests__)\/.*(\.e2e\.|\/e2e\.spec\.|modal-smoke\/|scene-smoke\/|first-experience\.spec\.)/.test(filePath);
}

function classifyPlaywrightFiles(root, workingSet) {
  const candidates = workingSet.filter((filePath) => /(^|\/)(tests?|__tests__)\/.+\.(spec|test)\.[cm]?[jt]sx?$/.test(filePath));
  const unitFiles = [];
  const e2eFiles = [];
  const unitMatchers = loadPlaywrightMatchers(root, ["playwright.unit.config.ts", "playwright.unit.config.js", "playwright.unit.config.mjs"]);
  const e2eMatchers = loadPlaywrightMatchers(root, ["playwright.config.ts", "playwright.config.js", "playwright.config.mjs"]);

  for (const filePath of candidates) {
    const e2eMatch = matchesPlaywrightConfig(filePath, e2eMatchers) || isE2eTestFile(filePath);
    const unitMatch = matchesPlaywrightConfig(filePath, unitMatchers) || isUnitTestFile(filePath);

    if (e2eMatch && !unitMatch) {
      e2eFiles.push(filePath);
      continue;
    }
    if (unitMatch && !e2eMatch) {
      unitFiles.push(filePath);
      continue;
    }
    if (e2eMatch) {
      e2eFiles.push(filePath);
      continue;
    }
    if (unitMatch) {
      unitFiles.push(filePath);
    }
  }

  return {
    unitFiles,
    e2eFiles
  };
}

function loadPlaywrightMatchers(root, names) {
  const config = detectConfig(root, names);
  if (!config) return [];
  try {
    const text = readFileSync(path.resolve(root, config), "utf8");
    return extractPlaywrightTestMatches(text);
  } catch {
    return [];
  }
}

function extractPlaywrightTestMatches(text) {
  const matchers = [];
  const normalized = String(text ?? "");
  const arrayMatches = normalized.match(/testMatch\s*:\s*\[([\s\S]*?)\]/m);
  if (arrayMatches?.[1]) {
    for (const item of arrayMatches[1].matchAll(/['"`]([^'"`]+)['"`]/g)) {
      matchers.push(item[1]);
    }
  }

  const singleMatches = normalized.matchAll(/testMatch\s*:\s*['"`]([^'"`]+)['"`]/g);
  for (const item of singleMatches) {
    matchers.push(item[1]);
  }

  return [...new Set(matchers)];
}

function matchesPlaywrightConfig(filePath, matchers) {
  if (!matchers.length) return false;
  const normalized = String(filePath ?? "").replace(/\\/g, "/");
  return matchers.some((matcher) => globLikeMatch(normalized, matcher));
}

function globLikeMatch(filePath, matcher) {
  const normalizedMatcher = String(matcher ?? "").replace(/\\/g, "/").trim();
  if (!normalizedMatcher) return false;
  const basename = path.posix.basename(filePath);
  const simple = normalizedMatcher
    .replace(/^\.\//, "")
    .replace(/^\*\*\//, "");

  if (!/[*?[\]{}]/.test(simple)) {
    return filePath === simple || basename === simple || filePath.endsWith(`/${simple}`);
  }

  const regex = new RegExp(`^${globToRegexSource(normalizedMatcher)}$`);
  return regex.test(filePath);
}

function globToRegexSource(value) {
  const input = String(value ?? "");
  let source = "";

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
      continue;
    }
    if (char === "*") {
      source += "[^/]*";
      continue;
    }
    if (char === "?") {
      source += ".";
      continue;
    }
    if ("|\\{}()[\]^$+.".includes(char)) {
      source += `\\${char}`;
      continue;
    }
    source += char;
  }

  return source;
}

function renderEntityBody(entity) {
  if (!entity) return "";
  const lines = [];
  if (entity.data?.summary) lines.push(String(entity.data.summary));
  if (entity.data?.outcome) lines.push(`Outcome: ${entity.data.outcome}`);
  if (entity.data?.verification) lines.push(`Verification: ${entity.data.verification}`);
  if (entity.data?.epic) lines.push(`Epic: ${entity.data.epic}`);
  return lines.join("\n");
}

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function clampTimeout(value) {
  const parsed = Number.parseInt(String(value ?? DEFAULT_TIMEOUT_MS), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.max(5_000, Math.min(parsed, 30 * 60 * 1000));
}

function runShellCommand(root, command, timeoutMs) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, {
      cwd: root,
      shell: true,
      env: process.env
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        command,
        exitCode: timedOut ? 124 : (exitCode ?? 1),
        durationMs: Date.now() - startedAt,
        timedOut,
        snippet: summarizeOutput(stdout, stderr)
      });
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        command,
        exitCode: 1,
        durationMs: Date.now() - startedAt,
        timedOut: false,
        snippet: error.message
      });
    });
  });
}

function summarizeOutput(stdout, stderr) {
  const snippet = `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(" | ")
    .slice(0, 320);

  return snippet || "no stdout/stderr captured";
}
