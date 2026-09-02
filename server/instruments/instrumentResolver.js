const {
  INSTRUMENT_IDENTITY_VERSION,
  INSTRUMENT_REGISTRY
} = require("./instrumentRegistry");

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

function normalizeSymbol(value) {
  return cleanString(value)?.toUpperCase() || null;
}

function toMilliseconds(value) {
  const timestamp = cleanString(value);
  if (!timestamp) {
    return null;
  }

  const milliseconds = Date.parse(timestamp);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function findRegistryEntry(company = {}) {
  const symbol = normalizeSymbol(company.ticker);
  const name = normalizeIdentity(company.company);

  return INSTRUMENT_REGISTRY.find(entry => {
    const aliases = entry.aliases || {};
    return (symbol && aliases.symbols?.includes(symbol)) ||
      (name && aliases.names?.some(alias => name.includes(alias)));
  }) || null;
}

function applySymbolCorrection(entry, reportedSymbol) {
  if (!entry || !reportedSymbol) {
    return null;
  }

  return (entry.symbol_corrections || [])
    .find(correction => correction.reported_symbol === reportedSymbol) || null;
}

function selectListing(entry, timestamp, fallbackSymbol) {
  const at = toMilliseconds(timestamp);
  const lifecycle = Array.isArray(entry?.lifecycle) ? entry.lifecycle : [];

  if (!at) {
    return lifecycle.find(listing => listing.symbol === fallbackSymbol) ||
      lifecycle[lifecycle.length - 1] ||
      null;
  }

  return lifecycle.find(listing => {
    const from = toMilliseconds(listing.valid_from) ?? Number.NEGATIVE_INFINITY;
    const to = toMilliseconds(listing.valid_to) ?? Number.POSITIVE_INFINITY;
    return at >= from && at < to;
  }) || lifecycle[lifecycle.length - 1] || null;
}

function findCorporateAction(entry, fromSymbol, toSymbol) {
  return (entry?.corporate_actions || [])
    .find(action => action.from_symbol === fromSymbol && action.to_symbol === toSymbol) || null;
}

function passthroughIdentity(company = {}) {
  const reportedSymbol = normalizeSymbol(company.ticker);

  return {
    schema_version: INSTRUMENT_IDENTITY_VERSION,
    canonical_asset_id: reportedSymbol ? `symbol:${reportedSymbol}` : null,
    issuer_name: cleanString(company.company),
    reported_symbol: reportedSymbol,
    symbol_at_video: reportedSymbol,
    current_symbol: reportedSymbol,
    current_exchange: null,
    resolution_status: reportedSymbol ? "passthrough" : "missing_symbol",
    continuity_status: "same_symbol",
    performance_continuity_verified: Boolean(reportedSymbol),
    corporate_action: null,
    provider_symbols: {
      historical: reportedSymbol,
      current: reportedSymbol
    },
    warnings: reportedSymbol ? [] : [{
      code: "MISSING_SYMBOL",
      component: "instrument_identity",
      retryable: false
    }]
  };
}

function resolveInstrumentIdentity(company = {}, options = {}) {
  const reportedSymbol = normalizeSymbol(company.ticker);
  const entry = findRegistryEntry(company);

  if (!entry) {
    return passthroughIdentity(company);
  }

  const correction = applySymbolCorrection(entry, reportedSymbol);
  const correctedSymbol = correction?.corrected_symbol || reportedSymbol;
  const listingAtVideo = selectListing(entry, options.publishedAt, correctedSymbol);
  const currentListing = selectListing(
    entry,
    options.evaluatedAt || new Date().toISOString(),
    correctedSymbol
  );
  const symbolAtVideo = listingAtVideo?.symbol || correctedSymbol;
  const currentSymbol = currentListing?.symbol || symbolAtVideo;
  const corporateAction = symbolAtVideo !== currentSymbol
    ? findCorporateAction(entry, symbolAtVideo, currentSymbol)
    : null;
  const continuityStatus = corporateAction
    ? entry.continuity_status
    : correction
      ? "same_security"
      : "same_symbol";
  const performanceContinuityVerified = !corporateAction ||
    corporateAction.continuity_status === "verified";
  const warnings = [];

  if (correction) {
    warnings.push({
      code: "SYMBOL_CORRECTED",
      component: "instrument_identity",
      reported_symbol: reportedSymbol,
      corrected_symbol: correctedSymbol,
      retryable: false
    });
  }

  if (corporateAction && !performanceContinuityVerified) {
    warnings.push({
      code: "INSTRUMENT_CONTINUITY_UNVERIFIED",
      component: "instrument_identity",
      from_symbol: symbolAtVideo,
      to_symbol: currentSymbol,
      retryable: false
    });
  }

  return {
    schema_version: INSTRUMENT_IDENTITY_VERSION,
    canonical_asset_id: entry.canonical_asset_id,
    issuer_name: entry.issuer_name,
    reported_symbol: reportedSymbol,
    symbol_at_video: symbolAtVideo,
    current_symbol: currentSymbol,
    current_exchange: currentListing?.exchange || null,
    resolution_status: correction
      ? "symbol_corrected"
      : corporateAction
        ? "lifecycle_resolved"
        : "registry_match",
    continuity_status: continuityStatus,
    performance_continuity_verified: performanceContinuityVerified,
    corporate_action: corporateAction
      ? {
          type: corporateAction.type,
          effective_at: corporateAction.effective_at,
          from_symbol: corporateAction.from_symbol,
          to_symbol: corporateAction.to_symbol,
          continuity_status: corporateAction.continuity_status
        }
      : null,
    provider_symbols: {
      historical: symbolAtVideo,
      current: currentSymbol
    },
    warnings
  };
}

function isLifecyclePerformanceBlocked(identity) {
  return Boolean(identity) &&
    identity.performance_continuity_verified === false &&
    identity.symbol_at_video &&
    identity.current_symbol &&
    identity.symbol_at_video !== identity.current_symbol;
}

module.exports = {
  INSTRUMENT_IDENTITY_VERSION,
  findRegistryEntry,
  isLifecyclePerformanceBlocked,
  resolveInstrumentIdentity
};
