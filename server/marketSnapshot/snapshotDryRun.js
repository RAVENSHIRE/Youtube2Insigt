const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeExactTimestamp } = require("./snapshotSchema");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function cleanString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function createCallId(videoId, ticker, companyIndex) {
  const identity = `${videoId}:${String(ticker || "unknown").toUpperCase()}:${companyIndex}`;
  return `call_${sha256(identity).slice(0, 24)}`;
}

class SnapshotCandidateError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = "SnapshotCandidateError";
    this.code = code;
    this.status = status;
  }
}

function resolveSnapshotCandidate(sourceVideos, { videoId, companyIndex }) {
  if (!/^[A-Za-z0-9_-]{11}$/u.test(String(videoId || ""))) {
    throw new SnapshotCandidateError("Ungültige videoId.", "INVALID_VIDEO_ID");
  }

  if (!Number.isSafeInteger(companyIndex) || companyIndex < 0) {
    throw new SnapshotCandidateError(
      "companyIndex muss eine nichtnegative Ganzzahl sein.",
      "INVALID_COMPANY_INDEX"
    );
  }

  const report = sourceVideos?.[videoId];
  if (!report) {
    throw new SnapshotCandidateError("Video nicht gefunden.", "VIDEO_NOT_FOUND", 404);
  }

  const company = Array.isArray(report.companies)
    ? report.companies[companyIndex]
    : null;
  if (!company) {
    throw new SnapshotCandidateError(
      "Unternehmensreport nicht gefunden.",
      "COMPANY_NOT_FOUND",
      404
    );
  }

  const ticker = cleanString(company.ticker)?.toUpperCase() || null;
  if (!ticker) {
    throw new SnapshotCandidateError(
      "Unternehmensreport besitzt keinen eindeutigen Ticker.",
      "MISSING_TICKER",
      422
    );
  }

  return {
    videoId,
    companyIndex,
    company: cleanString(company.company),
    ticker,
    callId: cleanString(company.call_id) || createCallId(videoId, ticker, companyIndex)
  };
}

function timestampStatus(value) {
  const timestamp = cleanString(value);

  if (!timestamp) {
    return "missing";
  }

  if (/^\d{4}-\d{2}-\d{2}$/u.test(timestamp)) {
    return "date_only";
  }

  try {
    normalizeExactTimestamp(timestamp, "published_at");
    return "exact_but_unverified";
  } catch {
    return "invalid";
  }
}

function createSnapshotDryRun(sourceVideos, source = {}) {
  if (!sourceVideos || typeof sourceVideos !== "object" || Array.isArray(sourceVideos)) {
    throw new TypeError("Snapshot-Dry-Run erwartet ein JSON-Objekt mit Videos.");
  }

  const candidates = [];
  const issues = [];
  const youtubeVideoIds = new Set();
  let companyCount = 0;
  let missingTickerCount = 0;

  for (const [sourceKey, report] of Object.entries(sourceVideos)) {
    const videoId = cleanString(report?.video?.id) || sourceKey;
    const publishedAt = cleanString(report?.video?.published_at);
    const publicationStatus = timestampStatus(publishedAt);
    const companies = Array.isArray(report?.companies) ? report.companies : [];

    if (!/^[A-Za-z0-9_-]{11}$/u.test(videoId)) {
      issues.push({
        code: "INVALID_VIDEO_ID",
        videoId,
        message: "YouTube-videoId ist ungültig; Snapshot kann nicht geplant werden."
      });
    }

    companies.forEach((company, companyIndex) => {
      companyCount += 1;
      const ticker = cleanString(company?.ticker)?.toUpperCase() || null;

      if (!ticker) {
        missingTickerCount += 1;
        issues.push({
          code: "MISSING_TICKER",
          videoId,
          company: cleanString(company?.company),
          message: "Unternehmen hat keinen eindeutigen Ticker."
        });
        return;
      }

      youtubeVideoIds.add(videoId);
      candidates.push({
        callId: createCallId(videoId, ticker, companyIndex),
        videoId,
        companyIndex,
        company: cleanString(company?.company),
        ticker,
        storedPublishedAt: publishedAt,
        storedTimestampStatus: publicationStatus,
        nextAction: "fetch_youtube_published_at_then_market_snapshot"
      });
    });
  }

  return {
    mode: "dry-run",
    schemaVersion: 1,
    source: {
      path: source.path || null,
      bytes: source.bytes ?? null,
      sha256: source.sha256 || null
    },
    summary: {
      sourceVideos: Object.keys(sourceVideos).length,
      companies: companyCount,
      snapshotCandidates: candidates.length,
      missingTicker: missingTickerCount,
      youtubeMetadataRequests: youtubeVideoIds.size,
      marketSnapshotRequests: candidates.length,
      writesPerformed: false
    },
    candidates,
    issues
  };
}

function loadSnapshotDryRunSource(sourcePath) {
  const resolvedPath = path.resolve(sourcePath);
  const content = fs.readFileSync(resolvedPath);
  const sourceVideos = JSON.parse(content.toString("utf8").replace(/^\uFEFF/u, ""));

  return {
    sourceVideos,
    metadata: {
      path: resolvedPath,
      bytes: content.byteLength,
      sha256: sha256(content)
    }
  };
}

module.exports = {
  SnapshotCandidateError,
  createCallId,
  createSnapshotDryRun,
  loadSnapshotDryRunSource,
  resolveSnapshotCandidate,
  timestampStatus
};
