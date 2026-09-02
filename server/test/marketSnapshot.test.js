const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  MarketSnapshotService,
  selectFirstTradableBar
} = require("../marketSnapshot/marketSnapshotService");
const {
  SnapshotConflictError,
  SnapshotRepository
} = require("../marketSnapshot/snapshotRepository");
const {
  SnapshotValidationError,
  createIntegrityHash,
  createSnapshotId,
  normalizeExactTimestamp,
  validateSnapshot
} = require("../marketSnapshot/snapshotSchema");
const {
  createSnapshotDryRun,
  resolveSnapshotCandidate,
  timestampStatus
} = require("../marketSnapshot/snapshotDryRun");
const {
  TwelveDataProvider,
  parseUtcDateTime
} = require("../providers/twelveDataProvider");
const { YouTubeMetadataService } = require("../services/youtubeMetadataService");
const { parseArguments } = require("../scripts/market-snapshot-dry-run");

const VIDEO_ID = "4u8dR2Dxcdc";
const PUBLISHED_AT = "2026-08-31T14:32:18Z";

function createTempRoot(t) {
  const tempBase = path.join(__dirname, ".tmp");
  fs.mkdirSync(tempBase, { recursive: true });
  const root = fs.mkdtempSync(path.join(tempBase, "market-snapshot-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function providerResult(interval, bars) {
  return {
    provider: "twelve_data",
    endpoint: "time_series",
    symbol: "NVDA",
    exchange: "NASDAQ",
    currency: "USD",
    interval,
    bars
  };
}

function validSnapshot() {
  const snapshot = {
    schema_version: 1,
    snapshot_id: createSnapshotId({
      videoId: VIDEO_ID,
      callId: "call_nvda_01",
      symbol: "NVDA",
      publishedAt: PUBLISHED_AT
    }),
    video_id: VIDEO_ID,
    call_id: "call_nvda_01",
    ticker: "NVDA",
    published_at: "2026-08-31T14:32:18.000Z",
    market_snapshot: {
      price_at_video: 182.41,
      timestamp: "2026-08-31T14:33:00.000Z",
      captured_at: "2026-09-01T14:35:03.000Z",
      currency: "USD",
      exchange: "NASDAQ",
      symbol: "NVDA",
      price_field: "open",
      bar_interval: "1min",
      session: "regular",
      adjustment: "provider_default",
      selection_policy: "first_tradable_bar_at_or_after_publication",
      publication_lag_seconds: 42,
      data_source: {
        provider: "twelve_data",
        endpoint: "time_series"
      },
      quality: {
        precision: "intraday_1m",
        fallback: null
      },
      integrity_sha256: ""
    }
  };
  snapshot.market_snapshot.integrity_sha256 = createIntegrityHash(snapshot);
  return snapshot;
}

test("requires an exact ISO publication timestamp with timezone", () => {
  assert.throws(
    () => normalizeExactTimestamp("2026-08-31", "publishedAt"),
    error => error instanceof SnapshotValidationError && error.code === "INEXACT_TIMESTAMP"
  );
  assert.equal(
    normalizeExactTimestamp(PUBLISHED_AT),
    "2026-08-31T14:32:18.000Z"
  );
});

test("creates deterministic snapshot IDs and validates integrity", () => {
  const first = createSnapshotId({
    videoId: VIDEO_ID,
    callId: "call_nvda_01",
    symbol: "nvda",
    publishedAt: PUBLISHED_AT
  });
  const second = createSnapshotId({
    videoId: VIDEO_ID,
    callId: "call_nvda_01",
    symbol: "NVDA",
    publishedAt: "2026-08-31T16:32:18+02:00"
  });

  assert.equal(first, second);
  assert.equal(validateSnapshot(validSnapshot()).snapshot_id, first);
});

test("writes snapshots once and returns an idempotent result", async t => {
  const repository = new SnapshotRepository(createTempRoot(t));
  const snapshot = validSnapshot();
  const first = await repository.create(snapshot);
  const second = await repository.create(snapshot);

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(Object.isFrozen(second.snapshot), true);
});

test("rejects an overwrite with different valid snapshot content", async t => {
  const repository = new SnapshotRepository(createTempRoot(t));
  const snapshot = validSnapshot();
  await repository.create(snapshot);
  const conflicting = structuredClone(snapshot);
  conflicting.market_snapshot.price_at_video = 190;
  conflicting.market_snapshot.integrity_sha256 = createIntegrityHash(conflicting);

  await assert.rejects(
    () => repository.create(conflicting),
    error => error instanceof SnapshotConflictError
  );
});

test("detects a tampered snapshot on read", async t => {
  const root = createTempRoot(t);
  const repository = new SnapshotRepository(root);
  const snapshot = validSnapshot();
  await repository.create(snapshot);
  const snapshotPath = repository.getPath(snapshot.snapshot_id);
  const tampered = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  tampered.market_snapshot.price_at_video = 1;
  fs.writeFileSync(snapshotPath, JSON.stringify(tampered, null, 2), "utf8");

  await assert.rejects(
    () => repository.get(snapshot.snapshot_id),
    error => error.code === "SNAPSHOT_INTEGRITY_MISMATCH"
  );
});

test("selects the first bar at or after publication, never the earlier bar", () => {
  const selected = selectFirstTradableBar([
    { timestamp: "2026-08-31T14:32:00.000Z", open: 181 },
    { timestamp: "2026-08-31T14:33:00.000Z", open: 182.41 }
  ], PUBLISHED_AT);

  assert.equal(selected.open, 182.41);
});

test("captures and persists the first tradable 1-minute bar", async t => {
  const repository = new SnapshotRepository(createTempRoot(t));
  const provider = {
    async getHistoricalBars({ interval }) {
      return providerResult(interval, [
        { timestamp: "2026-08-31T14:32:00.000Z", open: 181 },
        { timestamp: "2026-08-31T14:33:00.000Z", open: 182.41 }
      ]);
    }
  };
  const service = new MarketSnapshotService({
    provider,
    repository,
    youtubeMetadataService: {
      async getVideo() {
        return {
          publishedAt: PUBLISHED_AT,
          publishedAtSource: "youtube_api"
        };
      }
    },
    clock: () => new Date("2026-09-01T14:35:03Z")
  });
  const result = await service.captureForVideoCall({
    videoId: VIDEO_ID,
    callId: "call_nvda_01",
    ticker: "NVDA"
  });

  assert.equal(result.created, true);
  assert.equal(result.snapshot.market_snapshot.price_at_video, 182.41);
  assert.equal(result.snapshot.market_snapshot.publication_lag_seconds, 42);
  assert.equal(result.snapshot.market_snapshot.quality.fallback, null);
});

test("marks a coarser successful interval as an explicit fallback", async t => {
  const repository = new SnapshotRepository(createTempRoot(t));
  const provider = {
    async getHistoricalBars({ interval }) {
      return interval === "1min"
        ? providerResult(interval, [])
        : providerResult(interval, [
            { timestamp: "2026-08-31T14:35:00.000Z", open: 183 }
          ]);
    }
  };
  const service = new MarketSnapshotService({
    provider,
    repository,
    clock: () => new Date("2026-09-01T14:35:03Z")
  });
  const result = await service.captureFromVerifiedTimestamp({
    videoId: VIDEO_ID,
    callId: "call_nvda_01",
    ticker: "NVDA",
    publishedAt: PUBLISHED_AT,
    publishedAtSource: "youtube_api"
  });

  assert.equal(result.snapshot.market_snapshot.bar_interval, "5min");
  assert.equal(result.snapshot.market_snapshot.quality.precision, "intraday_5m");
  assert.equal(result.snapshot.market_snapshot.quality.fallback, "1min_unavailable:5min");
});

test("deduplicates concurrent capture requests before provider access", async t => {
  const repository = new SnapshotRepository(createTempRoot(t));
  let providerCalls = 0;
  const provider = {
    async getHistoricalBars({ interval }) {
      providerCalls += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      return providerResult(interval, [
        { timestamp: "2026-08-31T14:33:00.000Z", open: 182.41 }
      ]);
    }
  };
  const service = new MarketSnapshotService({
    provider,
    repository,
    clock: () => new Date("2026-09-01T14:35:03Z")
  });
  const input = {
    videoId: VIDEO_ID,
    callId: "call_nvda_01",
    ticker: "NVDA",
    publishedAt: PUBLISHED_AT,
    publishedAtSource: "youtube_api"
  };
  const [first, second] = await Promise.all([
    service.captureFromVerifiedTimestamp(input),
    service.captureFromVerifiedTimestamp(input)
  ]);

  assert.equal(providerCalls, 1);
  assert.equal(first.snapshot.snapshot_id, second.snapshot.snapshot_id);
});

test("rejects timestamps that were not verified by the YouTube API", async t => {
  const repository = new SnapshotRepository(createTempRoot(t));
  const service = new MarketSnapshotService({
    provider: { async getHistoricalBars() { return providerResult("1min", []); } },
    repository
  });

  await assert.rejects(
    () => service.captureFromVerifiedTimestamp({
      videoId: VIDEO_ID,
      callId: "call_nvda_01",
      ticker: "NVDA",
      publishedAt: PUBLISHED_AT,
      publishedAtSource: "youtube_dom"
    }),
    error => error.code === "UNVERIFIED_PUBLICATION_TIMESTAMP"
  );
});

test("reads exact publication timestamp from the YouTube API", async () => {
  let requestedUrl;
  let requestedApiKey;
  const service = new YouTubeMetadataService({
    apiKey: "test-key",
    fetchImpl: async (url, options) => {
      requestedUrl = url;
      requestedApiKey = options.headers["x-goog-api-key"];
      return {
        ok: true,
        async json() {
          return {
            items: [{
              snippet: {
                publishedAt: PUBLISHED_AT,
                channelId: "UC1234567890123456789012",
                channelTitle: "Test Channel",
                title: "Test Video"
              }
            }]
          };
        }
      };
    }
  });
  const result = await service.getVideo(VIDEO_ID);

  assert.equal(result.publishedAt, PUBLISHED_AT);
  assert.equal(result.publishedAtSource, "youtube_api");
  assert.equal(result.channelTitle, "Test Channel");
  assert.equal(requestedUrl.searchParams.get("part"), "snippet");
  assert.equal(requestedUrl.searchParams.has("key"), false);
  assert.equal(requestedApiKey, "test-key");
});

test("normalizes Twelve Data UTC bars and sends bounded history parameters", async () => {
  let requestedUrl;
  let authorization;
  const provider = new TwelveDataProvider({
    apiKey: "test-key",
    fetchImpl: async (url, options) => {
      requestedUrl = url;
      authorization = options.headers.Authorization;
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            meta: {
              symbol: "NVDA",
              exchange: "NASDAQ",
              currency: "USD",
              interval: "1min"
            },
            values: [{
              datetime: "2026-08-31 14:33:00",
              open: "182.41",
              high: "183",
              low: "182",
              close: "182.9",
              volume: "1000"
            }]
          };
        }
      };
    }
  });
  const result = await provider.getHistoricalBars({
    symbol: "NVDA",
    startAt: PUBLISHED_AT,
    endAt: "2026-09-01T14:32:18Z",
    interval: "1min"
  });

  assert.equal(parseUtcDateTime("2026-08-31 14:33:00"), "2026-08-31T14:33:00.000Z");
  assert.equal(result.bars[0].open, 182.41);
  assert.equal(requestedUrl.pathname, "/time_series");
  assert.equal(requestedUrl.searchParams.get("timezone"), "UTC");
  assert.equal(requestedUrl.searchParams.get("order"), "ASC");
  assert.equal(authorization, "apikey test-key");
});

test("dry-run plans no writes and reports timestamp quality", () => {
  const report = createSnapshotDryRun({
    [VIDEO_ID]: {
      video: {
        id: VIDEO_ID,
        published_at: "2026-08-31"
      },
      companies: [
        { company: "Nvidia", ticker: "NVDA" },
        { company: "Unknown", ticker: null }
      ]
    }
  });

  assert.equal(timestampStatus("2026-08-31"), "date_only");
  assert.equal(report.summary.snapshotCandidates, 1);
  assert.equal(report.summary.missingTicker, 1);
  assert.equal(report.summary.writesPerformed, false);
  assert.equal(report.candidates[0].nextAction, "fetch_youtube_published_at_then_market_snapshot");
});

test("resolves snapshot identity only from a stored report company", () => {
  const videos = {
    [VIDEO_ID]: {
      companies: [{ company: "Nvidia", ticker: "nvda" }]
    }
  };
  const candidate = resolveSnapshotCandidate(videos, {
    videoId: VIDEO_ID,
    companyIndex: 0
  });

  assert.equal(candidate.ticker, "NVDA");
  assert.match(candidate.callId, /^call_[a-f0-9]{24}$/u);
  assert.throws(
    () => resolveSnapshotCandidate(videos, {
      videoId: VIDEO_ID,
      companyIndex: 1
    }),
    error => error.code === "COMPANY_NOT_FOUND"
  );
});

test("rejects apply mode during the dry-run-only phase", () => {
  assert.throws(
    () => parseArguments(["--apply"]),
    /gesperrt/u
  );
});
