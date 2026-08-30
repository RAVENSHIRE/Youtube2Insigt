const API_URL = "http://localhost:3000";

const COLORS = [
  "#ff5a47",
  "#4bd29b",
  "#6da7ff",
  "#f5bf56",
  "#b889ff",
  "#ff86b7",
  "#55d5dd",
  "#f08b4b",
  "#8ed064",
  "#a0a8b8"
];

const dashboardElement = document.getElementById("dashboard");
const channelProfile = document.getElementById("channelProfile");
const companyDonut = document.getElementById("companyDonut");
const companyLegend = document.getElementById("companyLegend");
const videoCount = document.getElementById("videoCount");
const videoList = document.getElementById("videoList");
const statusBar = document.getElementById("statusBar");
const statusText = document.getElementById("statusText");
const emptyState = document.getElementById("emptyState");
const emptyTitle = document.getElementById("emptyTitle");
const emptyText = document.getElementById("emptyText");
const refreshButton = document.getElementById("refreshButton");

let currentVideoId = null;
let currentMetadata = null;
let lastDashboard = null;
let refreshTimer = null;
let isRefreshing = false;
let refreshQueued = false;

document.addEventListener("DOMContentLoaded", () => {
  refreshButton.addEventListener("click", refreshPanel);
  refreshPanel();
});

chrome.tabs.onActivated.addListener(() => {
  scheduleRefresh();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.url || changeInfo.status === "complete")) {
    scheduleRefresh();
  }
});

function scheduleRefresh() {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(refreshPanel, 220);
}

async function refreshPanel() {
  if (isRefreshing) {
    refreshQueued = true;
    return;
  }

  isRefreshing = true;
  setLoading(true);
  hideStatus();

  try {
    const context = await getActiveContext();
    currentVideoId = context.videoId;
    currentMetadata = context.metadata;
    let currentError = null;

    if (context.videoId) {
      try {
        const current = await ensureCurrentVideo(context);

        if (current?.metadata) {
          currentMetadata = current.metadata;
        }
      } catch (error) {
        currentError = error;
      }
    }

    const dashboard = await getDashboard();
    lastDashboard = dashboard;
    renderDashboard(dashboard);

    if (currentError) {
      showStatus(friendlyError(currentError), true);
    }
  } catch (error) {
    console.error("Side panel error:", error);

    if (lastDashboard) {
      renderDashboard(lastDashboard);
      showStatus(friendlyError(error), true);
    } else {
      renderEmpty(
        "Server nicht erreichbar",
        "Starte den lokalen Server und aktualisiere anschließend das Panel."
      );
      showStatus(friendlyError(error), true);
    }
  } finally {
    isRefreshing = false;
    setLoading(false);

    if (refreshQueued) {
      refreshQueued = false;
      refreshPanel();
    }
  }
}

async function getActiveContext() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tab?.id || !isYouTubeWatchUrl(tab.url)) {
    return {
      tab,
      videoId: null,
      metadata: null
    };
  }

  const videoId = new URL(tab.url).searchParams.get("v");

  if (!isValidVideoId(videoId)) {
    return {
      tab,
      videoId: null,
      metadata: null
    };
  }

  return {
    tab,
    videoId,
    metadata: null
  };
}

async function ensureCurrentVideo(context) {
  showStatus("YouTube-Kanaldaten werden gelesen …");

  const metadata = await getYouTubeMetadata(context.tab);
  let research = await getStoredVideo(context.videoId);

  if (research) {
    research = await updateStoredMetadata(context.videoId, metadata)
      .catch(() => research);
  } else {
    showStatus("Video wird analysiert – das kann einen Moment dauern …");

    await analyzeVideo({
      videoId: context.videoId,
      ...metadata
    });

    research = await getStoredVideo(context.videoId);
  }

  if (!research?.video) {
    throw new Error("Research-Daten sind noch nicht verfügbar.");
  }

  return {
    research,
    metadata
  };
}

async function getDashboard() {
  const response = await fetch(`${API_URL}/dashboard`);
  const data = await parseResponse(response);

  if (!response.ok) {
    throw new Error(data.error || "Dashboard konnte nicht geladen werden.");
  }

  return {
    totalVideos: Number(data.totalVideos) || 0,
    totalCompanies: Number(data.totalCompanies) || 0,
    totalReports: Number(data.totalReports) || 0,
    channels: Array.isArray(data.channels) ? data.channels : [],
    companies: Array.isArray(data.companies) ? data.companies : [],
    videos: Array.isArray(data.videos) ? data.videos : []
  };
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
    throw new Error(data.error || "Gespeicherter Report konnte nicht geladen werden.");
  }

  return data;
}

async function updateStoredMetadata(videoId, metadata) {
  const response = await fetch(
    `${API_URL}/videos/${encodeURIComponent(videoId)}/metadata`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(metadata)
    }
  );

  const data = await parseResponse(response);

  if (!response.ok) {
    throw new Error(data.error || "Kanaldaten konnten nicht aktualisiert werden.");
  }

  return data;
}

async function getYouTubeMetadata(tab) {
  try {
    const data = await chrome.tabs.sendMessage(tab.id, {
      action: "extractVideo"
    });

    if (!data?.title) {
      throw new Error("Metadaten fehlen.");
    }

    return {
      title: data.title,
      creator: data.creator || null,
      url: data.url || tab.url,
      channelUrl: data.channelUrl || null,
      channelAvatarUrl: data.channelAvatarUrl || null,
      subscriberCount: data.subscriberCount || null
    };
  } catch {
    return {
      title: tab.title?.replace(" - YouTube", "").trim() || null,
      creator: null,
      url: tab.url,
      channelUrl: null,
      channelAvatarUrl: null,
      subscriberCount: null
    };
  }
}

async function analyzeVideo(payload) {
  const response = await fetch(`${API_URL}/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await parseResponse(response);

  if (!response.ok) {
    const error = new Error(data.error || "Analyse fehlgeschlagen.");
    error.status = response.status;
    throw error;
  }

  return data;
}

function renderDashboard(data) {
  if (!data.videos.length) {
    renderEmpty(
      "Noch keine Analysen",
      currentVideoId
        ? "Das aktuelle Video konnte noch nicht analysiert werden."
        : "Öffne ein YouTube-Video, um deinen ersten Research-Report zu erstellen."
    );
    return;
  }

  const channel = selectChannel(data);
  renderChannel(channel, data);
  renderCompanyAllocation(data.companies, data.totalReports);
  renderVideos(data.videos);

  videoCount.textContent = `${data.totalVideos} ${data.totalVideos === 1 ? "Video" : "Videos"}`;
  emptyState.classList.add("hidden");
  dashboardElement.classList.remove("hidden");
}

function selectChannel(data) {
  const creator = currentMetadata?.creator;
  const matchingChannel = creator
    ? data.channels.find(channel =>
        normalizeIdentity(channel.name) === normalizeIdentity(creator)
      )
    : null;

  if (matchingChannel) {
    return matchingChannel;
  }

  const currentVideo = data.videos.find(video => video.id === currentVideoId);
  const videoChannel = currentVideo?.channel;

  if (videoChannel || currentVideo?.creator) {
    return {
      name: videoChannel?.name || currentVideo.creator,
      url: videoChannel?.url || null,
      avatarUrl: videoChannel?.avatar_url || null,
      subscriberCount: videoChannel?.subscriber_count || null,
      analyzedVideos: data.videos.filter(video =>
        normalizeIdentity(video.creator) === normalizeIdentity(currentVideo.creator)
      ).length
    };
  }

  return data.channels[0] || {
    name: "Research Library",
    url: null,
    avatarUrl: null,
    subscriberCount: null,
    analyzedVideos: data.totalVideos
  };
}

function renderChannel(channel, data) {
  const name = channel?.name || "Research Library";
  const channelUrl = safeUrl(channel?.url);
  const avatarUrl = safeUrl(channel?.avatarUrl);
  const initials = getInitials(name);
  const subscribers = cleanSubscriberCount(channel?.subscriberCount);
  const analyzedVideos = Number(channel?.analyzedVideos) || data.totalVideos;

  const nameMarkup = channelUrl
    ? `<a href="${escapeHtml(channelUrl)}" target="_blank" rel="noreferrer">${escapeHtml(name)}</a>`
    : escapeHtml(name);

  channelProfile.innerHTML = `
    <div class="channel-main">
      <div class="channel-avatar">
        <span>${escapeHtml(initials)}</span>
        ${avatarUrl ? `<img src="${escapeHtml(avatarUrl)}" alt="">` : ""}
      </div>
      <div class="channel-label">YouTube Channel</div>
      <h1 class="channel-name">${nameMarkup}</h1>
    </div>

    <div class="channel-stats">
      <div class="stat">
        <strong class="stat-value">${escapeHtml(subscribers || "—")}</strong>
        <span class="stat-label">Abonnenten</span>
      </div>
      <div class="stat">
        <strong class="stat-value">${analyzedVideos}</strong>
        <span class="stat-label">Analysiert</span>
      </div>
    </div>
  `;

  const avatar = channelProfile.querySelector(".channel-avatar img");

  avatar?.addEventListener("error", () => {
    avatar.remove();
  });
}

function renderCompanyAllocation(companies, totalReports) {
  const weighted = companies
    .filter(company => Number(company.mentions) > 0)
    .map(company => ({
      ...company,
      weight: Number(company.mentions)
    }));

  const chart = buildDonut(weighted, item => item.weight);
  const reports = totalReports || chart.total;

  companyDonut.style.background = chart.background;
  companyDonut.title = chart.slices
    .map(slice => `${slice.item.company}: ${slice.value} Report${slice.value === 1 ? "" : "s"}`)
    .join("\n");
  companyDonut.innerHTML = `
    <div class="donut-center">
      <strong class="donut-value">${reports}</strong>
      <span class="donut-label">Reports</span>
    </div>
  `;

  const visibleSlices = chart.slices.slice(0, 5);

  companyLegend.innerHTML = visibleSlices.length
    ? `
      ${visibleSlices.map(slice => `
        <div class="legend-item" title="${escapeHtml(slice.item.company || "")}">
          <span class="legend-dot" style="background:${slice.color}"></span>
          <span class="legend-name">${escapeHtml(slice.item.ticker || slice.item.company || "")}</span>
          <span class="legend-value">${Math.round(slice.percentage)}%</span>
        </div>
      `).join("")}
      ${chart.slices.length > visibleSlices.length
        ? `<div class="legend-more">+${chart.slices.length - visibleSlices.length} weitere im Chart</div>`
        : ""}
    `
    : '<div class="legend-more">Noch keine Unternehmen</div>';
}

function renderVideos(videos) {
  videoList.innerHTML = videos.map((video, index) => {
    const companies = Array.isArray(video.companies) ? video.companies : [];
    const chart = buildDonut(companies, () => 1);
    const videoUrl = safeUrl(video.url) ||
      `https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`;
    const title = video.title || "Unbenanntes Video";
    const creator = video.creator || "Unbekannter Kanal";
    const date = formatDate(video.analyzedAt);
    const isCurrent = video.id === currentVideoId;

    return `
      <article class="video-item ${isCurrent ? "is-current" : ""}">
        <div class="video-top">
          <div class="video-copy">
            <div class="video-meta">
              <span>${isCurrent ? "Aktuelles Video" : `Report ${String(index + 1).padStart(2, "0")}`}</span>
              <i class="meta-divider" aria-hidden="true"></i>
              <span>${escapeHtml(date)}</span>
            </div>
            <h2 class="video-title">
              <a href="${escapeHtml(videoUrl)}" target="_blank" rel="noreferrer">${escapeHtml(title)}</a>
            </h2>
          </div>

          <div
            class="donut donut-mini"
            style="background:${chart.background}"
            title="${escapeHtml(companies.map(company => company.company).filter(Boolean).join(", "))}"
            aria-label="${companies.length} vorgestellte Unternehmen"
          >
            <div class="donut-center">
              <strong class="donut-value">${companies.length}</strong>
              <span class="donut-label">Stocks</span>
            </div>
          </div>
        </div>

        ${video.summary
          ? `<p class="video-summary">${escapeHtml(video.summary)}</p>`
          : ""}

        <div class="company-chips" aria-label="Unternehmen in diesem Video">
          ${companies.length
            ? companies.map(company => {
                const sentiment = ["bull", "neutral", "bear"].includes(company.sentiment)
                  ? company.sentiment
                  : "neutral";
                const label = company.ticker || company.company || "Unternehmen";

                return `
                  <span
                    class="company-chip sentiment-${sentiment}"
                    title="${escapeHtml(company.thesis || company.company || "")}"
                  >
                    <span>${escapeHtml(label)}</span>
                  </span>
                `;
              }).join("")
            : '<span class="company-chip"><span>Keine Unternehmen erkannt</span></span>'}
        </div>

        <span class="sr-only">${escapeHtml(creator)}</span>
      </article>
    `;
  }).join("");
}

function buildDonut(items, getWeight) {
  const values = items.map(item => Math.max(0, Number(getWeight(item)) || 0));
  const total = values.reduce((sum, value) => sum + value, 0);

  if (!total) {
    return {
      total: 0,
      slices: [],
      background: "conic-gradient(#2a2f38 0deg 360deg)"
    };
  }

  let cursor = 0;
  const slices = items.map((item, index) => {
    const value = values[index];
    const start = cursor;
    const end = cursor + (value / total) * 360;
    const color = COLORS[index % COLORS.length];
    cursor = end;

    return {
      item,
      value,
      color,
      percentage: (value / total) * 100,
      segment: `${color} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`
    };
  });

  return {
    total,
    slices,
    background: `conic-gradient(${slices.map(slice => slice.segment).join(", ")})`
  };
}

function renderEmpty(title, text) {
  emptyTitle.textContent = title;
  emptyText.textContent = text;
  dashboardElement.classList.add("hidden");
  emptyState.classList.remove("hidden");
}

function setLoading(loading) {
  refreshButton.disabled = loading;
  refreshButton.classList.toggle("is-loading", loading);
}

function showStatus(message, isError = false) {
  statusText.textContent = message;
  statusBar.classList.toggle("is-error", isError);
  statusBar.classList.remove("hidden");
}

function hideStatus() {
  statusBar.classList.add("hidden");
  statusBar.classList.remove("is-error");
}

function friendlyError(error) {
  if (Number(error?.status) === 429 || /quota|resource_exhausted|prepayment/i.test(error?.message)) {
    return "Gemini-Limit erreicht. Deine bestehenden Reports bleiben verfügbar.";
  }

  if (/fetch|network|server/i.test(error?.message)) {
    return "Lokaler Server nicht erreichbar. Bitte Server starten und aktualisieren.";
  }

  return error?.message || "Etwas ist schiefgelaufen.";
}

function cleanSubscriberCount(value) {
  return String(value || "")
    .replace(/abonnenten/gi, "")
    .replace(/subscribers/gi, "")
    .trim();
}

function getInitials(value) {
  const words = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return words
    .slice(0, 2)
    .map(word => word[0])
    .join("")
    .toUpperCase() || "YT";
}

function normalizeIdentity(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function formatDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "ohne Datum";
  }

  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

function isYouTubeWatchUrl(value) {
  try {
    const url = new URL(value);
    return (
      (url.hostname === "www.youtube.com" || url.hostname === "youtube.com") &&
      url.pathname === "/watch"
    );
  } catch {
    return false;
  }
}

function isValidVideoId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{6,20}$/.test(value);
}

function safeUrl(value) {
  try {
    const url = new URL(value);

    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
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
