const assert = require("node:assert/strict");
const test = require("node:test");
const {
  OutcomeService,
  calculateMaxDrawdown,
  calculatePeakReturn,
  calculateReturn,
  normalizeQuoteTimestamp
} = require("../outcomes/outcomeService");

function createSnapshot({
  snapshotId = "ms_asset",
  price = 100,
  timestamp = "2026-08-26T16:23:00.000Z",
  publishedAt = "2026-08-26T16:22:01.000Z"
} = {}) {
  return {
    snapshot_id: snapshotId,
    published_at: publishedAt,
    market_snapshot: {
      price_at_video: price,
      timestamp,
      currency: "USD",
      exchange: "NASDAQ"
    }
  };
}

function createEvaluationInput(overrides = {}) {
  return {
    videoId: overrides.videoId || "video-1",
    candidate: {
      callId: overrides.callId || "call-1",
      companyIndex: 0,
      company: "Nvidia",
      ticker: "NVDA"
    },
    classification: {
      call_type: "actionable",
      performance_eligible: true
    }
  };
}

test("calculates current return from publication price", () => {
  assert.equal(calculateReturn(100, 127.7), 27.7);
});

test("calculates peak return from daily highs", () => {
  const result = calculatePeakReturn(100, [
    { high: 112, close: 108 },
    { high: 135, close: 130 }
  ], 125);
  assert.equal(result.peak_price, 135);
  assert.equal(result.peak_return_pct, 35);
});

test("calculates maximum peak-to-trough drawdown", () => {
  const drawdown = calculateMaxDrawdown(100, [
    { close: 120 },
    { close: 90 },
    { close: 110 }
  ], 105);
  assert.equal(drawdown, -25);
});

test("rejects invalid prices instead of emitting misleading outcomes", () => {
  assert.throws(() => calculateReturn(0, 100), /entryPrice/u);
  assert.throws(() => calculateReturn(100, null), /currentPrice/u);
});

test("normalizes provider epoch seconds to an exact ISO timestamp", () => {
  const result = normalizeQuoteTimestamp({
    current: { timestamp: 1788345123 }
  }, "2026-09-02T12:00:00.000Z");

  assert.equal(result.timestamp, "2026-09-02T10:32:03.000Z");
  assert.equal(result.source, "provider_quote");
});

test("uses the exact evaluation time when the provider exposes only a date", () => {
  const result = normalizeQuoteTimestamp({
    current: { datetime: "2026-09-02" }
  }, "2026-09-02T12:00:00.000Z");

  assert.equal(result.timestamp, "2026-09-02T12:00:00.000Z");
  assert.equal(result.source, "evaluation_time");
});

test("caches a completed outcome and avoids duplicate provider credits", async () => {
  const calls = { quote: 0, history: 0, benchmarkSnapshot: 0 };
  const snapshotService = {
    async captureForVideoCall() {
      return { snapshot: createSnapshot() };
    },
    async captureFromVerifiedTimestamp() {
      calls.benchmarkSnapshot += 1;
      return {
        snapshot: createSnapshot({
          snapshotId: "ms_spy",
          price: 200
        })
      };
    }
  };
  const provider = {
    async getQuote(symbol) {
      calls.quote += 1;
      return {
        currency: "USD",
        exchange: symbol === "SPY" ? "NYSE ARCA" : "NASDAQ",
        current: {
          price: symbol === "SPY" ? 210 : 110,
          timestamp: 1788345123
        }
      };
    },
    async getHistoricalBars() {
      calls.history += 1;
      return { bars: [{ high: 115, close: 108 }] };
    }
  };
  const service = new OutcomeService({
    provider,
    snapshotService,
    clock: () => new Date("2026-09-02T15:23:41.512Z")
  });

  const first = await service.evaluate(createEvaluationInput());
  const replay = await service.evaluate(createEvaluationInput());

  assert.equal(first.status, "complete");
  assert.equal(first.cache_hit, false);
  assert.equal(replay.cache_hit, true);
  assert.equal(replay.current_return_pct, 10);
  assert.deepEqual(calls, { quote: 2, history: 1, benchmarkSnapshot: 1 });
});

test("deduplicates concurrent evaluations for the same call", async () => {
  let assetQuoteCalls = 0;
  const snapshotService = {
    async captureForVideoCall() {
      await new Promise(resolve => setTimeout(resolve, 5));
      return { snapshot: createSnapshot() };
    },
    async captureFromVerifiedTimestamp() {
      return { snapshot: createSnapshot({ snapshotId: "ms_spy", price: 200 }) };
    }
  };
  const provider = {
    async getQuote(symbol) {
      if (symbol === "NVDA") assetQuoteCalls += 1;
      return {
        current: { price: symbol === "SPY" ? 210 : 110, timestamp: 1788345123 }
      };
    },
    async getHistoricalBars() {
      return { bars: [] };
    }
  };
  const service = new OutcomeService({ provider, snapshotService });
  const input = createEvaluationInput();

  const [first, second] = await Promise.all([
    service.evaluate(input),
    service.evaluate(input)
  ]);

  assert.deepEqual(first, second);
  assert.equal(assetQuoteCalls, 1);
});

test("returns core outcome values when optional provider data is rate limited", async () => {
  const rateLimit = Object.assign(new Error("rate limited"), {
    code: "PROVIDER_RATE_LIMIT",
    retryable: true
  });
  const snapshotService = {
    async captureForVideoCall() {
      return { snapshot: createSnapshot() };
    },
    async captureFromVerifiedTimestamp() {
      throw rateLimit;
    }
  };
  const provider = {
    async getQuote() {
      return {
        currency: "USD",
        exchange: "NASDAQ",
        current: { price: 110, timestamp: 1788345123 }
      };
    },
    async getHistoricalBars() {
      throw rateLimit;
    }
  };
  const service = new OutcomeService({
    provider,
    snapshotService,
    clock: () => new Date("2026-09-02T15:23:41.512Z")
  });

  const outcome = await service.evaluate(createEvaluationInput());

  assert.equal(outcome.status, "partial");
  assert.equal(outcome.price_at_video, 100);
  assert.equal(outcome.current_price, 110);
  assert.equal(outcome.current_return_pct, 10);
  assert.equal(outcome.peak_return_pct, null);
  assert.equal(outcome.max_drawdown_pct, null);
  assert.equal(outcome.benchmark, null);
  assert.deepEqual(outcome.warnings, [
    {
      code: "PROVIDER_RATE_LIMIT",
      component: "asset_history",
      retryable: true
    },
    {
      code: "PROVIDER_RATE_LIMIT",
      component: "benchmark",
      retryable: true
    }
  ]);
});

test("keeps benchmark entry prices isolated by video publication time", async () => {
  let benchmarkSnapshotCalls = 0;
  const snapshotService = {
    async captureForVideoCall({ videoId }) {
      return {
        snapshot: createSnapshot({
          snapshotId: `ms_${videoId}`,
          publishedAt: videoId === "video-1"
            ? "2026-08-26T16:22:01.000Z"
            : "2026-08-27T16:22:01.000Z"
        })
      };
    },
    async captureFromVerifiedTimestamp({ videoId }) {
      benchmarkSnapshotCalls += 1;
      return {
        snapshot: createSnapshot({
          snapshotId: `ms_spy_${videoId}`,
          price: videoId === "video-1" ? 200 : 205
        })
      };
    }
  };
  const provider = {
    async getQuote(symbol) {
      return {
        currency: "USD",
        exchange: "NASDAQ",
        current: { price: symbol === "SPY" ? 210 : 110, timestamp: 1788345123 }
      };
    },
    async getHistoricalBars() {
      return { bars: [] };
    }
  };
  const service = new OutcomeService({ provider, snapshotService });

  const first = await service.evaluate(createEvaluationInput());
  const second = await service.evaluate(createEvaluationInput({
    videoId: "video-2",
    callId: "call-2"
  }));

  assert.equal(first.benchmark.price_at_video, 200);
  assert.equal(second.benchmark.price_at_video, 205);
  assert.equal(benchmarkSnapshotCalls, 2);
});
