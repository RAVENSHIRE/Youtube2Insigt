chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action !== "extractVideo") {
    return;
  }

  extractVideoMetadata()
    .then(sendResponse)
    .catch(error => {
      console.error("YouTube metadata extraction failed:", error);
      sendResponse({
        title: document.title.replace(" - YouTube", "").trim() || null,
        creator: null,
        url: window.location.href,
        publishedAt: null,
        channelUrl: null,
        channelAvatarUrl: null,
        subscriberCount: null,
        channelTotalVideos: null,
        channelId: null,
        channelHandle: null
      });
    });

  return true;
});

async function extractVideoMetadata() {
  await waitForChannelAvatar();

  const title =
    document
      .querySelector("ytd-watch-metadata h1 yt-formatted-string")
      ?.textContent
      ?.trim() ||
    document
      .querySelector("h1.ytd-watch-metadata")
      ?.textContent
      ?.trim() ||
    document.title.replace(" - YouTube", "").trim();

  const creator =
    document
      .querySelector("#owner ytd-channel-name a")
      ?.textContent
      ?.trim() ||
    document
      .querySelector("ytd-watch-metadata ytd-channel-name a")
      ?.textContent
      ?.trim() ||
    document
      .querySelector("ytd-video-owner-renderer #channel-name a")
      ?.textContent
      ?.trim() ||
    document
      .querySelector("#channel-name a")
      ?.textContent
      ?.trim() ||
    null;

  const channelLink =
    document.querySelector("#owner ytd-channel-name a") ||
    document.querySelector("ytd-watch-metadata ytd-channel-name a") ||
    document.querySelector("ytd-video-owner-renderer #channel-name a") ||
    document.querySelector("#channel-name a") ||
    document.querySelector('ytd-video-owner-renderer a[href^="/@"]');

  const channelAvatar = findChannelAvatar();

  const subscriberCount =
    document
      .querySelector("#owner-sub-count")
      ?.textContent
      ?.trim() ||
    document
      .querySelector("ytd-video-owner-renderer #subscriber-count")
      ?.textContent
      ?.trim() ||
    null;

  const channelUrl = channelLink?.href || null;
  const channelId =
    document
      .querySelector('meta[itemprop="channelId"]')
      ?.getAttribute("content") ||
    document
      .querySelector('link[itemprop="url"][href*="/channel/"]')
      ?.getAttribute("href")
      ?.match(/\/channel\/([^/?#]+)/u)?.[1] ||
    null;
  const channelHandle = getChannelHandle(channelUrl);
  const publishedAt =
    document
      .querySelector('meta[itemprop="datePublished"]')
      ?.getAttribute("content") ||
    document
      .querySelector('meta[itemprop="uploadDate"]')
      ?.getAttribute("content") ||
    null;

  return {
    title: title || null,
    creator,
    url: window.location.href,
    publishedAt,
    channelUrl,
    channelAvatarUrl:
      getBestAvatarUrl(channelAvatar) || getAvatarFromInitialData(),
    subscriberCount,
    channelTotalVideos: null,
    channelId,
    channelHandle
  };
}

function getChannelHandle(channelUrl) {
  try {
    const firstSegment = new URL(channelUrl).pathname
      .split("/")
      .filter(Boolean)[0];
    return firstSegment?.startsWith("@") ? firstSegment : null;
  } catch {
    return null;
  }
}

function waitForChannelAvatar(timeout = 4000) {
  if (findChannelAvatar() || getAvatarFromInitialData()) {
    return Promise.resolve();
  }

  return new Promise(resolve => {
    const observer = new MutationObserver(() => {
      if (findChannelAvatar() || getAvatarFromInitialData()) {
        observer.disconnect();
        window.clearTimeout(timer);
        resolve();
      }
    });

    const timer = window.setTimeout(() => {
      observer.disconnect();
      resolve();
    }, timeout);

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  });
}

function findChannelAvatar() {
  return document.querySelector(
    "#owner #avatar img, ytd-watch-metadata #avatar img, ytd-video-owner-renderer #avatar img, ytd-video-owner-renderer yt-avatar-shape img, #owner yt-avatar-shape img, ytd-video-owner-renderer yt-img-shadow img"
  );
}

function getBestAvatarUrl(image) {
  if (!image) {
    return null;
  }

  const srcset = String(image.srcset || "")
    .split(",")
    .map(item => item.trim().split(/\s+/)[0])
    .filter(Boolean);

  return srcset.at(-1) ||
    image.currentSrc ||
    image.src ||
    image.getAttribute("data-thumb") ||
    null;
}

function getAvatarFromInitialData() {
  const scripts = [...document.scripts]
    .map(script => script.textContent || "")
    .filter(text => text.includes('"videoOwnerRenderer"'));

  for (const text of scripts) {
    const match = text.match(
      /"videoOwnerRenderer":\{"thumbnail":\{"thumbnails":(\[[^\]]+\])/u
    );

    if (!match) {
      continue;
    }

    try {
      const thumbnails = JSON.parse(match[1]);
      const url = thumbnails.at(-1)?.url;

      if (url) {
        return url.replaceAll("\\u0026", "&");
      }
    } catch {
      // Try the next initial-data script.
    }
  }

  return null;
}
