const API_URL = "http://localhost:3000";
const OUTCOME_CACHE_TTL_MS = 60_000;

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
const creatorOverview = document.getElementById("creatorOverview");
const creatorCount = document.getElementById("creatorCount");
const creatorList = document.getElementById("creatorList");

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
let creators = [];
let activeCreatorId = null;
let selectedCreatorId = null;
let selectedSector = null;
let selectedSubSector = null;
const outcomeCache = new Map();

document.addEventListener("DOMContentLoaded", () => {
  refreshButton.addEventListener("click", refreshPanel);
  companyDonut.addEventListener("click", handleCompanySelection);
  companyDonut.addEventListener("keydown", handleCompanyKeyboardSelection);
  companyLegend.addEventListener("click", handleCompanySelection);
  videoList.addEventListener("click", handleVideoReportSelection);
  reportInspector.addEventListener("click", handleInspectorClick);
  creatorList.addEventListener("click", handleCreatorSelection);
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

    creators = await getCreators();
    const activeCreator = currentMetadata
      ? await resolveCreator(currentMetadata)
      : null;
    activeCreatorId = activeCreator?.creatorId || null;

    if (activeCreatorId) {
      selectedCreatorId = activeCreatorId;
    } else if (!creators.some(creator => creator.creatorId === selectedCreatorId)) {
      selectedCreatorId = null;
    }

    renderCreatorOverview(creators);

    if (selectedCreatorId) {
      const dashboard = await getDashboard(selectedCreatorId);
      lastDashboard = { creatorId: selectedCreatorId, data: dashboard };
      renderDashboard(dashboard);
    } else {
      renderEmpty(
        creators.length ? "Creator auswählen" : "Noch keine Creator",
        creators.length
          ? "Wähle oben einen Creator für Report-Mix und Research Library."
          : "Analysiere ein YouTube-Video, um den ersten Creator anzulegen."
      );
    }

    if (currentError) {
      showStatus(friendlyError(currentError), true);
    }
  } catch (error) {
    console.error("Side panel error:", error);

    if (lastDashboard?.data) {
      selectedCreatorId = lastDashboard.creatorId;
      renderDashboard(lastDashboard.data);
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
    metadata: await getYouTubeMetadata(tab)
  };
}

async function ensureCurrentVideo(context) {
  showStatus("YouTube-Kanaldaten werden gelesen …");

  let metadata = context.metadata || await getYouTubeMetadata(context.tab);
  let research = await getStoredVideo(context.videoId);

  metadata = await enrichChannelMetadata(metadata, research);

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

async function enrichChannelMetadata(metadata, research) {
  const storedChannel = research?.video?.channel || null;
  const channelUrl = metadata?.channelUrl || storedChannel?.url || null;
  const fetchedTotalVideos = await requestChannelTotalVideos(channelUrl);

  return {
    ...metadata,
    title: metadata?.title || research?.video?.title || null,
    creator:
      metadata?.creator || storedChannel?.name || research?.video?.creator || null,
    channelUrl,
    channelAvatarUrl:
      metadata?.channelAvatarUrl || storedChannel?.avatar_url || null,
    subscriberCount:
      metadata?.subscriberCount || storedChannel?.subscriber_count || null,
    channelTotalVideos:
      fetchedTotalVideos ??
      normalizeVideoCount(metadata?.channelTotalVideos) ??
      normalizeVideoCount(storedChannel?.total_videos),
    channelId:
      metadata?.channelId || storedChannel?.youtube_channel_id || null,
    channelHandle:
      metadata?.channelHandle ||
      storedChannel?.handle ||
      getChannelHandle(channelUrl)
  };
}

async function requestChannelTotalVideos(channelUrl) {
  if (!channelUrl) {
    return null;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      action: "getChannelTotalVideos",
      channelUrl
    });

    if (!response?.ok) {
      return null;
    }

    return normalizeVideoCount(response.totalVideos);
  } catch (error) {
    console.warn("YouTube channel video count could not be requested:", error);
    return null;
  }
}

async function getCreators() {
  const response = await fetch(`${API_URL}/creators`);
  const data = await parseResponse(response);

  if (!response.ok) {
    throw new Error(data.error || "Creator Overview konnte nicht geladen werden.");
  }

  return Array.isArray(data.creators)
    ? data.creators.map(normalizeCreator).filter(creator => creator.creatorId)
    : [];
}

async function resolveCreator(metadata) {
  const params = new URLSearchParams();

  for (const [key, value] of [
    ["channelId", metadata.channelId],
    ["handle", metadata.channelHandle],
    ["channelUrl", metadata.channelUrl],
    ["name", metadata.creator]
  ]) {
    if (value) {
      params.set(key, value);
    }
  }

  if (!params.size) {
    return null;
  }

  const response = await fetch(`${API_URL}/creators/resolve?${params}`);
  if (response.status === 404) {
    return null;
  }

  const data = await parseResponse(response);
  if (!response.ok) {
    throw new Error(data.error || "Aktiver Creator konnte nicht erkannt werden.");
  }

  return data.creator ? normalizeCreator(data.creator) : null;
}

async function getDashboard(creatorId) {
  const response = await fetch(
    `${API_URL}/creators/${encodeURIComponent(creatorId)}/dashboard`
  );
  const data = await parseResponse(response);

  if (!response.ok) {
    throw new Error(data.error || "Creator-Dashboard konnte nicht geladen werden.");
  }

  return {
    totalVideos: Number(data.totalVideos) || 0,
    totalCompanies: Number(data.totalCompanies) || 0,
    totalReports: Number(data.totalReports) || 0,
    creator: data.creator ? normalizeCreator(data.creator) : null,
    channels: Array.isArray(data.channels) ? data.channels : [],
    companies: Array.isArray(data.companies) ? data.companies : [],
    videos: Array.isArray(data.videos) ? data.videos : []
  };
}

function normalizeCreator(creator) {
  return {
    creatorId: creator?.creatorId || creator?.creator_id || null,
    name: creator?.name || creator?.display_name || "Unbekannter Creator",
    url: creator?.url || creator?.channel_url || null,
    avatarUrl: creator?.avatarUrl || creator?.avatar_url || null,
    subscriberCount:
      creator?.subscriberCount || creator?.subscriber_count || null,
    totalVideos: normalizeVideoCount(
      creator?.totalVideos ?? creator?.total_videos
    ),
    analyzedVideos: normalizeVideoCount(
      creator?.analyzedVideos ?? creator?.analyzed_videos
    ) || 0,
    handle: creator?.handle || null,
    youtubeChannelId:
      creator?.youtubeChannelId || creator?.youtube_channel_id || null,
    unresolved: Boolean(creator?.unresolved)
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
      subscriberCount: data.subscriberCount || null,
      channelTotalVideos: normalizeVideoCount(data.channelTotalVideos),
      channelId: data.channelId || null,
      channelHandle: data.channelHandle || getChannelHandle(data.channelUrl)
    };
  } catch {
    return {
      title: tab.title?.replace(" - YouTube", "").trim() || null,
      creator: null,
      url: tab.url,
      publishedAt: null,
      channelUrl: null,
      channelAvatarUrl: null,
      subscriberCount: null,
      channelTotalVideos: null,
      channelId: null,
      channelHandle: null
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

function renderCreatorOverview(items) {
  creatorCount.textContent = `${items.length} ${items.length === 1 ? "Creator" : "Creators"}`;
  creatorList.innerHTML = items.map(creator => {
    const avatarUrl = safeUrl(creator.avatarUrl);
    const isSelected = creator.creatorId === selectedCreatorId;
    const isActive = creator.creatorId === activeCreatorId;
    const analyzed = formatVideoCount(creator.analyzedVideos);
    const total = creator.totalVideos === null
      ? "—"
      : formatVideoCount(creator.totalVideos);

    return `
      <button
        class="creator-card${isSelected ? " is-selected" : ""}"
        type="button"
        data-creator-id="${escapeHtml(creator.creatorId)}"
        aria-pressed="${isSelected}"
      >
        <span class="creator-card-avatar">
          <span>${escapeHtml(getInitials(creator.name))}</span>
          ${avatarUrl ? `<img src="${escapeHtml(avatarUrl)}" alt="">` : ""}
        </span>
        <span class="creator-card-copy">
          <span class="creator-card-name">${escapeHtml(creator.name)}</span>
          <span class="creator-card-meta">${escapeHtml(analyzed)}/${escapeHtml(total)} analysiert</span>
          ${isActive ? '<span class="creator-card-active">Aktueller Tab</span>' : ""}
        </span>
      </button>
    `;
  }).join("");

  creatorList.querySelectorAll(".creator-card-avatar img").forEach(image => {
    image.addEventListener("error", () => image.remove());
  });
  creatorOverview.classList.remove("hidden");
}

async function handleCreatorSelection(event) {
  const card = event.target.closest("[data-creator-id]");
  const creatorId = card?.dataset.creatorId;

  if (!creatorId || creatorId === selectedCreatorId || isRefreshing) {
    return;
  }

  selectedCreatorId = creatorId;
  selectedCompanyKey = null;
  selectedVideoId = null;
  selectedSector = null;
  selectedSubSector = null;
  setLoading(true);
  hideStatus();
  renderCreatorOverview(creators);
  dashboardElement.classList.add("hidden");

  try {
    const dashboard = await getDashboard(creatorId);
    lastDashboard = { creatorId, data: dashboard };
    renderDashboard(dashboard);
  } catch (error) {
    renderEmpty(
      "Creator-Dashboard nicht verfügbar",
      "Bitte Server-Routing prüfen und anschließend erneut auswählen."
    );
    showStatus(friendlyError(error), true);
  } finally {
    setLoading(false);
  }
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

  const channel = data.creator;

  if (!channel?.creatorId) {
    renderEmpty(
      "Creator nicht gefunden",
      "Das Dashboard enthält keine eindeutige Creator-Zuordnung."
    );
    return;
  }

  visibleVideos = data.videos;
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

function renderChannel(channel, data) {
  const name = channel?.name || "Research Library";
  const channelUrl = safeUrl(channel?.url);
  const avatarUrl = safeUrl(channel?.avatarUrl);
  const initials = getInitials(name);
  const subscribers = cleanSubscriberCount(channel?.subscriberCount);
  const storedAnalyzedVideos = normalizeVideoCount(channel?.analyzedVideos);
  const analyzedVideos = storedAnalyzedVideos ?? data.totalVideos;
  const totalVideos = normalizeVideoCount(channel?.totalVideos);
  const formattedAnalyzedVideos = formatVideoCount(analyzedVideos);
  const formattedTotalVideos = totalVideos === null
    ? "—"
    : formatVideoCount(totalVideos);
  const progressLabel = `${formattedAnalyzedVideos}/${formattedTotalVideos}`;
  const progressPercentage = totalVideos > 0
    ? Math.min(100, (analyzedVideos / totalVideos) * 100)
    : 0;
  const progressDescription = totalVideos === null
    ? `${formattedAnalyzedVideos} Videos analysiert; Gesamtzahl noch nicht verfügbar`
    : `${formattedAnalyzedVideos} von ${formattedTotalVideos} Videos analysiert`;

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
        <strong class="stat-value">${escapeHtml(formattedTotalVideos)}</strong>
        <span class="stat-label">Gesamte Anzahl Videos</span>
      </div>
      <div class="stat stat-progress" aria-label="${escapeHtml(progressDescription)}">
        <div class="stat-progress-copy">
          <strong class="stat-value">${escapeHtml(progressLabel)}</strong>
          <span class="stat-label">Analysierte Videos</span>
        </div>
        <div class="analysis-progress" aria-hidden="true">
          <span style="width: ${progressPercentage.toFixed(2)}%;${progressPercentage > 0 ? " min-width: 2px;" : ""}"></span>
        </div>
      </div>
    </div>
  `;

  const avatar = channelProfile.querySelector(".channel-avatar img");

  avatar?.addEventListener("error", () => {
    avatar.remove();
  });
}


function buildCompanyReports(videos) {
  const companies = new Map();

  for (const video of videos) {
    for (const [companyIndex, report] of (Array.isArray(video.companies) ? video.companies : []).entries()) {
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
          sector: report.sector || "Other",
          subSector: report.sub_sector || report.subSector || "Unclassified Assets",
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
        companyIndex,
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

function buildReportMixGroups(companies, field, kind) {
  const groups = new Map();

  for (const company of companies) {
    const label = String(company[field] || "Other").trim() || "Other";

    if (!groups.has(label)) {
      groups.set(label, {
        key: `${kind}:${normalizeIdentity(label)}`,
        kind,
        label,
        company: label,
        weight: 0,
        companies: []
      });
    }

    const group = groups.get(label);
    group.weight += company.weight;
    group.companies.push(company);
  }

  return [...groups.values()].sort(
    (left, right) => right.weight - left.weight || left.label.localeCompare(right.label)
  );
}

function getReportMixView(companies) {
  if (!selectedSector) {
    return {
      level: "sector",
      items: buildReportMixGroups(companies, "sector", "sector")
    };
  }

  const sectorCompanies = companies.filter(company => company.sector === selectedSector);

  if (!selectedSubSector) {
    return {
      level: "subsector",
      items: buildReportMixGroups(sectorCompanies, "subSector", "subsector")
    };
  }

  return {
    level: "company",
    items: sectorCompanies.filter(company => company.subSector === selectedSubSector)
  };
}

function renderReportMixNavigation(level) {
  if (level === "sector") {
    return '<div class="report-mix-nav"><span>Sektoren</span><small>Klicken zum Aufklappen</small></div>';
  }

  const parentLabel = level === "company" ? selectedSubSector : selectedSector;
  return `
    <div class="report-mix-nav">
      <button type="button" data-report-mix-back aria-label="Eine Ebene zurück">← Zurück</button>
      <span>${escapeHtml(parentLabel || "Report-Mix")}</span>
    </div>
  `;
}

function renderCompanyAllocation(companies) {
  const view = getReportMixView(companies);
  const chart = buildDonut(view.items, item => item.weight);

  companyDonut.style.background = "none";
  companyDonut.title = view.level === "company"
    ? "Klicke auf ein Unternehmen, um alle zugehörigen Video-Reports zu lesen."
    : "Klicke auf ein Segment, um die nächste Report-Mix-Ebene zu öffnen.";
  companyDonut.innerHTML = `
    ${renderDonutSvg(chart, true)}
    <div class="donut-center">
      <strong class="donut-value">${chart.total}</strong>
      <span class="donut-label">Vorstellungen</span>
    </div>
  `;

  companyLegend.innerHTML = `
    ${renderReportMixNavigation(view.level)}
    ${chart.slices.length
      ? chart.slices.map(slice => {
        const item = slice.item;
        const isCompany = view.level === "company";
        const dataAttributes = isCompany
          ? `data-company-key="${escapeHtml(item.key)}"`
          : `data-report-mix-level="${escapeHtml(view.level)}" data-report-mix-key="${escapeHtml(item.label)}"`;
        const label = isCompany ? (item.ticker || item.company) : item.label;
        const context = isCompany
          ? `${item.company}: ${slice.value} von ${visibleVideos.length} analysierten Videos`
          : `${item.label}: ${slice.value} Vorstellungen`;

        return `
      <button
        class="legend-item ${selectedCompanyKey === slice.item.key ? "is-selected" : ""}"
        type="button"
        ${dataAttributes}
        title="${escapeHtml(context)}"
      >
        <span class="legend-dot" style="background:${slice.color}"></span>
        <span class="legend-name">${escapeHtml(label)}</span>
        <span class="legend-value">${slice.value}× · ${Math.round(slice.percentage)}%</span>
      </button>
    `;
      }).join("")
      : '<div class="legend-more">Keine Einträge auf dieser Ebene</div>'}
  `;
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
              <a href="${escapeHtml(videoUrl)}" data-video-report="${escapeHtml(video.id)}" data-open-video>${escapeHtml(title)}</a>
            </h2>
          </div>

          <a
            class="donut donut-mini"
            href="${escapeHtml(videoUrl)}"
            data-video-report="${escapeHtml(video.id)}"
            data-open-video
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
  if (company.ticker) {
    return `ticker:${normalizeIdentity(company.ticker)}`;
  }

  const assetType = normalizeIdentity(company.asset_type || "other");
  return `${assetType}:${normalizeIdentity(company.company)}`;
}

function handleCompanySelection(event) {
  const backTrigger = event.target.closest("[data-report-mix-back]");

  if (backTrigger) {
    if (selectedSubSector) {
      selectedSubSector = null;
    } else {
      selectedSector = null;
    }

    selectedCompanyKey = null;
    closeReportInspector();
    renderCompanyAllocation(visibleCompanyReports);
    return;
  }

  const mixTrigger = event.target.closest("[data-report-mix-key]");

  if (mixTrigger) {
    if (mixTrigger.dataset.reportMixLevel === "sector") {
      selectedSector = mixTrigger.dataset.reportMixKey;
      selectedSubSector = null;
    } else if (mixTrigger.dataset.reportMixLevel === "subsector") {
      selectedSubSector = mixTrigger.dataset.reportMixKey;
    }

    selectedCompanyKey = null;
    closeReportInspector();
    renderCompanyAllocation(visibleCompanyReports);
    return;
  }

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

  const trigger = event.target.closest("[data-company-key], [data-report-mix-key]");

  if (!trigger) {
    return;
  }

  event.preventDefault();
  trigger.click();
}

function handleVideoReportSelection(event) {
  if (retryOutcome(event)) {
    return;
  }

  const companyTrigger = event.target.closest("[data-company-key]");

  if (companyTrigger) {
    selectCompanyReport(companyTrigger.dataset.companyKey);
    return;
  }

  const reportTrigger = event.target.closest("[data-video-report]");

  if (reportTrigger) {
    event.preventDefault();
    selectedCompanyKey = null;
    selectedVideoId = reportTrigger.dataset.videoReport;
    renderCompanyAllocation(visibleCompanyReports);
    renderVideoInspector(selectedVideoId);
    openOrFocusVideo(reportTrigger.href).catch(error => {
      showStatus(friendlyError(error), true);
    });
    return;
  }

  const videoTrigger = event.target.closest("[data-open-video]");

  if (videoTrigger) {
    event.preventDefault();
    openOrFocusVideo(videoTrigger.href).catch(error => {
      showStatus(friendlyError(error), true);
    });
  }

  if (event.target.closest("summary")) {
    window.setTimeout(hydrateOpenOutcomeCards, 0);
  }
}

function handleInspectorClick(event) {
  if (retryOutcome(event)) {
    return;
  }

  if (event.target.closest("[data-close-inspector]")) {
    selectedCompanyKey = null;
    selectedVideoId = null;
    renderCompanyAllocation(visibleCompanyReports);
    closeReportInspector();
    return;
  }

  const videoTrigger = event.target.closest("[data-open-video]");

  if (videoTrigger) {
    event.preventDefault();
    openOrFocusVideo(videoTrigger.href).catch(error => {
      showStatus(friendlyError(error), true);
    });
  }

  if (event.target.closest("summary")) {
    window.setTimeout(hydrateOpenOutcomeCards, 0);
  }
}

function retryOutcome(event) {
  const trigger = event.target.closest("[data-retry-outcome]");

  if (!trigger) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  const card = trigger.closest("[data-outcome-card]");
  if (!card) {
    return true;
  }

  const key = `${card.dataset.videoId}:${card.dataset.companyIndex}`;
  outcomeCache.delete(key);
  card.dataset.loaded = "false";
  card.className = "outcome-card is-loading";
  card.textContent = "Marktdaten werden erneut geladen …";
  hydrateOpenOutcomeCards();
  return true;
}

async function openOrFocusVideo(videoUrl) {
  const response = await chrome.runtime.sendMessage({
    action: "openOrFocusVideo",
    videoUrl
  });

  if (!response?.ok) {
    throw new Error(response?.error || "YouTube-Tab konnte nicht geöffnet werden.");
  }

  return response;
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

  const inspectorMarkup = `
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
  replaceChildrenFromEscapedMarkup(reportInspector, inspectorMarkup);

  openReportInspector();
  hydrateOpenOutcomeCards();
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

  const inspectorMarkup = `
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
      <a href="${escapeHtml(videoUrl)}" data-open-video>Video öffnen ↗</a>
    </div>

    ${video.summary
      ? `<section class="report-summary"><h3>Zusammenfassung</h3><p>${escapeHtml(video.summary)}</p></section>`
      : ""}

    <div class="report-stack">
      ${companies.length
        ? companies.map((report, index) => renderCompanyReport(report, index, video.id)).join("")
        : '<p class="report-empty">Keine Unternehmen erkannt.</p>'}
    </div>
  `;
  replaceChildrenFromEscapedMarkup(reportInspector, inspectorMarkup);

  openReportInspector();
  hydrateOpenOutcomeCards();
}

function renderPresentationReport(presentation, index) {
  const { video, report } = presentation;
  const videoUrl = safeUrl(video.url) ||
    `https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`;

  return `
    <details class="report-entry" data-outcome-video="${escapeHtml(video.id)}" data-outcome-company="${presentation.companyIndex}" ${index === 0 ? "open" : ""}>
      <summary>
        <span>${escapeHtml(video.title || "Unbenanntes Video")}</span>
        <small>${escapeHtml(formatDate(presentation.presentedAt))}</small>
      </summary>
      <div class="report-entry-body">
        ${renderOutcomePlaceholder(video.id, presentation.companyIndex)}
        <a class="report-video-link" href="${escapeHtml(videoUrl)}" data-open-video>Video öffnen ↗</a>
        ${video.summary ? `<p class="report-context">${escapeHtml(video.summary)}</p>` : ""}
        ${renderCompanyReportContent(report)}
      </div>
    </details>
  `;
}

function renderCompanyReport(report, index, videoId) {
  return `
    <details class="report-entry" data-outcome-video="${escapeHtml(videoId)}" data-outcome-company="${index}" ${index === 0 ? "open" : ""}>
      <summary>
        <span class="report-entry-identity">
          <span class="report-company-name">${escapeHtml(report.company || "Unternehmen")}</span>
          ${report.ticker ? `<span class="ticker-badge">${escapeHtml(report.ticker)}</span>` : ""}
          ${renderCallTypeBadge(report.call_type)}
          ${renderSentimentBadge(report.sentiment)}
        </span>
      </summary>
      <div class="report-entry-body">${renderOutcomePlaceholder(videoId, index)}${renderCompanyReportContent(report)}</div>
    </details>
  `;
}

function renderOutcomePlaceholder(videoId, companyIndex) {
  return `<section class="outcome-card is-loading" data-outcome-card data-video-id="${escapeHtml(videoId)}" data-company-index="${companyIndex}">Marktdaten werden geladen …</section>`;
}

async function hydrateOpenOutcomeCards() {
  const cards = [...reportInspector.querySelectorAll("details[open] [data-outcome-card]")];

  for (const card of cards) {
    if (["true", "loading"].includes(card.dataset.loaded)) continue;
    card.dataset.loaded = "loading";
    const key = `${card.dataset.videoId}:${card.dataset.companyIndex}`;

    try {
      const cached = outcomeCache.get(key);
      let outcome = cached && cached.expiresAt > Date.now()
        ? cached.outcome
        : null;
      if (!outcome) {
        outcomeCache.delete(key);
        const response = await fetch(`${API_URL}/videos/${encodeURIComponent(card.dataset.videoId)}/companies/${card.dataset.companyIndex}/outcome`);
        outcome = await parseResponse(response);
        if (!response.ok) {
          const error = new Error(outcome.error || "Marktdaten nicht verfügbar.");
          error.code = outcome.code;
          error.retryable = Boolean(outcome.retryable);
          error.retryAfterSeconds = outcome.retry_after_seconds;
          throw error;
        }
        if (outcome.status !== "partial") {
          outcomeCache.set(key, {
            expiresAt: Date.now() + OUTCOME_CACHE_TTL_MS,
            outcome
          });
        }
      }

      const returnNumber = normalizeOutcomeReturn(outcome);
      card.className = `outcome-card ${
        returnNumber === null
          ? "is-lifecycle"
          : returnNumber >= 0
            ? "is-positive"
            : "is-negative"
      }`;
      renderOutcomeCard(card, outcome);
      card.dataset.loaded = "true";
    } catch (error) {
      card.className = "outcome-card is-unavailable";
      if (error.code === "PROVIDER_RATE_LIMIT") {
        const retryAfter = Number(error.retryAfterSeconds) || 60;
        renderOutcomeRetry(
          card,
          `API-Limit erreicht · in etwa ${retryAfter} Sekunden erneut versuchen.`,
          "Erneut versuchen"
        );
      } else if (error.retryable) {
        renderOutcomeRetry(
          card,
          "Marktdaten derzeit nicht verfügbar.",
          "Erneut versuchen"
        );
      } else {
        card.textContent = error.message || "Marktdaten nicht verfügbar.";
      }
      card.dataset.loaded = "true";
    }
  }
}

function renderOutcomeCard(card, outcome) {
  const currency = outcome.currency || "";
  const isLifecyclePending = outcome.status === "instrument_lifecycle_pending";
  const heading = isLifecyclePending
    ? "Instrument-Lifecycle offen"
    : outcome.performance_eligible
    ? "Performance seit Call"
    : "Marktverlauf seit Erwähnung";
  const returnNumber = normalizeOutcomeReturn(outcome);
  const returnValue = returnNumber === null
    ? "Kontinuität prüfen"
    : `${returnNumber >= 0 ? "+" : ""}${formatNumber(returnNumber)} %`;

  const advancedMetrics = [
    outcome.peak_return_pct != null
      ? `Peak ${formatNumber(outcome.peak_return_pct)} %`
      : null,
    outcome.max_drawdown_pct != null
      ? `Drawdown ${formatNumber(outcome.max_drawdown_pct)} %`
      : null,
    outcome.benchmark
      ? `Alpha ${formatNumber(outcome.benchmark.alpha_pct_points)} pp`
      : null
  ].filter(Boolean);

  card.replaceChildren();

  const headingElement = document.createElement("div");
  headingElement.className = "outcome-heading";
  appendTextElement(headingElement, "span", heading);
  appendTextElement(headingElement, "small", formatOutcomeSymbol(outcome));
  card.append(headingElement);

  const prices = document.createElement("div");
  prices.className = "outcome-prices";
  appendOutcomePrice(
    prices,
    "Damals",
    isLifecyclePending && outcome.price_at_video == null
      ? outcome.symbol_at_video || "—"
      : formatAmount(outcome.price_at_video, currency),
    outcome.price_at_video_timestamp
  );
  appendOutcomePrice(
    prices,
    "Aktuell",
    isLifecyclePending && outcome.current_price == null
      ? outcome.current_symbol || "Symbol offen"
      : formatAmount(outcome.current_price, currency),
    outcome.current_price_timestamp
  );
  appendOutcomePrice(prices, "Rendite", returnValue);
  card.append(prices);

  if (advancedMetrics.length || !isLifecyclePending) {
    const metrics = document.createElement("div");
    metrics.className = "outcome-metrics";
    const metricValues = advancedMetrics.length
      ? advancedMetrics
      : ["Erweiterte Kennzahlen werden nach dem Provider-Limit nachgeladen."];
    for (const value of metricValues) {
      appendTextElement(metrics, "span", value);
    }
    card.append(metrics);
  }

  if (outcome.status === "partial") {
    appendOutcomeWarning(
      card,
      "Teilresultat: Live-Preis vorhanden, einzelne Historien-/Benchmarkdaten temporär limitiert.",
      "Nach 60 Sekunden erneut versuchen"
    );
  } else if (outcome.status === "stale") {
    appendOutcomeWarning(
      card,
      "Gespeicherter letzter Stand · Live-Aktualisierung wartet auf den API-Reset.",
      "Erneut versuchen"
    );
  } else if (isLifecyclePending) {
    appendOutcomeWarning(
      card,
      "Symbolwechsel erkannt. Performance wird erst berechnet, wenn die wirtschaftliche Kontinuität geprüft ist."
    );
  }
}

function normalizeOutcomeReturn(outcome) {
  if (outcome.current_return_pct === null || outcome.current_return_pct === undefined) {
    return null;
  }

  const number = Number(outcome.current_return_pct);
  return Number.isFinite(number) ? number : null;
}

function formatOutcomeSymbol(outcome) {
  const from = outcome.symbol_at_video;
  const to = outcome.current_symbol;

  if (from && to && from !== to) {
    return `${from} → ${to}`;
  }

  return outcome.ticker || from || to || "";
}

function appendTextElement(parent, tagName, value) {
  const element = document.createElement(tagName);
  element.textContent = String(value ?? "");
  parent.append(element);
  return element;
}

function appendOutcomePrice(parent, label, amount, timestamp = null) {
  const column = document.createElement("div");
  appendTextElement(column, "span", label);
  appendTextElement(column, "strong", amount);
  if (timestamp) {
    const time = appendTextElement(column, "time", formatDateTime(timestamp));
    time.dateTime = String(timestamp);
  }
  parent.append(column);
}

function appendOutcomeWarning(card, message, buttonLabel) {
  const warning = document.createElement("div");
  warning.className = "outcome-warning";
  warning.append(document.createTextNode(message));
  if (buttonLabel) {
    warning.append(document.createTextNode(" "));
    warning.append(createOutcomeRetryButton(buttonLabel));
  }
  card.append(warning);
}

function renderOutcomeRetry(card, message, buttonLabel) {
  card.replaceChildren(
    document.createTextNode(`${message} `),
    createOutcomeRetryButton(buttonLabel)
  );
}

function createOutcomeRetryButton(label) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.retryOutcome = "";
  button.textContent = label;
  return button;
}

function renderCompanyReportContent(report) {
  const structuredTargets = Array.isArray(report.price_targets)
    ? report.price_targets.filter(hasUsableStructuredValue)
    : [];
  const priceTargets = structuredTargets.length
    ? structuredTargets
    : hasUsableStructuredValue({ value: report.price_target })
      ? [{
          value: report.price_target,
          currency: report.price_target_currency || report.currency || null,
          context: null,
          source: null
        }]
      : [];
  const levels = Array.isArray(report.levels)
    ? report.levels.filter(hasUsableStructuredValue)
    : [];
  const evidence = Array.isArray(report.evidence)
    ? report.evidence.filter(hasMeaningfulText)
    : [];
  const thesis = hasMeaningfulText(report.thesis) ? report.thesis.trim() : null;
  const facts = [
    report.action && report.action !== "none" ? ["Aktion", actionLabel(report.action)] : null,
    report.asset_type ? ["Asset", report.asset_type.toUpperCase()] : null,
    report.sector ? ["Sektor", report.sector] : null,
    report.sub_sector ? ["Sub-Sektor", report.sub_sector] : null,
    report.time_horizon ? ["Zeithorizont", report.time_horizon] : null,
    report.confidence != null && Number.isFinite(Number(report.confidence))
      ? ["Konfidenz", `${Math.round(Number(report.confidence) * 100)} %`]
      : null,
    report.mentioned_move_pct != null && Number.isFinite(Number(report.mentioned_move_pct))
      ? ["Genannte Bewegung", `${formatNumber(report.mentioned_move_pct)} %`]
      : null
  ].filter(Boolean);

  return `
    <div class="report-call-row">
      <span>Call-Typ</span>
      <span class="report-call-value">
        ${renderCallTypeBadge(report.call_type)}
        ${report.performance_eligible ? '<small>Performance-Tracking aktiv</small>' : '<small>Kein Performance-Tracking</small>'}
      </span>
    </div>
    ${report.sentiment
      ? `<div class="report-sentiment-row"><span>Sentiment</span>${renderSentimentBadge(report.sentiment)}</div>`
      : ""}
    ${facts.length
      ? `<div class="report-facts">${facts.map(([label, value]) => `
          <div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
        `).join("")}</div>`
      : ""}
    ${thesis
      ? `<section class="report-section"><h4>Investment-These</h4><p>${escapeHtml(thesis)}</p></section>`
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

function hasUsableStructuredValue(item) {
  return Boolean(item) &&
    item.value !== null &&
    item.value !== undefined &&
    item.value !== "" &&
    Number.isFinite(Number(item.value));
}

function hasMeaningfulText(value) {
  if (typeof value !== "string") {
    return false;
  }

  const text = value.trim();
  return Boolean(text) && !/^[#*_~`\-–—.\s]+$/u.test(text);
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
  reportInspector.replaceChildren();
}

function replaceChildrenFromEscapedMarkup(element, markup) {
  const parsed = new DOMParser().parseFromString(String(markup), "text/html");
  const fragment = document.createDocumentFragment();
  for (const child of parsed.body.childNodes) {
    fragment.append(document.importNode(child, true));
  }
  element.replaceChildren(fragment);
}

function sentimentLabel(value) {
  return ({ bull: "Bullish", neutral: "Neutral", bear: "Bearish" })[value] || "Neutral";
}

function renderSentimentBadge(value) {
  const sentiment = ["bull", "neutral", "bear"].includes(value)
    ? value
    : "neutral";
  return `<span class="sentiment-badge sentiment-${sentiment}">${escapeHtml(sentimentLabel(sentiment))}</span>`;
}

function callTypeLabel(value) {
  return ({
    mention: "Mention",
    view: "View",
    actionable: "Actionable",
    targeted: "Targeted"
  })[value] || "Mention";
}

function renderCallTypeBadge(value) {
  const callType = ["mention", "view", "actionable", "targeted"].includes(value)
    ? value
    : "mention";
  return `<span class="call-type-badge call-type-${callType}">${escapeHtml(callTypeLabel(callType))}</span>`;
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
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  return [formatNumber(value), currency].filter(Boolean).join(" ");
}

function formatNumber(value) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

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
    const itemLabel = slice.item.label || slice.item.company;
    const dataAttributes = slice.item.kind
      ? `data-report-mix-level="${escapeHtml(slice.item.kind === "sector" ? "sector" : "subsector")}" data-report-mix-key="${escapeHtml(slice.item.label)}"`
      : `data-company-key="${escapeHtml(slice.item.key)}"`;
    const attributes = interactive
      ? `role="button" tabindex="0" ${dataAttributes} aria-label="${escapeHtml(`${itemLabel}: ${slice.value} Vorstellungen, ${Math.round(slice.percentage)} Prozent`)}"`
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

function normalizeVideoCount(value) {
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

function formatVideoCount(value) {
  const count = normalizeVideoCount(value);

  return count === null
    ? "—"
    : new Intl.NumberFormat("de-DE").format(count);
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

function formatDateTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Zeitpunkt unbekannt";
  }

  return `${new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Europe/Zurich"
  }).format(date)} Zürich`;
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

function getChannelHandle(value) {
  try {
    const segment = new URL(value).pathname.split("/").filter(Boolean)[0];
    return segment?.startsWith("@") ? segment : null;
  } catch {
    return null;
  }
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
