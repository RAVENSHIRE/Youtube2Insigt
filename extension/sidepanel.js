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
const reportInspector = document.getElementById("reportInspector");
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
let visibleVideos = [];
let visibleCompanyReports = [];
let selectedCompanyKey = null;
let selectedVideoId = null;

document.addEventListener("DOMContentLoaded", () => {
  refreshButton.addEventListener("click", refreshPanel);
  companyDonut.addEventListener("click", handleCompanySelection);
  companyDonut.addEventListener("keydown", handleCompanyKeyboardSelection);
  companyLegend.addEventListener("click", handleCompanySelection);
  videoList.addEventListener("click", handleVideoReportSelection);
  reportInspector.addEventListener("click", handleInspectorClick);
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
      publishedAt: data.publishedAt || null,
      channelUrl: data.channelUrl || null,
      channelAvatarUrl: data.channelAvatarUrl || null,
      subscriberCount: data.subscriberCount || null
    };
  } catch {
    return {
      title: tab.title?.replace(" - YouTube", "").trim() || null,
      creator: null,
      url: tab.url,
      publishedAt: null,
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
  visibleVideos = filterVideosForChannel(data.videos, channel);
  visibleCompanyReports = buildCompanyReports(visibleVideos);

  if (
    selectedCompanyKey &&
    !visibleCompanyReports.some(company => company.key === selectedCompanyKey)
  ) {
    selectedCompanyKey = null;
  }

  if (selectedVideoId && !visibleVideos.some(video => video.id === selectedVideoId)) {
    selectedVideoId = null;
  }

  renderChannel(channel, data);
  renderCompanyAllocation(visibleCompanyReports);
  renderVideos(visibleVideos);

  if (selectedVideoId && visibleVideos.some(video => video.id === selectedVideoId)) {
    renderVideoInspector(selectedVideoId);
  } else if (selectedCompanyKey) {
    renderCompanyInspector(selectedCompanyKey);
  } else {
    closeReportInspector();
  }

  videoCount.textContent = `${visibleVideos.length} ${visibleVideos.length === 1 ? "Video" : "Videos"}`;
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
        <span class="stat-label">Analysierte Videos</span>
      </div>
    </div>
  `;

  const avatar = channelProfile.querySelector(".channel-avatar img");

  avatar?.addEventListener("error", () => {
    avatar.remove();
  });
}

function filterVideosForChannel(videos, channel) {
  const channelName = normalizeIdentity(channel?.name);

  if (!channelName || channelName === normalizeIdentity("Research Library")) {
    return videos;
  }

  const matches = videos.filter(video => {
    const videoChannelName = video.channel?.name || video.creator;
    return normalizeIdentity(videoChannelName) === channelName;
  });

  return matches.length ? matches : videos;
}

function buildCompanyReports(videos) {
  const companies = new Map();

  for (const video of videos) {
    for (const report of Array.isArray(video.companies) ? video.companies : []) {
      const company = String(report.company || "").trim();

      if (!company) {
        continue;
      }

      const key = companyKey(report);

      if (!companies.has(key)) {
        companies.set(key, {
          key,
          company,
          ticker: report.ticker || null,
          assetType: report.asset_type || "other",
          presentations: [],
          videoIds: new Set(),
          sentiment: { bull: 0, neutral: 0, bear: 0 }
        });
      }

      const entry = companies.get(key);

      if (entry.videoIds.has(video.id)) {
        continue;
      }

      entry.videoIds.add(video.id);
      const sentiment = ["bull", "neutral", "bear"].includes(report.sentiment)
        ? report.sentiment
        : "neutral";

      entry.sentiment[sentiment] += 1;
      entry.presentations.push({
        video,
        report,
        presentedAt: video.publishedAt || video.analyzedAt,
        dateSource: video.publishedAt ? "published" : "analyzed"
      });
    }
  }

  return [...companies.values()]
    .map(company => {
      company.presentations.sort((a, b) =>
        String(a.presentedAt).localeCompare(String(b.presentedAt))
      );

      return {
        ...company,
        firstPresentation: company.presentations[0] || null,
        weight: company.presentations.length
      };
    })
    .sort((a, b) => b.weight - a.weight || a.company.localeCompare(b.company));
}

function renderCompanyAllocation(companies) {
  const chart = buildDonut(companies, item => item.weight);

  companyDonut.style.background = "none";
  companyDonut.title = "Klicke auf ein Segment, um alle zugehörigen Video-Reports zu lesen.";
  companyDonut.innerHTML = `
    ${renderDonutSvg(chart, true)}
    <div class="donut-center">
      <strong class="donut-value">${chart.total}</strong>
      <span class="donut-label">Vorstellungen</span>
    </div>
  `;

  companyLegend.innerHTML = chart.slices.length
    ? chart.slices.map(slice => `
      <button
        class="legend-item ${selectedCompanyKey === slice.item.key ? "is-selected" : ""}"
        type="button"
        data-company-key="${escapeHtml(slice.item.key)}"
        title="${escapeHtml(`${slice.item.company}: ${slice.value} von ${visibleVideos.length} analysierten Videos`)}"
      >
        <span class="legend-dot" style="background:${slice.color}"></span>
        <span class="legend-name">${escapeHtml(slice.item.ticker || slice.item.company)}</span>
        <span class="legend-value">${slice.value}× · ${Math.round(slice.percentage)}%</span>
      </button>
    `).join("")
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
    const date = formatDate(video.publishedAt || video.analyzedAt);
    const isCurrent = video.id === currentVideoId;

    return `
      <article class="video-item ${isCurrent ? "is-current" : ""}" data-video-id="${escapeHtml(video.id)}">
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

          <a
            class="donut donut-mini"
            href="${escapeHtml(videoUrl)}"
            target="_blank"
            rel="noreferrer"
            data-video-report="${escapeHtml(video.id)}"
            title="${escapeHtml(companies.map(company => company.company).filter(Boolean).join(", "))}"
            aria-label="Video öffnen und vollständigen Analysebericht mit ${companies.length} Unternehmen anzeigen"
          >
            ${renderDonutSvg(chart)}
            <div class="donut-center">
              <strong class="donut-value">${companies.length}</strong>
              <span class="donut-label">Stocks</span>
            </div>
          </a>
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
                  <button
                    type="button"
                    class="company-chip sentiment-${sentiment}"
                    data-company-key="${escapeHtml(companyKey(company))}"
                    title="${escapeHtml(company.thesis || company.company || "")}"
                  >
                    <span>${escapeHtml(label)}</span>
                  </button>
                `;
              }).join("")
            : '<span class="company-chip"><span>Keine Unternehmen erkannt</span></span>'}
        </div>

        <span class="sr-only">${escapeHtml(creator)}</span>
      </article>
    `;
  }).join("");
}

function companyKey(company) {
  const assetType = normalizeIdentity(company.asset_type || "other");
  const identity = company.ticker
    ? normalizeIdentity(company.ticker)
    : normalizeIdentity(company.company);

  return `${assetType}:${identity}`;
}

function handleCompanySelection(event) {
  const trigger = event.target.closest("[data-company-key]");

  if (!trigger) {
    return;
  }

  selectCompanyReport(trigger.dataset.companyKey);
}

function handleCompanyKeyboardSelection(event) {
  if (!["Enter", " "].includes(event.key)) {
    return;
  }

  const trigger = event.target.closest("[data-company-key]");

  if (!trigger) {
    return;
  }

  event.preventDefault();
  selectCompanyReport(trigger.dataset.companyKey);
}

function handleVideoReportSelection(event) {
  const companyTrigger = event.target.closest("[data-company-key]");

  if (companyTrigger) {
    selectCompanyReport(companyTrigger.dataset.companyKey);
    return;
  }

  const reportTrigger = event.target.closest("[data-video-report]");

  if (reportTrigger) {
    selectedCompanyKey = null;
    selectedVideoId = reportTrigger.dataset.videoReport;
    renderCompanyAllocation(visibleCompanyReports);
    renderVideoInspector(selectedVideoId);
  }
}

function handleInspectorClick(event) {
  if (event.target.closest("[data-close-inspector]")) {
    selectedCompanyKey = null;
    selectedVideoId = null;
    renderCompanyAllocation(visibleCompanyReports);
    closeReportInspector();
  }
}

function selectCompanyReport(key) {
  if (!visibleCompanyReports.some(company => company.key === key)) {
    return;
  }

  selectedCompanyKey = key;
  selectedVideoId = null;
  renderCompanyAllocation(visibleCompanyReports);
  renderCompanyInspector(key);
}

function renderCompanyInspector(key) {
  const company = visibleCompanyReports.find(item => item.key === key);

  if (!company) {
    closeReportInspector();
    return;
  }

  const first = company.firstPresentation;
  const firstDate = formatDate(first?.presentedAt);
  const firstDateHint = first?.dateSource === "published"
    ? "Veröffentlichungsdatum des Videos"
    : "Frühestes gespeichertes Analysedatum";

  reportInspector.innerHTML = `
    <div class="inspector-header">
      <div>
        <div class="eyebrow">Unternehmenshistorie</div>
        <h2>${escapeHtml(company.company)}${company.ticker ? ` <span>${escapeHtml(company.ticker)}</span>` : ""}</h2>
      </div>
      ${renderInspectorCloseButton()}
    </div>

    <div class="inspector-metrics">
      <div class="inspector-metric">
        <span>Erstmals vorgestellt</span>
        <strong>${escapeHtml(firstDate)}</strong>
        <small>${escapeHtml(firstDateHint)}</small>
      </div>
      <div class="inspector-metric">
        <span>Vom Kanal vorgestellt</span>
        <strong>${company.weight} von ${visibleVideos.length} Videos</strong>
        <small>Nur analysierte Videos dieses Kanals</small>
      </div>
    </div>

    <div class="report-stack">
      ${company.presentations.map((presentation, index) =>
        renderPresentationReport(presentation, index)
      ).join("")}
    </div>
  `;

  openReportInspector();
}

function renderVideoInspector(videoId) {
  const video = visibleVideos.find(item => item.id === videoId);

  if (!video) {
    closeReportInspector();
    return;
  }

  const videoUrl = safeUrl(video.url) ||
    `https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`;
  const companies = Array.isArray(video.companies) ? video.companies : [];

  reportInspector.innerHTML = `
    <div class="inspector-header">
      <div>
        <div class="eyebrow">Vollständiger Analysebericht</div>
        <h2>${escapeHtml(video.title || "Unbenanntes Video")}</h2>
      </div>
      ${renderInspectorCloseButton()}
    </div>

    <div class="report-video-meta">
      <span>${escapeHtml(video.creator || "Unbekannter Kanal")}</span>
      <span>${escapeHtml(formatDate(video.publishedAt || video.analyzedAt))}</span>
      <a href="${escapeHtml(videoUrl)}" target="_blank" rel="noreferrer">Video öffnen ↗</a>
    </div>

    ${video.summary
      ? `<section class="report-summary"><h3>Zusammenfassung</h3><p>${escapeHtml(video.summary)}</p></section>`
      : ""}

    <div class="report-stack">
      ${companies.length
        ? companies.map((report, index) => renderCompanyReport(report, index)).join("")
        : '<p class="report-empty">Keine Unternehmen erkannt.</p>'}
    </div>
  `;

  openReportInspector();
}

function renderPresentationReport(presentation, index) {
  const { video, report } = presentation;
  const videoUrl = safeUrl(video.url) ||
    `https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`;

  return `
    <details class="report-entry" ${index === 0 ? "open" : ""}>
      <summary>
        <span>${escapeHtml(video.title || "Unbenanntes Video")}</span>
        <small>${escapeHtml(formatDate(presentation.presentedAt))}</small>
      </summary>
      <div class="report-entry-body">
        <a class="report-video-link" href="${escapeHtml(videoUrl)}" target="_blank" rel="noreferrer">Video öffnen ↗</a>
        ${video.summary ? `<p class="report-context">${escapeHtml(video.summary)}</p>` : ""}
        ${renderCompanyReportContent(report)}
      </div>
    </details>
  `;
}

function renderCompanyReport(report, index) {
  return `
    <details class="report-entry" ${index === 0 ? "open" : ""}>
      <summary>
        <span>${escapeHtml(report.company || "Unternehmen")}${report.ticker ? ` · ${escapeHtml(report.ticker)}` : ""}</span>
        <small>${escapeHtml(sentimentLabel(report.sentiment))}</small>
      </summary>
      <div class="report-entry-body">${renderCompanyReportContent(report)}</div>
    </details>
  `;
}

function renderCompanyReportContent(report) {
  const structuredTargets = Array.isArray(report.price_targets) ? report.price_targets : [];
  const priceTargets = structuredTargets.length
    ? structuredTargets
    : report.price_target != null
      ? [{
          value: report.price_target,
          currency: report.price_target_currency || report.currency || null,
          context: null,
          source: null
        }]
      : [];
  const levels = Array.isArray(report.levels) ? report.levels : [];
  const evidence = Array.isArray(report.evidence) ? report.evidence : [];
  const facts = [
    report.sentiment ? ["Sentiment", sentimentLabel(report.sentiment)] : null,
    report.action && report.action !== "none" ? ["Aktion", actionLabel(report.action)] : null,
    report.asset_type ? ["Asset", report.asset_type.toUpperCase()] : null,
    report.time_horizon ? ["Zeithorizont", report.time_horizon] : null,
    report.confidence != null && Number.isFinite(Number(report.confidence))
      ? ["Konfidenz", `${Math.round(Number(report.confidence) * 100)} %`]
      : null,
    report.mentioned_move_pct != null && Number.isFinite(Number(report.mentioned_move_pct))
      ? ["Genannte Bewegung", `${formatNumber(report.mentioned_move_pct)} %`]
      : null
  ].filter(Boolean);

  return `
    ${facts.length
      ? `<div class="report-facts">${facts.map(([label, value]) => `
          <div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
        `).join("")}</div>`
      : ""}
    ${report.thesis
      ? `<section class="report-section"><h4>Investment-These</h4><p>${escapeHtml(report.thesis)}</p></section>`
      : ""}
    ${priceTargets.length
      ? `<section class="report-section"><h4>Kursziele</h4><ul>${priceTargets.map(target => `
          <li><strong>${escapeHtml(formatAmount(target.value, target.currency))}</strong>${target.context ? ` — ${escapeHtml(target.context)}` : ""}${target.source ? ` <small>(${escapeHtml(target.source)})</small>` : ""}</li>
        `).join("")}</ul></section>`
      : ""}
    ${levels.length
      ? `<section class="report-section"><h4>Marken & Levels</h4><ul>${levels.map(level => `
          <li><strong>${escapeHtml(levelLabel(level.type))}: ${escapeHtml(formatAmount(level.value, level.currency))}</strong>${level.context ? ` — ${escapeHtml(level.context)}` : ""}</li>
        `).join("")}</ul></section>`
      : ""}
    ${evidence.length
      ? `<section class="report-section"><h4>Belege aus dem Video</h4><ul>${evidence.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>`
      : ""}
  `;
}

function renderInspectorCloseButton() {
  return `
    <button class="inspector-close" type="button" data-close-inspector aria-label="Analysebericht schließen" title="Schließen">×</button>
  `;
}

function openReportInspector() {
  reportInspector.classList.remove("hidden");
  reportInspector.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function closeReportInspector() {
  reportInspector.classList.add("hidden");
  reportInspector.innerHTML = "";
}

function sentimentLabel(value) {
  return ({ bull: "Bullish", neutral: "Neutral", bear: "Bearish" })[value] || "Neutral";
}

function actionLabel(value) {
  return ({
    buy: "Kaufen",
    add: "Aufstocken",
    hold: "Halten",
    reduce: "Reduzieren",
    sell: "Verkaufen",
    watch: "Beobachten"
  })[value] || value;
}

function levelLabel(value) {
  return ({
    support: "Unterstützung",
    resistance: "Widerstand",
    breakout: "Ausbruch",
    entry: "Einstieg",
    stop_loss: "Stop-Loss",
    reference: "Referenz"
  })[value] || value || "Level";
}

function formatAmount(value, currency) {
  return [formatNumber(value), currency].filter(Boolean).join(" ");
}

function formatNumber(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return String(value || "—");
  }

  return new Intl.NumberFormat("de-DE", {
    maximumFractionDigits: 2
  }).format(number);
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
      startPercentage: (start / 360) * 100,
      segment: `${color} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`
    };
  });

  return {
    total,
    slices,
    background: `conic-gradient(${slices.map(slice => slice.segment).join(", ")})`
  };
}

function renderDonutSvg(chart, interactive = false) {
  const circles = chart.slices.map(slice => {
    const selected = selectedCompanyKey === slice.item.key;
    const attributes = interactive
      ? `role="button" tabindex="0" data-company-key="${escapeHtml(slice.item.key)}" aria-label="${escapeHtml(`${slice.item.company}: ${slice.value} Vorstellungen, ${Math.round(slice.percentage)} Prozent`)}"`
      : "aria-hidden=\"true\"";

    return `
      <circle
        class="donut-segment ${selected ? "is-selected" : ""}"
        cx="50"
        cy="50"
        r="43"
        pathLength="100"
        fill="none"
        stroke="${slice.color}"
        stroke-width="14"
        stroke-dasharray="${slice.percentage.toFixed(4)} ${(100 - slice.percentage).toFixed(4)}"
        stroke-dashoffset="${(-slice.startPercentage).toFixed(4)}"
        transform="rotate(-90 50 50)"
        ${attributes}
      ></circle>
    `;
  }).join("");

  return `
    <svg class="donut-svg" viewBox="0 0 100 100" aria-hidden="${interactive ? "false" : "true"}">
      <circle class="donut-track" cx="50" cy="50" r="43" pathLength="100" fill="none" stroke-width="14"></circle>
      ${circles}
    </svg>
  `;
}

function renderEmpty(title, text) {
  visibleVideos = [];
  visibleCompanyReports = [];
  selectedCompanyKey = null;
  selectedVideoId = null;
  closeReportInspector();
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
  const normalizedValue = /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))
    ? `${value}T12:00:00`
    : value;
  const date = new Date(normalizedValue);

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
