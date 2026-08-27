const API_URL = "http://localhost:3000";

const extractButton = document.getElementById("extractButton");
const status = document.getElementById("status");
const results = document.getElementById("results");

extractButton.addEventListener("click", extractVideo);

async function extractVideo() {
  setLoading(true);
  status.textContent = "Extracting...";
  results.classList.add("hidden");

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    if (!tab?.id || !tab.url?.includes("youtube.com/watch")) {
      throw new Error("Open a YouTube video first.");
    }

    const video = await chrome.tabs.sendMessage(tab.id, {
      action: "extractVideo"
    });

    if (!video?.url) {
      throw new Error("Could not extract video information.");
    }

    const videoId = new URL(video.url).searchParams.get("v");

    if (!videoId) {
      throw new Error("Could not find YouTube video ID.");
    }

    status.textContent = "Analyzing...";

    const analyzeResponse = await fetch(`${API_URL}/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        videoId,
        title: video.title,
        creator: video.creator,
        url: video.url
      })
    });

    const analyzeData = await parseResponse(analyzeResponse);

    if (!analyzeResponse.ok) {
      throw new Error(analyzeData.error || "Analysis failed.");
    }

    const videoResponse = await fetch(
      `${API_URL}/videos/${encodeURIComponent(videoId)}`
    );

    const videoData = await parseResponse(videoResponse);

    if (!videoResponse.ok) {
      throw new Error(videoData.error || "Could not load analysis.");
    }

    renderCompanies(videoData.companies);

    status.textContent = analyzeData.cached
      ? "✓ Loaded from cache"
      : "✓ Analysis complete";
  } catch (error) {
    console.error("Extension error:", error);

    status.textContent =
      `Error: ${error?.message || "Unknown error"}`;
  } finally {
    setLoading(false);
  }
}

async function parseResponse(response) {
  const data = await response.json().catch(() => ({}));

  return data;
}

function setLoading(loading) {
  extractButton.disabled = loading;
  extractButton.textContent = loading
    ? "Processing..."
    : "Extract Video";
}

function renderCompanies(companies) {
  if (!Array.isArray(companies) || companies.length === 0) {
    throw new Error("No companies found in analysis.");
  }

  results.innerHTML = companies
    .map(company => `
      <div class="company">
        <h3>
          ${escapeHtml(company.company || "Unknown")}
          ${
            company.ticker
              ? ` (${escapeHtml(company.ticker)})`
              : ""
          }
        </h3>

        <p>
          <strong>Sentiment:</strong>
          ${escapeHtml(company.sentiment || "-")}
        </p>

        <p>
          <strong>Confidence:</strong>
          ${
            typeof company.confidence === "number"
              ? `${(company.confidence * 100).toFixed(0)}%`
              : "-"
          }
        </p>

        <p>
          <strong>Thesis:</strong>
          ${escapeHtml(company.thesis || "-")}
        </p>

        <p>
          <strong>Price Target:</strong>
          ${
            company.price_target != null
              ? `${escapeHtml(company.currency || "")}${escapeHtml(company.price_target)}`
              : "-"
          }
        </p>

        <p>
          <strong>Time Horizon:</strong>
          ${escapeHtml(company.time_horizon || "-")}
        </p>
      </div>
    `)
    .join("");

  results.classList.remove("hidden");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}