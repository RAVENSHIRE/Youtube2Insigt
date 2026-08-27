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

    sendResponse({
      title: title || null,
      creator,
      url: window.location.href
    });

    return true;
  }
);