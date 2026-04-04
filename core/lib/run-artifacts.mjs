import path from "node:path";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { ensureDir } from "../../runtime/scripts/ai-workflow/lib/fs-utils.mjs";

export async function recordRunArtifact(projectRoot, artifact) {
  const stateDir = path.resolve(projectRoot, ".ai-workflow", "state", "run-artifacts");
  await ensureDir(stateDir);
  const recordedAt = new Date().toISOString();
  const id = artifact?.id ? String(artifact.id) : `run-${recordedAt.replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const payload = {
    id,
    recordedAt,
    ...artifact
  };
  await writeFile(path.resolve(stateDir, `${id}.json`), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await writeFile(path.resolve(stateDir, "latest.json"), `${JSON.stringify({ id, recordedAt }, null, 2)}\n`, "utf8");
  return payload;
}

export async function readLatestRunArtifact(projectRoot) {
  const stateDir = path.resolve(projectRoot, ".ai-workflow", "state", "run-artifacts");
  try {
    const latest = JSON.parse(await readFile(path.resolve(stateDir, "latest.json"), "utf8"));
    const payload = JSON.parse(await readFile(path.resolve(stateDir, `${latest.id}.json`), "utf8"));
    return payload;
  } catch {
    return null;
  }
}
