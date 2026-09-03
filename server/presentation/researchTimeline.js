function timestamp(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function publicationTimestamp(video = {}) {
  return timestamp(video.publishedAt) ?? timestamp(video.analyzedAt);
}

function analysisTimestamp(video = {}) {
  return timestamp(video.analyzedAt) ?? timestamp(video.publishedAt);
}

function compareAnalysisSequence(left = {}, right = {}) {
  const leftAnalyzed = analysisTimestamp(left);
  const rightAnalyzed = analysisTimestamp(right);

  if (leftAnalyzed !== rightAnalyzed) {
    if (leftAnalyzed === null) return 1;
    if (rightAnalyzed === null) return -1;
    return leftAnalyzed - rightAnalyzed;
  }

  return String(left.id || "").localeCompare(String(right.id || ""));
}

function assignResearchSequences(videos = []) {
  const sequenceById = new Map(
    [...videos]
      .sort(compareAnalysisSequence)
      .map((video, index) => [String(video.id || ""), index + 1])
  );

  return videos.map(video => ({
    ...video,
    reportId: `report_${String(video.id || "unknown")}`,
    analysisSequence: sequenceById.get(String(video.id || "")) || null
  }));
}

function compareResearchTimeline(left = {}, right = {}) {
  const leftPublished = publicationTimestamp(left);
  const rightPublished = publicationTimestamp(right);

  if (leftPublished !== rightPublished) {
    if (leftPublished === null) return 1;
    if (rightPublished === null) return -1;
    return rightPublished - leftPublished;
  }

  const leftAnalyzed = timestamp(left.analyzedAt);
  const rightAnalyzed = timestamp(right.analyzedAt);

  if (leftAnalyzed !== rightAnalyzed) {
    if (leftAnalyzed === null) return 1;
    if (rightAnalyzed === null) return -1;
    return rightAnalyzed - leftAnalyzed;
  }

  return String(left.id || "").localeCompare(String(right.id || ""));
}

function sortResearchTimeline(videos = []) {
  return [...videos].sort(compareResearchTimeline);
}

module.exports = {
  analysisTimestamp,
  assignResearchSequences,
  compareResearchTimeline,
  publicationTimestamp,
  sortResearchTimeline
};
