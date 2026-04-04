#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { chmod, copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { syncProject } from "../core/services/sync.mjs";
import { onboardProjectBrief } from "../core/services/orchestrator.mjs";

const HELP = `Usage:
  node scripts/init-project.mjs --target /path/to/project

Options:
  --target <path>    Target project root. Defaults to current directory.
  --brief <file>     Run project-brief onboarding after install.
  --force            Overwrite existing non-empty files.
  --dry-run          Show what would change without writing files.
  --no-sync          Skip the initial workflow DB sync.
`;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const templatesRoot = path.resolve(repoRoot, "templates");
const runtimeRoot = path.resolve(repoRoot, "runtime", "scripts", "ai-workflow");
const WORKFLOW_PACKAGE_SCRIPTS = {
  "workflow:kanban": "node scripts/ai-workflow/kanban.mjs",
  "workflow:ticket": "node scripts/ai-workflow/kanban-ticket.mjs",
  "workflow:guidance": "node scripts/ai-workflow/guidance-summary.mjs",
  "workflow:review": "node scripts/ai-workflow/review-summary.mjs",
  "workflow:verify": "node scripts/ai-workflow/verification-summary.mjs",
  "workflow:guideline-audit": "node scripts/ai-workflow/guideline-audit.mjs",
  "workflow:audit": "node scripts/ai-workflow/workflow-audit.mjs"
};

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printAndExit(HELP);
}

const targetRoot = path.resolve(String(args.target ?? process.cwd()));
const force = Boolean(args.force);
const dryRun = Boolean(args["dry-run"]);
const runInitialSync = !dryRun && !args["no-sync"];
const briefSource = args.brief ? path.resolve(targetRoot, String(args.brief)) : null;

const plan = [
  {
    source: path.resolve(templatesRoot, "AGENTS.md"),
    target: path.resolve(targetRoot, "AGENTS.md")
  },
  {
    source: path.resolve(templatesRoot, "CONTRIBUTING.md"),
    target: path.resolve(targetRoot, "CONTRIBUTING.md")
  },
  {
    source: path.resolve(templatesRoot, "execution-protocol.md"),
    target: path.resolve(targetRoot, "execution-protocol.md")
  },
  {
    source: path.resolve(templatesRoot, "enforcement.md"),
    target: path.resolve(targetRoot, "enforcement.md")
  },
  {
    source: path.resolve(templatesRoot, "kanban.md"),
    target: path.resolve(targetRoot, "kanban.md")
  },
  {
    source: path.resolve(templatesRoot, "kanban-archive.md"),
    target: path.resolve(targetRoot, "kanban-archive.md")
  },
  {
    source: path.resolve(templatesRoot, "epics.md"),
    target: path.resolve(targetRoot, "epics.md")
  },
  {
    source: path.resolve(templatesRoot, "project-guidelines.md"),
    target: path.resolve(targetRoot, "project-guidelines.md")
  },
  {
    source: path.resolve(templatesRoot, "knowledge.md"),
    target: path.resolve(targetRoot, "knowledge.md")
  },
  {
    source: path.resolve(templatesRoot, ".github", "workflows", "ai-workflow-audit.yml"),
    target: path.resolve(targetRoot, ".github", "workflows", "ai-workflow-audit.yml")
  },
  ...(await buildRuntimePlan(runtimeRoot, path.resolve(targetRoot, "scripts", "ai-workflow")))
];

const summary = {
  installed: [],
  overwritten: [],
  skipped: [],
  identical: [],
  packageScripts: {
    installed: [],
    overwritten: [],
    skipped: [],
    identical: [],
    error: null
  }
};

await mkdir(targetRoot, { recursive: true });

for (const entry of plan) {
  const action = await classifyAction(entry.source, entry.target, force);

  if (action.type === "identical") {
    summary.identical.push(relativeTarget(targetRoot, entry.target));
    continue;
  }

  if (action.type === "skip") {
    summary.skipped.push(relativeTarget(targetRoot, entry.target));
    continue;
  }

  if (!dryRun) {
    await mkdir(path.dirname(entry.target), { recursive: true });
    await copyFile(entry.source, entry.target);
    if (entry.target.endsWith(".mjs")) {
      await chmod(entry.target, 0o755).catch(() => {});
    }
  }

  const relative = relativeTarget(targetRoot, entry.target);
  if (action.type === "overwrite") {
    summary.overwritten.push(relative);
  } else {
    summary.installed.push(relative);
  }
}

const looksLikeJsProject = await fileExists(path.resolve(targetRoot, "package.json"));
if (looksLikeJsProject) {
  await reconcilePackageScripts(targetRoot, summary.packageScripts, { force, dryRun });
}

let syncResult = null;
if (runInitialSync) {
  syncResult = await syncProject({ projectRoot: targetRoot });
}

let briefResult = null;
if (!dryRun && briefSource) {
  const briefRl = readline.createInterface({ input, output });
  try {
    briefResult = await onboardProjectBrief(briefSource, { root: targetRoot, rl: briefRl });
  } finally {
    briefRl.close();
  }
}

const lines = [];
lines.push(`Target: ${targetRoot}`);
lines.push(`Mode: ${dryRun ? "dry-run" : "write"}`);
lines.push(`JS/TS project hint: ${looksLikeJsProject ? "package.json found" : "package.json not found"}`);
lines.push(`Initial sync: ${dryRun ? "skipped (dry-run)" : args["no-sync"] ? "disabled" : "completed"}`);
lines.push("");
lines.push(`Installed: ${summary.installed.length}`);
for (const item of summary.installed) {
  lines.push(`- ${item}`);
}
lines.push("");
lines.push(`Overwritten: ${summary.overwritten.length}`);
for (const item of summary.overwritten) {
  lines.push(`- ${item}`);
}
lines.push("");
lines.push(`Skipped existing: ${summary.skipped.length}`);
for (const item of summary.skipped) {
  lines.push(`- ${item}`);
}
lines.push("");
lines.push(`Identical: ${summary.identical.length}`);

if (looksLikeJsProject) {
  lines.push("");
  lines.push(`Package scripts installed: ${summary.packageScripts.installed.length}`);
  for (const item of summary.packageScripts.installed) {
    lines.push(`- ${item}`);
  }
  lines.push("");
  lines.push(`Package scripts overwritten: ${summary.packageScripts.overwritten.length}`);
  for (const item of summary.packageScripts.overwritten) {
    lines.push(`- ${item}`);
  }
  lines.push("");
  lines.push(`Package scripts skipped: ${summary.packageScripts.skipped.length}`);
  for (const item of summary.packageScripts.skipped) {
    lines.push(`- ${item}`);
  }
  lines.push("");
  lines.push(`Package scripts identical: ${summary.packageScripts.identical.length}`);

  if (summary.packageScripts.error) {
    lines.push("");
    lines.push(`Package scripts error: ${summary.packageScripts.error}`);
  }
}

if (summary.skipped.length) {
  lines.push("");
  lines.push("Re-run with --force to overwrite skipped files.");
}

if (summary.packageScripts.skipped.length) {
  lines.push("");
  lines.push("Re-run with --force to overwrite skipped package scripts.");
}

if (syncResult) {
  lines.push("");
  lines.push(`DB: ${syncResult.dbPath}`);
  lines.push(`Indexed files: ${syncResult.indexedFiles}`);
  lines.push(`Symbols: ${syncResult.indexedSymbols}`);
  lines.push(`Claims: ${syncResult.indexedClaims}`);
  lines.push(`Notes: ${syncResult.indexedNotes}`);
}

if (briefResult) {
  lines.push("");
  lines.push(`Onboarded brief: ${briefResult.briefPath}`);
  lines.push(`Generated epic: ${briefResult.epic.id} (${briefResult.tickets.length} tickets)`);
}

process.stdout.write(`${lines.join("\n")}\n`);

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (!value.startsWith("--")) {
      continue;
    }

    const trimmed = value.slice(2);
    const equalIndex = trimmed.indexOf("=");

    if (equalIndex >= 0) {
      parsed[trimmed.slice(0, equalIndex)] = trimmed.slice(equalIndex + 1);
      continue;
    }

    const nextValue = argv[index + 1];
    if (nextValue && !nextValue.startsWith("--")) {
      parsed[trimmed] = nextValue;
      index += 1;
      continue;
    }

    parsed[trimmed] = true;
  }

  return parsed;
}

function printAndExit(message, code = 0) {
  const stream = code === 0 ? process.stdout : process.stderr;
  stream.write(`${message}\n`);
  process.exit(code);
}

async function buildRuntimePlan(sourceRoot, targetRootPath) {
  const entries = await walkFiles(sourceRoot);
  return entries.map((sourcePath) => ({
    source: sourcePath,
    target: path.resolve(targetRootPath, path.relative(sourceRoot, sourcePath))
  }));
}

async function walkFiles(rootPath) {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.resolve(rootPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await walkFiles(fullPath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

async function classifyAction(sourcePath, targetPath, forceOverwrite) {
  const sourceContent = await readFile(sourcePath, "utf8");

  if (!(await fileExists(targetPath))) {
    return { type: "install" };
  }

  const targetContent = await readFile(targetPath, "utf8");

  if (targetContent === sourceContent) {
    return { type: "identical" };
  }

  if (!targetContent.trim()) {
    return { type: "overwrite" };
  }

  if (forceOverwrite) {
    return { type: "overwrite" };
  }

  return { type: "skip" };
}

async function fileExists(filePath) {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch {
    return false;
  }
}

function relativeTarget(rootPath, targetPath) {
  return path.relative(rootPath, targetPath) || ".";
}

async function reconcilePackageScripts(targetRootPath, packageSummary, options) {
  const packageJsonPath = path.resolve(targetRootPath, "package.json");
  let packageJson;

  try {
    packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  } catch (error) {
    packageSummary.error = `Could not parse package.json (${error.message})`;
    return;
  }

  const scripts = packageJson.scripts && typeof packageJson.scripts === "object" ? packageJson.scripts : {};
  let changed = false;

  for (const [scriptName, command] of Object.entries(WORKFLOW_PACKAGE_SCRIPTS)) {
    const existing = scripts[scriptName];

    if (existing === undefined) {
      scripts[scriptName] = command;
      packageSummary.installed.push(scriptName);
      changed = true;
      continue;
    }

    if (existing === command) {
      packageSummary.identical.push(scriptName);
      continue;
    }

    if (options.force) {
      scripts[scriptName] = command;
      packageSummary.overwritten.push(scriptName);
      changed = true;
      continue;
    }

    packageSummary.skipped.push(scriptName);
  }

  if (!changed || options.dryRun) {
    return;
  }

  packageJson.scripts = sortObjectKeys(scripts);
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
}

function sortObjectKeys(value) {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
  );
}
