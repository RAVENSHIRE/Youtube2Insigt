const INSTRUMENT_IDENTITY_VERSION = 1;

const INSTRUMENT_REGISTRY = Object.freeze([
  {
    canonical_asset_id: "asset_rezolve_ai_ltd",
    issuer_name: "Rezolve AI Limited",
    aliases: {
      symbols: ["RZLV", "RZLB"],
      names: ["rezolve ai", "resolve ai", "resolve airzlb"]
    },
    symbol_corrections: [
      {
        reported_symbol: "RZLB",
        corrected_symbol: "RZLV",
        reason: "known_extraction_typo"
      }
    ],
    lifecycle: [
      {
        symbol: "RZLV",
        exchange: "NASDAQ",
        valid_from: "2024-08-16T00:00:00.000Z",
        valid_to: null,
        status: "active_listing"
      }
    ],
    continuity_status: "same_security",
    sources: [
      "https://rezolve.com/about/"
    ]
  },
  {
    canonical_asset_id: "asset_twenty_one_capital_inc",
    issuer_name: "Twenty One Capital Inc.",
    aliases: {
      symbols: ["CEP", "XXI"],
      names: ["canter equity partners", "twenty one capital", "21 capital"]
    },
    lifecycle: [
      {
        symbol: "CEP",
        exchange: "NASDAQ",
        valid_from: "2021-12-01T00:00:00.000Z",
        valid_to: "2025-12-09T00:00:00.000Z",
        status: "spac_pre_combination"
      },
      {
        symbol: "XXI",
        exchange: "NYSE",
        valid_from: "2025-12-09T00:00:00.000Z",
        valid_to: null,
        status: "post_combination_listing"
      }
    ],
    corporate_actions: [
      {
        type: "business_combination",
        effective_at: "2025-12-09T00:00:00.000Z",
        from_symbol: "CEP",
        to_symbol: "XXI",
        continuity_status: "unverified",
        reason: "spac_combination_requires_reviewed_conversion_terms"
      }
    ],
    continuity_status: "unverified_corporate_action",
    sources: [
      "https://www.sec.gov/Archives/edgar/data/1865602/000121390025034374/ea023922201ex99-1_cantor.htm",
      "https://www.sec.gov/Archives/edgar/data/2070457/000121390025119445/ea026879401ex99-1_twenty.htm"
    ]
  }
]);

module.exports = {
  INSTRUMENT_IDENTITY_VERSION,
  INSTRUMENT_REGISTRY
};
