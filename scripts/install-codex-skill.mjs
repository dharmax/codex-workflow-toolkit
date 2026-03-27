#!/usr/bin/env node
import path from "node:path";
import os from "node:os";
import { chmod, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const force = argv.includes("--force");
const destIndex = argv.indexOf("--dest");
const destRoot = destIndex >= 0 && argv[destIndex + 1]
  ? path.resolve(argv[destIndex + 1])
  : path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "skills");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.resolve(repoRoot, "skills", "ai-workflow");
const destDir = path.resolve(destRoot, "ai-workflow");

await mkdir(destRoot, { recursive: true });
if (force) {
  await rm(destDir, { recursive: true, force: true });
}
await cp(sourceDir, destDir, { recursive: true, errorOnExist: !force, force });
await chmod(path.resolve(destDir, "scripts", "ai_workflow.sh"), 0o755);
await writeFile(path.resolve(destDir, "toolkit-root.txt"), `${repoRoot}\n`, "utf8");

process.stdout.write(`${destDir}\n`);
