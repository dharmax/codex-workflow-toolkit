/**
 * Responsibility: Provide the primary CLI entry point and subcommand dispatch logic.
 * Scope: Handles argument parsing, subcommand routing, and high-level service orchestration.
 */

import path from "node:path";
import { execFile, spawn } from "node:child_process";
import os from "node:os";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { parseArgs, printAndExit } from "../../runtime/scripts/ai-workflow/lib/cli.mjs";
import { getToolkitCodelet, getToolkitRoot } from "./codelets.mjs";
import { getConfigValue, getGlobalConfigPath, getProjectConfigPath, readConfig, removeConfigFile, removeConfigValue, writeConfigValue } from "./config-store.mjs";
import { runDoctor } from "./doctor.mjs";
import { handleSetOllamaHw } from "./ollama-hw.mjs";
import { handleShell } from "./shell.mjs";
import { handleProviderConnect } from "./provider-connect.mjs";
import { runProviderSetupWizard } from "./provider-setup.mjs";
import { installAgents } from "./install.mjs";
import { forgeProjectCodelet, removeProjectCodelet, upsertProjectCodelet } from "./project-codelets.mjs";
import { routeTask } from "../../core/services/router.mjs";
import { auditArchitecture } from "../../core/services/critic.mjs";
import { refreshProviderQuotaState } from "../../core/services/providers.mjs";
import { refreshCodeletRegistry, listCodeletsFromStore, getCodeletFromStore, searchCodeletsFromStore } from "../../core/services/codelets.mjs";
import { executeCodelet } from "../../core/services/codelet-executor.mjs";
import { buildTicketEntity, importLegacyProjections, inferTicketLane, renderEpicsProjection, renderKanbanProjection, writeProjectProjections } from "../../core/services/projections.mjs";
import { addManualNote, createTicket, evaluateProjectReadiness, getEpic, getProjectMetrics, getProjectSummary, listEpicUserStories, listEpics, reviewProjectCandidates, searchEpicUserStories, searchEpics, searchProject, syncProject, updateTicketLifecycle, withWorkflowStore } from "../../core/services/sync.mjs";
import { buildTelegramPreview } from "../../core/services/telegram.mjs";
import { onboardProjectBrief } from "../../core/services/orchestrator.mjs";
import { updateKnowledgeRemote } from "../../core/services/knowledge.mjs";
import { assertSafeRepairTarget, getToolkitRoot as getOperatingToolkitRoot, resolveOperatingContext } from "../../core/lib/operating-context.mjs";
import { readLatestRunArtifact } from "../../core/lib/run-artifacts.mjs";
import { resolveHostRequest } from "../../core/services/operator-brain.mjs";
import { discoverProviderState, refreshProviderRegistry } from "../../core/services/providers.mjs";
import { invalidateModelFitCache } from "../../core/services/model-fit.mjs";
import { invalidateWebSearchCache } from "../../core/services/web-search.mjs";
import { assertDirectCommandChannel } from "../../core/lib/command-channel.mjs";
import { withWorkspaceMutation } from "../../core/lib/workspace-mutation.mjs";
import { STATUS_NODE_TYPES, formatStatusReport, resolveProjectStatus } from "../../core/services/status.mjs";
import { listWorkflowIssues, refineWorkflowIssue } from "../../core/services/workflow-refinement.mjs";
import { runShellBenchmark } from "../../core/services/shell-benchmark.mjs";

const toolkitRoot = getToolkitRoot();
const execFileAsync = promisify(execFile);

const HELP = `Usage:
  ai-workflow setup [--project <path>]
  ai-workflow init [options]
  ai-workflow install [--project <path>]
  ai-workflow doctor [--json] [--refresh-models]
  ai-workflow version [--json]
  ai-workflow --version
  ai-workflow audit architecture [--json]
  ai-workflow kanban <new|move|next|archive|migrate> [...]
  ai-workflow set-ollama-hw [options]
  ai-workflow set-provider-key <provider-id> [--global]
  ai-workflow metrics [--json]
  ai-workflow onboard <brief-file> [--json]
  ai-workflow ingest <file> [--json]
  ai-workflow consult
  ai-workflow shell [request...] [--yes] [--plan-only] [--no-ai] [--json]
  ai-workflow ask [request...] [--mode <default|tool-dev>] [--root <path>] [--evidence-root <path>] [--json]
  ai-workflow sync [--write-projections] [--json]
  ai-workflow dogfood [--surface <id[,id...]>] [--profile <bootstrap|full>] [--json]
  ai-workflow reprofile [--json]
  ai-workflow list [--json]
  ai-workflow info <codelet>
  ai-workflow run <codelet> [args]
  ai-workflow add <codelet> <file>
  ai-workflow update <codelet> <file>
  ai-workflow remove <codelet>
  ai-workflow project summary [--json]
  ai-workflow project status <selector> [--type <type>] [--json]
  ai-workflow project status related <selector> [--type <type>] [--json]
  ai-workflow project status types
  ai-workflow project readiness --goal <goal-type> --question <text> [--mode <default|tool-dev>] [--root <path>] [--evidence-root <path>] [--json]
  ai-workflow project search <text> [--json]
  ai-workflow project epic <list|show|search> [...]
  ai-workflow project story <list|search> [...]
  ai-workflow project codelet <list|show|search> [...]
  ai-workflow project ticket create --id <id> --title <title> [--lane <lane>] [--epic <epic-id>] [--summary <text>] [--json]
  ai-workflow project ticket resolve <ticket-id> [--json]
  ai-workflow project ticket close <ticket-id> [--json]
  ai-workflow project ticket start <ticket-id> [--json]
  ai-workflow project ticket reopen <ticket-id> [--lane <lane>] [--json]
  ai-workflow project note add --type <NOTE|TODO|FIXME|HACK|BUG|RISK> --body <text> [--file <path>] [--line <n>] [--symbol <name>] [--json]
  ai-workflow project review-candidates [--json]
  ai-workflow extract ticket <id> [options]
  ai-workflow extract guidelines [options]
  ai-workflow verify <workflow|guidelines> [options]
  ai-workflow forge codelet <name>
  ai-workflow route <task-class> [--json]
  ai-workflow telegram preview [--json]
  ai-workflow provider connect <provider-id>
  ai-workflow provider setup [--global]
  ai-workflow provider quota refresh [provider-id|all] [--global] [--json]
  ai-workflow provider refresh [models|all] [--global] [--json]
  ai-workflow mode set <default|tool-dev> [--global]
  ai-workflow mode status [--json]
  ai-workflow knowledge update-remote [--url <remote-url>] [--json]
  ai-workflow tool observe [--complaint <text>] [--json]
  ai-workflow tool refine [issue-id] [--json]
  ai-workflow tool benchmark <prompt> [--json]
  ai-workflow web tutorial [--port <n>] [--host <host>] [--json]
  ai-workflow config get [key]
  ai-workflow config set <key> <value>

Notes:
  - Prefer local install for stable project usage.
  - Built-in codelets are versioned; project codelets are staged by default.
  - Use \`run context-pack\` before recommending a fresh session.
`;

export async function main(argv) {
  if (!argv.length || argv[0] === "--help" || argv[0] === "-h") {
    printAndExit(HELP);
  }

  if (argv[0] === "--version" || argv[0] === "-v") {
    return handleVersion([]);
  }

  const [command, ...rest] = argv;

  switch (command) {
    case "setup":
      return handleInstall(rest);
    case "init":
      return runNodeScript(path.resolve(toolkitRoot, "scripts", "init-project.mjs"), rest);
    case "install":
      return handleInstall(rest);
    case "doctor":
      await runDoctor({ root: process.cwd(), json: rest.includes("--json"), forceRefresh: rest.includes("--refresh-models") });
      return 0;
    case "version":
      return handleVersion(rest);
    case "audit":
      return handleAudit(rest);
    case "set-ollama-hw":
      return handleSetOllamaHw(rest, { root: process.cwd() });
    case "set-provider-key":
      return handleSetProviderKey(rest);
    case "metrics":
      return handleMetrics(rest);
    case "ingest":
      return handleIngest(rest);
    case "onboard":
      return handleOnboard(rest);
    case "consult":
      return handleConsult(rest);
    case "shell":
      return handleShell(rest, { cliPath: path.resolve(toolkitRoot, "cli", "ai-workflow.mjs") });
    case "ask":
      return handleAsk(rest);
    case "sync":
      return handleSync(rest);
    case "dogfood":
      return handleDogfood(rest);
    case "reprofile":
      await runDoctor({ root: process.cwd(), json: rest.includes("--json"), forceRefresh: true });
      return 0;
    case "list":
      return handleList(rest);
    case "kanban":
      return handleKanban(rest);
    case "info":
      return handleInfo(rest);
    case "run":
      return handleRun(rest);
    case "add":
      return handleAdd(rest, "add");
    case "update":
      return handleAdd(rest, "update");
    case "remove":
      return handleRemove(rest);
    case "project":
      return handleProject(rest);
    case "extract":
      return handleExtract(rest);
    case "verify":
      return handleVerify(rest);
    case "forge":
      return handleForge(rest);
    case "route":
      return handleRoute(rest);
    case "telegram":
      return handleTelegram(rest);
    case "provider":
      return handleProvider(rest);
    case "mode":
      return handleMode(rest);
    case "knowledge":
      return handleKnowledge(rest);
    case "tool":
      return handleTool(rest);
    case "web":
      return handleWeb(rest);
    case "config":
      return handleConfig(rest);
    default:
      printAndExit(`Unknown command: ${command}\n\n${HELP}`, 1);
  }
}

async function handleList(rest) {
  const json = rest.includes("--json");
  const { toolkitCodelets, projectCodelets } = await withRefreshedCodeletRegistry(process.cwd(), async (store) => ({
    toolkitCodelets: await listCodeletsFromStore(store, { sourceKind: "toolkit" }),
    projectCodelets: await listCodeletsFromStore(store, { sourceKind: "project" })
  }));

  if (json) {
    process.stdout.write(`${JSON.stringify({ toolkitCodelets, projectCodelets }, null, 2)}\n`);
    return 0;
  }

  const lines = ["Toolkit codelets"];
  for (const codelet of toolkitCodelets) {
    lines.push(`- ${codelet.id} [${codelet.stability}] ${codelet.summary}`);
  }
  lines.push("");
  lines.push("Project codelets");
  for (const codelet of projectCodelets.length ? projectCodelets : [{ id: "none", status: "n/a", summary: "No project codelets registered." }]) {
    lines.push(`- ${codelet.id} [${codelet.status}] ${codelet.summary}`);
  }

  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

async function handleVersion(rest) {
  const args = parseArgs(rest);
  const packageJson = JSON.parse(await readFile(path.resolve(toolkitRoot, "package.json"), "utf8"));
  const payload = {
    name: packageJson.name,
    version: packageJson.version,
    toolkitRoot
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 0;
  }

  process.stdout.write(`${payload.name} ${payload.version}\n${payload.toolkitRoot}\n`);
  return 0;
}

async function handleSync(rest) {
  assertDirectCommandChannel("ai-workflow sync");
  const args = parseArgs(rest);
  const result = await syncProject({
    projectRoot: process.cwd(),
    writeProjections: Boolean(args["write-projections"])
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }

  const lines = [
    `DB: ${result.dbPath}`,
    `Indexed files: ${result.indexedFiles}`,
    `Symbols: ${result.indexedSymbols}`,
    `Claims: ${result.indexedClaims}`,
    `Notes: ${result.indexedNotes}`,
    `Codelets: ${result.codeletRegistry?.codeletsIndexed ?? 0}`,
    `Imported tickets: ${result.importSummary.importedTickets}`,
    `Reviewed candidates: ${result.lifecycle.reviewed.length}`
  ];
  if (result.projections) {
    lines.push(`Wrote projections: ${result.projections.kanbanPath}, ${result.projections.epicsPath}`);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

async function handleKanban(rest) {
  return runNodeScript(
    path.resolve(toolkitRoot, "runtime", "scripts", "ai-workflow", "kanban.mjs"),
    rest
  );
}

async function handleDogfood(rest) {
  return runNodeScript(
    path.resolve(toolkitRoot, "runtime", "scripts", "ai-workflow", "dogfood.mjs"),
    rest
  );
}

async function handleAsk(rest) {
  const args = parseArgs(rest);
  const text = String(args._.join(" ") ?? "").trim();
  if (!text) {
    printAndExit("Usage: ai-workflow ask [request...] [--mode <default|tool-dev>] [--root <path>] [--evidence-root <path>] [--json]", 1);
  }

  const context = await resolveOperatingContext({
    cwd: process.cwd(),
    mode: args.mode ? String(args.mode) : null,
    root: args.root ? String(args.root) : null,
    evidenceRoot: args["evidence-root"] ? String(args["evidence-root"]) : null,
    allowExternalTarget: true
  });
  const projectRoot = context.mode === "tool-dev" ? context.evidenceRoot : context.repairTargetRoot;
  const response = await resolveHostRequest({
    projectRoot,
    text,
    continuationState: null,
    host: {
      surface: "cli-host",
      capabilities: {
        supports_json: true,
        supports_streaming: false,
        supports_followups: true
      }
    }
  });

  const payload = {
    ...response,
    meta: {
      ...(response.meta ?? {}),
      mode: context.mode,
      repair_target_root: context.repairTargetRoot,
      evidence_root: context.evidenceRoot,
      operational_root: projectRoot
    }
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 0;
  }

  process.stdout.write(formatAskResponse(payload));
  return 0;
}

async function handleInfo(rest) {
  const name = rest[0];
  if (!name) {
    printAndExit("Usage: ai-workflow info <codelet>", 1);
  }

  const codelet = await withRefreshedCodeletRegistry(process.cwd(), async (store) => getCodeletFromStore(store, name));
  if (!codelet) {
    printAndExit(`Unknown codelet: ${name}`, 1);
  }

  process.stdout.write(`${JSON.stringify(codelet, null, 2)}\n`);
  return 0;
}

async function handleRun(rest) {
  const [name, ...args] = rest;
  if (!name) {
    printAndExit("Usage: ai-workflow run <codelet> [args]", 1);
  }

  const codelet = await withRefreshedCodeletRegistry(process.cwd(), async (store) => getCodeletFromStore(store, name));
  if (!codelet) {
    printAndExit(`Unknown codelet: ${name}`, 1);
  }

  if (codelet.runner === "builtin" && codelet.id === "doctor") {
    await runDoctor({ root: process.cwd(), json: args.includes("--json") });
    return 0;
  }

  return runCodelet(codelet, args);
}

async function handleAdd(rest, mode) {
  assertDirectCommandChannel(`ai-workflow ${mode}`);
  const [name, filePath] = rest;
  if (!name || !filePath) {
    printAndExit(`Usage: ai-workflow ${mode} <codelet> <file>`, 1);
  }

  const manifest = await upsertProjectCodelet(process.cwd(), name, filePath, mode);
  await refreshCodeletRegistryForProject(process.cwd());
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  return 0;
}

async function handleRemove(rest) {
  assertDirectCommandChannel("ai-workflow remove");
  const name = rest[0];
  if (!name) {
    printAndExit("Usage: ai-workflow remove <codelet>", 1);
  }

  await removeProjectCodelet(process.cwd(), name);
  await refreshCodeletRegistryForProject(process.cwd());
  process.stdout.write(`Removed project codelet manifest: ${name}\n`);
  return 0;
}

async function handleExtract(rest) {
  const [kind, ...args] = rest;

  if (kind === "ticket") {
    const ticketId = args[0];
    if (!ticketId) {
      printAndExit("Usage: ai-workflow extract ticket <id> [options]", 1);
    }
    const ticketCodelet = await getToolkitCodelet("ticket");
    return runNodeScript(ticketCodelet.entry, ["--id", ticketId, ...args.slice(1)]);
  }

  if (kind === "guidelines") {
    const guidelinesCodelet = await getToolkitCodelet("guidelines");
    return runNodeScript(guidelinesCodelet.entry, args);
  }

  printAndExit("Usage: ai-workflow extract <ticket|guidelines> ...", 1);
}

async function handleVerify(rest) {
  const [target, ...args] = rest;
  const verifyCodelet = await getToolkitCodelet("verify");
  const auditCodelet = await getToolkitCodelet("audit");

  if (!target) {
    return runNodeScript(verifyCodelet.entry, args);
  }

  if (target === "workflow") {
    return runNodeScript(auditCodelet.entry, args);
  }

  if (target === "guidelines") {
    return runNodeScript(path.resolve(toolkitRoot, "runtime", "scripts", "ai-workflow", "guideline-audit.mjs"), args);
  }

  return runNodeScript(verifyCodelet.entry, [target, ...args]);
}

async function handleForge(rest) {
  assertDirectCommandChannel("ai-workflow forge codelet");
  const [kind, name] = rest;
  if (kind !== "codelet" || !name) {
    printAndExit("Usage: ai-workflow forge codelet <name>", 1);
  }

  const forged = await forgeProjectCodelet(process.cwd(), name);
  await refreshCodeletRegistryForProject(process.cwd());
  process.stdout.write(`${JSON.stringify(forged, null, 2)}\n`);
  return 0;
}

async function handleProject(rest) {
  const [subcommand, ...extras] = rest;
  const args = parseArgs(extras);

  if (subcommand === "summary") {
    const summary = await getProjectSummary({ projectRoot: process.cwd() });
    if (args.json) {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      return 0;
    }
    process.stdout.write([
      `Files indexed: ${summary.fileCount}`,
      `Symbols indexed: ${summary.symbolCount}`,
      `Notes tracked: ${summary.noteCount}`,
      `Tickets: ${summary.activeTickets.length}`,
      `Codelets: ${summary.codeletCount ?? 0}`,
      `Candidates: ${summary.candidates.length}`
    ].join("\n") + "\n");
    return 0;
  }

  if (subcommand === "status") {
    const [action, ...statusExtras] = args._;
    if (action === "types") {
      if (args.json) {
        process.stdout.write(`${JSON.stringify(STATUS_NODE_TYPES, null, 2)}\n`);
      } else {
        process.stdout.write(`${STATUS_NODE_TYPES.join("\n")}\n`);
      }
      return 0;
    }

    const includeRelated = action === "related";
    const selectorParts = includeRelated ? statusExtras : args._;
    const selector = selectorParts.join(" ").trim() || (args.selector ? String(args.selector) : "");
    if (!selector) {
      printAndExit("Usage: ai-workflow project status <selector> [--type <type>] [--json]\n       ai-workflow project status related <selector> [--type <type>] [--json]\n       ai-workflow project status types", 1);
    }
    const report = await resolveProjectStatus({
      projectRoot: process.cwd(),
      selector,
      type: args.type ? String(args.type) : null,
      includeRelated: true,
      rawQuestion: false,
      relatedLimit: includeRelated ? 24 : 12
    });
    if (!report.ok) {
      printAndExit(report.error ?? `No status target matched ${selector}`, 1);
    }
    if (args.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return 0;
    }
    process.stdout.write(formatStatusReport(report));
    return 0;
  }

  if (subcommand === "readiness") {
    const goalType = String(args.goal ?? "beta_readiness");
    const question = String(args.question ?? args._.join(" ") ?? "").trim() || `Is this project ready for ${goalType.replace(/_/g, " ")}?`;
    const context = await resolveOperatingContext({
      cwd: process.cwd(),
      mode: args.mode ? String(args.mode) : null,
      root: args.root ? String(args.root) : null,
      evidenceRoot: args["evidence-root"] ? String(args["evidence-root"]) : null,
      allowExternalTarget: Boolean(args["allow-external-target"])
    });
    assertSafeRepairTarget(context, { action: "readiness evaluation" });
    const projectRoot = context.mode === "tool-dev" ? context.evidenceRoot : context.repairTargetRoot;
    const response = await evaluateProjectReadiness({
      projectRoot,
      request: {
        protocol_version: "1.0",
        operation: "evaluate_readiness",
        goal: {
          type: goalType,
          target: "project",
          question
        },
        constraints: {
          allow_mutation: false,
          context_budget: "medium",
          time_budget_ms: 15000,
          guideline_mode: "advisory"
        },
        inputs: {
          tickets_scope: "active_and_blocked",
          artifact_scope: "goal_relevant_only",
          verification_scope: "tests_metrics_docs"
        },
        host: {
          surface: context.mode === "tool-dev" ? "host" : "cli",
          capabilities: {
            supports_json: true,
            supports_streaming: false,
            supports_followups: true
          }
        },
        continuation_state: null
      }
    });
    if (args.json) {
      process.stdout.write(`${JSON.stringify({
        ...response,
        meta: {
          ...(response.meta ?? {}),
          mode: context.mode,
          repair_target_root: context.repairTargetRoot,
          evidence_root: context.evidenceRoot,
          operational_root: projectRoot
        }
      }, null, 2)}\n`);
      return 0;
    }
    process.stdout.write(formatReadinessResponse(response));
    return 0;
  }

  if (subcommand === "search") {
    const query = args._.join(" ");
    if (!query) {
      printAndExit("Usage: ai-workflow project search <text> [--json]", 1);
    }
    const results = await searchProject({ projectRoot: process.cwd(), query });
    if (args.json) {
      process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
      return 0;
    }
    process.stdout.write(`${results.map((item) => `- [${item.scope}] ${item.title}`).join("\n")}\n`);
    return 0;
  }

  if (subcommand === "epic") {
    const [action, ...epicExtras] = args._;
    const epicArgs = parseArgs(epicExtras);

    if (action === "list") {
      const epics = await listEpics({ projectRoot: process.cwd(), includeArchived: Boolean(epicArgs.archived) });
      if (args.json) {
        process.stdout.write(`${JSON.stringify(epics, null, 2)}\n`);
        return 0;
      }
      process.stdout.write(`${epics.map((epic) => `- ${epic.id} ${epic.title} [${epic.state}] (${epic.userStoryCount} stories)`).join("\n")}\n`);
      return 0;
    }

    if (action === "show") {
      const epicId = epicExtras[0] ?? epicArgs.id;
      if (!epicId) {
        printAndExit("Usage: ai-workflow project epic show <epic-id> [--json]", 1);
      }
      const epic = await getEpic({ projectRoot: process.cwd(), epicId: String(epicId) });
      if (!epic) {
        printAndExit(`Unknown epic: ${epicId}`, 1);
      }
      if (args.json) {
        process.stdout.write(`${JSON.stringify(epic, null, 2)}\n`);
        return 0;
      }
      process.stdout.write(formatEpicOutput(epic));
      return 0;
    }

    if (action === "search") {
      const query = epicExtras.join(" ") || String(epicArgs.query ?? "").trim();
      if (!query) {
        printAndExit("Usage: ai-workflow project epic search <text> [--json]", 1);
      }
      const matches = await searchEpics({ projectRoot: process.cwd(), query });
      if (args.json) {
        process.stdout.write(`${JSON.stringify(matches, null, 2)}\n`);
        return 0;
      }
      process.stdout.write(`${matches.map((epic) => `- ${epic.id} ${epic.title} [score ${epic.score}]`).join("\n")}\n`);
      return 0;
    }

    printAndExit("Usage: ai-workflow project epic <list|show|search> ...", 1);
  }

  if (subcommand === "story") {
    const [action, ...storyExtras] = args._;
    const storyArgs = parseArgs(storyExtras);

    if (action === "list") {
      const epicId = storyArgs.epic ? String(storyArgs.epic) : null;
      const stories = await listEpicUserStories({ projectRoot: process.cwd(), epicId });
      if (args.json) {
        process.stdout.write(`${JSON.stringify(stories, null, 2)}\n`);
        return 0;
      }
      process.stdout.write(`${stories.map((story) => `- ${story.epic.id} ${story.heading}\n  ${story.body}`).join("\n")}\n`);
      return 0;
    }

    if (action === "search") {
      const query = storyExtras.join(" ") || String(storyArgs.query ?? "").trim();
      if (!query) {
        printAndExit("Usage: ai-workflow project story search <text> [--epic <epic-id>] [--json]", 1);
      }
      const matches = await searchEpicUserStories({
        projectRoot: process.cwd(),
        query,
        epicId: storyArgs.epic ? String(storyArgs.epic) : null
      });
      if (args.json) {
        process.stdout.write(`${JSON.stringify(matches, null, 2)}\n`);
        return 0;
      }
      process.stdout.write(`${matches.map((story) => `- ${story.epic.id} ${story.heading}\n  ${story.body}`).join("\n")}\n`);
      return 0;
    }

    printAndExit("Usage: ai-workflow project story <list|search> ...", 1);
  }

  if (subcommand === "codelet") {
    return handleProjectCodelet(args);
  }

  if (subcommand === "ticket" && args._[0] === "create") {
    assertDirectCommandChannel("ai-workflow project ticket create");
    return withWorkspaceMutation(process.cwd(), "project ticket create", async () => {
      const id = args.id;
      const title = args.title;
      if (!id || !title) {
        printAndExit("Usage: ai-workflow project ticket create --id <id> --title <title> [--lane <lane>] [--epic <epic-id>] [--summary <text>] [--json]", 1);
      }

      const ticket = buildTicketEntity({
        id,
        title,
        lane: inferTicketLane({ id, title, lane: args.lane ? String(args.lane) : null }),
        epicId: args.epic ? String(args.epic) : null,
        summary: args.summary ? String(args.summary) : ""
      });
      await withWorkflowStore(process.cwd(), async (store) => {
        if (args.epic) {
          const epicId = String(args.epic);
          const existingEpic = store.getEntity(epicId);
          if (!existingEpic) {
            store.upsertEntity({
              id: epicId,
              entityType: "epic",
              title: epicId,
              lane: null,
              state: "open",
              confidence: 1,
              provenance: "manual",
              sourceKind: "manual",
              reviewState: "active",
              data: {}
            });
          }
        }
        store.upsertEntity(ticket);
        store.db.prepare(`
          INSERT INTO search_index (id, scope, ref_id, title, body, tags, updated_at)
          VALUES (?, 'entity', ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            body = excluded.body,
            tags = excluded.tags,
            updated_at = excluded.updated_at
        `).run(`entity:${ticket.id}`, ticket.id, ticket.title, JSON.stringify(ticket.data), `ticket,${ticket.lane}`, new Date().toISOString());
        await writeProjectProjections(store, { projectRoot: process.cwd() });
      });
      if (args.json) {
        process.stdout.write(`${JSON.stringify(ticket, null, 2)}\n`);
        return 0;
      }
      process.stdout.write(`${ticket.id} ${ticket.title} [${ticket.lane}]\n`);
      return 0;
    });
  }

  if (subcommand === "ticket" && (args._[0] === "resolve" || args._[0] === "close")) {
    const action = args._[0];
    assertDirectCommandChannel(`ai-workflow project ticket ${action}`);
    return withWorkspaceMutation(process.cwd(), `project ticket ${action}`, async () => {
      const ticketId = String(args._[1] ?? args.id ?? "").trim();
      if (!ticketId) {
        printAndExit(`Usage: ai-workflow project ticket ${action} <ticket-id> [--json]`, 1);
      }
      const ticket = await updateTicketLifecycle({
        projectRoot: process.cwd(),
        ticketId,
        action: "resolve"
      });
      if (args.json) {
        process.stdout.write(`${JSON.stringify(ticket, null, 2)}\n`);
        return 0;
      }
      process.stdout.write(`${ticket.id} ${action}d -> ${ticket.lane} (${ticket.state})\n`);
      return 0;
    });
  }

  if (subcommand === "ticket" && args._[0] === "start") {
    assertDirectCommandChannel("ai-workflow project ticket start");
    return withWorkspaceMutation(process.cwd(), "project ticket start", async () => {
      const ticketId = String(args._[1] ?? args.id ?? "").trim();
      if (!ticketId) {
        printAndExit("Usage: ai-workflow project ticket start <ticket-id> [--json]", 1);
      }
      const ticket = await updateTicketLifecycle({
        projectRoot: process.cwd(),
        ticketId,
        action: "move",
        lane: "In Progress"
      });
      if (args.json) {
        process.stdout.write(`${JSON.stringify(ticket, null, 2)}\n`);
        return 0;
      }
      process.stdout.write(`${ticket.id} started -> ${ticket.lane} (${ticket.state})\n`);
      return 0;
    });
  }

  if (subcommand === "ticket" && args._[0] === "reopen") {
    assertDirectCommandChannel("ai-workflow project ticket reopen");
    return withWorkspaceMutation(process.cwd(), "project ticket reopen", async () => {
      const ticketId = String(args._[1] ?? args.id ?? "").trim();
      if (!ticketId) {
        printAndExit("Usage: ai-workflow project ticket reopen <ticket-id> [--lane <lane>] [--json]", 1);
      }
      const ticket = await updateTicketLifecycle({
        projectRoot: process.cwd(),
        ticketId,
        action: "reopen",
        lane: args.lane ? String(args.lane) : null
      });
      if (args.json) {
        process.stdout.write(`${JSON.stringify(ticket, null, 2)}\n`);
        return 0;
      }
      process.stdout.write(`${ticket.id} reopened -> ${ticket.lane} (${ticket.state})\n`);
      return 0;
    });
  }

  if (subcommand === "note" && args._[0] === "add") {
    assertDirectCommandChannel("ai-workflow project note add");
    return withWorkspaceMutation(process.cwd(), "project note add", async () => {
      if (!args.type || !args.body) {
        printAndExit("Usage: ai-workflow project note add --type <NOTE|TODO|FIXME|HACK|BUG|RISK> --body <text> [--file <path>] [--line <n>] [--symbol <name>] [--json]", 1);
      }
      const note = await addManualNote({
        projectRoot: process.cwd(),
        note: {
          noteType: String(args.type).toUpperCase(),
          body: String(args.body),
          filePath: args.file ? String(args.file) : null,
          line: args.line ? Number(args.line) : null,
          symbolName: args.symbol ? String(args.symbol) : null
        }
      });
      if (args.json) {
        process.stdout.write(`${JSON.stringify(note, null, 2)}\n`);
        return 0;
      }
      process.stdout.write(`${note.noteType} ${note.body}\n`);
      return 0;
    });
  }

  if (subcommand === "review-candidates") {
    const result = await reviewProjectCandidates({ projectRoot: process.cwd() });
    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    }
    process.stdout.write(`${result.reviewed.length} candidates reviewed\n`);
    return 0;
  }

  if (subcommand === "render") {
    const target = args._[0];
    if (!target || !["kanban", "epics"].includes(target)) {
      printAndExit("Usage: ai-workflow project render <kanban|epics>", 1);
    }
    const output = await withWorkflowStore(process.cwd(), async (store) => target === "kanban"
      ? renderKanbanProjection(store)
      : renderEpicsProjection(store));
    process.stdout.write(output);
    return 0;
  }

  if (subcommand === "import-projections") {
    assertDirectCommandChannel("ai-workflow project import-projections");
    return withWorkspaceMutation(process.cwd(), "project import-projections", async () => {
      const result = await withWorkflowStore(process.cwd(), async (store) => importLegacyProjections(store, { projectRoot: process.cwd() }));
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    });
  }

  printAndExit("Usage: ai-workflow project <summary|status|readiness|search|epic|story|codelet|ticket|note|review-candidates|render|import-projections> ...", 1);
}

async function handleProjectCodelet(args) {
  const [action, ...extras] = args._;

  if (action === "list") {
    const sourceKind = args.source ? String(args.source) : null;
    const codelets = await withRefreshedCodeletRegistry(process.cwd(), async (store) => listCodeletsFromStore(store, { sourceKind }));
    if (args.json) {
      process.stdout.write(`${JSON.stringify(codelets, null, 2)}\n`);
      return 0;
    }
    process.stdout.write(`${codelets.map((codelet) => `- ${codelet.id} [${codelet.sourceKind}] ${codelet.summary}`).join("\n")}\n`);
    return 0;
  }

  if (action === "show") {
    const codeletId = extras[0] ?? args.id;
    if (!codeletId) {
      printAndExit("Usage: ai-workflow project codelet show <codelet-id> [--json]", 1);
    }
    const codelet = await withRefreshedCodeletRegistry(process.cwd(), async (store) => getCodeletFromStore(store, String(codeletId)));
    if (!codelet) {
      printAndExit(`Unknown codelet: ${codeletId}`, 1);
    }
    if (args.json) {
      process.stdout.write(`${JSON.stringify(codelet, null, 2)}\n`);
      return 0;
    }
    process.stdout.write(formatCodeletOutput(codelet));
    return 0;
  }

  if (action === "search") {
    const query = extras.join(" ") || String(args.query ?? "").trim();
    if (!query) {
      printAndExit("Usage: ai-workflow project codelet search <text> [--source <toolkit|project>] [--json]", 1);
    }
    const sourceKind = args.source ? String(args.source) : null;
    const matches = await withRefreshedCodeletRegistry(process.cwd(), async (store) => searchCodeletsFromStore(store, query, { sourceKind }));
    if (args.json) {
      process.stdout.write(`${JSON.stringify(matches, null, 2)}\n`);
      return 0;
    }
    process.stdout.write(`${matches.map((codelet) => `- ${codelet.id} [${codelet.sourceKind}] ${codelet.summary} (score ${codelet.score})`).join("\n")}\n`);
    return 0;
  }

  printAndExit("Usage: ai-workflow project codelet <list|show|search> ...", 1);
}

async function handleRoute(rest) {
  const [taskClass, ...extras] = rest;
  if (!taskClass) {
    printAndExit("Usage: ai-workflow route <task-class> [--json]", 1);
  }
  const args = parseArgs(extras);
  const route = await routeTask({
    root: process.cwd(),
    taskClass,
    preferLocal: args["prefer-local"] === undefined
      ? undefined
      : args["prefer-local"] !== false && args["prefer-local"] !== "false"
  });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(route, null, 2)}\n`);
    return 0;
  }
  if (!route.recommended) {
    process.stdout.write(`No route available for ${taskClass}\n`);
    return 0;
  }
  process.stdout.write(`${route.recommended.providerId}:${route.recommended.modelId}\n${route.recommended.reason}\n`);
  return 0;
}

async function handleTelegram(rest) {
  const [subcommand, ...extras] = rest;
  const args = parseArgs(extras);
  if (subcommand !== "preview") {
    printAndExit("Usage: ai-workflow telegram preview [--json]", 1);
  }
  const preview = await buildTelegramPreview({ projectRoot: process.cwd() });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
    return 0;
  }
  process.stdout.write(preview.text);
  return 0;
}

async function handleProvider(rest) {
  const [subcommand, providerId, ...extras] = rest;
  if (subcommand === "setup") {
    assertDirectCommandChannel("ai-workflow provider setup");
    return withWorkspaceMutation(process.cwd(), "provider setup", async () => {
      const args = parseArgs(rest.slice(1));
      const scope = args.project ? "project" : "global";
      const result = await runProviderSetupWizard({
        root: process.cwd(),
        scope,
        interactive: process.stdin.isTTY && process.stdout.isTTY
      });

      if (args.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return 0;
      }

      for (const message of result.messages ?? []) {
        process.stdout.write(`${message}\n`);
      }
      if (result.connectedProviders?.length) {
        process.stdout.write(`Connected providers: ${result.connectedProviders.join(", ")}\n`);
      }
      if (result.registeredEndpoints?.length) {
        process.stdout.write(`Registered Ollama endpoints: ${result.registeredEndpoints.join(", ")}\n`);
      }
      return 0;
    });
  }
  if (subcommand === "refresh") {
    assertDirectCommandChannel("ai-workflow provider refresh");
    return withWorkspaceMutation(process.cwd(), "provider refresh", async () => {
      const target = providerId ?? "models";
      const args = parseArgs(extras);
      if (target === "models" || target === "all") {
        await invalidateModelFitCache(process.cwd());
        await invalidateWebSearchCache(process.cwd());
        const registry = await refreshProviderRegistry({
          root: process.cwd(),
          scope: args.global ? "global" : "project",
          forceRefresh: true
        });
        const discovery = registry.providerState ?? await discoverProviderState({ root: process.cwd(), forceRefresh: true });
        const result = {
          discovery,
          registry,
          refreshed: discovery.providers?.ollama?.models?.length ?? 0
        };
        if (args.json) {
          process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
          return 0;
        }
        process.stdout.write(`Refreshed provider state and model matrix for ${result.refreshed} Ollama models.\n`);
        return 0;
      }
      return 0;
    });
  }
  if (subcommand === "connect") {
    assertDirectCommandChannel("ai-workflow provider connect");
    return withWorkspaceMutation(process.cwd(), "provider connect", async () => {
      const args = parseArgs(extras);
      if (String(providerId ?? "").toLowerCase() === "ollama") {
        const result = await runProviderSetupWizard({
          root: process.cwd(),
          scope: args.global ? "global" : "project",
          interactive: process.stdin.isTTY && process.stdout.isTTY,
          promptRemoteProviders: false
        });
        if (!args.json) {
          process.stdout.write(`${(result.messages ?? []).join("\n")}\n`);
        } else {
          process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        }
        return 0;
      }
      return handleProviderConnect(providerId);
    });
  }
  if (subcommand === "quota") {
    const [action, target] = [providerId, extras[0]];
    const args = parseArgs(extras.slice(1));
    if (action === "refresh") {
      assertDirectCommandChannel("ai-workflow provider quota refresh");
      return withWorkspaceMutation(process.cwd(), "provider quota refresh", async () => {
        const result = await refreshProviderQuotaState({
          root: process.cwd(),
          providerId: target ?? "all",
          scope: args.global ? "global" : "project"
        });
        if (args.json) {
          process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
          return 0;
        }
        for (const item of result.refreshed) {
          process.stdout.write(`${item.providerId}: ${item.changed ? "refreshed" : "unchanged"}\n`);
        }
        return 0;
      });
    }
  }
  printAndExit("Usage: ai-workflow provider connect <provider-id>\n       ai-workflow provider setup [--global]\n       ai-workflow provider refresh [models|all] [--global] [--json]\n       ai-workflow provider quota refresh [provider-id|all] [--global] [--json]", 1);
}

async function handleMode(rest) {
  const [action, ...tail] = rest;
  const args = parseArgs(tail);
  const value = args._[0];
  const scope = args.global ? "global" : "project";
  const configPath = scope === "global" ? getGlobalConfigPath() : getProjectConfigPath(process.cwd());

  if (action === "set") {
    assertDirectCommandChannel("ai-workflow mode set");
    return withWorkspaceMutation(process.cwd(), "mode set", async () => {
      const normalized = normalizeModeValue(value);
      if (!normalized) {
        printAndExit("Usage: ai-workflow mode set <default|tool-dev> [--global]", 1);
      }
      const config = await writeConfigValue(configPath, "mode", normalized);
      process.stdout.write(`${JSON.stringify({ path: configPath, mode: getConfigValue(config, "mode") }, null, 2)}\n`);
      return 0;
    });
  }

  if (action === "status") {
    const context = await resolveOperatingContext({ cwd: process.cwd() });
    const payload = {
      mode: context.mode,
      toolkitRoot: context.toolkitRoot,
      repairTargetRoot: context.repairTargetRoot,
      evidenceRoot: context.evidenceRoot,
      externalTarget: context.externalTarget,
      projectConfigPath: context.projectConfigPath,
      globalConfigPath: context.globalConfigPath
    };
    if (args.json) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      return 0;
    }
    process.stdout.write([
      `Mode: ${payload.mode}`,
      `Toolkit root: ${payload.toolkitRoot}`,
      `Repair target: ${payload.repairTargetRoot}`,
      `Evidence root: ${payload.evidenceRoot}`
    ].join("\n") + "\n");
    return 0;
  }

  printAndExit("Usage: ai-workflow mode set <default|tool-dev> [--global]\n       ai-workflow mode status [--json]", 1);
}

async function handleKnowledge(rest) {
  const [action, ...tail] = rest;
  const args = parseArgs(tail);

  if (action === "update-remote") {
    assertDirectCommandChannel("ai-workflow knowledge update-remote");
    return withWorkspaceMutation(process.cwd(), "knowledge update-remote", async () => {
      const result = await updateKnowledgeRemote({
        root: process.cwd(),
        sourceUrl: args.url ? String(args.url) : null
      });
      if (args.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return 0;
      }
      if (result.success) {
        process.stdout.write(`Refreshed builtin knowledge from ${result.sourceUrl}\n`);
        return 0;
      }
      if (result.skipped) {
        process.stdout.write(`${result.reason}\n${result.hint ?? ""}\n`.trimEnd() + "\n");
        return 0;
      }
      printAndExit(result.reason ?? "Failed to refresh builtin knowledge.", 1);
    });
  }

  printAndExit("Usage: ai-workflow knowledge update-remote [--url <remote-url>] [--json]", 1);
}

async function handleTool(rest) {
  const [action, ...extras] = rest;
  if (action === "observe") {
    return handleToolObserve(extras);
  }
  if (action === "refine") {
    return handleToolRefine(extras);
  }
  if (action === "benchmark") {
    return handleToolBenchmark(extras);
  }
  printAndExit("Usage: ai-workflow tool observe [--complaint <text>] [--json]\n       ai-workflow tool refine [issue-id] [--json]\n       ai-workflow tool benchmark <prompt> [--json]", 1);
}

async function handleToolBenchmark(rest) {
  const args = parseArgs(rest);
  const prompt = args._.join(" ");
  if (!prompt) {
    printAndExit("Usage: ai-workflow tool benchmark <prompt> [--json]", 1);
  }

  const result = await runShellBenchmark(prompt, { root: process.cwd() });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    if (!result.ok) {
      process.stdout.write(`Benchmark failed: ${result.error}\n`);
      return 1;
    }
    process.stdout.write(`${result.summary}\n`);
    for (const run of result.runs) {
      process.stdout.write(`- Tier: ${run.tier} | Model: ${run.model} | Latency: ${run.latency}ms | Code: ${run.hasCode ? "YES" : "NO"}\n`);
    }
  }
  return 0;
}

async function handleToolRefine(rest) {
  const [issueId] = rest;
  const args = parseArgs(rest);
  const root = process.cwd();

  return withWorkflowStore(root, async (store) => {
    if (issueId) {
      const result = await refineWorkflowIssue(issueId, { workflowStore: store });
      if (args.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        process.stdout.write(`${result.message}\n`);
      }
      return 0;
    }

    const issues = await listWorkflowIssues(store);
    if (args.json) {
      process.stdout.write(`${JSON.stringify(issues, null, 2)}\n`);
    } else {
      if (!issues.length) {
        process.stdout.write("No open workflow issues.\n");
      } else {
        process.stdout.write("Workflow Issues:\n");
        for (const issue of issues) {
          process.stdout.write(`- [${issue.id}] [${issue.issueType}] ${issue.summary} (${issue.status})\n`);
        }
      }
    }
    return 0;
  });
}

async function handleWeb(rest) {
  const [action, ...extras] = rest;
  if (action === "tutorial") {
    return runNodeScriptLive(
      path.resolve(toolkitRoot, "runtime", "scripts", "ai-workflow", "tutorial-web.mjs"),
      extras
    );
  }
  printAndExit("Usage: ai-workflow web tutorial [--port <n>] [--host <host>] [--json]", 1);
}

async function handleConfig(rest) {
  const [action, key, value, ...extras] = rest;
  const args = parseArgs(extras);
  const scope = args.global ? "global" : "project";
  const configPath = scope === "global" ? getGlobalConfigPath() : getProjectConfigPath(process.cwd());

  if (action === "get") {
    const config = await readConfig(configPath);
    const resolved = getConfigValue(config, key);
    if (resolved === undefined) {
      process.stdout.write("undefined\n");
    } else if (typeof resolved === "string") {
      process.stdout.write(`${resolved}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(resolved, null, 2)}\n`);
    }
    return 0;
  }

  if (action === "set") {
    assertDirectCommandChannel("ai-workflow config set");
    return withWorkspaceMutation(process.cwd(), "config set", async () => {
      if (!key || value === undefined) {
        printAndExit("Usage: ai-workflow config set <key> <value> [--global]", 1);
      }
      const config = await writeConfigValue(configPath, key, value);
      process.stdout.write(`${JSON.stringify({ path: configPath, value: getConfigValue(config, key) }, null, 2)}\n`);
      return 0;
    });
  }

  if (action === "unset") {
    assertDirectCommandChannel("ai-workflow config unset");
    return withWorkspaceMutation(process.cwd(), "config unset", async () => {
      if (!key) {
        printAndExit("Usage: ai-workflow config unset <key> [--global]", 1);
      }
      await removeConfigValue(configPath, key);
      process.stdout.write(`${JSON.stringify({ path: configPath, removed: key }, null, 2)}\n`);
      return 0;
    });
  }

  if (action === "clear") {
    assertDirectCommandChannel("ai-workflow config clear");
    return withWorkspaceMutation(process.cwd(), "config clear", async () => {
      await removeConfigFile(configPath);
      process.stdout.write(`${JSON.stringify({ path: configPath, cleared: true }, null, 2)}\n`);
      return 0;
    });
  }

  printAndExit("Usage: ai-workflow config <get|set|unset|clear> ...", 1);
}

async function handleInstall(rest) {
  assertDirectCommandChannel("ai-workflow install");
  const args = parseArgs(rest);
  const projectRoot = path.resolve(String(args.project ?? process.cwd()));
  return withWorkspaceMutation(projectRoot, "install", async () => {
    await installAgents({
      toolkitRoot,
      projectRoot
    });
    process.stdout.write(`Installation complete in ${projectRoot}\n`);
    return 0;
  });
}

async function handleAudit(rest) {
  const args = parseArgs(rest);
  const root = process.cwd();
  const sub = args._[0];

  if (sub === "architecture") {
    const findings = await auditArchitecture(root);
    if (args.json) {
      output.write(`${JSON.stringify(findings, null, 2)}\n`);
      return 0;
    }

    if (!findings.length) {
      output.write("No architectural violations detected. Wiring looks clean!\n");
      return 0;
    }

    output.write("Architectural Audit Report:\n");
    for (const f of findings) {
      output.write(`- [${f.severity.toUpperCase()}] ${f.type}: ${f.summary} (Subject: ${f.subject})\n`);
    }
    return 0;
  }

  printAndExit("Usage: ai-workflow audit architecture [--json]");
}

async function handleSetProviderKey(rest) {
  assertDirectCommandChannel("ai-workflow set-provider-key");
  return withWorkspaceMutation(process.cwd(), "set-provider-key", async () => {
    const [providerId] = rest;
    if (!providerId) {
      printAndExit("Usage: ai-workflow set-provider-key <provider-id> [--global]", 1);
    }
    const args = parseArgs(rest);
    const scope = args.global ? "global" : "project";
    const configPath = scope === "global" ? getGlobalConfigPath() : getProjectConfigPath(process.cwd());

    const rl = readline.createInterface({ input, output });
    const prompt = providerId === "google"
      ? `Enter Gemini API key (from https://aistudio.google.com/): `
      : `Enter ${providerId} API key: `;

    if (providerId === "google") {
      process.stdout.write("Pro-tip: You can get a free Gemini API key at https://aistudio.google.com/\n");
    }

    const key = (await rl.question(prompt) ?? "").trim();
    rl.close();

    if (!key) {
      printAndExit("API key is required.", 1);
    }

    await writeConfigValue(configPath, `providers.${providerId}.apiKey`, key);
    process.stdout.write(`Successfully saved API key for ${providerId} to ${scope} config.\n`);
    return 0;
  });
}

async function handleMetrics(rest) {
  const args = parseArgs(rest);
  const metrics = await getProjectMetrics({ projectRoot: process.cwd() });
  
  if (args.json) {
    process.stdout.write(`${JSON.stringify(metrics, null, 2)}\n`);
    return 0;
  }

  process.stdout.write(renderMetricsSummary(metrics));
  return 0;
}

function renderMetricsSummary(metrics) {
  const lines = [
    `All time: ${metrics.totalCalls} calls, ${metrics.successRate}% success, ${metrics.avgLatencyMs}ms avg latency`,
    `Assumptions: ${metrics.assumptions?.helpVsBaseline ?? "heuristic estimate"}`,
    `Quality basis: ${metrics.assumptions?.qualityBasis ?? "all traffic"}`,
    `Tokens: ${metrics.assumptions?.tokens ?? "actual usage only"}`
  ];

  for (const key of ["latestSession", "last4WorkHours", "trailingWeek"]) {
    const window = metrics.windows?.[key];
    if (!window) {
      continue;
    }
    lines.push("");
    lines.push(window.label);
    lines.push(`- Calls: ${window.calls}`);
    lines.push(`- Cost: estimated ${window.cost.estimatedManualMinutes}m manual vs ${window.cost.estimatedToolMinutes}m tool time, ${window.cost.estimatedMinutesSaved}m saved`);
    lines.push(`- Quality: ${window.quality.qualityScore}/100 based on ${window.quality.basisLabel} (${window.quality.successRate}% success, ${window.quality.fastEnoughRate}% fast-enough)`);
    lines.push(`- Mix: ${window.localCalls} local / ${window.remoteCalls} remote, ${window.realTraffic.calls} real / ${window.mockTraffic.calls} mock calls`);
    lines.push(`- Tokens: ${window.totalTokens} total (${window.realTraffic.totalTokens} real / ${window.mockTraffic.totalTokens} mock)`);
    if (window.byModel?.length) {
      lines.push(`- Top model: ${window.byModel[0].model_id} (${window.byModel[0].count} calls, ${window.byModel[0].success_rate}% success)`);
    }
    for (const alert of window.alerts ?? []) {
      lines.push(`- Alert: ${alert}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

async function handleIngest(rest) {
  return handleOnboard(rest);
}

async function handleOnboard(rest) {
  assertDirectCommandChannel("ai-workflow onboard");
  return withWorkspaceMutation(process.cwd(), "onboard", async () => {
    const [filePath] = rest;
    if (!filePath || filePath === "--help" || filePath === "-h") {
      printAndExit("Usage: ai-workflow onboard <brief-file> [--json]", 1);
    }
    const args = parseArgs(rest);
    const rl = readline.createInterface({ input, output });

    try {
      const targetPath = path.resolve(process.cwd(), filePath);
      const result = await onboardProjectBrief(targetPath, { root: process.cwd(), rl });
      if (args.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        process.stdout.write(`\nOnboarding complete. Generated Epic: ${result.epic.id} with ${result.tickets.length} tickets.\n`);
      }
    } catch (error) {
      printAndExit(`Onboarding failed: ${error.message}`, 1);
    } finally {
      rl.close();
    }
    return 0;
  });
}

async function handleConsult(rest) {
  assertDirectCommandChannel("ai-workflow consult");
  const root = process.cwd();
  const rl = readline.createInterface({ input, output });

  try {
    const pending = await withWorkspaceMutation(root, "consult", async () => withWorkflowStore(root, async (store) => {
      return store.db.prepare("SELECT * FROM entities WHERE consultation_question IS NOT NULL").all();
    }));

    if (!pending.length) {
      process.stdout.write("No active consultation requests.\n");
      return 0;
    }

    process.stdout.write(`Found ${pending.length} pending consultation(s).\n\n`);

    for (const row of pending) {
      process.stdout.write(`[${row.id}] ${row.title}\n`);
      process.stdout.write(`Question: ${row.consultation_question}\n`);
      const answer = (await rl.question("Your Answer (leave blank to skip): ")).trim();
      
      if (answer) {
        await withWorkspaceMutation(root, "consult answer", async () => withWorkflowStore(root, async (store) => {
          const entity = store.getEntity(row.id);
          entity.consultationQuestion = null;
          entity.data.consultationResponse = answer;
          entity.lane = "Todo"; // Move back to Todo
          store.upsertEntity(entity);
        }));
        process.stdout.write("Answer recorded. Ticket moved back to Todo.\n\n");
      } else {
        process.stdout.write("Skipped.\n\n");
      }
    }
  } finally {
    rl.close();
  }
  return 0;
}

function runNodeScript(scriptPath, args, options = {}) {
  return mkdtemp(path.join(os.tmpdir(), "ai-workflow-cli-")).then(async (captureDir) => {
    const stdoutPath = path.join(captureDir, "stdout.log");
    const stderrPath = path.join(captureDir, "stderr.log");
    const command = `${shellQuote(process.execPath)} ${[scriptPath, ...args].map(shellQuote).join(" ")} > ${shellQuote(stdoutPath)} 2> ${shellQuote(stderrPath)}`;

    try {
      await execFileAsync("/usr/bin/bash", ["-lc", command], {
        cwd: process.cwd(),
        maxBuffer: 16 * 1024 * 1024,
        env: options.env ? { ...process.env, ...options.env } : process.env
      });
      const stdout = await readFile(stdoutPath, "utf8").catch(() => "");
      const stderr = await readFile(stderrPath, "utf8").catch(() => "");
      if (stdout) {
        process.stdout.write(stdout);
      }
      if (stderr) {
        process.stderr.write(stderr);
      }
      return 0;
    } catch (error) {
      const stdout = await readFile(stdoutPath, "utf8").catch(() => error.stdout ?? "");
      const stderr = await readFile(stderrPath, "utf8").catch(() => error.stderr ?? "");
      if (stdout) {
        process.stdout.write(stdout);
      }
      if (stderr) {
        process.stderr.write(stderr);
      } else if (error.message) {
        process.stderr.write(`${error.message}\n`);
      }
      return error.code ?? 1;
    } finally {
      await rm(captureDir, { recursive: true, force: true });
    }
  });
}

function shellQuote(value) {
  return JSON.stringify(String(value));
}

function runCodelet(codelet, args) {
  return executeCodelet(codelet, args, {
    cwd: process.cwd(),
    mode: "stream",
    env: {
      ...process.env,
      AIWF_CODELET_ID: codelet.id,
      AIWF_CODELET_FOCUS: codelet.focus ? String(codelet.focus) : "",
      AIWF_CODELET_SUMMARY: codelet.summary ? String(codelet.summary) : ""
    }
  });
}

async function refreshCodeletRegistryForProject(projectRoot) {
  await withWorkflowStore(projectRoot, async (store) => refreshCodeletRegistry(store, { projectRoot }));
}

async function withRefreshedCodeletRegistry(projectRoot, callback) {
  return withWorkflowStore(projectRoot, async (store) => {
    await refreshCodeletRegistry(store, { projectRoot });
    return callback(store);
  });
}

function formatCodeletOutput(codelet) {
  const lines = [
    `ID: ${codelet.id}`,
    `Source: ${codelet.sourceKind}`,
    `Summary: ${codelet.summary}`,
    `Category: ${codelet.category ?? "n/a"}`,
    `Stability: ${codelet.stability ?? "n/a"}`,
    `Runner: ${codelet.runner}`,
    `Backing: ${codelet.backing?.status ?? "unknown"}`
  ];
  if (codelet.entryPath) {
    lines.push(`Entry: ${codelet.entryPath}`);
  }
  if (codelet.manifestPath) {
    lines.push(`Manifest: ${codelet.manifestPath}`);
  }
  if (Array.isArray(codelet.variants) && codelet.variants.length > 1) {
    lines.push("Variants:");
    for (const variant of codelet.variants) {
      lines.push(`- ${variant.variantId} [${variant.sourceKind}] ${variant.summary}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function runNodeScriptLive(scriptPath, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: process.cwd(),
      stdio: "inherit"
    });
    const forwardSignal = (signal) => {
      if (!child.killed) {
        child.kill(signal);
      }
    };
    const handleSigint = () => forwardSignal("SIGINT");
    const handleSigterm = () => forwardSignal("SIGTERM");
    const cleanup = () => {
      process.off("SIGINT", handleSigint);
      process.off("SIGTERM", handleSigterm);
    };
    process.on("SIGINT", handleSigint);
    process.on("SIGTERM", handleSigterm);
    child.on("exit", (code) => {
      cleanup();
      resolve(code ?? 0);
    });
    child.on("error", (error) => {
      cleanup();
      process.stderr.write(`${error.message}\n`);
      resolve(1);
    });
  });
}

async function handleToolObserve(rest) {
  assertDirectCommandChannel("ai-workflow tool observe");
  const args = parseArgs(rest);
  const context = await resolveOperatingContext({
    cwd: process.cwd(),
    mode: args.mode ? String(args.mode) : "tool-dev",
    root: args.root ? String(args.root) : getOperatingToolkitRoot(),
    evidenceRoot: args["evidence-root"] ? String(args["evidence-root"]) : null,
    allowExternalTarget: Boolean(args["allow-external-target"])
  });
  assertSafeRepairTarget(context, { action: "tool observation" });

  const initialComplaint = String(args.complaint ?? args._.join(" ") ?? "").trim();
  const inferred = inferObservationFromComplaint(initialComplaint);
  const rl = readline.createInterface({ input, output });
  const interactive = process.stdin.isTTY && !args.json;
  const latestRun = await readLatestRunArtifact(context.repairTargetRoot);

  try {
    const complaint = initialComplaint || (interactive ? await askText(rl, "What did it do wrong? ") : "");
    if (!complaint) {
      printAndExit("tool observe requires --complaint in non-interactive mode", 1);
    }
    const complaintInferred = inferObservationFromComplaint(complaint);
    const merged = {
      complaint,
      kind: String(args.kind ?? complaintInferred.kind ?? inferred.kind ?? "").trim(),
      severity: String(args.severity ?? complaintInferred.severity ?? inferred.severity ?? "").trim(),
      component: String(args.component ?? complaintInferred.component ?? inferred.component ?? "").trim(),
      expected: String(args.expected ?? "").trim(),
      relatedTicketId: String(args.ticket ?? "").trim(),
      relatedCommand: String(args.command ?? "").trim(),
      evidenceRoot: context.evidenceRoot
    };

    if (!merged.kind) {
      merged.kind = interactive ? await askChoice(rl, "What kind of bad behavior was it?", [
        ["wrong-target", "wrong target / wrong repo"],
        ["wrong-context", "wrong context / wrong files"],
        ["bad-verification", "bad verification / wrong checks"],
        ["misleading-output", "misleading output"],
        ["unsafe-execution", "unsafe execution"],
        ["missing-feature", "missing logic / mini-feature"],
        ["other", "other"]
      ], "other") : "other";
    }

    if (!merged.severity) {
      merged.severity = interactive ? await askChoice(rl, "How severe is it?", [
        ["annoying", "annoying but tolerable"],
        ["blocking", "blocking usefulness"],
        ["unsafe", "unsafe / high risk"]
      ], "blocking") : "blocking";
    }

    if (!merged.component) {
      merged.component = interactive ? await askChoice(rl, "Which toolkit area is closest?", [
        ["search", "search / retrieval"],
        ["context", "context / working set"],
        ["verification", "verification / checks"],
        ["execution", "execution / patching"],
        ["shell", "shell / CLI UX"],
        ["routing", "provider routing / models"],
        ["other", "other / unknown"]
      ], "other") : "other";
    }

    if (!merged.expected) {
      merged.expected = interactive ? await askText(rl, "What should it have done instead? ", "be more explicit") : "be more explicit";
    }

    if (!merged.relatedTicketId && interactive) {
      merged.relatedTicketId = await askOptionalText(rl, "Related ticket id (optional): ");
    }

    if (!merged.relatedCommand && interactive) {
      merged.relatedCommand = await askOptionalText(rl, "Related command/run (optional): ");
    }

    const createTicketNow = args["create-ticket"] !== undefined
      ? Boolean(args["create-ticket"])
      : interactive
        ? normalizeYesNo(await askText(rl, "Create a toolkit ticket now? [Y/n] ", "y"), true)
        : false;

    const summary = compactObservationSummary(merged);
    const attachedRun = latestRun && (!merged.relatedTicketId || latestRun.ticketId === merged.relatedTicketId || !latestRun.ticketId)
      ? latestRun
      : null;
    const summaryWithRun = attachedRun
      ? `${summary} | Attached run: ${attachedRun.id} (${attachedRun.kind})`
      : summary;
    const note = await addManualNote({
      projectRoot: context.repairTargetRoot,
      note: {
        noteType: merged.severity === "unsafe" ? "BUG" : "NOTE",
        body: summaryWithRun,
        filePath: null,
        symbolName: merged.component,
        provenance: "tool-dev-observe"
      }
    });

    let ticket = null;
    if (createTicketNow) {
      const ticketId = await nextToolkitTicketId(context.repairTargetRoot);
      ticket = buildTicketEntity({
        id: ticketId,
        title: truncateTitle(merged.complaint || "Tool observation"),
        lane: merged.severity === "unsafe" ? "Bugs P1" : "Todo",
        summary: summaryWithRun
      });
      await createTicket({ projectRoot: context.repairTargetRoot, entity: ticket });
    }

    const payload = {
      mode: context.mode,
      repairTargetRoot: context.repairTargetRoot,
      evidenceRoot: context.evidenceRoot,
      observation: merged,
      attachedRun,
      note,
      ticket
    };

    if (args.json) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      process.stdout.write([
        `Mode: ${payload.mode}`,
        `Repair target: ${payload.repairTargetRoot}`,
        payload.evidenceRoot !== payload.repairTargetRoot ? `Evidence root: ${payload.evidenceRoot}` : null,
        `Observation: ${merged.kind} | ${merged.severity} | ${merged.component}`,
        `Recorded note: ${note.id}`,
        ticket ? `Created toolkit ticket: ${ticket.id}` : "Created toolkit ticket: no"
      ].filter(Boolean).join("\n") + "\n");
    }
    return 0;
  } finally {
    rl.close();
  }
}

function inferObservationFromComplaint(text) {
  const value = String(text ?? "").toLowerCase();
  const result = {};
  if (!value.trim()) return result;

  if (/\b(wrong repo|wrong project|wrong target|edited .*project|edited .*repo)\b/.test(value)) {
    result.kind = "wrong-target";
    result.component = "execution";
    result.severity = "unsafe";
  } else if (/\b(wrong file|irrelevant|missed obvious|bad context|empty working set|junk files?)\b/.test(value)) {
    result.kind = "wrong-context";
    result.component = "context";
    result.severity = "blocking";
  } else if (/\b(verification|wrong check|bad check|baseline|claimed ready|lied|misleading)\b/.test(value)) {
    result.kind = /\b(lied|misleading)\b/.test(value) ? "misleading-output" : "bad-verification";
    result.component = /\b(lied|misleading)\b/.test(value) ? "shell" : "verification";
    result.severity = /\bunsafe\b/.test(value) ? "unsafe" : "blocking";
  } else if (/\b(missing|should support|needs to|mini-feature|feature)\b/.test(value)) {
    result.kind = "missing-feature";
    result.component = "other";
    result.severity = "annoying";
  } else if (/\b(unsafe|dangerous|destructive)\b/.test(value)) {
    result.kind = "unsafe-execution";
    result.component = "execution";
    result.severity = "unsafe";
  }

  if (!result.component && /\b(search|find|retrieve|ranking)\b/.test(value)) result.component = "search";
  if (!result.component && /\b(context|working set|files|symbols)\b/.test(value)) result.component = "context";
  if (!result.component && /\b(route|provider|quota|model)\b/.test(value)) result.component = "routing";
  if (!result.severity && /\b(blocker|can't|cannot|useless|broken)\b/.test(value)) result.severity = "blocking";
  return result;
}

async function askChoice(rl, prompt, choices, fallback) {
  const lines = [prompt];
  choices.forEach(([value, label], index) => {
    lines.push(`${index + 1}. ${label}`);
  });
  const answer = (await rl.question(`${lines.join("\n")}\nChoice: `)).trim();
  const byIndex = Number.parseInt(answer, 10);
  if (Number.isFinite(byIndex) && byIndex >= 1 && byIndex <= choices.length) {
    return choices[byIndex - 1][0];
  }
  const normalized = answer.toLowerCase();
  const direct = choices.find(([value]) => value === normalized);
  return direct?.[0] ?? fallback;
}

async function askText(rl, prompt, fallback = "") {
  const answer = (await rl.question(prompt)).trim();
  return answer || fallback;
}

async function askOptionalText(rl, prompt) {
  return (await rl.question(prompt)).trim();
}

function normalizeYesNo(value, defaultValue) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (["y", "yes", "true"].includes(normalized)) return true;
  if (["n", "no", "false"].includes(normalized)) return false;
  return defaultValue;
}

async function nextToolkitTicketId(projectRoot) {
  return withWorkflowStore(projectRoot, async (store) => {
    const rows = store.db.prepare(`
      SELECT id FROM entities
      WHERE entity_type = 'ticket' AND id LIKE 'TKH-%'
      ORDER BY id
    `).all();
    let max = 0;
    for (const row of rows) {
      const parsed = Number.parseInt(String(row.id).replace(/^TKH-/, ""), 10);
      if (Number.isFinite(parsed)) max = Math.max(max, parsed);
    }
    return `TKH-${String(max + 1).padStart(3, "0")}`;
  });
}

function compactObservationSummary(observation) {
  return [
    `Complaint: ${observation.complaint}`,
    `Kind: ${observation.kind}`,
    `Severity: ${observation.severity}`,
    `Component: ${observation.component}`,
    `Expected: ${observation.expected}`,
    observation.relatedTicketId ? `Related ticket: ${observation.relatedTicketId}` : null,
    observation.relatedCommand ? `Related command: ${observation.relatedCommand}` : null,
    observation.evidenceRoot ? `Evidence root: ${observation.evidenceRoot}` : null
  ].filter(Boolean).join(" | ");
}

function truncateTitle(text, limit = 72) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  if (value.length <= limit) return value || "Toolkit observation";
  return `${value.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

function formatReadinessResponse(response) {
  const lines = [
    `${response.summary}`,
    `Status: ${response.status}`,
    `Verdict: ${response.opinion.verdict} (${Math.round(response.opinion.confidence * 100)}% confidence)`
  ];
  if (response.evidence?.length) {
    lines.push("");
    lines.push("Evidence basis:");
    for (const item of response.evidence.slice(0, 3)) {
      const freshness = item.freshness?.status && item.freshness.status !== "unknown"
        ? ` | freshness: ${item.freshness.status}`
        : "";
      lines.push(`- [${item.source}] ${item.ref}: ${item.claim}${freshness}`);
    }
  }
  if (response.blockers?.length) {
    lines.push("");
    lines.push("Top blockers:");
    for (const blocker of response.blockers.slice(0, 4)) {
      lines.push(`- [${blocker.severity}] ${blocker.title}: ${blocker.reason}`);
    }
  }
  if (response.gaps?.length) {
    lines.push("");
    lines.push("Evidence gaps:");
    for (const gap of response.gaps.slice(0, 4)) {
      lines.push(`- ${gap}`);
    }
  }
  if (response.recommended_next_actions?.length) {
    lines.push("");
    lines.push("Next checks:");
    for (const item of response.recommended_next_actions.slice(0, 4)) {
      lines.push(`- ${item}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function formatEpicOutput(epic) {
  const lines = [
    `# ${epic.id} ${epic.title}`,
    "",
    "### Goal",
    "",
    epic.summary || "Pending natural-language scope.",
    "",
    "### User stories"
  ];

  if (epic.userStories.length) {
    for (const [index, story] of epic.userStories.entries()) {
      lines.push(`#### Story ${index + 1}`);
      lines.push("");
      lines.push(story);
      lines.push("");
    }
  } else {
    lines.push("None captured yet.");
    lines.push("");
  }

  lines.push("### Ticket batches");
  if (epic.ticketBatches.length) {
    for (const batch of epic.ticketBatches) {
      lines.push(`- ${batch}`);
    }
  } else {
    lines.push("- None captured yet.");
  }

  lines.push("");
  lines.push("### Kanban tickets");
  if (epic.linkedTickets.length) {
    for (const ticket of epic.linkedTickets) {
      const story = ticket.userStory ? ` | Story: ${ticket.userStory}` : "";
      lines.push(`- ${ticket.id} ${ticket.title} [${ticket.lane ?? "Todo"}]${story}`);
    }
  } else {
    lines.push("- none linked yet");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function formatAskResponse(response) {
  if (response.response_type === "composite" && response.payload?.project_status && response.payload?.readiness) {
    return formatCombinedAskResponse(response.payload);
  }

  if (response.response_type === "protocol" && response.payload?.operation === "evaluate_readiness") {
    return formatAssistantReadinessResponse(response.payload);
  }

  const lines = [];
  if (response.payload?.answer) {
    lines.push(response.payload.answer);
  } else if (response.payload?.summary) {
    lines.push(response.payload.summary);
  }
  if (Array.isArray(response.payload?.recommended_next_actions) && response.payload.recommended_next_actions.length) {
    lines.push("");
    lines.push("Next:");
    for (const item of response.payload.recommended_next_actions.slice(0, 3)) {
      lines.push(`- ${item}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function formatCombinedAskResponse(payload) {
  const lines = [];
  const status = payload?.project_status ?? {};
  const focus = Array.isArray(status.focus_tickets) ? status.focus_tickets : [];
  lines.push(`Project status: ${Number(status.active_ticket_count ?? 0)} active tickets, ${Number(status.candidate_count ?? 0)} candidates, ${Number(status.note_count ?? 0)} notes.`);
  if (focus.length) {
    lines.push(`Current focus: ${focus.slice(0, 3).map((ticket) => `${ticket.id} (${ticket.lane})`).join(", ")}.`);
  }
  lines.push("");
  lines.push(formatAssistantReadinessResponse(payload.readiness).trimEnd());
  return `${lines.join("\n")}\n`;
}

function formatAssistantReadinessResponse(payload) {
  const verdict = String(payload?.opinion?.verdict ?? "unknown");
  const confidence = Number(payload?.opinion?.confidence ?? 0);
  const blockers = Array.isArray(payload?.blockers) ? payload.blockers : [];
  const nextChecks = Array.isArray(payload?.recommended_next_actions) ? payload.recommended_next_actions : [];
  const lines = [];
  lines.push(verdict === "ready"
    ? `Beta readiness: ready (${Math.round(confidence * 100)}% confidence).`
    : `Beta readiness: not ready yet (${Math.round(confidence * 100)}% confidence).`);
  if (blockers.length) {
    lines.push(`Main blockers: ${blockers.length} total${formatBlockerSeveritySummary(blockers)}.`);
    for (const blocker of blockers.slice(0, 3)) {
      lines.push(`- ${String(blocker.title ?? blocker.reason ?? "").trim()}`);
    }
  }
  if (nextChecks.length) {
    lines.push(`Next step: ${String(nextChecks[0])}`);
  }
  return `${lines.join("\n")}\n`;
}

function formatBlockerSeveritySummary(blockers) {
  const counts = blockers.reduce((acc, blocker) => {
    const key = String(blocker?.severity ?? "").toLowerCase();
    if (key) acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const parts = [];
  if (counts.high) parts.push(`${counts.high} high`);
  if (counts.medium) parts.push(`${counts.medium} medium`);
  if (counts.low) parts.push(`${counts.low} low`);
  return parts.length ? `, including ${parts.join(", ")}` : "";
}

function normalizeModeValue(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "default" || normalized === "tool-dev") return normalized;
  return null;
}
