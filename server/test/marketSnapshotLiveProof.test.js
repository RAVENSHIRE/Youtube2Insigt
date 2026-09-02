const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createIntegrityHash,
  createSnapshotId
} = require("../marketSnapshot/snapshotSchema");
const {
  parseArguments,
  runLiveProof
} = require("../scripts/verify-live-market-snapshot");

const BASE_URL = "http://localhost:3000";
const VIDEO_ID = "4u8dR2Dxcdc";
const PUBLISHED_AT = "2026-08-31T14:32:18.000Z";

function createSnapshot(overrides = {}) {
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
    published_at: PUBLISHED_AT,
    market_snapshot: {
      price_at_video: 182.41,
      timestamp: "2026-08-31T14:33:00.000Z",
      captured_at: "2026-09-02T08:00:00.000Z",
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

  Object.assign(snapshot.market_snapshot, overrides);
  snapshot.market_snapshot.integrity_sha256 = createIntegrityHash(snapshot);
  return snapshot;
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return structuredClone(body);
    }
  };
}

function createSuccessfulFetch(options = {}) {
  const firstSnapshot = options.firstSnapshot || createSnapshot();
  const replaySnapshot = options.replaySnapshot || firstSnapshot;
  let captureCount = 0;

  const fetchImpl = async (input, request = {}) => {
    const url = new URL(input);

    if (url.pathname === "/market-snapshots/health") {
      return response(200, {
        status: "ready",
        schemaVersion: 1,
        storageConfigured: true,
        marketProviderConfigured: true,
        youtubeMetadataConfigured: true,
        immutableWrites: true,
        selectionPolicy: "first_tradable_bar_at_or_after_publication"
      });
    }

    if (url.pathname === "/creators") {
      return response(200, {
        creators: [{ creatorId: "creator_01", name: "Business With Brian" }]
      });
    }

    if (url.pathname === "/creators/creator_01/dashboard") {
      return response(200, {
        videos: [{
          id: VIDEO_ID,
          title: "Research Video",
          publishedAt: PUBLISHED_AT,
          companies: [
            { company: "Unknown", ticker: "ZZZZ" },
            { company: "Nvidia", ticker: "NVDA" }
          ]
        }]
      });
    }

    if (url.pathname === "/market-snapshots/capture" && request.method === "POST") {
      const payload = JSON.parse(request.body);
      assert.deepEqual(payload, { videoId: VIDEO_ID, companyIndex: 1 });
      captureCount += 1;
      const snapshot = captureCount === 1 ? firstSnapshot : replaySnapshot;
      const created = captureCount === 1;
      return response(created ? 201 : 200, {
        market_snapshot_status: "captured",
        market_snapshot_id: snapshot.snapshot_id,
        created,
        company_index: 1,
        company: "Nvidia",
        ticker: "NVDA",
        snapshot
      });
    }

    if (url.pathname === `/market-snapshots/${firstSnapshot.snapshot_id}`) {
      return response(200, replaySnapshot);
    }

    throw new Error(`Unexpected request: ${request.method || "GET"} ${url.pathname}`);
  };

  fetchImpl.captureCount = () => captureCount;
  return fetchImpl;
}

test("proves a live create, idempotent replay and immutable read-back", async () => {
  const fetchImpl = createSuccessfulFetch();
  const proof = await runLiveProof({ baseUrl: BASE_URL, fetchImpl });

  assert.equal(proof.status, "verified");
  assert.equal(proof.candidate.ticker, "NVDA");
  assert.equal(proof.candidate.company_index, 1);
  assert.equal(proof.capture.first_created, true);
  assert.equal(proof.capture.first_http_status, 201);
  assert.equal(proof.capture.replay_created, false);
  assert.equal(proof.capture.replay_http_status, 200);
  assert.equal(proof.integrity.replay_matches, true);
  assert.equal(proof.integrity.readback_matches, true);
  assert.equal(fetchImpl.captureCount(), 2);
  assert.equal(JSON.stringify(proof).includes("API_KEY"), false);
});

test("stops before capture when a dependency is not ready", async () => {
  const fetchImpl = async input => {
    const url = new URL(input);
    assert.equal(url.pathname, "/market-snapshots/health");
    return response(200, {
      status: "configuration_required",
      storageConfigured: true,
      marketProviderConfigured: false,
      youtubeMetadataConfigured: true,
      immutableWrites: true
    });
  };

  await assert.rejects(
    () => runLiveProof({ baseUrl: BASE_URL, fetchImpl }),
    error => error.code === "SNAPSHOT_NOT_READY" &&
      error.details.marketProviderConfigured === false
  );
});

test("fails if the persisted snapshot changes during replay", async () => {
  const firstSnapshot = createSnapshot();
  const replaySnapshot = createSnapshot({ captured_at: "2026-09-02T08:01:00.000Z" });
  const fetchImpl = createSuccessfulFetch({ firstSnapshot, replaySnapshot });

  await assert.rejects(
    () => runLiveProof({ baseUrl: BASE_URL, fetchImpl }),
    error => error.code === "NON_IDEMPOTENT_REPLAY"
  );
});

test("parses an explicit candidate and requires both identity fields", () => {
  const options = parseArguments([
    "--base-url", "http://localhost:3000/",
    "--video-id", VIDEO_ID,
    "--company-index", "4",
    "--ticker", "nvda"
  ]);

  assert.equal(options.baseUrl, BASE_URL);
  assert.equal(options.companyIndex, 4);
  assert.equal(options.preferredTicker, "NVDA");
  assert.throws(
    () => parseArguments(["--video-id", VIDEO_ID]),
    error => error.code === "INCOMPLETE_CANDIDATE"
  );
});
