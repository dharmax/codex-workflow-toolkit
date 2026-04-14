import path from "node:path";
import { writeFile } from "node:fs/promises";
import { ensureDir } from "../../runtime/scripts/ai-workflow/lib/fs-utils.mjs";
import { getProjectConfigPath, readConfig } from "./config-store.mjs";
import { withWorkspaceMutation } from "../../core/lib/workspace-mutation.mjs";

export async function installAgents({ toolkitRoot, projectRoot = process.cwd() }) {
  return withWorkspaceMutation(projectRoot, "install agents", async () => {
    const results = [];

    await ensureDir(path.resolve(projectRoot, ".ai-workflow"));
    await ensureDir(path.resolve(projectRoot, ".ai-workflow", "codelets"));
    await ensureDir(path.resolve(projectRoot, ".ai-workflow", "cache"));
    await ensureDir(path.resolve(projectRoot, ".ai-workflow", "generated"));
    await ensureDir(path.resolve(projectRoot, ".ai-workflow", "notes"));
    await ensureDir(path.resolve(projectRoot, ".ai-workflow", "state"));

    results.push({ path: ".ai-workflow", status: "created" });

    await ensureProjectConfig(projectRoot, toolkitRoot);
    return results;
  });
}

async function ensureProjectConfig(projectRoot) {
  const configPath = getProjectConfigPath(projectRoot);
  const existing = await readConfig(configPath);
  const nextConfig = {
    ...existing,
    storage: {
      dbPath: ".ai-workflow/state/workflow.db",
      ...(existing.storage ?? {})
    },
    lifecycle: {
      candidateReviewIntervalHours: 36,
      ...(existing.lifecycle ?? {})
    },
    hooks: {
      BeforePlan: [],
      AfterPlan: [],
      BeforeAction: [],
      AfterAction: [],
      ...(existing.hooks ?? {})
    },
    providers: existing.providers ?? {},
    routing: existing.routing ?? {}
  };
  await writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
}
