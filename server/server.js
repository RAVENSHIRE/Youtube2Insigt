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

const GEMINI_MODEL =
  process.env.GEMINI_MODEL || "gemini-3.6-flash";

const GEMINI_FALLBACK_MODEL =
  process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash";

const ANALYSIS_VERSION = 4;

const CHUNK_SIZE = 8000;
const CHUNK_OVERLAP = 800;

const DATA_DIR = path.join(__dirname, "data");
const VIDEO_FILE = path.join(DATA_DIR, "videos.json");

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY fehlt.");
}

const app = express();

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

const analysisLocks = new Map();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const ANALYSIS_SCHEMA = {
  type: "object",

  properties: {
    companies: {
      type: "array",

      items: {
        type: "object",

        properties: {
          company: {
            type: "string"
          },

          ticker: {
            type: "string"
          },

          asset_type: {
            type: "string",
            enum: [
              "stock",
              "crypto",
              "etf",
              "index",
              "commodity",
              "other"
            ]
          },

          sentiment: {
            type: "string",
            enum: [
              "bull",
              "neutral",
              "bear"
            ]
          },

          thesis: {
            type: "string"
          },

          mentioned_move_pct: {
            type: "number"
          },

          price_targets: {
            type: "array",

            items: {
              type: "object",

              properties: {
                value: {
                  type: "number"
                },

                currency: {
                  type: "string"
                },

                source: {
                  type: "string"
                },

                context: {
                  type: "string"
                }
              },

              required: [
                "value"
              ]
            }
          },

          time_horizon: {
            type: "string"
          },

          action: {
            type: "string",
            enum: [
              "buy",
              "add",
              "hold",
              "reduce",
              "sell",
              "watch",
              "none"
            ]
          },

          levels: {
            type: "array",

            items: {
              type: "object",

              properties: {
                type: {
                  type: "string",
                  enum: [
                    "support",
                    "resistance",
                    "breakout",
                    "entry",
                    "stop_loss",
                    "reference"
                  ]
                },

                value: {
                  type: "number"
                },

                currency: {
                  type: "string"
                },

                context: {
                  type: "string"
                }
              },

              required: [
                "type",
                "value"
              ]
            }
          },

          evidence: {
            type: "array",
            items: {
              type: "string"
            }
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

  required: [
    "companies"
  ]
};

const SUMMARY_SCHEMA = {
  type: "object",

  properties: {
    summary: {
      type: "string"
    }
  },

  required: [
    "summary"
  ]
};

function ensureStorage() {
  fs.mkdirSync(DATA_DIR, {
    recursive: true
  });

  if (!fs.existsSync(VIDEO_FILE)) {
    fs.writeFileSync(
      VIDEO_FILE,
      "{}",
      "utf8"
    );
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

  if (
    !videos ||
    typeof videos !== "object" ||
    Array.isArray(videos)
  ) {
    throw new Error(
      "videos.json muss ein JSON-Objekt enthalten."
    );
  }

  return videos;
}

function saveVideos(videos) {
  ensureStorage();

  const tempFile = `${VIDEO_FILE}.tmp`;

  fs.writeFileSync(
    tempFile,
    JSON.stringify(videos, null, 2),
    "utf8"
  );

  fs.renameSync(
    tempFile,
    VIDEO_FILE
  );
}

function hasVideo(videos, videoId) {
  return Object.prototype.hasOwnProperty.call(
    videos,
    videoId
  );
}

function cleanString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const result = value.trim();

  return result || null;
}

function normalizeNumber(value) {
  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .trim()
    .replace(",", ".");

  const result = Number(normalized);

  return Number.isFinite(result)
    ? result
    : null;
}

function normalizeIdentity(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function isValidVideoId(videoId) {
  return (
    typeof videoId === "string" &&
    /^[A-Za-z0-9_-]{11}$/.test(videoId)
  );
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
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  );
}

function isRetryable(error) {
  const status =
    error?.status ||
    error?.code;

  return (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    error instanceof SyntaxError
  );
}

async function generateStructured({
  prompt,
  schema,
  maxOutputTokens
}) {
  const models = [
    GEMINI_MODEL,
    GEMINI_FALLBACK_MODEL
  ].filter(
    (model, index, all) =>
      model &&
      all.indexOf(model) === index
  );

  let lastError;

  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(
          `Gemini ${model} ${attempt}/2`
        );

        const response =
          await ai.models.generateContent({
            model,
            contents: prompt,

            config: {
              responseMimeType:
                "application/json",

              responseSchema:
                schema,

              maxOutputTokens
            }
          });

        const finishReason =
          response.candidates?.[0]
            ?.finishReason;

        if (
          finishReason &&
          finishReason !== "STOP"
        ) {
          const error =
            new Error(
              `Gemini finishReason: ${finishReason}`
            );

          error.code =
            finishReason;

          throw error;
        }

        const text =
          response.text?.trim();

        if (!text) {
          throw new Error(
            "Gemini hat keine Antwort zurückgegeben."
          );
        }

        return {
          data: JSON.parse(text),
          model
        };
      } catch (error) {
        lastError = error;

        console.error(
          `Gemini Fehler (${model}):`,
          error.message
        );

        if (
          error.code === "MAX_TOKENS"
        ) {
          break;
        }

        if (
          !isRetryable(error)
        ) {
          break;
        }

        if (attempt < 2) {
          await wait(
            attempt * 2000
          );
        }
      }
    }
  }

  throw (
    lastError ||
    new Error(
      "Gemini Analyse fehlgeschlagen."
    )
  );
}

async function withAnalysisLock(
  videoId,
  callback
) {
  const existing =
    analysisLocks.get(videoId);

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

  analysisLocks.set(
    videoId,
    promise
  );

  return promise;
}

async function getTranscript(videoId) {
  const items =
    await YoutubeTranscript.fetchTranscript(
      videoId
    );

  const transcript = items
    .map(item =>
      cleanString(item.text)
    )
    .filter(Boolean)
    .join(" ")
    .trim();

  if (!transcript) {
    throw new Error(
      "Kein Transcript gefunden."
    );
  }

  return transcript;
}

function chunkTranscript(transcript) {
  if (
    transcript.length <=
    CHUNK_SIZE
  ) {
    return [transcript];
  }

  const chunks = [];
  let start = 0;

  while (
    start < transcript.length
  ) {
    let end =
      Math.min(
        start + CHUNK_SIZE,
        transcript.length
      );

    if (
      end < transcript.length
    ) {
      const boundary =
        transcript.lastIndexOf(
          " ",
          end
        );

      if (
        boundary >
        start +
          CHUNK_SIZE * 0.7
      ) {
        end = boundary;
      }
    }

    const chunk =
      transcript
        .slice(start, end)
        .trim();

    if (chunk) {
      chunks.push(chunk);
    }

    if (
      end >= transcript.length
    ) {
      break;
    }

    start =
      Math.max(
        end - CHUNK_OVERLAP,
        start + 1
      );
  }

  return chunks;
}

function normalizeTarget(target) {
  if (
    !target ||
    typeof target !== "object"
  ) {
    return null;
  }

  const value =
    normalizeNumber(
      target.value
    );

  if (value === null) {
    return null;
  }

  return {
    value,

    currency:
      cleanString(
        target.currency
      ),

    source:
      cleanString(
        target.source
      ),

    context:
      cleanString(
        target.context
      )
  };
}

function normalizeLevel(level) {
  if (
    !level ||
    typeof level !== "object"
  ) {
    return null;
  }

  const value =
    normalizeNumber(
      level.value
    );

  if (value === null) {
    return null;
  }

  const allowed = new Set([
    "support",
    "resistance",
    "breakout",
    "entry",
    "stop_loss",
    "reference"
  ]);

  return {
    type:
      allowed.has(level.type)
        ? level.type
        : "reference",

    value,

    currency:
      cleanString(
        level.currency
      ),

    context:
      cleanString(
        level.context
      )
  };
}

function normalizeCompany(company) {
  if (
    !company ||
    typeof company !== "object"
  ) {
    return null;
  }

  const name =
    cleanString(
      company.company
    );

  if (!name) {
    return null;
  }

  const assetTypes = new Set([
    "stock",
    "crypto",
    "etf",
    "index",
    "commodity",
    "other"
  ]);

  const sentiments = new Set([
    "bull",
    "neutral",
    "bear"
  ]);

  const actions = new Set([
    "buy",
    "add",
    "hold",
    "reduce",
    "sell",
    "watch",
    "none"
  ]);

  return {
    company:
      name,

    ticker:
      cleanString(
        company.ticker
      )?.toUpperCase() ||
      null,

    asset_type:
      assetTypes.has(
        company.asset_type
      )
        ? company.asset_type
        : "other",

    sentiment:
      sentiments.has(
        company.sentiment
      )
        ? company.sentiment
        : "neutral",

    thesis:
      cleanString(
        company.thesis
      ),

    mentioned_move_pct:
      normalizeNumber(
        company.mentioned_move_pct
      ),

    price_targets:
      Array.isArray(
        company.price_targets
      )
        ? company.price_targets
            .map(normalizeTarget)
            .filter(Boolean)
        : [],

    time_horizon:
      cleanString(
        company.time_horizon
      ),

    action:
      actions.has(
        company.action
      )
        ? company.action
        : "none",

    levels:
      Array.isArray(
        company.levels
      )
        ? company.levels
            .map(normalizeLevel)
            .filter(Boolean)
        : [],

    evidence:
      Array.isArray(
        company.evidence
      )
        ? company.evidence
            .map(cleanString)
            .filter(Boolean)
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

  if (
    current.includes(incoming)
  ) {
    return current;
  }

  if (
    incoming.includes(current)
  ) {
    return incoming;
  }

  return `${current} ${incoming}`
    .slice(0, 1500);
}

function mergeUnique(
  current,
  incoming,
  keyFn
) {
  const map =
    new Map();

  for (
    const item of [
      ...current,
      ...incoming
    ]
  ) {
    map.set(
      keyFn(item),
      item
    );
  }

  return [...map.values()];
}

function sameAsset(a, b) {
  if (
    a.ticker &&
    b.ticker &&
    a.ticker === b.ticker &&
    a.asset_type ===
      b.asset_type
  ) {
    return true;
  }

  return (
    a.asset_type ===
      b.asset_type &&
    normalizeIdentity(
      a.company
    ) ===
      normalizeIdentity(
        b.company
      )
  );
}

function selectSentiment(counts) {
  const sorted =
    Object.entries(counts)
      .sort(
        (a, b) =>
          b[1] - a[1]
      );

  if (
    sorted.length > 1 &&
    sorted[0][1] ===
      sorted[1][1]
  ) {
    return "neutral";
  }

  return (
    sorted[0]?.[0] ||
    "neutral"
  );
}

function mergeCompanies(
  extractedCompanies
) {
  const merged = [];

  for (
    const rawCompany of
    extractedCompanies
  ) {
    const company =
      normalizeCompany(
        rawCompany
      );

    if (!company) {
      continue;
    }

    let existing =
      merged.find(item =>
        sameAsset(
          item,
          company
        )
      );

    if (!existing) {
      existing = {
        ...company,

        _sentiments: {
          bull:
            company.sentiment ===
            "bull"
              ? 1
              : 0,

          neutral:
            company.sentiment ===
            "neutral"
              ? 1
              : 0,

          bear:
            company.sentiment ===
            "bear"
              ? 1
              : 0
        }
      };

      merged.push(existing);

      continue;
    }

    existing._sentiments[
      company.sentiment
    ] += 1;

    existing.sentiment =
      selectSentiment(
        existing._sentiments
      );

    if (
      company.company.length >
      existing.company.length
    ) {
      existing.company =
        company.company;
    }

    existing.ticker =
      existing.ticker ||
      company.ticker;

    existing.thesis =
      mergeText(
        existing.thesis,
        company.thesis
      );

    existing.mentioned_move_pct =
      existing.mentioned_move_pct ??
      company.mentioned_move_pct;

    existing.time_horizon =
      existing.time_horizon ||
      company.time_horizon;

    if (
      existing.action ===
        "none" &&
      company.action !==
        "none"
    ) {
      existing.action =
        company.action;
    }

    existing.price_targets =
      mergeUnique(
        existing.price_targets,
        company.price_targets,

        target =>
          [
            target.value,
            target.currency,
            target.source
          ].join("|")
      );

    existing.levels =
      mergeUnique(
        existing.levels,
        company.levels,

        level =>
          [
            level.type,
            level.value,
            level.currency
          ].join("|")
      );

    existing.evidence =
      mergeUnique(
        existing.evidence,
        company.evidence,

        evidence =>
          evidence
      ).slice(0, 5);
  }

  return merged.map(company => {
    const {
      _sentiments,
      ...result
    } = company;

    return {
      ...result,

      sentiment:
        selectSentiment(
          _sentiments
        )
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
  const response =
    await generateStructured({
      prompt:
        buildExtractionPrompt({
          transcript,
          title,
          creator,
          chunkIndex,
          chunkCount
        }),

      schema:
        ANALYSIS_SCHEMA,

      maxOutputTokens:
        8192
    });

  return {
    companies:
      Array.isArray(
        response.data?.companies
      )
        ? response.data.companies
        : [],

    model:
      response.model
  };
}

async function summarizeVideo({
  transcript,
  title,
  creator
}) {
  const response =
    await generateStructured({
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

      schema:
        SUMMARY_SCHEMA,

      maxOutputTokens:
        512
    });

  return {
    summary:
      cleanString(
        response.data?.summary
      ),

    model:
      response.model
  };
}

async function analyzeVideo({
  videoId,
  title,
  creator,
  url
}) {
  return withAnalysisLock(
    videoId,
    async () => {
      /*
       * IMMUTABLE CACHE:
       * Ein vorhandenes Video wird niemals automatisch neu analysiert.
       */
      const videos =
        loadVideos();

      if (
        hasVideo(
          videos,
          videoId
        )
      ) {
        console.log(
          `CACHE HIT: ${videoId}`
        );

        return {
          cached: true,
          videoId
        };
      }

      console.log(
        `CACHE MISS: ${videoId}`
      );

      const transcript =
        await getTranscript(
          videoId
        );

      const chunks =
        chunkTranscript(
          transcript
        );

      console.log(
        `Transcript: ${transcript.length} Zeichen / ${chunks.length} Chunks`
      );

      const extracted = [];
      const modelsUsed =
        new Set();

      for (
        let index = 0;
        index < chunks.length;
        index++
      ) {
        console.log(
          `Chunk ${index + 1}/${chunks.length}`
        );

        const result =
          await extractChunk({
            transcript:
              chunks[index],

            title,
            creator,

            chunkIndex:
              index,

            chunkCount:
              chunks.length
          });

        extracted.push(
          ...result.companies
        );

        modelsUsed.add(
          result.model
        );
      }

      const companies =
        mergeCompanies(
          extracted
        );

      const summaryResult =
        await summarizeVideo({
          transcript,
          title,
          creator
        });

      modelsUsed.add(
        summaryResult.model
      );

      const result = {
        analysis_version:
          ANALYSIS_VERSION,

        analysis_models:
          [...modelsUsed],

        video: {
          id:
            videoId,

          title:
            cleanString(title),

          creator:
            cleanString(creator),

          url:
            cleanString(url) ||
            `https://www.youtube.com/watch?v=${videoId}`,

          analyzed_at:
            new Date().toISOString()
        },

        summary:
          summaryResult.summary,

        companies
      };

      /*
       * RACE-SAFETY:
       * Direkt vor dem Schreiben erneut prüfen.
       * Niemals existierende Daten überschreiben.
       */
      const latestVideos =
        loadVideos();

      if (
        hasVideo(
          latestVideos,
          videoId
        )
      ) {
        console.log(
          `CACHE HIT BEFORE SAVE: ${videoId}`
        );

        return {
          cached: true,
          videoId
        };
      }

      latestVideos[videoId] =
        result;

      saveVideos(
        latestVideos
      );

      console.log(
        `CACHE SAVED: ${videoId}`
      );

      return {
        cached: false,
        videoId
      };
    }
  );
}

app.post(
  "/analyze",
  async (req, res) => {
    try {
      const {
        videoId,
        title,
        creator,
        url
      } = req.body || {};

      if (
        !isValidVideoId(videoId)
      ) {
        return res
          .status(400)
          .json({
            error:
              "Ungültige oder fehlende videoId."
          });
      }

      const result =
        await analyzeVideo({
          videoId,
          title,
          creator,
          url
        });

      return res.json(
        result
      );
    } catch (error) {
      console.error(
        "ANALYZE ERROR:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            error.message ||
            "Analyse fehlgeschlagen."
        });
    }
  }
);

app.get(
  "/videos/:videoId",
  (req, res) => {
    try {
      const {
        videoId
      } = req.params;

      if (
        !isValidVideoId(videoId)
      ) {
        return res
          .status(400)
          .json({
            error:
              "Ungültige videoId."
          });
      }

      const videos =
        loadVideos();

      if (
        !hasVideo(
          videos,
          videoId
        )
      ) {
        return res
          .status(404)
          .json({
            error:
              "Video nicht gefunden."
          });
      }

      return res.json(
        videos[videoId]
      );
    } catch (error) {
      console.error(
        "GET VIDEO ERROR:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "Video konnte nicht geladen werden."
        });
    }
  }
);

app.get(
  "/companies",
  (req, res) => {
    try {
      const videos =
        loadVideos();

      const companies =
        new Map();

      for (
        const video of
        Object.values(videos)
      ) {
        if (
          !Array.isArray(
            video?.companies
          )
        ) {
          continue;
        }

        for (
          const company of
          video.companies
        ) {
          const name =
            cleanString(
              company?.company
            );

          if (!name) {
            continue;
          }

          const ticker =
            cleanString(
              company.ticker
            );

          const assetType =
            cleanString(
              company.asset_type
            ) || "other";

          const key =
            ticker
              ? `${assetType}:${ticker.toUpperCase()}`
              : `${assetType}:${normalizeIdentity(name)}`;

          if (
            !companies.has(key)
          ) {
            companies.set(
              key,
              {
                company:
                  name,

                ticker:
                  ticker,

                asset_type:
                  assetType,

                mentions:
                  0,

                videoIds:
                  new Set(),

                sentiment: {
                  bull: 0,
                  neutral: 0,
                  bear: 0
                }
              }
            );
          }

          const entry =
            companies.get(key);

          entry.mentions += 1;

          if (
            video?.video?.id
          ) {
            entry.videoIds.add(
              video.video.id
            );
          }

          if (
            ["bull", "neutral", "bear"]
              .includes(
                company.sentiment
              )
          ) {
            entry.sentiment[
              company.sentiment
            ] += 1;
          }
        }
      }

      const result =
        [...companies.values()]
          .map(entry => ({
            company:
              entry.company,

            ticker:
              entry.ticker,

            asset_type:
              entry.asset_type,

            mentions:
              entry.mentions,

            videos:
              entry.videoIds.size,

            sentiment:
              entry.sentiment
          }))
          .sort(
            (a, b) =>
              b.mentions -
              a.mentions
          );

      return res.json({
        totalVideos:
          Object.keys(videos).length,

        totalCompanies:
          result.length,

        companies:
          result
      });
    } catch (error) {
      console.error(
        "GET COMPANIES ERROR:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "Companies konnten nicht geladen werden."
        });
    }
  }
);

app.get(
  "/market",
  async (req, res) => {
    try {
      const symbol =
        String(
          req.query.symbol ||
          ""
        )
          .trim()
          .toUpperCase();

      if (
        !isValidMarketSymbol(
          symbol
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              "Ungültiges oder fehlendes Symbol."
          });
      }

      return res.json(
        await getQuote(symbol)
      );
    } catch (error) {
      console.error(
        "MARKET DATA ERROR:",
        error
      );

      return res
        .status(502)
        .json({
          error:
            error.message ||
            "Market data unavailable."
        });
    }
  }
);

app.get(
  "/health",
  (req, res) => {
    res.json({
      status:
        "ok",

      analysisVersion:
        ANALYSIS_VERSION,

      model:
        GEMINI_MODEL,

      fallbackModel:
        GEMINI_FALLBACK_MODEL
    });
  }
);

ensureStorage();

app.listen(
  PORT,
  () => {
    console.log(
      `YT Investor Research API läuft auf http://localhost:${PORT}`
    );

    console.log(
      `Analysis Version: ${ANALYSIS_VERSION}`
    );

    console.log(
      `Gemini Model: ${GEMINI_MODEL}`
    );

    console.log(
      `Fallback Model: ${GEMINI_FALLBACK_MODEL}`
    );
  }
);