import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { judgeArtifacts } from "../core/services/artifact-verification.mjs";
import { runVerificationSummary } from "../runtime/scripts/ai-workflow/verification-summary.mjs";
import { registerProvider } from "../core/services/providers.mjs";

const TINY_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP+9X6pNwAAAABJRU5ErkJggg==";

test("artifact judge passes text and image evidence through structured content parts", { concurrency: false }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "artifact-judge-"));
  const providerId = `mock-artifact-judge-${Date.now()}`;

  try {
    await mkdir(path.join(root, ".ai-workflow"), { recursive: true });
    await writeFile(path.join(root, ".ai-workflow", "config.json"), JSON.stringify({
      providers: {
        ollama: {
          enabled: false
        }
      }
    }, null, 2), "utf8");
    await mkdir(path.join(root, "docs"), { recursive: true });
    await mkdir(path.join(root, "screenshots"), { recursive: true });
    await writeFile(path.join(root, "docs", "review.md"), "# Design review\n\nThe artifact looks good.\n", "utf8");
    await writeFile(path.join(root, "screenshots", "layout.png"), Buffer.from(TINY_PNG_BASE64, "base64"));

    registerProvider(providerId, {
      generate: async ({ modelId, prompt, contentParts }) => {
        assert.equal(modelId, "judge-v1");
        assert.match(prompt, /Judge the supplied artifacts/);
        assert.equal(Array.isArray(contentParts), true);
        assert.equal(contentParts.some((part) => part.type === "image"), true);
        assert.equal(contentParts.some((part) => part.type === "text"), true);

        return {
          providerId,
          modelId,
          response: JSON.stringify({
            status: "pass",
            score: 94,
            confidence: 0.98,
            summary: "The artifacts satisfy the rubric.",
            findings: ["Heading present", "Screenshot attached"],
            recommendations: [],
            artifacts: [
              {
                path: "docs/review.md",
                status: "pass",
                score: 96,
                findings: ["Review heading present"]
              },
              {
                path: "screenshots/layout.png",
                status: "pass",
                score: 92,
                findings: ["Screenshot content included"]
              }
            ],
            needs_human_review: false
          })
        };
      }
    });

    const payload = await judgeArtifacts({
      projectRoot: root,
      artifactPaths: ["docs/review.md", "screenshots/layout.png"],
      rubric: "The design note must include a heading and the screenshot must be attached.",
      providerId,
      modelId: "judge-v1"
    });

    assert.equal(payload.result.status, "pass");
    assert.equal(payload.result.score, 94);
    assert.equal(payload.artifacts.length, 2);
    assert.equal(payload.result.artifacts[1].path, "screenshots/layout.png");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verification summary incorporates artifact judgments into the final conclusion", { concurrency: false }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "artifact-verify-summary-"));
  const providerId = `mock-artifact-summary-${Date.now()}`;

  try {
    await mkdir(path.join(root, ".ai-workflow"), { recursive: true });
    await writeFile(path.join(root, ".ai-workflow", "config.json"), JSON.stringify({
      providers: {
        ollama: {
          enabled: false
        }
      }
    }, null, 2), "utf8");
    await mkdir(path.join(root, "docs"), { recursive: true });
    await mkdir(path.join(root, "screenshots"), { recursive: true });
    await writeFile(path.join(root, "docs", "review.md"), "# Design review\n\nThe artifact looks good.\n", "utf8");
    await writeFile(path.join(root, "screenshots", "layout.png"), Buffer.from(TINY_PNG_BASE64, "base64"));

    registerProvider(providerId, {
      generate: async ({ modelId }) => ({
        providerId,
        modelId,
        response: JSON.stringify({
          status: "pass",
          score: 91,
          confidence: 0.96,
          summary: "The artifacts satisfy the rubric.",
          findings: ["Text and image evidence both present"],
          recommendations: [],
          artifacts: [
            {
              path: "docs/review.md",
              status: "pass",
              score: 91,
              findings: ["Heading present"]
            },
            {
              path: "screenshots/layout.png",
              status: "pass",
              score: 91,
              findings: ["Screenshot attached"]
            }
          ],
          needs_human_review: false
        })
      })
    });

    const summary = await runVerificationSummary([
      "--root",
      root,
      "--artifact",
      "docs/review.md",
      "--artifact",
      "screenshots/layout.png",
      "--rubric",
      "The design note must include a heading and the screenshot must be attached.",
      "--provider",
      providerId,
      "--model",
      "judge-v1",
      "--json"
    ]);

    assert.equal(summary.conclusion, "verified");
    assert.equal(summary.artifactJudgment.result.status, "pass");
    assert.equal(summary.artifactJudgment.result.artifacts.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

