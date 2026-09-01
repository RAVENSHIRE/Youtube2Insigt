const crypto = require("crypto");

const STORAGE_SCHEMA_VERSION = 2;
const UNRESOLVED_IDENTITY = "unresolved:unknown";

function cleanString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeIdentityText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
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

function normalizeChannelId(value) {
  const channelId = cleanString(value);

  if (!channelId || !/^[a-z0-9_-]{10,}$/iu.test(channelId)) {
    return null;
  }

  return channelId;
}

function normalizeHandle(value) {
  const handle = cleanString(value);

  if (!handle) {
    return null;
  }

  const withoutAt = handle.replace(/^@/u, "");

  if (!withoutAt || /[\s/?#]/u.test(withoutAt)) {
    return null;
  }

  return `@${withoutAt}`;
}

function parseYouTubeChannelUrl(value) {
  const rawUrl = cleanString(value);

  if (!rawUrl) {
    return {
      canonicalUrl: null,
      channelId: null,
      handle: null
    };
  }

  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase();

    if (!["youtube.com", "www.youtube.com", "m.youtube.com"].includes(hostname)) {
      return {
        canonicalUrl: null,
        channelId: null,
        handle: null
      };
    }

    const segments = url.pathname
      .split("/")
      .map(segment => segment.trim())
      .filter(Boolean);

    while (
      segments.length > 1 &&
      [
        "about",
        "community",
        "featured",
        "playlists",
        "shorts",
        "streams",
        "videos"
      ].includes(segments.at(-1).toLowerCase())
    ) {
      segments.pop();
    }

    if (!segments.length) {
      return {
        canonicalUrl: null,
        channelId: null,
        handle: null
      };
    }

    let channelId = null;
    let handle = null;

    if (segments[0].toLowerCase() === "channel" && segments[1]) {
      channelId = normalizeChannelId(segments[1]);
    } else if (segments[0].startsWith("@")) {
      handle = normalizeHandle(segments[0]);
    }

    return {
      canonicalUrl: `https://www.youtube.com/${segments.join("/")}`,
      channelId,
      handle
    };
  } catch {
    return {
      canonicalUrl: null,
      channelId: null,
      handle: null
    };
  }
}

function firstCleanString(...values) {
  for (const value of values) {
    const cleaned = cleanString(value);

    if (cleaned) {
      return cleaned;
    }
  }

  return null;
}

function extractCreatorMetadata(sourceKey, report) {
  const video = report?.video && typeof report.video === "object"
    ? report.video
    : {};
  const channel = video.channel && typeof video.channel === "object"
    ? video.channel
    : {};
  const rawChannelUrl = firstCleanString(
    channel.url,
    channel.channel_url,
    channel.channelUrl,
    video.channel_url,
    video.channelUrl
  );
  const parsedUrl = parseYouTubeChannelUrl(rawChannelUrl);
  const channelId = normalizeChannelId(
    firstCleanString(
      channel.youtube_channel_id,
      channel.youtubeChannelId,
      channel.channel_id,
      channel.channelId,
      channel.id,
      video.youtube_channel_id,
      video.youtubeChannelId,
      video.channel_id,
      video.channelId,
      parsedUrl.channelId
    )
  );
  const handle = normalizeHandle(
    firstCleanString(
      channel.handle,
      channel.channel_handle,
      channel.channelHandle,
      video.channel_handle,
      video.channelHandle,
      parsedUrl.handle
    )
  );
  const displayName = firstCleanString(channel.name, video.creator);
  const normalizedName = normalizeIdentityText(displayName);
  const videoId = firstCleanString(video.id, sourceKey);

  return {
    sourceKey,
    videoId,
    displayName,
    normalizedName: normalizedName || null,
    channelId,
    handle,
    canonicalUrl: parsedUrl.canonicalUrl,
    avatarUrl: firstCleanString(channel.avatar_url, channel.avatarUrl),
    subscriberCount: firstCleanString(
      channel.subscriber_count,
      channel.subscriberCount
    ),
    totalVideos: normalizeCount(channel.total_videos ?? channel.totalVideos),
    analyzedAt: firstCleanString(video.analyzed_at, video.analyzedAt),
    metadataAt: firstCleanString(
      channel.updated_at,
      channel.updatedAt,
      video.analyzed_at,
      video.analyzedAt
    ),
    overrideApplied: false,
    report
  };
}

function applyCreatorOverride(metadata, override, warnings, errors) {
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    return metadata;
  }

  const overrideUrl = firstCleanString(
    override.channel_url,
    override.channelUrl
  );
  const parsedOverrideUrl = parseYouTubeChannelUrl(overrideUrl);
  const channelId = normalizeChannelId(
    firstCleanString(
      override.youtube_channel_id,
      override.youtubeChannelId,
      override.channel_id,
      override.channelId,
      parsedOverrideUrl.channelId
    )
  );
  const handle = normalizeHandle(
    firstCleanString(
      override.handle,
      override.channel_handle,
      override.channelHandle,
      parsedOverrideUrl.handle
    )
  );
  const canonicalUrl = parsedOverrideUrl.canonicalUrl ||
    (handle ? `https://www.youtube.com/${handle}` : null);
  const displayName = firstCleanString(
    override.display_name,
    override.displayName,
    metadata.displayName
  );

  if (!channelId && !handle && !canonicalUrl) {
    errors.push({
      code: "INVALID_CREATOR_OVERRIDE",
      videoId: metadata.videoId,
      message: "Der Creator-Override enthält keine stabile Kanalidentität."
    });
    return metadata;
  }

  warnings.push({
    code: "CREATOR_OVERRIDE_APPLIED",
    videoId: metadata.videoId,
    message: firstCleanString(override.reason) ||
      "Eine geprüfte Creator-Zuordnung wurde angewendet."
  });

  return {
    ...metadata,
    displayName,
    normalizedName: normalizeIdentityText(displayName) || null,
    channelId: channelId || metadata.channelId,
    handle: handle || metadata.handle,
    canonicalUrl: canonicalUrl || metadata.canonicalUrl,
    overrideApplied: true
  };
}

function getStrongIdentities(metadata) {
  const identities = [];

  if (metadata.channelId) {
    identities.push(`channel-id:${metadata.channelId.toLowerCase()}`);
  }

  if (metadata.handle) {
    identities.push(`handle:${metadata.handle.toLowerCase()}`);
  }

  if (metadata.canonicalUrl) {
    identities.push(`url:${metadata.canonicalUrl.toLowerCase()}`);
  }

  return [...new Set(identities)];
}

function getIdentityPriority(identity) {
  if (identity.startsWith("channel-id:")) {
    return 0;
  }

  if (identity.startsWith("handle:")) {
    return 1;
  }

  return 2;
}

function createStrongIdentityResolver(records) {
  const parents = new Map();

  function add(identity) {
    if (!parents.has(identity)) {
      parents.set(identity, identity);
    }
  }

  function find(identity) {
    add(identity);
    const parent = parents.get(identity);

    if (parent !== identity) {
      parents.set(identity, find(parent));
    }

    return parents.get(identity);
  }

  function union(left, right) {
    const leftRoot = find(left);
    const rightRoot = find(right);

    if (leftRoot !== rightRoot) {
      const [first, second] = [leftRoot, rightRoot].sort();
      parents.set(second, first);
    }
  }

  for (const record of records) {
    const identities = getStrongIdentities(record);

    for (const identity of identities) {
      add(identity);
    }

    for (let index = 1; index < identities.length; index += 1) {
      union(identities[0], identities[index]);
    }
  }

  const components = new Map();

  for (const identity of parents.keys()) {
    const root = find(identity);

    if (!components.has(root)) {
      components.set(root, []);
    }

    components.get(root).push(identity);
  }

  const canonicalByRoot = new Map(
    [...components.entries()].map(([root, identities]) => [
      root,
      [...identities].sort((left, right) =>
        getIdentityPriority(left) - getIdentityPriority(right) ||
        left.localeCompare(right)
      )[0]
    ])
  );

  return record => {
    const identities = getStrongIdentities(record);

    if (!identities.length) {
      return null;
    }

    return canonicalByRoot.get(find(identities[0])) || null;
  };
}

function hashValue(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function createCreatorId(identityKey) {
  if (identityKey === UNRESOLVED_IDENTITY) {
    return "creator_unresolved";
  }

  return `creator_${hashValue(identityKey).slice(0, 16)}`;
}

function selectMostFrequent(values) {
  const counts = new Map();

  for (const value of values.map(cleanString).filter(Boolean)) {
    const key = value.toLowerCase();
    const entry = counts.get(key) || { value, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }

  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))[0]
    ?.value || null;
}

function selectLatestMetadata(records, property) {
  return [...records]
    .sort((a, b) => String(b.metadataAt || "").localeCompare(
      String(a.metadataAt || "")
    ))
    .map(record => record[property])
    .find(value => value !== null && value !== undefined) ?? null;
}

function createCreatorProfile(identityKey, records) {
  const creatorId = createCreatorId(identityKey);
  const analyzedDates = records
    .map(record => record.analyzedAt)
    .filter(Boolean)
    .sort();
  const names = [...new Set(records.map(record => record.displayName).filter(Boolean))];
  const urls = [...new Set(records.map(record => record.canonicalUrl).filter(Boolean))];
  const handles = [...new Set(records.map(record => record.handle).filter(Boolean))];
  const channelIds = [...new Set(records.map(record => record.channelId).filter(Boolean))];

  return {
    schema_version: STORAGE_SCHEMA_VERSION,
    creator_id: creatorId,
    identity_key: identityKey,
    youtube_channel_id: channelIds[0] || null,
    handle: handles[0] || null,
    display_name:
      selectMostFrequent(records.map(record => record.displayName)) ||
      "Unbekannter Creator",
    channel_url: selectLatestMetadata(records, "canonicalUrl"),
    avatar_url: selectLatestMetadata(records, "avatarUrl"),
    subscriber_count: selectLatestMetadata(records, "subscriberCount"),
    total_videos: selectLatestMetadata(records, "totalVideos"),
    analyzed_videos: records.length,
    first_analysis_at: analyzedDates[0] || null,
    latest_analysis_at: analyzedDates.at(-1) || null,
    aliases: {
      names,
      urls,
      handles,
      channel_ids: channelIds
    },
    unresolved: identityKey.startsWith("unresolved:") ||
      identityKey.startsWith("ambiguous-name:")
  };
}

function buildNameToStrongIdentities(records, resolveStrongIdentity) {
  const result = new Map();

  for (const record of records) {
    const strongIdentity = resolveStrongIdentity(record);

    if (!record.normalizedName || !strongIdentity) {
      continue;
    }

    if (!result.has(record.normalizedName)) {
      result.set(record.normalizedName, new Set());
    }

    result.get(record.normalizedName).add(strongIdentity);
  }

  return result;
}

function resolveIdentity(
  record,
  nameToStrongIdentities,
  warnings,
  resolveStrongIdentity
) {
  const strongIdentity = resolveStrongIdentity(record);

  if (strongIdentity) {
    return strongIdentity;
  }

  if (record.normalizedName) {
    const candidates = nameToStrongIdentities.get(record.normalizedName) || new Set();

    if (candidates.size === 1) {
      const [identity] = candidates;
      warnings.push({
        code: "NAME_ONLY_MATCH",
        videoId: record.videoId,
        message: `Creator wurde über den eindeutigen Namen "${record.displayName}" zugeordnet.`
      });
      return identity;
    }

    if (candidates.size > 1) {
      warnings.push({
        code: "AMBIGUOUS_CREATOR_NAME",
        videoId: record.videoId,
        message: `Der Creator-Name "${record.displayName}" gehört zu mehreren Kanalidentitäten.`
      });
      return `ambiguous-name:${record.normalizedName}`;
    }

    warnings.push({
      code: "NAME_FALLBACK",
      videoId: record.videoId,
      message: `Für "${record.displayName}" fehlt Channel-ID, Handle und Kanal-URL.`
    });
    return `name:${record.normalizedName}`;
  }

  warnings.push({
    code: "UNRESOLVED_CREATOR",
    videoId: record.videoId,
    message: "Der Report enthält keine verwertbare Creator-Identität."
  });
  return UNRESOLVED_IDENTITY;
}

function buildMigrationPlan(sourceVideos, options = {}) {
  if (!sourceVideos || typeof sourceVideos !== "object" || Array.isArray(sourceVideos)) {
    throw new TypeError("Die Quelldatei muss ein JSON-Objekt mit Video-IDs enthalten.");
  }

  const warnings = [];
  const errors = [];
  const records = [];
  const overrideAssignments = options?.overrides?.assignments &&
    typeof options.overrides.assignments === "object" &&
    !Array.isArray(options.overrides.assignments)
    ? options.overrides.assignments
    : {};

  for (const [sourceKey, report] of Object.entries(sourceVideos)) {
    if (!report || typeof report !== "object" || Array.isArray(report)) {
      errors.push({
        code: "INVALID_REPORT",
        videoId: sourceKey,
        message: "Der Report ist kein JSON-Objekt."
      });
      continue;
    }

    let metadata = extractCreatorMetadata(sourceKey, report);

    if (!metadata.videoId) {
      errors.push({
        code: "MISSING_VIDEO_ID",
        videoId: sourceKey,
        message: "Für den Report fehlt eine Video-ID."
      });
      continue;
    }

    if (cleanString(report?.video?.id) && report.video.id !== sourceKey) {
      warnings.push({
        code: "VIDEO_ID_MISMATCH",
        videoId: sourceKey,
        message: `Objektschlüssel und video.id unterscheiden sich (${report.video.id}).`
      });
    }

    const override = overrideAssignments[sourceKey] ||
      overrideAssignments[metadata.videoId];

    if (override) {
      metadata = applyCreatorOverride(metadata, override, warnings, errors);
    }

    records.push(metadata);
  }

  const resolveStrongIdentity = createStrongIdentityResolver(records);
  const nameToStrongIdentities = buildNameToStrongIdentities(
    records,
    resolveStrongIdentity
  );
  const groups = new Map();

  for (const record of records) {
    const identityKey = resolveIdentity(
      record,
      nameToStrongIdentities,
      warnings,
      resolveStrongIdentity
    );

    if (!groups.has(identityKey)) {
      groups.set(identityKey, []);
    }

    groups.get(identityKey).push(record);
  }

  const creators = new Map();
  const videoIndex = {};
  const contentHashesBefore = new Map();
  const contentHashesAfter = new Map();

  for (const [identityKey, creatorRecords] of groups) {
    const profile = createCreatorProfile(identityKey, creatorRecords);
    const videos = {};

    for (const record of creatorRecords) {
      if (Object.prototype.hasOwnProperty.call(videoIndex, record.sourceKey)) {
        errors.push({
          code: "DUPLICATE_VIDEO_ID",
          videoId: record.sourceKey,
          message: "Die Video-ID wurde mehr als einem Creator zugeordnet."
        });
        continue;
      }

      videos[record.sourceKey] = record.report;
      videoIndex[record.sourceKey] = profile.creator_id;
      contentHashesBefore.set(
        record.sourceKey,
        hashValue(JSON.stringify(sourceVideos[record.sourceKey]))
      );
      contentHashesAfter.set(
        record.sourceKey,
        hashValue(JSON.stringify(videos[record.sourceKey]))
      );
    }

    creators.set(profile.creator_id, {
      profile,
      videos
    });
  }

  const sourceVideoCount = Object.keys(sourceVideos).length;
  const migratedVideoCount = Object.keys(videoIndex).length;
  const creatorVideoTotal = [...creators.values()]
    .reduce((sum, creator) => sum + Object.keys(creator.videos).length, 0);
  const contentPreserved = [...contentHashesBefore.entries()]
    .every(([videoId, digest]) => contentHashesAfter.get(videoId) === digest);

  if (sourceVideoCount !== migratedVideoCount) {
    errors.push({
      code: "VIDEO_COUNT_MISMATCH",
      message: `${sourceVideoCount} Quellvideos, aber ${migratedVideoCount} migrierte Videos.`
    });
  }

  if (creatorVideoTotal !== migratedVideoCount) {
    errors.push({
      code: "CREATOR_TOTAL_MISMATCH",
      message: "Die Summe der Creator-Videos stimmt nicht mit dem Video-Index überein."
    });
  }

  if (!contentPreserved) {
    errors.push({
      code: "REPORT_CONTENT_CHANGED",
      message: "Mindestens ein Analyseobjekt wurde während der Planung verändert."
    });
  }

  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    sourceVideos,
    creators,
    videoIndex,
    warnings,
    errors,
    validation: {
      sourceVideoCount,
      migratedVideoCount,
      creatorVideoTotal,
      creatorCount: creators.size,
      overridesApplied: records.filter(record => record.overrideApplied).length,
      unresolvedVideoCount: [...creators.values()]
        .filter(creator => creator.profile.unresolved)
        .reduce((sum, creator) => sum + creator.profile.analyzed_videos, 0),
      contentPreserved,
      canActivate: errors.length === 0
    }
  };
}

function createDryRunReport(plan, sourceMetadata = {}) {
  return {
    mode: "dry-run",
    schemaVersion: plan.schemaVersion,
    source: {
      path: sourceMetadata.path || null,
      bytes: sourceMetadata.bytes ?? null,
      sha256: sourceMetadata.sha256 || null
    },
    targetLayout: {
      creatorIndex: "server/data/creators/index.json",
      videoIndex: "server/data/creators/video-index.json",
      profilePattern: "server/data/creators/{creatorId}/profile.json",
      videosPattern: "server/data/creators/{creatorId}/videos.json"
    },
    validation: plan.validation,
    creators: [...plan.creators.values()]
      .map(creator => ({
        creatorId: creator.profile.creator_id,
        displayName: creator.profile.display_name,
        youtubeChannelId: creator.profile.youtube_channel_id,
        handle: creator.profile.handle,
        channelUrl: creator.profile.channel_url,
        analyzedVideos: creator.profile.analyzed_videos,
        totalVideos: creator.profile.total_videos,
        unresolved: creator.profile.unresolved,
        videoIds: Object.keys(creator.videos).sort()
      }))
      .sort((a, b) =>
        b.analyzedVideos - a.analyzedVideos ||
        a.displayName.localeCompare(b.displayName)
      ),
    warnings: plan.warnings,
    errors: plan.errors,
    writesPerformed: false
  };
}

module.exports = {
  STORAGE_SCHEMA_VERSION,
  buildMigrationPlan,
  createCreatorId,
  createDryRunReport,
  applyCreatorOverride,
  extractCreatorMetadata,
  normalizeChannelId,
  normalizeHandle,
  normalizeIdentityText,
  parseYouTubeChannelUrl
};
