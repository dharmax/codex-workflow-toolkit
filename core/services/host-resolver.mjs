import { evaluateProjectReadiness, getProjectSummary } from "./sync.mjs";
import path from "node:path";
import { readFile } from "node:fs/promises";

const CURRENT_WORK_RE = /\b(working on right now|working on now|what are we working on|what were working on|current work|current focus|in progress right now|currently in progress)\b/i;
const READINESS_RE = /\b(ready|readiness|before beta|before release|for beta|for release|for handoff)\b/i;
const STATUS_RE = /\b(project status|what'?s the project status|what is the project status|overall status|how ready)\b/i;

export async function resolveHostRequest({
  projectRoot = process.cwd(),
  text,
  continuationState = null,
  host = {}
} = {}) {
  const normalizedText = String(text ?? "").trim();
  if (!normalizedText) {
    return {
      status: "blocked",
      route: {
        intent: "unknown",
        operation: null,
        reason: "Host request text is required."
      },
      response_type: "reply",
      payload: {
        summary: "No request text was provided.",
        recommended_next_actions: ["Send a natural-language project question such as 'is this ready for beta testing?'."]
      }
    };
  }

  const readinessGoal = extractReadinessGoal(normalizedText);
  if (readinessGoal) {
    const summary = await getProjectSummary({ projectRoot });
    const payload = await evaluateProjectReadiness({
      projectRoot,
      request: {
        protocol_version: "1.0",
        operation: "evaluate_readiness",
        goal: {
          type: readinessGoal.type,
          target: "project",
          question: normalizedText
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
          surface: String(host.surface ?? "host"),
          capabilities: {
            supports_json: host.capabilities?.supports_json !== false,
            supports_streaming: Boolean(host.capabilities?.supports_streaming),
            supports_followups: host.capabilities?.supports_followups !== false
          }
        },
        continuation_state: continuationState
      }
    });

    if (STATUS_RE.test(normalizedText)) {
      const focusTickets = rankActiveTickets(summary.activeTickets).slice(0, 3);
      return {
        status: payload.status,
        route: {
          intent: "status_and_readiness",
          operation: "project_summary+evaluate_readiness",
          reason: "Natural-language status and readiness question routed to project summary plus the shared readiness evaluator."
        },
        response_type: "composite",
        payload: {
          summary: `Project status and ${formatGoalLabel(readinessGoal.type)} are available.`,
          project_status: {
            active_ticket_count: summary.activeTickets.length,
            candidate_count: Number(summary.candidateCount ?? 0),
            note_count: summary.noteCount,
            focus_tickets: focusTickets
          },
          readiness: payload,
          recommended_next_actions: Array.isArray(payload.recommended_next_actions) ? payload.recommended_next_actions : []
        }
      };
    }

    return {
      status: payload.status,
      route: {
        intent: "readiness_question",
        operation: "evaluate_readiness",
        reason: "Natural-language readiness question routed to the shared readiness evaluator."
      },
      response_type: "protocol",
      payload
    };
  }

  if (CURRENT_WORK_RE.test(normalizedText)) {
    const summary = await getProjectSummary({ projectRoot });
    const boardTickets = await discoverBoardCurrentWork(projectRoot);
    const inProgress = summary.activeTickets.filter((ticket) => ticket.lane === "In Progress");
    const active = boardTickets.length
      ? boardTickets
      : inProgress.length
        ? inProgress
        : rankActiveTickets(summary.activeTickets).slice(0, 3);
    const lines = active.length
      ? active.map((ticket) => `- [${ticket.lane}] ${ticket.id}: ${ticket.title}`)
      : ["- No active tickets found."];

    return {
      status: "complete",
      route: {
        intent: "current_work",
        operation: "project_summary",
        reason: "Natural-language current-work question routed to project summary."
      },
      response_type: "summary",
      payload: {
        summary: active.length
          ? `Current work centers on ${active[0].id}${active.length > 1 ? " and related active tickets" : ""}.`
          : "No active work was found in the workflow DB.",
        active_tickets: active,
        answer: ["Current work:", ...lines].join("\n"),
        recommended_next_actions: active.length
          ? ["Inspect the leading in-progress ticket before planning more work."]
          : ["Run ai-workflow sync if the DB may be stale."]
      }
    };
  }

  const summary = await getProjectSummary({ projectRoot });
  return {
    status: "complete",
    route: {
      intent: "broad_project_question",
      operation: "project_summary",
      reason: "No narrower host operation matched, so the request fell back to project summary."
    },
    response_type: "summary",
    payload: {
      summary: `Project summary for ${projectRoot}.`,
      active_ticket_count: summary.activeTickets.length,
      active_tickets: summary.activeTickets.slice(0, 5),
      answer: renderBroadSummary(summary),
      recommended_next_actions: ["Ask a narrower question like 'is this ready for beta testing?' or 'what are we working on right now?'."]
    }
  };
}

function formatGoalLabel(goalType) {
  if (goalType === "release_readiness") return "release readiness";
  if (goalType === "handoff_readiness") return "handoff readiness";
  return "beta readiness";
}

async function discoverBoardCurrentWork(projectRoot) {
  for (const relativePath of ["docs/kanban.md", "kanban.md"]) {
    try {
      const content = await readFile(path.resolve(projectRoot, relativePath), "utf8");
      const section = extractKanbanSection(content, "In Progress");
      const tickets = parseKanbanTickets(section).map((ticket) => ({
        ...ticket,
        lane: "In Progress",
        source_path: relativePath
      }));
      if (tickets.length) {
        return tickets;
      }
    } catch {
      // ignore missing board files
    }
  }
  return [];
}

function extractKanbanSection(content, heading) {
  const lines = String(content ?? "").split(/\r?\n/);
  const target = `## ${heading}`.toLowerCase();
  const startIndex = lines.findIndex((line) => line.trim().toLowerCase() === target);
  if (startIndex === -1) return "";
  const collected = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^##\s+/.test(line.trim())) break;
    collected.push(line);
  }
  return collected.join("\n");
}

function parseKanbanTickets(section) {
  return String(section ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => line.match(/^- \[[ xX]\]\s+\**([A-Z]+-[A-Z0-9-]+)\**:?\s*(.+)$/))
    .filter(Boolean)
    .map((match) => ({
      id: match[1],
      title: match[2].replace(/\*\*/g, "").trim()
    }));
}

function rankActiveTickets(tickets = []) {
  const order = new Map([
    ["In Progress", 0],
    ["Bugs P1", 1],
    ["Human Inspection", 2],
    ["Todo", 3],
    ["Bugs P2/P3", 4],
    ["Risk Watch", 5],
    ["Backlog", 6],
    ["Deep Backlog", 7]
  ]);
  return tickets
    .slice()
    .sort((left, right) => {
      const leftRank = order.get(left.lane) ?? 99;
      const rightRank = order.get(right.lane) ?? 99;
      return leftRank - rightRank || String(left.id).localeCompare(String(right.id));
    });
}

function extractReadinessGoal(text) {
  const source = String(text ?? "").trim();
  if (!source || !READINESS_RE.test(source)) {
    return null;
  }
  const normalized = source.toLowerCase();
  if (!/\b(beta|release|handoff)\b/.test(normalized)) {
    return null;
  }
  return {
    type: normalized.includes("release")
      ? "release_readiness"
      : normalized.includes("handoff")
        ? "handoff_readiness"
        : "beta_readiness"
  };
}

function renderBroadSummary(summary) {
  const active = summary.activeTickets.slice(0, 3);
  const lines = [
    `Files: ${summary.fileCount}`,
    `Active tickets: ${summary.activeTickets.length}`,
    `Open notes: ${summary.noteCount}`
  ];
  if (active.length) {
    lines.push("Top active tickets:");
    for (const ticket of active) {
      lines.push(`- [${ticket.lane}] ${ticket.id}: ${ticket.title}`);
    }
  }
  return lines.join("\n");
}
