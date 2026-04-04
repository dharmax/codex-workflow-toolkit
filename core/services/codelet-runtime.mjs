import path from "node:path";
import { buildSurgicalContext, formatContextForPrompt } from "./context-packer.mjs";
import { getCodelet, getProjectSummary, withWorkflowStore } from "./sync.mjs";

export async function buildSmartCodeletRunContext({
  projectRoot = process.cwd(),
  codeletId,
  ticketId = null,
  filePath = null,
  goal = null
} = {}) {
  const normalizedTicketId = ticketId ? String(ticketId).trim() : null;
  const normalizedFilePath = filePath ? path.normalize(String(filePath).trim()) : null;
  const normalizedGoal = goal ? String(goal).trim() : null;

  const [codelet, projectSummary] = await Promise.all([
    getCodelet({ projectRoot, codeletId }),
    getProjectSummary({ projectRoot })
  ]);

  if (!codelet) {
    throw new Error(`Unknown smart codelet: ${codeletId}`);
  }

  const target = await resolveTarget(projectRoot, normalizedTicketId);
  const surgicalContext = await buildSurgicalContext(projectRoot, {
    ticketId: target.ticket?.id ?? normalizedTicketId,
    filePaths: normalizedFilePath ? [normalizedFilePath] : [],
    symbolNames: []
  });

  return {
    codelet: {
      ...codelet,
      summary: String(codelet.summary ?? codelet.title ?? codelet.id ?? codeletId).trim(),
      taskClass: String(codelet.taskClass ?? "task-decomposition").trim(),
      intent: String(codelet.focus ?? codelet.title ?? codelet.summary ?? codelet.id ?? codeletId).trim(),
      observer: Boolean(codelet.observer)
    },
    projectSummary,
    target: {
      ticketId: normalizedTicketId,
      filePath: normalizedFilePath,
      goal: normalizedGoal,
      ticket: target.ticket ?? null
    },
    surgicalContext,
    promptContext: formatContextForPrompt(surgicalContext),
    tooling: surgicalContext.tooling
  };
}

async function resolveTarget(projectRoot, ticketId) {
  if (!ticketId) {
    return { ticket: null };
  }

  return withWorkflowStore(projectRoot, async (store) => {
    const entity = store.getEntity(ticketId);
    if (!entity) {
      return { ticket: null };
    }

    return {
      ticket: {
        id: entity.id,
        title: entity.title,
        lane: entity.lane,
        state: entity.state,
        summary: String(entity.data?.summary ?? "").trim()
      }
    };
  });
}
