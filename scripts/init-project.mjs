#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { chmod, copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";

const HELP = `Usage:
  node scripts/init-project.mjs --target /path/to/project

Options:
  --target <path>    Target project root. Defaults to current directory.
  --force            Overwrite existing non-empty files.
  --dry-run          Show what would change without writing files.
`;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const templatesRoot = path.resolve(repoRoot, "templates");
const runtimeRoot = path.resolve(repoRoot, "runtime", "scripts", "codex-workflow");

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printAndExit(HELP);
}

const targetRoot = path.resolve(String(args.target ?? process.cwd()));
const force = Boolean(args.force);
const dryRun = Boolean(args["dry-run"]);

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
    source: path.resolve(templatesRoot, "kanban.md"),
    target: path.resolve(targetRoot, "kanban.md")
  },
  {
    source: path.resolve(templatesRoot, "project-guidelines.md"),
    target: path.resolve(targetRoot, "project-guidelines.md")
  },
  {
    source: path.resolve(templatesRoot, "knowledge.md"),
    target: path.resolve(targetRoot, "knowledge.md")
  },
  ...(await buildRuntimePlan(runtimeRoot, path.resolve(targetRoot, "scripts", "codex-workflow")))
];

const summary = {
  installed: [],
  overwritten: [],
  skipped: [],
  identical: []
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
const lines = [];
lines.push(`Target: ${targetRoot}`);
lines.push(`Mode: ${dryRun ? "dry-run" : "write"}`);
lines.push(`JS/TS project hint: ${looksLikeJsProject ? "package.json found" : "package.json not found"}`);
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

if (summary.skipped.length) {
  lines.push("");
  lines.push("Re-run with --force to overwrite skipped files.");
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
