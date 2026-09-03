const assert = require("node:assert/strict");
const test = require("node:test");
const {
  collectResearchFacets,
  filterResearchVideos,
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
    companies: [{
      company: "Nvidia",
      ticker: "NVDA",
      sector: "Technology",
      sub_sector: "Semiconductors",
      sentiment: "bull",
      call_type: "actionable",
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
    companies: [{
      company: "Rocket Lab",
      ticker: "RKLB",
      sector: "Industrials",
      sub_sector: "Aerospace & Defense",
      sentiment: "bull",
      call_type: "view",
      evidence: ["The stock is still up around 400 percent"]
    }]
  },
  {
    id: "video-bank",
    title: "Banken unter Druck",
    publishedAt: "2026-08-20T12:00:00.000Z",
    analyzedAt: "2026-08-20T12:30:00.000Z",
    analysisSequence: 1,
    companies: [{
      company: "Example Bank",
      ticker: "BANK",
      sector: "Financials",
      sentiment: "bear",
      call_type: "mention"
    }]
  }
];

test("searches title, ticker, thesis and evidence without case or accents", () => {
  assert.deepEqual(
    filterResearchVideos(videos, { query: "nvda" }).map(video => video.id),
    ["video-nvidia"]
  );
  assert.deepEqual(
    filterResearchVideos(videos, { query: "kunstliche intelligenz" }).map(video => video.id),
    ["video-nvidia"]
  );
  assert.deepEqual(
    filterResearchVideos(videos, { query: "400 percent" }).map(video => video.id),
    ["video-rocket-lab"]
  );
});

test("requires one company to satisfy all selected facets", () => {
  const mixedVideo = {
    id: "mixed",
    companies: [
      { sector: "Technology", sentiment: "bear", call_type: "mention" },
      { sector: "Financials", sentiment: "bull", call_type: "actionable" }
    ]
  };

  assert.deepEqual(
    filterResearchVideos([mixedVideo], {
      sector: "Technology",
      sentiment: "bull"
    }),
    []
  );
  assert.equal(filterResearchVideos([mixedVideo], {
    sector: "Financials",
    sentiment: "bull",
    callType: "actionable"
  }).length, 1);
});

test("sorts by publication or analysis time without mutating input", () => {
  assert.deepEqual(
    sortResearchVideos(videos, "published-desc").map(video => video.id),
    ["video-nvidia", "video-bank", "video-rocket-lab"]
  );
  assert.deepEqual(
    sortResearchVideos(videos, "analyzed-desc").map(video => video.id),
    ["video-rocket-lab", "video-nvidia", "video-bank"]
  );
  assert.deepEqual(videos.map(video => video.id), [
    "video-nvidia",
    "video-rocket-lab",
    "video-bank"
  ]);
});

test("falls back to the available timestamp in every sort mode", () => {
  const partialDates = [
    { id: "published-only", publishedAt: "2026-08-20T12:00:00.000Z" },
    { id: "analyzed-only", analyzedAt: "2026-09-02T12:00:00.000Z" },
    { id: "undated" }
  ];

  assert.deepEqual(
    sortResearchVideos(partialDates, "published-desc").map(video => video.id),
    ["analyzed-only", "published-only", "undated"]
  );
  assert.deepEqual(
    sortResearchVideos(partialDates, "analyzed-asc").map(video => video.id),
    ["published-only", "analyzed-only", "undated"]
  );
});

test("collects unique sorted filter values", () => {
  assert.deepEqual(collectResearchFacets(videos), {
    sectors: ["Financials", "Industrials", "Technology"],
    sentiments: ["bear", "bull"],
    callTypes: ["actionable", "mention", "view"]
  });
});
