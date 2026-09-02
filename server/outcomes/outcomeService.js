const OUTCOME_METHOD_VERSION = 1;
const DEFAULT_BENCHMARK = "SPY";
const DEFAULT_CACHE_TTL_MS = 60_000;

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

class OutcomeService {
  constructor({ provider, snapshotService, benchmarkSymbol = DEFAULT_BENCHMARK, clock, cacheTtlMs } = {}) {
    this.provider = provider;
    this.snapshotService = snapshotService;
    this.benchmarkSymbol = benchmarkSymbol;
    this.clock = typeof clock === "function" ? clock : () => new Date();
    this.cacheTtlMs = Number(cacheTtlMs) || DEFAULT_CACHE_TTL_MS;
    this.cache = new Map();
    this.locks = new Map();
    this.benchmarkCache = new Map();
  }

  async evaluate({ videoId, candidate, classification }) {
    const cacheKey = `${videoId}:${candidate.callId}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.outcome, cache_hit: true };
    }
    if (this.locks.has(cacheKey)) {
      return this.locks.get(cacheKey);
    }

    const evaluation = this.evaluateFresh({ videoId, candidate, classification });
    this.locks.set(cacheKey, evaluation);
    try {
      const outcome = await evaluation;
      this.cache.set(cacheKey, {
        expiresAt: Date.now() + this.cacheTtlMs,
        outcome
      });
      return outcome;
    } finally {
      this.locks.delete(cacheKey);
    }
  }

  async evaluateFresh({ videoId, candidate, classification }) {
    const captured = await this.snapshotService.captureForVideoCall({
      videoId,
      callId: candidate.callId,
      ticker: candidate.ticker
    });
    const snapshot = captured.snapshot;
    const entry = snapshot.market_snapshot.price_at_video;
    const evaluatedAt = this.clock().toISOString();
    const quote = await this.provider.getQuote(candidate.ticker);
    const current = positiveNumber(quote.current?.price, "currentPrice");
    const currentTimestamp = normalizeQuoteTimestamp(quote, evaluatedAt);
    const currentReturn = calculateReturn(entry, current);
    const warnings = [];
    let history = null;
    let benchmark = null;

    try {
      history = await this.provider.getHistoricalBars({
        symbol: candidate.ticker,
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
      evaluated_at: evaluatedAt,
      video_id: videoId,
      company_index: candidate.companyIndex,
      company: candidate.company,
      ticker: candidate.ticker,
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
      warnings,
      data_source: "twelve_data"
    };
  }

  async getBenchmark({ videoId, publishedAt, evaluatedAt }) {
    const cacheKey = `${this.benchmarkSymbol}:${videoId}:${publishedAt}`;
    const cached = this.benchmarkCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
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
      expiresAt: Date.now() + this.cacheTtlMs,
      value
    });
    return value;
  }
}

module.exports = {
  DEFAULT_BENCHMARK,
  DEFAULT_CACHE_TTL_MS,
  OUTCOME_METHOD_VERSION,
  OutcomeService,
  calculateMaxDrawdown,
  calculatePeakReturn,
  calculateReturn,
  normalizeQuoteTimestamp
};
