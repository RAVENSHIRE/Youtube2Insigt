const TICKER_TAXONOMY = Object.freeze({
  BTC: ["Digital Assets", "Cryptocurrencies"],
  ETH: ["Digital Assets", "Smart Contract Networks"],
  XLM: ["Digital Assets", "Payment Networks"],
  XRP: ["Digital Assets", "Payment Networks"],

  AUR: ["Industrials", "Autonomous Mobility"],
  GPRO: ["Consumer Discretionary", "Consumer Electronics"],
  HTZ: ["Industrials", "Passenger Transportation"],
  KDK: ["Industrials", "Autonomous Mobility"],
  MBLY: ["Technology", "Autonomous Driving Technology"],
  SMCI: ["Technology", "Computer Hardware"],
  TSLA: ["Consumer Discretionary", "Automobiles"],

  AAPL: ["Technology", "Hardware & Devices"],
  AMD: ["Technology", "Semiconductors"],
  AVGO: ["Technology", "Semiconductors"],
  CRM: ["Technology", "Enterprise Software"],
  CRWD: ["Technology", "Cybersecurity"],
  IBM: ["Technology", "IT Services"],
  INTU: ["Technology", "Financial Software"],
  LRCX: ["Technology", "Semiconductor Equipment"],
  MSFT: ["Technology", "Enterprise Software"],
  MU: ["Technology", "Semiconductors"],
  NVDA: ["Technology", "Semiconductors"],
  PANW: ["Technology", "Cybersecurity"],
  SAP: ["Technology", "Enterprise Software"],
  TTD: ["Technology", "Advertising Technology"],
  ZM: ["Technology", "Communication Software"],

  GOOGL: ["Communication Services", "Digital Platforms"],
  META: ["Communication Services", "Social Platforms"],
  TMUS: ["Communication Services", "Telecommunications"],

  ABNB: ["Consumer Discretionary", "Travel Platforms"],
  AMZN: ["Consumer Discretionary", "E-Commerce"],
  BABA: ["Consumer Discretionary", "E-Commerce"],
  BMW: ["Consumer Discretionary", "Automobiles"],
  CON: ["Consumer Discretionary", "Automotive Suppliers"],
  KSS: ["Consumer Discretionary", "Retail"],
  LULU: ["Consumer Discretionary", "Apparel"],
  NIO: ["Consumer Discretionary", "Automobiles"],
  NKE: ["Consumer Discretionary", "Apparel"],
  SE: ["Consumer Discretionary", "E-Commerce"],
  TGT: ["Consumer Staples", "Retail"],
  UBER: ["Consumer Discretionary", "Mobility Platforms"],
  VOW3: ["Consumer Discretionary", "Automobiles"],
  WMT: ["Consumer Staples", "Retail"],
  BEI: ["Consumer Staples", "Personal Care"],
  "BF.B": ["Consumer Staples", "Beverages"],
  KO: ["Consumer Staples", "Beverages"],

  AMGN: ["Health Care", "Biotechnology"],
  BAYN: ["Health Care", "Pharmaceuticals"],
  FME: ["Health Care", "Health Care Services"],
  MRNA: ["Health Care", "Biotechnology"],
  QIA: ["Health Care", "Diagnostics"],
  SRT3: ["Health Care", "Life Science Tools"],

  CBK: ["Financials", "Banks"],
  COIN: ["Financials", "Digital Asset Platforms"],
  DBK: ["Financials", "Banks"],
  HOOD: ["Financials", "Brokerage Platforms"],
  MSTR: ["Financials", "Digital Asset Treasury"],

  AXON: ["Industrials", "Security Equipment"],
  DEZ: ["Industrials", "Machinery"],
  HAG: ["Industrials", "Aerospace & Defense"],
  RHM: ["Industrials", "Aerospace & Defense"],

  BNR: ["Materials", "Chemicals Distribution"],
  GOLD: ["Materials", "Gold Mining"],
  NDA: ["Materials", "Metals"],
  NEM: ["Materials", "Gold Mining"],
  SZG: ["Materials", "Steel"],
  TKA: ["Materials", "Steel"],

  EOAN: ["Utilities", "Electric Utilities"],
  FSLR: ["Energy", "Solar Energy"],
  S92: ["Energy", "Solar Energy"],
  SEDG: ["Energy", "Solar Energy"],
  XOM: ["Energy", "Integrated Oil & Gas"]
});

const NAME_TAXONOMY = Object.freeze({
  "aurora innovation": ["Industrials", "Autonomous Mobility"],
  "aurora innovations": ["Industrials", "Autonomous Mobility"],
  circle: ["Financials", "Digital Asset Infrastructure"],
  coreweave: ["Technology", "Cloud Infrastructure"],
  gold: ["Commodities", "Precious Metals"],
  hype: ["Digital Assets", "Crypto Networks"],
  kanton: ["Digital Assets", "Blockchain Infrastructure"],
  "kodiak ai": ["Industrials", "Autonomous Mobility"],
  "kodiak robotics": ["Industrials", "Autonomous Mobility"],
  spacex: ["Industrials", "Aerospace & Defense"],
  "wti ol": ["Commodities", "Energy Commodities"]
});

const ASSET_FALLBACKS = Object.freeze({
  crypto: ["Digital Assets", "Cryptocurrencies"],
  commodity: ["Commodities", "Other Commodities"],
  etf: ["Funds", "ETFs"],
  index: ["Indices", "Market Indices"],
  stock: ["Other", "Unclassified Equities"],
  other: ["Other", "Unclassified Assets"]
});

function cleanString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeIdentity(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function classifyCompany(company = {}) {
  const storedSector = cleanString(company.sector);
  const storedSubSector = cleanString(company.sub_sector || company.subSector);

  if (storedSector && storedSubSector) {
    return {
      sector: storedSector,
      sub_sector: storedSubSector,
      classification_source: "analysis"
    };
  }

  const ticker = cleanString(company.ticker)?.toUpperCase();
  const mapped = (ticker && TICKER_TAXONOMY[ticker]) ||
    NAME_TAXONOMY[normalizeIdentity(company.company)];
  const fallback = mapped || ASSET_FALLBACKS[company.asset_type] || ASSET_FALLBACKS.other;

  return {
    sector: storedSector || fallback[0],
    sub_sector: storedSubSector || fallback[1],
    classification_source: mapped ? "taxonomy" : "asset_fallback"
  };
}

module.exports = {
  classifyCompany
};
