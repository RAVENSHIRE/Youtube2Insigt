const {
  stableStringify,
  validateSnapshot
} = require("../marketSnapshot/snapshotSchema");

const DEFAULT_BASE_URL = "http://localhost:3000";
const DEFAULT_MAX_CANDIDATES = 12;
const PREFERRED_TICKERS = [
  "NVDA",
  "AAPL",
  "MSFT",
  "TSLA",
  "AMZN",
  "META",
  "AMD"
];

class LiveSnapshotProofError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "LiveSnapshotProofError";
    this.code = options.code || "LIVE_SNAPSHOT_PROOF_FAILED";
    this.status = options.status || null;
    this.details = options.details || null;
  }
}

function cleanString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeBaseUrl(value) {
  const url = new URL(cleanString(value) || DEFAULT_BASE_URL);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new LiveSnapshotProofError("base-url muss HTTP oder HTTPS verwenden.", {
      code: "INVALID_BASE_URL"
    });
  }

  url.pathname = url.pathname.replace(/\/+$/u, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
}

function parseArguments(argv) {
  const options = {
    allowExisting: false,
    baseUrl: DEFAULT_BASE_URL,
    companyIndex: null,
    creatorId: null,
    maxCandidates: DEFAULT_MAX_CANDIDATES,
    preferredTicker: null,
    videoId: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new LiveSnapshotProofError(`${argument} benötigt einen Wert.`, {
          code: "INVALID_ARGUMENT"
        });
      }
      index += 1;
      return value;
    };

    if (argument === "--allow-existing") {
      options.allowExisting = true;
    } else if (argument === "--base-url") {
      options.baseUrl = next();
    } else if (argument === "--company-index") {
      options.companyIndex = Number(next());
    } else if (argument === "--creator-id") {
      options.creatorId = next();
    } else if (argument === "--max-candidates") {
      options.maxCandidates = Number(next());
    } else if (argument === "--ticker") {
      options.preferredTicker = next();
    } else if (argument === "--video-id") {
      options.videoId = next();
    } else {
      throw new LiveSnapshotProofError(`Unbekanntes Argument: ${argument}`, {
        code: "INVALID_ARGUMENT"
      });
    }
  }

  options.baseUrl = normalizeBaseUrl(options.baseUrl);
  options.creatorId = cleanString(options.creatorId);
  options.preferredTicker = cleanString(options.preferredTicker)?.toUpperCase() || null;
  options.videoId = cleanString(options.videoId);

  const hasExplicitVideo = Boolean(options.videoId);
  const hasExplicitIndex = options.companyIndex !== null;
  if (hasExplicitVideo !== hasExplicitIndex) {
    throw new LiveSnapshotProofError(
      "--video-id und --company-index müssen gemeinsam angegeben werden.",
      { code: "INCOMPLETE_CANDIDATE" }
    );
  }

  if (
    hasExplicitVideo &&
    (!/^[A-Za-z0-9_-]{11}$/u.test(options.videoId) ||
      !Number.isSafeInteger(options.companyIndex) ||
      options.companyIndex < 0)
  ) {
    throw new LiveSnapshotProofError("Expliziter Snapshot-Kandidat ist ungültig.", {
      code: "INVALID_CANDIDATE"
    });
  }

  if (!Number.isSafeInteger(options.maxCandidates) || options.maxCandidates < 1) {
    throw new LiveSnapshotProofError("--max-candidates muss eine positive Ganzzahl sein.", {
      code: "INVALID_ARGUMENT"
    });
  }

  return options;
}

async function requestJson(fetchImpl, url, options = {}) {
  let response;

  try {
    response = await fetchImpl(url, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      },
      signal: options.signal || AbortSignal.timeout(90_000)
    });
  } catch (error) {
    throw new LiveSnapshotProofError(
      error?.message || "Snapshot-Server ist nicht erreichbar.",
      { code: error?.name === "TimeoutError" ? "SERVER_TIMEOUT" : "SERVER_UNREACHABLE" }
    );
  }

  const body = await response.json().catch(() => ({}));
  return { body, ok: response.ok, status: response.status };
}

function requireSuccess(result, context) {
  if (!result.ok) {
    throw new LiveSnapshotProofError(
      result.body?.error || `${context} fehlgeschlagen (HTTP ${result.status}).`,
      {
        code: result.body?.code || "HTTP_REQUEST_FAILED",
        status: result.status,
        details: { context, retryable: Boolean(result.body?.retryable) }
      }
    );
  }
  return result.body;
}

function candidatePriority(candidate, preferredTicker) {
  const ticker = candidate.ticker.toUpperCase();
  if (preferredTicker && ticker === preferredTicker) {
    return -1000;
  }

  const preferredRank = PREFERRED_TICKERS.indexOf(ticker);
  return preferredRank === -1 ? 100 : preferredRank;
}

async function discoverCandidates(fetchImpl, baseUrl, options = {}) {
  const overview = requireSuccess(
    await requestJson(fetchImpl, `${baseUrl}/creators`),
    "Creator Overview"
  );
  const creators = Array.isArray(overview.creators) ? overview.creators : [];
  const selectedCreators = options.creatorId
    ? creators.filter(creator => creator.creatorId === options.creatorId)
    : creators;

  if (options.creatorId && selectedCreators.length === 0) {
    throw new LiveSnapshotProofError("creator-id wurde nicht gefunden.", {
      code: "CREATOR_NOT_FOUND"
    });
  }

  const candidates = [];
  for (const creator of selectedCreators) {
    const dashboard = requireSuccess(
      await requestJson(
        fetchImpl,
        `${baseUrl}/creators/${encodeURIComponent(creator.creatorId)}/dashboard`
      ),
      `Creator Dashboard ${creator.creatorId}`
    );

    for (const video of Array.isArray(dashboard.videos) ? dashboard.videos : []) {
      (Array.isArray(video.companies) ? video.companies : []).forEach((company, companyIndex) => {
        const ticker = cleanString(company?.ticker)?.toUpperCase() || null;
        if (!ticker || !/^[A-Z0-9./:_-]{1,64}$/u.test(ticker)) {
          return;
        }

        candidates.push({
          company: cleanString(company.company),
          companyIndex,
          creator: creator.name || null,
          creatorId: creator.creatorId,
          publishedAt: video.publishedAt || null,
          ticker,
          title: video.title || null,
          videoId: video.id
        });
      });
    }
  }

  return candidates
    .sort((left, right) => {
      const priority = candidatePriority(left, options.preferredTicker) -
        candidatePriority(right, options.preferredTicker);
      return priority || String(right.publishedAt || "").localeCompare(left.publishedAt || "");
    })
    .slice(0, options.maxCandidates);
}

function validateCaptureResponse(result, expectedCreated) {
  const body = requireSuccess(result, "Market-Snapshot Capture");

  if (body.market_snapshot_status !== "captured" || body.created !== expectedCreated) {
    throw new LiveSnapshotProofError("Capture-Antwort verletzt den Idempotenzvertrag.", {
      code: "INVALID_CAPTURE_RESPONSE",
      status: result.status
    });
  }

  if ((expectedCreated && result.status !== 201) || (!expectedCreated && result.status !== 200)) {
    throw new LiveSnapshotProofError("Capture-Antwort verwendet einen falschen HTTP-Status.", {
      code: "INVALID_CAPTURE_STATUS",
      status: result.status
    });
  }

  validateSnapshot(body.snapshot);
  return body;
}

async function captureCandidate(fetchImpl, baseUrl, candidate) {
  return requestJson(fetchImpl, `${baseUrl}/market-snapshots/capture`, {
    body: JSON.stringify({
      videoId: candidate.videoId,
      companyIndex: candidate.companyIndex
    }),
    method: "POST"
  });
}

async function runLiveProof(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new LiveSnapshotProofError("fetch ist nicht verfügbar.", {
      code: "FETCH_UNAVAILABLE"
    });
  }

  const normalized = {
    allowExisting: Boolean(options.allowExisting),
    baseUrl: normalizeBaseUrl(options.baseUrl),
    companyIndex: options.companyIndex ?? null,
    creatorId: cleanString(options.creatorId),
    maxCandidates: options.maxCandidates || DEFAULT_MAX_CANDIDATES,
    preferredTicker: cleanString(options.preferredTicker)?.toUpperCase() || null,
    videoId: cleanString(options.videoId)
  };
  const healthResult = await requestJson(fetchImpl, `${normalized.baseUrl}/market-snapshots/health`);
  const health = requireSuccess(healthResult, "Market-Snapshot Health");

  if (
    health.status !== "ready" ||
    health.storageConfigured !== true ||
    health.marketProviderConfigured !== true ||
    health.youtubeMetadataConfigured !== true ||
    health.immutableWrites !== true
  ) {
    throw new LiveSnapshotProofError(
      "Market-Snapshot-Abhängigkeiten sind nicht vollständig bereit.",
      {
        code: "SNAPSHOT_NOT_READY",
        details: {
          marketProviderConfigured: Boolean(health.marketProviderConfigured),
          status: health.status,
          storageConfigured: Boolean(health.storageConfigured),
          youtubeMetadataConfigured: Boolean(health.youtubeMetadataConfigured)
        }
      }
    );
  }

  const candidates = normalized.videoId
    ? [{ videoId: normalized.videoId, companyIndex: normalized.companyIndex }]
    : await discoverCandidates(fetchImpl, normalized.baseUrl, normalized);

  if (candidates.length === 0) {
    throw new LiveSnapshotProofError("Kein Snapshot-Kandidat mit Ticker gefunden.", {
      code: "NO_SNAPSHOT_CANDIDATE"
    });
  }

  let selected = null;
  let firstResult = null;
  for (const candidate of candidates) {
    const result = await captureCandidate(fetchImpl, normalized.baseUrl, candidate);

    if (!result.ok) {
      requireSuccess(result, "Market-Snapshot Capture");
    }

    if (result.body?.created === true || normalized.allowExisting) {
      selected = candidate;
      firstResult = result;
      break;
    }

    if (normalized.videoId) {
      throw new LiveSnapshotProofError(
        "Der explizite Snapshot existiert bereits; verwende einen neuen Kandidaten oder --allow-existing.",
        { code: "SNAPSHOT_ALREADY_EXISTS" }
      );
    }
  }

  if (!selected || !firstResult) {
    throw new LiveSnapshotProofError(
      "Alle geprüften Kandidaten besitzen bereits einen Snapshot.",
      { code: "NO_NEW_SNAPSHOT_CANDIDATE" }
    );
  }

  const first = validateCaptureResponse(firstResult, firstResult.body.created === true);
  const replayResult = await captureCandidate(fetchImpl, normalized.baseUrl, selected);
  const replay = validateCaptureResponse(replayResult, false);

  if (
    first.market_snapshot_id !== replay.market_snapshot_id ||
    stableStringify(first.snapshot) !== stableStringify(replay.snapshot)
  ) {
    throw new LiveSnapshotProofError("Snapshot hat sich beim Replay verändert.", {
      code: "NON_IDEMPOTENT_REPLAY"
    });
  }

  const readResult = await requestJson(
    fetchImpl,
    `${normalized.baseUrl}/market-snapshots/${encodeURIComponent(first.market_snapshot_id)}`
  );
  const readBack = requireSuccess(readResult, "Market-Snapshot Read-back");
  validateSnapshot(readBack);

  if (stableStringify(first.snapshot) !== stableStringify(readBack)) {
    throw new LiveSnapshotProofError("Persistierter Snapshot weicht vom Capture ab.", {
      code: "READBACK_MISMATCH"
    });
  }

  const snapshot = first.snapshot;
  const market = snapshot.market_snapshot;
  return {
    proof_version: 1,
    status: "verified",
    verified_at: new Date().toISOString(),
    server: normalized.baseUrl,
    candidate: {
      company: first.company || selected.company || null,
      company_index: first.company_index,
      creator: selected.creator || null,
      creator_id: selected.creatorId || null,
      ticker: first.ticker || snapshot.ticker,
      video_id: selected.videoId
    },
    capture: {
      first_created: first.created,
      first_http_status: firstResult.status,
      replay_created: replay.created,
      replay_http_status: replayResult.status,
      snapshot_id: snapshot.snapshot_id
    },
    publication: {
      market_timestamp: market.timestamp,
      publication_lag_seconds: market.publication_lag_seconds,
      published_at: snapshot.published_at,
      selection_policy: market.selection_policy
    },
    market: {
      bar_interval: market.bar_interval,
      currency: market.currency,
      exchange: market.exchange,
      fallback: market.quality.fallback,
      precision: market.quality.precision,
      price_at_video: market.price_at_video,
      provider: market.data_source.provider,
      ticker: snapshot.ticker
    },
    integrity: {
      immutable_write: health.immutableWrites,
      readback_matches: true,
      replay_matches: true,
      sha256: market.integrity_sha256
    }
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const proof = await runLiveProof(options);
  process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
  return proof;
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({
      status: "failed",
      code: error.code || "LIVE_SNAPSHOT_PROOF_FAILED",
      error: error.message,
      details: error.details || null
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  LiveSnapshotProofError,
  discoverCandidates,
  main,
  parseArguments,
  runLiveProof
};
