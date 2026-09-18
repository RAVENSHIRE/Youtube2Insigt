const assert = require("node:assert/strict");
const test = require("node:test");
const {
  filterResearchVideos,
  performanceValue,
  sortResearchVideos
} = require("../../extension/research-library");

const videos = [
  {
    id: "video-nvidia",
    title: "Opening Bell: Nvidia",
    summary: "Halbleiter und künstliche Intelligenz",
    publishedAt: "2026-08-31T12:00:00.000Z",
    analyzedAt: "2026-09-01T11:00:00.000Z",
    analysisSequence: 2,
    performance: { averageReturnPct: 7.65, scoredCalls: 1 },
    companies: [{
      company: "Nvidia",
      ticker: "NVDA",
      thesis: "Starke Nachfrage nach AI-Chips"
    }]
  },
  {
    id: "video-rocket-lab",
    title: "Space Economy",
    summary: "Raketen und Satelliten",
    publishedAt: "2025-04-25T17:05:00.000Z",
    analyzedAt: "2026-09-03T10:00:00.000Z",
    analysisSequence: 3,
    performance: { averageReturnPct: 178.82, scoredCalls: 1 },
    companies: [{
      company: "Rocket Lab",
      ticker: "RKLB",
      evidence: ["The stock is still up around 400 percent"]
    }]
  },
  {
    id: "video-bank",
    title: "Banken unter Druck",
    publishedAt: "2026-08-20T12:00:00.000Z",
    analyzedAt: "2026-08-20T12:30:00.000Z",
    analysisSequence: 1,
    performance: { averageReturnPct: -5.2, scoredCalls: 2 },
    companies: [{ company: "Example Bank", ticker: "BANK" }]
  },
  {
    id: "video-unscored",
    title: "Nur Erwähnungen",
    analyzedAt: "2026-09-04T10:00:00.000Z",
    analysisSequence: 4,
    performance: { averageReturnPct: null, scoredCalls: 0 },
    companies: [{ company: "Unscored Company", ticker: "NONE" }]
  }
];

test("searches title, ticker, thesis and evidence without case or accents", () => {
  assert.deepEqual(
    filterResearchVideos(videos, "nvda").map(video => video.id),
    ["video-nvidia"]
  );
  assert.deepEqual(
    filterResearchVideos(videos, "kunstliche intelligenz").map(video => video.id),
    ["video-nvidia"]
  );
  assert.deepEqual(
    filterResearchVideos(videos, "400 percent").map(video => video.id),
    ["video-rocket-lab"]
  );
});

test("sorts by newest or oldest analysis without changing report identity", () => {
  assert.deepEqual(
    sortResearchVideos(videos, "analyzed-desc").map(video => video.id),
    ["video-unscored", "video-rocket-lab", "video-nvidia", "video-bank"]
  );
  assert.deepEqual(
    sortResearchVideos(videos, "analyzed-asc").map(video => video.id),
    ["video-bank", "video-nvidia", "video-rocket-lab", "video-unscored"]
  );
  assert.deepEqual(videos.map(video => video.analysisSequence), [2, 3, 1, 4]);
});

test("sorts scored videos by average call performance and leaves unscored last", () => {
  assert.deepEqual(
    sortResearchVideos(videos, "performance-desc").map(video => video.id),
    ["video-rocket-lab", "video-nvidia", "video-bank", "video-unscored"]
  );
  assert.equal(performanceValue(videos[0]), 7.65);
  assert.equal(performanceValue(videos[3]), null);
});

test("does not mutate the source list", () => {
  sortResearchVideos(videos, "performance-desc");
  filterResearchVideos(videos, "NVDA");
  assert.deepEqual(videos.map(video => video.id), [
    "video-nvidia",
    "video-rocket-lab",
    "video-bank",
    "video-unscored"
  ]);
});
