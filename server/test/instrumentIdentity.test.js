const assert = require("node:assert/strict");
const test = require("node:test");
const {
  isLifecyclePerformanceBlocked,
  resolveInstrumentIdentity
} = require("../instruments/instrumentResolver");
const {
  createSnapshotDryRun,
  resolveSnapshotCandidate
} = require("../marketSnapshot/snapshotDryRun");

const VIDEO_ID = "J3Y_JBATcWg";

test("corrects the known Resolve AI extraction typo before provider access", () => {
  const identity = resolveInstrumentIdentity({
    company: "Resolve AI",
    ticker: "RZLB"
  }, {
    publishedAt: "2025-04-25T17:05:00.000Z",
    evaluatedAt: "2026-09-02T15:30:00.000Z"
  });

  assert.equal(identity.reported_symbol, "RZLB");
  assert.equal(identity.symbol_at_video, "RZLV");
  assert.equal(identity.current_symbol, "RZLV");
  assert.equal(identity.resolution_status, "symbol_corrected");
  assert.equal(identity.performance_continuity_verified, true);
  assert.equal(identity.warnings[0].code, "SYMBOL_CORRECTED");
});

test("resolves a historical SPAC symbol without claiming performance continuity", () => {
  const identity = resolveInstrumentIdentity({
    company: "Canter Equity Partners",
    ticker: "CEP"
  }, {
    publishedAt: "2025-04-25T17:05:00.000Z",
    evaluatedAt: "2026-09-02T15:30:00.000Z"
  });

  assert.equal(identity.canonical_asset_id, "asset_twenty_one_capital_inc");
  assert.equal(identity.symbol_at_video, "CEP");
  assert.equal(identity.current_symbol, "XXI");
  assert.equal(identity.resolution_status, "lifecycle_resolved");
  assert.equal(identity.continuity_status, "unverified_corporate_action");
  assert.equal(identity.performance_continuity_verified, false);
  assert.equal(isLifecyclePerformanceBlocked(identity), true);
});

test("passes through unmanaged symbols without altering identity", () => {
  const identity = resolveInstrumentIdentity({
    company: "Nvidia",
    ticker: "nvda"
  });

  assert.equal(identity.reported_symbol, "NVDA");
  assert.equal(identity.symbol_at_video, "NVDA");
  assert.equal(identity.current_symbol, "NVDA");
  assert.equal(identity.resolution_status, "passthrough");
});

test("snapshot candidates use the resolved provider symbol and keep the reported symbol", () => {
  const videos = {
    [VIDEO_ID]: {
      companies: [{ company: "Resolve AI", ticker: "RZLB" }]
    }
  };
  const candidate = resolveSnapshotCandidate(videos, {
    videoId: VIDEO_ID,
    companyIndex: 0
  });

  assert.equal(candidate.reportedTicker, "RZLB");
  assert.equal(candidate.ticker, "RZLV");
  assert.equal(candidate.instrument_identity.resolution_status, "symbol_corrected");
});

test("snapshot dry-run reports corrected symbols without rewriting stored reports", () => {
  const report = createSnapshotDryRun({
    [VIDEO_ID]: {
      video: { id: VIDEO_ID, published_at: "2025-04-25" },
      companies: [{ company: "Resolve AI", ticker: "RZLB" }]
    }
  });

  assert.equal(report.summary.snapshotCandidates, 1);
  assert.equal(report.candidates[0].reportedTicker, "RZLB");
  assert.equal(report.candidates[0].ticker, "RZLV");
});
