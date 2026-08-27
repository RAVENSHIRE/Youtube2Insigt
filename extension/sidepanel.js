const API_URL = "http://localhost:3000";

const videoCard = document.getElementById("videoCard");
const creatorElement = document.getElementById("creator");
const videoTitleElement = document.getElementById("videoTitle");
const results = document.getElementById("results");
const placeholder = document.getElementById("placeholder");
const status = document.getElementById("status");

let currentVideoId = null;
let loadingVideoId = null;

document.addEventListener("DOMContentLoaded", loadCurrentVideo);

chrome.tabs.onActivated.addListener(() => {
  loadCurrentVideo();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab.active) {
    return;
  }

  if (
    changeInfo.url ||
    changeInfo.status === "complete"
  ) {
    loadCurrentVideo();
  }
});

async function loadCurrentVideo() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    if (!tab?.id || !tab.url?.includes("youtube.com/watch")) {
      resetUI("Open a YouTube video.");
      return;
    }

    const videoId = new URL(tab.url).searchParams.get("v");

    if (!videoId) {
      resetUI("Invalid YouTube video.");
      return;
    }

    if (
      videoId === currentVideoId ||
      videoId === loadingVideoId
    ) {
      return;
    }

    loadingVideoId = videoId;

    resetResearch();
    showStatus("Loading research...");

    let research = await getStoredVideo(videoId);

    if (!research) {
      const metadata = await getYouTubeMetadata(tab);

      await analyzeVideo({
        videoId,
        title: metadata.title,
        creator: metadata.creator,
        url: tab.url
      });

      research = await getStoredVideo(videoId);
    }

    if (!research?.video) {
      throw new Error("Research data unavailable.");
    }

    currentVideoId = videoId;

    renderVideo(research.video);
    renderCompanies(research.companies);

    placeholder.classList.add("hidden");
  } catch (error) {
    console.error("Side panel error:", error);

    currentVideoId = null;

    showStatus(
      error?.message || "Could not load research."
    );
  } finally {
    loadingVideoId = null;
  }
}

async function getStoredVideo(videoId) {
  const response = await fetch(
    `${API_URL}/videos/${encodeURIComponent(videoId)}`
  );

  if (response.status === 404) {
    return null;
  }

  const data = await parseResponse(response);

  if (!response.ok) {
    throw new Error(
      data.error || "Could not load stored research."
    );
  }

  return data;
}

async function getYouTubeMetadata(tab) {
  try {
    const data = await chrome.tabs.sendMessage(tab.id, {
      action: "extractVideo"
    });

    if (!data?.title) {
      throw new Error();
    }

    return data;
  } catch {
    return {
      title:
        tab.title?.replace(" - YouTube", "").trim() ||
        null,
      creator: null,
      url: tab.url
    };
  }
}

async function analyzeVideo({
  videoId,
  title,
  creator,
  url
}) {
  const response = await fetch(`${API_URL}/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      videoId,
      title,
      creator,
      url
    })
  });

  const data = await parseResponse(response);

  if (!response.ok) {
    throw new Error(
      data.error || "Analysis failed."
    );
  }

  return data;
}

function renderVideo(video) {
  creatorElement.textContent =
    video.creator || "";

  videoTitleElement.textContent =
    video.title || "";

  videoCard.classList.remove("hidden");
}

function renderCompanies(companies) {
  if (!Array.isArray(companies) || companies.length === 0) {
    results.innerHTML = `
      <div class="placeholder">
        No companies found.
      </div>
    `;

    results.classList.remove("hidden");
    return;
  }

  results.innerHTML = companies
    .map(company => {
      const sentiment =
        ["bull", "neutral", "bear"].includes(company.sentiment)
          ? company.sentiment
          : "neutral";

      const confidence =
        typeof company.confidence === "number"
          ? `${Math.round(company.confidence * 100)}%`
          : null;

      const priceTarget =
        company.price_target != null
          ? [
              company.price_target,
              company.currency
            ]
              .filter(Boolean)
              .join(" ")
          : null;

      return `
        <article class="company">
          <div class="company-header">
            <div class="company-identity">
              <strong class="company-name">
                ${escapeHtml(company.company || "")}
              </strong>

              ${
                company.ticker
                  ? `
                    <span class="ticker">
                      ${escapeHtml(company.ticker)}
                    </span>
                  `
                  : ""
              }
            </div>

            <span class="sentiment sentiment-${sentiment}">
              ${sentiment}
            </span>
          </div>

          <p class="thesis">
            ${escapeHtml(company.thesis || "")}
          </p>

          <div class="company-meta">
            ${
              confidence
                ? `
                  <div class="meta-item">
                    <span>Confidence</span>
                    <strong>${confidence}</strong>
                  </div>
                `
                : ""
            }

            ${
              priceTarget
                ? `
                  <div class="meta-item">
                    <span>Price Target</span>
                    <strong>
                      ${escapeHtml(priceTarget)}
                    </strong>
                  </div>
                `
                : ""
            }

            ${
              company.time_horizon
                ? `
                  <div class="meta-item">
                    <span>Horizon</span>
                    <strong>
                      ${escapeHtml(company.time_horizon)}
                    </strong>
                  </div>
                `
                : ""
            }
          </div>
        </article>
      `;
    })
    .join("");

  results.classList.remove("hidden");
}

function resetResearch() {
  videoCard.classList.add("hidden");
  results.classList.add("hidden");
  results.innerHTML = "";
}

function resetUI(message) {
  currentVideoId = null;
  loadingVideoId = null;

  resetResearch();
  showStatus(message);
}

function showStatus(message) {
  status.textContent = message;
  placeholder.classList.remove("hidden");
}

async function parseResponse(response) {
  return response.json().catch(() => ({}));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}