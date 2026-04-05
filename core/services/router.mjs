import { discoverProviderState } from "./providers.mjs";
import { applyModelFitMatrix, buildModelFitMatrix } from "./model-fit.mjs";

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
  const modelFitMatrix = await buildModelFitMatrix({ root, providerState, taskClass });
  const routedState = applyModelFitMatrix(providerState, modelFitMatrix);
  const knowledge = routedState.knowledge;
  const capability = knowledge.capabilityMapping[taskClass] ?? domain ?? "logic";
  const minimumQuality = knowledge.minimumQuality[taskClass] ?? "medium";
  const preferLocalForTask = preferLocal ?? routedState.routingPolicy.preferLocalFor?.includes(taskClass) ?? routedState.routingPolicy.preferLocalFor?.includes(capability) ?? false;
  const quotaStrategy = routedState.routingPolicy.quotaStrategy ?? "prefer-free-remote";
  const candidates = [];
  const remoteFreeQuotaAvailable = Object.values(routedState.providers).some((provider) =>
    !provider.local && provider.available && hasFreeQuota(provider)
  );

  for (const [providerId, provider] of Object.entries(routedState.providers)) {
    if (!provider.available) {
      continue;
    }
    if (!provider.local && shouldBlockProviderForQuota(provider, { quotaStrategy, remoteFreeQuotaAvailable })) {
      continue;
    }

    for (const model of provider.models) {
      const shellPlanningLocal = taskClass === "shell-planning" && provider.local;
      const quality = model.quality ?? "medium";
      if (!allowWeak && QUALITY_ORDER[quality] < QUALITY_ORDER[minimumQuality]) {
        continue;
      }

      // Check hardware limits for local models
      if (!shellPlanningLocal && provider.local && provider.maxModelSizeB && model.sizeB && model.sizeB > provider.maxModelSizeB) {
        continue;
      }

      // 0-5 competency score (Data-driven inference)
      const competency = model.capabilities?.[capability] ?? inferCompetency(model, capability, knowledge.inferenceHeuristics);
      
      if ((!shellPlanningLocal && competency < 2) || (!shellPlanningLocal && competency < 3 && QUALITY_ORDER[minimumQuality] > QUALITY_ORDER.low)) {
        continue;
      }

      const localPreference = preferLocalForTask && provider.local ? (shellPlanningLocal ? 5 : 3) : 0;
      const configTrustBonus = provider.local ? 1 : provider.configured ? 2 : -3;
      
      // Item 35: Historical Success Bias
      const modelMetrics = providerState.metricsSummary?.byModel?.find(m => m.model_id === model.id);
      const reliabilityBonus = modelMetrics ? (modelMetrics.success_rate / 20) : 2; // 0-5 bonus based on success rate
      const quotaBonus = scoreQuota(provider, { quotaStrategy, remoteFreeQuotaAvailable });
      const fitBonus = typeof model.fitScore === "number" ? (model.fitScore / 10) : 0;
      const score = (10 - (model.costTier ?? 5)) + (competency * 2) + localPreference + reliabilityBonus + quotaBonus + configTrustBonus + fitBonus;
      
      candidates.push({
        providerId,
        modelId: model.id,
        local: provider.local,
        quality,
        costTier: model.costTier ?? 5,
        competency,
        fitScore: model.fitScore ?? null,
        fitReasons: model.fitReasons ?? [],
        quota: provider.quota ?? null,
        freeQuotaRemaining: provider.quota?.freeUsdRemaining ?? null,
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
    providers: routedState.providers,
    modelFitMatrix,
    tooling: {
      leanCtx: routedState.leanCtx,
      contextCompression: routedState.routingPolicy.contextCompression
    }
  };
}

function buildReason(candidate, taskClass, minimumQuality, capability) {
  const parts = [];
  parts.push(`competency ${candidate.competency}/5 for ${capability}`);
  parts.push(candidate.local ? "local-first candidate" : "remote provider candidate");
  if (typeof candidate.fitScore === "number") {
    parts.push(`fit score ${candidate.fitScore}`);
  }
  if (candidate.freeQuotaRemaining !== null) {
    parts.push(`free quota $${candidate.freeQuotaRemaining.toFixed(2)} remaining`);
  }
  if (candidate.costTier <= 2) {
    parts.push("low cost tier");
  }
  return parts.join(", ");
}

function hasFreeQuota(provider) {
  return provider.quota?.freeUsdRemaining !== null && provider.quota.freeUsdRemaining > 0;
}

function shouldBlockProviderForQuota(provider, { quotaStrategy, remoteFreeQuotaAvailable }) {
  if (provider.local) return false;
  if (quotaStrategy !== "prefer-free-remote") return false;
  if (!remoteFreeQuotaAvailable) return false;
  if (hasFreeQuota(provider)) return false;
  return provider.quota?.freeUsdRemaining !== null;
}

function scoreQuota(provider, { quotaStrategy, remoteFreeQuotaAvailable }) {
  if (provider.local) return remoteFreeQuotaAvailable ? -4 : 2;
  if (quotaStrategy !== "prefer-free-remote") return 0;
  if (hasFreeQuota(provider)) {
    return 8 + Math.min(4, provider.quota.freeUsdRemaining / 5);
  }
  if (provider.quota?.freeUsdRemaining !== null) {
    return provider.paidAllowed === false ? -50 : -10;
  }
  return 0;
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
