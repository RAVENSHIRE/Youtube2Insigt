const assert = require("node:assert/strict");
const test = require("node:test");
const {
  attachPersistedVideoPerformance
} = require("../presentation/videoPerformance");

function video() {
  return {
    id: "QzRxievcmug",
    title: "Scored calls",
    companies: [
      {
        company: "Nvidia",
        ticker: "NVDA",
        call_type: "actionable",
        action: "buy"
      },
      {
        company: "Salesforce",
        ticker: "CRM",
        call_type: "targeted",
        action: "buy",
        price_targets: [{ value: 300, currency: "USD" }],
        time_horizon: "12m"
      },
      {
        company: "IBM",
        ticker: "IBM",
        call_type: "view",
        sentiment: "bull"
      }
    ]
  };
}

test("averages only persisted performance-eligible calls", async () => {
  const requestedCalls = [];
  const repository = {
    async get(videoId, callId) {
      requestedCalls.push({ videoId, callId });
      const currentReturn = requestedCalls.length === 1 ? 10 : -2;
      return {
        saved_at: "2026-09-03T12:00:00.000Z",
        outcome: {
          performance_eligible: true,
          current_return_pct: currentReturn,
          evaluated_at: "2026-09-03T11:00:00.000Z"
        }
      };
    }
  };

  const [result] = await attachPersistedVideoPerformance([video()], repository);

  assert.equal(requestedCalls.length, 2);
  assert.deepEqual(result.performance, {
    averageReturnPct: 4,
    scoredCalls: 2,
    eligibleCalls: 2,
    complete: true,
    evaluatedAt: "2026-09-03T11:00:00.000Z",
    source: "persisted_outcomes"
  });
});

test("does not request provider data or score mentions and views", async () => {
  let repositoryCalls = 0;
  const onlyViews = {
    id: "J3Y_JBATcWg",
    companies: [{
      company: "Rocket Lab",
      ticker: "RKLB",
      call_type: "view",
      sentiment: "bull"
    }]
  };
  const repository = {
    async get() {
      repositoryCalls += 1;
      return null;
    }
  };

  const [result] = await attachPersistedVideoPerformance([onlyViews], repository);

  assert.equal(repositoryCalls, 0);
  assert.deepEqual(result.performance, {
    averageReturnPct: null,
    scoredCalls: 0,
    eligibleCalls: 0,
    complete: false,
    evaluatedAt: null,
    source: "persisted_outcomes"
  });
});

test("keeps the library available when an optional outcome cache is missing", async () => {
  const repository = {
    async get() {
      throw new Error("cache unavailable");
    }
  };

  const [result] = await attachPersistedVideoPerformance([video()], repository);

  assert.equal(result.performance.averageReturnPct, null);
  assert.equal(result.performance.scoredCalls, 0);
  assert.equal(result.performance.eligibleCalls, 2);
  assert.equal(result.performance.complete, false);
});

test("does not rank a video from only a partial set of scored calls", async () => {
  let calls = 0;
  const repository = {
    async get() {
      calls += 1;
      return calls === 1
        ? {
            saved_at: "2026-09-03T12:00:00.000Z",
            outcome: {
              performance_eligible: true,
              current_return_pct: 50,
              evaluated_at: "2026-09-03T11:00:00.000Z"
            }
          }
        : null;
    }
  };

  const [result] = await attachPersistedVideoPerformance([video()], repository);

  assert.equal(result.performance.scoredCalls, 1);
  assert.equal(result.performance.eligibleCalls, 2);
  assert.equal(result.performance.averageReturnPct, null);
  assert.equal(result.performance.complete, false);
});
