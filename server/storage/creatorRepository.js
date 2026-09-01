const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  STORAGE_SCHEMA_VERSION,
  createCreatorId,
  normalizeChannelId,
  normalizeHandle,
  normalizeIdentityText,
  parseYouTubeChannelUrl
} = require("./creatorMigration");

function cleanString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeCount(value) {
  if (
    value === null ||
    value === undefined ||
    typeof value === "boolean" ||
    (typeof value === "string" && !value.trim())
  ) {
    return null;
  }

  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

function normalizeCreatorIdentity(metadata = {}) {
  const parsedUrl = parseYouTubeChannelUrl(
    metadata.channelUrl || metadata.channel_url || metadata.url
  );
  const channelId = normalizeChannelId(
    metadata.youtubeChannelId ||
    metadata.youtube_channel_id ||
    metadata.channelId ||
    metadata.channel_id ||
    parsedUrl.channelId
  );
  const handle = normalizeHandle(
    metadata.channelHandle ||
    metadata.channel_handle ||
    metadata.handle ||
    parsedUrl.handle
  );
  const displayName = cleanString(
    metadata.creator || metadata.displayName || metadata.display_name || metadata.name
  );
  const canonicalUrl = parsedUrl.canonicalUrl ||
    (handle ? `https://www.youtube.com/${handle}` : null) ||
    (channelId ? `https://www.youtube.com/channel/${channelId}` : null);

  return {
    channelId,
    handle,
    displayName,
    normalizedName: normalizeIdentityText(displayName),
    canonicalUrl
  };
}

function identityKeys(identity) {
  return [
    identity.channelId ? `channel-id:${identity.channelId.toLowerCase()}` : null,
    identity.handle ? `handle:${identity.handle.toLowerCase()}` : null,
    identity.canonicalUrl ? `url:${identity.canonicalUrl.toLowerCase()}` : null,
    identity.normalizedName ? `name:${identity.normalizedName}` : null
  ].filter(Boolean);
}

function profileIdentityKeys(profile) {
  const aliases = profile.aliases || {};
  const values = [
    profile.youtube_channel_id,
    ...(Array.isArray(aliases.channel_ids) ? aliases.channel_ids : [])
  ].map(normalizeChannelId).filter(Boolean).map(value => `channel-id:${value.toLowerCase()}`);

  values.push(
    ...[
      profile.handle,
      ...(Array.isArray(aliases.handles) ? aliases.handles : [])
    ].map(normalizeHandle).filter(Boolean).map(value => `handle:${value.toLowerCase()}`)
  );

  values.push(
    ...[
      profile.channel_url,
      ...(Array.isArray(aliases.urls) ? aliases.urls : [])
    ].map(value => parseYouTubeChannelUrl(value).canonicalUrl)
      .filter(Boolean)
      .map(value => `url:${value.toLowerCase()}`)
  );

  values.push(
    ...[
      profile.display_name,
      ...(Array.isArray(aliases.names) ? aliases.names : [])
    ].map(normalizeIdentityText).filter(Boolean).map(value => `name:${value}`)
  );

  return new Set(values);
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeJsonAtomic(filePath, value) {
  const suffix = crypto.randomBytes(6).toString("hex");
  const tempPath = `${filePath}.tmp-${process.pid}-${suffix}`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tempPath, serializeJson(value), "utf8");
  fs.renameSync(tempPath, filePath);
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/u, "").trim();
  return raw ? JSON.parse(raw) : {};
}

function safeTimestamp(value) {
  return cleanString(value) || null;
}

class CreatorRepository {
  constructor(rootPath) {
    if (!rootPath) {
      throw new Error("CREATOR_DATA_ROOT fehlt.");
    }

    this.rootPath = path.resolve(rootPath);
    this.creatorsPath = path.join(this.rootPath, "creators");
    this.indexPath = path.join(this.creatorsPath, "index.json");
    this.videoIndexPath = path.join(this.creatorsPath, "video-index.json");
    this.videoCache = new Map();
    this.loadIndexes();
  }

  loadIndexes() {
    if (!fs.existsSync(this.indexPath) || !fs.existsSync(this.videoIndexPath)) {
      throw new Error(
        "CREATOR_DATA_ROOT ist kein gültiges Creator-Staging: creators/index.json oder video-index.json fehlt."
      );
    }

    const index = readJson(this.indexPath);
    const videoIndex = readJson(this.videoIndexPath);

    if (
      Number(index.schema_version) !== STORAGE_SCHEMA_VERSION ||
      Number(videoIndex.schema_version) !== STORAGE_SCHEMA_VERSION ||
      !Array.isArray(index.creators) ||
      !videoIndex.videos ||
      typeof videoIndex.videos !== "object" ||
      Array.isArray(videoIndex.videos)
    ) {
      throw new Error("Creator-Staging verwendet nicht das erwartete Schema v2.");
    }

    this.index = index;
    this.videoIndex = videoIndex;
    this.identityIndex = new Map();

    for (const profile of this.index.creators) {
      for (const key of profileIdentityKeys(profile)) {
        if (!this.identityIndex.has(key)) {
          this.identityIndex.set(key, new Set());
        }
        this.identityIndex.get(key).add(profile.creator_id);
      }
    }
  }

  listCreators() {
    return this.index.creators
      .map(profile => ({ ...profile, aliases: { ...(profile.aliases || {}) } }))
      .sort((left, right) =>
        Number(Boolean(left.unresolved)) - Number(Boolean(right.unresolved)) ||
        (Number(right.analyzed_videos) || 0) - (Number(left.analyzed_videos) || 0) ||
        String(left.display_name).localeCompare(String(right.display_name))
      );
  }

  getCreator(creatorId) {
    const profile = this.index.creators.find(
      creator => creator.creator_id === creatorId
    );
    return profile ? { ...profile, aliases: { ...(profile.aliases || {}) } } : null;
  }

  resolveCreator(metadata) {
    const identity = normalizeCreatorIdentity(metadata);
    const keys = identityKeys(identity);
    const strongMatchedIds = new Set();

    for (const key of keys.filter(value => !value.startsWith("name:"))) {
      const candidates = this.identityIndex.get(key);
      if (candidates?.size === 1) {
        strongMatchedIds.add([...candidates][0]);
      }
    }

    if (strongMatchedIds.size === 1) {
      return this.getCreator([...strongMatchedIds][0]);
    }

    if (strongMatchedIds.size > 1) {
      return null;
    }

    const nameKey = keys.find(value => value.startsWith("name:"));
    const nameMatches = nameKey ? this.identityIndex.get(nameKey) : null;
    return nameMatches?.size === 1
      ? this.getCreator([...nameMatches][0])
      : null;
  }

  creatorVideosPath(creatorId) {
    return path.join(this.creatorsPath, creatorId, "videos.json");
  }

  loadCreatorVideos(creatorId) {
    if (this.videoCache.has(creatorId)) {
      return this.videoCache.get(creatorId);
    }

    const filePath = this.creatorVideosPath(creatorId);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const videos = readJson(filePath);
    if (!videos || typeof videos !== "object" || Array.isArray(videos)) {
      throw new Error(`Ungültige Creator-Videodatei: ${creatorId}`);
    }

    this.videoCache.set(creatorId, videos);
    return videos;
  }

  getCreatorVideos(creatorId) {
    return this.loadCreatorVideos(creatorId);
  }

  findVideo(videoId) {
    const creatorId = this.videoIndex.videos[videoId];
    if (!creatorId) {
      return null;
    }

    const videos = this.loadCreatorVideos(creatorId);
    const research = videos?.[videoId];
    return research ? { creatorId, research } : null;
  }

  hasVideo(videoId) {
    return Boolean(this.videoIndex.videos[videoId]);
  }

  saveVideo(metadata, videoId, research) {
    if (this.hasVideo(videoId)) {
      return this.findVideo(videoId);
    }

    const identity = normalizeCreatorIdentity(metadata);
    let profile = this.resolveCreator(metadata);

    if (!profile) {
      const identityKey = identityKeys(identity).find(key => !key.startsWith("name:")) ||
        (identity.normalizedName ? `name:${identity.normalizedName}` : null);

      if (!identityKey) {
        throw new Error("Neue Analyse kann keinem Creator zugeordnet werden.");
      }

      const creatorId = createCreatorId(identityKey);
      const analyzedAt = safeTimestamp(research?.video?.analyzed_at);
      profile = {
        schema_version: STORAGE_SCHEMA_VERSION,
        creator_id: creatorId,
        identity_key: identityKey,
        youtube_channel_id: identity.channelId,
        handle: identity.handle,
        display_name: identity.displayName || "Unbekannter Creator",
        channel_url: identity.canonicalUrl,
        avatar_url: cleanString(metadata.channelAvatarUrl),
        subscriber_count: cleanString(metadata.subscriberCount),
        total_videos: normalizeCount(metadata.channelTotalVideos ?? metadata.totalVideos),
        analyzed_videos: 0,
        first_analysis_at: analyzedAt,
        latest_analysis_at: analyzedAt,
        aliases: {
          names: identity.displayName ? [identity.displayName] : [],
          urls: identity.canonicalUrl ? [identity.canonicalUrl] : [],
          handles: identity.handle ? [identity.handle] : [],
          channel_ids: identity.channelId ? [identity.channelId] : []
        },
        unresolved: false
      };
      this.index.creators.push(profile);
      this.videoCache.set(creatorId, {});
    }

    const videos = this.loadCreatorVideos(profile.creator_id) || {};
    videos[videoId] = research;
    this.videoIndex.videos[videoId] = profile.creator_id;
    this.updateProfileFromMetadata(profile, metadata, research);
    writeJsonAtomic(this.creatorVideosPath(profile.creator_id), videos);
    this.persistIndexes(profile);

    return { creatorId: profile.creator_id, research };
  }

  updateVideo(videoId, update) {
    const found = this.findVideo(videoId);
    if (!found) {
      return null;
    }

    const nextResearch = update(found.research);
    if (!nextResearch || typeof nextResearch !== "object") {
      throw new Error("Video-Update lieferte kein gültiges Objekt.");
    }

    const videos = this.loadCreatorVideos(found.creatorId);
    videos[videoId] = nextResearch;
    writeJsonAtomic(this.creatorVideosPath(found.creatorId), videos);

    const profile = this.index.creators.find(
      creator => creator.creator_id === found.creatorId
    );
    if (profile) {
      this.updateProfileFromMetadata(profile, nextResearch.video?.channel || {}, nextResearch);
      this.persistIndexes(profile);
    }

    return { creatorId: found.creatorId, research: nextResearch };
  }

  updateProfileFromMetadata(profile, metadata, research) {
    const channel = research?.video?.channel || {};
    const identity = normalizeCreatorIdentity({
      ...metadata,
      creator: metadata.creator || channel.name || research?.video?.creator,
      channelUrl: metadata.channelUrl || channel.url,
      channelId: metadata.channelId || channel.youtube_channel_id,
      channelHandle: metadata.channelHandle || channel.handle
    });
    const analyzedAt = safeTimestamp(research?.video?.analyzed_at);

    profile.youtube_channel_id = identity.channelId || profile.youtube_channel_id || null;
    profile.handle = identity.handle || profile.handle || null;
    profile.display_name = identity.displayName || profile.display_name;
    profile.channel_url = identity.canonicalUrl || profile.channel_url || null;
    profile.avatar_url = cleanString(metadata.channelAvatarUrl || metadata.avatar_url || channel.avatar_url) || profile.avatar_url || null;
    profile.subscriber_count = cleanString(metadata.subscriberCount || metadata.subscriber_count || channel.subscriber_count) || profile.subscriber_count || null;
    profile.total_videos = normalizeCount(
      metadata.channelTotalVideos ??
      metadata.totalVideos ??
      metadata.total_videos ??
      channel.total_videos
    ) ?? profile.total_videos ?? null;
    profile.analyzed_videos = Object.keys(this.loadCreatorVideos(profile.creator_id) || {}).length;
    profile.first_analysis_at = [profile.first_analysis_at, analyzedAt].filter(Boolean).sort()[0] || null;
    profile.latest_analysis_at = [profile.latest_analysis_at, analyzedAt].filter(Boolean).sort().at(-1) || null;
    profile.aliases = profile.aliases || { names: [], urls: [], handles: [], channel_ids: [] };

    for (const [key, value] of [
      ["names", identity.displayName],
      ["urls", identity.canonicalUrl],
      ["handles", identity.handle],
      ["channel_ids", identity.channelId]
    ]) {
      profile.aliases[key] = Array.isArray(profile.aliases[key]) ? profile.aliases[key] : [];
      if (value && !profile.aliases[key].includes(value)) {
        profile.aliases[key].push(value);
      }
    }
  }

  persistIndexes(profile) {
    const profilePath = path.join(this.creatorsPath, profile.creator_id, "profile.json");
    writeJsonAtomic(profilePath, profile);
    writeJsonAtomic(this.indexPath, this.index);
    writeJsonAtomic(this.videoIndexPath, this.videoIndex);
    this.loadIndexes();
  }
}

module.exports = {
  CreatorRepository,
  identityKeys,
  normalizeCreatorIdentity,
  profileIdentityKeys
};
