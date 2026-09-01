const path = require("node:path");
const {
  createSnapshotDryRun,
  loadSnapshotDryRunSource
} = require("../marketSnapshot/snapshotDryRun");

function parseArguments(argv) {
  const options = {
    dryRun: false,
    source: path.join(__dirname, "..", "data", "videos.json")
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--source") {
      options.source = argv[index + 1];
      index += 1;
    } else if (argument === "--apply") {
      throw new Error("--apply ist in der Snapshot-Dry-Run-Phase gesperrt.");
    } else {
      throw new Error(`Unbekanntes Argument: ${argument}`);
    }
  }

  if (!options.dryRun) {
    throw new Error("Explizites --dry-run ist erforderlich.");
  }

  if (!options.source) {
    throw new Error("--source benötigt einen Dateipfad.");
  }

  return options;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const { sourceVideos, metadata } = loadSnapshotDryRunSource(options.source);
  const report = createSnapshotDryRun(sourceVideos, metadata);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`SNAPSHOT DRY RUN ERROR: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  main,
  parseArguments
};
