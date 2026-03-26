const NOTE_TYPES = ["TODO", "FIXME", "HACK", "BUG", "RISK", "NOTE"];

export function countLineColumn(source, offset) {
  const slice = source.slice(0, Math.max(0, offset));
  const lines = slice.split("\n");
  return {
    line: lines.length,
    column: lines.at(-1).length + 1
  };
}

export function extractTaggedNotes(source, { commentPattern, filePath }) {
  const notes = [];
  for (const match of source.matchAll(commentPattern)) {
    const body = Array.from(match).slice(1).find((item) => typeof item === "string" && item.trim()) ?? match[0] ?? "";
    const note = parseTaggedNote(body);
    if (!note) {
      continue;
    }
    const location = countLineColumn(source, match.index ?? 0);
    notes.push({
      ...note,
      filePath,
      line: location.line,
      column: location.column
    });
  }
  return notes;
}

export function parseTaggedNote(text) {
  const normalized = String(text).replace(/\s+/g, " ").trim();
  const match = normalized.match(new RegExp(
    `^(?:[-*]\\s+)?(?:\\[\\s*(${NOTE_TYPES.join("|")})\\s*\\]|(${NOTE_TYPES.join("|")}))(?::|-)?\\s+(.+)$`,
    "i"
  ));
  if (!match) {
    return null;
  }
  return {
    noteType: String(match[1] ?? match[2]).toUpperCase(),
    body: match[3].trim()
  };
}

export function scoreNote(note) {
  const baseScores = {
    BUG: 0.95, FIXME: 0.85, RISK: 0.82, HACK: 0.66, TODO: 0.58, NOTE: 0.34
  };
  const body = String(note.body ?? "").toLowerCase();
  
  // Semantic Density Analysis
  const criticalTokens = ["security", "race", "leak", "corrupt", "inconsistent", "crash", "break", "wrong", "unsafe", "fatal", "missing"];
  const density = criticalTokens.filter(t => body.includes(t)).length / criticalTokens.length;
  
  const riskHints = density > 0 ? 0.2 + (density * 0.5) : 0;
  const leverageHints = /(shared|router|workflow|schema|migration|cache|index|reusable|provider|core)/.test(body) ? 0.16 : 0;
  const valueHints = /(cleanup|follow[- ]up|ticket|later|before shipping|needs test|needs audit|perfection)/.test(body) ? 0.12 : 0;
  
  // Entity Linking (RAG-002)
  const ticketMatch = body.match(/\b([A-Z]+-\d+)\b/);
  const isLinked = !!ticketMatch;

  const riskScore = Math.min(1, (baseScores[note.noteType] ?? 0.25) + riskHints);
  const leverageScore = Math.min(1, 0.3 + leverageHints + (note.filePath?.includes("core/") ? 0.18 : 0));
  const ticketValueScore = Math.min(1, 0.25 + valueHints + (isLinked ? 0.2 : 0));
  const candidateScore = Number(((riskScore * 0.45) + (leverageScore * 0.25) + (ticketValueScore * 0.3)).toFixed(3));

  return {
    riskScore: Number(riskScore.toFixed(3)),
    leverageScore: Number(leverageScore.toFixed(3)),
    ticketValueScore: Number(ticketValueScore.toFixed(3)),
    candidateScore,
    linkedTicketId: ticketMatch ? ticketMatch[1] : null
  };
}

export function buildCandidateTitle(note) {
  const raw = String(note.body ?? "").replace(/[.]+$/, "").trim();
  if (!raw) {
    return `Follow up ${note.noteType.toLowerCase()}`;
  }
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}
