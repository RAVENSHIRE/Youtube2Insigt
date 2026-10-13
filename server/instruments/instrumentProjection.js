const { resolveInstrumentIdentity } = require("./instrumentResolver");
const { tradingViewLink, identityConflict } = require("./marketIdentity");
const { commodityTradingView } = require("./commodityTradingView");

function cleanString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// Narrow, source-backed recovery for issuers whose spoken symbols were omitted by the model.
// Never infer a ticker from the company name alone or overwrite an existing ticker.
const SPOKEN_LISTINGS = Object.freeze([
  { name: 'volato group', ticker: 'SOAR', exchange: 'AMEX' },
  { name: 'hewlett packard enterprise', ticker: 'HPE', exchange: 'NYSE' }
]);
function spokenListing(company, source) {
  if (cleanString(company?.ticker) || cleanString(company?.reported_symbol)) return null;
  const name = String(company?.company || '').trim().toLowerCase();
  const listing = SPOKEN_LISTINGS.find(item => item.name === name);
  if (!listing || !Array.isArray(source?.segments)) return null;
  const spoken = source.segments.some(segment => new RegExp(`\\b${listing.ticker}\\b`, 'iu').test(String(segment.text || '')));
  return spoken ? listing : null;
}
function projectCompanyForRead(company, publishedAt = null, source = null) {
  if (!company || typeof company !== "object") {
    return company;
  }

  const recovered = spokenListing(company, source);
  const displayedCompany = recovered ? { ...company, ticker: recovered.ticker, verified_listing: { exchange: recovered.exchange } } : company;
  const reportedTicker = cleanString(displayedCompany.reported_symbol) ||
    cleanString(displayedCompany.ticker);
  const instrumentIdentity = resolveInstrumentIdentity({
    company: displayedCompany.company,
    ticker: reportedTicker
  }, {
    publishedAt
  });
  const ticker = instrumentIdentity.symbol_at_video ||
    cleanString(displayedCompany.ticker) ||
    reportedTicker;
  const managedInstrument = !["passthrough", "missing_symbol"]
    .includes(instrumentIdentity.resolution_status);
  const commodityChart = commodityTradingView(displayedCompany);

  return {
    ...displayedCompany,
    tradingview_url: tradingViewLink(displayedCompany),
    ...(commodityChart ? { tradingview_label: commodityChart.label } : {}),
    identity_conflict: identityConflict(displayedCompany),
    ticker,
    ...(reportedTicker && reportedTicker !== ticker
      ? { reported_symbol: reportedTicker }
      : {}),
    ...(managedInstrument
      ? { instrument_identity: instrumentIdentity }
      : {})
  };
}

function projectResearchForRead(research) {
  if (!research || typeof research !== "object") {
    return research;
  }

  const publishedAt = research.video?.published_at ||
    research.video?.analyzed_at ||
    null;

  const companies = Array.isArray(research.companies)
    ? research.companies.map(company => projectCompanyForRead(company, publishedAt, research.source))
    : [];

  return {
    ...research,
    summary: projectCorrectedSymbolsInText(research.summary, companies),
    companies
  };
}

function projectCorrectedSymbolsInText(value, companies = []) {
  if (typeof value !== "string" || !value) {
    return value;
  }

  return companies.reduce((text, company) => {
    const identity = company?.instrument_identity;
    const reported = cleanString(identity?.reported_symbol);
    const corrected = cleanString(identity?.symbol_at_video);

    if (
      identity?.resolution_status !== "symbol_corrected" ||
      !reported ||
      !corrected ||
      reported === corrected
    ) {
      return text;
    }

    const escaped = reported.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return text.replace(new RegExp(`\\b${escaped}\\b`, "gu"), corrected);
  }, value);
}

module.exports = {
  projectCompanyForRead,
  projectCorrectedSymbolsInText,
  projectResearchForRead
};
