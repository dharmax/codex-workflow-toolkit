import path from "node:path";
import { readFile } from "node:fs/promises";
import { openWorkflowStore } from "../db/sqlite-store.mjs";
import { sha1, stableId } from "../lib/hash.mjs";
import { buildProjectSummary } from "./projections.mjs";
import { inferTicketWorkingSet } from "../../runtime/scripts/ai-workflow/lib/workflow-store-utils.mjs";
import { OPERATOR_SURFACES, collectOperatorSurfaceState } from "../../runtime/scripts/ai-workflow/lib/operator-surfaces.mjs";
import { DEFAULT_DOGFOOD_REPORT_PATH, readDogfoodReport } from "../../runtime/scripts/ai-workflow/lib/dogfood-utils.mjs";
import { readLatestRunArtifact } from "../lib/run-artifacts.mjs";
import { getChanges, isGitRepo } from "../../runtime/scripts/ai-workflow/lib/git-utils.mjs";

const PROJECT_NODE_ID = "project:root";
const STATUS_DERIVED_SOURCE = "derived-status";
const STATUS_SYNC_TOKEN = "status-sync";
const TEST_FILE_RE = /(^|\/)(tests?|__tests__)\//;
const TEST_FILE_NAME_RE = /\.(spec|test)\.[cm]?[jt]sx?$/i;
const FILE_ID_PREFIX = "file:";
const SYMBOL_ID_PREFIX = "symbol:";
const TEST_ID_PREFIX = "test:";
const SURFACE_ID_PREFIX = "surface:";
const STORY_ID_PREFIX = "story:";
const IMPL_PLAN_ID_PREFIX = "implementation-plan:";
const TEST_PLAN_ID_PREFIX = "test-plan:";
const STATUS_STOP_WORDS = new Set([
  "a", "about", "aggregate", "an", "and", "are", "be", "cover", "covered", "did", "do",
  "for", "friendly", "give", "how", "human", "i", "information", "is", "it", "its",
  "me", "of", "on", "related", "response", "right", "show", "state", "status", "tell",
  "tests", "that", "the", "this", "to", "translate", "usable", "what", "which"
]);

export const STATUS_NODE_TYPES = [
  "project",
  "surface",
  "ticket",
  "epic",
  "story",
  "feature",
  "module",
  "codelet",
  "test",
  "test-plan",
  "implementation-plan",
  "bug",
  "issue",
  "idea",
  "risk",
  "file",
  "symbol"
];

const STATUS_TYPE_ALIASES = {
  feature: "feature",
  flow: "feature",
  "use-case": "story",
  "user-story": "story",
  story: "story",
  ticket: "ticket",
  epic: "epic",
  codelet: "codelet",
  test: "test",
  file: "file",
  symbol: "symbol",
  class: "symbol",
  module: "module",
  surface: "surface",
  shell: "surface",
  bug: "bug",
  issue: "issue",
  idea: "idea",
  risk: "risk",
  "test-plan": "test-plan",
  "implementation-plan": "implementation-plan",
  project: "project",
  repo: "project",
  repository: "project",
  codebase: "project"
};

export async function readStatusEvidenceFingerprint(projectRoot = process.cwd()) {
  const [dogfoodText, latestRunText] = await Promise.all([
    readTextIfExists(path.resolve(projectRoot, DEFAULT_DOGFOOD_REPORT_PATH)),
    readTextIfExists(path.resolve(projectRoot, ".ai-workflow", "state", "run-artifacts", "latest.json"))
  ]);
  return {
    dogfoodReportHash: dogfoodText ? sha1(dogfoodText) : null,
    latestRunArtifactHash: latestRunText ? sha1(latestRunText) : null
  };
}

export async function syncStatusGraph({ projectRoot = process.cwd(), store }) {
  const surfaces = await collectOperatorSurfaceState(projectRoot);
  const files = store.listFiles();
  const fileSet = new Set(files.map((file) => file.path));
  const fileIds = new Set(files.map((file) => canonicalFileId(file.path)));
  const graph = store.listArchitecturalPredicates();
  const epics = store.listEntities({ entityType: "epic" });
  const tickets = store.listEntities({ entityType: "ticket" }).filter((ticket) => ticket.state !== "archived");
  const dogfoodReport = await readDogfoodReport(projectRoot);
  const latestRunArtifact = await readLatestRunArtifact(projectRoot);

  store.deleteEntitiesBySourceKind(STATUS_DERIVED_SOURCE, ["surface", "story", "test", "test-plan", "implementation-plan"]);
  store.deleteArchitecturalPredicatesByMetadataToken(STATUS_SYNC_TOKEN);

  const derivedEntities = [];
  const dogfoodRuns = [];
  const runArtifactRuns = [];

  for (const [surfaceId, snapshot] of Object.entries(surfaces)) {
    const entityId = canonicalSurfaceId(surfaceId);
    derivedEntities.push({
      id: entityId,
      entityType: "surface",
      title: surfaceId,
      state: "open",
      confidence: 1,
      provenance: "status-sync",
      sourceKind: STATUS_DERIVED_SOURCE,
      reviewState: "active",
      data: {
        surfaceId,
        description: snapshot.description ?? ""
      }
    });
    for (const filePath of snapshot.files ?? []) {
      store.appendArchitecturalPredicate({
        subjectId: entityId,
        predicate: "contains",
        objectId: canonicalFileId(filePath),
        metadata: { source: STATUS_SYNC_TOKEN, relation: "surface-file" }
      });
    }
  }

  for (const epic of epics) {
    const stories = normalizeStoryList(epic.data?.userStories ?? epic.data?.stories ?? []);
    for (const [index, story] of stories.entries()) {
      const storyId = `${STORY_ID_PREFIX}${epic.id}:${index + 1}`;
      derivedEntities.push({
        id: storyId,
        entityType: "story",
        title: `Story ${index + 1}`,
        state: epic.state ?? "open",
        confidence: 1,
        provenance: "status-sync",
        sourceKind: STATUS_DERIVED_SOURCE,
        reviewState: "active",
        parentId: epic.id,
        data: {
          epicId: epic.id,
          epicTitle: epic.title,
          body: story,
          index: index + 1
        }
      });
      store.appendArchitecturalPredicate({
        subjectId: storyId,
        predicate: "belongs_to",
        objectId: epic.id,
        metadata: { source: STATUS_SYNC_TOKEN, relation: "story-epic" }
      });
    }
  }

  for (const testFile of files.filter((file) => isTestFile(file.path))) {
    const testId = canonicalTestId(testFile.path);
    derivedEntities.push({
      id: testId,
      entityType: "test",
      title: testFile.path,
      state: "open",
      confidence: 1,
      provenance: "status-sync",
      sourceKind: STATUS_DERIVED_SOURCE,
      reviewState: "active",
      data: {
        filePath: testFile.path,
        kind: "file-test",
        language: testFile.language
      }
    });
    store.appendArchitecturalPredicate({
      subjectId: testId,
      predicate: "defines",
      objectId: canonicalFileId(testFile.path),
      metadata: { source: STATUS_SYNC_TOKEN, relation: "test-file" }
    });

    const importClaims = store.listClaims({ subjectId: canonicalFileId(testFile.path), predicate: "imports" });
    const seenTargets = new Set();
    for (const claim of importClaims) {
      const resolved = resolveImportedProjectPath(testFile.path, claim.objectText, fileSet);
      if (!resolved || seenTargets.has(resolved)) {
        continue;
      }
      seenTargets.add(resolved);
      store.appendArchitecturalPredicate({
        subjectId: testId,
        predicate: "verifies",
        objectId: canonicalFileId(resolved),
        metadata: { source: STATUS_SYNC_TOKEN, relation: "test-import" }
      });
    }

    if (!seenTargets.size) {
      const guessedTargets = guessTestTargetsFromName(testFile.path, fileSet);
      for (const targetPath of guessedTargets) {
        store.appendArchitecturalPredicate({
          subjectId: testId,
          predicate: "verifies",
          objectId: canonicalFileId(targetPath),
          metadata: { source: STATUS_SYNC_TOKEN, relation: "test-name-guess" }
        });
      }
    }
  }

  for (const edge of graph) {
    if (edge.predicate === "belongs_to" && !String(edge.subjectId ?? "").startsWith(FILE_ID_PREFIX) && fileSet.has(edge.subjectId)) {
      store.appendArchitecturalPredicate({
        subjectId: edge.objectId,
        predicate: "contains",
        objectId: canonicalFileId(edge.subjectId),
        metadata: { source: STATUS_SYNC_TOKEN, relation: "module-file" }
      });
    }
    if (edge.predicate === "implements" && !String(edge.subjectId ?? "").startsWith(FILE_ID_PREFIX) && fileSet.has(edge.subjectId)) {
      store.appendArchitecturalPredicate({
        subjectId: edge.objectId,
        predicate: "touches",
        objectId: canonicalFileId(edge.subjectId),
        metadata: { source: STATUS_SYNC_TOKEN, relation: "feature-file" }
      });
    }
  }

  for (const ticket of tickets) {
    const inferred = await inferTicketWorkingSet({
      root: projectRoot,
      ticket: runtimeTicketFromEntity(ticket),
      entity: ticket,
      limit: 6
    });
    for (const filePath of inferred.files ?? []) {
      if (!fileIds.has(canonicalFileId(filePath))) {
        continue;
      }
      store.appendArchitecturalPredicate({
        subjectId: ticket.id,
        predicate: "relates_to",
        objectId: canonicalFileId(filePath),
        metadata: { source: STATUS_SYNC_TOKEN, relation: "ticket-file" }
      });
    }
    for (const symbolLabel of inferred.symbols ?? []) {
      const symbol = resolveSymbolLabel(store, symbolLabel);
      if (!symbol) {
        continue;
      }
      store.appendArchitecturalPredicate({
        subjectId: ticket.id,
        predicate: "relates_to",
        objectId: canonicalSymbolId(symbol.id),
        metadata: { source: STATUS_SYNC_TOKEN, relation: "ticket-symbol" }
      });
    }
  }

  if (dogfoodReport?.surfaces) {
    for (const [surfaceId, surface] of Object.entries(dogfoodReport.surfaces)) {
      for (const scenario of surface.scenarios ?? []) {
        const testId = `${TEST_ID_PREFIX}dogfood:${surfaceId}:${scenario.id}`;
        derivedEntities.push({
          id: testId,
          entityType: "test",
          title: `dogfood ${surfaceId} ${scenario.id}`,
          state: scenario.ok ? "pass" : "fail",
          confidence: 1,
          provenance: "status-sync",
          sourceKind: STATUS_DERIVED_SOURCE,
          reviewState: "active",
          data: {
            kind: "dogfood-scenario",
            surfaceId,
            scenarioId: scenario.id,
            description: scenario.description ?? ""
          }
        });
        store.appendArchitecturalPredicate({
          subjectId: testId,
          predicate: "verifies",
          objectId: canonicalSurfaceId(surfaceId),
          metadata: { source: STATUS_SYNC_TOKEN, relation: "dogfood-surface" }
        });
        dogfoodRuns.push({
          id: stableId("test-run", "dogfood", surfaceId, scenario.id),
          runId: `dogfood:${surfaceId}:${scenario.id}`,
          testId,
          targetId: canonicalSurfaceId(surfaceId),
          source: "dogfood",
          label: scenario.description ?? scenario.id,
          status: scenario.ok ? "pass" : "fail",
          command: scenario.command ?? null,
          summary: scenario.stderr ? `${scenario.description ?? scenario.id} (${scenario.stderr})` : (scenario.description ?? scenario.id),
          artifactRef: DEFAULT_DOGFOOD_REPORT_PATH,
          recordedAt: dogfoodReport.generatedAt ?? new Date().toISOString(),
          details: scenario
        });
      }
    }
  }

  if (latestRunArtifact) {
    const implementationPlanId = `${IMPL_PLAN_ID_PREFIX}${latestRunArtifact.id}`;
    const testPlanId = `${TEST_PLAN_ID_PREFIX}${latestRunArtifact.id}`;
    const artifactTestId = `${TEST_ID_PREFIX}run-artifact:${latestRunArtifact.id}`;
    const hasExecutionPlan = Boolean(latestRunArtifact?.payload?.executionPlan);
    const hasVerification = Boolean(latestRunArtifact?.payload?.verificationRun);

    derivedEntities.push({
      id: artifactTestId,
      entityType: "test",
      title: latestRunArtifact.kind ? `${latestRunArtifact.kind} ${latestRunArtifact.id}` : latestRunArtifact.id,
      state: latestRunArtifact.ok ? "pass" : "fail",
      confidence: 1,
      provenance: "status-sync",
      sourceKind: STATUS_DERIVED_SOURCE,
      reviewState: "active",
      data: {
        kind: "run-artifact",
        artifactId: latestRunArtifact.id,
        artifactKind: latestRunArtifact.kind ?? "unknown"
      }
    });

    if (hasExecutionPlan) {
      derivedEntities.push({
        id: implementationPlanId,
        entityType: "implementation-plan",
        title: `Implementation plan ${latestRunArtifact.id}`,
        state: latestRunArtifact.ok ? "complete" : "open",
        confidence: 1,
        provenance: "status-sync",
        sourceKind: STATUS_DERIVED_SOURCE,
        reviewState: "active",
        data: {
          artifactId: latestRunArtifact.id,
          kind: latestRunArtifact.kind ?? "execution-dry-run"
        }
      });
      store.appendArchitecturalPredicate({
        subjectId: implementationPlanId,
        predicate: "planned_by",
        objectId: PROJECT_NODE_ID,
        metadata: { source: STATUS_SYNC_TOKEN, relation: "implementation-plan-project" }
      });
    }

    if (hasVerification) {
      derivedEntities.push({
        id: testPlanId,
        entityType: "test-plan",
        title: `Test plan ${latestRunArtifact.id}`,
        state: latestRunArtifact.ok ? "complete" : "open",
        confidence: 1,
        provenance: "status-sync",
        sourceKind: STATUS_DERIVED_SOURCE,
        reviewState: "active",
        data: {
          artifactId: latestRunArtifact.id,
          kind: latestRunArtifact.kind ?? "run-artifact"
        }
      });
      store.appendArchitecturalPredicate({
        subjectId: testPlanId,
        predicate: "planned_by",
        objectId: PROJECT_NODE_ID,
        metadata: { source: STATUS_SYNC_TOKEN, relation: "test-plan-project" }
      });
    }

    store.appendArchitecturalPredicate({
      subjectId: artifactTestId,
      predicate: "verifies",
      objectId: PROJECT_NODE_ID,
      metadata: { source: STATUS_SYNC_TOKEN, relation: "run-artifact-project" }
    });

    if (hasExecutionPlan) {
      store.appendArchitecturalPredicate({
        subjectId: artifactTestId,
        predicate: "planned_by",
        objectId: implementationPlanId,
        metadata: { source: STATUS_SYNC_TOKEN, relation: "run-artifact-implementation-plan" }
      });
    }
    if (hasVerification) {
      store.appendArchitecturalPredicate({
        subjectId: artifactTestId,
        predicate: "planned_by",
        objectId: testPlanId,
        metadata: { source: STATUS_SYNC_TOKEN, relation: "run-artifact-test-plan" }
      });
    }

    runArtifactRuns.push({
      id: stableId("test-run", "run-artifact", latestRunArtifact.id, PROJECT_NODE_ID),
      runId: latestRunArtifact.id,
      testId: artifactTestId,
      targetId: PROJECT_NODE_ID,
      source: "run-artifact",
      label: latestRunArtifact.kind ?? latestRunArtifact.id,
      status: latestRunArtifact.ok ? "pass" : "fail",
      command: latestRunArtifact.command ?? null,
      summary: latestRunArtifact.kind ?? "run artifact",
      artifactRef: `.ai-workflow/state/run-artifacts/${latestRunArtifact.id}.json`,
      recordedAt: latestRunArtifact.recordedAt ?? new Date().toISOString(),
      details: latestRunArtifact
    });
  }

  const dedupedEntities = dedupeEntities(derivedEntities);
  for (const entity of dedupedEntities) {
    store.upsertEntity(entity);
  }
  store.replaceTestRunsForSource("dogfood", dogfoodRuns);
  store.replaceTestRunsForSource("run-artifact", runArtifactRuns);
}

export async function resolveProjectStatus({
  projectRoot = process.cwd(),
  selector,
  type = null,
  includeRelated = true,
  rawQuestion = false,
  relatedLimit = 12
} = {}) {
  const store = await openWorkflowStore({ projectRoot });
  try {
    return await resolveProjectStatusFromStore(store, {
      projectRoot,
      selector,
      type,
      includeRelated,
      rawQuestion,
      relatedLimit
    });
  } finally {
    store.close();
  }
}

export async function resolveProjectStatusFromStore(store, {
  projectRoot = process.cwd(),
  selector,
  type = null,
  includeRelated = true,
  rawQuestion = false,
  relatedLimit = 12
} = {}) {
  const normalizedType = normalizeStatusType(type);
  const graph = store.listArchitecturalPredicates();
  const summary = buildProjectSummary(store);
  const dirtyChanges = await loadDirtyChanges(projectRoot);
  const dirtyPaths = new Set(dirtyChanges.map((item) => item.path));

  const node = resolveStatusSelector(store, selector, {
    type: normalizedType,
    rawQuestion,
    projectRoot
  });
  if (!node) {
    return {
      ok: false,
      query: selector ?? "",
      error: `No status target matched "${String(selector ?? "").trim()}".`,
      candidates: []
    };
  }

  const related = includeRelated ? collectRelatedNodes(store, graph, node, { relatedLimit, projectRoot }) : [];
  const tests = collectTestsForNode(store, graph, node, related);
  const latestTestResult = summarizeLatestTestResults(tests);
  const nodeFilePaths = collectNodeFilePaths(store, node, related);
  const dirtyNodeFiles = nodeFilePaths.filter((filePath) => dirtyPaths.has(filePath));
  const status = deriveStatus(node, latestTestResult, dirtyNodeFiles);
  const freshness = {
    dbSyncAt: store.getMeta("lastSync", null)?.startedAt ?? null,
    latestTestAt: latestTestResult.recordedAt ?? null,
    dirtyFiles: dirtyNodeFiles.length
  };
  const evidence = buildEvidence(node, related, tests, dirtyNodeFiles, freshness, summary);

  return {
    ok: true,
    query: selector ?? "",
    id: node.id,
    type: node.type,
    title: node.title,
    status,
    summary: buildNodeSummary(node, related, latestTestResult, dirtyNodeFiles, summary),
    freshness,
    evidence,
    related,
    tests,
    latestTestResult,
    provenance: node.provenance ?? null
  };
}

export function formatStatusReport(report) {
  if (!report?.ok) {
    return String(report?.error ?? "Status query failed.");
  }

  const lines = [];
  if (report.type === "ticket") {
    lines.push(`Ticket: ${report.id} | ${report.status} | ${report.title}`);
  }
  lines.push(`${report.title} [${report.type}]`);
  lines.push(`Status: ${report.status}`);
  if (report.summary) {
    lines.push(report.summary);
  }
  const artifactTitles = collectArtifactTitles(report);
  if (artifactTitles.length) {
    lines.push(`Files: ${artifactTitles.join(", ")}`);
  }
  if (report.freshness?.dbSyncAt || report.freshness?.latestTestAt || report.freshness?.dirtyFiles) {
    const freshness = [];
    if (report.freshness.dbSyncAt) freshness.push(`db sync ${report.freshness.dbSyncAt}`);
    if (report.freshness.latestTestAt) freshness.push(`latest test ${report.freshness.latestTestAt}`);
    if (report.freshness.dirtyFiles) freshness.push(`${report.freshness.dirtyFiles} dirty file${report.freshness.dirtyFiles === 1 ? "" : "s"}`);
    if (freshness.length) {
      lines.push(`Freshness: ${freshness.join(" | ")}`);
    }
  }
  if (report.evidence?.length) {
    lines.push("");
    lines.push("Evidence:");
    for (const item of report.evidence.slice(0, 6)) {
      lines.push(`- ${item}`);
    }
  }
  if (report.tests?.length) {
    lines.push("");
    lines.push("Tests:");
    for (const test of report.tests.slice(0, 8)) {
      const details = [test.latestStatus ?? "unknown"];
      if (test.recordedAt) details.push(test.recordedAt);
      if (test.source) details.push(test.source);
      lines.push(`- ${test.title} [${details.join(" | ")}]`);
    }
  }
  if (report.related?.length) {
    lines.push("");
    lines.push("Related:");
    for (const item of report.related.slice(0, 10)) {
      lines.push(`- ${item.relation}: ${item.title} [${item.type}]`);
    }
  }
  if (report.type === "ticket" && artifactTitles.length) {
    lines.push("");
    lines.push(`Review focus: confirm ${artifactTitles.slice(0, 4).join(", ")} still match the ticket scope and linked verification.`);
    lines.push(`Resume prompt: continue ${report.id} by inspecting ${artifactTitles.slice(0, 3).join(", ")} before mutating.`);
  }
  return `${lines.join("\n")}\n`;
}

function collectArtifactTitles(report) {
  const titles = [];
  for (const item of report.related ?? []) {
    if (item?.type === "file" && item?.title) {
      titles.push(String(item.title));
    }
  }
  for (const test of report.tests ?? []) {
    if (test?.title) {
      titles.push(String(test.title));
    }
  }
  return [...new Set(titles)]
    .sort((left, right) => artifactPathRank(left) - artifactPathRank(right) || left.localeCompare(right))
    .slice(0, 8);
}

function artifactPathRank(filePath) {
  const normalized = String(filePath ?? "");
  if (/^(src|functions)\//.test(normalized)) return 0;
  if (/^tests\//.test(normalized)) return 1;
  if (/^(cli|core|runtime)\//.test(normalized)) return 2;
  if (/^scripts\//.test(normalized)) return 3;
  if (/^docs\//.test(normalized)) return 4;
  return 5;
}

function normalizeStatusType(type) {
  if (!type) return null;
  return STATUS_TYPE_ALIASES[String(type).trim().toLowerCase()] ?? String(type).trim().toLowerCase();
}

function canonicalFileId(filePath) {
  return `${FILE_ID_PREFIX}${filePath}`;
}

function canonicalSymbolId(symbolId) {
  return `${SYMBOL_ID_PREFIX}${symbolId}`;
}

function canonicalSurfaceId(surfaceId) {
  return `${SURFACE_ID_PREFIX}${surfaceId}`;
}

function canonicalTestId(filePath) {
  return `${TEST_ID_PREFIX}${filePath}`;
}

function isTestFile(filePath) {
  const normalized = String(filePath ?? "").replace(/\\/g, "/");
  return TEST_FILE_RE.test(normalized) || TEST_FILE_NAME_RE.test(normalized);
}

function normalizeStoryList(values = []) {
  return values.map((value) => String(value ?? "").trim()).filter(Boolean);
}

function runtimeTicketFromEntity(entity) {
  return {
    id: entity.id,
    title: entity.title,
    heading: `${entity.id}: ${entity.title}`,
    body: [entity.data?.summary, entity.data?.outcome, entity.data?.verification].filter(Boolean).join("\n"),
    section: entity.lane ?? "Todo"
  };
}

function resolveSymbolLabel(store, symbolLabel) {
  const parsed = String(symbolLabel ?? "").match(/^(.+)\s+\((.+):(\d+)\)$/);
  if (!parsed) {
    const exact = store.listSymbols({ name: String(symbolLabel ?? "") });
    return exact.length === 1 ? exact[0] : null;
  }
  const [, name, filePath] = parsed;
  return store.listSymbols({ filePath, name }).find(Boolean) ?? null;
}

function dedupeEntities(entities) {
  const seen = new Map();
  for (const entity of entities) {
    if (!seen.has(entity.id)) {
      seen.set(entity.id, entity);
      continue;
    }
    const existing = seen.get(entity.id);
    seen.set(entity.id, {
      ...existing,
      ...entity,
      data: { ...(existing.data ?? {}), ...(entity.data ?? {}) }
    });
  }
  return [...seen.values()];
}

function resolveImportedProjectPath(importerPath, specifier, fileSet) {
  const value = String(specifier ?? "").trim();
  if (!value || (!value.startsWith(".") && !value.startsWith("/"))) {
    return null;
  }
  const baseDir = path.posix.dirname(importerPath);
  const joined = value.startsWith("/")
    ? value.replace(/^\/+/, "")
    : path.posix.normalize(path.posix.join(baseDir, value));
  const candidates = [
    joined,
    `${joined}.mjs`,
    `${joined}.js`,
    `${joined}.ts`,
    `${joined}.tsx`,
    `${joined}.jsx`,
    `${joined}.cjs`,
    `${joined}.mts`,
    `${joined}.cts`,
    path.posix.join(joined, "index.mjs"),
    path.posix.join(joined, "index.js"),
    path.posix.join(joined, "index.ts"),
    path.posix.join(joined, "index.tsx")
  ];
  return candidates.find((candidate) => fileSet.has(candidate)) ?? null;
}

function guessTestTargetsFromName(testFilePath, fileSet) {
  const basename = path.posix.basename(testFilePath).replace(TEST_FILE_NAME_RE, "");
  const directMatches = [...fileSet]
    .filter((candidate) => !isTestFile(candidate))
    .filter((candidate) => path.posix.basename(candidate).replace(/\.[^.]+$/, "") === basename)
    .slice(0, 3);
  return directMatches;
}

function resolveStatusSelector(store, selector, { type = null, rawQuestion = false, projectRoot = process.cwd() } = {}) {
  const text = String(selector ?? "").trim();
  const normalized = text.toLowerCase();
  if (!text) {
    return buildProjectNode(projectRoot);
  }
  if (!type && /\b(project|repo|repository|codebase)\b/.test(normalized)) {
    return buildProjectNode(projectRoot);
  }
  if (type === "project") {
    return buildProjectNode(projectRoot);
  }

  const explicitId = text.match(/\b(?:BUG|TKT|EPC|EPIC|REL|REF|MOD|FEAT)-[A-Z0-9-]+\b/i)?.[0];
  if (explicitId) {
    const byId = getNodeById(store, explicitId.toUpperCase(), projectRoot);
    if (byId && (!type || byId.type === type || typeMatchesAlias(byId.type, type))) {
      return byId;
    }
  }

  for (const surfaceId of Object.keys(OPERATOR_SURFACES)) {
    if ((rawQuestion && normalized.includes(surfaceId)) || normalized === surfaceId) {
      if (!type || type === "surface") {
        return getNodeById(store, canonicalSurfaceId(surfaceId), projectRoot);
      }
    }
  }

  const exactNode = getNodeById(store, text, projectRoot)
    ?? getNodeById(store, text.toUpperCase(), projectRoot)
    ?? getNodeById(store, canonicalFileId(text), projectRoot)
    ?? getNodeById(store, canonicalSurfaceId(text), projectRoot)
    ?? getNodeById(store, canonicalTestId(text), projectRoot);
  if (exactNode && (!type || exactNode.type === type || typeMatchesAlias(exactNode.type, type))) {
    return exactNode;
  }

  const candidates = collectSelectorCandidates(store, text, { type, rawQuestion, projectRoot });
  if (!candidates.length) {
    return null;
  }
  candidates.sort((left, right) => right.score - left.score || left.node.title.localeCompare(right.node.title));
  if (candidates.length > 1 && candidates[0].score === candidates[1].score) {
    const exactSurface = candidates.find((candidate) => candidate.node.type === "surface");
    if (exactSurface) {
      return exactSurface.node;
    }
  }
  return candidates[0].node;
}

function collectSelectorCandidates(store, selector, { type = null, rawQuestion = false, projectRoot = process.cwd() } = {}) {
  const query = String(selector ?? "").trim().toLowerCase();
  const stripped = rawQuestion ? stripStatusQuestion(selector) : String(selector ?? "");
  const tokens = tokenizeStatusQuery(stripped || query);
  const candidates = [];
  const seen = new Set();
  const addCandidate = (node, score, aliases = []) => {
    if (!node) return;
    if (type && !(node.type === type || typeMatchesAlias(node.type, type))) return;
    const current = seen.has(node.id) ? candidates.find((item) => item.node.id === node.id) : null;
    if (current) {
      current.score = Math.max(current.score, score);
      return;
    }
    seen.add(node.id);
    candidates.push({ node, score, aliases });
  };

  addCandidate(buildProjectNode(projectRoot), query === "project" || query === "repo" ? 200 : 0);

  for (const entity of store.listEntities()) {
    addCandidate(mapEntityNode(entity), scoreCandidate(query, tokens, [entity.id, entity.title, entity.data?.summary, entity.data?.epic]));
  }
  for (const module of store.listModules()) {
    addCandidate(mapModuleNode(module), scoreCandidate(query, tokens, [module.id, module.name, module.responsibility]));
  }
  for (const feature of store.listFeatures()) {
    addCandidate(mapFeatureNode(feature), scoreCandidate(query, tokens, [feature.id, feature.name, feature.description]));
  }
  for (const file of store.listFiles()) {
    addCandidate(mapFileNode(file), scoreCandidate(query, tokens, [file.path, path.posix.basename(file.path)]));
  }
  for (const [surfaceId, definition] of Object.entries(OPERATOR_SURFACES)) {
    addCandidate(getNodeById(store, canonicalSurfaceId(surfaceId), projectRoot), scoreCandidate(query, tokens, [surfaceId, definition.description]));
  }

  const searchResults = store.search(stripped || selector, { limit: 8 });
  for (const item of searchResults) {
    if (item.scope === "entity") {
      addCandidate(getNodeById(store, item.refId, projectRoot), 140);
    } else if (item.scope === "file") {
      addCandidate(getNodeById(store, canonicalFileId(item.refId), projectRoot), 135);
    } else if (item.scope === "symbol") {
      addCandidate(getNodeById(store, canonicalSymbolId(item.refId), projectRoot), 130);
    }
  }

  return candidates.filter((candidate) => candidate.score > 0);
}

function stripStatusQuestion(value) {
  return String(value ?? "")
    .replace(/\bwhat(?:'s| is)?\b/gi, " ")
    .replace(/\bhow is\b/gi, " ")
    .replace(/\bshow me\b/gi, " ")
    .replace(/\btell me\b/gi, " ")
    .replace(/\bgive me\b/gi, " ")
    .replace(/\bthe status of\b/gi, " ")
    .replace(/\bstatus for\b/gi, " ")
    .replace(/\bstate of\b/gi, " ")
    .replace(/\bwhat did the tests cover\b/gi, " ")
    .replace(/\bwhat do the tests cover\b/gi, " ")
    .replace(/[?!.,;:()]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeStatusQuery(value) {
  return String(value ?? "")
    .toLowerCase()
    .split(/[^a-z0-9_./:-]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !STATUS_STOP_WORDS.has(token));
}

function scoreCandidate(query, tokens, haystacks) {
  const normalizedHaystacks = haystacks.map((value) => String(value ?? "").toLowerCase()).filter(Boolean);
  let score = 0;
  for (const haystack of normalizedHaystacks) {
    if (!haystack) continue;
    if (query && haystack === query) score = Math.max(score, 180);
    if (query && haystack.includes(query)) score = Math.max(score, 140);
    for (const token of tokens) {
      if (!token) continue;
      if (haystack === token) {
        score += 60;
      } else if (haystack.includes(token)) {
        score += 25;
      }
      if (haystack.endsWith(`/${token}`) || haystack === path.posix.basename(haystack)) {
        score += 20;
      }
    }
  }
  return score;
}

function typeMatchesAlias(actualType, requestedType) {
  return normalizeStatusType(actualType) === normalizeStatusType(requestedType);
}

function getNodeById(store, id, projectRoot) {
  if (!id) return null;
  if (id === PROJECT_NODE_ID) {
    return buildProjectNode(projectRoot);
  }
  if (String(id).startsWith(FILE_ID_PREFIX)) {
    const file = store.getFile(String(id).slice(FILE_ID_PREFIX.length));
    return file ? mapFileNode(file) : null;
  }
  if (String(id).startsWith(SYMBOL_ID_PREFIX)) {
    const symbol = store.getSymbolById(String(id).slice(SYMBOL_ID_PREFIX.length));
    return symbol ? mapSymbolNode(symbol) : null;
  }
  const entity = store.getEntity(id);
  if (entity) {
    return mapEntityNode(entity);
  }
  const file = store.getFile(id);
  if (file) {
    return mapFileNode(file);
  }
  const symbol = store.getSymbolById(id);
  if (symbol) {
    return mapSymbolNode(symbol);
  }
  const module = store.listModules().find((item) => item.id === id || item.name === id);
  if (module) {
    return mapModuleNode(module);
  }
  const feature = store.listFeatures().find((item) => item.id === id || item.name === id);
  if (feature) {
    return mapFeatureNode(feature);
  }
  return null;
}

function buildProjectNode(projectRoot) {
  return {
    id: PROJECT_NODE_ID,
    type: "project",
    title: path.basename(projectRoot),
    state: "open",
    data: {},
    provenance: "workspace"
  };
}

function mapEntityNode(entity) {
  const normalizedType = normalizeStatusType(entity.entityType) ?? entity.entityType;
  return {
    id: entity.id,
    type: normalizedType,
    title: entity.title,
    state: entity.state,
    lane: entity.lane ?? null,
    data: entity.data ?? {},
    provenance: entity.provenance ?? null
  };
}

function mapModuleNode(module) {
  return {
    id: module.id,
    type: "module",
    title: module.name,
    state: "open",
    data: {
      responsibility: module.responsibility ?? "",
      apiParadigm: module.api_paradigm ?? "method-calls"
    },
    provenance: "workflow-db"
  };
}

function mapFeatureNode(feature) {
  return {
    id: feature.id,
    type: "feature",
    title: feature.name,
    state: feature.status ?? "active",
    data: {
      description: feature.description ?? ""
    },
    provenance: "workflow-db"
  };
}

function mapFileNode(file) {
  return {
    id: canonicalFileId(file.path),
    type: "file",
    title: file.path,
    state: "indexed",
    data: {
      path: file.path,
      language: file.language,
      fileKind: file.fileKind
    },
    provenance: "workflow-db"
  };
}

function mapSymbolNode(symbol) {
  return {
    id: canonicalSymbolId(symbol.id),
    type: "symbol",
    title: symbol.name,
    state: "indexed",
    data: {
      symbolId: symbol.id,
      filePath: symbol.filePath,
      kind: symbol.kind,
      line: symbol.line ?? null
    },
    provenance: "workflow-db"
  };
}

function collectRelatedNodes(store, graph, node, { relatedLimit = 12, projectRoot = process.cwd() } = {}) {
  const related = [];
  const seen = new Set();
  const push = (relation, nodeId) => {
    if (!nodeId || nodeId === node.id || seen.has(`${relation}:${nodeId}`)) {
      return;
    }
    const relatedNode = getNodeById(store, nodeId, projectRoot);
    if (!relatedNode) {
      return;
    }
    seen.add(`${relation}:${nodeId}`);
    related.push({
      id: relatedNode.id,
      type: relatedNode.type,
      title: relatedNode.title,
      relation
    });
  };

  if (node.type === "project") {
    for (const surfaceId of Object.keys(OPERATOR_SURFACES)) {
      push("surface", canonicalSurfaceId(surfaceId));
    }
    for (const ticket of store.listEntities({ entityType: "ticket" }).filter((item) => item.state !== "archived").slice(0, 4)) {
      push("ticket", ticket.id);
    }
    return related.slice(0, relatedLimit);
  }

  if (node.type === "symbol" && node.data.filePath) {
    push("defined_in", canonicalFileId(node.data.filePath));
  }
  if (node.type === "test" && node.data.filePath) {
    push("defined_in", canonicalFileId(node.data.filePath));
  }

  for (const edge of graph) {
    if (edge.subjectId === node.id) {
      push(edge.predicate, edge.objectId);
    }
    if (edge.objectId === node.id) {
      push(edge.predicate, edge.subjectId);
    }
  }

  return related.slice(0, relatedLimit);
}

function collectTestsForNode(store, graph, node, related) {
  const candidateTargetIds = new Set([node.id]);
  for (const item of related) {
    if (item.type === "file" || item.type === "surface" || item.type === "module" || item.type === "feature" || item.type === "ticket" || item.type === "story") {
      candidateTargetIds.add(item.id);
    }
  }

  const directTestIds = new Set();
  for (const edge of graph) {
    if (String(edge.subjectId).startsWith(TEST_ID_PREFIX) && candidateTargetIds.has(edge.objectId)) {
      directTestIds.add(edge.subjectId);
    }
    if (candidateTargetIds.has(edge.subjectId) && String(edge.objectId).startsWith(TEST_ID_PREFIX)) {
      directTestIds.add(edge.objectId);
    }
  }

  const tests = [];
  for (const testId of directTestIds) {
    const testEntity = store.getEntity(testId);
    if (!testEntity) {
      continue;
    }
    const runs = store.listTestRuns({ testId });
    const latest = runs[0] ?? null;
    const targets = runs.filter((run) => candidateTargetIds.has(run.targetId));
    tests.push({
      id: testId,
      title: testEntity.title,
      latestStatus: latest?.status ?? null,
      recordedAt: latest?.recordedAt ?? null,
      source: latest?.source ?? null,
      summary: latest?.summary ?? null,
      targets: targets.map((run) => run.targetId)
    });
  }

  tests.sort((left, right) => {
    const leftRank = testStatusRank(left.latestStatus);
    const rightRank = testStatusRank(right.latestStatus);
    return rightRank - leftRank || String(right.recordedAt ?? "").localeCompare(String(left.recordedAt ?? ""));
  });
  return tests;
}

function testStatusRank(status) {
  if (status === "fail") return 3;
  if (status === "pass") return 2;
  return 1;
}

function summarizeLatestTestResults(tests) {
  const latestKnown = tests.filter((test) => test.latestStatus);
  const failing = latestKnown.filter((test) => test.latestStatus === "fail").length;
  const passing = latestKnown.filter((test) => test.latestStatus === "pass").length;
  const recordedAt = latestKnown.map((test) => test.recordedAt).filter(Boolean).sort().at(-1) ?? null;
  const status = failing > 0 ? "fail" : (passing > 0 ? "pass" : "unknown");
  return {
    status,
    recordedAt,
    total: tests.length,
    known: latestKnown.length,
    passing,
    failing
  };
}

function collectNodeFilePaths(store, node, related) {
  const filePaths = new Set();
  if (node.type === "file") {
    filePaths.add(node.data.path);
  }
  if (node.type === "symbol" && node.data.filePath) {
    filePaths.add(node.data.filePath);
  }
  if (node.type === "test" && node.data.filePath) {
    filePaths.add(node.data.filePath);
  }
  for (const item of related) {
    if (item.type === "file") {
      const relatedNode = getNodeById(store, item.id, process.cwd());
      if (relatedNode?.data?.path) {
        filePaths.add(relatedNode.data.path);
      }
    }
  }
  return [...filePaths];
}

function deriveStatus(node, latestTestResult, dirtyNodeFiles) {
  if (node.type === "ticket") {
    if (latestTestResult.failing > 0) return "at-risk";
    return String(node.lane ?? node.state ?? "open").toLowerCase();
  }
  if (node.type === "epic" || node.type === "story" || node.type === "test-plan" || node.type === "implementation-plan") {
    return String(node.state ?? "open").toLowerCase();
  }
  if (node.type === "test") {
    if (latestTestResult.status === "fail") return "failing";
    if (latestTestResult.status === "pass") return "passing";
    return "tracked";
  }
  if (latestTestResult.status === "fail") return "failing";
  if (dirtyNodeFiles.length) return "changed";
  if (latestTestResult.status === "pass") return "healthy";
  return String(node.state ?? "unknown").toLowerCase();
}

function buildNodeSummary(node, related, latestTestResult, dirtyNodeFiles, projectSummary) {
  if (node.type === "project") {
    return `${projectSummary.activeTickets.length} active tickets, ${projectSummary.candidates.length} candidates, ${projectSummary.noteCount} notes.`;
  }
  if (node.type === "surface") {
    const fileCount = related.filter((item) => item.type === "file").length;
    return `${node.data.description || "Operator surface"} ${fileCount ? `Related files: ${fileCount}.` : ""}`.trim();
  }
  if (node.type === "module") {
    return String(node.data.responsibility ?? "").trim() || "Tracked module.";
  }
  if (node.type === "feature") {
    return String(node.data.description ?? "").trim() || "Tracked feature.";
  }
  if (node.type === "file") {
    return `${node.data.language} ${node.data.fileKind}.`;
  }
  if (node.type === "symbol") {
    return `${node.data.kind} in ${node.data.filePath}${node.data.line ? `:${node.data.line}` : ""}.`;
  }
  if (node.type === "ticket") {
    return [node.data.summary, dirtyNodeFiles.length ? `${dirtyNodeFiles.length} related dirty files.` : null, latestTestResult.known ? `${latestTestResult.known} tests with recorded results.` : null]
      .filter(Boolean)
      .join(" ");
  }
  if (node.type === "story") {
    return String(node.data.body ?? "").trim();
  }
  if (node.type === "test") {
    return latestTestResult.status === "unknown"
      ? "Tracked test without a recorded recent result."
      : `Latest known result: ${latestTestResult.status}.`;
  }
  return String(node.data.summary ?? node.data.description ?? "").trim() || "Tracked status node.";
}

function buildEvidence(node, related, tests, dirtyNodeFiles, freshness, summary) {
  const evidence = [];
  if (node.type === "project") {
    evidence.push(`Project summary has ${summary.activeTickets.length} active tickets and ${summary.modules?.length ?? 0} modules.`);
  }
  if (node.type === "surface" && node.data.description) {
    evidence.push(node.data.description);
  }
  if (node.type === "ticket" && node.data.summary) {
    evidence.push(node.data.summary);
  }
  if (dirtyNodeFiles.length) {
    evidence.push(`Dirty files: ${dirtyNodeFiles.slice(0, 5).join(", ")}${dirtyNodeFiles.length > 5 ? "..." : ""}`);
  }
  if (tests.length) {
    evidence.push(`Linked tests: ${tests.slice(0, 4).map((test) => test.title).join(", ")}`);
  }
  if (related.length) {
    evidence.push(`Related nodes: ${related.slice(0, 5).map((item) => `${item.title} (${item.type})`).join(", ")}`);
  }
  if (freshness.dbSyncAt) {
    evidence.push(`Workflow DB last synced at ${freshness.dbSyncAt}.`);
  }
  return evidence;
}

async function loadDirtyChanges(projectRoot) {
  if (!await isGitRepo(projectRoot)) {
    return [];
  }
  try {
    return await getChanges(projectRoot);
  } catch {
    return [];
  }
}

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}
