const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const OUTCOME_CACHE_SCHEMA_VERSION = 1;

function cacheId(videoId, callId) {
  const identity = `${String(videoId || "").trim()}:${String(callId || "").trim()}`;
  if (identity === ":") {
    throw new Error("Outcome-Cache benötigt videoId und callId.");
  }
  return `oc_${crypto.createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}

class OutcomeRepository {
  constructor(rootPath) {
    if (typeof rootPath !== "string" || !rootPath.trim() || !path.isAbsolute(rootPath)) {
      throw new Error("OutcomeRepository benötigt einen absoluten Storage-Pfad.");
    }

    this.rootPath = path.resolve(rootPath);
    if (this.rootPath === path.parse(this.rootPath).root) {
      throw new Error("Das Dateisystem-Stammverzeichnis ist kein sicherer Outcome-Pfad.");
    }
    this.outcomesPath = path.join(this.rootPath, "outcomes");
  }

  getPath(videoId, callId) {
    return path.join(this.outcomesPath, `${cacheId(videoId, callId)}.json`);
  }

  async get(videoId, callId) {
    try {
      const raw = await fs.promises.readFile(this.getPath(videoId, callId), "utf8");
      const record = JSON.parse(raw.replace(/^\uFEFF/u, ""));
      if (
        record?.schema_version !== OUTCOME_CACHE_SCHEMA_VERSION ||
        record.video_id !== videoId ||
        record.call_id !== callId ||
        !record.outcome ||
        !Number.isFinite(Date.parse(record.expires_at))
      ) {
        throw new Error("Ungültiger persistierter Outcome-Cache.");
      }
      return record;
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async set({ videoId, callId, outcome, savedAt, expiresAt }) {
    const record = {
      schema_version: OUTCOME_CACHE_SCHEMA_VERSION,
      cache_id: cacheId(videoId, callId),
      video_id: videoId,
      call_id: callId,
      saved_at: new Date(savedAt).toISOString(),
      expires_at: new Date(expiresAt).toISOString(),
      outcome
    };

    await fs.promises.mkdir(this.outcomesPath, { recursive: true });
    await fs.promises.writeFile(
      this.getPath(videoId, callId),
      `${JSON.stringify(record, null, 2)}\n`,
      "utf8"
    );
    return record;
  }
}

module.exports = {
  OUTCOME_CACHE_SCHEMA_VERSION,
  OutcomeRepository,
  cacheId
};
