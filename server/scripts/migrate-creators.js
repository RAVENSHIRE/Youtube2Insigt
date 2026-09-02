#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  buildMigrationPlan,
  createDryRunReport
} = require("../storage/creatorMigration");
const { stageMigration } = require("../storage/creatorStaging");

const SERVER_DIR = path.resolve(__dirname, "..");
const REPOSITORY_ROOT = path.resolve(SERVER_DIR, "..");
const DEFAULT_SOURCE = path.join(SERVER_DIR, "data", "videos.json");
const DEFAULT_OVERRIDES = path.join(
  SERVER_DIR,
  "migrations",
  "creator-overrides.json"
);
const LIVE_DATA_DIR = path.join(SERVER_DIR, "data");

function usage() {
  return [
    "Creator storage migration (read-only dry run)",
    "",
    "Usage:",
    "  node server/scripts/migrate-creators.js --dry-run [--source <path>] [--json]",
    "  node server/scripts/migrate-creators.js --stage <path> [--source <path>] [--json]",
    "",
    "Options:",
    "  --dry-run       Required safety flag. No files are written.",
    "  --stage PATH    Write and verify an isolated staging directory.",
    "  --source PATH   Flat videos.json source (default: server/data/videos.json).",
    "  --overrides PATH  Reviewed creator assignments.",
    "  --json          Emit a machine-readable JSON report.",
    "  --help          Show this help.",
    "",
    "Live apply/activation is intentionally not implemented yet."
  ].join("\n");
}

function parseArguments(argv) {
  const options = {
    dryRun: false,
    json: false,
    source: DEFAULT_SOURCE,
    stage: null,
    overrides: DEFAULT_OVERRIDES
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--stage") {
      const stage = argv[index + 1];

      if (!stage) {
        throw new Error("Nach --stage fehlt ein Verzeichnispfad.");
      }

      options.stage = path.resolve(process.cwd(), stage);
      index += 1;
    } else if (argument === "--json") {
      options.json = true;
    } else if (argument === "--source") {
      const source = argv[index + 1];

      if (!source) {
        throw new Error("Nach --source fehlt ein Dateipfad.");
      }

      options.source = path.resolve(process.cwd(), source);
      index += 1;
    } else if (argument === "--overrides") {
      const overrides = argv[index + 1];

      if (!overrides) {
        throw new Error("Nach --overrides fehlt ein Dateipfad.");
      }

      options.overrides = path.resolve(process.cwd(), overrides);
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--apply") {
      throw new Error("--apply ist in dieser Sicherheitsphase absichtlich deaktiviert.");
    } else {
      throw new Error(`Unbekannte Option: ${argument}`);
    }
  }

  return options;
}

function readSource(sourcePath) {
  const sourceBuffer = fs.readFileSync(sourcePath);
  const raw = sourceBuffer.toString("utf8").replace(/^\uFEFF/u, "");
  const parsed = JSON.parse(raw);

  return {
    raw,
    parsed,
    bytes: sourceBuffer.length,
    sha256: crypto.createHash("sha256").update(sourceBuffer).digest("hex")
  };
}

function readOverrides(overridesPath) {
  const raw = fs.readFileSync(overridesPath, "utf8").replace(/^\uFEFF/u, "");
  const overrides = JSON.parse(raw);

  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new Error("Die Override-Datei muss ein JSON-Objekt enthalten.");
  }

  return overrides;
}

function isPathInside(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);

  return relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function formatHumanReport(report) {
  const lines = [
    report.mode === "staging"
      ? "CREATOR STORAGE MIGRATION — STAGING"
      : "CREATOR STORAGE MIGRATION — DRY RUN",
    "===================================",
    `Quelle: ${report.source.path}`,
    `SHA256: ${report.source.sha256}`,
    `Bytes: ${report.source.bytes}`,
    `Schema-Ziel: ${report.schemaVersion}`,
    "",
    "Validierung:",
    `  Quellvideos: ${report.validation.sourceVideoCount}`,
    `  Geplante Videos: ${report.validation.migratedVideoCount}`,
    `  Creator: ${report.validation.creatorCount}`,
    `  Overrides angewendet: ${report.validation.overridesApplied}`,
    `  Unaufgelöste Videos: ${report.validation.unresolvedVideoCount}`,
    `  Inhalte unverändert: ${report.validation.contentPreserved ? "JA" : "NEIN"}`,
    `  Aktivierbar: ${report.validation.canActivate ? "JA" : "NEIN"}`,
    "",
    "Creator-Zuordnung:"
  ];

  for (const creator of report.creators) {
    const identity = creator.youtubeChannelId || creator.handle || "unaufgelöst";
    lines.push(
      `  - ${creator.displayName} | ${identity} | ${creator.analyzedVideos} Videos | ${creator.creatorId}`
    );
  }

  lines.push("", `Warnungen: ${report.warnings.length}`);

  for (const warning of report.warnings) {
    lines.push(
      `  - [${warning.code}] ${warning.videoId || "global"}: ${warning.message}`
    );
  }

  lines.push("", `Fehler: ${report.errors.length}`);

  for (const error of report.errors) {
    lines.push(
      `  - [${error.code}] ${error.videoId || "global"}: ${error.message}`
    );
  }

  lines.push(
    "",
    report.mode === "staging"
      ? `Staging-Ziel: ${report.staging.targetPath}`
      : "Schreibvorgänge: NEIN",
    report.mode === "staging"
      ? `Staging-Dateien: ${report.staging.fileCount}; Prüfsummen: JA`
      : "Die bestehende videos.json wurde nicht verändert.",
    "Live-Aktivierung: NEIN"
  );

  return lines.join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);

  if (options.help) {
    console.log(usage());
    return 0;
  }

  if (options.dryRun === Boolean(options.stage)) {
    throw new Error(
      "Gib genau einen Modus an: --dry-run oder --stage <path>."
    );
  }

  if (options.stage && isPathInside(LIVE_DATA_DIR, options.stage)) {
    throw new Error("Das Live-Datenverzeichnis darf nicht als Staging-Ziel dienen.");
  }

  const source = readSource(options.source);
  const overrides = readOverrides(options.overrides);
  const plan = buildMigrationPlan(source.parsed, { overrides });
  let report = createDryRunReport(plan, {
    path: path.relative(REPOSITORY_ROOT, options.source).replace(/\\/gu, "/"),
    bytes: source.bytes,
    sha256: source.sha256
  });

  if (options.stage) {
    const staging = await stageMigration(plan, {
      targetPath: options.stage,
      source: report.source
    });
    report = {
      ...report,
      mode: "staging",
      staging,
      writesPerformed: true
    };
  }

  console.log(
    options.json
      ? JSON.stringify(report, null, 2)
      : formatHumanReport(report)
  );

  return report.validation.canActivate ? 0 : 1;
}

if (require.main === module) {
  main()
    .then(exitCode => {
      process.exitCode = exitCode;
    })
    .catch(error => {
      console.error(`Migration abgebrochen: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  formatHumanReport,
  main,
  parseArguments,
  readOverrides,
  readSource,
  usage
};
