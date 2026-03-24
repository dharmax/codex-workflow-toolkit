import { stableId } from "../lib/hash.mjs";
import { buildCandidateTitle, scoreNote } from "../parsers/shared.mjs";

const DEFAULT_REVIEW_INTERVAL_HOURS = 36;

export function deriveCandidateFromNote(note, options = {}) {
  const scores = scoreNote(note);
  const decisionKey = stableId("candidate-key", note.filePath ?? "manual", note.noteType, note.body.trim().toLowerCase());
  const score = scores.candidateScore;
  const title = buildCandidateTitle(note);
  const status = score >= 0.72 ? "ai-candidate" : score >= 0.5 ? "doubtful-relevancy" : "ignored";

  return {
    id: stableId("candidate", decisionKey),
    noteId: note.id,
    title,
    status,
    score,
    decisionKey,
    reason: `${note.noteType} note scored ${score}`,
    data: {
      noteType: note.noteType,
      filePath: note.filePath ?? null
    },
    ...scores
  };
}

export function reviewCandidates(store, { reviewIntervalHours = DEFAULT_REVIEW_INTERVAL_HOURS, now = new Date() } = {}) {
  const dueAt = new Date(now);
  const nextReviewAt = new Date(now.getTime() + (reviewIntervalHours * 60 * 60 * 1000)).toISOString();
  const candidates = store.listCandidates();
  const reviewed = [];

  for (const candidate of candidates) {
    if (candidate.status === "rejected") {
      continue;
    }

    const isDue = !candidate.nextReviewAt || new Date(candidate.nextReviewAt).getTime() <= dueAt.getTime();
    if (!isDue) {
      continue;
    }

    let nextStatus = candidate.status;
    if (candidate.score >= 0.9) {
      nextStatus = "promoted";
    } else if (candidate.score < 0.35) {
      nextStatus = "archived";
    } else if (candidate.score < 0.6) {
      nextStatus = "doubtful-relevancy";
    } else {
      nextStatus = "ai-candidate";
    }

    store.upsertCandidate({
      ...candidate,
      status: nextStatus,
      lastReviewAt: dueAt.toISOString(),
      nextReviewAt,
      updatedAt: dueAt.toISOString()
    });

    if (nextStatus === "promoted") {
      store.upsertEntity({
        id: `ticket:${candidate.id}`,
        entityType: "candidate-ticket",
        title: candidate.title,
        lane: "AI Candidates",
        state: "open",
        confidence: candidate.score,
        provenance: candidate.reason,
        sourceKind: "proposal",
        reviewState: "pending",
        parentId: candidate.noteId,
        data: {
          candidateId: candidate.id,
          status: nextStatus
        },
        updatedAt: dueAt.toISOString()
      });
    }

    reviewed.push({
      id: candidate.id,
      from: candidate.status,
      to: nextStatus
    });
  }

  return {
    reviewed,
    reviewIntervalHours
  };
}
