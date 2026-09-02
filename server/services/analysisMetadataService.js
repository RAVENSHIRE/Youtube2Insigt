class CreatorIdentityResolutionError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "CreatorIdentityResolutionError";
    this.code = options.code || "CREATOR_IDENTITY_UNAVAILABLE";
    this.status = options.status || 502;
    this.retryable = options.retryable !== false;
  }
}

function cleanString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function hasStrongCreatorIdentity(metadata = {}) {
  return Boolean(
    cleanString(metadata.channelId) ||
    cleanString(metadata.channelHandle) ||
    cleanString(metadata.channelUrl)
  );
}

function hasAnyCreatorIdentity(metadata = {}) {
  return hasStrongCreatorIdentity(metadata) || Boolean(cleanString(metadata.creator));
}

async function resolveAnalysisMetadata(metadata = {}, youtubeMetadataService) {
  const normalized = {
    ...metadata,
    channelHandle: cleanString(metadata.channelHandle),
    channelId: cleanString(metadata.channelId),
    channelUrl: cleanString(metadata.channelUrl),
    creator: cleanString(metadata.creator),
    publishedAt: cleanString(metadata.publishedAt),
    title: cleanString(metadata.title)
  };

  if (hasStrongCreatorIdentity(normalized)) {
    return normalized;
  }

  if (!youtubeMetadataService || typeof youtubeMetadataService.getVideo !== "function") {
    if (hasAnyCreatorIdentity(normalized)) {
      return normalized;
    }

    throw new CreatorIdentityResolutionError(
      "Creator-Identität fehlt und YouTube-Metadatenservice ist nicht verfügbar.",
      { code: "CREATOR_METADATA_SERVICE_UNAVAILABLE", status: 503 }
    );
  }

  let authoritative;
  try {
    authoritative = await youtubeMetadataService.getVideo(metadata.videoId);
  } catch (error) {
    if (hasAnyCreatorIdentity(normalized)) {
      return normalized;
    }

    throw new CreatorIdentityResolutionError(
      "Creator-Identität konnte nicht über die YouTube Data API aufgelöst werden.",
      {
        cause: error,
        code: error?.code || "CREATOR_IDENTITY_UNAVAILABLE",
        retryable: error?.retryable !== false,
        status: error?.code === "YOUTUBE_NOT_CONFIGURED" ? 503 : 502
      }
    );
  }

  const channelId = cleanString(authoritative?.channelId);
  const creator = normalized.creator || cleanString(authoritative?.channelTitle);

  if (!channelId && !creator) {
    throw new CreatorIdentityResolutionError(
      "YouTube Data API lieferte keine verwertbare Creator-Identität.",
      { code: "YOUTUBE_CREATOR_IDENTITY_MISSING", retryable: false }
    );
  }

  return {
    ...normalized,
    channelId,
    channelUrl: channelId
      ? `https://www.youtube.com/channel/${channelId}`
      : normalized.channelUrl,
    creator,
    publishedAt: normalized.publishedAt || cleanString(authoritative?.publishedAt),
    title: normalized.title || cleanString(authoritative?.title)
  };
}

module.exports = {
  CreatorIdentityResolutionError,
  hasAnyCreatorIdentity,
  hasStrongCreatorIdentity,
  resolveAnalysisMetadata
};
