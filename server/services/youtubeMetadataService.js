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
    this.channelCache = new Map();

    if (typeof this.fetchImpl !== "function") {
      throw new Error("fetch ist für YouTubeMetadataService nicht verfügbar.");
    }
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  async getChannel(identifier) {
    if (!this.apiKey) throw new YouTubeMetadataError("YouTube API ist nicht konfiguriert.", { code: "YOUTUBE_NOT_CONFIGURED" });
    const cached = this.channelCache.get(identifier);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const url = new URL("https://www.googleapis.com/youtube/v3/channels");
    url.searchParams.set("part", "snippet,statistics");
    if (/^UC[\w-]{22}$/u.test(identifier)) url.searchParams.set("id", identifier);
    else if (/^@[\p{L}\p{N}_.-]{3,60}$/u.test(identifier)) url.searchParams.set("forHandle", identifier);
    else throw new YouTubeMetadataError("Ungültige Kanal-ID oder Handle.", { code: "CHANNEL_INVALID" });
    const response = await this.fetchImpl(url, { headers: { "x-goog-api-key": this.apiKey }, signal: AbortSignal.timeout(this.timeoutMs) });
    if (!response.ok) throw new YouTubeMetadataError("Kanaldaten momentan nicht verfügbar.", { code: "YOUTUBE_REQUEST_FAILED", retryable: true });
    const data = await response.json(), channel = data.items?.[0];
    if (!channel) throw new YouTubeMetadataError("Kanal nicht gefunden.", { code: "CHANNEL_NOT_FOUND" });
    const value = { id: channel.id, name: channel.snippet.title, handle: channel.snippet.customUrl || null,
      url: `https://www.youtube.com/channel/${channel.id}`, avatar_url: channel.snippet.thumbnails?.default?.url || null,
      total_videos: Number.isFinite(Number(channel.statistics?.videoCount)) ? Number(channel.statistics.videoCount) : null,
      subscriber_count: channel.statistics?.hiddenSubscriberCount ? null : channel.statistics?.subscriberCount || null };
    this.channelCache.set(identifier, { value, expiresAt: Date.now() + 600000 }); return value;
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
    url.searchParams.set("part", "snippet,contentDetails");
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
      title: item.snippet.title || null,
      language: item.snippet.defaultAudioLanguage || item.snippet.defaultLanguage || null,
      durationSeconds: parseDuration(item.contentDetails?.duration)
    });
    this.cache.set(videoId, metadata);
    return metadata;
  }
}

function parseDuration(value) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/u.exec(value || "");
  return match ? Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0) : null;
}

module.exports = {
  YouTubeMetadataError,
  YouTubeMetadataService
};
