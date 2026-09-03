const assert = require("node:assert/strict");
const test = require("node:test");
const {
  publicationTimestamp,
  sortResearchTimeline
} = require("../presentation/researchTimeline");

test("sorts the Research Library newest publication first", () => {
  const videos = [
    { id: "older", publishedAt: "2025-04-25T17:05:00.000Z" },
    { id: "newest", publishedAt: "2026-08-31T12:00:00.000Z" },
    { id: "middle", publishedAt: "2026-08-24T12:00:00.000Z" }
  ];

  assert.deepEqual(
    sortResearchTimeline(videos).map(video => video.id),
    ["newest", "middle", "older"]
  );
  assert.deepEqual(videos.map(video => video.id), ["older", "newest", "middle"]);
});

test("places a newly analyzed old video by publication time, not analysis time", () => {
  const videos = [
    {
      id: "published-later",
      publishedAt: "2026-08-20T12:00:00.000Z",
      analyzedAt: "2026-08-20T12:30:00.000Z"
    },
    {
      id: "analyzed-now-but-old",
      publishedAt: "2025-04-25T17:05:00.000Z",
      analyzedAt: "2026-09-03T10:00:00.000Z"
    }
  ];

  assert.deepEqual(
    sortResearchTimeline(videos).map(video => video.id),
    ["published-later", "analyzed-now-but-old"]
  );
});

test("uses analysis time only when publication time is unavailable", () => {
  const videos = [
    { id: "fallback-old", analyzedAt: "2026-08-20T12:00:00.000Z" },
    { id: "fallback-new", analyzedAt: "2026-09-02T12:00:00.000Z" },
    { id: "undated" }
  ];

  assert.deepEqual(
    sortResearchTimeline(videos).map(video => video.id),
    ["fallback-new", "fallback-old", "undated"]
  );
  assert.equal(publicationTimestamp(videos[2]), null);
});

test("orders equal timestamps deterministically by video ID", () => {
  const publishedAt = "2026-09-01T12:00:00.000Z";
  const videos = [
    { id: "video-b", publishedAt },
    { id: "video-a", publishedAt }
  ];

  assert.deepEqual(
    sortResearchTimeline(videos).map(video => video.id),
    ["video-a", "video-b"]
  );
});
