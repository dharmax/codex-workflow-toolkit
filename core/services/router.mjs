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
  const knowledge = providerState.knowledge;
  const capability = knowledge.capabilityMapping[taskClass] ?? domain ?? "logic";
  const minimumQuality = knowledge.minimumQuality[taskClass] ?? "medium";
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

      // Check hardware limits for local models
      if (provider.local && provider.maxModelSizeB && model.sizeB && model.sizeB > provider.maxModelSizeB) {
        continue;
      }

      // 0-5 competency score (Data-driven inference)
      const competency = model.capabilities?.[capability] ?? inferCompetency(model, capability, knowledge.inferenceHeuristics);
      
      if (competency < 2 || (competency < 3 && QUALITY_ORDER[minimumQuality] > QUALITY_ORDER.low)) {
        continue;
      }

      const localPreference = preferLocalForTask && provider.local ? 3 : 0;
      
      // Item 35: Historical Success Bias
      const modelMetrics = providerState.metricsSummary?.byModel?.find(m => m.model_id === model.id);
      const reliabilityBonus = modelMetrics ? (modelMetrics.success_rate / 20) : 2; // 0-5 bonus based on success rate

      const score = (10 - (model.costTier ?? 5)) + (competency * 2) + localPreference + reliabilityBonus;
      
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

function inferCompetency(model, capability, heuristics) {
  if (!heuristics) return 3; // Neutral default

  const h = heuristics[capability] ?? { base: 3 };
  const lowerId = model.id.toLowerCase();
  
  let score = h.base ?? 3;

  // Keyword Matching
  if (h.keywords) {
    for (const kw of h.keywords) {
      if (lowerId.includes(kw)) {
        score += (h.bonus ?? 1);
        break; 
      }
    }
  }

  // Size Multiplier (Larger models are generally more capable generalists)
  const thresholds = heuristics.sizeThresholds ?? { large: 30, medium: 7 };
  if ((model.sizeB ?? 0) >= thresholds.large) {
    score += 1;
  } else if ((model.sizeB ?? 0) < 4 && (capability === "logic" || capability === "strategy")) {
    score -= 1; // Penalty for ultra-tiny models on complex reasoning
  }

  return Math.max(0, Math.min(5, score));
}
