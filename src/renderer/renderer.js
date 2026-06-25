const state = {
  settings: null,
  cookiesHealth: null,
  tasks: [],
  logs: [],
  selectedTaskId: null,
  activePreviewTab: "video",
  mediaPreviewCache: new Map(),
  progressByTaskId: new Map(),
  imageGridExpanded: false,
  notifiedCompletedTaskIds: new Set(),
  notifiedCookieErrorTaskIds: new Set(),
  taskFilter: "all"
};

const el = {
  downloadDir: document.querySelector("#download-dir"),
  chooseDirBtn: document.querySelector("#choose-dir-btn"),
  batchInput: document.querySelector("#batch-input"),
  addBatchBtn: document.querySelector("#add-batch-btn"),
  pasteBtn: document.querySelector("#paste-btn"),
  clearInputBtn: document.querySelector("#clear-input-btn"),
  clearCompletedBtn: document.querySelector("#clear-completed-btn"),
  clearQueueBtn: document.querySelector("#clear-queue-btn"),
  startBtn: document.querySelector("#start-btn"),
  stopBtn: document.querySelector("#stop-btn"),
  refreshBtn: document.querySelector("#refresh-btn"),
  copyLinkBtn: document.querySelector("#copy-link-btn"),
  openDirBtn: document.querySelector("#open-dir-btn"),
  previewTitle: document.querySelector("#preview-title"),
  previewSubtitle: document.querySelector("#preview-subtitle"),
  previewRaw: document.querySelector("#preview-raw"),
  previewStatus: document.querySelector("#preview-status"),
  previewUrl: document.querySelector("#preview-url"),
  previewVideo: document.querySelector("#preview-video"),
  previewThumb: document.querySelector("#preview-thumb"),
  playIndicator: document.querySelector("#play-indicator"),
  imageGrid: document.querySelector("#image-grid"),
  toggleImagesBtn: document.querySelector("#toggle-images-btn"),
  tabVideo: document.querySelector("#tab-video"),
  tabImage: document.querySelector("#tab-image"),
  progressWrap: document.querySelector("#progress-wrap"),
  progressBarFill: document.querySelector("#progress-bar-fill"),
  progressText: document.querySelector("#progress-text"),
  fileMeta: document.querySelector("#file-meta"),
  cookieBrowser: document.querySelector("#cookie-browser"),
  checkCookieBtn: document.querySelector("#check-cookie-btn"),
  simulateProbeBtn: document.querySelector("#simulate-probe-btn"),
  cookiesTxtPath: document.querySelector("#cookies-txt-path"),
  cookiesTxtOnlyMode: document.querySelector("#cookies-txt-only-mode"),
  selectCookiesBtn: document.querySelector("#select-cookies-btn"),
  openCookiesDirBtn: document.querySelector("#open-cookies-dir-btn"),
  clearCookiesBtn: document.querySelector("#clear-cookies-btn"),
  cookiesTxtMeta: document.querySelector("#cookies-txt-meta"),
  imageModal: document.querySelector("#image-modal"),
  imageModalImg: document.querySelector("#image-modal-img"),
  imageModalClose: document.querySelector("#image-modal-close"),
  imageModalCaption: document.querySelector("#image-modal-caption"),
  tbody: document.querySelector("#task-tbody"),
  taskStats: document.querySelector("#task-stats"),
  logBox: document.querySelector("#log-box"),
  filterAll: document.querySelector("#filter-all"),
  filterFailed: document.querySelector("#filter-failed"),
  filterQueued: document.querySelector("#filter-queued"),
  filterCompleted: document.querySelector("#filter-completed")
};

async function init() {
  bindEvents();
  renderFilterButtons();
  await refreshAll();
  window.api.onTasksUpdated((task) => {
    const previous = state.tasks.find((x) => x.id === task.id);
    upsertTask(task);
    if (state.selectedTaskId === task.id && previous?.downloadDir !== task.downloadDir) {
      state.mediaPreviewCache.delete(task.id);
    }
    if (state.selectedTaskId === task.id && previous?.status !== "completed" && task.status === "completed") {
      state.mediaPreviewCache.delete(task.id);
      loadAndRenderMediaPreview(task.id);
    }
    if (previous?.status !== "completed" && task.status === "completed") {
      notifyTaskCompleted(task);
      state.progressByTaskId.delete(task.id);
    }
    if (previous?.status !== "failed" && task.status === "failed") {
      maybeNotifyCookieFailure(task);
    }
    if (!state.selectedTaskId) state.selectedTaskId = task.id;
    renderTasks();
    renderPreview();
  });
  window.api.onDownloadLog((entry) => {
    pushLog(`[${fmtTime(entry.ts)}] ${entry.level.toUpperCase()} ${entry.message}`);
  });
  window.api.onTaskProgress((progress) => {
    state.progressByTaskId.set(progress.taskId, progress);
    if (state.selectedTaskId === progress.taskId) {
      renderProgress(progress);
    }
  });
}

function bindEvents() {
  el.chooseDirBtn.addEventListener("click", async () => {
    const result = await window.api.settingsSelectDownloadDir();
    if (!result?.canceled) await loadSettings();
  });
  el.cookieBrowser.addEventListener("change", async () => {
    const settings = await window.api.settingsSetCookieBrowser(el.cookieBrowser.value);
    state.settings = settings;
    pushLog(`Cookie 来源已设置为: ${cookieBrowserLabel(settings.cookieBrowser)}`);
  });
  if (el.cookiesTxtOnlyMode) {
    el.cookiesTxtOnlyMode.addEventListener("change", async () => {
      const settings = await window.api.settingsSetCookiesTxtOnlyMode(!!el.cookiesTxtOnlyMode.checked);
      state.settings = settings;
      applySettingsToUi();
      pushLog(`已${settings.cookiesTxtOnlyMode ? "开启" : "关闭"}：仅使用 cookies.txt（跳过浏览器 Cookie）`);
    });
  }
  if (el.selectCookiesBtn) {
    el.selectCookiesBtn.addEventListener("click", async () => {
      const result = await window.api.settingsSelectCookiesFile();
      if (!result?.canceled && result?.settings) {
        state.settings = result.settings;
        applySettingsToUi();
        pushLog(`已设置 cookies.txt: ${result.settings.cookiesTxtPath}`);
        state.cookiesHealth = result.validation || null;
        if (state.settings.cookieBrowser !== "auto") {
          state.settings = await window.api.settingsSetCookieBrowser("auto");
          applySettingsToUi();
          pushLog("已自动将 Cookie 来源切换为: 自动（优先使用 cookies.txt，浏览器 Cookie 作为兜底）");
        }
        if (!state.settings.cookiesTxtOnlyMode) {
          state.settings = await window.api.settingsSetCookiesTxtOnlyMode(true);
          applySettingsToUi();
          pushLog("已自动开启：仅使用 cookies.txt（跳过浏览器 Cookie）");
        }
        renderCookiesHealth();
        if (result.validation?.ok) {
          pushLog(result.validation.message);
          autoCheckCookieLoginAfterImport();
        } else if (result.validation?.message) {
          pushLog(`cookies.txt 提示: ${result.validation.message}`);
          alert(result.validation.message);
        }
      }
    });
  }
  if (el.clearCookiesBtn) {
    el.clearCookiesBtn.addEventListener("click", async () => {
      const settings = await window.api.settingsClearCookiesFile();
      state.settings = settings;
      applySettingsToUi();
      state.cookiesHealth = null;
      renderCookiesHealth();
      pushLog("已清空 cookies.txt 配置");
    });
  }
  if (el.openCookiesDirBtn) {
    el.openCookiesDirBtn.addEventListener("click", async () => {
      const result = await window.api.settingsOpenCookiesFileDir();
      if (!result?.ok) {
        const msg = result?.error || "无法打开 cookies.txt 所在目录";
        pushLog(msg, "warn");
        alert(msg);
      }
    });
  }
  el.checkCookieBtn.addEventListener("click", async () => {
    const task = getSelectedTask();
    const url = task?.finalUrl || task?.shortUrl || "";
    setBusy(el.checkCookieBtn, true, "检测中...");
    try {
      const result = await window.api.checkCookieLogin({
        browser: el.cookieBrowser.value,
        url
      });
      if (result?.ok) {
        pushLog(result.message || "登录态可用");
        alert(result.message || "登录态可用");
      } else {
        const msg = normalizeCookieCheckErrorMessage(result?.message || "登录态不可用");
        pushLog(msg);
        alert(msg);
      }
    } finally {
      setBusy(el.checkCookieBtn, false, "检测登录态");
    }
  });
  if (el.simulateProbeBtn) {
    el.simulateProbeBtn.addEventListener("click", async () => {
      const task = getSelectedTask();
      const url = task?.finalUrl || task?.shortUrl || "";
      setBusy(el.simulateProbeBtn, true, "自检中...");
      try {
        const result = await window.api.simulateProbe({
          browser: el.cookieBrowser.value,
          url
        });
        const text = formatSimulateProbeResult(result);
        pushLog(text.replace(/\n/g, " | "));
        alert(text);
      } finally {
        setBusy(el.simulateProbeBtn, false, "自检（yt-dlp --simulate）");
      }
    });
  }

  el.addBatchBtn.addEventListener("click", async () => {
    const text = el.batchInput.value.trim();
    if (!text) return;
    setBusy(el.addBatchBtn, true, "提取中...");
    try {
      const result = await window.api.addBatch(text);
      pushLog(`导入任务 ${result.count} 条（默认忽略广告文案）`);
      el.batchInput.value = "";
      await loadTasks();
      if (result.tasks?.length) {
        state.selectedTaskId = result.tasks[0].id;
        renderPreview();
        const startResult = await window.api.startQueued();
        if (!startResult?.ok) {
          const msg = startResult?.error || "自动开始下载失败";
          pushLog(msg);
          alert(msg);
        } else {
          pushLog(`已自动开始下载队列（${startResult.ytDlp || "已检测下载器"}）`);
        }
      }
    } finally {
      setBusy(el.addBatchBtn, false, "开始提取");
    }
  });

  el.pasteBtn.addEventListener("click", async () => {
    const result = await window.api.readClipboardText();
    const text = String(result?.text || "").trim();
    if (!text) {
      pushLog("剪贴板为空");
      return;
    }
    el.batchInput.value = [text, el.batchInput.value].filter(Boolean).join("\n").trim();
    pushLog("已从系统剪贴板粘贴");
  });

  el.clearInputBtn.addEventListener("click", () => {
    el.batchInput.value = "";
    pushLog("已清空输入框");
  });

  el.clearCompletedBtn.addEventListener("click", async () => {
    const result = await window.api.clearCompleted();
    pushLog(`清理已完成任务 ${result.deleted} 条`);
    await loadTasks();
  });
  el.clearQueueBtn.addEventListener("click", async () => {
    const result = await window.api.clearQueued();
    pushLog(`清空队列任务 ${result.deleted} 条`);
    await loadTasks();
  });

  el.startBtn.addEventListener("click", async () => {
    const result = await window.api.startQueued();
    if (!result?.ok) {
      const msg = result?.error || "开始队列失败";
      pushLog(msg);
      alert(msg);
      return;
    }
    pushLog(`开始队列（${result.ytDlp || "已检测下载器"}）`);
  });

  el.stopBtn.addEventListener("click", async () => {
    await window.api.stopDownloads();
    pushLog("停止队列");
  });
  [el.filterAll, el.filterFailed, el.filterQueued, el.filterCompleted].forEach((btn) => {
    if (!btn) return;
    btn.addEventListener("click", () => {
      state.taskFilter = btn.dataset.filter || "all";
      renderFilterButtons();
      renderTasks();
    });
  });

  el.refreshBtn.addEventListener("click", refreshAll);
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
      pushLog(`已复制任务#${task.id} 链接`);
    } catch (_error) {
      pushLog("复制失败，请手动复制", "warn");
    }
  });

  el.openDirBtn.addEventListener("click", async () => {
    const task = getSelectedTask();
    if (!task) return;
    await window.api.openDownloadDir(task.id);
  });
}

function setBusy(button, busy, text) {
  button.disabled = busy;
  button.textContent = text;
}

async function refreshAll() {
  await Promise.all([loadSettings(), loadTasks()]);
  renderPreview();
}

async function loadSettings() {
  state.settings = await window.api.settingsGet();
  applySettingsToUi();
  state.cookiesHealth = await window.api.settingsGetCookiesHealth();
  renderCookiesHealth();
}

function applySettingsToUi() {
  el.downloadDir.value = state.settings?.downloadDir || "";
  if (el.cookieBrowser) el.cookieBrowser.value = state.settings?.cookieBrowser || "auto";
  if (el.cookiesTxtPath) el.cookiesTxtPath.value = state.settings?.cookiesTxtPath || "";
  if (el.cookiesTxtOnlyMode) el.cookiesTxtOnlyMode.checked = !!state.settings?.cookiesTxtOnlyMode;
}

function renderCookiesHealth() {
  if (!el.cookiesTxtMeta) return;
  const h = state.cookiesHealth;
  el.cookiesTxtMeta.classList.remove("ok", "warn");
  if (!state.settings?.cookiesTxtPath) {
    el.cookiesTxtMeta.textContent = "未配置 cookies.txt（可选；仅在抖音风控时作为兜底）";
    return;
  }
  if (!h) {
    el.cookiesTxtMeta.textContent = "正在检查 cookies.txt...";
    return;
  }
  const parts = [h.message || ""];
  if (Array.isArray(h.missingKeyCookies) && h.missingKeyCookies.length) {
    parts.push(`缺少关键字段: ${h.missingKeyCookies.join(", ")}`);
  }
  if (h.mtimeText) parts.push(`修改时间: ${h.mtimeText}`);
  if (Number.isFinite(h.sizeBytes)) parts.push(`大小: ${formatBytes(h.sizeBytes)}`);
  el.cookiesTxtMeta.textContent = parts.filter(Boolean).join(" | ");
  el.cookiesTxtMeta.classList.add(h.ok ? "ok" : "warn");
}

function normalizeCookieCheckErrorMessage(message) {
  const msg = String(message || "");
  if (/已导入 cookies\.txt，但未通过认证/i.test(msg)) {
    return `${msg}\n\n建议：保持在 https://www.douyin.com/ 页面标签页导出，并重新导入后再检测。`;
  }
  if (/Failed to decrypt with DPAPI/i.test(msg)) {
    return "浏览器 Cookie 解密失败（DPAPI）。这通常不是未登录；请优先使用已导入的 cookies.txt，或确保浏览器与本工具使用相同权限运行。";
  }
  return msg;
}

function formatSimulateProbeResult(result) {
  if (!result) return "自检失败：无结果";
  const lines = [result.summary || (result.ok ? "自检通过" : "自检未通过")];
  for (const item of result.results || []) {
    lines.push(`${item.ok ? "通过" : "失败"} ${item.label}: ${item.detailText || item.message || ""}`);
    if (!item.ok && item.message) lines.push(`原始信息: ${item.message}`);
  }
  return lines.join("\n");
}

async function autoCheckCookieLoginAfterImport() {
  const task = getSelectedTask();
  const url = task?.finalUrl || task?.shortUrl || "";
  if (!url) return;
  pushLog("正在使用导入的 cookies.txt 自动检测登录态...");
  try {
    const result = await window.api.checkCookieLogin({
      browser: el.cookieBrowser?.value || "auto",
      url
    });
    if (result?.ok) {
      pushLog(`自动检测通过: ${result.message || "登录态可用"}`);
    } else {
      pushLog(`自动检测未通过: ${result?.message || "登录态不可用"}`);
    }
  } catch (error) {
    pushLog(`自动检测失败: ${error.message || String(error)}`);
  }
}

async function loadTasks() {
  state.tasks = await window.api.listTasks();
  state.mediaPreviewCache.clear();
  state.progressByTaskId.clear();
  if (state.tasks.length && !state.tasks.some((t) => t.id === state.selectedTaskId)) {
    state.selectedTaskId = state.tasks[0].id;
  }
  renderTasks();
  renderPreview();
}

function renderTasks() {
  el.tbody.innerHTML = "";

  const stats = { total: state.tasks.length, queued: 0, downloading: 0, completed: 0, failed: 0, retry: 0 };
  for (const t of state.tasks) stats[t.status] = (stats[t.status] || 0) + 1;
  el.taskStats.textContent =
    `总计 ${stats.total} | 待下载 ${stats.queued + stats.retry} | 下载中 ${stats.downloading} | 完成 ${stats.completed} | 失败 ${stats.failed}`;

  const visibleTasks = state.tasks.filter(matchesTaskFilter);
  for (const task of visibleTasks) {
    const tr = document.createElement("tr");
    if (task.id === state.selectedTaskId) tr.classList.add("selected");

    tr.innerHTML = `
      <td><span class="id-badge">#${task.id}</span></td>
      <td>${statusChip(task.status)}</td>
      <td>
        <div class="cell-wrap cell-title" title="${esc(task.title || "(未解析标题)")}">
          <strong>${esc(task.title || "(未解析标题)")}</strong>
        </div>
        <div class="cell-wrap cell-sub" title="${esc(task.rawText || "")}">${esc((task.rawText || "").slice(0, 140))}</div>
      </td>
      <td><div class="cell-wrap mono-cell" title="${esc(task.finalUrl || task.shortUrl || "")}">${esc(task.finalUrl || task.shortUrl || "")}</div></td>
      <td><div class="cell-wrap mono-cell" title="${esc(task.downloadDir || "")}">${esc(task.downloadDir || "")}</div></td>
      <td>${renderInlineProgress(task)}</td>
      <td><span class="file-count">${task.downloadedCount || 0}</span></td>
      <td><div class="cell-wrap error-cell" title="${esc(task.error || "")}">${esc(task.error || "") || "-"}</div></td>
      <td></td>
    `;

    tr.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      state.selectedTaskId = task.id;
      renderTasks();
      renderPreview();
    });

    const actionsCell = tr.lastElementChild;
    const wrap = document.createElement("div");
    wrap.className = "table-actions";

    const retryBtn = document.createElement("button");
    retryBtn.className = "mini-action";
    retryBtn.textContent = "重试";
    retryBtn.disabled = !["failed", "completed"].includes(task.status);
    retryBtn.addEventListener("click", async () => {
      await window.api.retryTask(task.id);
      pushLog(`任务#${task.id} 已设为重试`);
      await loadTasks();
    });

    const openBtn = document.createElement("button");
    openBtn.className = "mini-action";
    openBtn.textContent = "打开目录";
    openBtn.disabled = !task.downloadDir;
    openBtn.addEventListener("click", async () => {
      await window.api.openDownloadDir(task.id);
    });

    wrap.append(retryBtn, openBtn);
    actionsCell.appendChild(wrap);
    el.tbody.appendChild(tr);
  }
}

function renderFilterButtons() {
  [el.filterAll, el.filterFailed, el.filterQueued, el.filterCompleted].forEach((btn) => {
    if (!btn) return;
    btn.classList.toggle("active", btn.dataset.filter === state.taskFilter);
  });
}

function matchesTaskFilter(task) {
  switch (state.taskFilter) {
    case "failed":
      return task.status === "failed";
    case "queued":
      return task.status === "queued" || task.status === "retry";
    case "completed":
      return task.status === "completed";
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
    el.previewRaw.value = "";
    el.previewStatus.textContent = "未开始";
    el.previewUrl.textContent = "等待解析链接...";
    clearMediaPreview();
    el.openDirBtn.disabled = true;
    el.copyLinkBtn.disabled = true;
    return;
  }

  el.previewTitle.textContent = task.title || "未解析标题";
  el.previewSubtitle.textContent = `${labelStatus(task.status)} · ${task.platform || "未知平台"}${task.downloadedCount ? ` · 文件 ${task.downloadedCount}` : ""}`;
  el.previewRaw.value = task.rawText || "";
  el.previewStatus.textContent = labelStatus(task.status);
  el.previewUrl.textContent = task.finalUrl || task.shortUrl || "未解析到链接";
  el.openDirBtn.disabled = !task.downloadDir;
  el.copyLinkBtn.disabled = !(task.finalUrl || task.shortUrl);
  renderProgress(state.progressByTaskId.get(task.id) || null, task);
  loadAndRenderMediaPreview(task.id);
}

function getSelectedTask() {
  return state.tasks.find((t) => t.id === state.selectedTaskId) || null;
}

function upsertTask(task) {
  const i = state.tasks.findIndex((x) => x.id === task.id);
  if (i >= 0) state.tasks[i] = task;
  else state.tasks.unshift(task);
}

function statusChip(status) {
  return `<span class="status-chip status-${esc(status)}">${esc(labelStatus(status))}</span>`;
}

function labelStatus(status) {
  return {
    queued: "排队中",
    retry: "待重试",
    resolving: "解析中",
    downloading: "下载中",
    completed: "已完成",
    failed: "失败"
  }[status] || status;
}

function pushLog(line) {
  state.logs.push(line);
  if (state.logs.length > 200) state.logs = state.logs.slice(-200);
  el.logBox.textContent = state.logs.join("\n");
  el.logBox.scrollTop = el.logBox.scrollHeight;
}

function renderInlineProgress(task) {
  const p = state.progressByTaskId.get(task.id);
  if (task.status === "completed") {
    return `<div class="inline-progress"><div class="inline-progress-track"><div class="inline-progress-fill" style="width:100%"></div></div><div class="inline-progress-text">100%</div></div>`;
  }
  if (!p || task.status !== "downloading") {
    return `<div class="inline-progress"><div class="inline-progress-track"><div class="inline-progress-fill" style="width:0%"></div></div><div class="inline-progress-text">-</div></div>`;
  }
  const percent = Math.max(0, Math.min(100, Number(p.percent || 0)));
  return `<div class="inline-progress"><div class="inline-progress-track"><div class="inline-progress-fill" style="width:${percent}%"></div></div><div class="inline-progress-text">${percent.toFixed(1)}%</div></div>`;
}

function switchPreviewTab(tab) {
  state.activePreviewTab = tab;
  el.tabVideo.classList.toggle("active", tab === "video");
  el.tabImage.classList.toggle("active", tab === "image");
  renderMediaPreviewForSelected();
}

async function loadAndRenderMediaPreview(taskId) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task || !task.downloadDir) {
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

  if (state.activePreviewTab === "video") {
    el.imageGrid.innerHTML = "";
    el.imageGrid.classList.add("hidden");
    if (video) {
      el.previewVideo.src = video.url;
      el.previewVideo.classList.remove("hidden");
      el.previewThumb.classList.add("hidden");
      el.playIndicator.classList.add("hidden");
      el.previewStatus.textContent = "视频";
    } else if (thumb) {
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
  el.playIndicator.classList.add("hidden");
  el.imageGrid.classList.remove("hidden");
  const images = media.images.length ? media.images : media.thumbnails;
  if (!images.length) {
    el.imageGrid.innerHTML = `<div class="image-empty">暂无图片结果（图集未下载完成或该任务为视频）。</div>`;
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
    wrap.appendChild(img);
    el.imageGrid.appendChild(wrap);
  }
  el.toggleImagesBtn.classList.toggle("hidden", images.length <= 12);
  el.toggleImagesBtn.textContent = state.imageGridExpanded ? `收起图片（共 ${images.length} 张）` : `显示更多图片（共 ${images.length} 张）`;
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
  el.imageGrid.innerHTML = "";
  el.imageGrid.classList.add("hidden");
  el.toggleImagesBtn.classList.add("hidden");
  el.playIndicator.classList.remove("hidden");
  el.fileMeta.textContent = "等待本地文件信息...";
  renderProgress(null);
  closeImageModal();
}

function renderProgress(progress, task) {
  const status = task?.status || getSelectedTask()?.status;
  if (!progress && status !== "downloading") {
    el.progressWrap.classList.add("hidden");
    el.progressBarFill.style.width = "0%";
    el.progressText.textContent = "0%";
    return;
  }
  el.progressWrap.classList.remove("hidden");
  const percent = Math.max(0, Math.min(100, Number(progress?.percent || 0)));
  el.progressBarFill.style.width = `${percent}%`;
  const extras = [progress?.speedText, progress?.etaText ? `ETA ${progress.etaText}` : ""].filter(Boolean).join(" · ");
  el.progressText.textContent = extras ? `${percent.toFixed(1)}% · ${extras}` : `${percent.toFixed(1)}%`;
}

function renderFileMeta(media, task) {
  const videos = media.videos || [];
  const images = media.images || [];
  const thumbs = media.thumbnails || [];
  const all = [...videos, ...images, ...thumbs];
  if (!all.length) {
    el.fileMeta.textContent = task?.status === "completed" ? "已完成，但暂未识别到可预览文件。" : "等待本地文件信息...";
    return;
  }
  const totalBytes = all.reduce((sum, f) => sum + Number(f.sizeBytes || 0), 0);
  const firstVideo = videos[0];
  const firstImage = images[0] || thumbs[0];
  const typeText = firstVideo ? `视频 ${videos.length} 个` : `图片 ${images.length || thumbs.length} 张`;
  const primary = firstVideo ? firstVideo : firstImage;
  const dimText = primary && primary._dimensions ? ` · ${primary._dimensions.width}x${primary._dimensions.height}` : "";
  el.fileMeta.textContent = `${typeText} · 总大小 ${formatBytes(totalBytes)}${dimText}`;
}

function notifyTaskCompleted(task) {
  if (!task || state.notifiedCompletedTaskIds.has(task.id)) return;
  state.notifiedCompletedTaskIds.add(task.id);
  const title = task.title || `任务 #${task.id}`;
  const body = `下载完成，文件数 ${task.downloadedCount || 0}`;
  try {
    if ("Notification" in window) {
      if (Notification.permission === "granted") {
        const n = new Notification("SoloSaver 下载完成", { body: `${title} · ${body}` });
        n.onclick = () => window.focus();
      } else if (Notification.permission === "default") {
        Notification.requestPermission().then((perm) => {
          if (perm === "granted") {
            const n = new Notification("SoloSaver 下载完成", { body: `${title} · ${body}` });
            n.onclick = () => window.focus();
          }
        }).catch(() => {});
      }
    }
  } catch (_error) {
    // Electron environment may block notifications in some setups.
  }
  pushLog(`任务#${task.id} 下载完成通知已触发`);
}

function maybeNotifyCookieFailure(task) {
  if (!task || state.notifiedCookieErrorTaskIds.has(task.id)) return;
  const msg = String(task.error || "");
  if (!/cookies/i.test(msg) && !/DPAPI/i.test(msg) && !/Cookie 数据库/i.test(msg) && !/Fresh cookies/i.test(msg)) return;
  state.notifiedCookieErrorTaskIds.add(task.id);
  const detail = /Cookie 数据库被占用/i.test(msg)
    ? "浏览器 Cookie 数据库被占用。请彻底关闭 Edge/Chrome（含后台进程）后重试。"
    : (state.settings?.cookiesTxtPath
      ? "已配置 cookies.txt，但仍未通过认证。可能原因：导出不完整、文件格式不正确、风控拦截或登录态失效。请重新在抖音页面导出后重试。"
      : "抖音需要浏览器登录态 Cookies。请先在 Edge/Chrome 登录抖音网页版，关闭浏览器后重试。");
  pushLog(detail);
  alert(detail);
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

function closeImageModal() {
  el.imageModal.classList.add("hidden");
  el.imageModal.setAttribute("aria-hidden", "true");
  el.imageModalImg.removeAttribute("src");
  el.imageModalCaption.textContent = "";
}

function fmtTime(iso) {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
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

function cookieBrowserLabel(value) {
  return {
    auto: "自动",
    edge: "优先 Edge",
    chrome: "优先 Chrome"
  }[value] || value;
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

init().catch((error) => pushLog(`初始化失败: ${error.message || String(error)}`));
