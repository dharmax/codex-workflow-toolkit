import path from "node:path";
import { spawn } from "node:child_process";
import { parseArgs, printAndExit } from "../../runtime/scripts/codex-workflow/lib/cli.mjs";
import { getToolkitCodelet, getToolkitRoot, listToolkitCodelets } from "./codelets.mjs";
import { getConfigValue, getGlobalConfigPath, getProjectConfigPath, readConfig, removeConfigFile, removeConfigValue, writeConfigValue } from "./config-store.mjs";
import { runDoctor } from "./doctor.mjs";
import { handleSetOllamaHw } from "./ollama-hw.mjs";
import { handleShell } from "./shell.mjs";
import { installAgents } from "./install.mjs";
import { forgeProjectCodelet, getProjectCodelet, listProjectCodelets, removeProjectCodelet, upsertProjectCodelet } from "./project-codelets.mjs";
import { routeTask } from "../../core/services/router.mjs";
import { buildTicketEntity, importLegacyProjections, renderEpicsProjection, renderKanbanProjection } from "../../core/services/projections.mjs";
import { addManualNote, getProjectSummary, reviewProjectCandidates, searchProject, syncProject, withWorkflowStore } from "../../core/services/sync.mjs";
import { buildTelegramPreview } from "../../core/services/telegram.mjs";

const toolkitRoot = getToolkitRoot();

const HELP = `Usage:
  ai-workflow init [options]
  ai-workflow install codex|claude|gemini|all [--project <path>]
  ai-workflow doctor [--json]
  ai-workflow set-ollama-hw [options]
  ai-workflow shell [request...] [--yes] [--plan-only] [--no-ai] [--json]
  ai-workflow sync [--write-projections] [--json]
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
    case "set-ollama-hw":
      return handleSetOllamaHw(rest, { root: process.cwd() });
    case "shell":
      return handleShell(rest, { cliPath: path.resolve(toolkitRoot, "cli", "ai-workflow.mjs") });
    case "sync":
      return handleSync(rest);
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
  const [target = "all", ...extras] = rest;
  const args = parseArgs(extras);
  const projectRoot = path.resolve(String(args.project ?? process.cwd()));
  const results = await installAgents({
    toolkitRoot,
    projectRoot,
    target
  });
  process.stdout.write(`${JSON.stringify({ toolkitRoot, projectRoot, results }, null, 2)}\n`);
  return 0;
}

function runNodeScript(scriptPath, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: process.cwd(),
      stdio: "inherit"
    });

    child.on("close", (code) => {
      resolve(code ?? 1);
    });

    child.on("error", (error) => {
      process.stderr.write(`${error.message}\n`);
      resolve(1);
    });
  });
}

function runProjectCodelet(codelet, args) {
  const entry = path.resolve(process.cwd(), codelet.entry);
  if (codelet.runner !== "node-script") {
    printAndExit(`Unsupported project codelet runner: ${codelet.runner}`, 1);
  }
  return runNodeScript(entry, args);
}
