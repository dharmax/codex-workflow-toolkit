import path from "node:path";
import { lstat, mkdir, readlink, symlink, unlink, writeFile } from "node:fs/promises";
import { ensureDir } from "../../runtime/scripts/codex-workflow/lib/fs-utils.mjs";
import { getProjectConfigPath, readConfig } from "./config-store.mjs";

const AGENT_DIRS = {
  codex: ".codex",
  claude: ".claude",
  gemini: ".gemini"
};

export async function installAgents({ toolkitRoot, projectRoot = process.cwd(), target = "all" }) {
  const agents = normalizeTarget(target);
  const results = [];

  await ensureDir(path.resolve(projectRoot, ".ai-workflow"));
  await ensureDir(path.resolve(projectRoot, ".ai-workflow", "codelets"));
  await ensureDir(path.resolve(projectRoot, ".ai-workflow", "cache"));
  await ensureDir(path.resolve(projectRoot, ".ai-workflow", "generated"));
  await ensureDir(path.resolve(projectRoot, ".ai-workflow", "notes"));
  await ensureDir(path.resolve(projectRoot, ".ai-workflow", "state"));

  for (const agent of agents) {
    const agentDir = path.resolve(projectRoot, AGENT_DIRS[agent]);
    const linkPath = path.resolve(agentDir, "skills");
    const targetPath = path.resolve(toolkitRoot, "skills", agent);
    await mkdir(agentDir, { recursive: true });
    results.push(await ensureSymlink(linkPath, targetPath));
  }

  await ensureProjectConfig(projectRoot, toolkitRoot, agents);
  return results;
}

function normalizeTarget(target) {
  if (target === "all") {
    return ["codex", "claude", "gemini"];
  }

  if (!(target in AGENT_DIRS)) {
    throw new Error(`Unknown install target: ${target}`);
  }

  return [target];
}

async function ensureSymlink(linkPath, targetPath) {
  try {
    const stat = await lstat(linkPath);

    if (stat.isSymbolicLink()) {
      const current = await readlink(linkPath);
      const resolved = path.resolve(path.dirname(linkPath), current);
      if (resolved === targetPath) {
        return { path: linkPath, target: targetPath, status: "identical" };
      }

      await unlink(linkPath);
      await symlink(targetPath, linkPath, "dir");
      return { path: linkPath, target: targetPath, status: "relinked" };
    }

    return { path: linkPath, target: targetPath, status: "skipped", reason: "path already exists and was not replaced" };
  } catch (error) {
    if (!error || error.code !== "ENOENT") {
      throw error;
    }
  }

  await symlink(targetPath, linkPath, "dir");
  return { path: linkPath, target: targetPath, status: "linked" };
}

async function ensureProjectConfig(projectRoot, toolkitRoot, agents) {
  const configPath = getProjectConfigPath(projectRoot);
  const existing = await readConfig(configPath);
  const installedAgents = [...new Set([...(existing.installedAgents ?? []), ...agents])].sort();
  const nextConfig = {
    ...existing,
    toolkitRoot,
    installedAgents,
    storage: {
      dbPath: ".ai-workflow/state/workflow.db",
      ...(existing.storage ?? {})
    },
    lifecycle: {
      candidateReviewIntervalHours: 36,
      ...(existing.lifecycle ?? {})
    },
    providers: existing.providers ?? {},
    routing: {
      preferLocalFor: ["summarization", "extraction", "classification", "clustering", "ranking", "note-normalization"],
      minimumQuality: {
        extraction: "medium",
        summarization: "medium",
        classification: "medium",
        clustering: "medium",
        ranking: "medium",
        "candidate-review": "medium",
        naming: "medium",
        "architectural-reasoning": "high",
        "risky-planning": "high",
        "code-generation": "high",
        review: "high"
      },
      ...(existing.routing ?? {})
    }
  };
  await writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
}
