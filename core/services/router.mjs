import { discoverProviderState } from "./providers.mjs";

const QUALITY_ORDER = {
  low: 1,
  medium: 2,
  high: 3
};

export async function routeTask({ root = process.cwd(), taskClass, domain = null, preferLocal = true, allowWeak = false } = {}) {
  if (!taskClass) {
    throw new Error("taskClass is required");
  }

  const providerState = await discoverProviderState({ root });
  const capability = providerState.routingPolicy.capabilityMapping[taskClass] ?? domain ?? "logic";
  const minimumQuality = providerState.routingPolicy.minimumQuality[taskClass] ?? "medium";
  const preferLocalForTask = preferLocal ?? providerState.routingPolicy.preferLocalFor?.includes(taskClass) ?? providerState.routingPolicy.preferLocalFor?.includes(capability) ?? false;
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

      // 0-5 competency score
      const competency = model.capabilities?.[capability] ?? inferCompetency(model, capability);
      
      if (competency < 3 && QUALITY_ORDER[quality] < QUALITY_ORDER.high) {
        // Skip incompetent models unless they are high-tier generalists
        continue;
      }

      const localPreference = preferLocalForTask && provider.local ? 3 : 0;
      const score = (10 - (model.costTier ?? 5)) + (competency * 2) + localPreference;
      
      candidates.push({
        providerId,
        modelId: model.id,
        local: provider.local,
        quality,
        costTier: model.costTier ?? 5,
        competency,
        score
      });
    }
  }

  candidates.sort((left, right) => right.score - left.score || left.costTier - right.costTier || left.modelId.localeCompare(right.modelId));
  const primary = candidates[0] ?? null;

  return {
    taskClass,
    capability,
    minimumQuality,
    recommended: primary ? {
      providerId: primary.providerId,
      modelId: primary.modelId,
      local: primary.local,
      reason: buildReason(primary, taskClass, minimumQuality, capability)
    } : null,
    fallbackChain: candidates.slice(1, 4).map((candidate) => ({
      providerId: candidate.providerId,
      modelId: candidate.modelId,
      local: candidate.local,
      reason: buildReason(candidate, taskClass, minimumQuality, capability)
    })),
    providers: providerState.providers
  };
}

function buildReason(candidate, taskClass, minimumQuality, capability) {
  const parts = [];
  parts.push(`competency ${candidate.competency}/5 for ${capability}`);
  parts.push(candidate.local ? "local-first candidate" : "remote provider candidate");
  if (candidate.costTier <= 2) {
    parts.push("low cost tier");
  }
  return parts.join(", ");
}

function inferCompetency(model, capability) {
  // Heuristic for Ollama models or unmapped remote models
  const lower = model.id.toLowerCase();
  const isCoder = lower.includes("coder") || lower.includes("code");
  const isLarge = (model.sizeB ?? 0) >= 30 || model.quality === "high";
  const isMedium = (model.sizeB ?? 0) >= 12 || model.quality === "medium";

  switch (capability) {
    case "logic":
      return isCoder ? 5 : (isLarge ? 4 : (isMedium ? 3 : 2));
    case "data":
      return isLarge ? 5 : (isMedium ? 4 : 3);
    case "prose":
      return lower.includes("llama") || lower.includes("gemma") ? (isLarge ? 5 : 4) : 3;
    case "strategy":
      return isLarge ? 5 : (isMedium ? 3 : 2);
    default:
      return isLarge ? 4 : 3;
  }
}
