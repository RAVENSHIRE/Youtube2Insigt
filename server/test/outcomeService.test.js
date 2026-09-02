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

test("deduplicates concurrent evaluations before an async repository lookup", async () => {
  let repositoryReads = 0;
  let assetQuoteCalls = 0;
  const repository = {
    async get() {
      repositoryReads += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      return null;
    },
    async set() {}
  };
  const snapshotService = {
    async captureForVideoCall() {
      return { snapshot: createSnapshot() };
    },
    async captureFromVerifiedTimestamp() {
      return { snapshot: createSnapshot({ snapshotId: "ms_spy", price: 200 }) };
    }
  };
  const provider = {
    async getQuote(symbol) {
      if (symbol === "NVDA") assetQuoteCalls += 1;
      return { current: { price: symbol === "SPY" ? 210 : 110, timestamp: 1788345123 } };
    },
    async getHistoricalBars() {
      return { bars: [] };
    }
  };
  const service = new OutcomeService({ provider, snapshotService, repository });
  const input = createEvaluationInput();

  await Promise.all([service.evaluate(input), service.evaluate(input)]);

  assert.equal(repositoryReads, 1);
  assert.equal(assetQuoteCalls, 1);
});

test("corrects a reported symbol before snapshot and quote provider access", async () => {
  const calls = { snapshotSymbols: [], quoteSymbols: [] };
  const snapshotService = {
    async getVerifiedPublication() {
      return {
        publishedAt: "2025-04-25T17:05:00.000Z",
        publishedAtSource: "youtube_api"
      };
    },
    async captureFromVerifiedTimestamp({ ticker }) {
      calls.snapshotSymbols.push(ticker);
      return {
        snapshot: createSnapshot({
          price: 1.68,
          timestamp: "2025-04-25T17:05:00.000Z",
          publishedAt: "2025-04-25T17:05:00.000Z"
        })
      };
    }
  };
  const provider = {
    async getQuote(symbol) {
      calls.quoteSymbols.push(symbol);
      return {
        currency: "USD",
        exchange: "NASDAQ",
        current: { price: 2.19, timestamp: 1788345123 }
      };
    },
    async getHistoricalBars() {
      return { bars: [] };
    }
  };
  const service = new OutcomeService({
    provider,
    snapshotService,
    clock: () => new Date("2026-09-02T15:30:00.000Z")
  });

  const corrected = await service.evaluate({
    videoId: "J3Y_JBATcWg",
    candidate: {
      callId: "call-rzlb",
      companyIndex: 4,
      company: "Resolve AI",
      reportedTicker: "RZLB",
      ticker: "RZLV"
    },
    classification: {
      call_type: "actionable",
      performance_eligible: true
    }
  });

  assert.equal(calls.snapshotSymbols[0], "RZLV");
  assert.equal(calls.quoteSymbols[0], "RZLV");
  assert.equal(corrected.reported_symbol, "RZLB");
  assert.equal(corrected.symbol_at_video, "RZLV");
  assert.equal(corrected.instrument_identity.resolution_status, "symbol_corrected");
});

test("blocks unverified corporate-action continuity before market provider access", async () => {
  const calls = { capture: 0, quote: 0, history: 0 };
  const snapshotService = {
    async getVerifiedPublication() {
      return {
        publishedAt: "2025-04-25T17:05:00.000Z",
        publishedAtSource: "youtube_api"
      };
    },
    async captureFromVerifiedTimestamp() {
      calls.capture += 1;
      throw new Error("snapshot should not be captured before continuity review");
    }
  };
  const provider = {
    async getQuote() {
      calls.quote += 1;
      throw new Error("quote should not be requested");
    },
    async getHistoricalBars() {
      calls.history += 1;
      throw new Error("history should not be requested");
    }
  };
  const service = new OutcomeService({
    provider,
    snapshotService,
    clock: () => new Date("2026-09-02T15:30:00.000Z")
  });

  const outcome = await service.evaluate({
    videoId: "J3Y_JBATcWg",
    candidate: {
      callId: "call-cep",
      companyIndex: 3,
      company: "Canter Equity Partners",
      ticker: "CEP"
    },
    classification: {
      call_type: "view",
      performance_eligible: false
    }
  });

  assert.equal(outcome.status, "instrument_lifecycle_pending");
  assert.equal(outcome.symbol_at_video, "CEP");
  assert.equal(outcome.current_symbol, "XXI");
  assert.equal(outcome.current_return_pct, null);
  assert.equal(outcome.performance_tracking_blocked, true);
  assert.deepEqual(calls, { capture: 0, quote: 0, history: 0 });
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

test("reuses a fresh persisted outcome after a server restart", async () => {
  const repository = {
    record: null,
    async get() {
      return this.record;
    },
    async set({ videoId, callId, outcome, savedAt, expiresAt }) {
      this.record = {
        video_id: videoId,
        call_id: callId,
        saved_at: new Date(savedAt).toISOString(),
        expires_at: new Date(expiresAt).toISOString(),
        outcome
      };
    }
  };
  const snapshotService = {
    async captureForVideoCall() {
      return { snapshot: createSnapshot() };
    },
    async captureFromVerifiedTimestamp() {
      return { snapshot: createSnapshot({ snapshotId: "ms_spy", price: 200 }) };
    }
  };
  const provider = {
    async getQuote(symbol) {
      return { current: { price: symbol === "SPY" ? 210 : 110, timestamp: 1788345123 } };
    },
    async getHistoricalBars() {
      return { bars: [] };
    }
  };
  const clock = () => new Date("2026-09-02T15:23:41.512Z");
  const firstService = new OutcomeService({ provider, snapshotService, repository, clock });
  const first = await firstService.evaluate(createEvaluationInput());
  assert.equal(first.cache_persisted, true);

  const noProviderCalls = {
    async getQuote() {
      throw new Error("provider should not be called");
    },
    async getHistoricalBars() {
      throw new Error("provider should not be called");
    }
  };
  const secondService = new OutcomeService({
    provider: noProviderCalls,
    snapshotService: {},
    repository,
    clock
  });
  const replay = await secondService.evaluate(createEvaluationInput());

  assert.equal(replay.cache_hit, true);
  assert.equal(replay.cache_source, "disk");
  assert.equal(replay.current_return_pct, 10);
});

test("returns the last persisted outcome when a live refresh is rate limited", async () => {
  const rateLimit = Object.assign(new Error("rate limited"), {
    code: "PROVIDER_RATE_LIMIT",
    retryable: true
  });
  const repository = {
    async get() {
      return {
        video_id: "video-1",
        call_id: "call-1",
        saved_at: "2026-09-02T15:00:00.000Z",
        expires_at: "2026-09-02T15:05:00.000Z",
        outcome: {
          status: "complete",
          evaluated_at: "2026-09-02T15:00:00.000Z",
          current_price: 109,
          current_return_pct: 9,
          warnings: []
        }
      };
    }
  };
  const service = new OutcomeService({
    provider: {},
    snapshotService: {
      async captureForVideoCall() {
        throw rateLimit;
      }
    },
    repository,
    clock: () => new Date("2026-09-02T15:23:41.512Z")
  });

  const outcome = await service.evaluate(createEvaluationInput());

  assert.equal(outcome.status, "stale");
  assert.equal(outcome.cache_source, "disk");
  assert.equal(outcome.current_price, 109);
  assert.equal(outcome.retry_after_seconds, 60);
  assert.deepEqual(outcome.warnings, [{
    code: "PROVIDER_RATE_LIMIT",
    component: "refresh",
    retryable: true
  }]);
});
