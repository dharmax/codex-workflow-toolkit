import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
let guardDepth = 0;

export function isWorkspaceMutationGuardDisabled() {
  return guardDepth > 0;
}

export async function withWorkspaceMutationGuardDisabled(callback) {
  guardDepth += 1;
  try {
    return await callback();
  } finally {
    guardDepth = Math.max(0, guardDepth - 1);
  }
}

export async function withWorkspaceMutation(root, operation, callback, { writeProjections = true, syncAfter = true, syncBefore = true } = {}) {
  if (isWorkspaceMutationGuardDisabled()) {
    return callback({
      nested: true,
      operation,
      before: null
    });
  }

  guardDepth += 1;
  try {
    const before = await probeWorkspaceState(root).catch(() => ({
      gitRepo: false,
      dirty: true,
      changedFiles: [],
      source: "probe-error"
    }));

    if (syncBefore && before.dirty) {
      const { syncProject } = await import("../services/sync.mjs");
      await syncProject({ projectRoot: root, writeProjections: false }).catch(() => {});
    }

    let result;
    let failed = null;
    try {
      result = await callback({
        before,
        operation
      });
      return result;
    } catch (error) {
      failed = error;
      throw error;
    } finally {
      const after = await probeWorkspaceState(root).catch(() => ({
        gitRepo: false,
        dirty: true,
        changedFiles: [],
        source: "probe-error"
      }));

      if (syncAfter && (before.dirty || after.dirty || !before.gitRepo || !after.gitRepo || failed)) {
        const { syncProject } = await import("../services/sync.mjs");
        await syncProject({ projectRoot: root, writeProjections }).catch(() => {});
      }
    }
  } finally {
    guardDepth = Math.max(0, guardDepth - 1);
  }
}

export async function probeWorkspaceState(root) {
  const gitRepo = await probeGitRepo(root);
  if (!gitRepo) {
    return {
      gitRepo: false,
      dirty: true,
      changedFiles: [],
      source: "snapshot-required"
    };
  }

  const output = await runGit(root, ["status", "--porcelain", "--untracked-files=all"]);
  const changedFiles = parseStatusShort(output);
  return {
    gitRepo: true,
    dirty: changedFiles.length > 0,
    changedFiles,
    source: "git"
  };
}

async function probeGitRepo(root) {
  try {
    const output = await runGit(root, ["rev-parse", "--is-inside-work-tree"]);
    return output.trim() === "true";
  } catch {
    return false;
  }
}

async function runGit(root, args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    maxBuffer: 8 * 1024 * 1024
  });
  return String(stdout ?? "").trimEnd();
}

function parseStatusShort(output) {
  return String(output ?? "")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
}
