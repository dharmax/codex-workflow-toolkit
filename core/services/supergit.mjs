import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function runGit(args, { root = process.cwd() } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, { cwd: root });
    return { ok: true, stdout, stderr };
  } catch (error) {
    return { ok: false, error: error.message, stdout: error.stdout, stderr: error.stderr };
  }
}

/**
 * Executes a potentially destructive operation in a safe, isolated Git transaction.
 * Pipeline: Auto-Stash -> Temp Branch -> Execute -> (Merge on Success) -> Auto-Pop
 */
export async function withSupergitTransaction(root, taskName, operation) {
  // 1. Check if clean
  const status = await runGit(["status", "--porcelain"], { root });
  const isClean = status.ok && status.stdout.trim() === "";
  
  // 2. Auto-Stash if dirty
  let stashed = false;
  if (!isClean) {
    await runGit(["stash", "push", "-u", "-m", `supergit-auto-stash-before-${taskName}`], { root });
    stashed = true;
  }

  // Keep track of the original branch
  const branchInfo = await runGit(["branch", "--show-current"], { root });
  const originalBranch = branchInfo.ok ? branchInfo.stdout.trim() : "master";

  // 3. Create Temp Branch
  const safeTaskName = taskName.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase();
  const tempBranch = `supergit-temp-${safeTaskName}-${Date.now()}`;
  await runGit(["checkout", "-b", tempBranch], { root });

  let success = false;
  let operationResult = null;

  try {
    // 4. Run operation (must return { success: boolean, ... })
    operationResult = await operation();
    success = operationResult?.success === true;

    // If successful, commit the changes in the temp branch so we can merge them
    if (success) {
      const diffStatus = await runGit(["status", "--porcelain"], { root });
      if (diffStatus.ok && diffStatus.stdout.trim() !== "") {
        await runGit(["add", "."], { root });
        await runGit(["commit", "-m", `Auto-fix for ${taskName}`], { root });
      }
    }
  } catch (err) {
    success = false;
    operationResult = { success: false, error: err.message };
  } finally {
    // 5. Cleanup
    await runGit(["checkout", originalBranch], { root });

    if (success) {
      // Merge Temp Branch
      const merge = await runGit(["merge", tempBranch, "--no-ff", "-m", `Auto-merge successful operation: ${taskName}`], { root });
      if (!merge.ok) {
        await runGit(["merge", "--abort"], { root });
        success = false;
        operationResult = { success: false, error: "Failed to merge temp branch cleanly" };
      }
    }

    if (!success) {
      // If failed, nuke any untracked garbage the AI might have left behind
      // before we attempt to restore the original state.
      await runGit(["reset", "--hard", "HEAD"], { root });
      await runGit(["clean", "-fd"], { root });
    }

    // Delete temp branch (force delete)
    await runGit(["branch", "-D", tempBranch], { root });

    // 6. Auto-Pop stash if we stashed
    if (stashed) {
      await runGit(["stash", "pop"], { root });
    }
  }

  return operationResult;
}
