import path from "node:path";
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { ensureDir } from "../../runtime/scripts/ai-workflow/lib/fs-utils.mjs";
import { getToolkitRoot } from "../lib/operating-context.mjs";
import { stableId } from "../lib/hash.mjs";

export { getToolkitRoot } from "../lib/operating-context.mjs";

const codeletRegistryCache = new Map();

export function getSharedCodeletsDir(toolkitRoot = getToolkitRoot()) {
  return path.resolve(toolkitRoot, "shared", "codelets");
}

export function getProjectCodeletsDir(root = process.cwd()) {
  return path.resolve(root, ".ai-workflow", "codelets");
}

export async function listToolkitCodelets({ toolkitRoot = getToolkitRoot() } = {}) {
  return listCodeletsInDir(getSharedCodeletsDir(toolkitRoot), {
    sourceKind: "toolkit",
    sourceRoot: toolkitRoot
  });
}

export async function getToolkitCodelet(name, { toolkitRoot = getToolkitRoot() } = {}) {
  return getCodeletFromDir(getSharedCodeletsDir(toolkitRoot), name, {
    sourceKind: "toolkit",
    sourceRoot: toolkitRoot
  });
}

export async function listProjectCodelets(root = process.cwd()) {
  return listCodeletsInDir(getProjectCodeletsDir(root), {
    sourceKind: "project",
    sourceRoot: root
  });
}

export async function getProjectCodelet(root, name) {
  return getCodeletFromDir(getProjectCodeletsDir(root), name, {
    sourceKind: "project",
    sourceRoot: root
  });
}

export async function upsertProjectCodelet(root, name, filePath, mode) {
  const codeletsDir = getProjectCodeletsDir(root);
  const manifestPath = path.resolve(codeletsDir, `${name}.json`);
  const relativeEntry = path.relative(root, path.resolve(root, filePath)).split(path.sep).join("/");
  const existing = await getProjectCodelet(root, name);

  const manifest = {
    id: name,
    summary: existing?.summary ?? `${mode === "add" ? "Staged" : "Updated"} project codelet.`,
    runner: "node-script",
    entry: relativeEntry,
    stability: "staged",
    status: "staged"
  };

  await ensureDir(codeletsDir);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { ...manifest, manifestPath, sourceKind: "project" };
}

export async function removeProjectCodelet(root, name) {
  const manifestPath = path.resolve(getProjectCodeletsDir(root), `${name}.json`);
  await rm(manifestPath, { force: true });
}

export async function forgeProjectCodelet(root, name) {
  const stagedDir = path.resolve(root, ".ai-workflow", "staged-codelets");
  const entryPath = path.resolve(stagedDir, `${name}.mjs`);
  const manifest = await upsertProjectCodelet(root, name, entryPath, "add");
  const source = [
    "/* Responsibility: Project-local staged codelet for bounded low-risk helper work.",
    "Scope: Keep this deterministic and review it before treating it as a stable built-in. */",
    "import process from \"node:process\";",
    "",
    "const args = process.argv.slice(2);",
    `process.stdout.write(JSON.stringify({ codelet: ${JSON.stringify(name)}, args }, null, 2) + \"\\n\");`
  ].join("\n");

  await ensureDir(stagedDir);
  await writeFile(entryPath, `${source}\n`, "utf8");
  return {
    ...manifest,
    entryPath
  };
}

export async function refreshCodeletRegistry(store, { projectRoot = store.projectRoot, toolkitRoot = getToolkitRoot() } = {}) {
  const [toolkitCodelets, projectCodelets] = await Promise.all([
    listToolkitCodelets({ toolkitRoot }),
    listProjectCodelets(projectRoot)
  ]);

  const currentIds = new Set();
  const backingIssues = [];

  for (const manifest of toolkitCodelets) {
    const entity = await buildCodeletEntity(manifest, {
      sourceKind: "toolkit",
      sourceRoot: toolkitRoot
    });
    store.upsertEntity(entity);
    currentIds.add(entity.id);
    if (entity.data.backing?.status === "missing") {
      backingIssues.push({
        codeletId: entity.data.codeletId,
        sourceKind: entity.sourceKind,
        manifestPath: entity.data.manifestPath,
        entryPath: entity.data.entryPath
      });
    }
  }

  for (const manifest of projectCodelets) {
    const entity = await buildCodeletEntity(manifest, {
      sourceKind: "project",
      sourceRoot: projectRoot
    });
    store.upsertEntity(entity);
    currentIds.add(entity.id);
    if (entity.data.backing?.status === "missing") {
      backingIssues.push({
        codeletId: entity.data.codeletId,
        sourceKind: entity.sourceKind,
        manifestPath: entity.data.manifestPath,
        entryPath: entity.data.entryPath
      });
    }
  }

  const staleIds = store.listEntities({ entityType: "codelet" })
    .map((entity) => entity.id)
    .filter((id) => !currentIds.has(id));

  for (const id of staleIds) {
    store.deleteEntity(id);
  }

  invalidateCodeletRegistryCache(projectRoot);
  return {
    toolkitCodelets: toolkitCodelets.length,
    projectCodelets: projectCodelets.length,
    codeletsIndexed: currentIds.size,
    removedCodelets: staleIds.length,
    backingIssues
  };
}

export async function listCodeletsFromStore(store, { sourceKind = null } = {}) {
  const cacheKey = getCodeletRegistryCacheKey(store.projectRoot, sourceKind);
  const cached = codeletRegistryCache.get(cacheKey);
  if (cached) {
    return cached.map((codelet) => ({ ...codelet, data: { ...codelet.data } }));
  }

  const codelets = store.listEntities({ entityType: "codelet" })
    .filter((entity) => !sourceKind || entity.sourceKind === sourceKind)
    .map(materializeCodeletRecord)
    .sort(compareCodeletRecords);
  codeletRegistryCache.set(cacheKey, codelets);
  return codelets;
}

export async function getCodeletFromStore(store, codeletId) {
  const matches = (await listCodeletsFromStore(store))
    .filter((codelet) => codelet.id === codeletId || codelet.data?.codeletId === codeletId)
    .sort(compareCodeletRecords);

  if (!matches.length) {
    return null;
  }

  return {
    ...matches[0],
    variants: matches
  };
}

export async function searchCodeletsFromStore(store, query, { limit = 20, sourceKind = null } = {}) {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) {
    return [];
  }

  return (await listCodeletsFromStore(store, { sourceKind }))
    .map((codelet) => ({
      ...codelet,
      score: scoreCodeletMatch(codelet, normalized)
    }))
    .filter((codelet) => codelet.score > 0)
    .sort((left, right) => right.score - left.score || compareCodeletRecords(left, right))
    .slice(0, limit);
}

export function invalidateCodeletRegistryCache(projectRoot = null) {
  if (!projectRoot) {
    codeletRegistryCache.clear();
    return;
  }

  const root = String(projectRoot);
  for (const key of [...codeletRegistryCache.keys()]) {
    if (key.startsWith(`${root}::`)) {
      codeletRegistryCache.delete(key);
    }
  }
}

function compareCodeletRecords(left, right) {
  const priorityLeft = sourceKindPriority(left.sourceKind);
  const priorityRight = sourceKindPriority(right.sourceKind);
  if (priorityLeft !== priorityRight) {
    return priorityLeft - priorityRight;
  }

  const codeletA = String(left.id ?? left.data?.codeletId ?? "").localeCompare(String(right.id ?? right.data?.codeletId ?? ""));
  if (codeletA !== 0) {
    return codeletA;
  }

  return String(left.manifestPath ?? left.data?.manifestPath ?? left.id).localeCompare(String(right.manifestPath ?? right.data?.manifestPath ?? right.id));
}

function sourceKindPriority(sourceKind) {
  if (sourceKind === "project") {
    return 0;
  }
  if (sourceKind === "toolkit") {
    return 1;
  }
  return 2;
}

function getCodeletRegistryCacheKey(projectRoot, sourceKind) {
  return `${path.resolve(String(projectRoot ?? ""))}::${sourceKind ?? "all"}`;
}

function materializeCodeletRecord(entity) {
  const data = entity.data ?? {};
  return {
    id: data.codeletId ?? entity.id,
    variantId: entity.id,
    title: entity.title,
    summary: data.summary ?? entity.title,
    category: data.category ?? null,
    stability: data.stability ?? null,
    status: data.status ?? entity.state,
    runner: data.runner ?? "node-script",
    entry: data.entry ?? null,
    entryPath: data.entryPath ?? null,
    manifestPath: data.manifestPath ?? null,
    execution: data.execution ?? null,
    sourceKind: entity.sourceKind,
    sourceRoot: data.sourceRoot ?? null,
    focus: data.focus ?? null,
    taskClass: data.taskClass ?? null,
    observer: Boolean(data.observer),
    backing: data.backing ?? null,
    state: entity.state,
    provenance: entity.provenance,
    reviewState: entity.reviewState,
    updatedAt: entity.updatedAt,
    createdAt: entity.createdAt,
    data
  };
}

function scoreCodeletMatch(codelet, query) {
  const haystack = [
    codelet.id,
    codelet.summary,
    codelet.category,
    codelet.stability,
    codelet.status,
    codelet.runner,
    codelet.entry,
    codelet.entryPath,
    codelet.manifestPath,
    codelet.focus,
    codelet.taskClass,
    codelet.sourceKind
  ].join("\n").toLowerCase();

  if (!haystack.includes(query)) {
    const tokens = query.split(/\s+/).filter(Boolean);
    if (!tokens.every((token) => haystack.includes(token))) {
      return 0;
    }
  }

  let score = 10;
  if (String(codelet.id ?? "").toLowerCase().includes(query)) score += 40;
  if (String(codelet.summary ?? "").toLowerCase().includes(query)) score += 20;
  if (String(codelet.category ?? "").toLowerCase().includes(query)) score += 10;
  if (String(codelet.focus ?? "").toLowerCase().includes(query)) score += 10;
  if (String(codelet.taskClass ?? "").toLowerCase().includes(query)) score += 8;
  if (String(codelet.manifestPath ?? "").toLowerCase().includes(query)) score += 5;
  return score;
}

function normalizeSearchQuery(query) {
  return String(query ?? "").trim().toLowerCase();
}

async function buildCodeletEntity(manifest, { sourceKind, sourceRoot }) {
  const manifestPath = manifest.manifestPath ?? null;
  const entryPath = manifest.entry ? path.resolve(sourceRoot, manifest.entry) : null;
  const entryExists = manifest.runner === "builtin"
    ? true
    : entryPath
      ? await awaitPathExists(entryPath)
      : false;
  const backing = manifest.runner === "builtin"
    ? {
        status: "builtin",
        exists: true,
        entryPath: null
      }
    : {
        status: entryExists ? "present" : "missing",
        exists: entryExists,
        entryPath
      };
  const timestamp = new Date().toISOString();
  const entityId = stableId("codelet", sourceKind, manifestPath ?? manifest.id);

  return {
    id: entityId,
    entityType: "codelet",
    title: manifest.summary ? `${manifest.id} ${manifest.summary}` : manifest.id,
    lane: manifest.category ?? null,
    state: manifest.status ?? "active",
    confidence: 1,
    provenance: "codelet-registry",
    sourceKind,
    reviewState: backing.status === "missing" ? "needs-attention" : "active",
    parentId: null,
    relevantUntil: null,
    consultationQuestion: null,
    data: {
      codeletId: manifest.id,
      summary: manifest.summary ?? "",
      category: manifest.category ?? null,
      stability: manifest.stability ?? null,
      status: manifest.status ?? null,
      runner: manifest.runner ?? "node-script",
      entry: manifest.entry ?? null,
      entryPath,
      manifestPath,
      sourceKind,
      sourceRoot,
      focus: manifest.focus ?? null,
      taskClass: manifest.taskClass ?? null,
      execution: manifest.execution ?? null,
      observer: Boolean(manifest.observer),
      backing
    },
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

async function listCodeletsInDir(codeletsDir, { sourceKind, sourceRoot }) {
  try {
    const entries = await readdir(codeletsDir, { withFileTypes: true });
    const manifests = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      const manifestPath = path.resolve(codeletsDir, entry.name);
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      manifests.push(resolveManifest(manifest, { manifestPath, sourceKind, sourceRoot }));
    }

    return manifests.sort(compareManifests);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function getCodeletFromDir(codeletsDir, name, { sourceKind, sourceRoot }) {
  const manifestPath = path.resolve(codeletsDir, `${name}.json`);

  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    return resolveManifest(manifest, { manifestPath, sourceKind, sourceRoot });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function resolveManifest(manifest, { manifestPath, sourceKind, sourceRoot }) {
  const resolved = {
    sourceKind,
    manifestPath,
    sourceRoot,
    ...manifest
  };

  if (manifest.entry) {
    resolved.entry = path.resolve(sourceRoot, manifest.entry);
  }

  return resolved;
}

function compareManifests(left, right) {
  return String(left.id).localeCompare(String(right.id));
}

async function awaitPathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
