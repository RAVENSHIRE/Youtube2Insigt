const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function assertNewTarget(targetPath) {
  if (!path.isAbsolute(targetPath)) {
    throw new Error("Der Staging-Pfad muss absolut sein.");
  }

  if (targetPath === path.parse(targetPath).root) {
    throw new Error("Das Dateisystem-Stammverzeichnis ist kein sicherer Staging-Pfad.");
  }

  if (fs.existsSync(targetPath)) {
    throw new Error(`Der Staging-Pfad existiert bereits: ${targetPath}`);
  }
}

function createCreatorIndex(plan) {
  return {
    schema_version: plan.schemaVersion,
    creators: [...plan.creators.values()]
      .map(creator => ({ ...creator.profile }))
      .sort((left, right) =>
        right.analyzed_videos - left.analyzed_videos ||
        left.display_name.localeCompare(right.display_name)
      )
  };
}

function createVideoIndex(plan) {
  return {
    schema_version: plan.schemaVersion,
    videos: Object.fromEntries(
      Object.entries(plan.videoIndex).sort(([left], [right]) =>
        left.localeCompare(right)
      )
    )
  };
}

function createStagingDocuments(plan) {
  const documents = new Map([
    ["creators/index.json", createCreatorIndex(plan)],
    ["creators/video-index.json", createVideoIndex(plan)]
  ]);

  for (const [creatorId, creator] of [...plan.creators.entries()].sort()) {
    documents.set(`creators/${creatorId}/profile.json`, creator.profile);
    documents.set(`creators/${creatorId}/videos.json`, creator.videos);
  }

  return documents;
}

async function writeDocuments(buildPath, documents) {
  const files = [];

  for (const [relativePath, document] of documents) {
    const outputPath = path.join(buildPath, ...relativePath.split("/"));
    const content = serializeJson(document);

    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.promises.writeFile(outputPath, content, {
      encoding: "utf8",
      flag: "wx"
    });

    files.push({
      path: relativePath,
      bytes: Buffer.byteLength(content),
      sha256: sha256(content)
    });
  }

  return files;
}

async function validateDocuments(buildPath, files, plan) {
  let stagedVideoCount = 0;

  for (const file of files) {
    const filePath = path.join(buildPath, ...file.path.split("/"));
    const content = await fs.promises.readFile(filePath, "utf8");

    if (Buffer.byteLength(content) !== file.bytes || sha256(content) !== file.sha256) {
      throw new Error(`Staging-Prüfsumme stimmt nicht: ${file.path}`);
    }

    const parsed = JSON.parse(content);

    if (/\/videos\.json$/u.test(file.path)) {
      stagedVideoCount += Object.keys(parsed).length;
    }
  }

  const creatorIndex = JSON.parse(
    await fs.promises.readFile(
      path.join(buildPath, "creators", "index.json"),
      "utf8"
    )
  );
  const videoIndex = JSON.parse(
    await fs.promises.readFile(
      path.join(buildPath, "creators", "video-index.json"),
      "utf8"
    )
  );

  if (creatorIndex.creators.length !== plan.validation.creatorCount) {
    throw new Error("Die Creator-Anzahl im Staging-Index stimmt nicht.");
  }

  if (Object.keys(videoIndex.videos).length !== plan.validation.migratedVideoCount) {
    throw new Error("Die Video-Anzahl im Staging-Index stimmt nicht.");
  }

  if (stagedVideoCount !== plan.validation.migratedVideoCount) {
    throw new Error("Die Summe der per-Creator-Videodateien stimmt nicht.");
  }

  return {
    creatorCount: creatorIndex.creators.length,
    videoCount: Object.keys(videoIndex.videos).length,
    stagedVideoCount,
    checksumsVerified: true
  };
}

async function stageMigration(plan, options) {
  if (!plan?.validation?.canActivate) {
    throw new Error("Eine Migration mit Validierungsfehlern darf nicht gestaged werden.");
  }

  const targetPath = path.resolve(options.targetPath);
  const buildPath = `${targetPath}.building-${process.pid}`;

  assertNewTarget(targetPath);
  assertNewTarget(buildPath);

  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.promises.mkdir(buildPath);

  const documents = createStagingDocuments(plan);
  const files = await writeDocuments(buildPath, documents);
  const validation = await validateDocuments(buildPath, files, plan);
  const manifest = {
    schema_version: plan.schemaVersion,
    mode: "staging",
    created_at: new Date().toISOString(),
    source: options.source || null,
    validation: {
      ...plan.validation,
      ...validation
    },
    files
  };
  const manifestContent = serializeJson(manifest);

  await fs.promises.writeFile(
    path.join(buildPath, "migration-manifest.json"),
    manifestContent,
    { encoding: "utf8", flag: "wx" }
  );

  JSON.parse(
    await fs.promises.readFile(
      path.join(buildPath, "migration-manifest.json"),
      "utf8"
    )
  );

  await fs.promises.rename(buildPath, targetPath);

  return {
    targetPath,
    fileCount: files.length + 1,
    manifestSha256: sha256(manifestContent),
    validation,
    liveDataChanged: false
  };
}

module.exports = {
  assertNewTarget,
  createCreatorIndex,
  createStagingDocuments,
  createVideoIndex,
  stageMigration,
  validateDocuments
};
