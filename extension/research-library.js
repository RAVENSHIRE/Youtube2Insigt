(function exposeResearchLibrary(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.ResearchLibrary = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const SORT_MODES = new Set([
    "performance-desc",
    "analyzed-desc",
    "analyzed-asc"
  ]);

  function timestamp(value) {
    if (typeof value !== "string" || !value.trim()) {
      return null;
    }

    const milliseconds = Date.parse(value);
    return Number.isFinite(milliseconds) ? milliseconds : null;
  }

  function normalizeText(value) {
    return String(value ?? "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/gu, "")
      .toLocaleLowerCase("de")
      .trim();
  }

  function fieldText(value) {
    if (Array.isArray(value)) {
      return value.map(fieldText).join(" ");
    }

    if (value && typeof value === "object") {
      return Object.values(value).map(fieldText).join(" ");
    }

    return typeof value === "string" || typeof value === "number"
      ? String(value)
      : "";
  }

  function videoSearchText(video = {}) {
    const companies = Array.isArray(video.companies) ? video.companies : [];
    const companyText = companies.map(company => fieldText({
      company: company.company,
      ticker: company.ticker,
      thesis: company.thesis,
      evidence: company.evidence,
      priceTargets: company.price_targets,
      levels: company.levels
    })).join(" ");

    return normalizeText([
      video.id,
      video.title,
      video.creator,
      video.summary,
      companyText
    ].filter(Boolean).join(" "));
  }

  function filterResearchVideos(videos = [], query = "") {
    const normalizedQuery = normalizeText(query);
    return normalizedQuery
      ? videos.filter(video => videoSearchText(video).includes(normalizedQuery))
      : [...videos];
  }

  function analysisTimestamp(video = {}) {
    return timestamp(video.analyzedAt) ?? timestamp(video.publishedAt);
  }

  function performanceValue(video = {}) {
    const rawValue = video.performance?.averageReturnPct;
    if (rawValue === null || rawValue === undefined || rawValue === "") {
      return null;
    }

    const value = Number(rawValue);
    return Number.isFinite(value) ? value : null;
  }

  function compareNullable(left, right, direction) {
    if (left === right) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return direction === "asc" ? left - right : right - left;
  }

  function compareStableIdentity(left, right) {
    const sequenceOrder = Number(left.analysisSequence || 0) -
      Number(right.analysisSequence || 0);
    return sequenceOrder || String(left.id || "").localeCompare(String(right.id || ""));
  }

  function sortResearchVideos(videos = [], mode = "analyzed-desc") {
    const selectedMode = SORT_MODES.has(mode) ? mode : "analyzed-desc";

    return [...videos].sort((left, right) => {
      if (selectedMode === "performance-desc") {
        const performanceOrder = compareNullable(
          performanceValue(left),
          performanceValue(right),
          "desc"
        );
        if (performanceOrder !== 0) return performanceOrder;
      }

      const direction = selectedMode === "analyzed-asc" ? "asc" : "desc";
      const timeOrder = compareNullable(
        analysisTimestamp(left),
        analysisTimestamp(right),
        direction
      );
      return timeOrder || compareStableIdentity(left, right);
    });
  }

  return {
    filterResearchVideos,
    normalizeText,
    performanceValue,
    sortResearchVideos,
    videoSearchText
  };
});
