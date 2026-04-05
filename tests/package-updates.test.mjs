import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { buildPackageUpdateAdvisory } from "../core/services/package-updates.mjs";

test("buildPackageUpdateAdvisory reports current and latest versions for ai-workflow and lean-ctx", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-workflow-package-updates-"));
  const originalFetch = globalThis.fetch;
  const requested = [];

  globalThis.fetch = async (url) => {
    requested.push(String(url));
    if (String(url).includes("%40dharmax%2Fai-workflow")) {
      return {
        ok: true,
        async json() {
          return { version: "0.1.99" };
        }
      };
    }
    if (String(url).includes("lean-ctx")) {
      return {
        ok: true,
        async json() {
          return { version: "0.9.0" };
        }
      };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      name: "ai-workflow-test",
      version: "0.1.0"
    }), "utf8");

    const report = await buildPackageUpdateAdvisory({
      root,
      leanCtxVersion: "0.8.0",
      forceRefresh: true
    });

    assert.equal(report.packages.length, 2);
    assert.equal(report.packages[0].name, "@dharmax/ai-workflow");
    assert.equal(report.packages[0].currentVersion, "0.1.0");
    assert.equal(report.packages[0].latestVersion, "0.1.99");
    assert.equal(report.packages[0].status, "update-available");
    assert.equal(report.packages[1].name, "lean-ctx");
    assert.equal(report.packages[1].currentVersion, "0.8.0");
    assert.equal(report.packages[1].latestVersion, "0.9.0");
    assert.match(report.comment, /Upgrade check/);
    assert.match(report.comment, /lean-ctx/);
    assert.equal(requested.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});
