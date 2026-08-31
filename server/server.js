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
const GEMINI_MODEL = "gemini-3.5-flash";

const ANALYSIS_VERSION = 4;

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

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY fehlt.");
}

const app = express();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const analysisLocks = new Map();

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

9. action nur bei konkreter Handlung:
buy | add | hold | reduce | sell | watch | none

10. evidence:
maximal 3 kurze Transcript-Ausschnitte pro Asset.

11. ticker nur wenn eindeutig identifizierbar.

12. Keine aktuellen oder historischen Marktpreise aus externem Wissen ergänzen.

13. summary:
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
  subscriberCount
}) {
  const channel = {
    name: cleanString(creator),
    url: cleanString(channelUrl),
    avatar_url: cleanString(channelAvatarUrl),
    subscriber_count: cleanString(subscriberCount)
  };

  return Object.values(channel).some(Boolean) ? channel : null;
}

async function analyzeVideo({
  videoId,
  title,
  creator,
  url,
  publishedAt,
  channelUrl,
  channelAvatarUrl,
  subscriberCount
}) {
  return withAnalysisLock(videoId, async () => {
    // Existing videos are an immutable cache and are never analyzed automatically.
    const videos = loadVideos();

    if (hasVideo(videos, videoId)) {
      console.log(`CACHE HIT: ${videoId}`);
      return { cached: true, videoId };
    }

    console.log(`CACHE MISS: ${videoId}`);

    const transcript = await getTranscript(videoId);
    console.log(`Transcript: ${transcript.length} Zeichen`);

    const analysis = await analyzeTranscript({
      transcript,
      title,
      creator
    });

    const channel = normalizeChannel({
      creator,
      channelUrl,
      channelAvatarUrl,
      subscriberCount
    });

    const result = {
      analysis_version: ANALYSIS_VERSION,
      analysis_models: [GEMINI_MODEL],
      video: {
        id: videoId,
        title: cleanString(title),
        creator: cleanString(creator),
        url:
          cleanString(url) ||
          `https://www.youtube.com/watch?v=${videoId}`,
        published_at: cleanString(publishedAt),
        analyzed_at: new Date().toISOString(),
        channel: channel
          ? { ...channel, updated_at: new Date().toISOString() }
          : null
      },
      summary: analysis.summary,
      companies: analysis.companies
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
  });
}

function updateVideoMetadata(videoId, metadata) {
  const videos = loadVideos();
  const stored = videos[videoId];

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
            Object.entries(nextChannel).filter(([, value]) => value)
          )
        }
      : currentVideo.channel || null
  };

  if (JSON.stringify(nextVideo) !== JSON.stringify(currentVideo)) {
    if (nextChannel && nextVideo.channel) {
      nextVideo.channel.updated_at = new Date().toISOString();
    }

    videos[videoId] = {
      ...stored,
      video: nextVideo
    };
    saveVideos(videos);
  }

  return videos[videoId];
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

function buildDashboard(videos) {
  const companies = buildCompanyIndex(videos);
  const dashboardVideos = Object.values(videos)
    .filter(research => research?.video?.id)
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

  return {
    totalVideos: dashboardVideos.length,
    totalCompanies: companies.length,
    totalReports: companies.reduce((sum, company) => sum + company.mentions, 0),
    channels: buildChannelIndex(videos),
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
      subscriberCount
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
      subscriberCount
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
    model: GEMINI_MODEL
  });
});

ensureStorage();

app.listen(PORT, () => {
  console.log(`YT Investor Research API läuft auf http://localhost:${PORT}`);
  console.log(`Analysis Version: ${ANALYSIS_VERSION}`);
  console.log(`Gemini Model: ${GEMINI_MODEL}`);
});
