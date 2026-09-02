const {
  SNAPSHOT_SCHEMA_VERSION,
  SnapshotValidationError,
  createIntegrityHash,
  createSnapshotId,
  normalizeExactTimestamp,
  normalizeSymbol,
  validateSnapshot
} = require("./snapshotSchema");

const INTERVALS = ["1min", "5min", "15min", "30min", "1h"];
const PRECISION_BY_INTERVAL = {
  "1min": "intraday_1m",
  "5min": "intraday_5m",
  "15min": "intraday_15m",
  "30min": "intraday_30m",
  "1h": "intraday_1h"
};
const MAX_LOOKAHEAD_MS = 8 * 24 * 60 * 60 * 1000;

class MarketSnapshotUnavailableError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "MarketSnapshotUnavailableError";
    this.code = options.code || "HISTORICAL_INTRADAY_UNAVAILABLE";
    this.retryable = options.retryable !== false;
    this.attempts = options.attempts || [];
  }
}

function selectFirstTradableBar(bars, publishedAt) {
  const publishedMilliseconds = Date.parse(publishedAt);

  return (Array.isArray(bars) ? bars : [])
    .filter(bar =>
      bar?.timestamp &&
      Number.isFinite(Date.parse(bar.timestamp)) &&
      typeof bar.open === "number" &&
      Number.isFinite(bar.open) &&
      bar.open > 0 &&
      Date.parse(bar.timestamp) >= publishedMilliseconds
    )
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))[0] || null;
}

class MarketSnapshotService {
  constructor({ provider, repository, youtubeMetadataService, clock } = {}) {
    if (!provider || typeof provider.getHistoricalBars !== "function") {
      throw new Error("MarketSnapshotService benötigt einen Market-Data-Provider.");
    }

    if (!repository || typeof repository.create !== "function") {
      throw new Error("MarketSnapshotService benötigt ein SnapshotRepository.");
    }

    this.provider = provider;
    this.repository = repository;
    this.youtubeMetadataService = youtubeMetadataService || null;
    this.clock = typeof clock === "function" ? clock : () => new Date();
    this.captureLocks = new Map();
  }

  async captureForVideoCall({ videoId, callId, ticker }) {
    const metadata = await this.getVerifiedPublication(videoId);

    return this.captureFromVerifiedTimestamp({
      videoId,
      callId,
      ticker,
      publishedAt: metadata.publishedAt,
      publishedAtSource: metadata.publishedAtSource
    });
  }

  async getVerifiedPublication(videoId) {
    if (!this.youtubeMetadataService) {
      throw new Error("YouTubeMetadataService fehlt.");
    }

    return this.youtubeMetadataService.getVideo(videoId);
  }

  async captureFromVerifiedTimestamp({
    videoId,
    callId,
    ticker,
    publishedAt,
    publishedAtSource
  }) {
    if (publishedAtSource !== "youtube_api") {
      throw new SnapshotValidationError(
        "MarketSnapshot verlangt publishedAtSource=youtube_api.",
        "UNVERIFIED_PUBLICATION_TIMESTAMP"
      );
    }

    const normalizedPublishedAt = normalizeExactTimestamp(publishedAt, "publishedAt");
    const normalizedSymbol = normalizeSymbol(ticker);
    const snapshotId = createSnapshotId({
      videoId,
      callId,
      symbol: normalizedSymbol,
      publishedAt: normalizedPublishedAt
    });
    const existingLock = this.captureLocks.get(snapshotId);

    if (existingLock) {
      return existingLock;
    }

    const capture = this.captureSnapshot({
      videoId,
      callId,
      normalizedSymbol,
      normalizedPublishedAt,
      snapshotId
    });
    this.captureLocks.set(snapshotId, capture);

    try {
      return await capture;
    } finally {
      this.captureLocks.delete(snapshotId);
    }
  }

  async captureSnapshot({
    videoId,
    callId,
    normalizedSymbol,
    normalizedPublishedAt,
    snapshotId
  }) {
    const existing = await this.repository.get(snapshotId);

    if (existing) {
      return { created: false, snapshot: existing };
    }

    const startAt = new Date(normalizedPublishedAt);
    const endAt = new Date(startAt.getTime() + MAX_LOOKAHEAD_MS);
    const attempts = [];

    for (const interval of INTERVALS) {
      let result;

      try {
        result = await this.provider.getHistoricalBars({
          symbol: normalizedSymbol,
          startAt,
          endAt,
          interval
        });
      } catch (error) {
        attempts.push({
          interval,
          status: "error",
          code: error?.code || "PROVIDER_ERROR"
        });

        // A provider/API failure is independent of the requested bar interval.
        // Trying all fallback intervals would only spend more credits for the
        // same failed symbol. Interval fallback is reserved for valid, empty
        // responses where no tradable bar was found.
        throw error;
      }

      const bar = selectFirstTradableBar(result.bars, normalizedPublishedAt);
      attempts.push({
        interval,
        status: bar ? "captured" : "no_bar"
      });

      if (!bar) {
        continue;
      }

      if (!result.currency || !result.exchange) {
        throw new MarketSnapshotUnavailableError(
          "Market-Data-Metadaten enthalten Börse oder Währung nicht.",
          {
            code: "INCOMPLETE_INSTRUMENT_METADATA",
            retryable: false,
            attempts
          }
        );
      }

      const lagSeconds = Math.floor(
        (Date.parse(bar.timestamp) - Date.parse(normalizedPublishedAt)) / 1000
      );
      const snapshot = {
        schema_version: SNAPSHOT_SCHEMA_VERSION,
        snapshot_id: snapshotId,
        video_id: videoId,
        call_id: callId,
        ticker: normalizedSymbol,
        published_at: normalizedPublishedAt,
        market_snapshot: {
          price_at_video: bar.open,
          timestamp: normalizeExactTimestamp(bar.timestamp, "bar.timestamp"),
          captured_at: normalizeExactTimestamp(this.clock().toISOString(), "captured_at"),
          currency: result.currency,
          exchange: result.exchange,
          symbol: normalizeSymbol(result.symbol || normalizedSymbol),
          price_field: "open",
          bar_interval: interval,
          session: /crypto|digital currency|physical currency/iu.test(
            String(result.instrumentType || "")
          )
            ? "continuous"
            : "regular",
          adjustment: "provider_default",
          selection_policy: "first_tradable_bar_at_or_after_publication",
          publication_lag_seconds: lagSeconds,
          data_source: {
            provider: result.provider || "unknown",
            endpoint: result.endpoint || "historical_bars"
          },
          quality: {
            precision: PRECISION_BY_INTERVAL[interval],
            fallback: interval === "1min" ? null : `1min_unavailable:${interval}`
          },
          integrity_sha256: ""
        }
      };

      snapshot.market_snapshot.integrity_sha256 = createIntegrityHash(snapshot);
      validateSnapshot(snapshot);
      return this.repository.create(snapshot);
    }

    throw new MarketSnapshotUnavailableError(
      "Kein handelbarer Intraday-Kurs nach Veröffentlichung verfügbar.",
      { attempts }
    );
  }
}

module.exports = {
  INTERVALS,
  MarketSnapshotService,
  MarketSnapshotUnavailableError,
  PRECISION_BY_INTERVAL,
  selectFirstTradableBar
};
