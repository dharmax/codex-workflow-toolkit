import { compactWhitespace } from "./markdown-utils.mjs";

const TICKET_ID_RE = /\b([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\b/;

export function parseKanbanDocument(markdown) {
  const lines = String(markdown).replace(/\r\n/g, "\n").split("\n");
  const settingsStart = lines.findIndex((line) => /^%%\s*kanban:settings\s*$/i.test(line.trim()));
  const contentEnd = settingsStart >= 0 ? settingsStart - 1 : lines.length - 1;
  const sections = [];
  let prefixLines = [];
  let suffixLines = settingsStart >= 0 ? lines.slice(settingsStart) : [];
  let current = null;

  for (let index = 0; index <= contentEnd; index += 1) {
    const match = lines[index].match(/^##\s+(.+)$/);
    if (!match) {
      continue;
    }

    if (current) {
      current.endLine = index - 1;
      finalizeSection(current, lines);
      sections.push(current);
    }

    if (!sections.length && !current) {
      prefixLines = trimBlankLines(lines.slice(0, index));
    }

    current = {
      name: compactWhitespace(match[1]),
      headingLine: index,
      endLine: lines.length - 1
    };
  }

  if (current) {
    current.endLine = contentEnd;
    finalizeSection(current, lines);
    sections.push(current);
  }

  return { lines, prefixLines, suffixLines: trimBlankLines(suffixLines), sections };
}

export function findSection(document, name) {
  return document.sections.find((section) => section.name === name) ?? null;
}

export function findTicketById(document, ticketId) {
  const query = String(ticketId).toLowerCase();

  for (const section of document.sections) {
    const ticket = section.tickets.find((entry) => entry.id?.toLowerCase() === query);
    if (ticket) {
      return { section, ticket };
    }
  }

  return null;
}

export function moveTicket(document, ticketId, targetSectionName, options = {}) {
  const source = findTicketById(document, ticketId);
  if (!source) {
    throw new Error(`Ticket ${ticketId} not found in kanban.md`);
  }

  const targetSection = findSection(document, targetSectionName);
  if (!targetSection) {
    throw new Error(`Section not found in kanban.md: ${targetSectionName}`);
  }

  const currentTicket = source.ticket;
  const updatedTicket = {
    ...currentTicket,
    lines: rewriteTicketMetadata(currentTicket.lines, {
      fromSection: source.section.name,
      toSection: targetSection.name,
      doneDate: options.doneDate ?? null
    })
  };

  source.section.tickets = source.section.tickets.filter((entry) => entry !== currentTicket);
  targetSection.tickets = [...targetSection.tickets, updatedTicket];

  return {
    from: source.section.name,
    to: targetSection.name,
    ticket: {
      id: updatedTicket.id,
      heading: updatedTicket.heading
    }
  };
}

export function createTicket(document, input) {
  const targetSection = findSection(document, input.section);
  if (!targetSection) {
    throw new Error(`Section not found in kanban.md: ${input.section}`);
  }

  const ticketId = compactWhitespace(String(input.id ?? ""));
  const title = compactWhitespace(String(input.title ?? ""));

  if (!ticketId || !title) {
    throw new Error("Ticket id and title are required");
  }

  if (findTicketById(document, ticketId)) {
    throw new Error(`Ticket ${ticketId} already exists in kanban.md`);
  }

  const lines = buildTicketLines({
    id: ticketId,
    title,
    section: targetSection.name,
    outcome: input.outcome,
    scope: input.scope,
    verification: input.verification,
    notes: input.notes,
    epic: input.epic,
    doneDate: input.doneDate
  });

  targetSection.tickets = [
    ...targetSection.tickets,
    {
      heading: `${ticketId} ${title}`,
      id: ticketId,
      lines
    }
  ];

  return {
    section: targetSection.name,
    ticket: {
      id: ticketId,
      heading: `${ticketId} ${title}`
    }
  };
}

export function getNextTicket(document, options = {}) {
  const priorities = options.priorities?.length
    ? options.priorities
    : ["Bugs P1", "ToDo", "Bugs P2/P3", "In Progress", "Human Inspection", "Backlog", "Deep Backlog", "Suggestions", "Done"];

  for (const lane of priorities) {
    const section = findSection(document, lane);
    if (!section || !section.tickets.length) {
      continue;
    }

    const ticket = section.tickets[0];
    return {
      section: section.name,
      ticket: {
        id: ticket.id,
        heading: ticket.heading,
        body: trimTicketBody(ticket.lines.slice(1))
      }
    };
  }

  return null;
}

export function archiveOldDoneTickets(document, archiveMarkdown, options = {}) {
  const olderThanDays = Number(options.olderThanDays ?? 7);
  const today = options.today ?? new Date();
  const doneSection = findSection(document, "Done");

  if (!doneSection) {
    throw new Error('Section not found in kanban.md: Done');
  }

  const archived = [];
  const kept = [];

  for (const ticket of doneSection.tickets) {
    const doneDate = extractDoneDate(ticket.lines);
    if (!doneDate) {
      kept.push(ticket);
      continue;
    }

    const ageDays = diffDays(today, doneDate);
    if (ageDays <= olderThanDays) {
      kept.push(ticket);
      continue;
    }

    archived.push({
      ...ticket,
      doneDate
    });
  }

  doneSection.tickets = kept;

  if (!archived.length) {
    return {
      kanbanMarkdown: renderKanbanDocument(document),
      archiveMarkdown,
      archived: []
    };
  }

  let nextArchive = String(archiveMarkdown ?? "").trimEnd();
  if (!nextArchive) {
    nextArchive = "# Kanban Archive";
  }

  for (const ticket of archived) {
    nextArchive = appendArchivedTicket(nextArchive, ticket);
  }

  return {
    kanbanMarkdown: renderKanbanDocument(document),
    archiveMarkdown: `${nextArchive.trimEnd()}\n`,
    archived: archived.map((ticket) => ({
      id: ticket.id,
      heading: ticket.heading,
      doneDate: ticket.doneDate
    }))
  };
}

export function renderKanbanDocument(document) {
  const parts = [];

  if (document.prefixLines?.length) {
    parts.push(...trimBlankLines(document.prefixLines));
    parts.push("");
  }

  for (const section of document.sections) {
    parts.push(`## ${section.name}`);

    const intro = trimBlankLines(section.introLines);
    if (intro.length) {
      parts.push("");
      parts.push(...intro);
    }

    for (const ticket of section.tickets) {
      parts.push("");
      parts.push(...trimBlankLines(ticket.lines));
    }

    parts.push("");
  }

  if (document.suffixLines?.length) {
    parts.push(...trimBlankLines(document.suffixLines));
    parts.push("");
  }

  return `${parts.join("\n").trimEnd()}\n`;
}

function finalizeSection(section, lines) {
  const bodyStart = section.headingLine + 1;
  const bodyEnd = section.endLine;
  const bodyLines = lines.slice(bodyStart, bodyEnd + 1);
  const tickets = [];
  let introEnd = bodyLines.length;
  let current = null;

  for (let index = 0; index < bodyLines.length; index += 1) {
    const line = bodyLines[index];
    const ticketMatch = line.match(/^- \[( |x|X)\]\s+(.+)$/);

    if (!ticketMatch) {
      continue;
    }

    if (current) {
      current.end = index - 1;
      current.lines = trimBlankLines(bodyLines.slice(current.start, current.end + 1));
      tickets.push(current);
    } else {
      introEnd = index;
    }

    const heading = compactWhitespace(stripDoneMarker(ticketMatch[2]));
    current = {
      start: index,
      end: bodyLines.length - 1,
      heading,
      id: extractTicketId(heading),
      lines: []
    };
  }

  if (current) {
    current.lines = trimBlankLines(bodyLines.slice(current.start, current.end + 1));
    tickets.push(current);
  }

  section.introLines = trimBlankLines(bodyLines.slice(0, introEnd));
  section.tickets = tickets;
}

function rewriteTicketMetadata(lines, options) {
  const nextLines = [...lines];
  const toDone = options.toSection === "Done";
  const firstLine = nextLines[0] ?? "";
  const taskMatch = firstLine.match(/^- \[( |x|X)\]\s+(.+)$/);
  if (!taskMatch) {
    return trimBlankLines(nextLines);
  }

  const rawHeading = stripDoneMarker(taskMatch[2]);
  nextLines[0] = toDone
    ? `- [x] ${rawHeading} ✅ ${options.doneDate ?? formatDate(new Date())}`
    : `- [ ] ${rawHeading}`;

  return trimBlankLines(nextLines);
}

function buildTicketLines(input) {
  const firstLine = input.section === "Done"
    ? `- [x] ${input.id} ${input.title} ✅ ${input.doneDate ?? formatDate(new Date())}`
    : `- [ ] ${input.id} ${input.title}`;

  const lines = [firstLine];

  if (input.outcome) {
    lines.push(`  - Outcome: ${compactWhitespace(String(input.outcome))}`);
  }

  if (input.scope) {
    lines.push(`  - Scope: ${compactWhitespace(String(input.scope))}`);
  }

  if (input.verification) {
    lines.push(`  - Verification: ${compactWhitespace(String(input.verification))}`);
  }

  if (input.notes) {
    lines.push(`  - Notes: ${compactWhitespace(String(input.notes))}`);
  }

  if (input.section === "Deep Backlog" && input.epic) {
    lines.push(`  - Epic: ${compactWhitespace(String(input.epic))}`);
  }

  return lines;
}

function appendArchivedTicket(archiveMarkdown, ticket) {
  const monthHeading = `## ${ticket.doneDate.slice(0, 7)}`;
  const block = trimBlankLines(ticket.lines).join("\n");

  if (!archiveMarkdown.includes(monthHeading)) {
    return `${archiveMarkdown.trimEnd()}\n\n${monthHeading}\n\n${block}\n`;
  }

  const lines = archiveMarkdown.replace(/\r\n/g, "\n").split("\n");
  const sectionIndexes = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^##\s+(.+)$/);
    if (match) {
      sectionIndexes.push({ name: compactWhitespace(match[1]), index });
    }
  }

  const currentIndex = sectionIndexes.find((entry) => entry.name === ticket.doneDate.slice(0, 7));
  const nextIndex = sectionIndexes.find((entry) => entry.index > currentIndex.index);
  const insertAt = nextIndex ? nextIndex.index : lines.length;
  const before = lines.slice(0, insertAt).join("\n").trimEnd();
  const after = lines.slice(insertAt).join("\n").trimStart();
  const middle = `${block}\n`;

  if (!after) {
    return `${before}\n\n${middle}`;
  }

  return `${before}\n\n${middle}\n${after}`;
}

function extractTicketId(heading) {
  const match = heading.match(TICKET_ID_RE);
  return match ? match[1] : null;
}

function extractDoneDate(lines) {
  const line = lines[0] ?? "";
  if (!line) {
    return null;
  }

  const match = line.match(/✅\s*(\d{4}-\d{2}-\d{2})/i);
  return match ? match[1] : null;
}

function diffDays(today, dateValue) {
  const target = new Date(`${dateValue}T00:00:00Z`);
  const current = new Date(today);
  const currentUtc = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate());
  return Math.floor((currentUtc - target.getTime()) / 86400000);
}

function trimBlankLines(lines) {
  const next = [...lines];

  while (next.length && !next[0].trim()) {
    next.shift();
  }

  while (next.length && !next.at(-1).trim()) {
    next.pop();
  }

  return next;
}

function trimTicketBody(lines) {
  return lines
    .map((line) => line.replace(/^ {2}/, ""))
    .join("\n")
    .trimEnd();
}

function formatDate(value) {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function stripDoneMarker(value) {
  return compactWhitespace(String(value).replace(/\s+✅\s+\d{4}-\d{2}-\d{2}\s*$/i, ""));
}
