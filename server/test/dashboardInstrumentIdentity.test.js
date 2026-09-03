const assert = require("node:assert/strict");
const test = require("node:test");
const {
  projectCompanyForRead,
  projectResearchForRead
} = require("../instruments/instrumentProjection");

const VIDEO_ID = "J3Y_JBATcWg";

function createResearch(companies) {
  return {
    video: {
      id: VIDEO_ID,
      title: "Instrument identity",
      creator: "IPO Market Watch",
      published_at: "2025-04-25T17:05:00.000Z",
      analyzed_at: "2026-09-02T15:30:00.000Z"
    },
    summary: "Stored extraction remains immutable.",
    companies
  };
}

test("projects corrected symbols into dashboard reads without mutating storage", () => {
  const stored = createResearch([{
    company: "Resolve AI",
    ticker: "RZLB",
    sentiment: "bull",
    asset_type: "stock"
  }]);

  const projected = projectResearchForRead(stored);

  assert.equal(stored.companies[0].ticker, "RZLB");
  assert.equal(projected.companies[0].ticker, "RZLV");
  assert.equal(projected.companies[0].reported_symbol, "RZLB");
});

test("projects lifecycle metadata while retaining the historical SPAC symbol", () => {
  const stored = createResearch([{
    company: "Canter Equity Partners",
    ticker: "CEP",
    sentiment: "bull",
    asset_type: "stock"
  }]);

  const projected = projectResearchForRead(stored);
  const company = projected.companies[0];

  assert.equal(company.ticker, "CEP");
  assert.equal(company.instrument_identity.symbol_at_video, "CEP");
  assert.equal(company.instrument_identity.current_symbol, "XXI");
  assert.equal(company.instrument_identity.performance_continuity_verified, false);
});

test("keeps unmanaged symbols unchanged in the read projection", () => {
  const stored = { company: "Nvidia", ticker: "NVDA" };
  const projected = projectCompanyForRead(stored, "2026-08-26T16:22:01.000Z");

  assert.deepEqual(projected, stored);
});
