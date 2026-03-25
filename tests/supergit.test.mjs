import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { withSupergitTransaction } from "../core/services/supergit.mjs";

const execFileAsync = promisify(execFile);

async function initGit(root) {
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@test.com"], { cwd: root });
  await writeFile(path.join(root, "file.txt"), "initial", "utf8");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "init"], { cwd: root });
}

test("withSupergitTransaction auto-stashes dirty working tree and restores it on failure", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "supergit-test-"));

  try {
    await initGit(targetRoot);

    // Make dirty tree
    await writeFile(path.join(targetRoot, "dirty.txt"), "dirty content", "utf8");
    await execFileAsync("git", ["add", "dirty.txt"], { cwd: targetRoot });

    const result = await withSupergitTransaction(targetRoot, "test-fail", async () => {
      // Create a file in the temp branch
      await writeFile(path.join(targetRoot, "temp.txt"), "temp", "utf8");
      return { success: false, error: "Deliberate failure" };
    });

    assert.equal(result.success, false);
    assert.equal(result.error, "Deliberate failure");

    // Check that dirty tree is restored
    const status = await execFileAsync("git", ["status", "--porcelain"], { cwd: targetRoot });
    assert.match(status.stdout, /A  dirty.txt/);

    // Check that temp.txt is gone (it was in the deleted temp branch and never committed/merged)
    let tempExists = true;
    try {
      await import("node:fs/promises").then(m => m.access(path.join(targetRoot, "temp.txt")));
    } catch {
      tempExists = false;
    }
    assert.equal(tempExists, false);

  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("withSupergitTransaction merges successful operations", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "supergit-test-2-"));

  try {
    await initGit(targetRoot);

    const result = await withSupergitTransaction(targetRoot, "test-success", async () => {
      await writeFile(path.join(targetRoot, "success.txt"), "success", "utf8");
      return { success: true };
    });

    assert.equal(result.success, true);

    const status = await execFileAsync("git", ["status", "--porcelain"], { cwd: targetRoot });
    assert.equal(status.stdout.trim(), ""); // working tree should be clean after commit

    const log = await execFileAsync("git", ["log", "--oneline"], { cwd: targetRoot });
    assert.match(log.stdout, /Auto-merge successful operation/);
    assert.match(log.stdout, /Auto-fix for test-success/);

  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});
