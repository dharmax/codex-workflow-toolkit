import path from "node:path";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { ensureDir } from "../../runtime/scripts/codex-workflow/lib/fs-utils.mjs";

export function getProjectCodeletsDir(root = process.cwd()) {
  return path.resolve(root, ".ai-workflow", "codelets");
}

export async function listProjectCodelets(root = process.cwd()) {
  const codeletsDir = getProjectCodeletsDir(root);

  try {
    const entries = await readdir(codeletsDir, { withFileTypes: true });
    const manifests = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      const filePath = path.resolve(codeletsDir, entry.name);
      const manifest = JSON.parse(await readFile(filePath, "utf8"));
      manifests.push({
        ...manifest,
        manifestPath: filePath
      });
    }

    return manifests.sort((left, right) => String(left.id).localeCompare(String(right.id)));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

export async function getProjectCodelet(root, name) {
  const manifestPath = path.resolve(getProjectCodeletsDir(root), `${name}.json`);

  try {
    return {
      ...(JSON.parse(await readFile(manifestPath, "utf8"))),
      manifestPath
    };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function upsertProjectCodelet(root, name, filePath, mode) {
  const codeletsDir = getProjectCodeletsDir(root);
  const manifestPath = path.resolve(codeletsDir, `${name}.json`);
  const relativeEntry = path.relative(root, path.resolve(root, filePath)).split(path.sep).join("/");
  const existing = await getProjectCodelet(root, name);

  const manifest = {
    id: name,
    summary: existing?.summary ?? `${mode === "add" ? "Staged" : "Updated"} project codelet.`,
    runner: "node-script",
    entry: relativeEntry,
    stability: "staged",
    status: "staged"
  };

  await ensureDir(codeletsDir);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { ...manifest, manifestPath };
}

export async function removeProjectCodelet(root, name) {
  const manifestPath = path.resolve(getProjectCodeletsDir(root), `${name}.json`);
  await rm(manifestPath, { force: true });
}

export async function forgeProjectCodelet(root, name) {
  const stagedDir = path.resolve(root, ".ai-workflow", "staged-codelets");
  const entryPath = path.resolve(stagedDir, `${name}.mjs`);
  const manifest = await upsertProjectCodelet(root, name, entryPath, "add");
  const source = [
    "/* Responsibility: Project-local staged codelet for bounded low-risk helper work.",
    "Scope: Keep this deterministic and review it before treating it as a stable built-in. */",
    "import process from \"node:process\";",
    "",
    "const args = process.argv.slice(2);",
    `process.stdout.write(JSON.stringify({ codelet: ${JSON.stringify(name)}, args }, null, 2) + \"\\n\");`
  ].join("\n");

  await ensureDir(stagedDir);
  await writeFile(entryPath, `${source}\n`, "utf8");
  return {
    ...manifest,
    entryPath
  };
}
