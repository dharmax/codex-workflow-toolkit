import path from "node:path";
import { readText } from "../../runtime/scripts/codex-workflow/lib/fs-utils.mjs";
import { writeProjectFile } from "../lib/filesystem.mjs";
import { stableId } from "../lib/hash.mjs";

const DEFAULT_TICKET_LANES = [
  "In Progress",
  "Todo",
  "AI Candidates",
  "Doubtful Relevancy",
  "Ideas",
  "Risk Watch",
  "Archived"
];

export function buildSmartProjectStatus(store, { auditFindings = [] } = {}) {
  const counts = store.getSummary();
  const tickets = store.listEntities({ entityType: "ticket" }).filter(t => t.state !== "archived");
  const epics = store.listEntities({ entityType: "epic" }).filter(e => e.state !== "archived");
  const metrics = store.listMetrics({ limit: 50 });

  const activeEpic = epics.find(e => e.state === "open") || epics[0];
  const inProgress = tickets.filter(t => t.lane === "In Progress");
  const todo = tickets.filter(t => t.lane === "Todo");
  const others = tickets.filter(t => t.lane !== "In Progress" && t.lane !== "Todo");
  const failures = metrics.filter(m => !m.success).slice(0, 5);

  const auditSummary = auditFindings.reduce((acc, f) => {
    acc[f.severity] = (acc[f.severity] || 0) + 1;
    return acc;
  }, {});

  const status = [
    `Environment: ${process.platform} | CWD: ${store.projectRoot}`,
    `Project: ${path.basename(store.projectRoot)}`,
    `Epic: ${activeEpic ? `[${activeEpic.id}] ${activeEpic.title} (${activeEpic.state})` : "None"}`,
    `Inventory: ${counts.files} files, ${tickets.length} active tickets, ${counts.candidates} candidates`,
    "",
    "### ACTIVE PRIORITY QUEUE",
    inProgress.length ? inProgress.map(t => `- [IN_PROGRESS] ${t.id}: ${t.title}`).join("\n") : "- No tickets currently in progress.",
    todo.length ? todo.slice(0, 20).map(t => `- [TODO] ${t.id}: ${t.title}`).join("\n") : "",
    todo.length > 20 ? `... and ${todo.length - 20} more TODOs` : "",
    others.length ? `\n### BACKLOG / OTHER\n${others.slice(0, 20).map(t => `- [${t.lane}] ${t.id}: ${t.title}`).join("\n")}` : "",
    others.length > 20 ? `... and ${others.length - 20} more items in backlog` : "",
    "",
    "### RECENT FRICTION (SYSTEM HEALTH)",
    failures.length 
      ? failures.map(f => `!! FAILURE in ${f.task_class} (${f.created_at}): ${f.error_message}`).join("\n") 
      : "- System metrics indicate nominal operation (no recent failures).",
    "",
    "### ARCHITECTURAL HEALTH",
    auditFindings.length 
      ? `Audit Detects: ${auditSummary.high || 0} High, ${auditSummary.medium || 0} Medium issues.` 
      : "- No architectural audit performed or wiring is clean."
  ].filter(Boolean).join("\n");

  return status;
}

export function buildProjectSummary(store) {
  const counts = store.getSummary();
  const activeTickets = store.listEntities({ entityType: "ticket" })
    .filter((ticket) => ticket.state !== "archived")
    .map(t => ({
      id: t.id,
      title: t.title,
      lane: t.lane,
      summary: t.data?.summary ?? "No description provided.",
      domain: t.data?.domain ?? "unknown"
    }));

  const candidates = store.listCandidates({ statuses: ["ai-candidate", "doubtful-relevancy", "promoted"] }).slice(0, 10);
  const notes = store.listNotes().slice(0, 20);
  const modules = store.listModules().map(m => ({ name: m.name, responsibility: m.responsibility }));

  return {
    fileCount: counts.files,
    noteCount: counts.notes,
    symbolCount: counts.symbols,
    claimCount: counts.claims,
    ticketCount: counts.tickets,
    candidateCount: counts.candidates,
    activeTickets,
    candidates,
    notes,
    modules
  };
}

export function renderKanbanProjection(store) {
  const tickets = store.listEntities({ entityType: "ticket" });
  const candidateTickets = store.listEntities({ entityType: "candidate-ticket" });
  const ideas = store.listEntities({ entityType: "idea" });
  const risks = store.listEntities({ entityType: "risk" });
  const laneMap = new Map(DEFAULT_TICKET_LANES.map((lane) => [lane, []]));

  for (const ticket of tickets) {
    laneMap.get(ticket.lane ?? "Todo")?.push(ticket);
  }
  for (const ticket of candidateTickets) {
    laneMap.get("AI Candidates")?.push(ticket);
  }
  for (const idea of ideas) {
    laneMap.get("Ideas")?.push(idea);
  }
  for (const risk of risks) {
    laneMap.get("Risk Watch")?.push(risk);
  }

  const lines = ["# Kanban", "", "_Generated from the workflow DB. Edit through `ai-workflow project ...` or `ai-workflow sync`._", ""];
  for (const lane of DEFAULT_TICKET_LANES) {
    lines.push(`## ${lane}`);
    lines.push("");
    const items = laneMap.get(lane) ?? [];
    if (!items.length) {
      lines.push("- [ ] No items");
      lines.push("");
      continue;
    }

    for (const item of items) {
      const id = item.data.ticketId ?? item.id.replace(/^ticket:/, "").replace(/^candidate:/, "");
      lines.push(`- [ ] ${id} ${item.title}`);
      if (item.data?.summary) {
        lines.push(`  - Summary: ${item.data.summary}`);
      }
      if (item.parentId) {
        lines.push(`  - Parent: ${item.parentId}`);
      }
      lines.push(`  - State: ${item.state}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderEpicsProjection(store) {
  const epics = store.listEntities({ entityType: "epic" });
  const tickets = store.listEntities({ entityType: "ticket" });
  const lines = ["# Epics", "", "_Generated from the workflow DB._", ""];

  for (const epic of epics) {
    lines.push(`## ${epic.id} ${epic.title}`);
    lines.push("");
    lines.push(`- State: ${epic.state}`);
    const linked = tickets.filter((ticket) => ticket.parentId === epic.id);
    if (linked.length) {
      lines.push("- Tickets:");
      for (const ticket of linked) {
        lines.push(`  - ${ticket.id} ${ticket.title} [${ticket.lane ?? "Todo"}]`);
      }
    } else {
      lines.push("- Tickets: none linked");
    }
    lines.push("");
  }

  if (!epics.length) {
    lines.push("## No epics yet");
    lines.push("");
    lines.push("- Add one with `ai-workflow project ticket create --epic EPC-001 ...` or by writing entities directly through the CLI.");
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export async function writeProjectProjections(store, { projectRoot }) {
  const kanban = renderKanbanProjection(store);
  const epics = renderEpicsProjection(store);
  await Promise.all([
    writeProjectFile(projectRoot, "kanban.md", kanban),
    writeProjectFile(projectRoot, "epics.md", epics)
  ]);
  return {
    kanbanPath: path.resolve(projectRoot, "kanban.md"),
    epicsPath: path.resolve(projectRoot, "epics.md")
  };
}

export async function importLegacyProjections(store, { projectRoot }) {
  const kanbanText = await readText(path.resolve(projectRoot, "kanban.md"), "");
  const epicsText = await readText(path.resolve(projectRoot, "epics.md"), "");
  
  if (!kanbanText.trim() && !epicsText.trim()) {
    return { importedTickets: 0, importedEpics: 0, skipped: true };
  }

  let currentLane = "Todo";
  let importedTickets = 0;
  let importedEpics = 0;

  for (const line of kanbanText.split(/\r?\n/)) {
    const laneMatch = line.match(/^##\s+(.+)$/);
    if (laneMatch) {
      currentLane = laneMatch[1].trim();
      continue;
    }

    const ticketMatch = line.match(/^- \[[ xX]\]\s+([A-Z]+-\d+)\s+(.+)$/);
    if (!ticketMatch) {
      continue;
    }

    const ticketId = ticketMatch[1];
    const existing = store.getEntity(ticketId);

    store.upsertEntity({
      id: ticketId,
      entityType: "ticket",
      title: ticketMatch[2].trim(),
      lane: currentLane,
      state: currentLane === "Archived" ? "archived" : "open",
      confidence: 1,
      provenance: "legacy-kanban-import",
      sourceKind: "projection-import",
      reviewState: "active",
      createdAt: existing?.createdAt,
      data: {
        ...(existing?.data ?? {}),
        ticketId
      }
    });
    importedTickets += 1;
  }

  for (const line of epicsText.split(/\r?\n/)) {
    const epicMatch = line.match(/^##\s+([A-Z]+-\d+)\s+(.+)$/);
    if (!epicMatch) {
      continue;
    }

    const epicId = epicMatch[1];
    const existing = store.getEntity(epicId);

    store.upsertEntity({
      id: epicId,
      entityType: "epic",
      title: epicMatch[2].trim(),
      lane: null,
      state: "open",
      confidence: 1,
      provenance: "legacy-epics-import",
      sourceKind: "projection-import",
      reviewState: "active",
      createdAt: existing?.createdAt,
      data: {
        ...(existing?.data ?? {})
      }
    });
    importedEpics += 1;
  }

  return {
    importedTickets,
    importedEpics,
    skipped: false
  };
}

export function buildTicketEntity({ id, title, lane = "Todo", state = "open", epicId = null, summary = "" }) {
  return {
    id,
    entityType: "ticket",
    title,
    lane,
    state,
    confidence: 1,
    provenance: "manual",
    sourceKind: "manual",
    reviewState: "active",
    parentId: epicId,
    data: {
      ticketId: id,
      summary
    }
  };
}

export function createSearchDocumentsForEntities(store) {
  const entities = store.listEntities();
  for (const entity of entities) {
    store.db.prepare(`
      INSERT INTO search_index (id, scope, ref_id, title, body, tags, updated_at)
      VALUES (?, 'entity', ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        body = excluded.body,
        tags = excluded.tags,
        updated_at = excluded.updated_at
    `).run(
      stableId("search", "entity", entity.id),
      entity.id,
      entity.title,
      JSON.stringify(entity.data),
      [entity.entityType, entity.lane ?? "", entity.state].filter(Boolean).join(","),
      entity.updatedAt
    );
  }
}
