import { compactWhitespace } from "./markdown-utils.mjs";

export function parseKanban(markdown) {
  const lines = markdown.split(/\r?\n/);
  const tickets = [];
  const sections = [];
  let currentSection = "Unsectioned";
  let currentTicket = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const sectionMatch = line.match(/^##\s+(.+)$/);

    if (sectionMatch) {
      pushTicket(tickets, currentTicket);
      currentTicket = null;
      currentSection = compactWhitespace(sectionMatch[1]);
      sections.push({ name: currentSection, line: index + 1 });
      continue;
    }

    const ticketMatch = line.match(/^###\s+(.+)$/);

    if (ticketMatch) {
      pushTicket(tickets, currentTicket);
      const heading = compactWhitespace(ticketMatch[1]);
      const id = extractTicketId(heading);
      const title = compactWhitespace(heading.replace(/\[?[A-Z][A-Z0-9]+-\d+\]?/, "").replace(/^[-:]\s*/, ""));
      currentTicket = {
        id,
        title: title || heading,
        heading,
        section: currentSection,
        line: index + 1,
        bodyLines: []
      };
      continue;
    }

    if (currentTicket) {
      currentTicket.bodyLines.push(line);
    }
  }

  pushTicket(tickets, currentTicket);
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
  const match = heading.match(/\b([A-Z][A-Z0-9]+-\d+)\b/);
  return match ? match[1] : null;
}

function pushTicket(tickets, ticket) {
  if (!ticket) {
    return;
  }

  ticket.body = ticket.bodyLines.join("\n").trimEnd();
  delete ticket.bodyLines;
  tickets.push(ticket);
}

