import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function isGitRepo(root) {
  try {
    await runGit(root, ["rev-parse", "--show-toplevel"]);
    return true;
  } catch {
    return false;
  }
}

export async function getChanges(root, base) {
  if (base) {
    const output = await runGit(root, ["diff", "--name-status", "--find-renames", `${base}...HEAD`]);
    return parseNameStatus(output);
  }

  const output = await runGit(root, ["status", "--short", "--untracked-files=all"]);
  return parseStatusShort(output);
}

async function runGit(root, args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    maxBuffer: 8 * 1024 * 1024
  });
  return stdout.trimEnd();
}

function parseNameStatus(output) {
  if (!output.trim()) {
    return [];
  }

  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [rawStatus, ...rest] = line.split("\t");
      const path = rest.at(-1) ?? "";
      return {
        status: normalizeStatus(rawStatus),
        rawStatus,
        path
      };
    });
}

function parseStatusShort(output) {
  if (!output.trim()) {
    return [];
  }

  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const rawStatus = line.slice(0, 2);
      const rawPath = line.slice(3).trim();
      const path = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1) : rawPath;
      return {
        status: normalizeStatus(rawStatus),
        rawStatus: rawStatus.trim() || rawStatus,
        path
      };
    });
}

function normalizeStatus(rawStatus) {
  const value = rawStatus.trim();

  if (value === "??") {
    return "untracked";
  }

  if (value.includes("D")) {
    return "deleted";
  }

  if (value.includes("R")) {
    return "renamed";
  }

  if (value.includes("A")) {
    return "added";
  }

  if (value.includes("M")) {
    return "modified";
  }

  return value || "unknown";
}
