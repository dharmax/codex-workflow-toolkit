import path from "node:path";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { listRepoFiles } from "./audit-utils.mjs";

export const OPERATOR_SURFACES = {
  shell: {
    description: "Interactive and non-interactive shell routing, planner selection, and mutation control.",
    exact: [
      "cli/lib/shell.mjs",
      "docs/MANUAL.md"
    ]
  },
  provider: {
    description: "Provider discovery, routing, setup, and local model hardware behavior.",
    exact: [
      "cli/lib/doctor.mjs",
      "cli/lib/ollama-hw.mjs",
      "cli/lib/provider-connect.mjs",
      "cli/lib/provider-setup.mjs",
      "core/services/model-fit.mjs",
      "core/services/providers.mjs",
      "core/services/router.mjs"
    ]
  },
  workflow: {
    description: "Top-level workflow command dispatch, ask/host resolution, and project workflow scripts.",
    exact: [
      "cli/lib/main.mjs",
      "core/services/host-resolver.mjs",
      "core/services/knowledge.mjs",
      "core/services/projections.mjs",
      "core/services/sync.mjs",
      "runtime/scripts/ai-workflow/context-pack.mjs",
      "runtime/scripts/ai-workflow/guidance-summary.mjs",
      "runtime/scripts/ai-workflow/guideline-audit.mjs",
      "runtime/scripts/ai-workflow/kanban-ticket.mjs",
      "runtime/scripts/ai-workflow/kanban.mjs",
      "runtime/scripts/ai-workflow/project-summary.mjs",
      "runtime/scripts/ai-workflow/route-task.mjs",
      "runtime/scripts/ai-workflow/sync.mjs",
      "runtime/scripts/ai-workflow/verification-summary.mjs"
    ],
    prefixes: [
      "scripts/ai-workflow/"
    ]
  },
  init: {
    description: "Project bootstrap, template install, audit baseline, and dogfooding/report scaffolding.",
    exact: [
      "AGENTS.md",
      "execution-protocol.md",
      "project-guidelines.md",
      "enforcement.md",
      "knowledge.md",
      "cli/lib/install.mjs",
      "runtime/scripts/ai-workflow/dogfood.mjs",
      "runtime/scripts/ai-workflow/lib/audit-utils.mjs",
      "runtime/scripts/ai-workflow/lib/dogfood-utils.mjs",
      "runtime/scripts/ai-workflow/lib/operator-surfaces.mjs",
      "runtime/scripts/ai-workflow/workflow-audit.mjs",
      "scripts/generate-manual-html.mjs",
      "scripts/init-project.mjs",
      "docs/manual.html",
      "scripts/ai-workflow/dogfood.mjs",
      "scripts/ai-workflow/workflow-audit.mjs"
    ],
    prefixes: [
      "templates/"
    ]
  }
};

export function listOperatorSurfaceIds() {
  return Object.keys(OPERATOR_SURFACES);
}

export async function collectOperatorSurfaceState(root, requestedSurfaceIds = listOperatorSurfaceIds()) {
  const repoFiles = await listRepoFiles(root);
  const surfaces = {};

  for (const surfaceId of requestedSurfaceIds) {
    const definition = OPERATOR_SURFACES[surfaceId];
    if (!definition) {
      continue;
    }

    const files = repoFiles.filter((relativePath) => matchesSurfaceFile(relativePath, definition));
    const fileHashes = {};

    for (const relativePath of files) {
      const absolutePath = path.resolve(root, relativePath);
      const buffer = await readFile(absolutePath);
      fileHashes[relativePath] = createHash("sha256").update(buffer).digest("hex");
    }

    surfaces[surfaceId] = {
      description: definition.description,
      fileCount: files.length,
      files,
      fileHashes
    };
  }

  return surfaces;
}

export function compareSurfaceHashes(expected, actual) {
  const expectedHashes = expected?.fileHashes ?? {};
  const actualHashes = actual?.fileHashes ?? {};
  const expectedFiles = Object.keys(expectedHashes).sort();
  const actualFiles = Object.keys(actualHashes).sort();

  if (expectedFiles.join("|") !== actualFiles.join("|")) {
    return false;
  }

  return expectedFiles.every((relativePath) => expectedHashes[relativePath] === actualHashes[relativePath]);
}

function matchesSurfaceFile(relativePath, definition) {
  if ((definition.exact ?? []).includes(relativePath)) {
    return true;
  }

  return (definition.prefixes ?? []).some((prefix) => relativePath.startsWith(prefix));
}
