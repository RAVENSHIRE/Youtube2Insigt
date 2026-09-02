const OUTCOME_METHOD_VERSION = 1;
const DEFAULT_BENCHMARK = "SPY";

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
  constructor({ provider, snapshotService, benchmarkSymbol = DEFAULT_BENCHMARK, clock } = {}) {
    this.provider = provider;
    this.snapshotService = snapshotService;
    this.benchmarkSymbol = benchmarkSymbol;
    this.clock = typeof clock === "function" ? clock : () => new Date();
  }

  async evaluate({ videoId, candidate, classification }) {
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
    const history = await this.provider.getHistoricalBars({
      symbol: candidate.ticker,
      startAt: snapshot.market_snapshot.timestamp,
      endAt: evaluatedAt,
      interval: "1day"
    });
    const benchmarkSnapshot = await this.snapshotService.captureFromVerifiedTimestamp({
      videoId,
      callId: `benchmark_${this.benchmarkSymbol.toLowerCase()}:${videoId}`,
      ticker: this.benchmarkSymbol,
      publishedAt: snapshot.published_at,
      publishedAtSource: "youtube_api"
    });
    const benchmarkQuote = await this.provider.getQuote(this.benchmarkSymbol);
    const benchmarkEntry = benchmarkSnapshot.snapshot.market_snapshot.price_at_video;
    const benchmarkCurrent = positiveNumber(benchmarkQuote.current?.price, "benchmarkCurrent");
    const currentReturn = calculateReturn(entry, current);
    const benchmarkReturn = calculateReturn(benchmarkEntry, benchmarkCurrent);
    const peak = calculatePeakReturn(entry, history.bars, current);

    return {
      schema_version: 1,
      method_version: OUTCOME_METHOD_VERSION,
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
      current_price_timestamp: quote.current?.datetime || evaluatedAt,
      currency: quote.currency || snapshot.market_snapshot.currency,
      exchange: quote.exchange || snapshot.market_snapshot.exchange,
      current_return_pct: currentReturn,
      peak_price: peak.peak_price,
      peak_return_pct: peak.peak_return_pct,
      max_drawdown_pct: calculateMaxDrawdown(entry, history.bars, current),
      benchmark: {
        symbol: this.benchmarkSymbol,
        price_at_video: benchmarkEntry,
        current_price: benchmarkCurrent,
        return_pct: benchmarkReturn,
        alpha_pct_points: percentage(currentReturn - benchmarkReturn)
      },
      data_source: "twelve_data"
    };
  }
}

module.exports = {
  DEFAULT_BENCHMARK,
  OUTCOME_METHOD_VERSION,
  OutcomeService,
  calculateMaxDrawdown,
  calculatePeakReturn,
  calculateReturn
};
