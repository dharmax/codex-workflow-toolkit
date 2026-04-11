import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { routeTask } from "./router.mjs";
import { generateCompletion } from "./providers.mjs";

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".json",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".css",
  ".html",
  ".yml",
  ".yaml",
  ".sh",
  ".py",
  ".rs",
  ".go",
  ".java"
]);

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".bmp",
  ".avif"
]);

const SHELL_JUDGE_DIMENSIONS = [
  "intentCorrectness",
  "capabilityFit",
  "grounding",
  "subjectPreservation",
  "executionQuality",
  "synthesisQuality",
  "verbosityMatch",
  "codexAcceptance"
];

export async function judgeShellTranscripts({
  projectRoot = process.cwd(),
  artifactPaths = [],
  rubric = "",
  goal = null,
  providerId = null,
  modelId = null,
  forceRouteRefresh = false
} = {}) {
  const normalizedArtifacts = normalizeArtifactPaths(artifactPaths);
  if (!normalizedArtifacts.length) {
    throw new Error("At least one transcript artifact path is required.");
  }

  const rubricText = String(rubric ?? "").trim();
  if (!rubricText) {
    throw new Error("A shell transcript rubric is required.");
  }

  const artifacts = [];
  for (const artifactPath of normalizedArtifacts) {
    artifacts.push(await readArtifact(projectRoot, artifactPath));
  }

  const route = await routeTask({
    root: projectRoot,
    taskClass: "artifact-evaluation",
    preferLocal: true,
    allowWeak: true,
    forceRefresh: forceRouteRefresh
  });
  const routed = applyRouteOverride(route, providerId, modelId);
  const prompt = buildShellTranscriptJudgePrompt({ projectRoot, rubric: rubricText, goal, artifacts });
  const contentParts = buildShellTranscriptJudgeContentParts({ artifacts });

  if (!routed.recommended) {
    return buildFallbackShellTranscriptJudgment({
      projectRoot,
      route: sanitizeRoute(routed),
      prompt,
      rubric: rubricText,
      goal,
      artifacts,
      reason: "No suitable model route is available."
    });
  }

  const provider = routed.providers?.[routed.recommended.providerId] ?? {};
  try {
    const completion = await generateCompletion({
      providerId: routed.recommended.providerId,
      modelId: routed.recommended.modelId,
      prompt,
      system: [
        "You are a strict shell transcript judge.",
        "Return concise JSON only.",
        "Judge whether the shell behaves like a strong Codex-like operator for the given request.",
        "Score each requested dimension independently and fail if the transcript is shallow, ungrounded, or visibly inferior to a good coding assistant."
      ].join(" "),
      config: provider,
      contentParts
    });

    return {
      codelet: {
        id: "shell-transcript-judge",
        summary: "Judge shell transcripts for intent handling, grounding, and Codex-like answer quality.",
        taskClass: "artifact-evaluation"
      },
      root: projectRoot,
      route: sanitizeRoute(routed),
      goal,
      rubric: rubricText,
      artifacts,
      result: normalizeShellTranscriptJudgment(completion.response, artifacts, rubricText, goal)
    };
  } catch (error) {
    return buildFallbackShellTranscriptJudgment({
      projectRoot,
      route: sanitizeRoute(routed),
      prompt,
      rubric: rubricText,
      goal,
      artifacts,
      reason: error?.message ?? String(error)
    });
  }
}

export async function runShellTranscriptJudge(argv = process.argv.slice(2)) {
  const { parseArgs, asArray, printAndExit } = await import("../../runtime/scripts/ai-workflow/lib/cli.mjs");
  const args = parseArgs(argv);
  const root = path.resolve(String(args.root ?? process.cwd()));

  if (args.help) {
    return outputAndExit(buildHelp(), 0);
  }

  const artifactPaths = asArray(args.artifact).map(String).map((value) => value.trim()).filter(Boolean);
  const rubric = await resolveRubricText({
    root,
    rubric: args.rubric,
    rubricFile: args["rubric-file"]
  });
  const goal = args.goal ? String(args.goal).trim() : null;
  const providerId = args.provider ? String(args.provider).trim() : null;
  const modelId = args.model ? String(args.model).trim() : null;

  if (!artifactPaths.length) {
    printAndExit(buildHelp(), 1);
  }
  if (!rubric) {
    printAndExit("A shell transcript rubric is required. Use --rubric or --rubric-file.", 1);
  }

  const payload = await judgeShellTranscripts({
    projectRoot: root,
    artifactPaths,
    rubric,
    goal,
    providerId,
    modelId
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(formatShellTranscriptJudgeOutput(payload));
  }
  return payload.result?.status === "pass" ? 0 : 1;
}

export function buildShellTranscriptJudgePrompt({ projectRoot, goal = null, rubric, artifacts }) {
  const artifactLines = artifacts.map((artifact) => [
    `- ${artifact.path}`,
    `  Kind: ${artifact.kind}`,
    `  MIME: ${artifact.mimeType ?? "n/a"}`,
    `  Size: ${artifact.sizeBytes} bytes`
  ].join("\n"));

  return [
    "Judge the supplied shell transcripts against the rubric.",
    "Return JSON only with the shape:",
    "{ status, score, confidence, summary, findings[], recommendations[], dimensions:{ intentCorrectness:{score,status,reason}, capabilityFit:{score,status,reason}, grounding:{score,status,reason}, subjectPreservation:{score,status,reason}, executionQuality:{score,status,reason}, synthesisQuality:{score,status,reason}, verbosityMatch:{score,status,reason}, codexAcceptance:{score,status,reason} }, artifacts[{path,status,score,findings[]}], needs_human_review }",
    "Use status values pass, fail, or needs_human_review.",
    "Pass only when the transcript is grounded, useful, and would satisfy a demanding Codex user for this request.",
    "Fail when the transcript loses the user's subject, gives shallow routing instead of a usable answer, leaks planner internals, or asks for rephrasing when a concrete next step was possible.",
    "",
    `Project root: ${projectRoot}`,
    goal ? `Goal: ${goal}` : "Goal: none",
    "",
    "Rubric:",
    rubric,
    "",
    "Artifacts:",
    artifactLines.join("\n"),
    "",
    "Consider the attached transcript payloads alongside the manifest above."
  ].join("\n");
}

export function buildShellTranscriptJudgeContentParts({ artifacts }) {
  const parts = [];
  for (const artifact of artifacts) {
    parts.push({
      type: "text",
      text: [
        `Transcript artifact: ${artifact.path}`,
        `Kind: ${artifact.kind}`,
        `MIME: ${artifact.mimeType ?? "n/a"}`,
        `Size: ${artifact.sizeBytes} bytes`
      ].join("\n")
    });
    if (artifact.kind === "image") {
      parts.push({
        type: "image",
        mimeType: artifact.mimeType,
        data: artifact.base64,
        path: artifact.path
      });
      continue;
    }
    parts.push({
      type: "text",
      text: artifact.content
        ? `Transcript content:\n\`\`\`\n${artifact.content}\n\`\`\``
        : "Transcript content unavailable."
    });
  }
  return parts;
}

function normalizeShellTranscriptJudgment(text, artifacts, rubric, goal) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    return buildDefaultShellTranscriptJudgment(artifacts, rubric, goal, "Empty model response.");
  }

  let parsed = null;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        parsed = JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        parsed = null;
      }
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ...buildDefaultShellTranscriptJudgment(artifacts, rubric, goal, trimmed.slice(0, 400)),
      rawResponse: trimmed
    };
  }

  const score = normalizeScore(parsed.score);
  const confidence = normalizeScore(parsed.confidence);
  const dimensions = normalizeShellJudgeDimensions(parsed.dimensions, score);
  const status = normalizeStatus(parsed.status, score, parsed.needs_human_review, dimensions);
  const artifactsResult = Array.isArray(parsed.artifacts) && parsed.artifacts.length
    ? parsed.artifacts.map((item, index) => ({
        path: String(item?.path ?? artifacts[index]?.path ?? `artifact-${index + 1}`),
        kind: String(item?.kind ?? artifacts[index]?.kind ?? "text"),
        status: normalizeStatus(item?.status, normalizeScore(item?.score), item?.needs_human_review ?? false),
        score: normalizeScore(item?.score),
        findings: normalizeArray(item?.findings)
      }))
    : artifacts.map((artifact) => ({
        path: artifact.path,
        kind: artifact.kind,
        status,
        score,
        findings: normalizeArray(parsed.findings)
      }));

  return {
    status,
    score,
    confidence,
    summary: String(parsed.summary ?? "").trim() || defaultSummaryForStatus(status, artifacts.length),
    findings: normalizeArray(parsed.findings),
    recommendations: normalizeArray(parsed.recommendations),
    dimensions,
    artifacts: artifactsResult,
    needs_human_review: Boolean(parsed.needs_human_review ?? status === "needs_human_review"),
    rawResponse: trimmed
  };
}

function normalizeShellJudgeDimensions(dimensions, fallbackScore = null) {
  const payload = dimensions && typeof dimensions === "object" && !Array.isArray(dimensions) ? dimensions : {};
  const normalized = {};
  for (const dimension of SHELL_JUDGE_DIMENSIONS) {
    const item = payload[dimension] && typeof payload[dimension] === "object" ? payload[dimension] : {};
    const score = normalizeScore(item.score ?? fallbackScore);
    normalized[dimension] = {
      score,
      status: normalizeDimensionStatus(item.status, score),
      reason: String(item.reason ?? "").trim() || defaultDimensionReason(dimension, score)
    };
  }
  return normalized;
}

function normalizeDimensionStatus(status, score) {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (normalized === "pass" || normalized === "fail" || normalized === "needs_human_review") {
    return normalized;
  }
  if (typeof score === "number") {
    if (score >= 80) return "pass";
    if (score < 50) return "fail";
  }
  return "needs_human_review";
}

function defaultDimensionReason(dimension, score) {
  if (typeof score !== "number") {
    return `${dimension} needs human review.`;
  }
  if (score >= 80) {
    return `${dimension} passed.`;
  }
  if (score < 50) {
    return `${dimension} failed.`;
  }
  return `${dimension} needs human review.`;
}

function buildFallbackShellTranscriptJudgment({ projectRoot, route, prompt, rubric, goal, artifacts, reason }) {
  return {
    codelet: {
      id: "shell-transcript-judge",
      summary: "Judge shell transcripts for intent handling, grounding, and Codex-like answer quality.",
      taskClass: "artifact-evaluation"
    },
    root: projectRoot,
    route,
    goal,
    rubric,
    artifacts,
    prompt,
    result: buildDefaultShellTranscriptJudgment(artifacts, rubric, goal, reason)
  };
}

function buildDefaultShellTranscriptJudgment(artifacts, rubric, goal, reason) {
  return {
    status: "needs_human_review",
    score: 0,
    confidence: 0,
    summary: reason,
    findings: [reason],
    recommendations: [
      "The shell transcript judge could not produce a structured verdict.",
      "Inspect the transcript manually or rerun with a compatible model."
    ],
    dimensions: normalizeShellJudgeDimensions({}, 0),
    artifacts: artifacts.map((artifact) => ({
      path: artifact.path,
      kind: artifact.kind,
      status: "needs_human_review",
      score: 0,
      findings: [reason]
    })),
    needs_human_review: true,
    rubric,
    goal
  };
}

function formatShellTranscriptJudgeOutput(payload) {
  const result = payload.result ?? {};
  const lines = [
    `Shell transcript judge: ${result.status ?? "unknown"}`,
    `Route: ${payload.route?.recommended ? `${payload.route.recommended.providerId}:${payload.route.recommended.modelId}` : "unavailable"}`,
    `Summary: ${result.summary ?? "n/a"}`,
    `Score: ${result.score ?? "n/a"} | Confidence: ${result.confidence ?? "n/a"}`
  ];
  if (result.dimensions && typeof result.dimensions === "object") {
    lines.push("");
    lines.push("Dimensions:");
    for (const key of SHELL_JUDGE_DIMENSIONS) {
      const item = result.dimensions[key];
      lines.push(`- ${key}: ${item?.status ?? "unknown"} (${item?.score ?? "n/a"})${item?.reason ? ` | ${item.reason}` : ""}`);
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function normalizeStatus(status, score, needsHumanReview, dimensions = null) {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (normalized === "pass" || normalized === "failed" || normalized === "fail" || normalized === "needs_human_review") {
    return normalized === "failed" ? "fail" : normalized;
  }
  if (needsHumanReview) {
    return "needs_human_review";
  }
  if (dimensions && Object.values(dimensions).some((item) => item?.status === "fail")) {
    return "fail";
  }
  if (typeof score === "number") {
    if (score >= 80) return "pass";
    if (score < 50) return "fail";
  }
  return "needs_human_review";
}

function normalizeArtifactPaths(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

async function resolveRubricText({ root, rubric, rubricFile }) {
  const inline = String(rubric ?? "").trim();
  if (inline) {
    return inline;
  }
  const file = String(rubricFile ?? "").trim();
  if (!file) {
    return "";
  }
  const resolved = path.resolve(root, file);
  return String(await readFile(resolved, "utf8")).trim();
}

async function readArtifact(projectRoot, artifactPath) {
  const absolutePath = path.isAbsolute(artifactPath)
    ? artifactPath
    : path.resolve(projectRoot, artifactPath);
  const stats = await stat(absolutePath);
  const kind = classifyArtifactKind(absolutePath);
  const mimeType = kind === "image" ? mimeTypeFromPath(absolutePath) : "text/plain";
  const relativePath = path.isAbsolute(artifactPath)
    ? artifactPath
    : path.relative(projectRoot, absolutePath).split(path.sep).join("/");

  if (kind === "image") {
    const buffer = await readFile(absolutePath);
    return {
      path: relativePath,
      absolutePath,
      kind,
      mimeType,
      sizeBytes: stats.size,
      base64: buffer.toString("base64")
    };
  }

  const content = await readFile(absolutePath, "utf8");
  return {
    path: relativePath,
    absolutePath,
    kind,
    mimeType,
    sizeBytes: stats.size,
    content: truncateContent(content)
  };
}

function classifyArtifactKind(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) {
    return "image";
  }
  if (TEXT_EXTENSIONS.has(ext)) {
    return ext === ".md" || ext === ".mdx" || ext === ".txt" ? "doc" : "text";
  }
  return "text";
}

function mimeTypeFromPath(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".bmp":
      return "image/bmp";
    case ".avif":
      return "image/avif";
    default:
      return "application/octet-stream";
  }
}

function truncateContent(content) {
  const lines = String(content ?? "").split(/\r?\n/).slice(0, 260);
  const truncated = lines.join("\n");
  return truncated.length > 8000 ? `${truncated.slice(0, 8000)}\n... [TRUNCATED]` : truncated;
}

function normalizeScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function normalizeArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function defaultSummaryForStatus(status, count) {
  switch (status) {
    case "pass":
      return `All ${count} shell transcript artifact(s) satisfied the rubric.`;
    case "fail":
      return `At least one shell transcript artifact failed the rubric.`;
    default:
      return `The shell transcript judge needs human review for ${count} artifact(s).`;
  }
}

function applyRouteOverride(route, providerId, modelId) {
  const normalizedProvider = String(providerId ?? "").trim();
  const normalizedModel = String(modelId ?? "").trim();
  if (!normalizedProvider || !normalizedModel) {
    return route;
  }
  const providers = route.providers ?? {};
  const provider = providers[normalizedProvider] ?? {};
  return {
    ...route,
    recommended: {
      providerId: normalizedProvider,
      modelId: normalizedModel,
      local: Boolean(provider.local),
      reason: "explicit provider/model override"
    }
  };
}

function sanitizeRoute(route) {
  if (!route || typeof route !== "object") {
    return route;
  }
  const providers = {};
  for (const [providerId, provider] of Object.entries(route.providers ?? {})) {
    providers[providerId] = provider && typeof provider === "object"
      ? {
          ...provider,
          apiKey: provider.apiKey ? "[redacted]" : provider.apiKey
        }
      : provider;
  }
  return {
    ...route,
    providers
  };
}

function buildHelp() {
  return [
    "Usage: ai-workflow run shell-transcript-judge --artifact <file> [--artifact <file> ...] --rubric <text> [options]",
    "",
    "Options:",
    "  --root <path>      Project root. Defaults to current directory.",
    "  --artifact <path>  Transcript artifact to judge. Repeat for multiple files.",
    "  --rubric <text>    Required rubric text.",
    "  --rubric-file <path>  Rubric file path. Use instead of --rubric for long rubrics.",
    "  --goal <text>      Optional goal or acceptance statement.",
    "  --provider <id>    Force a provider.",
    "  --model <id>       Force a model.",
    "  --json             Emit JSON."
  ].join("\n");
}

function outputAndExit(text, code = 0) {
  process.stdout.write(`${text}\n`);
  process.exit(code);
}
