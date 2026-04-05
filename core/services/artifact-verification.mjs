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

export async function judgeArtifacts({
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
    throw new Error("At least one artifact path is required.");
  }

  const rubricText = String(rubric ?? "").trim();
  if (!rubricText) {
    throw new Error("A rubric is required.");
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
  const prompt = buildArtifactJudgePrompt({ projectRoot, goal, rubric: rubricText, artifacts });
  const contentParts = buildArtifactJudgeContentParts({ artifacts });

  if (!routed.recommended) {
    return buildFallbackArtifactJudgment({
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
        "You are a strict artifact judge.",
        "Return concise JSON only.",
        "Pass only when the supplied artifacts satisfy the rubric and the evidence is sufficient.",
        "Use needs_human_review when the artifact is ambiguous, incomplete, or the model cannot justify a confident judgment."
      ].join(" "),
      config: provider,
      contentParts
    });

    return {
      codelet: {
        id: "artifact-judge",
        summary: "Judge soft artifacts against a rubric and return a pass/fail report.",
        taskClass: "artifact-evaluation"
      },
      root: projectRoot,
      route: sanitizeRoute(routed),
      goal,
      rubric: rubricText,
      artifacts,
      result: normalizeJudgmentResponse(completion.response, artifacts, rubricText, goal)
    };
  } catch (error) {
    return buildFallbackArtifactJudgment({
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

export async function runArtifactJudge(argv = process.argv.slice(2), env = process.env) {
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
    printAndExit("A rubric is required. Use --rubric or --rubric-file.", 1);
  }

  const result = await judgeArtifacts({
    projectRoot: root,
    artifactPaths,
    rubric,
    goal,
    providerId,
    modelId
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(formatArtifactJudgeOutput(result));
  }

  return result.result?.status === "pass" ? 0 : 1;
}

export function buildArtifactJudgePrompt({ projectRoot, goal = null, rubric, artifacts }) {
  const artifactLines = artifacts.map((artifact) => [
    `- ${artifact.path}`,
    `  Kind: ${artifact.kind}`,
    `  MIME: ${artifact.mimeType ?? "n/a"}`,
    `  Size: ${artifact.sizeBytes} bytes`
  ].join("\n"));

  return [
    "Judge the supplied artifacts against the rubric.",
    "Return JSON only with the shape:",
    "{ status, score, confidence, summary, findings[], recommendations[], artifacts[{path,status,score,findings[]}], needs_human_review }",
    "Use status values pass, fail, or needs_human_review.",
    "Use pass only when the artifacts clearly satisfy the rubric.",
    "Use fail when the rubric is violated.",
    "Use needs_human_review when the evidence is incomplete or ambiguous.",
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
    "Consider the attached artifact payloads alongside the manifest above."
  ].join("\n");
}

export function buildArtifactJudgeContentParts({ artifacts }) {
  const parts = [];

  for (const artifact of artifacts) {
    parts.push({
      type: "text",
      text: [
        `Artifact: ${artifact.path}`,
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
        ? `Content:\n\`\`\`\n${artifact.content}\n\`\`\``
        : "Content unavailable."
    });
  }

  return parts;
}

function buildFallbackArtifactJudgment({ projectRoot, route, prompt, rubric, goal, artifacts, reason }) {
  return {
    codelet: {
      id: "artifact-judge",
      summary: "Judge soft artifacts against a rubric and return a pass/fail report.",
      taskClass: "artifact-evaluation"
    },
    root: projectRoot,
    route,
    goal,
    rubric,
    artifacts,
    prompt,
    result: {
      status: "needs_human_review",
      score: 0,
      confidence: 0,
      summary: reason,
      findings: [reason],
      recommendations: [
        "Connect a compatible provider or configure a capable local model for artifact judging."
      ],
      artifacts: artifacts.map((artifact) => ({
        path: artifact.path,
        kind: artifact.kind,
        status: "needs_human_review",
        score: 0,
        findings: [reason]
      })),
      needs_human_review: true,
      reason
    }
  };
}

function buildHelp() {
  return [
    "Usage: ai-workflow run artifact-judge --artifact <file> [--artifact <file> ...] --rubric <text> [options]",
    "",
    "Options:",
    "  --root <path>      Project root. Defaults to current directory.",
    "  --artifact <path>  Artifact to judge. Repeat for multiple files.",
    "  --rubric <text>    Required rubric text.",
    "  --rubric-file <path>  Rubric file path. Use instead of --rubric for long rubrics.",
    "  --goal <text>      Optional goal or acceptance statement.",
    "  --provider <id>    Force a provider.",
    "  --model <id>       Force a model.",
    "  --json             Emit JSON."
  ].join("\n");
}

function formatArtifactJudgeOutput(payload) {
  const result = payload.result ?? {};
  const lines = [
    `Artifact judge: ${result.status ?? "unknown"}`,
    `Route: ${payload.route?.recommended ? `${payload.route.recommended.providerId}:${payload.route.recommended.modelId}` : "unavailable"}`,
    `Summary: ${result.summary ?? "n/a"}`
  ];

  if (typeof result.score === "number" || typeof result.confidence === "number") {
    lines.push(`Score: ${result.score ?? "n/a"} | Confidence: ${result.confidence ?? "n/a"}`);
  }

  if (Array.isArray(result.findings) && result.findings.length) {
    lines.push("");
    lines.push("Findings:");
    for (const finding of result.findings) {
      lines.push(`- ${finding}`);
    }
  }

  if (Array.isArray(result.recommendations) && result.recommendations.length) {
    lines.push("");
    lines.push("Recommendations:");
    for (const recommendation of result.recommendations) {
      lines.push(`- ${recommendation}`);
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function normalizeJudgmentResponse(text, artifacts, rubric, goal) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    return buildDefaultJudgment(artifacts, rubric, goal, "Empty model response.");
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
      ...buildDefaultJudgment(artifacts, rubric, goal, trimmed.slice(0, 400)),
      rawResponse: trimmed
    };
  }

  const score = normalizeScore(parsed.score);
  const confidence = normalizeScore(parsed.confidence);
  const status = normalizeStatus(parsed.status, score, parsed.needs_human_review);
  const artifactsResult = Array.isArray(parsed.artifacts) && parsed.artifacts.length
    ? parsed.artifacts.map((item, index) => ({
        path: String(item?.path ?? artifacts[index]?.path ?? `artifact-${index + 1}`),
        kind: String(item?.kind ?? artifacts[index]?.kind ?? "text"),
        status: normalizeStatus(item?.status, normalizeScore(item?.score), item?.needs_human_review ?? false),
        score: normalizeScore(item?.score),
        findings: normalizeArray(item?.findings),
        recommendations: normalizeArray(item?.recommendations)
      }))
    : artifacts.map((artifact) => ({
        path: artifact.path,
        kind: artifact.kind,
        status,
        score,
        findings: normalizeArray(parsed.findings),
        recommendations: normalizeArray(parsed.recommendations)
      }));

  return {
    status,
    score,
    confidence,
    summary: String(parsed.summary ?? parsed.message ?? "").trim() || defaultSummaryForStatus(status, artifacts.length),
    findings: normalizeArray(parsed.findings),
    recommendations: normalizeArray(parsed.recommendations),
    artifacts: artifactsResult,
    needs_human_review: Boolean(parsed.needs_human_review ?? status === "needs_human_review"),
    rawResponse: trimmed
  };
}

function buildDefaultJudgment(artifacts, rubric, goal, reason) {
  return {
    status: "needs_human_review",
    score: 0,
    confidence: 0,
    summary: reason,
    findings: [reason],
    recommendations: [
      "The judge could not produce a structured verdict.",
      "Inspect the artifacts manually or rerun with a compatible model."
    ],
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
  const lines = String(content ?? "").split(/\r?\n/).slice(0, 220);
  const truncated = lines.join("\n");
  return truncated.length > 5000 ? `${truncated.slice(0, 5000)}\n... [TRUNCATED]` : truncated;
}

function normalizeScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function normalizeStatus(status, score, needsHumanReview) {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (normalized === "pass" || normalized === "failed" || normalized === "fail" || normalized === "needs_human_review") {
    return normalized === "failed" ? "fail" : normalized;
  }
  if (needsHumanReview) {
    return "needs_human_review";
  }
  if (typeof score === "number") {
    if (score >= 80) {
      return "pass";
    }
    if (score < 50) {
      return "fail";
    }
  }
  return "needs_human_review";
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
      return `All ${count} artifacts satisfied the rubric.`;
    case "fail":
      return `At least one artifact failed the rubric.`;
    default:
      return `The judge needs human review for ${count} artifact(s).`;
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

function outputAndExit(text, code = 0) {
  process.stdout.write(`${text}\n`);
  process.exit(code);
}
