import path from "node:path";
import { readText } from "../../runtime/scripts/codex-workflow/lib/fs-utils.mjs";
import { writeProjectFile } from "../lib/filesystem.mjs";
import { sha1, stableId } from "../lib/hash.mjs";

const DEFAULT_TICKET_LANES = [
  "Deep Backlog",
  "Backlog",
  "ToDo",
  "Bugs P1",
  "Bugs P2/P3",
  "In Progress",
  "Human Testing",
  "Suggestions",
  "Done",
  "AI Candidates",
  "Risk Watch",
  "Doubtful Relevancy",
  "Ideas",
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
    .filter((ticket) => ticket.state !== "archived" && ticket.lane !== "Done" && ticket.lane !== "Archived")
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
    laneMap.get(normalizeDisplayLaneName(ticket.lane ?? "ToDo"))?.push(ticket);
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

  const lines = [
    "---",
    "kanban-plugin: board",
    "---",
    "",
    "# Kanban",
    "",
    "_Generated from the workflow DB. Edit through `ai-workflow project ...` or `ai-workflow sync`._",
    ""
  ];
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
      if (item.data?.userStory) {
        lines.push(`  - Story: ${item.data.userStory}`);
      }
      if (item.parentId) {
        lines.push(`  - Parent: ${item.parentId}`);
      }
      lines.push(`  - State: ${item.state}`);
    }
    lines.push("");
  }
  lines.push("%% kanban:settings");
  lines.push("```");
  lines.push('{"kanban-plugin":"board"}');
  lines.push("```");
  lines.push("%%");
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderEpicsProjection(store) {
  const epics = store.listEntities({ entityType: "epic" }).sort(compareEpicPriority);
  const tickets = store.listEntities({ entityType: "ticket" });
  const lines = ["# Epics", "", "_Generated from the workflow DB._", ""];

  for (const epic of epics) {
    const userStories = normalizeEpicStories(epic);
    const ticketBatches = normalizeEpicTicketBatches(epic);
    const linkedTickets = tickets.filter((ticket) => ticket.parentId === epic.id || ticket.data?.epic === epic.id);

    lines.push(`## ${epic.id} ${epic.title}`);
    lines.push("");
    lines.push("### Goal");
    lines.push("");
    lines.push(normalizeEpicSummary(epic) || "Pending natural-language scope.");
    lines.push("");
    lines.push("### User stories");
    if (userStories.length) {
      userStories.forEach((story, index) => {
        lines.push(`#### Story ${index + 1}`);
        lines.push("");
        lines.push(story);
        lines.push("");
      });
    } else {
      lines.push("None captured yet.");
      lines.push("");
    }
    lines.push("### Ticket batches");
    if (ticketBatches.length) {
      for (const batch of ticketBatches) {
        lines.push(`- ${batch}`);
      }
    } else {
      lines.push("- None captured yet.");
    }
    lines.push("");
    lines.push("### Kanban tickets");
    if (linkedTickets.length) {
      for (const ticket of linkedTickets) {
        const ticketStory = ticket.data?.userStory ? ` | Story: ${ticket.data.userStory}` : "";
        lines.push(`- ${ticket.id} ${ticket.title} [${ticket.lane ?? "Todo"}]${ticketStory}`);
      }
    } else {
      lines.push("- none linked yet");
    }
    lines.push("");
  }

  if (!epics.length) {
    lines.push("## No epics yet");
    lines.push("");
    lines.push("- Add one with `ai-workflow project ticket create --epic EPC-001 ...` or by writing entities directly through the CLI.");
    lines.push("- Each epic should describe the user outcome in natural language, then break into user stories, ticket batches, and kanban tickets.");
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export async function writeProjectProjections(store, { projectRoot }) {
  const kanban = renderKanbanProjection(store);
  const epics = renderEpicsProjection(store);
  const mission = store.getMeta("mission");
  const gemini = store.getMeta("gemini");
  const writtenAt = new Date().toISOString();

  const writes = [
    writeProjectFile(projectRoot, "kanban.md", kanban),
    writeProjectFile(projectRoot, "epics.md", epics)
  ];

  if (mission) {
    writes.push(writeProjectFile(projectRoot, "MISSION.md", mission));
  }
  if (gemini) {
    const geminiPath = (async () => {
      const { existsSync } = await import("node:fs");
      if (existsSync(path.resolve(projectRoot, ".gemini", "GEMINI.md"))) return ".gemini/GEMINI.md";
      return "GEMINI.md";
    })();
    writes.push(writeProjectFile(projectRoot, await geminiPath, gemini));
  }

  await Promise.all(writes);
  store.setMeta("lastProjectionDigest", {
    writtenAt,
    kanban: sha1(kanban),
    epics: sha1(epics)
  });
  return {
    kanbanPath: path.resolve(projectRoot, "kanban.md"),
    epicsPath: path.resolve(projectRoot, "epics.md"),
    writtenAt
  };
}

export async function importLegacyProjections(store, { projectRoot }) {
  const lastProjectionDigest = store.getMeta("lastProjectionDigest");
  const kanbanSource = await selectProjectionSource(projectRoot, ["docs/kanban.md", "kanban.md"], countKanbanTickets, { lastProjectionDigest });
  const epicsSource = await selectProjectionSource(projectRoot, ["docs/epics.md", "epics.md"], countEpicEntries, { lastProjectionDigest });
  const kanbanText = kanbanSource.text;
  const epicsText = epicsSource.text;
  const missionText = await readText(path.resolve(projectRoot, "MISSION.md"), "");
  const geminiText = await readText(path.resolve(projectRoot, ".gemini", "GEMINI.md"), "") || await readText(path.resolve(projectRoot, "GEMINI.md"), "");
  
  if (missionText) {
    store.setMeta("mission", missionText);
  }
  if (geminiText) {
    store.setMeta("gemini", geminiText);
  }

  if (!kanbanText.trim() && !epicsText.trim()) {
    return { importedTickets: 0, importedEpics: 0, skipped: true };
  }

  let currentLane = "Todo";
  let importedTickets = 0;
  let importedEpics = 0;
  let currentTicket = null;
  const importedTicketIds = new Set();
  const importedEpicIds = new Set();

  for (const line of kanbanText.split(/\r?\n/)) {
    const laneMatch = line.match(/^##\s+(.+)$/);
    if (laneMatch) {
      currentLane = normalizeLaneName(laneMatch[1].trim());
      currentTicket = null;
      continue;
    }

    const ticketMatch = parseKanbanTicketLine(line);
    if (ticketMatch) {
      const existing = store.getEntity(ticketMatch.ticketId);
      const state = ticketMatch.checked || currentLane === "Done" || currentLane === "Archived" ? "archived" : "open";
      const ticketData = {
        ...(existing?.data ?? {}),
        ticketId: ticketMatch.ticketId
      };
      if (ticketMatch.completedAt) {
        ticketData.completedAt = ticketMatch.completedAt;
      }
      store.upsertEntity({
        id: ticketMatch.ticketId,
        entityType: "ticket",
        title: ticketMatch.title,
        lane: currentLane,
        state,
        confidence: 1,
        provenance: `legacy-kanban-import:${kanbanSource.path}`,
        sourceKind: "projection-import",
        reviewState: "active",
        createdAt: existing?.createdAt,
        parentId: existing?.parentId ?? null,
        data: ticketData
      });
      importedTicketIds.add(ticketMatch.ticketId);
      currentTicket = ticketMatch.ticketId;
      importedTickets += 1;
      continue;
    }

    const fieldMatch = line.match(/^\s{2,}-\s+([A-Za-z][A-Za-z /]+):\s+(.+)$/);
    if (currentTicket && fieldMatch) {
      const existing = store.getEntity(currentTicket);
      const fieldName = normalizeTicketFieldName(fieldMatch[1]);
      const value = fieldMatch[2].trim();
      const nextData = {
        ...(existing?.data ?? {}),
        ticketId: currentTicket,
        [fieldName]: value
      };
      const nextParentId = fieldName === "epic" ? value : existing?.parentId ?? null;
      store.upsertEntity({
        ...existing,
        id: currentTicket,
        entityType: "ticket",
        title: existing?.title ?? currentTicket,
        lane: existing?.lane ?? currentLane,
        state: existing?.state ?? "open",
        confidence: existing?.confidence ?? 1,
        provenance: existing?.provenance ?? `legacy-kanban-import:${kanbanSource.path}`,
        sourceKind: existing?.sourceKind ?? "projection-import",
        reviewState: existing?.reviewState ?? "active",
        createdAt: existing?.createdAt,
        parentId: nextParentId,
        data: nextData
      });
    }
  }

  for (const epic of parseEpicEntries(epicsText)) {
    const existing = store.getEntity(epic.id);

    store.upsertEntity({
      id: epic.id,
      entityType: "epic",
      title: epic.title,
      lane: null,
      state: epic.state,
      confidence: 1,
      provenance: `legacy-epics-import:${epicsSource.path}`,
      sourceKind: "projection-import",
      reviewState: "active",
      createdAt: existing?.createdAt,
      data: {
        ...(existing?.data ?? {}),
        summary: preferNonEmpty(epic.summary, existing?.data?.summary ?? ""),
        userStories: epic.userStories?.length ? epic.userStories : (existing?.data?.userStories ?? []),
        ticketBatches: epic.ticketBatches?.length ? epic.ticketBatches : (existing?.data?.ticketBatches ?? []),
        graphNotes: epic.graphNotes?.length ? epic.graphNotes : (existing?.data?.graphNotes ?? [])
      }
    });
    importedEpicIds.add(epic.id);
    importedEpics += 1;
  }

  pruneProjectionImportedEntities(store, {
    entityType: "ticket",
    keepIds: importedTicketIds
  });
  pruneProjectionImportedEntities(store, {
    entityType: "epic",
    keepIds: importedEpicIds
  });

  return {
    importedTickets,
    importedEpics,
    skipped: false
  };
}

export function buildTicketEntity({ id, title, lane = "Todo", state = "open", epicId = null, summary = "", userStory = null }) {
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
      summary,
      userStory: userStory ?? null
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
      `${entity.id} ${entity.title}`,
      JSON.stringify({
        ...entity.data,
        id: entity.id,
        lane: entity.lane,
        state: entity.state,
        parentId: entity.parentId
      }),
      [entity.entityType, entity.id, entity.lane ?? "", entity.state, entity.parentId ?? ""].filter(Boolean).join(","),
      entity.updatedAt
    );
  }
}

async function selectProjectionSource(projectRoot, candidates, scorer, { lastProjectionDigest = null } = {}) {
  let best = { path: candidates[0], text: "", score: -1 };
  for (const relativePath of candidates) {
    const text = await readText(path.resolve(projectRoot, relativePath), "");
    if (lastProjectionDigest && shouldSkipGeneratedProjection(relativePath, text, lastProjectionDigest)) {
      continue;
    }

    const score = scorer(text);
    if (score > best.score) {
      best = { path: relativePath, text, score };
    }
  }
  return best;
}

function shouldSkipGeneratedProjection(relativePath, text, lastProjectionDigest) {
  const normalized = String(relativePath ?? "").replace(/\\/g, "/").toLowerCase();
  const digestKey = normalized.endsWith("kanban.md")
    ? "kanban"
    : normalized.endsWith("epics.md")
      ? "epics"
      : null;
  if (!digestKey || !lastProjectionDigest?.[digestKey]) {
    return false;
  }

  return sha1(text) === String(lastProjectionDigest[digestKey]);
}

function countKanbanTickets(text) {
  return text.split(/\r?\n/).filter((line) => Boolean(parseKanbanTicketLine(line))).length;
}

function countEpicEntries(text) {
  return parseEpicEntries(text).length;
}

function parseKanbanTicketLine(line) {
  const match = line.match(/^- \[([ xX])\]\s+(?:(?:\*\*)?(\d{4}-\d{2}-\d{2})\s+)?(?:\*\*)?([A-Z][A-Z0-9-]+)(?:\*\*)?:\s+(.+)$/)
    ?? line.match(/^- \[([ xX])\]\s+([A-Z][A-Z0-9-]+)\s+(.+)$/);
  if (!match) {
    return null;
  }

  if (match.length === 4) {
    return {
      checked: /[xX]/.test(match[1]),
      completedAt: null,
      ticketId: match[2],
      title: match[3].trim()
    };
  }

  return {
    checked: /[xX]/.test(match[1]),
    completedAt: match[2] ?? null,
    ticketId: match[3],
    title: match[4].trim()
  };
}

function normalizeLaneName(name) {
  const key = String(name).trim().toLowerCase();
  const aliases = new Map([
    ["todo", "Todo"],
    ["to-do", "Todo"],
    ["todoo", "Todo"],
    ["backlog", "Backlog"],
    ["deep backlog", "Deep Backlog"],
    ["in progress", "In Progress"],
    ["priority 1 bugs", "Bugs P1"],
    ["bugs p1", "Bugs P1"],
    ["priority 2/3 bugs", "Bugs P2/P3"],
    ["bugs p2/p3", "Bugs P2/P3"],
    ["human testing", "Human Testing"],
    ["human inspection", "Human Testing"],
    ["suggestions", "Suggestions"],
    ["done", "Done"],
    ["archived", "Archived"]
  ]);
  return aliases.get(key) ?? name;
}

function normalizeDisplayLaneName(name) {
  const key = String(name).trim().toLowerCase();
  const aliases = new Map([
    ["todo", "ToDo"],
    ["to-do", "ToDo"],
    ["todoo", "ToDo"],
    ["backlog", "Backlog"],
    ["deep backlog", "Deep Backlog"],
    ["in progress", "In Progress"],
    ["priority 1 bugs", "Bugs P1"],
    ["bugs p1", "Bugs P1"],
    ["priority 2/3 bugs", "Bugs P2/P3"],
    ["bugs p2/p3", "Bugs P2/P3"],
    ["human testing", "Human Inspection"],
    ["human inspection", "Human Inspection"],
    ["suggestions", "Suggestions"],
    ["done", "Done"],
    ["archived", "Archived"]
  ]);
  return aliases.get(key) ?? name;
}

function normalizeTicketFieldName(label) {
  return String(label).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function parseEpicEntries(text) {
  const entries = [];
  let current = null;
  let currentSection = null;

  function flushCurrentStory() {
    if (current?.currentStory) {
      current.userStories.push(mergeEpicStory(current.currentStory));
      current.currentStory = null;
    }
  }

  for (const line of text.split(/\r?\n/)) {
    const explicit = line.match(/^##\s+([A-Z][A-Z0-9-]+)\s+(.+)$/);
    if (explicit) {
      if (current) entries.push(current);
      current = {
        id: explicit[1],
        title: explicit[2].trim(),
        state: "open",
        summary: "",
        userStories: [],
        ticketBatches: [],
        graphNotes: []
      };
      currentSection = null;
      continue;
    }

    const numbered = line.match(/^##\s+\d+\.\s+(.+?)(?:\s+\((ACTIVE|DONE|ARCHIVED)\))?$/i);
    if (numbered) {
      if (current) entries.push(current);
      const title = numbered[1].trim();
      current = {
        id: `EPIC-${slugify(title).toUpperCase()}`,
        title,
        state: normalizeEpicState(numbered[2]),
        summary: "",
        userStories: [],
        ticketBatches: [],
        graphNotes: []
      };
      currentSection = null;
      continue;
    }

    if (!current) {
      continue;
    }

    const field = line.match(/^\s*-\s+(Goal|Summary|State|User stories?|Stories|Ticket batches|Kanban tickets)\s*:\s*(.*)$/i);
    if (field) {
      currentSection = null;
      const label = field[1].toLowerCase();
      const value = field[2].trim();
      if (label === "goal" || label === "summary") {
        flushCurrentStory();
        current.summary = value || current.summary;
        continue;
      }
      if (label === "state") {
        current.state = normalizeEpicState(value);
        continue;
      }
      if (label === "user stories" || label === "stories") {
        flushCurrentStory();
        currentSection = "userStories";
        if (value) current.userStories.push(value);
        continue;
      }
      if (label === "ticket batches") {
        flushCurrentStory();
        currentSection = "ticketBatches";
        if (value) current.ticketBatches.push(value);
        continue;
      }
      if (label === "kanban tickets") {
        flushCurrentStory();
        currentSection = "linkedTickets";
        continue;
      }
    }

    const subheading = line.match(/^\s{0,3}#{3,4}\s+(.+)$/);
    if (subheading) {
      const label = subheading[1].trim();
      if (/^goal$/i.test(label)) {
        flushCurrentStory();
        currentSection = "goal";
        continue;
      }
      if (/^user stories?$/i.test(label) || /^stories$/i.test(label)) {
        flushCurrentStory();
        currentSection = "userStories";
        current.currentStory = null;
        continue;
      }
      if (/^ticket batches$/i.test(label)) {
        flushCurrentStory();
        currentSection = "ticketBatches";
        current.currentStory = null;
        continue;
      }
      if (/^kanban tickets$/i.test(label)) {
        flushCurrentStory();
        currentSection = "linkedTickets";
        current.currentStory = null;
        continue;
      }
      if (currentSection === "userStories") {
        if (current.currentStory) {
          current.userStories.push(mergeEpicStory(current.currentStory));
        }
        current.currentStory = {
          heading: label,
          bodyLines: []
        };
        continue;
      }
    }

    const bullet = line.match(/^\s*-\s+(.+)$/);
    if (bullet && currentSection) {
      const value = bullet[1].trim();
      if (!value) {
        continue;
      }
      if (currentSection === "userStories") {
        if (current.currentStory) {
          current.currentStory.bodyLines.push(value);
        } else {
          current.currentStory = {
            heading: null,
            bodyLines: [value]
          };
        }
        continue;
      }
      if (currentSection === "ticketBatches") {
        current.ticketBatches.push(value);
        continue;
      }
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      if (currentSection === "userStories" && current.currentStory) {
        current.currentStory.bodyLines.push("");
      } else if (currentSection === "goal") {
        current.goalLines = current.goalLines ?? [];
        current.goalLines.push("");
      }
      continue;
    }

    if (/^###\s+/.test(trimmed) || /^####\s+/.test(trimmed)) {
      continue;
    }

    if (currentSection === "goal") {
      current.goalLines = current.goalLines ?? [];
      current.goalLines.push(trimmed);
      continue;
    }

    if (currentSection === "userStories") {
      if (!current.currentStory) {
        current.currentStory = {
          heading: null,
          bodyLines: []
        };
      }
      current.currentStory.bodyLines.push(trimmed);
      continue;
    }

    if (currentSection === "ticketBatches") {
      current.ticketBatches.push(trimmed);
      continue;
    }

    if (current.summary === "" && !trimmed.startsWith("-")) {
      current.summary = trimmed;
    }
  }

  flushCurrentStory();

  if (current && Array.isArray(current.goalLines) && current.goalLines.length) {
    current.summary = current.goalLines.join("\n").trim() || current.summary;
  }

  if (current) {
    entries.push(current);
  }
  return entries;
}

function normalizeEpicSummary(epic) {
  return String(epic.data?.summary ?? "").trim();
}

function preferNonEmpty(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return fallback;
  }
  if (normalized.toLowerCase() === "pending natural-language scope.") {
    return fallback;
  }
  return normalized;
}

function normalizeEpicStories(epic) {
  const stories = Array.isArray(epic.data?.userStories)
    ? epic.data.userStories
    : Array.isArray(epic.data?.stories)
      ? epic.data.stories
      : [];

  return stories.map((story) => String(story ?? "").trim()).filter(Boolean);
}

function normalizeEpicTicketBatches(epic) {
  const batches = Array.isArray(epic.data?.ticketBatches)
    ? epic.data.ticketBatches
    : Array.isArray(epic.data?.batches)
      ? epic.data.batches
      : [];
  return batches.map((batch) => String(batch ?? "").trim()).filter(Boolean);
}

export function compareEpicPriority(a, b) {
  const priorityA = a.data?.priority === "first" ? 0 : 1;
  const priorityB = b.data?.priority === "first" ? 0 : 1;
  if (priorityA !== priorityB) {
    return priorityA - priorityB;
  }

  const numberA = extractEpicNumber(a.id);
  const numberB = extractEpicNumber(b.id);
  if (numberA !== numberB) {
    return numberA - numberB;
  }

  return String(a.id).localeCompare(String(b.id));
}

function extractEpicNumber(id) {
  const match = String(id).match(/(\d+)/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function normalizeEpicState(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "done" || normalized === "archived") {
    return "archived";
  }
  return "open";
}

function slugify(value) {
  return String(value).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "UNTITLED";
}

function mergeEpicStory(story) {
  const heading = String(story?.heading ?? "").trim();
  const body = story?.bodyLines?.join("\n").trim() ?? "";
  return [heading, body].filter(Boolean).join("\n").trim();
}

function pruneProjectionImportedEntities(store, { entityType, keepIds }) {
  const ids = [...keepIds];
  if (!ids.length) {
    store.db.prepare("DELETE FROM search_index WHERE scope = 'entity' AND ref_id IN (SELECT id FROM entities WHERE entity_type = ? AND source_kind = 'projection-import')").run(entityType);
    store.db.prepare("DELETE FROM entities WHERE entity_type = ? AND source_kind = 'projection-import'").run(entityType);
    return;
  }

  const placeholders = ids.map(() => "?").join(", ");
  store.db.prepare(`
    DELETE FROM search_index
    WHERE scope = 'entity'
      AND ref_id IN (
        SELECT id
        FROM entities
        WHERE entity_type = ?
          AND source_kind = 'projection-import'
          AND id NOT IN (${placeholders})
      )
  `).run(entityType, ...ids);
  store.db.prepare(`
    DELETE FROM entities
    WHERE entity_type = ?
      AND source_kind = 'projection-import'
      AND id NOT IN (${placeholders})
  `).run(entityType, ...ids);
}
