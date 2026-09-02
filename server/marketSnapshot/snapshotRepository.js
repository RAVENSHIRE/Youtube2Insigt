const fs = require("node:fs");
const path = require("node:path");
const {
  SnapshotValidationError,
  deepFreeze,
  stableStringify,
  validateSnapshot
} = require("./snapshotSchema");

class SnapshotConflictError extends Error {
  constructor(snapshotId) {
    super(`Immutable MarketSnapshot ${snapshotId} existiert mit anderem Inhalt.`);
    this.name = "SnapshotConflictError";
    this.code = "IMMUTABLE_SNAPSHOT_CONFLICT";
    this.snapshotId = snapshotId;
  }
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

class SnapshotRepository {
  constructor(rootPath) {
    if (typeof rootPath !== "string" || !rootPath.trim()) {
      throw new Error("MARKET_SNAPSHOT_ROOT fehlt.");
    }

    if (!path.isAbsolute(rootPath)) {
      throw new Error("MARKET_SNAPSHOT_ROOT muss absolut sein.");
    }

    this.rootPath = path.resolve(rootPath);

    if (this.rootPath === path.parse(this.rootPath).root) {
      throw new Error("Das Dateisystem-Stammverzeichnis ist kein sicherer Snapshot-Pfad.");
    }

    this.snapshotsPath = path.join(this.rootPath, "snapshots");
  }

  getPath(snapshotId) {
    if (!/^ms_[a-f0-9]{24}$/u.test(String(snapshotId || ""))) {
      throw new SnapshotValidationError("Ungültige snapshotId.", "INVALID_SNAPSHOT_ID");
    }

    return path.join(this.snapshotsPath, `${snapshotId}.json`);
  }

  async create(snapshot) {
    validateSnapshot(snapshot);
    const snapshotPath = this.getPath(snapshot.snapshot_id);
    const content = serializeJson(snapshot);

    await fs.promises.mkdir(this.snapshotsPath, { recursive: true });

    try {
      await fs.promises.writeFile(snapshotPath, content, {
        encoding: "utf8",
        flag: "wx"
      });

      return {
        created: true,
        snapshot: deepFreeze(structuredClone(snapshot))
      };
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
    }

    const existing = await this.get(snapshot.snapshot_id);

    if (stableStringify(existing) !== stableStringify(snapshot)) {
      throw new SnapshotConflictError(snapshot.snapshot_id);
    }

    return {
      created: false,
      snapshot: existing
    };
  }

  async get(snapshotId) {
    const snapshotPath = this.getPath(snapshotId);

    try {
      const raw = await fs.promises.readFile(snapshotPath, "utf8");
      const snapshot = JSON.parse(raw.replace(/^\uFEFF/u, ""));
      validateSnapshot(snapshot);
      return deepFreeze(snapshot);
    } catch (error) {
      if (error?.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }
}

module.exports = {
  SnapshotConflictError,
  SnapshotRepository
};
