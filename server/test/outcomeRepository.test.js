const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  OUTCOME_CACHE_SCHEMA_VERSION,
  OutcomeRepository,
  cacheId
} = require("../outcomes/outcomeRepository");

function createTempRoot(t) {
  const tempBase = path.join(__dirname, ".tmp");
  fs.mkdirSync(tempBase, { recursive: true });
  const root = fs.mkdtempSync(path.join(tempBase, "outcome-cache-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("persists an outcome across repository instances", async t => {
  const root = createTempRoot(t);
  const first = new OutcomeRepository(root);
  const outcome = {
    status: "complete",
    video_id: "video-1",
    call_id: "call-1",
    current_return_pct: 27.7
  };

  await first.set({
    videoId: "video-1",
    callId: "call-1",
    outcome,
    savedAt: "2026-09-02T12:00:00.000Z",
    expiresAt: "2026-09-02T12:05:00.000Z"
  });

  const second = new OutcomeRepository(root);
  const stored = await second.get("video-1", "call-1");
  assert.equal(stored.schema_version, OUTCOME_CACHE_SCHEMA_VERSION);
  assert.equal(stored.cache_id, cacheId("video-1", "call-1"));
  assert.equal(stored.outcome.current_return_pct, 27.7);
  assert.equal(stored.expires_at, "2026-09-02T12:05:00.000Z");
});

test("returns null for an outcome that was never cached", async t => {
  const repository = new OutcomeRepository(createTempRoot(t));
  assert.equal(await repository.get("video-1", "call-1"), null);
});

test("requires a safe absolute outcome storage root", () => {
  assert.throws(() => new OutcomeRepository("relative/path"), /absoluten Storage-Pfad/u);
  assert.throws(() => new OutcomeRepository(path.parse(process.cwd()).root), /Stammverzeichnis/u);
});
