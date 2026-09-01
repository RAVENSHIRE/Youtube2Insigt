const assert = require("node:assert/strict");
const test = require("node:test");
const { classifyCompany } = require("../classification/sectorTaxonomy");

test("uses stored sector classification as the authoritative source", () => {
  assert.deepEqual(
    classifyCompany({
      ticker: "NVDA",
      sector: "Custom Sector",
      sub_sector: "Custom Sub-Sector"
    }),
    {
      sector: "Custom Sector",
      sub_sector: "Custom Sub-Sector",
      classification_source: "analysis"
    }
  );
});

test("classifies known legacy tickers without changing stored reports", () => {
  assert.deepEqual(classifyCompany({ ticker: "NVDA", asset_type: "stock" }), {
    sector: "Technology",
    sub_sector: "Semiconductors",
    classification_source: "taxonomy"
  });
});

test("keeps commodity gold separate from the GOLD equity ticker", () => {
  assert.equal(
    classifyCompany({ company: "Gold", asset_type: "commodity" }).sector,
    "Commodities"
  );
  assert.equal(
    classifyCompany({ company: "Barrick Gold", ticker: "GOLD", asset_type: "stock" }).sector,
    "Materials"
  );
});

test("falls back explicitly for an unknown asset", () => {
  assert.deepEqual(classifyCompany({ company: "Unknown", asset_type: "stock" }), {
    sector: "Other",
    sub_sector: "Unclassified Equities",
    classification_source: "asset_fallback"
  });
});

test("classifies the IPO Market Watch legacy assets", () => {
  const expected = {
    GPRO: ["Consumer Discretionary", "Consumer Electronics"],
    HTZ: ["Industrials", "Passenger Transportation"],
    KDK: ["Industrials", "Autonomous Mobility"],
    MBLY: ["Technology", "Autonomous Driving Technology"],
    SMCI: ["Technology", "Computer Hardware"],
    TSLA: ["Consumer Discretionary", "Automobiles"]
  };

  for (const [ticker, [sector, subSector]] of Object.entries(expected)) {
    const classification = classifyCompany({ ticker, asset_type: "stock" });
    assert.equal(classification.sector, sector);
    assert.equal(classification.sub_sector, subSector);
  }

  assert.equal(
    classifyCompany({ company: "Aurora Innovations", asset_type: "stock" }).sector,
    "Industrials"
  );
});
