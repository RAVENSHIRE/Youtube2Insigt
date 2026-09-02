const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { buildMigrationPlan } = require("../storage/creatorMigration");
const { CreatorRepository } = require("../storage/creatorRepository");
const { stageMigration } = require("../storage/creatorStaging");

function report(id, creator, handle) {
  return {
    video: {
      id,
      creator,
      analyzed_at: "2026-09-01T10:00:00.000Z",
      channel: {
        name: creator,
        url: `https://www.youtube.com/${handle}`
      }
    },
    summary: `Report ${id}`,
    companies: []
  };
}

async function createRepository(t) {
  const tempBase = path.join(__dirname, ".tmp");
  fs.mkdirSync(tempBase, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(tempBase, "creator-repository-"));
  const stagingPath = path.join(tempRoot, "staging-v2");
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const source = {
    video000001: report("video000001", "Creator One", "@creator-one"),
    video000002: report("video000002", "Creator Two", "@creator-two")
  };
  await stageMigration(buildMigrationPlan(source), {
    targetPath: stagingPath,
    source: { path: "test/videos.json" }
  });

  return new CreatorRepository(stagingPath);
}

test("resolves creator identities and loads only that creator's videos", async t => {
  const repository = await createRepository(t);
  const creator = repository.resolveCreator({ channelHandle: "@creator-one" });
  const videos = repository.getCreatorVideos(creator.creator_id);

  assert.equal(creator.display_name, "Creator One");
  assert.deepEqual(Object.keys(videos), ["video000001"]);
  assert.equal(repository.findVideo("video000002").creatorId === creator.creator_id, false);
});

test("updates metadata in the owning creator file without touching another creator", async t => {
  const repository = await createRepository(t);
  const secondBefore = JSON.stringify(repository.findVideo("video000002").research);
  const updated = repository.updateVideo("video000001", research => ({
    ...research,
    video: {
      ...research.video,
      channel: {
        ...research.video.channel,
        total_videos: 120
      }
    }
  }));

  assert.equal(updated.research.video.channel.total_videos, 120);
  assert.equal(JSON.stringify(repository.findVideo("video000002").research), secondBefore);
  assert.equal(
    repository.getCreator(updated.creatorId).total_videos,
    120
  );
});

test("refuses a directory that is not a schema-v2 creator staging", () => {
  const tempBase = path.join(__dirname, ".tmp");
  fs.mkdirSync(tempBase, { recursive: true });
  const invalidRoot = fs.mkdtempSync(path.join(tempBase, "creator-invalid-"));

  try {
    assert.throws(
      () => new CreatorRepository(invalidRoot),
      /kein gültiges Creator-Staging/u
    );
  } finally {
    fs.rmSync(invalidRoot, { recursive: true, force: true });
  }
});
