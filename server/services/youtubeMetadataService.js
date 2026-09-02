const YOUTUBE_VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";
const DEFAULT_TIMEOUT_MS = 12_000;

class YouTubeMetadataError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "YouTubeMetadataError";
    this.code = options.code || "YOUTUBE_METADATA_ERROR";
    this.status = options.status || null;
    this.retryable = Boolean(options.retryable);
  }
}

class YouTubeMetadataService {
  constructor(options = {}) {
    this.apiKey = typeof (options.apiKey || process.env.YOUTUBE_API_KEY) === "string"
      ? (options.apiKey || process.env.YOUTUBE_API_KEY).trim()
      : null;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
    this.cache = new Map();

    if (typeof this.fetchImpl !== "function") {
      throw new Error("fetch ist für YouTubeMetadataService nicht verfügbar.");
    }
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  async getVideo(videoId) {
    if (!/^[A-Za-z0-9_-]{11}$/u.test(String(videoId || ""))) {
      throw new YouTubeMetadataError("Ungültige YouTube-videoId.", {
        code: "INVALID_VIDEO_ID"
      });
    }

    if (this.cache.has(videoId)) {
      return this.cache.get(videoId);
    }

    if (!this.apiKey) {
      throw new YouTubeMetadataError("YOUTUBE_API_KEY fehlt.", {
        code: "YOUTUBE_NOT_CONFIGURED"
      });
    }

    const url = new URL(YOUTUBE_VIDEOS_URL);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("id", videoId);

    let response;
    let data;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      response = await this.fetchImpl(url, {
        headers: {
          "x-goog-api-key": this.apiKey
        },
        signal: controller.signal
      });
      data = await response.json().catch(() => ({}));
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new YouTubeMetadataError("YouTube API request timeout.", {
          code: "YOUTUBE_TIMEOUT",
          retryable: true
        });
      }

      throw new YouTubeMetadataError(error?.message || "YouTube API nicht erreichbar.", {
        code: "YOUTUBE_NETWORK_ERROR",
        retryable: true
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new YouTubeMetadataError(
        data?.error?.message || `YouTube API returned HTTP ${response.status}.`,
        {
          code: "YOUTUBE_REQUEST_FAILED",
          status: response.status,
          retryable: response.status === 429 || response.status >= 500
        }
      );
    }

    const item = Array.isArray(data.items) ? data.items[0] : null;
    const publishedAt = item?.snippet?.publishedAt;

    if (!item || !publishedAt) {
      throw new YouTubeMetadataError("YouTube-Video oder publishedAt nicht gefunden.", {
        code: "YOUTUBE_VIDEO_NOT_FOUND"
      });
    }

    const metadata = Object.freeze({
      videoId,
      publishedAt,
      publishedAtSource: "youtube_api",
      channelId: item.snippet.channelId || null,
      channelTitle: item.snippet.channelTitle || null,
      title: item.snippet.title || null
    });
    this.cache.set(videoId, metadata);
    return metadata;
  }
}

module.exports = {
  YouTubeMetadataError,
  YouTubeMetadataService
};
