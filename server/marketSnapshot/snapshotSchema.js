const crypto = require("node:crypto");

const SNAPSHOT_SCHEMA_VERSION = 1;
const SNAPSHOT_ID_PATTERN = /^ms_[a-f0-9]{24}$/u;
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/u;
const SYMBOL_PATTERN = /^[A-Za-z0-9./:_-]{1,64}$/u;
const EXACT_ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;
const ALLOWED_INTERVALS = new Set(["1min", "5min", "15min", "30min", "1h"]);
const PRECISION_BY_INTERVAL = {
  "1min": "intraday_1m",
  "5min": "intraday_5m",
  "15min": "intraday_15m",
  "30min": "intraday_30m",
  "1h": "intraday_1h"
};
const ALLOWED_ADJUSTMENTS = new Set([
  "split_adjusted",
  "unadjusted",
  "provider_default"
]);

class SnapshotValidationError extends Error {
  constructor(message, code = "INVALID_MARKET_SNAPSHOT") {
    super(message);
    this.name = "SnapshotValidationError";
    this.code = code;
  }
}

function cleanString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeSymbol(value) {
  const symbol = cleanString(value)?.toUpperCase() || null;

  if (!symbol || !SYMBOL_PATTERN.test(symbol)) {
    throw new SnapshotValidationError("Ticker/Symbol ist ungültig.", "INVALID_SYMBOL");
  }

  return symbol;
}

function normalizeExactTimestamp(value, fieldName = "timestamp") {
  const timestamp = cleanString(value);

  if (!timestamp || !EXACT_ISO_TIMESTAMP_PATTERN.test(timestamp)) {
    throw new SnapshotValidationError(
      `${fieldName} muss einen exakten ISO-8601-Zeitpunkt mit Zeitzone enthalten.`,
      "INEXACT_TIMESTAMP"
    );
  }

  const milliseconds = Date.parse(timestamp);

  if (!Number.isFinite(milliseconds)) {
    throw new SnapshotValidationError(`${fieldName} ist ungültig.`, "INVALID_TIMESTAMP");
  }

  return new Date(milliseconds).toISOString();
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function createSnapshotId({ videoId, callId, symbol, publishedAt }) {
  if (!VIDEO_ID_PATTERN.test(String(videoId || ""))) {
    throw new SnapshotValidationError("videoId ist ungültig.", "INVALID_VIDEO_ID");
  }

  const normalizedCallId = cleanString(callId);
  if (!normalizedCallId || normalizedCallId.length > 160) {
    throw new SnapshotValidationError("callId ist ungültig.", "INVALID_CALL_ID");
  }

  const normalizedSymbol = normalizeSymbol(symbol);
  const normalizedPublishedAt = normalizeExactTimestamp(publishedAt, "publishedAt");
  const identity = stableStringify({
    callId: normalizedCallId,
    publishedAt: normalizedPublishedAt,
    symbol: normalizedSymbol,
    videoId
  });

  return `ms_${sha256(identity).slice(0, 24)}`;
}

function createIntegrityHash(snapshot) {
  const copy = structuredClone(snapshot);

  if (copy?.market_snapshot) {
    delete copy.market_snapshot.integrity_sha256;
  }

  return sha256(stableStringify(copy));
}

function assertPositiveNumber(value, fieldName) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new SnapshotValidationError(`${fieldName} muss größer als 0 sein.`);
  }
}

function validateSnapshot(snapshot, { verifyIntegrity = true } = {}) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new SnapshotValidationError("MarketSnapshot muss ein Objekt sein.");
  }

  if (snapshot.schema_version !== SNAPSHOT_SCHEMA_VERSION) {
    throw new SnapshotValidationError("Unbekannte MarketSnapshot-Schemaversion.");
  }

  if (!SNAPSHOT_ID_PATTERN.test(String(snapshot.snapshot_id || ""))) {
    throw new SnapshotValidationError("snapshot_id ist ungültig.");
  }

  if (!VIDEO_ID_PATTERN.test(String(snapshot.video_id || ""))) {
    throw new SnapshotValidationError("video_id ist ungültig.");
  }

  const callId = cleanString(snapshot.call_id);
  if (!callId || callId.length > 160) {
    throw new SnapshotValidationError("call_id ist ungültig.");
  }

  const normalizedTicker = normalizeSymbol(snapshot.ticker);
  if (snapshot.ticker !== normalizedTicker) {
    throw new SnapshotValidationError("ticker muss normalisiert und großgeschrieben sein.");
  }
  const normalizedPublishedAt = normalizeExactTimestamp(
    snapshot.published_at,
    "published_at"
  );
  const expectedSnapshotId = createSnapshotId({
    videoId: snapshot.video_id,
    callId,
    symbol: snapshot.ticker,
    publishedAt: normalizedPublishedAt
  });

  if (snapshot.snapshot_id !== expectedSnapshotId) {
    throw new SnapshotValidationError(
      "snapshot_id passt nicht zur Snapshot-Identität.",
      "SNAPSHOT_ID_MISMATCH"
    );
  }

  const market = snapshot.market_snapshot;
  if (!market || typeof market !== "object" || Array.isArray(market)) {
    throw new SnapshotValidationError("market_snapshot fehlt.");
  }

  assertPositiveNumber(market.price_at_video, "price_at_video");
  const priceTimestamp = normalizeExactTimestamp(market.timestamp, "market_snapshot.timestamp");
  normalizeExactTimestamp(market.captured_at, "market_snapshot.captured_at");

  for (const field of ["currency", "exchange", "symbol"]) {
    if (!cleanString(market[field])) {
      throw new SnapshotValidationError(`market_snapshot.${field} fehlt.`);
    }
  }

  normalizeSymbol(market.symbol);

  if (market.currency.length > 16 || market.exchange.length > 80) {
    throw new SnapshotValidationError("Börse oder Währung überschreitet die Feldlänge.");
  }

  if (market.price_field !== "open") {
    throw new SnapshotValidationError("price_field muss open sein.");
  }

  if (!ALLOWED_INTERVALS.has(market.bar_interval)) {
    throw new SnapshotValidationError("bar_interval ist nicht zulässig.");
  }

  if (!["regular", "continuous"].includes(market.session)) {
    throw new SnapshotValidationError("session muss regular oder continuous sein.");
  }

  if (!ALLOWED_ADJUSTMENTS.has(market.adjustment)) {
    throw new SnapshotValidationError("adjustment ist nicht zulässig.");
  }

  if (market.selection_policy !== "first_tradable_bar_at_or_after_publication") {
    throw new SnapshotValidationError("selection_policy ist nicht zulässig.");
  }

  const publishedAt = normalizedPublishedAt;
  const expectedLag = Math.floor((Date.parse(priceTimestamp) - Date.parse(publishedAt)) / 1000);

  if (
    !Number.isSafeInteger(market.publication_lag_seconds) ||
    market.publication_lag_seconds < 0 ||
    market.publication_lag_seconds !== expectedLag
  ) {
    throw new SnapshotValidationError("publication_lag_seconds ist inkonsistent.");
  }

  if (
    !cleanString(market.data_source?.provider) ||
    !cleanString(market.data_source?.endpoint)
  ) {
    throw new SnapshotValidationError("data_source ist unvollständig.");
  }

  const precision = PRECISION_BY_INTERVAL[market.bar_interval];
  if (market.quality?.precision !== precision) {
    throw new SnapshotValidationError("quality.precision passt nicht zum Intervall.");
  }

  if (verifyIntegrity) {
    const integrity = String(market.integrity_sha256 || "");
    if (!/^[a-f0-9]{64}$/u.test(integrity) || integrity !== createIntegrityHash(snapshot)) {
      throw new SnapshotValidationError(
        "MarketSnapshot-Integritätsprüfung fehlgeschlagen.",
        "SNAPSHOT_INTEGRITY_MISMATCH"
      );
    }
  }

  return snapshot;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

module.exports = {
  SNAPSHOT_SCHEMA_VERSION,
  SnapshotValidationError,
  createIntegrityHash,
  createSnapshotId,
  deepFreeze,
  normalizeExactTimestamp,
  normalizeSymbol,
  stableStringify,
  validateSnapshot
};
