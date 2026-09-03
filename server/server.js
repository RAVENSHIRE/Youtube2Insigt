const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
const { YoutubeTranscript } = require("youtube-transcript");
const { GoogleGenAI } = require("@google/genai");
const { getQuote } = require("./marketData");
const { classifyCompany } = require("./classification/sectorTaxonomy");
const {
  CALL_TYPES,
  classifyCall,
  normalizeConfidence
} = require("./classification/callClassification");
const {
  INSTRUMENT_IDENTITY_VERSION,
  resolveInstrumentIdentity
} = require("./instruments/instrumentResolver");
const {
  projectCompanyForRead,
  projectResearchForRead
} = require("./instruments/instrumentProjection");
const { CreatorRepository } = require("./storage/creatorRepository");
const {
  MarketSnapshotService,
  MarketSnapshotUnavailableError
} = require("./marketSnapshot/marketSnapshotService");
const { SnapshotRepository } = require("./marketSnapshot/snapshotRepository");
const { SnapshotValidationError } = require("./marketSnapshot/snapshotSchema");
const { OutcomeService } = require("./outcomes/outcomeService");
const { OutcomeRepository } = require("./outcomes/outcomeRepository");
const {
  SnapshotCandidateError,
  resolveSnapshotCandidate
} = require("./marketSnapshot/snapshotDryRun");
const {
  MarketDataProviderError,
  TwelveDataProvider
} = require("./providers/twelveDataProvider");
const {
  YouTubeMetadataError,
  YouTubeMetadataService
} = require("./services/youtubeMetadataService");
const {
  resolveAnalysisMetadata
} = require("./services/analysisMetadataService");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const PORT = Number(process.env.PORT) || 3000;
const GEMINI_MODEL = "gemini-3.5-flash";

const ANALYSIS_VERSION = 7;

const DATA_DIR = path.join(__dirname, "data");
const VIDEO_FILE = path.join(DATA_DIR, "videos.json");
const CREATOR_DATA_ROOT = cleanEnvironmentPath(process.env.CREATOR_DATA_ROOT);
const MARKET_SNAPSHOT_ROOT = cleanString(process.env.MARKET_SNAPSHOT_ROOT);

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
          sector: { type: "string" },
          sub_sector: { type: "string" },
          sentiment: {
            type: "string",
            enum: [...SENTIMENTS]
          },
          call_type: {
            type: "string",
            enum: [...CALL_TYPES]
          },
          call_confidence: {
            type: "number",
            minimum: 0,
            maximum: 1
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
          "sector",
          "sub_sector",
          "sentiment",
          "call_type",
          "call_confidence",
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

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY fehlt.");
}

const app = express();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const analysisLocks = new Map();
const creatorRepository = CREATOR_DATA_ROOT
  ? new CreatorRepository(CREATOR_DATA_ROOT)
  : null;
const snapshotProvider = new TwelveDataProvider();
const youtubeMetadataService = new YouTubeMetadataService();
const snapshotRepository = MARKET_SNAPSHOT_ROOT
  ? new SnapshotRepository(MARKET_SNAPSHOT_ROOT)
  : null;
const outcomeRepository = MARKET_SNAPSHOT_ROOT
  ? new OutcomeRepository(MARKET_SNAPSHOT_ROOT)
  : null;
const marketSnapshotService = snapshotRepository
  ? new MarketSnapshotService({
      provider: snapshotProvider,
      repository: snapshotRepository,
      youtubeMetadataService
    })
  : null;
const outcomeService = marketSnapshotService
  ? new OutcomeService({
      provider: snapshotProvider,
      snapshotService: marketSnapshotService,
      repository: outcomeRepository
    })
  : null;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

function cleanEnvironmentPath(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function creatorStorageEnabled() {
  return Boolean(creatorRepository);
}

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

function findStoredVideo(videoId) {
  if (creatorStorageEnabled()) {
    return creatorRepository.findVideo(videoId);
  }

  const videos = loadVideos();
  return hasVideo(videos, videoId)
    ? { creatorId: null, research: videos[videoId] }
    : null;
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

function normalizeCount(value) {
  if (
    value === null ||
    value === undefined ||
    typeof value === "boolean" ||
    (typeof value === "string" && !value.trim())
  ) {
    return null;
  }

  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
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

async function generateStructured(prompt) {
  console.log(`Gemini ${GEMINI_MODEL}`);

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: ANALYSIS_SCHEMA
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

  return JSON.parse(text);
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

  const reportedTicker = cleanString(company.ticker)?.toUpperCase() || null;
  const instrumentIdentity = resolveInstrumentIdentity({
    company: name,
    ticker: reportedTicker
  });
  const normalizedTicker = instrumentIdentity.provider_symbols.historical || reportedTicker;
  const classification = classifyCompany({
    ...company,
    ticker: normalizedTicker
  });
  const hasManagedInstrument = !["passthrough", "missing_symbol"]
    .includes(instrumentIdentity.resolution_status);

  return {
    company: name,
    ticker: normalizedTicker,
    ...(reportedTicker && reportedTicker !== normalizedTicker
      ? { reported_symbol: reportedTicker }
      : {}),
    ...(hasManagedInstrument
      ? { instrument_identity: instrumentIdentity }
      : {}),
    asset_type: ASSET_TYPES.has(company.asset_type)
      ? company.asset_type
      : "other",
    sector: classification.sector,
    sub_sector: classification.sub_sector,
    sentiment: SENTIMENTS.has(company.sentiment)
      ? company.sentiment
      : "neutral",
    call_type: CALL_TYPES.has(company.call_type) ? company.call_type : null,
    call_confidence: normalizeConfidence(company.call_confidence),
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

    if (company.call_confidence !== null) {
      existing.call_confidence = Math.max(
        existing.call_confidence ?? 0,
        company.call_confidence
      );
    }

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
      sentiment: selectSentiment(_sentiments),
      ...classifyCall(result)
    };
  });
}

function buildAnalysisPrompt({ transcript, title, creator }) {
  return `
Du bist eine präzise Investment-Research-Extraction-Engine.

Analysiere das vollständige Transcript in einem Durchgang.
Extrahiere ALLE substanziell behandelten investierbaren Assets.

Video:
${title || "Unbekannt"}

Creator:
${creator || "Unbekannt"}

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

9. sector und sub_sector:
- sector ist eine breite, stabile Branche, zum Beispiel Technology, Financials, Health Care, Industrials, Energy, Materials, Consumer Discretionary, Consumer Staples, Communication Services, Utilities, Digital Assets oder Commodities.
- sub_sector ist die präzisere Unterbranche, zum Beispiel Semiconductors, Banks, Biotechnology oder Gold Mining.
- Der Unternehmensname bleibt die dritte und unterste Hierarchieebene.
- Verwende konsistente englische Kategorienamen.

10. action nur bei konkreter Handlung:
buy | add | hold | reduce | sell | watch | none

11. call_type trennt Erwähnung und echte Creator-Calls strikt:
- mention: Das Asset wird nur genannt oder sachlich beschrieben. Keine eigene Richtung und keine Handlung.
- view: Der Creator äußert eine bullische, neutrale oder bearische Einschätzung, aber keine konkrete Handlung.
- actionable: Der Creator fordert ausdrücklich buy, add, hold, reduce oder sell. Eine nur berichtete Analystenmeinung zählt nicht als Creator-Call.
- targeted: Ein actionable Call enthält zusätzlich mindestens ein ausdrückliches Kursziel UND einen Zeithorizont.
- watch und none sind niemals actionable.
- call_confidence liegt zwischen 0 und 1 und bewertet nur die Sicherheit dieser Klassifikation.
- Keine Handlung aus Sentiment, Kursziel oder Kontext erfinden.

12. evidence:
maximal 3 kurze Transcript-Ausschnitte pro Asset.

13. ticker nur wenn eindeutig identifizierbar.

14. Keine aktuellen oder historischen Marktpreise aus externem Wissen ergänzen.

15. summary:
Fasse das gesamte Video in maximal 3 kurzen Sätzen zusammen.
Fokus auf Marktthese, Investment-Themen, Chancen und Risiken.

Antworte ausschließlich gemäß JSON-Schema.
`;
}

async function analyzeTranscript({ transcript, title, creator }) {
  const data = await generateStructured(
    buildAnalysisPrompt({ transcript, title, creator })
  );

  return {
    summary: cleanString(data?.summary),
    companies: mergeCompanies(
      Array.isArray(data?.companies) ? data.companies : []
    )
  };
}

function normalizeChannel({
  creator,
  channelUrl,
  channelAvatarUrl,
  subscriberCount,
  channelTotalVideos,
  channelId,
  channelHandle
}) {
  const channel = {
    name: cleanString(creator),
    url: cleanString(channelUrl),
    avatar_url: cleanString(channelAvatarUrl),
    subscriber_count: cleanString(subscriberCount),
    total_videos: normalizeCount(channelTotalVideos),
    youtube_channel_id: cleanString(channelId),
    handle: cleanString(channelHandle)
  };

  return Object.values(channel).some(value => value !== null) ? channel : null;
}

async function analyzeVideo({
  videoId,
  title,
  creator,
  url,
  publishedAt,
  channelUrl,
  channelAvatarUrl,
  subscriberCount,
  channelTotalVideos,
  channelId,
  channelHandle
}) {
  return withAnalysisLock(videoId, async () => {
    // Existing videos are an immutable cache and are never analyzed automatically.
    const stored = findStoredVideo(videoId);

    if (stored) {
      console.log(`CACHE HIT: ${videoId}`);
      return { cached: true, videoId, creatorId: stored.creatorId };
    }

    console.log(`CACHE MISS: ${videoId}`);

    const metadata = await resolveAnalysisMetadata({
      videoId,
      title,
      creator,
      url,
      publishedAt,
      channelUrl,
      channelAvatarUrl,
      subscriberCount,
      channelTotalVideos,
      channelId,
      channelHandle
    }, youtubeMetadataService);

    const transcript = await getTranscript(videoId);
    console.log(`Transcript: ${transcript.length} Zeichen`);

    const analysis = await analyzeTranscript({
      transcript,
      title: metadata.title,
      creator: metadata.creator
    });

    const channel = normalizeChannel({
      creator: metadata.creator,
      channelUrl: metadata.channelUrl,
      channelAvatarUrl: metadata.channelAvatarUrl,
      subscriberCount: metadata.subscriberCount,
      channelTotalVideos: metadata.channelTotalVideos,
      channelId: metadata.channelId,
      channelHandle: metadata.channelHandle
    });

    const result = {
      analysis_version: ANALYSIS_VERSION,
      analysis_models: [GEMINI_MODEL],
      video: {
        id: videoId,
        title: cleanString(metadata.title),
        creator: cleanString(metadata.creator),
        url:
          cleanString(metadata.url) ||
          `https://www.youtube.com/watch?v=${videoId}`,
        published_at: cleanString(metadata.publishedAt),
        analyzed_at: new Date().toISOString(),
        channel: channel
          ? { ...channel, updated_at: new Date().toISOString() }
          : null
      },
      summary: analysis.summary,
      companies: analysis.companies
    };

    // Recheck immediately before writing so an existing result is never replaced.
    const latestStored = findStoredVideo(videoId);

    if (latestStored) {
      console.log(`CACHE HIT BEFORE SAVE: ${videoId}`);
      return { cached: true, videoId, creatorId: latestStored.creatorId };
    }

    let creatorId = null;

    if (creatorStorageEnabled()) {
      const saved = creatorRepository.saveVideo(
        {
          creator: metadata.creator,
          channelUrl: metadata.channelUrl,
          channelAvatarUrl: metadata.channelAvatarUrl,
          subscriberCount: metadata.subscriberCount,
          channelTotalVideos: metadata.channelTotalVideos,
          channelId: metadata.channelId,
          channelHandle: metadata.channelHandle
        },
        videoId,
        result
      );
      creatorId = saved.creatorId;
    } else {
      const latestVideos = loadVideos();
      latestVideos[videoId] = result;
      saveVideos(latestVideos);
    }

    console.log(`CACHE SAVED: ${videoId}`);
    return { cached: false, videoId, creatorId };
  });
}

function updateVideoMetadata(videoId, metadata) {
  const found = findStoredVideo(videoId);
  const stored = found?.research;

  if (!stored?.video) {
    return null;
  }

  const currentVideo = stored.video;
  const nextChannel = normalizeChannel(metadata);
  const nextVideo = {
    ...currentVideo,
    title: cleanString(metadata.title) || currentVideo.title,
    creator: cleanString(metadata.creator) || currentVideo.creator,
    url: cleanString(metadata.url) || currentVideo.url,
    published_at: cleanString(metadata.publishedAt) || currentVideo.published_at || null,
    channel: nextChannel
      ? {
          ...(currentVideo.channel || {}),
          ...Object.fromEntries(
            Object.entries(nextChannel).filter(([, value]) => value !== null)
          )
        }
      : currentVideo.channel || null
  };

  const nextResearch = {
    ...stored,
    video: nextVideo
  };

  if (JSON.stringify(nextVideo) !== JSON.stringify(currentVideo)) {
    if (nextChannel && nextVideo.channel) {
      nextVideo.channel.updated_at = new Date().toISOString();
    }

    if (creatorStorageEnabled()) {
      return creatorRepository.updateVideo(videoId, () => nextResearch)?.research || null;
    }

    const videos = loadVideos();
    videos[videoId] = nextResearch;
    saveVideos(videos);
  }

  return nextResearch;
}

function buildCompanyIndex(videos) {
  const companies = new Map();

  for (const video of Object.values(videos)) {
    if (!Array.isArray(video?.companies)) {
      continue;
    }

    for (const storedCompany of video.companies) {
      const company = projectCompanyForRead(
        storedCompany,
        video?.video?.published_at || video?.video?.analyzed_at
      );
      const name = cleanString(company?.company);

      if (!name) {
        continue;
      }

      const ticker = cleanString(company.ticker);
      const assetType = cleanString(company.asset_type) || "other";
      const classification = classifyCompany(company);
      const key = ticker
        ? `ticker:${ticker.toUpperCase()}`
        : `${assetType}:${normalizeIdentity(name)}`;

      if (!companies.has(key)) {
        companies.set(key, {
          company: name,
          ticker,
          asset_type: assetType,
          sector: classification.sector,
          sub_sector: classification.sub_sector,
          mentions: 0,
          videoIds: new Set(),
          presentations: [],
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
        entry.presentations.push({
          videoId: video.video.id,
          title: video.video.title,
          url: video.video.url,
          creator: video.video.creator,
          presentedAt: video.video.published_at || video.video.analyzed_at,
          dateSource: video.video.published_at ? "published" : "analyzed"
        });
      }

      if (SENTIMENTS.has(company.sentiment)) {
        entry.sentiment[company.sentiment] += 1;
      }
    }
  }

  return [...companies.values()]
    .map(entry => {
      const presentations = entry.presentations.sort((a, b) =>
        String(a.presentedAt).localeCompare(String(b.presentedAt))
      );

      return {
        company: entry.company,
        ticker: entry.ticker,
        asset_type: entry.asset_type,
        sector: entry.sector,
        sub_sector: entry.sub_sector,
        mentions: entry.mentions,
        videos: entry.videoIds.size,
        firstPresentedAt: presentations[0]?.presentedAt || null,
        firstPresentation: presentations[0] || null,
        sentiment: entry.sentiment
      };
    })
    .sort((a, b) => b.mentions - a.mentions);
}

function buildChannelIndex(videos) {
  const channels = new Map();

  for (const research of Object.values(videos)) {
    const video = research?.video || {};
    const storedChannel = video.channel || {};
    const name = cleanString(storedChannel.name) || cleanString(video.creator);

    if (!name) {
      continue;
    }

    const key = normalizeIdentity(name);
    const analyzedAt = cleanString(video.analyzed_at);

    if (!channels.has(key)) {
      channels.set(key, {
        name,
        url: cleanString(storedChannel.url),
        avatarUrl: cleanString(storedChannel.avatar_url),
        subscriberCount: cleanString(storedChannel.subscriber_count),
        totalVideos: normalizeCount(storedChannel.total_videos),
        analyzedVideos: 0,
        latestAnalysis: analyzedAt,
        metadataAt: cleanString(storedChannel.updated_at) || analyzedAt
      });
    }

    const entry = channels.get(key);
    entry.analyzedVideos += 1;

    if (
      analyzedAt &&
      (!entry.latestAnalysis || analyzedAt > entry.latestAnalysis)
    ) {
      entry.latestAnalysis = analyzedAt;
    }

    const metadataAt = cleanString(storedChannel.updated_at) || analyzedAt;

    if (metadataAt && (!entry.metadataAt || metadataAt >= entry.metadataAt)) {
      entry.url = cleanString(storedChannel.url) || entry.url;
      entry.avatarUrl = cleanString(storedChannel.avatar_url) || entry.avatarUrl;
      entry.subscriberCount =
        cleanString(storedChannel.subscriber_count) || entry.subscriberCount;
      entry.totalVideos =
        normalizeCount(storedChannel.total_videos) ?? entry.totalVideos;
      entry.metadataAt = metadataAt;
    }
  }

  return [...channels.values()]
    .map(({ metadataAt, ...channel }) => channel)
    .sort((a, b) => {
      if (b.analyzedVideos !== a.analyzedVideos) {
        return b.analyzedVideos - a.analyzedVideos;
      }

      return String(b.latestAnalysis).localeCompare(String(a.latestAnalysis));
    });
}

function profileToChannel(profile) {
  if (!profile) {
    return null;
  }

  return {
    creatorId: profile.creator_id,
    name: profile.display_name,
    url: profile.channel_url,
    avatarUrl: profile.avatar_url,
    subscriberCount: profile.subscriber_count,
    totalVideos: normalizeCount(profile.total_videos),
    analyzedVideos: Number(profile.analyzed_videos) || 0,
    handle: profile.handle,
    youtubeChannelId: profile.youtube_channel_id,
    unresolved: Boolean(profile.unresolved)
  };
}

function buildDashboard(videos, creatorProfile = null) {
  const companies = buildCompanyIndex(videos);
  const dashboardVideos = Object.values(videos)
    .filter(research => research?.video?.id)
    .map(projectResearchForRead)
    .map(research => ({
      id: research.video.id,
      title: research.video.title,
      creator: research.video.creator,
      url: research.video.url,
      publishedAt: research.video.published_at,
      analyzedAt: research.video.analyzed_at,
      channel: research.video.channel || null,
      summary: research.summary,
      companies: Array.isArray(research.companies)
        ? research.companies.map(company => ({
            ...company,
            ...classifyCompany(company),
            ...classifyCall(company),
            price_targets: Array.isArray(company.price_targets)
              ? company.price_targets.map(target => ({ ...target }))
              : [],
            levels: Array.isArray(company.levels)
              ? company.levels.map(level => ({ ...level }))
              : [],
            evidence: Array.isArray(company.evidence)
              ? [...company.evidence]
              : []
          }))
        : []
    }))
    .sort((a, b) => String(b.analyzedAt).localeCompare(String(a.analyzedAt)));

  const channels = creatorProfile
    ? [profileToChannel(creatorProfile)]
    : buildChannelIndex(videos);

  return {
    totalVideos: dashboardVideos.length,
    totalCompanies: companies.length,
    totalReports: companies.reduce((sum, company) => sum + company.mentions, 0),
    creator: profileToChannel(creatorProfile),
    channels,
    companies,
    videos: dashboardVideos
  };
}

app.post("/analyze", async (req, res) => {
  try {
    const {
      videoId,
      title,
      creator,
      url,
      publishedAt,
      channelUrl,
      channelAvatarUrl,
      subscriberCount,
      channelTotalVideos,
      channelId,
      channelHandle
    } = req.body || {};

    if (!isValidVideoId(videoId)) {
      return res.status(400).json({
        error: "Ungültige oder fehlende videoId."
      });
    }

    const result = await analyzeVideo({
      videoId,
      title,
      creator,
      url,
      publishedAt,
      channelUrl,
      channelAvatarUrl,
      subscriberCount,
      channelTotalVideos,
      channelId,
      channelHandle
    });

    return res.json(result);
  } catch (error) {
    console.error("ANALYZE ERROR:", error);
    const upstreamStatus = Number(error?.status);
    const status = [429, 502, 503, 504].includes(upstreamStatus)
      ? upstreamStatus
      : 500;

    return res.status(status).json({
      error: error.message || "Analyse fehlgeschlagen."
    });
  }
});

app.get("/creators", (req, res) => {
  try {
    if (!creatorStorageEnabled()) {
      return res.status(409).json({
        error: "Creator-Storage ist nicht aktiv. Starte den Server mit CREATOR_DATA_ROOT."
      });
    }

    const creators = creatorRepository.listCreators().map(profileToChannel);
    return res.json({
      schemaVersion: 2,
      totalCreators: creators.length,
      totalAnalyzedVideos: creators.reduce(
        (sum, creator) => sum + creator.analyzedVideos,
        0
      ),
      creators
    });
  } catch (error) {
    console.error("GET CREATORS ERROR:", error);
    return res.status(500).json({ error: "Creator Overview konnte nicht geladen werden." });
  }
});

app.get("/creators/resolve", (req, res) => {
  try {
    if (!creatorStorageEnabled()) {
      return res.status(409).json({ error: "Creator-Storage ist nicht aktiv." });
    }

    const profile = creatorRepository.resolveCreator({
      channelId: req.query.channelId,
      channelHandle: req.query.handle,
      channelUrl: req.query.channelUrl,
      creator: req.query.name
    });

    if (!profile) {
      return res.status(404).json({ error: "Creator nicht gefunden." });
    }

    return res.json({ creator: profileToChannel(profile) });
  } catch (error) {
    console.error("RESOLVE CREATOR ERROR:", error);
    return res.status(500).json({ error: "Creator konnte nicht aufgelöst werden." });
  }
});

app.get("/creators/:creatorId/dashboard", (req, res) => {
  try {
    if (!creatorStorageEnabled()) {
      return res.status(409).json({ error: "Creator-Storage ist nicht aktiv." });
    }

    const profile = creatorRepository.getCreator(req.params.creatorId);
    const videos = creatorRepository.getCreatorVideos(req.params.creatorId);

    if (!profile || !videos) {
      return res.status(404).json({ error: "Creator nicht gefunden." });
    }

    return res.json(buildDashboard(videos, profile));
  } catch (error) {
    console.error("GET CREATOR DASHBOARD ERROR:", error);
    return res.status(500).json({ error: "Creator-Dashboard konnte nicht geladen werden." });
  }
});

app.post("/videos/:videoId/metadata", (req, res) => {
  try {
    const { videoId } = req.params;

    if (!isValidVideoId(videoId)) {
      return res.status(400).json({
        error: "Ungültige videoId."
      });
    }

    const research = updateVideoMetadata(videoId, req.body || {});

    if (!research) {
      return res.status(404).json({
        error: "Video nicht gefunden."
      });
    }

    return res.json(research);
  } catch (error) {
    console.error("UPDATE VIDEO METADATA ERROR:", error);

    return res.status(500).json({
      error: "Videometadaten konnten nicht gespeichert werden."
    });
  }
});

app.get("/dashboard", (req, res) => {
  try {
    if (creatorStorageEnabled()) {
      const creatorId = cleanString(req.query.creatorId);
      const profile = creatorId ? creatorRepository.getCreator(creatorId) : null;
      const videos = creatorId ? creatorRepository.getCreatorVideos(creatorId) : null;

      if (!profile || !videos) {
        return res.status(400).json({
          error: "creatorId ist im Creator-Storage erforderlich."
        });
      }

      return res.json(buildDashboard(videos, profile));
    }

    return res.json(buildDashboard(loadVideos()));
  } catch (error) {
    console.error("GET DASHBOARD ERROR:", error);

    return res.status(500).json({
      error: "Dashboard konnte nicht geladen werden."
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

    const found = findStoredVideo(videoId);

    if (!found) {
      return res.status(404).json({
        error: "Video nicht gefunden."
      });
    }

    return res.json({
      ...projectResearchForRead(found.research),
      storage_creator_id: found.creatorId
    });
  } catch (error) {
    console.error("GET VIDEO ERROR:", error);

    return res.status(500).json({
      error: "Video konnte nicht geladen werden."
    });
  }
});

app.get("/companies", (req, res) => {
  try {
    const creatorId = cleanString(req.query.creatorId);
    const videos = creatorStorageEnabled()
      ? creatorRepository.getCreatorVideos(creatorId)
      : loadVideos();

    if (!videos) {
      return res.status(400).json({
        error: "Gültige creatorId ist im Creator-Storage erforderlich."
      });
    }
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

app.get("/market-snapshots/health", (req, res) => {
  const dependenciesConfigured =
    snapshotProvider.isConfigured() && youtubeMetadataService.isConfigured();
  res.json({
    status: !marketSnapshotService
      ? "disabled"
      : dependenciesConfigured
        ? "ready"
        : "configuration_required",
    schemaVersion: 1,
    storageConfigured: Boolean(snapshotRepository),
    marketProviderConfigured: snapshotProvider.isConfigured(),
    youtubeMetadataConfigured: youtubeMetadataService.isConfigured(),
    immutableWrites: true,
    selectionPolicy: "first_tradable_bar_at_or_after_publication"
  });
});

app.get("/market-snapshots/:snapshotId", async (req, res) => {
  try {
    if (!snapshotRepository) {
      return res.status(503).json({
        error: "Market-Snapshot-Storage ist nicht konfiguriert."
      });
    }

    const snapshot = await snapshotRepository.get(req.params.snapshotId);
    if (!snapshot) {
      return res.status(404).json({ error: "MarketSnapshot nicht gefunden." });
    }

    return res.json(snapshot);
  } catch (error) {
    console.error("GET MARKET SNAPSHOT ERROR:", error);
    return res.status(error instanceof SnapshotValidationError ? 400 : 500).json({
      error: error.message || "MarketSnapshot konnte nicht geladen werden.",
      code: error.code || "MARKET_SNAPSHOT_READ_FAILED"
    });
  }
});

app.post("/market-snapshots/capture", async (req, res) => {
  try {
    if (!marketSnapshotService) {
      return res.status(503).json({
        error: "MARKET_SNAPSHOT_ROOT fehlt.",
        code: "SNAPSHOT_STORAGE_NOT_CONFIGURED"
      });
    }

    const { videoId } = req.body || {};
    const companyIndex = req.body?.companyIndex;
    const found = findStoredVideo(videoId);

    if (!found) {
      throw new SnapshotCandidateError("Video nicht gefunden.", "VIDEO_NOT_FOUND", 404);
    }

    const candidate = resolveSnapshotCandidate({ [videoId]: found.research }, {
      videoId,
      companyIndex
    });
    const result = await marketSnapshotService.captureForVideoCall({
      videoId: candidate.videoId,
      callId: candidate.callId,
      ticker: candidate.ticker
    });

    return res.status(result.created ? 201 : 200).json({
      market_snapshot_status: "captured",
      market_snapshot_id: result.snapshot.snapshot_id,
      created: result.created,
      company_index: candidate.companyIndex,
      company: candidate.company,
      reported_symbol: candidate.reportedTicker,
      ticker: candidate.ticker,
      instrument_identity: candidate.instrument_identity,
      snapshot: result.snapshot
    });
  } catch (error) {
    console.error("CAPTURE MARKET SNAPSHOT ERROR:", error);

    let status = 500;
    if (error instanceof SnapshotCandidateError) {
      status = error.status;
    } else if (error instanceof SnapshotValidationError) {
      status = 400;
    } else if (
      error instanceof YouTubeMetadataError ||
      error instanceof MarketDataProviderError
    ) {
      status = error.status === 429
        ? 429
        : ["YOUTUBE_NOT_CONFIGURED", "PROVIDER_NOT_CONFIGURED"].includes(error.code)
          ? 503
          : 502;
    } else if (error instanceof MarketSnapshotUnavailableError) {
      status = 422;
    } else if (error?.code === "IMMUTABLE_SNAPSHOT_CONFLICT") {
      status = 409;
    }

    return res.status(status).json({
      market_snapshot_status: "unavailable",
      error: error.message || "MarketSnapshot konnte nicht erfasst werden.",
      code: error.code || "MARKET_SNAPSHOT_CAPTURE_FAILED",
      retryable: Boolean(error.retryable)
    });
  }
});

app.get("/videos/:videoId/companies/:companyIndex/outcome", async (req, res) => {
  try {
    if (!outcomeService) {
      return res.status(503).json({
        error: "Outcome Engine ist nicht konfiguriert.",
        code: "OUTCOME_ENGINE_NOT_CONFIGURED"
      });
    }

    const { videoId } = req.params;
    const companyIndex = Number(req.params.companyIndex);
    const found = findStoredVideo(videoId);
    if (!found) {
      throw new SnapshotCandidateError("Video nicht gefunden.", "VIDEO_NOT_FOUND", 404);
    }
    const candidate = resolveSnapshotCandidate({ [videoId]: found.research }, {
      videoId,
      companyIndex
    });
    const company = found.research.companies[companyIndex];
    const outcome = await outcomeService.evaluate({
      videoId,
      candidate,
      classification: classifyCall(company)
    });
    return res.json(outcome);
  } catch (error) {
    if (error?.retryable) {
      console.warn(`GET OUTCOME ${error.code || "RETRYABLE"}: ${error.message}`);
    } else {
      console.error("GET OUTCOME ERROR:", error);
    }
    const status = error instanceof SnapshotCandidateError
      ? error.status
      : error instanceof SnapshotValidationError
        ? 400
        : error instanceof MarketSnapshotUnavailableError
          ? 422
          : error instanceof MarketDataProviderError || error instanceof YouTubeMetadataError
            ? (error.status === 429 ? 429 : 502)
            : 500;
    return res.status(status).json({
      error: error?.code === "PROVIDER_RATE_LIMIT"
        ? "API-Limit erreicht. Die Marktdaten können nach dem Minuten-Reset erneut geladen werden."
        : error.message || "Outcome konnte nicht berechnet werden.",
      code: error.code || "OUTCOME_EVALUATION_FAILED",
      retryable: Boolean(error.retryable),
      retry_after_seconds: error.retryAfterSeconds || (error.retryable ? 60 : null)
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
    storageMode: creatorStorageEnabled() ? "creator-v2" : "legacy-flat",
    creatorCount: creatorStorageEnabled()
      ? creatorRepository.listCreators().length
      : null,
    marketSnapshots: {
      enabled: Boolean(marketSnapshotService),
      schemaVersion: 1
    },
    outcomeEngine: {
      enabled: Boolean(outcomeService),
      methodVersion: 1,
      benchmark: "SPY",
      persistentCache: Boolean(outcomeRepository),
      cacheTtlSeconds: 300,
      safeCreditsPerMinute: snapshotProvider.maxRequestsPerMinute
    },
    instrumentIdentity: {
      enabled: true,
      schemaVersion: INSTRUMENT_IDENTITY_VERSION
    }
  });
});

if (!creatorStorageEnabled()) {
  ensureStorage();
}

function startServer(port = PORT) {
  return app.listen(port, () => {
    console.log(`YT Investor Research API läuft auf http://localhost:${port}`);
    console.log(`Analysis Version: ${ANALYSIS_VERSION}`);
    console.log(`Gemini Model: ${GEMINI_MODEL}`);
    console.log(`Storage Mode: ${creatorStorageEnabled() ? "creator-v2" : "legacy-flat"}`);
    console.log(`Market Snapshots: ${marketSnapshotService ? "enabled" : "disabled"}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  buildDashboard,
  creatorStorageEnabled,
  marketSnapshotService,
  profileToChannel,
  snapshotRepository,
  startServer
};
