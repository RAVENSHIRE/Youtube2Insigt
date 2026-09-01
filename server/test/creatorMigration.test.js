const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  buildMigrationPlan,
  createCreatorId,
  createDryRunReport,
  parseYouTubeChannelUrl
} = require("../storage/creatorMigration");
const { parseArguments } = require("../scripts/migrate-creators");
const { stageMigration } = require("../storage/creatorStaging");

function report({
  id,
  creator = null,
  channel = null,
  companies = []
}) {
  return {
    video: {
      id,
      creator,
      analyzed_at: "2026-09-01T10:00:00.000Z",
      channel
    },
    summary: `Report ${id}`,
    companies
  };
}

test("normalizes YouTube channel URLs without tab suffixes", () => {
  assert.deepEqual(
    parseYouTubeChannelUrl("https://m.youtube.com/@BusinessWithBrian/videos?view=0"),
    {
      canonicalUrl: "https://www.youtube.com/@BusinessWithBrian",
      channelId: null,
      handle: "@BusinessWithBrian"
    }
  );
});

test("groups reports by a stable handle and preserves report content", () => {
  const source = {
    video000001: report({
      id: "video000001",
      creator: "DER AKTIONÄR TV",
      channel: {
        name: "DER AKTIONÄR TV",
        url: "https://www.youtube.com/@der.aktionaer",
        total_videos: 32338
      },
      companies: [{ company: "Nvidia", sentiment: "bull" }]
    }),
    video000002: report({
      id: "video000002",
      creator: "Der Aktionär TV",
      channel: {
        name: "Der Aktionär TV",
        url: "https://www.youtube.com/@der.aktionaer/videos"
      }
    })
  };
  const plan = buildMigrationPlan(source);
  const [creator] = [...plan.creators.values()];

  assert.equal(plan.creators.size, 1);
  assert.equal(creator.profile.handle, "@der.aktionaer");
  assert.equal(creator.profile.analyzed_videos, 2);
  assert.deepEqual(creator.videos.video000001, source.video000001);
  assert.equal(plan.validation.contentPreserved, true);
  assert.equal(plan.validation.canActivate, true);
});

test("keeps distinct handles separate even when display names match", () => {
  const source = {
    video000001: report({
      id: "video000001",
      creator: "Market Watch",
      channel: {
        name: "Market Watch",
        url: "https://www.youtube.com/@market-one"
      }
    }),
    video000002: report({
      id: "video000002",
      creator: "Market Watch",
      channel: {
        name: "Market Watch",
        url: "https://www.youtube.com/@market-two"
      }
    })
  };
  const plan = buildMigrationPlan(source);

  assert.equal(plan.creators.size, 2);
  assert.equal(plan.validation.migratedVideoCount, 2);
});

test("merges handle-only history with a later channel-ID identity", () => {
  const source = {
    video000001: report({
      id: "video000001",
      creator: "Example Creator",
      channel: {
        name: "Example Creator",
        url: "https://www.youtube.com/@example"
      }
    }),
    video000002: report({
      id: "video000002",
      creator: "Example Creator",
      channel: {
        name: "Example Creator",
        channel_id: "UC1234567890123456789012",
        url: "https://www.youtube.com/@example"
      }
    })
  };
  const plan = buildMigrationPlan(source);
  const [creator] = [...plan.creators.values()];

  assert.equal(plan.creators.size, 1);
  assert.equal(creator.profile.youtube_channel_id, "UC1234567890123456789012");
  assert.equal(creator.profile.handle, "@example");
  assert.equal(creator.profile.analyzed_videos, 2);
});

test("routes missing creator metadata to an explicit unresolved creator", () => {
  const source = {
    video000001: report({ id: "video000001" })
  };
  const plan = buildMigrationPlan(source);
  const dryRun = createDryRunReport(plan);

  assert.equal(plan.creators.size, 1);
  assert.equal(dryRun.creators[0].creatorId, "creator_unresolved");
  assert.equal(dryRun.creators[0].unresolved, true);
  assert.equal(plan.validation.unresolvedVideoCount, 1);
  assert.equal(plan.validation.canActivate, true);
  assert.equal(plan.warnings[0].code, "UNRESOLVED_CREATOR");
});

test("applies a reviewed creator override without changing report content", () => {
  const source = {
    VuofyRxOHV4: report({ id: "VuofyRxOHV4" })
  };
  const plan = buildMigrationPlan(source, {
    overrides: {
      assignments: {
        VuofyRxOHV4: {
          display_name: "DER AKTIONÄR TV",
          handle: "@der.aktionaer",
          channel_url: "https://www.youtube.com/@der.aktionaer",
          reason: "Reviewed assignment"
        }
      }
    }
  });
  const [creator] = [...plan.creators.values()];

  assert.equal(plan.validation.overridesApplied, 1);
  assert.equal(plan.validation.unresolvedVideoCount, 0);
  assert.equal(creator.profile.handle, "@der.aktionaer");
  assert.deepEqual(creator.videos.VuofyRxOHV4, source.VuofyRxOHV4);
  assert.equal(plan.warnings[0].code, "CREATOR_OVERRIDE_APPLIED");
});

test("uses deterministic filesystem-safe creator IDs", () => {
  assert.equal(
    createCreatorId("handle:@der.aktionaer"),
    createCreatorId("handle:@der.aktionaer")
  );
  assert.match(createCreatorId("handle:@der.aktionaer"), /^creator_[a-f0-9]{16}$/u);
});

test("dry-run reports never claim to write files", () => {
  const plan = buildMigrationPlan({
    video000001: report({
      id: "video000001",
      creator: "Business With Brian",
      channel: {
        name: "Business With Brian",
        url: "https://www.youtube.com/@BusinessWithBrian"
      }
    })
  });
  const dryRun = createDryRunReport(plan, {
    path: "server/data/videos.json",
    bytes: 100,
    sha256: "abc"
  });

  assert.equal(dryRun.mode, "dry-run");
  assert.equal(dryRun.writesPerformed, false);
  assert.equal(dryRun.validation.canActivate, true);
});

test("rejects the apply flag during the dry-run-only phase", () => {
  assert.throws(
    () => parseArguments(["--apply"]),
    /absichtlich deaktiviert/u
  );
});

test("writes and verifies a new isolated staging directory", async t => {
  const temporaryRoot = fs.mkdtempSync(
    path.join(__dirname, "creator-stage-test-")
  );
  const targetPath = path.join(temporaryRoot, "stage");

  t.after(() => {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  });

  const plan = buildMigrationPlan({
    video000001: report({
      id: "video000001",
      creator: "IPO Market Watch",
      channel: {
        name: "IPO Market Watch",
        url: "https://www.youtube.com/@IPOMarketWatch"
      }
    })
  });
  const result = await stageMigration(plan, {
    targetPath,
    source: { path: "fixture.json", sha256: "abc", bytes: 100 }
  });

  assert.equal(result.liveDataChanged, false);
  assert.equal(result.validation.creatorCount, 1);
  assert.equal(result.validation.videoCount, 1);
  assert.equal(result.validation.checksumsVerified, true);
  assert.equal(fs.existsSync(path.join(targetPath, "migration-manifest.json")), true);
  await assert.rejects(
    stageMigration(plan, { targetPath, source: null }),
    /existiert bereits/u
  );
});
