import { discoverProviderState } from "./providers.mjs";

const QUALITY_ORDER = {
  low: 1,
  medium: 2,
  high: 3
};

export async function routeTask({ root = process.cwd(), taskClass, preferLocal = true, allowWeak = false } = {}) {
  if (!taskClass) {
    throw new Error("taskClass is required");
  }

  const providerState = await discoverProviderState({ root });
  const minimumQuality = providerState.routingPolicy.minimumQuality[taskClass] ?? "medium";
  const preferLocalForTask = preferLocal ?? providerState.routingPolicy.preferLocalFor?.includes(taskClass) ?? false;
  const candidates = [];

  for (const [providerId, provider] of Object.entries(providerState.providers)) {
    if (!provider.available) {
      continue;
    }

    for (const model of provider.models) {
      const quality = model.quality ?? "medium";
      if (!allowWeak && QUALITY_ORDER[quality] < QUALITY_ORDER[minimumQuality]) {
        continue;
      }

      const supportsTask = !model.strengths?.length || model.strengths.includes(taskClass);
      if (!supportsTask && QUALITY_ORDER[quality] < QUALITY_ORDER.high) {
        continue;
      }

      const localPreference = preferLocalForTask && provider.local ? 2 : 0;
      const suitability = (model.strengths?.includes(taskClass) ? 3 : 1) + QUALITY_ORDER[quality];
      const score = (10 - (model.costTier ?? 5)) + suitability + localPreference;
      candidates.push({
        providerId,
        modelId: model.id,
        local: provider.local,
        quality,
        costTier: model.costTier ?? 5,
        strengths: model.strengths ?? [],
        score
      });
    }
  }

  candidates.sort((left, right) => right.score - left.score || left.costTier - right.costTier || left.modelId.localeCompare(right.modelId));
  const primary = candidates[0] ?? null;

  return {
    taskClass,
    minimumQuality,
    recommended: primary ? {
      providerId: primary.providerId,
      modelId: primary.modelId,
      local: primary.local,
      reason: buildReason(primary, taskClass, minimumQuality)
    } : null,
    fallbackChain: candidates.slice(1, 4).map((candidate) => ({
      providerId: candidate.providerId,
      modelId: candidate.modelId,
      local: candidate.local,
      reason: buildReason(candidate, taskClass, minimumQuality)
    })),
    providers: providerState.providers
  };
}

function buildReason(candidate, taskClass, minimumQuality) {
  const parts = [];
  parts.push(candidate.local ? "local-first candidate" : "remote provider candidate");
  parts.push(`quality ${candidate.quality} for ${taskClass}`);
  if (candidate.strengths.includes(taskClass)) {
    parts.push("task-specific strength match");
  }
  if (candidate.quality === minimumQuality) {
    parts.push("meets minimum quality without overpaying");
  }
  if (candidate.costTier <= 2) {
    parts.push("low cost tier");
  }
  return parts.join(", ");
}
