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
  compareResearchTimeline,
  publicationTimestamp,
  sortResearchTimeline
};
