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
    "published-desc",
    "published-asc",
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

  function companyCallType(company = {}) {
    return normalizeText(company.call_type || company.callType);
  }

  function companySubSector(company = {}) {
    return String(company.sub_sector || company.subSector || "").trim();
  }

  function companyMatchesFacets(company = {}, filters = {}) {
    const sector = normalizeText(filters.sector);
    const sentiment = normalizeText(filters.sentiment);
    const callType = normalizeText(filters.callType);

    return (!sector || normalizeText(company.sector) === sector) &&
      (!sentiment || normalizeText(company.sentiment) === sentiment) &&
      (!callType || companyCallType(company) === callType);
  }

  function videoSearchText(video = {}) {
    const companies = Array.isArray(video.companies) ? video.companies : [];
    const companyText = companies.map(company => fieldText({
      company: company.company,
      ticker: company.ticker,
      assetType: company.asset_type,
      sector: company.sector,
      subSector: companySubSector(company),
      sentiment: company.sentiment,
      callType: company.call_type || company.callType,
      action: company.action,
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

  function filterResearchVideos(videos = [], filters = {}) {
    const query = normalizeText(filters.query);
    const hasCompanyFacet = Boolean(
      normalizeText(filters.sector) ||
      normalizeText(filters.sentiment) ||
      normalizeText(filters.callType)
    );

    return videos.filter(video => {
      const companies = Array.isArray(video.companies) ? video.companies : [];

      if (hasCompanyFacet && !companies.some(company =>
        companyMatchesFacets(company, filters)
      )) {
        return false;
      }

      return !query || videoSearchText(video).includes(query);
    });
  }

  function compareNullableTime(left, right, direction) {
    if (left === right) {
      return 0;
    }

    if (left === null) {
      return 1;
    }

    if (right === null) {
      return -1;
    }

    return direction === "asc" ? left - right : right - left;
  }

  function sortResearchVideos(videos = [], mode = "published-desc") {
    const selectedMode = SORT_MODES.has(mode) ? mode : "published-desc";
    const [field, direction] = selectedMode.split("-");

    return [...videos].sort((left, right) => {
      const leftTime = field === "analyzed"
        ? timestamp(left.analyzedAt) ?? timestamp(left.publishedAt)
        : timestamp(left.publishedAt) ?? timestamp(left.analyzedAt);
      const rightTime = field === "analyzed"
        ? timestamp(right.analyzedAt) ?? timestamp(right.publishedAt)
        : timestamp(right.publishedAt) ?? timestamp(right.analyzedAt);
      const timeOrder = compareNullableTime(leftTime, rightTime, direction);

      if (timeOrder !== 0) {
        return timeOrder;
      }

      const sequenceOrder = Number(left.analysisSequence || 0) -
        Number(right.analysisSequence || 0);

      if (sequenceOrder !== 0) {
        return sequenceOrder;
      }

      return String(left.id || "").localeCompare(String(right.id || ""));
    });
  }

  function uniqueSorted(values) {
    return [...new Set(values.filter(Boolean))].sort((left, right) =>
      left.localeCompare(right, "de", { sensitivity: "base" })
    );
  }

  function collectResearchFacets(videos = []) {
    const companies = videos.flatMap(video =>
      Array.isArray(video.companies) ? video.companies : []
    );

    return {
      sectors: uniqueSorted(companies.map(company =>
        String(company.sector || "").trim()
      )),
      sentiments: uniqueSorted(companies.map(company =>
        String(company.sentiment || "").trim().toLowerCase()
      )),
      callTypes: uniqueSorted(companies.map(company =>
        companyCallType(company)
      ))
    };
  }

  return {
    collectResearchFacets,
    filterResearchVideos,
    normalizeText,
    sortResearchVideos,
    videoSearchText
  };
});
