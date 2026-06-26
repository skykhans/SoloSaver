const API_BASE = "http://127.0.0.1:3000";

Page({
  data: {
    inputText: "",
    loading: false,
    tasks: [],
    selectedTaskId: null,
    selectedTask: null,
    videoUrl: "",
    videos: [],
    currentVideoIndex: 0,
    images: [],
    mediaLink: "",
    mediaSummary: "等待提取结果...",
    saving: false
  },

  onLoad() {
    this.loadTasks();
  },

  onInput(event) {
    this.setData({ inputText: event.detail.value });
  },

  pasteClipboard() {
    wx.getClipboardData({
      success: (res) => this.setData({ inputText: [res.data.trim(), this.data.inputText].filter(Boolean).join("\n") })
    });
  },

  clearInput() {
    this.setData({ inputText: "" });
  },

  addBatch() {
    const inputText = this.data.inputText.trim();
    if (!inputText) return;
    this.setData({ loading: true });
    request("/api/tasks/add-batch", "POST", { inputText })
      .then((res) => {
        if (res.error) throw new Error(res.error);
        this.setData({ inputText: "", selectedTaskId: res.tasks?.[0]?.id || this.data.selectedTaskId });
        return this.loadTasks();
      })
      .catch(showError)
      .finally(() => this.setData({ loading: false }));
  },

  loadTasks() {
    return request("/api/tasks").then((tasks) => {
      const list = (tasks || []).map(formatTask);
      const selectedTaskId = list.some((x) => x.id === this.data.selectedTaskId) ? this.data.selectedTaskId : list[0]?.id || null;
      this.setData({ tasks: list, selectedTaskId });
      return this.renderSelected();
    }).catch(showError);
  },

  selectTask(event) {
    this.setData({ selectedTaskId: Number(event.currentTarget.dataset.id) });
    this.renderSelected();
  },

  renderSelected() {
    const selectedTask = this.data.tasks.find((x) => x.id === this.data.selectedTaskId) || null;
    if (!selectedTask) return this.setData({ selectedTask: null, videoUrl: "", videos: [], currentVideoIndex: 0, images: [], mediaLink: "", mediaSummary: "等待提取结果..." });
    return request(`/api/tasks/${selectedTask.id}/media-preview`).then((media) => {
      const videos = (media?.videos || []).map((x, index) => ({ ...x, index, url: absoluteUrl(x.url), downloadUrl: absoluteUrl(x.downloadUrl) }));
      const video = videos[0] || null;
      const images = media?.images?.length ? media.images : (media?.thumbnails || []);
      const imageList = images.map((x, index) => ({ ...x, index, url: absoluteUrl(x.url), downloadUrl: absoluteUrl(x.downloadUrl) }));
      this.setData({
        selectedTask,
        videos,
        currentVideoIndex: 0,
        videoUrl: video?.url || "",
        images: imageList,
        mediaLink: video?.downloadUrl || imageList[0]?.downloadUrl || "",
        mediaSummary: videos.length ? `视频 ${videos.length} 个` : (imageList.length ? `图片 ${imageList.length} 张` : "等待提取结果...")
      });
    }).catch(showError);
  },

  selectVideo(event) {
    const index = Number(event.currentTarget.dataset.index);
    const video = this.data.videos[index];
    if (!video) return;
    this.setData({ currentVideoIndex: index, videoUrl: video.url, mediaLink: video.downloadUrl || video.url });
  },

  copyMediaLink() {
    copyText(this.data.mediaLink);
  },

  copySourceLink() {
    const task = this.data.selectedTask;
    copyText(task?.finalUrl || task?.shortUrl || "");
  },

  previewImage(event) {
    const current = event.currentTarget.dataset.url;
    wx.previewImage({ current, urls: this.data.images.map((x) => x.url) });
  },

  saveVideo() {
    const video = this.data.videos[this.data.currentVideoIndex];
    if (video) this.saveOne(video.downloadUrl || video.url, "video");
  },

  saveAllVideos() {
    if (!this.data.videos.length || this.data.saving) return;
    this.setData({ saving: true });
    this.data.videos.reduce(
      (p, video) => p.then(() => saveToAlbum(video.downloadUrl || video.url, "video")),
      Promise.resolve()
    ).then(() => wx.showToast({ title: "已保存", icon: "success" }))
      .catch(showError)
      .finally(() => this.setData({ saving: false }));
  },

  saveImage(event) {
    const image = this.data.images[Number(event.currentTarget.dataset.index)];
    if (image) this.saveOne(image.downloadUrl || image.url, "image");
  },

  saveAllImages() {
    if (!this.data.images.length || this.data.saving) return;
    this.setData({ saving: true });
    this.data.images.reduce(
      (p, image) => p.then(() => saveToAlbum(image.downloadUrl || image.url, "image")),
      Promise.resolve()
    ).then(() => wx.showToast({ title: "已保存", icon: "success" }))
      .catch(showError)
      .finally(() => this.setData({ saving: false }));
  },

  saveOne(url, kind) {
    if (!url || this.data.saving) return;
    this.setData({ saving: true });
    saveToAlbum(url, kind)
      .then(() => wx.showToast({ title: "已保存", icon: "success" }))
      .catch(showError)
      .finally(() => this.setData({ saving: false }));
  }
});

function request(path, method = "GET", data) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${API_BASE}${path}`,
      method,
      data,
      header: { "content-type": "application/json" },
      success: (res) => res.statusCode >= 200 && res.statusCode < 300 ? resolve(res.data) : reject(new Error(`HTTP ${res.statusCode}`)),
      fail: reject
    });
  });
}

function absoluteUrl(url) {
  return url && url.startsWith("/") ? `${API_BASE}${url}` : (url || "");
}

function formatTask(task) {
  return { ...task, statusText: { extracted: "已提取", failed: "失败" }[task.status] || task.status };
}

function copyText(data) {
  if (!data) return;
  wx.setClipboardData({ data });
}

function saveToAlbum(url, kind) {
  return ensureAlbumAuth()
    .then(() => download(url))
    .then((filePath) => new Promise((resolve, reject) => {
      const fn = kind === "video" ? wx.saveVideoToPhotosAlbum : wx.saveImageToPhotosAlbum;
      fn({ filePath, success: resolve, fail: reject });
    }));
}

function ensureAlbumAuth() {
  return new Promise((resolve, reject) => {
    wx.authorize({
      scope: "scope.writePhotosAlbum",
      success: resolve,
      fail: () => wx.showModal({
        title: "需要相册权限",
        content: "请允许保存到相册",
        success: (res) => res.confirm ? wx.openSetting({
          success: (setting) => setting.authSetting?.["scope.writePhotosAlbum"] ? resolve() : reject(new Error("未授权保存到相册")),
          fail: reject
        }) : reject(new Error("未授权保存到相册"))
      })
    });
  });
}

function download(url) {
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url,
      success: (res) => res.statusCode >= 200 && res.statusCode < 300 ? resolve(res.tempFilePath) : reject(new Error(`下载失败 ${res.statusCode}`)),
      fail: reject
    });
  });
}

function showError(error) {
  wx.showToast({ title: error.message || String(error), icon: "none" });
}
