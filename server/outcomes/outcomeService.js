const OUTCOME_METHOD_VERSION = 1;
const DEFAULT_BENCHMARK = "SPY";
const DEFAULT_CACHE_TTL_MS = 5 * 60_000;
const PARTIAL_CACHE_TTL_MS = 60_000;
const {
  isLifecyclePerformanceBlocked,
  resolveInstrumentIdentity
} = require("../instruments/instrumentResolver");

function positiveNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${field} muss größer als 0 sein.`);
  }
  return number;
}

function percentage(value) {
  return Math.round(value * 10_000) / 10_000;
}

function normalizeQuoteTimestamp(quote, fallbackTimestamp) {
  const rawTimestamp = quote?.current?.timestamp;
  const numericTimestamp = Number(rawTimestamp);

  if (rawTimestamp !== null && rawTimestamp !== undefined && Number.isFinite(numericTimestamp)) {
    const milliseconds = numericTimestamp > 10_000_000_000
      ? numericTimestamp
      : numericTimestamp * 1000;
    const date = new Date(milliseconds);
    if (!Number.isNaN(date.getTime())) {
      return { timestamp: date.toISOString(), source: "provider_quote" };
    }
  }

  const datetime = String(quote?.current?.datetime || "").trim();
  if (/(?:Z|[+-]\d{2}:?\d{2})$/u.test(datetime)) {
    const milliseconds = Date.parse(datetime);
    if (Number.isFinite(milliseconds)) {
      return { timestamp: new Date(milliseconds).toISOString(), source: "provider_quote" };
    }
  }

  return { timestamp: new Date(fallbackTimestamp).toISOString(), source: "evaluation_time" };
}

function calculateReturn(entryPrice, currentPrice) {
  return percentage((positiveNumber(currentPrice, "currentPrice") /
    positiveNumber(entryPrice, "entryPrice") - 1) * 100);
}

function calculatePeakReturn(entryPrice, bars = [], currentPrice = null) {
  const entry = positiveNumber(entryPrice, "entryPrice");
  const prices = bars
    .map(bar => Number(bar.high ?? bar.close))
    .filter(value => Number.isFinite(value) && value > 0);
  if (Number(currentPrice) > 0) prices.push(Number(currentPrice));
  const peak = prices.length ? Math.max(entry, ...prices) : entry;
  return { peak_price: peak, peak_return_pct: calculateReturn(entry, peak) };
}

function calculateMaxDrawdown(entryPrice, bars = [], currentPrice = null) {
  const closes = [positiveNumber(entryPrice, "entryPrice")];
  for (const bar of bars) {
    const close = Number(bar.close);
    if (Number.isFinite(close) && close > 0) closes.push(close);
  }
  if (Number(currentPrice) > 0) closes.push(Number(currentPrice));

  let peak = closes[0];
  let maxDrawdown = 0;
  for (const close of closes) {
    peak = Math.max(peak, close);
    maxDrawdown = Math.min(maxDrawdown, (close / peak - 1) * 100);
  }
  return percentage(maxDrawdown);
}

function createInstrumentInput(candidate = {}) {
  const identity = candidate.instrument_identity || {};
  return {
    company: candidate.company,
    ticker: candidate.reportedTicker ||
      candidate.reported_symbol ||
      identity.reported_symbol ||
      candidate.ticker
  };
}

function createLifecyclePendingOutcome({
  videoId,
  candidate,
  classification,
  identity,
  evaluatedAt,
  snapshot = null
}) {
  const market = snapshot?.market_snapshot || {};

  return {
    schema_version: 1,
    method_version: OUTCOME_METHOD_VERSION,
    status: "instrument_lifecycle_pending",
    cache_hit: false,
    cache_source: "instrument_registry",
    evaluated_at: evaluatedAt,
    video_id: videoId,
    company_index: candidate.companyIndex,
    company: candidate.company,
    ticker: identity.symbol_at_video || candidate.ticker,
    reported_symbol: identity.reported_symbol,
    symbol_at_video: identity.symbol_at_video,
    current_symbol: identity.current_symbol,
    call_id: candidate.callId,
    call_type: classification.call_type,
    performance_eligible: false,
    performance_tracking_blocked: true,
    tracking_block_reason: "instrument_continuity_unverified",
    market_snapshot_id: snapshot?.snapshot_id || null,
    price_at_video: market.price_at_video ?? null,
    price_at_video_timestamp: market.timestamp || null,
    current_price: null,
    current_price_timestamp: null,
    current_price_timestamp_source: null,
    currency: market.currency || null,
    exchange: market.exchange || identity.current_exchange || null,
    current_return_pct: null,
    peak_price: null,
    peak_return_pct: null,
    max_drawdown_pct: null,
    benchmark: null,
    instrument_identity: identity,
    warnings: identity.warnings,
    data_source: "instrument_registry"
  };
}

class OutcomeService {
  constructor({
    provider,
    snapshotService,
    repository = null,
    benchmarkSymbol = DEFAULT_BENCHMARK,
    clock,
    cacheTtlMs
  } = {}) {
    this.provider = provider;
    this.snapshotService = snapshotService;
    this.repository = repository;
    this.benchmarkSymbol = benchmarkSymbol;
    this.clock = typeof clock === "function" ? clock : () => new Date();
    this.cacheTtlMs = Number(cacheTtlMs) || DEFAULT_CACHE_TTL_MS;
    this.cache = new Map();
    this.locks = new Map();
    this.benchmarkCache = new Map();
  }

  async evaluate({ videoId, candidate, classification }) {
    const cacheKey = `${videoId}:${candidate.callId}`;
    const now = this.clock().getTime();
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return { ...cached.outcome, cache_hit: true, cache_source: "memory" };
    }
    if (this.locks.has(cacheKey)) {
      return this.locks.get(cacheKey);
    }

    const evaluation = this.evaluateFromCacheOrProvider({
      videoId,
      candidate,
      classification,
      cacheKey
    });
    this.locks.set(cacheKey, evaluation);
    try {
      return await evaluation;
    } finally {
      if (this.locks.get(cacheKey) === evaluation) {
        this.locks.delete(cacheKey);
      }
    }
  }

  async evaluateFromCacheOrProvider({ videoId, candidate, classification, cacheKey }) {
    const now = this.clock().getTime();
    const stored = this.repository
      ? await this.repository.get(videoId, candidate.callId)
      : null;
    if (stored && Date.parse(stored.expires_at) > now) {
      this.cache.set(cacheKey, {
        expiresAt: Date.parse(stored.expires_at),
        outcome: stored.outcome
      });
      return { ...stored.outcome, cache_hit: true, cache_source: "disk" };
    }

    return this.evaluateAndCache({
      videoId,
      candidate,
      classification,
      cacheKey,
      stored
    });
  }

  async evaluateAndCache({ videoId, candidate, classification, cacheKey, stored }) {
    const now = this.clock().getTime();

    try {
      let outcome = await this.evaluateFresh({ videoId, candidate, classification });
      const ttl = outcome.status === "complete"
        ? this.cacheTtlMs
        : PARTIAL_CACHE_TTL_MS;
      const expiresAt = now + ttl;
      this.cache.set(cacheKey, { expiresAt, outcome });

      if (this.repository) {
        try {
          await this.repository.set({
            videoId,
            callId: candidate.callId,
            outcome,
            savedAt: now,
            expiresAt
          });
          outcome = { ...outcome, cache_persisted: true };
          this.cache.set(cacheKey, { expiresAt, outcome });
        } catch {
          outcome = { ...outcome, cache_persisted: false };
          this.cache.set(cacheKey, { expiresAt, outcome });
        }
      }

      return outcome;
    } catch (error) {
      if (!stored?.outcome || !error?.retryable) {
        throw error;
      }

      const outcome = {
        ...stored.outcome,
        status: "stale",
        cache_hit: true,
        cache_source: "disk",
        stale_since: stored.expires_at,
        retry_after_seconds: 60,
        warnings: [
          ...(Array.isArray(stored.outcome.warnings) ? stored.outcome.warnings : []),
          {
            code: error.code || "OUTCOME_REFRESH_FAILED",
            component: "refresh",
            retryable: true
          }
        ]
      };
      this.cache.set(cacheKey, {
        expiresAt: now + PARTIAL_CACHE_TTL_MS,
        outcome
      });
      return outcome;
    }
  }

  async evaluateFresh({ videoId, candidate, classification }) {
    const evaluatedAt = this.clock().toISOString();
    let publication = null;
    let instrumentIdentity = candidate.instrument_identity || resolveInstrumentIdentity(
      createInstrumentInput(candidate),
      { evaluatedAt }
    );

    if (typeof this.snapshotService.getVerifiedPublication === "function") {
      publication = await this.snapshotService.getVerifiedPublication(videoId);
      instrumentIdentity = resolveInstrumentIdentity(
        createInstrumentInput(candidate),
        {
          publishedAt: publication.publishedAt,
          evaluatedAt
        }
      );

      if (isLifecyclePerformanceBlocked(instrumentIdentity)) {
        return createLifecyclePendingOutcome({
          videoId,
          candidate,
          classification,
          identity: instrumentIdentity,
          evaluatedAt
        });
      }
    }

    const snapshotSymbol = instrumentIdentity.provider_symbols?.historical || candidate.ticker;
    const captured = publication
      ? await this.snapshotService.captureFromVerifiedTimestamp({
          videoId,
          callId: candidate.callId,
          ticker: snapshotSymbol,
          publishedAt: publication.publishedAt,
          publishedAtSource: publication.publishedAtSource
        })
      : await this.snapshotService.captureForVideoCall({
          videoId,
          callId: candidate.callId,
          ticker: snapshotSymbol
        });
    const snapshot = captured.snapshot;
    instrumentIdentity = resolveInstrumentIdentity(
      createInstrumentInput(candidate),
      {
        publishedAt: snapshot.published_at,
        evaluatedAt
      }
    );

    if (isLifecyclePerformanceBlocked(instrumentIdentity)) {
      return createLifecyclePendingOutcome({
        videoId,
        candidate,
        classification,
        identity: instrumentIdentity,
        evaluatedAt,
        snapshot
      });
    }

    const entry = snapshot.market_snapshot.price_at_video;
    const currentSymbol = instrumentIdentity.provider_symbols?.current || candidate.ticker;
    const quote = await this.provider.getQuote(currentSymbol);
    const current = positiveNumber(quote.current?.price, "currentPrice");
    const currentTimestamp = normalizeQuoteTimestamp(quote, evaluatedAt);
    const currentReturn = calculateReturn(entry, current);
    const warnings = [];
    let history = null;
    let benchmark = null;

    try {
      history = await this.provider.getHistoricalBars({
        symbol: snapshotSymbol,
        startAt: snapshot.market_snapshot.timestamp,
        endAt: evaluatedAt,
        interval: "1day"
      });
    } catch (error) {
      warnings.push({
        code: error?.code || "HISTORY_UNAVAILABLE",
        component: "asset_history",
        retryable: Boolean(error?.retryable)
      });
    }

    try {
      benchmark = await this.getBenchmark({
        videoId,
        publishedAt: snapshot.published_at,
        evaluatedAt
      });
    } catch (error) {
      warnings.push({
        code: error?.code || "BENCHMARK_UNAVAILABLE",
        component: "benchmark",
        retryable: Boolean(error?.retryable)
      });
    }

    const peak = history ? calculatePeakReturn(entry, history.bars, current) : null;

    return {
      schema_version: 1,
      method_version: OUTCOME_METHOD_VERSION,
      status: warnings.length ? "partial" : "complete",
      cache_hit: false,
      cache_source: "provider",
      evaluated_at: evaluatedAt,
      video_id: videoId,
      company_index: candidate.companyIndex,
      company: candidate.company,
      ticker: currentSymbol,
      reported_symbol: instrumentIdentity.reported_symbol,
      symbol_at_video: instrumentIdentity.symbol_at_video,
      current_symbol: instrumentIdentity.current_symbol,
      call_id: candidate.callId,
      call_type: classification.call_type,
      performance_eligible: classification.performance_eligible,
      market_snapshot_id: snapshot.snapshot_id,
      price_at_video: entry,
      price_at_video_timestamp: snapshot.market_snapshot.timestamp,
      current_price: current,
      current_price_timestamp: currentTimestamp.timestamp,
      current_price_timestamp_source: currentTimestamp.source,
      currency: quote.currency || snapshot.market_snapshot.currency,
      exchange: quote.exchange || snapshot.market_snapshot.exchange,
      current_return_pct: currentReturn,
      peak_price: peak?.peak_price ?? null,
      peak_return_pct: peak?.peak_return_pct ?? null,
      max_drawdown_pct: history
        ? calculateMaxDrawdown(entry, history.bars, current)
        : null,
      benchmark: benchmark
        ? {
            ...benchmark,
            alpha_pct_points: percentage(currentReturn - benchmark.return_pct)
          }
        : null,
      instrument_identity: instrumentIdentity,
      warnings,
      data_source: "twelve_data"
    };
  }

  async getBenchmark({ videoId, publishedAt, evaluatedAt }) {
    const cacheKey = `${this.benchmarkSymbol}:${videoId}:${publishedAt}`;
    const cached = this.benchmarkCache.get(cacheKey);
    if (cached && cached.expiresAt > this.clock().getTime()) {
      return cached.value;
    }

    const benchmarkSnapshot = await this.snapshotService.captureFromVerifiedTimestamp({
      videoId,
      callId: `benchmark_${this.benchmarkSymbol.toLowerCase()}:${videoId}`,
      ticker: this.benchmarkSymbol,
      publishedAt,
      publishedAtSource: "youtube_api"
    });
    const quote = await this.provider.getQuote(this.benchmarkSymbol);
    const entry = benchmarkSnapshot.snapshot.market_snapshot.price_at_video;
    const current = positiveNumber(quote.current?.price, "benchmarkCurrent");
    const timestamp = normalizeQuoteTimestamp(quote, evaluatedAt);
    const value = {
      symbol: this.benchmarkSymbol,
      price_at_video: entry,
      price_at_video_timestamp: benchmarkSnapshot.snapshot.market_snapshot.timestamp,
      current_price: current,
      current_price_timestamp: timestamp.timestamp,
      current_price_timestamp_source: timestamp.source,
      return_pct: calculateReturn(entry, current)
    };
    this.benchmarkCache.set(cacheKey, {
      expiresAt: this.clock().getTime() + this.cacheTtlMs,
      value
    });
    return value;
  }
}

module.exports = {
  DEFAULT_BENCHMARK,
  DEFAULT_CACHE_TTL_MS,
  PARTIAL_CACHE_TTL_MS,
  OUTCOME_METHOD_VERSION,
  OutcomeService,
  calculateMaxDrawdown,
  calculatePeakReturn,
  calculateReturn,
  normalizeQuoteTimestamp
};
