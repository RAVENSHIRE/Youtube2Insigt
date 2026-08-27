const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
const { YoutubeTranscript } = require("youtube-transcript");
const { GoogleGenAI } = require("@google/genai");
const { getQuote } = require("./marketData");

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const GEMINI_FALLBACK_MODEL =
  process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash";

const ANALYSIS_VERSION = 5;
const CHUNK_SIZE = Math.max(
  8000,
  Number(process.env.TRANSCRIPT_CHUNK_SIZE) || 24000
);
const CHUNK_OVERLAP = Math.min(
  Math.max(0, Number(process.env.TRANSCRIPT_CHUNK_OVERLAP) || 1200),
  Math.floor(CHUNK_SIZE / 2)
);
const MAX_GENERATION_ATTEMPTS = 2;
const MAX_RETRY_DELAY_MS = 60_000;
const MIN_QUOTA_COOLDOWN_MS = 30_000;
const DAILY_QUOTA_COOLDOWN_MS = Math.max(
  MIN_QUOTA_COOLDOWN_MS,
  Number(process.env.GEMINI_QUOTA_COOLDOWN_MS) || 5 * 60_000
);

const DATA_DIR = path.join(__dirname, "data");
const VIDEO_FILE = path.join(DATA_DIR, "videos.json");

const ASSET_TYPES = new Set([
  "stock",
  "crypto",
  "etf",
  "index",
  "commodity",
  "other"
]);
const SENTIMENTS = new Set(["bull", "neutral", "bear"]);
const ACTIONS = new Set([
  "buy",
  "add",
  "hold",
  "reduce",
  "sell",
  "watch",
  "none"
]);
const LEVEL_TYPES = new Set([
  "support",
  "resistance",
  "breakout",
  "entry",
  "stop_loss",
  "reference"
]);
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    companies: {
      type: "array",
      items: {
        type: "object",
        properties: {
          company: { type: "string" },
          ticker: { type: "string" },
          asset_type: {
            type: "string",
            enum: [...ASSET_TYPES]
          },
          sentiment: {
            type: "string",
            enum: [...SENTIMENTS]
          },
          thesis: { type: "string" },
          mentioned_move_pct: { type: "number" },
          price_targets: {
            type: "array",
            items: {
              type: "object",
              properties: {
                value: { type: "number" },
                currency: { type: "string" },
                source: { type: "string" },
                context: { type: "string" }
              },
              required: ["value"]
            }
          },
          time_horizon: { type: "string" },
          action: {
            type: "string",
            enum: [...ACTIONS]
          },
          levels: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  enum: [...LEVEL_TYPES]
                },
                value: { type: "number" },
                currency: { type: "string" },
                context: { type: "string" }
              },
              required: ["type", "value"]
            }
          },
          evidence: {
            type: "array",
            items: { type: "string" }
          }
        },
        required: [
          "company",
          "asset_type",
          "sentiment",
          "thesis",
          "price_targets",
          "action",
          "levels",
          "evidence"
        ]
      }
    }
  },
  required: ["summary", "companies"]
};

const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" }
  },
  required: ["summary"]
};

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY fehlt.");
}

const app = express();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const analysisLocks = new Map();
const analysisCooldowns = new Map();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

function ensureStorage() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!fs.existsSync(VIDEO_FILE)) {
    fs.writeFileSync(VIDEO_FILE, "{}", "utf8");
  }
}

function loadVideos() {
  ensureStorage();

  const raw = fs
    .readFileSync(VIDEO_FILE, "utf8")
    .replace(/^\uFEFF/, "")
    .trim();

  if (!raw) {
    return {};
  }

  const videos = JSON.parse(raw);

  if (!videos || typeof videos !== "object" || Array.isArray(videos)) {
    throw new Error("videos.json muss ein JSON-Objekt enthalten.");
  }

  return videos;
}

function saveVideos(videos) {
  ensureStorage();

  const tempFile = `${VIDEO_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(videos, null, 2), "utf8");
  fs.renameSync(tempFile, VIDEO_FILE);
}

function hasVideo(videos, videoId) {
  return Object.prototype.hasOwnProperty.call(videos, videoId);
}

function cleanString(value) {
  if (typeof value !== "string") {
    return null;
  }

  return value.trim() || null;
}

function normalizeNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const result = Number(value.trim().replace(",", "."));
  return Number.isFinite(result) ? result : null;
}

function normalizeIdentity(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function isValidVideoId(videoId) {
  return typeof videoId === "string" && /^[A-Za-z0-9_-]{11}$/.test(videoId);
}

function isValidMarketSymbol(symbol) {
  return (
    typeof symbol === "string" &&
    symbol.length >= 1 &&
    symbol.length <= 64 &&
    /^[A-Za-z0-9./:_-]+$/.test(symbol)
  );
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseJson(value) {
  if (typeof value !== "string") {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseDurationMs(value) {
  const match = String(value || "")
    .trim()
    .match(/^([0-9]+(?:\.[0-9]+)?)s$/i);

  if (!match) {
    return null;
  }

  const milliseconds = Number(match[1]) * 1000;
  return Number.isFinite(milliseconds) ? Math.ceil(milliseconds) : null;
}

function getGeminiErrorInfo(error) {
  const parsedMessage = parseJson(error?.message);
  const payload = error?.error || parsedMessage?.error || parsedMessage || {};
  const status = Number(error?.status || error?.code || payload.code) || null;
  const details = Array.isArray(error?.details)
    ? error.details
    : Array.isArray(payload.details)
      ? payload.details
      : [];
  const violations = details.flatMap(detail =>
    Array.isArray(detail?.violations) ? detail.violations : []
  );
  const isDailyQuota =
    status === 429 &&
    violations.some(violation =>
      /per.?day/i.test(
        `${violation?.quotaId || ""} ${violation?.quotaMetric || ""}`
      )
    );
  const retryInfo = details.find(detail => detail?.retryDelay);
  const retryMatch = String(payload.message || error?.message || "").match(
    /retry in ([0-9]+(?:\.[0-9]+)?)s/i
  );
  const retryAfterMs =
    parseDurationMs(retryInfo?.retryDelay) ??
    (retryMatch ? Math.ceil(Number(retryMatch[1]) * 1000) : null);

  return {
    status,
    isDailyQuota,
    retryAfterMs
  };
}

function normalizeGeminiError(error, model) {
  const info = getGeminiErrorInfo(error);

  if (info.status !== 429) {
    error.geminiInfo = info;
    return error;
  }

  const quotaError = new Error(
    info.isDailyQuota
      ? `Gemini-Tageskontingent für ${model} ausgeschöpft.`
      : `Gemini-Kontingent für ${model} vorübergehend ausgeschöpft.`,
    { cause: error }
  );

  quotaError.name = "GeminiQuotaError";
  quotaError.status = 429;
  quotaError.code = "GEMINI_QUOTA_EXCEEDED";
  quotaError.model = model;
  quotaError.isDailyQuota = info.isDailyQuota;
  quotaError.retryAfterMs = info.isDailyQuota ? null : info.retryAfterMs;

  return quotaError;
}

function getErrorStatus(error) {
  return Number(error?.status || error?.geminiInfo?.status) || 500;
}

function isRetryable(error) {
  const status = getErrorStatus(error);
  return RETRYABLE_STATUSES.has(status) || error instanceof SyntaxError;
}

function getRetryDelayMs(error, attempt) {
  const retryAfterMs = error?.retryAfterMs ?? error?.geminiInfo?.retryAfterMs;

  if (Number.isFinite(retryAfterMs)) {
    return retryAfterMs;
  }

  return attempt * 2000;
}

function rememberAnalysisCooldown(videoId, error) {
  const durationMs = error.isDailyQuota
    ? DAILY_QUOTA_COOLDOWN_MS
    : Math.max(error.retryAfterMs || 0, MIN_QUOTA_COOLDOWN_MS);

  analysisCooldowns.set(videoId, {
    expiresAt: Date.now() + durationMs,
    isDailyQuota: Boolean(error.isDailyQuota),
    message: error.message
  });
}

function getAnalysisCooldownError(videoId) {
  const cooldown = analysisCooldowns.get(videoId);

  if (!cooldown) {
    return null;
  }

  const retryAfterMs = cooldown.expiresAt - Date.now();

  if (retryAfterMs <= 0) {
    analysisCooldowns.delete(videoId);
    return null;
  }

  const error = new Error(cooldown.message);
  error.name = "GeminiQuotaError";
  error.status = 429;
  error.code = "GEMINI_QUOTA_COOLDOWN";
  error.isDailyQuota = cooldown.isDailyQuota;
  error.retryAfterMs = retryAfterMs;

  return error;
}

async function generateStructured({ prompt, schema, maxOutputTokens }) {
  const models = [
    ...new Set([GEMINI_MODEL, GEMINI_FALLBACK_MODEL].filter(Boolean))
  ];
  let lastError;

  for (const model of models) {
    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
      try {
        console.log(
          `Gemini ${model} ${attempt}/${MAX_GENERATION_ATTEMPTS}`
        );

        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: schema,
            maxOutputTokens
          }
        });

        const finishReason = response.candidates?.[0]?.finishReason;

        if (finishReason && finishReason !== "STOP") {
          const error = new Error(`Gemini finishReason: ${finishReason}`);
          error.code = finishReason;
          throw error;
        }

        const text = response.text?.trim();

        if (!text) {
          throw new Error("Gemini hat keine Antwort zurückgegeben.");
        }

        return {
          data: JSON.parse(text),
          model
        };
      } catch (rawError) {
        const error = normalizeGeminiError(rawError, model);
        lastError = error;
        console.error(`Gemini Fehler (${model}):`, error.message);

        if (error.isDailyQuota) {
          console.warn(
            `Kein Retry für ausgeschöpftes Tageskontingent (${model}).`
          );
          break;
        }

        if (error.code === "MAX_TOKENS" || !isRetryable(error)) {
          break;
        }

        if (attempt < MAX_GENERATION_ATTEMPTS) {
          const retryDelayMs = getRetryDelayMs(error, attempt);

          if (retryDelayMs > MAX_RETRY_DELAY_MS) {
            console.warn(
              `Retry-Delay von ${retryDelayMs} ms überschreitet das Limit.`
            );
            break;
          }

          console.log(`Gemini Retry in ${retryDelayMs} ms`);
          await wait(retryDelayMs);
        }
      }
    }
  }

  throw lastError || new Error("Gemini Analyse fehlgeschlagen.");
}

async function withAnalysisLock(videoId, callback) {
  const existing = analysisLocks.get(videoId);

  if (existing) {
    return existing;
  }

  const promise = (async () => {
    try {
      return await callback();
    } finally {
      analysisLocks.delete(videoId);
    }
  })();

  analysisLocks.set(videoId, promise);
  return promise;
}

async function getTranscript(videoId) {
  const items = await YoutubeTranscript.fetchTranscript(videoId);
  const transcript = items
    .map(item => cleanString(item.text))
    .filter(Boolean)
    .join(" ")
    .trim();

  if (!transcript) {
    throw new Error("Kein Transcript gefunden.");
  }

  return transcript;
}

function chunkTranscript(transcript) {
  if (transcript.length <= CHUNK_SIZE) {
    return [transcript];
  }

  const chunks = [];
  let start = 0;

  while (start < transcript.length) {
    let end = Math.min(start + CHUNK_SIZE, transcript.length);

    if (end < transcript.length) {
      const boundary = transcript.lastIndexOf(" ", end);

      if (boundary > start + CHUNK_SIZE * 0.7) {
        end = boundary;
      }
    }

    const chunk = transcript.slice(start, end).trim();

    if (chunk) {
      chunks.push(chunk);
    }

    if (end >= transcript.length) {
      break;
    }

    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }

  return chunks;
}

function normalizeTarget(target) {
  if (!target || typeof target !== "object") {
    return null;
  }

  const value = normalizeNumber(target.value);

  if (value === null) {
    return null;
  }

  return {
    value,
    currency: cleanString(target.currency),
    source: cleanString(target.source),
    context: cleanString(target.context)
  };
}

function normalizeLevel(level) {
  if (!level || typeof level !== "object") {
    return null;
  }

  const value = normalizeNumber(level.value);

  if (value === null) {
    return null;
  }

  return {
    type: LEVEL_TYPES.has(level.type) ? level.type : "reference",
    value,
    currency: cleanString(level.currency),
    context: cleanString(level.context)
  };
}

function normalizeCompany(company) {
  if (!company || typeof company !== "object") {
    return null;
  }

  const name = cleanString(company.company);

  if (!name) {
    return null;
  }

  return {
    company: name,
    ticker: cleanString(company.ticker)?.toUpperCase() || null,
    asset_type: ASSET_TYPES.has(company.asset_type)
      ? company.asset_type
      : "other",
    sentiment: SENTIMENTS.has(company.sentiment)
      ? company.sentiment
      : "neutral",
    thesis: cleanString(company.thesis),
    mentioned_move_pct: normalizeNumber(company.mentioned_move_pct),
    price_targets: Array.isArray(company.price_targets)
      ? company.price_targets.map(normalizeTarget).filter(Boolean)
      : [],
    time_horizon: cleanString(company.time_horizon),
    action: ACTIONS.has(company.action) ? company.action : "none",
    levels: Array.isArray(company.levels)
      ? company.levels.map(normalizeLevel).filter(Boolean)
      : [],
    evidence: Array.isArray(company.evidence)
      ? company.evidence.map(cleanString).filter(Boolean)
      : []
  };
}

function mergeText(current, incoming) {
  if (!current) {
    return incoming;
  }

  if (!incoming) {
    return current;
  }

  if (current.includes(incoming)) {
    return current;
  }

  if (incoming.includes(current)) {
    return incoming;
  }

  return `${current} ${incoming}`.slice(0, 1500);
}

function mergeUnique(current, incoming, keyFn) {
  const itemsByKey = new Map();

  for (const item of [...current, ...incoming]) {
    itemsByKey.set(keyFn(item), item);
  }

  return [...itemsByKey.values()];
}

function sameAsset(a, b) {
  if (
    a.ticker &&
    b.ticker &&
    a.ticker === b.ticker &&
    a.asset_type === b.asset_type
  ) {
    return true;
  }

  return (
    a.asset_type === b.asset_type &&
    normalizeIdentity(a.company) === normalizeIdentity(b.company)
  );
}

function selectSentiment(counts) {
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) {
    return "neutral";
  }

  return sorted[0]?.[0] || "neutral";
}

function mergeCompanies(extractedCompanies) {
  const merged = [];

  for (const rawCompany of extractedCompanies) {
    const company = normalizeCompany(rawCompany);

    if (!company) {
      continue;
    }

    let existing = merged.find(item => sameAsset(item, company));

    if (!existing) {
      existing = {
        ...company,
        _sentiments: {
          bull: company.sentiment === "bull" ? 1 : 0,
          neutral: company.sentiment === "neutral" ? 1 : 0,
          bear: company.sentiment === "bear" ? 1 : 0
        }
      };

      merged.push(existing);
      continue;
    }

    existing._sentiments[company.sentiment] += 1;
    existing.sentiment = selectSentiment(existing._sentiments);

    if (company.company.length > existing.company.length) {
      existing.company = company.company;
    }

    existing.ticker ||= company.ticker;
    existing.thesis = mergeText(existing.thesis, company.thesis);
    existing.mentioned_move_pct ??= company.mentioned_move_pct;
    existing.time_horizon ||= company.time_horizon;

    if (existing.action === "none" && company.action !== "none") {
      existing.action = company.action;
    }

    existing.price_targets = mergeUnique(
      existing.price_targets,
      company.price_targets,
      target => [target.value, target.currency, target.source].join("|")
    );

    existing.levels = mergeUnique(
      existing.levels,
      company.levels,
      level => [level.type, level.value, level.currency].join("|")
    );

    existing.evidence = mergeUnique(
      existing.evidence,
      company.evidence,
      evidence => evidence
    ).slice(0, 5);
  }

  return merged.map(company => {
    const { _sentiments, ...result } = company;

    return {
      ...result,
      sentiment: selectSentiment(_sentiments)
    };
  });
}

function buildExtractionPrompt({
  transcript,
  title,
  creator,
  chunkIndex,
  chunkCount
}) {
  return `
Du bist eine präzise Investment-Research-Extraction-Engine.

Extrahiere ALLE substanziell behandelten investierbaren Assets aus diesem Transcript-Ausschnitt.

Video:
${title || "Unbekannt"}

Creator:
${creator || "Unbekannt"}

Transcript-Teil:
${chunkIndex + 1}/${chunkCount}

TRANSCRIPT:
${transcript}

Extrahiere:
- Aktien
- Kryptowährungen
- ETFs
- Indizes
- Rohstoffe
- andere investierbare Assets

WICHTIG:

1. Lasse ein Asset NICHT weg, nur weil:
- es nur kurz behandelt wird
- kein Kursziel genannt wird
- keine konkrete Empfehlung vorliegt
- das Sentiment neutral ist
- es nicht im Videotitel vorkommt

2. Keine Investment-Aussage erfinden.

3. Zahlen semantisch exakt übernehmen.

"1,50" = 1.5
"1,60" = 1.6
"82.000" = 82000

4. Prozentwerte sind keine Preise.

"XRP ist 50 Prozent gestiegen"

=> mentioned_move_pct = 50

5. Technische Marken sind keine Kursziele.

"muss 1,50 und 1,60 überwinden"

=> resistance levels 1.5 und 1.6

6. price_targets nur für ausdrücklich genannte Kursziele.

Wenn mehrere Analysten unterschiedliche Kursziele nennen:
alle separat in price_targets speichern.

7. Währung niemals erraten.

8. sentiment:
bull | neutral | bear

9. action nur bei konkreter Handlung:
buy | add | hold | reduce | sell | watch | none

10. evidence:
maximal 3 kurze Transcript-Ausschnitte pro Asset.

11. ticker nur wenn eindeutig identifizierbar.

12. Keine aktuellen oder historischen Marktpreise aus externem Wissen ergänzen.

13. summary:
Fasse den Transcript-Ausschnitt in maximal 3 kurzen Sätzen zusammen.
Fokus auf Marktthese, Investment-Themen, Chancen und Risiken.

Antworte ausschließlich gemäß JSON-Schema.
`;
}

async function extractChunk({
  transcript,
  title,
  creator,
  chunkIndex,
  chunkCount
}) {
  const response = await generateStructured({
    prompt: buildExtractionPrompt({
      transcript,
      title,
      creator,
      chunkIndex,
      chunkCount
    }),
    schema: ANALYSIS_SCHEMA,
    maxOutputTokens: 8192
  });

  return {
    summary: cleanString(response.data?.summary),
    companies: Array.isArray(response.data?.companies)
      ? response.data.companies
      : [],
    model: response.model
  };
}

async function summarizeVideo({ transcript, title, creator }) {
  const response = await generateStructured({
    prompt: `
Du bist eine präzise Investment-Research-Engine.

Fasse das folgende YouTube-Video in maximal 3 kurzen Sätzen zusammen.

Fokus:
- wichtigste Marktthese
- wichtigste Investment-Themen
- besondere Chancen oder Risiken

Keine externen Informationen.
Keine erfundenen Preise.
Keine vollständige Aufzählung aller Assets.

Video:
${title || "Unbekannt"}

Creator:
${creator || "Unbekannt"}

Transcript:
${transcript}
`,
    schema: SUMMARY_SCHEMA,
    maxOutputTokens: 512
  });

  return {
    summary: cleanString(response.data?.summary),
    model: response.model
  };
}

async function analyzeVideo(details) {
  const { videoId } = details;
  const cooldownError = getAnalysisCooldownError(videoId);

  if (cooldownError) {
    throw cooldownError;
  }

  try {
    return await withAnalysisLock(videoId, () => performAnalysis(details));
  } catch (error) {
    if (getErrorStatus(error) === 429) {
      rememberAnalysisCooldown(videoId, error);
    }

    throw error;
  }
}

async function performAnalysis({ videoId, title, creator, url }) {
  // Existing videos are an immutable cache and are never analyzed automatically.
  const videos = loadVideos();

  if (hasVideo(videos, videoId)) {
    console.log(`CACHE HIT: ${videoId}`);
    return { cached: true, videoId };
  }

  console.log(`CACHE MISS: ${videoId}`);

  const transcript = await getTranscript(videoId);
  const chunks = chunkTranscript(transcript);

  console.log(
    `Transcript: ${transcript.length} Zeichen / ${chunks.length} Chunks`
  );

  const extracted = [];
  let embeddedSummary = null;
  const modelsUsed = new Set();

  for (let index = 0; index < chunks.length; index++) {
    console.log(`Chunk ${index + 1}/${chunks.length}`);

    const result = await extractChunk({
      transcript: chunks[index],
      title,
      creator,
      chunkIndex: index,
      chunkCount: chunks.length
    });

    extracted.push(...result.companies);
    modelsUsed.add(result.model);

    if (chunks.length === 1 && result.summary) {
      embeddedSummary = {
        summary: result.summary,
        model: result.model
      };
    }
  }

  const companies = mergeCompanies(extracted);
  const summaryResult =
    embeddedSummary ||
    (await summarizeVideo({
      transcript,
      title,
      creator
    }));

  modelsUsed.add(summaryResult.model);

  const result = {
    analysis_version: ANALYSIS_VERSION,
    analysis_models: [...modelsUsed],
    video: {
      id: videoId,
      title: cleanString(title),
      creator: cleanString(creator),
      url:
        cleanString(url) ||
        `https://www.youtube.com/watch?v=${videoId}`,
      analyzed_at: new Date().toISOString()
    },
    summary: summaryResult.summary,
    companies
  };

  // Recheck immediately before writing so an existing result is never replaced.
  const latestVideos = loadVideos();

  if (hasVideo(latestVideos, videoId)) {
    console.log(`CACHE HIT BEFORE SAVE: ${videoId}`);
    return { cached: true, videoId };
  }

  latestVideos[videoId] = result;
  saveVideos(latestVideos);

  console.log(`CACHE SAVED: ${videoId}`);
  return { cached: false, videoId };
}

function buildCompanyIndex(videos) {
  const companies = new Map();

  for (const video of Object.values(videos)) {
    if (!Array.isArray(video?.companies)) {
      continue;
    }

    for (const company of video.companies) {
      const name = cleanString(company?.company);

      if (!name) {
        continue;
      }

      const ticker = cleanString(company.ticker);
      const assetType = cleanString(company.asset_type) || "other";
      const key = ticker
        ? `${assetType}:${ticker.toUpperCase()}`
        : `${assetType}:${normalizeIdentity(name)}`;

      if (!companies.has(key)) {
        companies.set(key, {
          company: name,
          ticker,
          asset_type: assetType,
          mentions: 0,
          videoIds: new Set(),
          sentiment: {
            bull: 0,
            neutral: 0,
            bear: 0
          }
        });
      }

      const entry = companies.get(key);
      entry.mentions += 1;

      if (video?.video?.id) {
        entry.videoIds.add(video.video.id);
      }

      if (SENTIMENTS.has(company.sentiment)) {
        entry.sentiment[company.sentiment] += 1;
      }
    }
  }

  return [...companies.values()]
    .map(entry => ({
      company: entry.company,
      ticker: entry.ticker,
      asset_type: entry.asset_type,
      mentions: entry.mentions,
      videos: entry.videoIds.size,
      sentiment: entry.sentiment
    }))
    .sort((a, b) => b.mentions - a.mentions);
}

app.post("/analyze", async (req, res) => {
  try {
    const { videoId, title, creator, url } = req.body || {};

    if (!isValidVideoId(videoId)) {
      return res.status(400).json({
        error: "Ungültige oder fehlende videoId."
      });
    }

    const result = await analyzeVideo({
      videoId,
      title,
      creator,
      url
    });

    return res.json(result);
  } catch (error) {
    if (getErrorStatus(error) === 429) {
      const retryAfterSeconds = Number.isFinite(error.retryAfterMs)
        ? Math.max(1, Math.ceil(error.retryAfterMs / 1000))
        : null;

      console.warn("ANALYZE QUOTA:", {
        message: error.message,
        code: error.code,
        dailyQuota: Boolean(error.isDailyQuota),
        retryAfterSeconds
      });

      if (retryAfterSeconds) {
        res.set("Retry-After", String(retryAfterSeconds));
      }

      return res.status(429).json({
        error: error.message || "Gemini-Kontingent ausgeschöpft.",
        code: error.code || "GEMINI_QUOTA_EXCEEDED",
        dailyQuota: Boolean(error.isDailyQuota),
        retryAfterSeconds
      });
    }

    console.error("ANALYZE ERROR:", error);

    return res.status(500).json({
      error: error.message || "Analyse fehlgeschlagen."
    });
  }
});

app.get("/videos/:videoId", (req, res) => {
  try {
    const { videoId } = req.params;

    if (!isValidVideoId(videoId)) {
      return res.status(400).json({
        error: "Ungültige videoId."
      });
    }

    const videos = loadVideos();

    if (!hasVideo(videos, videoId)) {
      return res.status(404).json({
        error: "Video nicht gefunden."
      });
    }

    return res.json(videos[videoId]);
  } catch (error) {
    console.error("GET VIDEO ERROR:", error);

    return res.status(500).json({
      error: "Video konnte nicht geladen werden."
    });
  }
});

app.get("/companies", (req, res) => {
  try {
    const videos = loadVideos();
    const companies = buildCompanyIndex(videos);

    return res.json({
      totalVideos: Object.keys(videos).length,
      totalCompanies: companies.length,
      companies
    });
  } catch (error) {
    console.error("GET COMPANIES ERROR:", error);

    return res.status(500).json({
      error: "Companies konnten nicht geladen werden."
    });
  }
});

app.get("/market", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "")
      .trim()
      .toUpperCase();

    if (!isValidMarketSymbol(symbol)) {
      return res.status(400).json({
        error: "Ungültiges oder fehlendes Symbol."
      });
    }

    return res.json(await getQuote(symbol));
  } catch (error) {
    console.error("MARKET DATA ERROR:", error);

    return res.status(502).json({
      error: error.message || "Market data unavailable."
    });
  }
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    analysisVersion: ANALYSIS_VERSION,
    model: GEMINI_MODEL,
    fallbackModel: GEMINI_FALLBACK_MODEL
  });
});

ensureStorage();

app.listen(PORT, () => {
  console.log(`YT Investor Research API läuft auf http://localhost:${PORT}`);
  console.log(`Analysis Version: ${ANALYSIS_VERSION}`);
  console.log(`Gemini Model: ${GEMINI_MODEL}`);
  console.log(`Fallback Model: ${GEMINI_FALLBACK_MODEL}`);
});
