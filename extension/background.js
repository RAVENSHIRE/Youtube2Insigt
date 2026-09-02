chrome.sidePanel
  .setPanelBehavior({
    openPanelOnActionClick: true
  })
  .catch(console.error);

const channelVideoCountCache = new Map();
const CHANNEL_VIDEO_COUNT_CACHE_TTL = 10 * 60 * 1000;
const CHANNEL_VIDEO_COUNT_TIMEOUT = 12 * 1000;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.action === "openOrFocusVideo") {
    openOrFocusVideo(request.videoUrl)
      .then(result => sendResponse({ ok: true, ...result }))
      .catch(error => {
        console.warn("YouTube tab could not be opened or focused:", error);
        sendResponse({ ok: false, error: error.message });
      });

    return true;
  }

  if (request?.action !== "getChannelTotalVideos") {
    return false;
  }

  getChannelTotalVideos(request.channelUrl)
    .then(totalVideos => {
      sendResponse({
        ok: totalVideos !== null,
        totalVideos
      });
    })
    .catch(error => {
      console.warn("YouTube channel video count could not be loaded:", error);
      sendResponse({
        ok: false,
        totalVideos: null
      });
    });

  return true;
});

async function openOrFocusVideo(videoUrl) {
  const targetUrl = new URL(videoUrl);
  const targetVideoId = targetUrl.searchParams.get("v");

  if (
    !["youtube.com", "www.youtube.com", "m.youtube.com"].includes(targetUrl.hostname) ||
    targetUrl.pathname !== "/watch" ||
    !targetVideoId
  ) {
    throw new Error("Ungültige YouTube-Video-URL.");
  }

  const tabs = await chrome.tabs.query({
    url: ["https://www.youtube.com/watch*"]
  });
  const existing = tabs.find(tab => {
    try {
      return new URL(tab.url).searchParams.get("v") === targetVideoId;
    } catch {
      return false;
    }
  });

  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true });

    if (Number.isInteger(existing.windowId)) {
      await chrome.windows.update(existing.windowId, { focused: true });
    }

    return { reused: true, tabId: existing.id };
  }

  targetUrl.hostname = "www.youtube.com";
  const created = await chrome.tabs.create({ url: targetUrl.href, active: true });
  return { reused: false, tabId: created.id };
}

async function getChannelTotalVideos(channelUrl) {
  const videosUrl = getChannelVideosUrl(channelUrl);

  if (!videosUrl) {
    return null;
  }

  const cached = channelVideoCountCache.get(videosUrl);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    CHANNEL_VIDEO_COUNT_TIMEOUT
  );

  try {
    const response = await fetch(videosUrl, {
      cache: "no-store",
      credentials: "include",
      redirect: "follow",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`YouTube returned HTTP ${response.status}.`);
    }

    const totalVideos = extractChannelTotalVideos(await response.text());

    if (totalVideos !== null) {
      channelVideoCountCache.set(videosUrl, {
        value: totalVideos,
        expiresAt: Date.now() + CHANNEL_VIDEO_COUNT_CACHE_TTL
      });
    }

    return totalVideos;
  } finally {
    clearTimeout(timeout);
  }
}

function getChannelVideosUrl(channelUrl) {
  try {
    const url = new URL(channelUrl);

    if (!["youtube.com", "www.youtube.com"].includes(url.hostname)) {
      return null;
    }

    url.hostname = "www.youtube.com";
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname
      .replace(
        /\/(?:featured|videos|shorts|streams|playlists|community|about)\/?$/iu,
        ""
      )
      .replace(/\/+$/u, "");

    if (!url.pathname || url.pathname === "/") {
      return null;
    }

    url.pathname = `${url.pathname}/videos`;

    return url.href;
  } catch {
    return null;
  }
}

function extractChannelTotalVideos(html) {
  const propertyPattern =
    /"(?:content|accessibilityLabel|simpleText)":"((?:\\.|[^"\\])*)"/gu;

  for (const match of String(html || "").matchAll(propertyPattern)) {
    try {
      const text = JSON.parse(`"${match[1]}"`);
      const totalVideos = parseVideoCountLabel(text);

      if (totalVideos !== null) {
        return totalVideos;
      }
    } catch {
      // Ignore malformed JSON fragments and continue with the next candidate.
    }
  }

  return null;
}

function parseVideoCountLabel(value) {
  const label = String(value || "")
    .replace(/\u00a0/gu, " ")
    .trim();
  const match = label.match(
    /^([\d.,\s]+)([KMB])?\s+(?:videos?|vid[éeí]os?)$/iu
  );

  if (!match) {
    return null;
  }

  const suffix = String(match[2] || "").toUpperCase();
  const compactValue = match[1].replace(/\s/gu, "");

  if (!suffix) {
    const integer = Number(compactValue.replace(/[^\d]/gu, ""));
    return Number.isSafeInteger(integer) ? integer : null;
  }

  const decimalSeparator = Math.max(
    compactValue.lastIndexOf("."),
    compactValue.lastIndexOf(",")
  );
  const wholePart = compactValue
    .slice(0, decimalSeparator < 0 ? compactValue.length : decimalSeparator)
    .replace(/[^\d]/gu, "");
  const fractionPart = decimalSeparator < 0
    ? ""
    : compactValue.slice(decimalSeparator + 1).replace(/[^\d]/gu, "");
  const normalizedValue = fractionPart
    ? `${wholePart}.${fractionPart}`
    : wholePart;
  const multipliers = { K: 1_000, M: 1_000_000, B: 1_000_000_000 };
  const totalVideos = Math.round(Number(normalizedValue) * multipliers[suffix]);

  return Number.isSafeInteger(totalVideos) ? totalVideos : null;
}
