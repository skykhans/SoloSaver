window.api = {
  listTasks: () => getJson("/api/tasks"),
  addBatch: (inputText) => postJson("/api/tasks/add-batch", { inputText }),
  readClipboardText: async () => ({ text: await navigator.clipboard.readText().catch(() => "") }),
  getTaskMediaPreview: (taskId) => getJson(`/api/tasks/${taskId}/media-preview`)
};

function getJson(url) {
  return fetch(url).then((r) => r.json());
}

function postJson(url, body = {}) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then((r) => r.json());
}

const state = {
  tasks: [],
  selectedTaskId: null,
  activePreviewTab: "video",
  activeVideoIndex: 0,
  mediaPreviewCache: new Map(),
  imageGridExpanded: false,
  taskFilter: "all",
  activeView: "preview"
};

const el = {
  viewTabs: document.querySelectorAll(".view-tab"),
  viewPanels: document.querySelectorAll("[data-view-panel]"),
  batchInput: document.querySelector("#batch-input"),
  addBatchBtn: document.querySelector("#add-batch-btn"),
  pasteBtn: document.querySelector("#paste-btn"),
  clearInputBtn: document.querySelector("#clear-input-btn"),
  copyLinkBtn: document.querySelector("#copy-link-btn"),
  downloadVideoBtn: document.querySelector("#download-video-btn"),
  downloadAllVideosBtn: document.querySelector("#download-all-videos-btn"),
  downloadAllImagesBtn: document.querySelector("#download-all-images-btn"),
  previewTitle: document.querySelector("#preview-title"),
  previewSubtitle: document.querySelector("#preview-subtitle"),
  previewStatus: document.querySelector("#preview-status"),
  previewUrl: document.querySelector("#preview-url"),
  mediaStage: document.querySelector("#media-stage"),
  videoList: document.querySelector("#video-list"),
  previewVideo: document.querySelector("#preview-video"),
  previewThumb: document.querySelector("#preview-thumb"),
  playIndicator: document.querySelector("#play-indicator"),
  imageGrid: document.querySelector("#image-grid"),
  toggleImagesBtn: document.querySelector("#toggle-images-btn"),
  tabVideo: document.querySelector("#tab-video"),
  tabImage: document.querySelector("#tab-image"),
  fileMeta: document.querySelector("#file-meta"),
  imageModal: document.querySelector("#image-modal"),
  imageModalImg: document.querySelector("#image-modal-img"),
  imageModalClose: document.querySelector("#image-modal-close"),
  imageModalCaption: document.querySelector("#image-modal-caption"),
  tbody: document.querySelector("#task-tbody"),
  taskStats: document.querySelector("#task-stats"),
  filterAll: document.querySelector("#filter-all"),
  filterFailed: document.querySelector("#filter-failed")
};

async function init() {
  bindEvents();
  renderFilterButtons();
  await loadInitialData();
}

function bindEvents() {
  el.viewTabs.forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view || "preview"));
  });

  el.addBatchBtn.addEventListener("click", async () => {
    const text = el.batchInput.value.trim();
    if (!text) return;
    setBusy(el.addBatchBtn, true, "提取中...");
    try {
      const result = await window.api.addBatch(text);
      if (result?.error) {
        alert(result.error);
        return;
      }
      el.batchInput.value = "";
      await loadTasks();
      if (result.tasks?.length) {
        state.selectedTaskId = result.tasks[0].id;
        state.activeVideoIndex = 0;
        renderPreview();
      }
    } finally {
      setBusy(el.addBatchBtn, false, "开始提取");
    }
  });

  el.pasteBtn.addEventListener("click", async () => {
    const result = await window.api.readClipboardText();
    const text = String(result?.text || "").trim();
    if (!text) {
      alert("剪贴板为空");
      return;
    }
    el.batchInput.value = [text, el.batchInput.value].filter(Boolean).join("\n").trim();
  });

  el.clearInputBtn.addEventListener("click", () => {
    el.batchInput.value = "";
  });

  [el.filterAll, el.filterFailed].forEach((btn) => {
    if (!btn) return;
    btn.addEventListener("click", () => {
      state.taskFilter = btn.dataset.filter || "all";
      renderFilterButtons();
      renderTasks();
    });
  });

  el.tabVideo.addEventListener("click", () => switchPreviewTab("video"));
  el.tabImage.addEventListener("click", () => switchPreviewTab("image"));
  el.toggleImagesBtn.addEventListener("click", () => {
    state.imageGridExpanded = !state.imageGridExpanded;
    renderMediaPreviewForSelected();
  });
  el.imageModalClose.addEventListener("click", closeImageModal);
  el.imageModal.addEventListener("click", (event) => {
    if (event.target === el.imageModal) closeImageModal();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeImageModal();
  });
  el.previewVideo.addEventListener("loadedmetadata", () => {
    if (Number.isFinite(el.previewVideo.duration) && el.previewVideo.duration > 0) {
      el.previewStatus.textContent = formatDuration(el.previewVideo.duration);
    }
    markMediaDimensionsByUrl(
      state.selectedTaskId,
      el.previewVideo.currentSrc || el.previewVideo.src,
      el.previewVideo.videoWidth,
      el.previewVideo.videoHeight
    );
  });
  el.previewThumb.addEventListener("load", () => {
    markMediaDimensionsByUrl(
      state.selectedTaskId,
      el.previewThumb.currentSrc || el.previewThumb.src,
      el.previewThumb.naturalWidth,
      el.previewThumb.naturalHeight
    );
  });

  el.copyLinkBtn.addEventListener("click", async () => {
    const task = getSelectedTask();
    const link = task?.finalUrl || task?.shortUrl || "";
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
    } catch (_error) {
      alert("复制失败，请手动复制");
    }
  });

  el.downloadVideoBtn.addEventListener("click", () => {
    const media = state.mediaPreviewCache.get(state.selectedTaskId) || { videos: [] };
    const video = media.videos?.[state.activeVideoIndex] || media.videos?.[0];
    if (video) downloadMediaItem(video);
  });

  el.downloadAllVideosBtn.addEventListener("click", () => {
    const media = state.mediaPreviewCache.get(state.selectedTaskId) || { videos: [] };
    if (!media.videos?.length) return;
    media.videos.forEach((item, i) => setTimeout(() => downloadMediaItem(item), i * 300));
  });

  el.downloadAllImagesBtn.addEventListener("click", () => {
    const media = state.mediaPreviewCache.get(state.selectedTaskId) || { images: [], thumbnails: [] };
    const images = media.images.length ? media.images : media.thumbnails;
    if (!images.length) return;
    images.forEach((item, i) => setTimeout(() => downloadMediaItem(item), i * 250));
  });
}

function setBusy(button, busy, text) {
  button.disabled = busy;
  button.textContent = text;
}

function switchView(view) {
  state.activeView = view;
  el.viewTabs.forEach((btn) => btn.classList.toggle("active", btn.dataset.view === view));
  el.viewPanels.forEach((panel) => panel.classList.toggle("hidden", panel.dataset.viewPanel !== view));
}

async function loadInitialData() {
  await loadTasks();
  renderPreview();
}

async function loadTasks() {
  state.tasks = await window.api.listTasks();
  state.mediaPreviewCache.clear();
  if (state.tasks.length && !state.tasks.some((t) => t.id === state.selectedTaskId)) {
    state.selectedTaskId = state.tasks[0].id;
    state.activeVideoIndex = 0;
  }
  renderTasks();
  renderPreview();
}

function renderTasks() {
  el.tbody.innerHTML = "";

  const stats = { total: state.tasks.length, extracted: 0, failed: 0 };
  for (const t of state.tasks) stats[t.status] = (stats[t.status] || 0) + 1;
  el.taskStats.textContent = `总计 ${stats.total} | 已提取 ${stats.extracted} | 失败 ${stats.failed}`;

  const visibleTasks = state.tasks.filter(matchesTaskFilter);
  for (const task of visibleTasks) {
    const tr = document.createElement("tr");
    if (task.id === state.selectedTaskId) tr.classList.add("selected");

    tr.innerHTML = `
      <td>
        <div class="task-id-status">
          <span class="id-badge">#${task.id}</span>
          ${statusChip(task.status)}
        </div>
      </td>
      <td>
        <div class="cell-wrap cell-title" title="${esc(task.title || "(未解析标题)")}">
          <strong>${esc(task.title || "(未解析标题)")}</strong>
        </div>
        <div class="cell-wrap cell-sub" title="${esc(task.rawText || "")}">${esc((task.rawText || "").slice(0, 140))}</div>
        ${task.error ? `<div class="cell-wrap error-cell" title="${esc(task.error)}">${esc(task.error)}</div>` : ""}
      </td>
    `;

    tr.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      state.selectedTaskId = task.id;
      state.activeVideoIndex = 0;
      renderTasks();
      renderPreview();
      switchView("preview");
    });
    el.tbody.appendChild(tr);
  }
}

function renderFilterButtons() {
  [el.filterAll, el.filterFailed].forEach((btn) => {
    if (!btn) return;
    btn.classList.toggle("active", btn.dataset.filter === state.taskFilter);
  });
}

function matchesTaskFilter(task) {
  switch (state.taskFilter) {
    case "failed":
      return task.status === "failed";
    case "all":
    default:
      return true;
  }
}

function renderPreview() {
  const task = getSelectedTask();
  if (!task) {
    el.previewTitle.textContent = "资源标题预览";
    el.previewSubtitle.textContent = "等待导入分享文本...";
    el.previewStatus.textContent = "未开始";
    el.previewUrl.textContent = "等待解析链接...";
    clearMediaPreview();
    el.downloadVideoBtn.disabled = true;
    el.downloadAllVideosBtn.disabled = true;
    el.downloadAllImagesBtn.disabled = true;
    updateActionButtons({ videos: [], images: [], thumbnails: [] });
    el.copyLinkBtn.disabled = true;
    return;
  }

  el.previewTitle.textContent = task.title || "未解析标题";
  el.previewSubtitle.textContent = `${labelStatus(task.status)} · ${task.platform || "未知平台"}`;
  el.previewStatus.textContent = labelStatus(task.status);
  el.previewUrl.textContent = task.finalUrl || task.shortUrl || "未解析到链接";
  const media = state.mediaPreviewCache.get(task.id) || { videos: [], images: [], thumbnails: [] };
  el.downloadVideoBtn.disabled = !(media.videos?.length);
  el.downloadAllVideosBtn.disabled = !(media.videos?.length);
  el.downloadAllImagesBtn.disabled = !(media.images.length || media.thumbnails.length);
  el.copyLinkBtn.disabled = !(task.finalUrl || task.shortUrl);
  updateActionButtons(media);
  loadAndRenderMediaPreview(task.id);
}

function getSelectedTask() {
  return state.tasks.find((t) => t.id === state.selectedTaskId) || null;
}

function statusChip(status) {
  return `<span class="status-chip status-${esc(status)}">${esc(labelStatus(status))}</span>`;
}

function labelStatus(status) {
  return {
    extracted: "已提取",
    failed: "失败"
  }[status] || status;
}

function switchPreviewTab(tab) {
  state.activePreviewTab = tab;
  el.tabVideo.classList.toggle("active", tab === "video");
  el.tabImage.classList.toggle("active", tab === "image");
  renderMediaPreviewForSelected();
}

async function loadAndRenderMediaPreview(taskId) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) {
    clearMediaPreview();
    return;
  }
  if (!state.mediaPreviewCache.has(taskId)) {
    try {
      const media = await window.api.getTaskMediaPreview(taskId);
      state.mediaPreviewCache.set(taskId, media || { videos: [], images: [], thumbnails: [] });
    } catch (_error) {
      state.mediaPreviewCache.set(taskId, { videos: [], images: [], thumbnails: [] });
    }
  }
  if (state.selectedTaskId === taskId) {
    maybeAutoSwitchTab(taskId);
    renderMediaPreviewForSelected();
  }
}

function renderMediaPreviewForSelected() {
  const task = getSelectedTask();
  if (!task) {
    clearMediaPreview();
    return;
  }
  const media = state.mediaPreviewCache.get(task.id) || { videos: [], images: [], thumbnails: [] };
  const thumb = media.thumbnails[0] || media.images[0] || null;
  const video = media.videos[0] || null;
  renderFileMeta(media, task);
  el.downloadVideoBtn.disabled = !video;
  el.downloadAllVideosBtn.disabled = !(media.videos?.length);
  el.downloadAllImagesBtn.disabled = !(media.images.length || media.thumbnails.length);
  updateActionButtons(media);

  if (state.activePreviewTab === "video") {
    el.imageGrid.innerHTML = "";
    el.imageGrid.classList.add("hidden");
    el.mediaStage.classList.remove("hidden");
    renderVideoList(media.videos || []);
    if (video) {
      const videos = media.videos || [];
      const currentVideo = videos[Math.min(state.activeVideoIndex, videos.length - 1)] || video;
      el.previewVideo.src = currentVideo.url;
      el.previewVideo.classList.remove("hidden");
      el.previewThumb.classList.add("hidden");
      el.playIndicator.classList.add("hidden");
      el.previewStatus.textContent = videos.length > 1 ? `视频 ${state.activeVideoIndex + 1}/${videos.length}` : "视频";
    } else if (thumb) {
      el.videoList.classList.add("hidden");
      el.previewThumb.src = thumb.url;
      el.previewThumb.classList.remove("hidden");
      el.previewVideo.classList.add("hidden");
      el.playIndicator.classList.remove("hidden");
      el.previewStatus.textContent = "缩略图";
    } else {
      clearVisualOnly();
      el.previewStatus.textContent = labelStatus(task.status);
    }
    return;
  }

  clearVisualOnly();
  el.videoList.classList.add("hidden");
  el.mediaStage.classList.add("hidden");
  el.playIndicator.classList.add("hidden");
  el.imageGrid.classList.remove("hidden");
  const images = media.images.length ? media.images : media.thumbnails;
  if (!images.length) {
    el.imageGrid.innerHTML = `<div class="image-empty">暂无图片结果（可能是视频任务，或未提取到图片地址）。</div>`;
    el.toggleImagesBtn.classList.add("hidden");
    return;
  }
  el.imageGrid.innerHTML = "";
  const limit = state.imageGridExpanded ? images.length : 12;
  for (const item of images.slice(0, limit)) {
    const wrap = document.createElement("div");
    wrap.className = "image-item";
    const img = document.createElement("img");
    img.src = item.url;
    img.alt = item.name;
    img.addEventListener("load", () => {
      item._dimensions = { width: img.naturalWidth, height: img.naturalHeight };
      if (getSelectedTask()?.id === task.id) renderFileMeta(media, task);
    });
    img.addEventListener("click", () => openImageModal(item));
    const downloadBtn = document.createElement("button");
    downloadBtn.className = "image-download-btn";
    downloadBtn.type = "button";
    downloadBtn.textContent = "下载";
    downloadBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      downloadMediaItem(item);
    });
    wrap.append(img, downloadBtn);
    el.imageGrid.appendChild(wrap);
  }
  el.toggleImagesBtn.classList.toggle("hidden", images.length <= 12);
  el.toggleImagesBtn.textContent = state.imageGridExpanded ? `收起图片（共 ${images.length} 张）` : `显示更多图片（共 ${images.length} 张）`;
}

function updateActionButtons(media) {
  const hasVideos = (media.videos?.length || 0) > 0;
  const hasImages = (media.images?.length || media.thumbnails?.length || 0) > 0;
  el.downloadVideoBtn.classList.toggle("hidden", state.activePreviewTab !== "video" || !hasVideos);
  el.downloadAllVideosBtn.classList.toggle("hidden", state.activePreviewTab !== "video" || (media.videos?.length || 0) <= 1);
  el.downloadAllImagesBtn.classList.toggle("hidden", state.activePreviewTab !== "image" || !hasImages);
}

function clearVisualOnly() {
  el.previewVideo.pause();
  el.previewVideo.removeAttribute("src");
  el.previewVideo.load();
  el.previewVideo.classList.add("hidden");
  el.previewThumb.removeAttribute("src");
  el.previewThumb.classList.add("hidden");
}

function clearMediaPreview() {
  clearVisualOnly();
  el.mediaStage.classList.remove("hidden");
  el.videoList.innerHTML = "";
  el.videoList.classList.add("hidden");
  el.imageGrid.innerHTML = "";
  el.imageGrid.classList.add("hidden");
  el.toggleImagesBtn.classList.add("hidden");
  el.playIndicator.classList.add("hidden");
  el.fileMeta.textContent = "等待提取结果...";
  closeImageModal();
}

function renderVideoList(videos) {
  el.videoList.innerHTML = "";
  el.videoList.classList.toggle("hidden", videos.length <= 1);
  if (videos.length <= 1) return;
  if (state.activeVideoIndex >= videos.length) state.activeVideoIndex = 0;
  videos.forEach((_item, i) => {
    const btn = document.createElement("button");
    btn.className = `video-chip${i === state.activeVideoIndex ? " active" : ""}`;
    btn.type = "button";
    btn.textContent = `视频 ${i + 1}`;
    btn.addEventListener("click", () => {
      state.activeVideoIndex = i;
      renderMediaPreviewForSelected();
    });
    el.videoList.appendChild(btn);
  });
}

function renderFileMeta(media, task) {
  const videos = media.videos || [];
  const images = media.images || [];
  const thumbs = media.thumbnails || [];
  const all = [...videos, ...images, ...thumbs];
  if (!all.length) {
    el.fileMeta.textContent = "等待提取结果...";
    return;
  }
  const totalBytes = all.reduce((sum, f) => sum + Number(f.sizeBytes || 0), 0);
  const firstVideo = videos[0];
  const firstImage = images[0] || thumbs[0];
  const typeText = firstVideo ? `视频 ${videos.length} 个` : `图片 ${images.length || thumbs.length} 张`;
  const primary = firstVideo ? firstVideo : firstImage;
  const dimText = primary && primary._dimensions ? ` · ${primary._dimensions.width}x${primary._dimensions.height}` : "";
  el.fileMeta.textContent = `${typeText}${totalBytes ? ` · 总大小 ${formatBytes(totalBytes)}` : ""}${dimText}`;
}

function markMediaDimensionsByUrl(taskId, url, width, height) {
  if (!taskId || !url || !width || !height) return;
  const media = state.mediaPreviewCache.get(taskId);
  if (!media) return;
  for (const listName of ["videos", "images", "thumbnails"]) {
    for (const item of media[listName] || []) {
      if (item.url === url) {
        item._dimensions = { width, height };
      }
    }
  }
  if (getSelectedTask()?.id === taskId) {
    renderFileMeta(media, getSelectedTask());
  }
}

function maybeAutoSwitchTab(taskId) {
  const task = state.tasks.find((t) => t.id === taskId);
  const media = state.mediaPreviewCache.get(taskId);
  if (!task || !media) return;

  const hasVideo = (media.videos?.length || 0) > 0;
  const hasImage = (media.images?.length || media.thumbnails?.length || 0) > 0;
  const mediaType = task.output?.mediaType;

  if (hasImage && !hasVideo) {
    switchPreviewTab("image");
    return;
  }
  if (hasVideo) {
    switchPreviewTab("video");
    return;
  }
  if (mediaType === "image") switchPreviewTab("image");
  if (mediaType === "video") switchPreviewTab("video");
}

function openImageModal(item) {
  if (!item?.url) return;
  el.imageModalImg.src = item.url;
  el.imageModalCaption.textContent = item.name || "";
  el.imageModal.classList.remove("hidden");
  el.imageModal.setAttribute("aria-hidden", "false");
}

function downloadMediaItem(item) {
  if (!item?.downloadUrl) return;
  const a = document.createElement("a");
  a.href = item.downloadUrl;
  a.download = item.name || "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function closeImageModal() {
  el.imageModal.classList.add("hidden");
  el.imageModal.setAttribute("aria-hidden", "true");
  el.imageModalImg.removeAttribute("src");
  el.imageModalCaption.textContent = "";
}

function formatDuration(totalSeconds) {
  const whole = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = n;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const fixed = value >= 100 || idx === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(fixed)} ${units[idx]}`;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

init().catch((error) => alert(`初始化失败: ${error.message || String(error)}`));
