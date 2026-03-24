import { getProjectSummary } from "./sync.mjs";

export async function buildTelegramPreview({ projectRoot = process.cwd() } = {}) {
  const summary = await getProjectSummary({ projectRoot });
  const lines = [
    "AI Workflow Status",
    `Files indexed: ${summary.fileCount}`,
    `Symbols indexed: ${summary.symbolCount}`,
    `Notes tracked: ${summary.noteCount}`,
    `Tickets: ${summary.activeTickets.length}`,
    `Candidates: ${summary.candidates.length}`
  ];

  if (summary.activeTickets.length) {
    lines.push("");
    lines.push("Active tickets");
    for (const ticket of summary.activeTickets.slice(0, 5)) {
      lines.push(`- ${ticket.id} [${ticket.lane ?? "Todo"}] ${ticket.title}`);
    }
  }

  if (summary.candidates.length) {
    lines.push("");
    lines.push("Candidate triage");
    for (const candidate of summary.candidates.slice(0, 5)) {
      lines.push(`- ${candidate.status} ${candidate.title} (${candidate.score})`);
    }
  }

  return {
    text: `${lines.join("\n")}\n`,
    summary
  };
}

export function parseTelegramCommand(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed.startsWith("/")) {
    return { command: "unknown", args: [] };
  }
  const [command, ...args] = trimmed.slice(1).split(/\s+/);
  return {
    command,
    args
  };
}
