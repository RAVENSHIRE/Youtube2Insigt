chrome.runtime.onMessage.addListener(
  (request, sender, sendResponse) => {
    if (request.action !== "extractVideo") {
      return;
    }

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
        .querySelector("#channel-name a")
        ?.textContent
        ?.trim() ||
      null;

    const channelLink =
      document.querySelector("#owner ytd-channel-name a") ||
      document.querySelector("ytd-watch-metadata ytd-channel-name a") ||
      document.querySelector("#channel-name a");

    const channelAvatar =
      document.querySelector("#owner #avatar img") ||
      document.querySelector("ytd-watch-metadata #avatar img") ||
      document.querySelector("ytd-video-owner-renderer #avatar img");

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

    const publishedAt =
      document
        .querySelector('meta[itemprop="datePublished"]')
        ?.getAttribute("content") ||
      document
        .querySelector('meta[itemprop="uploadDate"]')
        ?.getAttribute("content") ||
      null;

    const channelUrl = channelLink?.href || null;
    const channelAvatarUrl =
      channelAvatar?.currentSrc ||
      channelAvatar?.src ||
      null;

    sendResponse({
      title: title || null,
      creator,
      url: window.location.href,
      publishedAt,
      channelUrl,
      channelAvatarUrl,
      subscriberCount
    });

    return true;
  }
);
