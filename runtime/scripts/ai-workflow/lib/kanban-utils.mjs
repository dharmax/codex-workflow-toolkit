import { compactWhitespace } from "./markdown-utils.mjs";
import { parseKanbanDocument } from "./kanban-edit-utils.mjs";

const TICKET_ID_RE = /\b([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\b/;
const TICKET_ID_MARKUP_RE = /\*\*[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+\*\*|\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+\b/;

export function parseKanban(markdown) {
  const document = parseKanbanDocument(markdown);
  const sections = document.sections.map((section) => ({
    name: section.name,
    line: section.headingLine + 1
  }));
  const tickets = [];

  for (const section of document.sections) {
    for (const ticket of section.tickets) {
      const lead = parseTaskLead(ticket.lines[0] ?? "");
      const title = compactWhitespace(ticket.heading.replace(TICKET_ID_MARKUP_RE, "").replace(/^[-:]\s*/, ""));
      tickets.push({
        id: ticket.id,
        title: title || ticket.heading,
        heading: ticket.heading,
        section: section.name,
        line: section.headingLine + 1 + ticket.start + 1,
        doneDate: lead.doneDate,
        body: trimTicketBody(ticket.lines.slice(1))
      });
    }
  }

  return { sections, tickets };
}

export function findTicket(parsed, { id, section }) {
  if (id) {
    return parsed.tickets.find((ticket) => ticket.id?.toLowerCase() === String(id).toLowerCase()) ?? null;
  }

  if (section) {
    return parsed.tickets.find((ticket) => ticket.section.toLowerCase() === String(section).toLowerCase()) ?? null;
  }

  return null;
}

export function renderTicket(ticket) {
  const body = ticket.body?.trim() ? `\n\n${ticket.body.trim()}` : "";
  return `${ticket.id ?? "NO-ID"} | ${ticket.section} | ${ticket.title}${body}`;
}

function extractTicketId(heading) {
  const match = heading.match(TICKET_ID_RE);
  return match ? match[1] : null;
}

function trimTicketBody(lines) {
  return lines
    .map((line) => line.replace(/^ {2}/, ""))
    .join("\n")
    .trimEnd();
}

function parseTaskLead(line) {
  const match = String(line).match(/^- \[( |x|X)\]\s+(.+?)(?:\s+✅\s+(\d{4}-\d{2}-\d{2}))?\s*$/);
  return {
    doneDate: match?.[3] ?? null
  };
}
