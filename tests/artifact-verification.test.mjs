import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { judgeArtifacts } from "../core/services/artifact-verification.mjs";
import { judgeShellTranscripts } from "../core/services/shell-transcript-verification.mjs";
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

test("artifact judge falls back when the first provider returns unstructured output", { concurrency: false }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "artifact-judge-fallback-"));
  const primaryProviderId = `mock-artifact-primary-${Date.now()}`;
  const fallbackProviderId = `mock-artifact-fallback-${Date.now()}`;

  try {
    await mkdir(path.join(root, ".ai-workflow"), { recursive: true });
    await writeFile(path.join(root, ".ai-workflow", "config.json"), JSON.stringify({
      providers: {
        [primaryProviderId]: {
          apiKey: "primary-key",
          models: ["judge-v1"]
        },
        [fallbackProviderId]: {
          apiKey: "fallback-key",
          models: ["judge-v2"]
        },
        openai: {
          enabled: false
        },
        anthropic: {
          enabled: false
        },
        google: {
          enabled: false
        },
        ollama: {
          enabled: false
        }
      }
    }, null, 2), "utf8");
    await mkdir(path.join(root, "docs"), { recursive: true });
    await writeFile(path.join(root, "docs", "review.md"), "# Design review\n\nThe artifact looks good.\n", "utf8");

    registerProvider(primaryProviderId, {
      generate: async () => ({
        providerId: primaryProviderId,
        modelId: "judge-v1",
        response: "[0.42, 0.22, 0.79, 0.38]"
      })
    });
    registerProvider(fallbackProviderId, {
      generate: async () => ({
        providerId: fallbackProviderId,
        modelId: "judge-v2",
        response: JSON.stringify({
          status: "pass",
          score: 95,
          confidence: 0.99,
          summary: "Fallback judge returned a valid structured verdict.",
          findings: ["Review content is present"],
          recommendations: [],
          artifacts: [
            {
              path: "docs/review.md",
              status: "pass",
              score: 95,
              findings: ["Fallback provider judged the artifact"]
            }
          ],
          needs_human_review: false
        })
      })
    });

    const payload = await judgeArtifacts({
      projectRoot: root,
      artifactPaths: ["docs/review.md"],
      rubric: "The design note must include enough context to explain the generated project.",
      providerId: primaryProviderId,
      modelId: "judge-v1"
    });

    assert.equal(payload.result.status, "pass");
    assert.equal(payload.result.summary, "Fallback judge returned a valid structured verdict.");
    assert.equal(payload.diagnostics.failedAttempts, 1);
    assert.equal(payload.diagnostics.successfulProviderId, fallbackProviderId);
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

test("shell transcript judge returns dimensioned verdicts for transcript artifacts", { concurrency: false }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shell-transcript-judge-"));
  const providerId = `mock-shell-transcript-judge-${Date.now()}`;

  try {
    await mkdir(path.join(root, ".ai-workflow"), { recursive: true });
    await writeFile(path.join(root, ".ai-workflow", "config.json"), JSON.stringify({
      providers: {
        ollama: {
          enabled: false
        }
      }
    }, null, 2), "utf8");
    await mkdir(path.join(root, "artifacts"), { recursive: true });
    await writeFile(path.join(root, "artifacts", "shell.txt"), [
      "Prompt: what's the status of this project?",
      "",
      "The project looks healthy and the shell answers directly."
    ].join("\n"), "utf8");

    registerProvider(providerId, {
      generate: async ({ modelId, prompt, contentParts }) => {
        assert.equal(modelId, "judge-v1");
        assert.match(prompt, /Judge the supplied shell transcripts/);
        assert.equal(Array.isArray(contentParts), true);
        assert.match(contentParts.filter((part) => part.type === "text").map((part) => part.text).join("\n"), /status of this project/i);
        return {
          providerId,
          modelId,
          response: JSON.stringify({
            status: "pass",
            score: 93,
            confidence: 0.97,
            summary: "The shell transcript is grounded and directly answers the request.",
            findings: ["Intent preserved", "Grounded answer", "No planner leakage"],
            recommendations: [],
            dimensions: {
              intentCorrectness: { score: 95, status: "pass", reason: "The request is answered directly." },
              capabilityFit: { score: 92, status: "pass", reason: "The shell chooses a sensible mode." },
              grounding: { score: 94, status: "pass", reason: "The answer stays grounded." },
              subjectPreservation: { score: 95, status: "pass", reason: "The project-status subject is preserved." },
              executionQuality: { score: 90, status: "pass", reason: "The shell avoids unnecessary work." },
              synthesisQuality: { score: 92, status: "pass", reason: "The answer is useful." },
              verbosityMatch: { score: 91, status: "pass", reason: "The density matches the request." },
              codexAcceptance: { score: 93, status: "pass", reason: "A demanding Codex user would accept it." }
            },
            artifacts: [
              {
                path: "artifacts/shell.txt",
                status: "pass",
                score: 93,
                findings: ["Transcript passes the shell rubric"]
              }
            ],
            needs_human_review: false
          })
        };
      }
    });

    const payload = await judgeShellTranscripts({
      projectRoot: root,
      artifactPaths: ["artifacts/shell.txt"],
      rubric: "The shell transcript must answer directly, stay grounded, preserve the subject, and feel Codex-grade.",
      providerId,
      modelId: "judge-v1"
    });

    assert.equal(payload.result.status, "pass");
    assert.equal(payload.result.dimensions.codexAcceptance.status, "pass");
    assert.equal(payload.result.artifacts[0].path, "artifacts/shell.txt");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verification summary supports shell-transcript judge mode", { concurrency: false }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shell-verify-summary-"));
  const providerId = `mock-shell-summary-${Date.now()}`;

  try {
    await mkdir(path.join(root, ".ai-workflow"), { recursive: true });
    await writeFile(path.join(root, ".ai-workflow", "config.json"), JSON.stringify({
      providers: {
        ollama: {
          enabled: false
        }
      }
    }, null, 2), "utf8");
    await mkdir(path.join(root, "artifacts"), { recursive: true });
    await writeFile(path.join(root, "artifacts", "shell.txt"), [
      "Prompt: explain the shell",
      "",
      "The shell is the natural-language front door for workflow actions."
    ].join("\n"), "utf8");

    registerProvider(providerId, {
      generate: async ({ modelId, prompt }) => ({
        providerId,
        modelId,
        response: JSON.stringify({
          status: "pass",
          score: 91,
          confidence: 0.96,
          summary: "The shell transcript satisfies the shell-specific rubric.",
          findings: ["Grounded", "Direct", "Useful"],
          recommendations: [],
          dimensions: {
            intentCorrectness: { score: 91, status: "pass", reason: "Intent preserved." },
            capabilityFit: { score: 91, status: "pass", reason: "Capability fit is credible." },
            grounding: { score: 92, status: "pass", reason: "Grounded response." },
            subjectPreservation: { score: 91, status: "pass", reason: "Subject preserved." },
            executionQuality: { score: 89, status: "pass", reason: "Execution is appropriate." },
            synthesisQuality: { score: 91, status: "pass", reason: "The answer is useful." },
            verbosityMatch: { score: 90, status: "pass", reason: "Matches expected density." },
            codexAcceptance: { score: 91, status: "pass", reason: "Acceptable to a demanding operator." }
          },
          artifacts: [
            {
              path: "artifacts/shell.txt",
              status: "pass",
              score: 91,
              findings: ["Transcript passes"]
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
      "artifacts/shell.txt",
      "--judge",
      "shell-transcript",
      "--rubric",
      "The shell transcript must answer directly, remain grounded, and feel Codex-grade.",
      "--provider",
      providerId,
      "--model",
      "judge-v1",
      "--json"
    ]);

    assert.equal(summary.conclusion, "verified");
    assert.equal(summary.judgeMode, "shell-transcript");
    assert.equal(summary.artifactJudgment.result.dimensions.grounding.status, "pass");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
