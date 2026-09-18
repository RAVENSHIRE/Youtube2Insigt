const { classifyCall } = require("../classification/callClassification");
const { resolveSnapshotCandidate } = require("../marketSnapshot/snapshotDryRun");

function roundPercentage(value) {
  return Math.round(value * 10_000) / 10_000;
}

function latestTimestamp(values) {
  return values
    .filter(value => typeof value === "string" && Number.isFinite(Date.parse(value)))
    .sort()
    .at(-1) || null;
}

async function readPersistedOutcome(video, companyIndex, repository) {
  const company = video.companies[companyIndex];
  const classification = classifyCall(company);

  if (!classification.performance_eligible) {
    return null;
  }

  try {
    const candidate = resolveSnapshotCandidate({
      [video.id]: { companies: video.companies }
    }, {
      videoId: video.id,
      companyIndex
    });
    const record = await repository.get(video.id, candidate.callId);
    const outcome = record?.outcome;
    const rawReturn = outcome?.current_return_pct;
    const currentReturn = rawReturn === null || rawReturn === undefined || rawReturn === ""
      ? null
      : Number(rawReturn);

    if (!outcome?.performance_eligible || currentReturn === null || !Number.isFinite(currentReturn)) {
      return null;
    }

    return {
      currentReturnPct: currentReturn,
      evaluatedAt: outcome.evaluated_at || record.saved_at || null
    };
  } catch {
    // A missing ticker or invalid optional cache entry must not block the library.
    return null;
  }
}

async function attachPersistedVideoPerformance(videos = [], repository = null) {
  if (!repository) {
    return videos.map(video => ({ ...video, performance: null }));
  }

  return Promise.all(videos.map(async video => {
    const companies = Array.isArray(video.companies) ? video.companies : [];
    const classifications = companies.map(classifyCall);
    const eligibleCalls = classifications.filter(call =>
      call.performance_eligible
    ).length;
    const outcomes = (await Promise.all(companies.map((company, companyIndex) =>
      readPersistedOutcome({ ...video, companies }, companyIndex, repository)
    ))).filter(Boolean);

    const complete = eligibleCalls > 0 && outcomes.length === eligibleCalls;

    if (!complete) {
      return {
        ...video,
        performance: {
          averageReturnPct: null,
          scoredCalls: outcomes.length,
          eligibleCalls,
          complete: false,
          evaluatedAt: null,
          source: "persisted_outcomes"
        }
      };
    }

    return {
      ...video,
      performance: {
        averageReturnPct: roundPercentage(
          outcomes.reduce((sum, outcome) => sum + outcome.currentReturnPct, 0) /
            outcomes.length
        ),
        scoredCalls: outcomes.length,
        eligibleCalls,
        complete: true,
        evaluatedAt: latestTimestamp(outcomes.map(outcome => outcome.evaluatedAt)),
        source: "persisted_outcomes"
      }
    };
  }));
}

module.exports = {
  attachPersistedVideoPerformance,
  roundPercentage
};
