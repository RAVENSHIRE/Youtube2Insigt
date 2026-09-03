const { resolveInstrumentIdentity } = require("./instrumentResolver");

function cleanString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function projectCompanyForRead(company, publishedAt = null) {
  if (!company || typeof company !== "object") {
    return company;
  }

  const reportedTicker = cleanString(company.reported_symbol) ||
    cleanString(company.ticker);
  const instrumentIdentity = resolveInstrumentIdentity({
    company: company.company,
    ticker: reportedTicker
  }, {
    publishedAt
  });
  const ticker = instrumentIdentity.symbol_at_video ||
    cleanString(company.ticker) ||
    reportedTicker;
  const managedInstrument = !["passthrough", "missing_symbol"]
    .includes(instrumentIdentity.resolution_status);

  return {
    ...company,
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

  return {
    ...research,
    companies: Array.isArray(research.companies)
      ? research.companies.map(company => projectCompanyForRead(company, publishedAt))
      : []
  };
}

module.exports = {
  projectCompanyForRead,
  projectResearchForRead
};
