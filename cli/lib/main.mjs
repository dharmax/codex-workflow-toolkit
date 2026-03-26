import path from "node:path";
import { execFile } from "node:child_process";
import os from "node:os";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { parseArgs, printAndExit } from "../../runtime/scripts/codex-workflow/lib/cli.mjs";
import { getToolkitCodelet, getToolkitRoot, listToolkitCodelets } from "./codelets.mjs";
import { getConfigValue, getGlobalConfigPath, getProjectConfigPath, readConfig, removeConfigFile, removeConfigValue, writeConfigValue } from "./config-store.mjs";
import { runDoctor } from "./doctor.mjs";
import { handleSetOllamaHw } from "./ollama-hw.mjs";
import { handleShell } from "./shell.mjs";
import { handleProviderConnect } from "./provider-connect.mjs";
import { installAgents } from "./install.mjs";
import { forgeProjectCodelet, getProjectCodelet, listProjectCodelets, removeProjectCodelet, upsertProjectCodelet } from "./project-codelets.mjs";
import { routeTask } from "../../core/services/router.mjs";
import { auditArchitecture } from "../../core/services/critic.mjs";
import { refreshProviderQuotaState } from "../../core/services/providers.mjs";
import { buildTicketEntity, importLegacyProjections, renderEpicsProjection, renderKanbanProjection } from "../../core/services/projections.mjs";
import { addManualNote, createTicket, getProjectMetrics, getProjectSummary, reviewProjectCandidates, searchProject, syncProject, withWorkflowStore } from "../../core/services/sync.mjs";
import { buildTelegramPreview } from "../../core/services/telegram.mjs";
import { ingestArtifact } from "../../core/services/orchestrator.mjs";
import { assertSafeRepairTarget, getToolkitRoot as getOperatingToolkitRoot, resolveOperatingContext } from "../../core/lib/operating-context.mjs";
import { readLatestRunArtifact } from "../../core/lib/run-artifacts.mjs";

const toolkitRoot = getToolkitRoot();
const execFileAsync = promisify(execFile);

const HELP = `Usage:
  ai-workflow init [options]
  ai-workflow install [--project <path>]
  ai-workflow doctor [--json]
  ai-workflow audit architecture [--json]
  ai-workflow set-ollama-hw [options]
  ai-workflow set-provider-key <provider-id> [--global]
  ai-workflow metrics [--json]
  ai-workflow ingest <file> [--json]
  ai-workflow consult
  ai-workflow shell [request...] [--yes] [--plan-only] [--no-ai] [--json]
  ai-workflow sync [--write-projections] [--json]
  ai-workflow reprofile [--json]
  ai-workflow list [--json]
  ai-workflow info <codelet>
  ai-workflow run <codelet> [args]
  ai-workflow add <codelet> <file>
  ai-workflow update <codelet> <file>
  ai-workflow remove <codelet>
  ai-workflow project summary [--json]
  ai-workflow project search <text> [--json]
  ai-workflow project ticket create --id <id> --title <title> [--lane <lane>] [--epic <epic-id>] [--summary <text>] [--json]
  ai-workflow project note add --type <NOTE|TODO|FIXME|HACK|BUG|RISK> --body <text> [--file <path>] [--line <n>] [--symbol <name>] [--json]
  ai-workflow project review-candidates [--json]
  ai-workflow extract ticket <id> [options]
  ai-workflow extract guidelines [options]
  ai-workflow verify <workflow|guidelines> [options]
  ai-workflow forge codelet <name>
  ai-workflow route <task-class> [--json]
  ai-workflow telegram preview [--json]
  ai-workflow provider connect <provider-id>
  ai-workflow provider quota refresh [provider-id|all] [--global] [--json]
  ai-workflow mode set <default|tool-dev> [--global]
  ai-workflow mode status [--json]
  ai-workflow tool observe [--complaint <text>] [--json]
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

  const [command, ...rest] = argv;

  switch (command) {
    case "init":
      return runNodeScript(path.resolve(toolkitRoot, "scripts", "init-project.mjs"), rest);
    case "install":
      return handleInstall(rest);
    case "doctor":
      await runDoctor({ root: process.cwd(), json: rest.includes("--json") });
      return 0;
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
    case "consult":
      return handleConsult(rest);
    case "shell":
      return handleShell(rest, { cliPath: path.resolve(toolkitRoot, "cli", "ai-workflow.mjs") });
    case "sync":
      return handleSync(rest);
    case "reprofile":
      await runDoctor({ root: process.cwd(), json: rest.includes("--json") });
      return 0;
    case "list":
      return handleList(rest);
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
    case "tool":
      return handleTool(rest);
    case "config":
      return handleConfig(rest);
    default:
      printAndExit(`Unknown command: ${command}\n\n${HELP}`, 1);
  }
}

async function handleList(rest) {
  const json = rest.includes("--json");
  const toolkitCodelets = await listToolkitCodelets();
  const projectCodelets = await listProjectCodelets(process.cwd());

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

async function handleSync(rest) {
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
    `Imported tickets: ${result.importSummary.importedTickets}`,
    `Reviewed candidates: ${result.lifecycle.reviewed.length}`
  ];
  if (result.projections) {
    lines.push(`Wrote projections: ${result.projections.kanbanPath}, ${result.projections.epicsPath}`);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

async function handleInfo(rest) {
  const name = rest[0];
  if (!name) {
    printAndExit("Usage: ai-workflow info <codelet>", 1);
  }

  const codelet = await getProjectCodelet(process.cwd(), name) ?? await getToolkitCodelet(name);
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

  const projectCodelet = await getProjectCodelet(process.cwd(), name);
  if (projectCodelet) {
    return runProjectCodelet(projectCodelet, args);
  }

  const toolkitCodelet = await getToolkitCodelet(name);
  if (toolkitCodelet) {
    if (toolkitCodelet.runner === "builtin" && name === "doctor") {
      await runDoctor({ root: process.cwd(), json: args.includes("--json") });
      return 0;
    }

    return runNodeScript(toolkitCodelet.entry, args);
  }

  printAndExit(`Unknown codelet: ${name}`, 1);
}

async function handleAdd(rest, mode) {
  const [name, filePath] = rest;
  if (!name || !filePath) {
    printAndExit(`Usage: ai-workflow ${mode} <codelet> <file>`, 1);
  }

  const manifest = await upsertProjectCodelet(process.cwd(), name, filePath, mode);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  return 0;
}

async function handleRemove(rest) {
  const name = rest[0];
  if (!name) {
    printAndExit("Usage: ai-workflow remove <codelet>", 1);
  }

  await removeProjectCodelet(process.cwd(), name);
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
    return runNodeScript(path.resolve(toolkitRoot, "runtime", "scripts", "codex-workflow", "guideline-audit.mjs"), args);
  }

  return runNodeScript(verifyCodelet.entry, [target, ...args]);
}

async function handleForge(rest) {
  const [kind, name] = rest;
  if (kind !== "codelet" || !name) {
    printAndExit("Usage: ai-workflow forge codelet <name>", 1);
  }

  const forged = await forgeProjectCodelet(process.cwd(), name);
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
      `Candidates: ${summary.candidates.length}`
    ].join("\n") + "\n");
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

  if (subcommand === "ticket" && args._[0] === "create") {
    const id = args.id;
    const title = args.title;
    if (!id || !title) {
      printAndExit("Usage: ai-workflow project ticket create --id <id> --title <title> [--lane <lane>] [--epic <epic-id>] [--summary <text>] [--json]", 1);
    }

    const ticket = buildTicketEntity({
      id,
      title,
      lane: String(args.lane ?? "Todo"),
      epicId: args.epic ? String(args.epic) : null,
      summary: args.summary ? String(args.summary) : ""
    });
    await withWorkflowStore(process.cwd(), async (store) => {
      if (args.epic) {
        store.upsertEntity({
          id: String(args.epic),
          entityType: "epic",
          title: String(args.epic),
          lane: null,
          state: "open",
          confidence: 1,
          provenance: "manual",
          sourceKind: "manual",
          reviewState: "active",
          data: {}
        });
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
    });
    if (args.json) {
      process.stdout.write(`${JSON.stringify(ticket, null, 2)}\n`);
      return 0;
    }
    process.stdout.write(`${ticket.id} ${ticket.title} [${ticket.lane}]\n`);
    return 0;
  }

  if (subcommand === "note" && args._[0] === "add") {
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
    const result = await withWorkflowStore(process.cwd(), async (store) => importLegacyProjections(store, { projectRoot: process.cwd() }));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }

  printAndExit("Usage: ai-workflow project <summary|search|ticket|note|review-candidates|render|import-projections> ...", 1);
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
  if (subcommand === "connect") {
    return await handleProviderConnect(providerId);
  }
  if (subcommand === "quota") {
    const [action, target] = [providerId, extras[0]];
    const args = parseArgs(extras.slice(1));
    if (action === "refresh") {
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
    }
  }
  printAndExit("Usage: ai-workflow provider connect <provider-id>\n       ai-workflow provider quota refresh [provider-id|all] [--global] [--json]", 1);
}

async function handleMode(rest) {
  const [action, ...tail] = rest;
  const args = parseArgs(tail);
  const value = args._[0];
  const scope = args.global ? "global" : "project";
  const configPath = scope === "global" ? getGlobalConfigPath() : getProjectConfigPath(process.cwd());

  if (action === "set") {
    const normalized = normalizeModeValue(value);
    if (!normalized) {
      printAndExit("Usage: ai-workflow mode set <default|tool-dev> [--global]", 1);
    }
    const config = await writeConfigValue(configPath, "mode", normalized);
    process.stdout.write(`${JSON.stringify({ path: configPath, mode: getConfigValue(config, "mode") }, null, 2)}\n`);
    return 0;
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

async function handleTool(rest) {
  const [action, ...extras] = rest;
  if (action === "observe") {
    return handleToolObserve(extras);
  }
  printAndExit("Usage: ai-workflow tool observe [--complaint <text>] [--json]", 1);
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
    if (!key || value === undefined) {
      printAndExit("Usage: ai-workflow config set <key> <value> [--global]", 1);
    }
    const config = await writeConfigValue(configPath, key, value);
    process.stdout.write(`${JSON.stringify({ path: configPath, value: getConfigValue(config, key) }, null, 2)}\n`);
    return 0;
  }

  if (action === "unset") {
    if (!key) {
      printAndExit("Usage: ai-workflow config unset <key> [--global]", 1);
    }
    await removeConfigValue(configPath, key);
    process.stdout.write(`${JSON.stringify({ path: configPath, removed: key }, null, 2)}\n`);
    return 0;
  }

  if (action === "clear") {
    await removeConfigFile(configPath);
    process.stdout.write(`${JSON.stringify({ path: configPath, cleared: true }, null, 2)}\n`);
    return 0;
  }

  printAndExit("Usage: ai-workflow config <get|set|unset|clear> ...", 1);
}

async function handleInstall(rest) {
  const args = parseArgs(rest);
  const projectRoot = path.resolve(String(args.project ?? process.cwd()));
  const results = await installAgents({
    toolkitRoot,
    projectRoot
  });
  process.stdout.write(`Installation complete in ${projectRoot}\n`);
  return 0;
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
}

async function handleMetrics(rest) {
  const args = parseArgs(rest);
  const metrics = await getProjectMetrics({ projectRoot: process.cwd() });
  
  if (args.json) {
    process.stdout.write(`${JSON.stringify(metrics, null, 2)}\n`);
    return 0;
  }

  process.stdout.write(`Total AI Calls: ${metrics.totalCalls}\n`);
  process.stdout.write(`Success Rate: ${metrics.successRate}%\n`);
  process.stdout.write(`Avg Latency: ${metrics.avgLatencyMs}ms\n`);
  process.stdout.write("\nUsage by Model:\n");
  for (const m of metrics.byModel) {
    process.stdout.write(`- ${m.model_id}: ${m.count} calls, ${Math.round(m.success_rate)}% success, ${Math.round(m.avg_latency)}ms avg\n`);
  }
  return 0;
}

async function handleIngest(rest) {
  const [filePath] = rest;
  if (!filePath) {
    printAndExit("Usage: ai-workflow ingest <file> [--json]", 1);
  }
  const args = parseArgs(rest);
  const rl = readline.createInterface({ input, output });

  try {
    const targetPath = path.resolve(process.cwd(), filePath);
    const result = await ingestArtifact(targetPath, { root: process.cwd(), rl });
    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stdout.write(`\nIngestion complete. Generated Epic: ${result.epic.id} with ${result.tickets.length} tickets.\n`);
    }
  } catch (error) {
    printAndExit(`Ingestion failed: ${error.message}`, 1);
  } finally {
    rl.close();
  }
  return 0;
}

async function handleConsult(rest) {
  const root = process.cwd();
  const rl = readline.createInterface({ input, output });

  try {
    const pending = await withWorkflowStore(root, async (store) => {
      return store.db.prepare("SELECT * FROM entities WHERE consultation_question IS NOT NULL").all();
    });

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
        await withWorkflowStore(root, async (store) => {
          const entity = store.getEntity(row.id);
          entity.consultationQuestion = null;
          entity.data.consultationResponse = answer;
          entity.lane = "Todo"; // Move back to Todo
          store.upsertEntity(entity);
        });
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

function runNodeScript(scriptPath, args) {
  return mkdtemp(path.join(os.tmpdir(), "ai-workflow-cli-")).then(async (captureDir) => {
    const stdoutPath = path.join(captureDir, "stdout.log");
    const stderrPath = path.join(captureDir, "stderr.log");
    const command = `${shellQuote(process.execPath)} ${[scriptPath, ...args].map(shellQuote).join(" ")} > ${shellQuote(stdoutPath)} 2> ${shellQuote(stderrPath)}`;

    try {
      await execFileAsync("/usr/bin/bash", ["-lc", command], {
        cwd: process.cwd(),
        maxBuffer: 16 * 1024 * 1024
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

function runProjectCodelet(codelet, args) {
  const entry = path.resolve(process.cwd(), codelet.entry);
  if (codelet.runner !== "node-script") {
    printAndExit(`Unsupported project codelet runner: ${codelet.runner}`, 1);
  }
  return runNodeScript(entry, args);
}

async function handleToolObserve(rest) {
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

function normalizeModeValue(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "default" || normalized === "tool-dev") return normalized;
  return null;
}
