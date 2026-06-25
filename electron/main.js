const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, dialog, ipcMain, shell, clipboard } = require("electron");
const { createDb } = require("./services/db");
const { createDownloader } = require("./services/downloader");
const { parseShareText } = require("./services/parser");
const { expandUrl } = require("./services/url");

let db;
let downloader;
let win;

function emit(channel, payload) {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: "#0b0d11",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, "../src/renderer/index.html"));
}

app.whenReady().then(() => {
  return (async () => {
    db = await createDb(app);
    downloader = createDownloader({
      db,
      onTaskUpdate: (task) => emit("tasks:updated", task),
      onLog: (entry) => emit("downloads:log", entry),
      onProgress: (progress) => emit("tasks:progress", progress)
    });
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })();
}).catch((error) => {
  console.error("App bootstrap failed:", error);
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("settings:get", async () => db.getSettings());
ipcMain.handle("settings:get-cookies-health", async () => {
  const settings = db.getSettings();
  return validateCookiesTxtFile(settings.cookiesTxtPath || "");
});

ipcMain.handle("settings:select-download-dir", async () => {
  const current = db.getSettings();
  const result = await dialog.showOpenDialog(win, {
    title: "选择默认下载目录",
    properties: ["openDirectory", "createDirectory"],
    defaultPath: current.downloadDir
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  db.setSetting("downloadDir", result.filePaths[0]);
  return { canceled: false, downloadDir: result.filePaths[0] };
});

ipcMain.handle("settings:set-cookie-browser", async (_event, value) => {
  const allowed = new Set(["auto", "edge", "chrome"]);
  const next = allowed.has(String(value)) ? String(value) : "auto";
  db.setSetting("cookieBrowser", next);
  return db.getSettings();
});
ipcMain.handle("settings:set-cookies-txt-only-mode", async (_event, value) => {
  db.setSetting("cookiesTxtOnlyMode", value ? "1" : "0");
  return db.getSettings();
});

ipcMain.handle("settings:select-cookies-file", async () => {
  const current = db.getSettings();
  const result = await dialog.showOpenDialog(win, {
    title: "选择 cookies.txt 文件",
    properties: ["openFile"],
    defaultPath: current.cookiesTxtPath || undefined,
    filters: [
      { name: "Cookie Files", extensions: ["txt"] },
      { name: "All Files", extensions: ["*"] }
    ]
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const filePath = result.filePaths[0];
  db.setSetting("cookiesTxtPath", filePath);
  return { canceled: false, settings: db.getSettings(), validation: validateCookiesTxtFile(filePath) };
});

ipcMain.handle("settings:clear-cookies-file", async () => {
  db.setSetting("cookiesTxtPath", "");
  return db.getSettings();
});
ipcMain.handle("settings:open-cookies-file-dir", async () => {
  const filePath = String(db.getSettings().cookiesTxtPath || "");
  if (!filePath) return { ok: false, error: "未配置 cookies.txt" };
  if (!fs.existsSync(filePath)) return { ok: false, error: "cookies.txt 文件不存在" };
  shell.showItemInFolder(filePath);
  return { ok: true };
});

ipcMain.handle("tasks:list", async () => db.listTasks());

ipcMain.handle("tasks:add-batch", async (_event, inputText) => {
  const rawLines = String(inputText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const lines = rawLines.filter(isLikelyShareLine);
  const tasks = [];
  for (const line of lines) {
    const parsed = parseShareText(line);
    let finalUrl = "";
    let expandError = "";
    if (parsed.shortUrl) {
      try {
        finalUrl = (await expandUrl(parsed.shortUrl)).finalUrl || "";
      } catch (error) {
        expandError = error.message || String(error);
      }
    }
    tasks.push(
      db.insertTask({
        rawText: line,
        title: parsed.title,
        shortUrl: parsed.shortUrl,
        finalUrl,
        platform: parsed.platform,
        appHint: parsed.appHint,
        codeFragments: parsed.codeFragments,
        status: "queued",
        error: expandError
      })
    );
  }
  return { count: tasks.length, tasks };
});

ipcMain.handle("tasks:clear-completed", async () => db.deleteCompletedTasks());
ipcMain.handle("tasks:clear-queued", async () => db.deleteQueuedTasks());
ipcMain.handle("downloads:start-queued", async () => {
  const settings = db.getSettings();
  const check = await downloader.checkTools();
  if (!check.ok && !check.optional) {
    emit("downloads:log", { ts: new Date().toISOString(), level: "error", message: check.error });
    return check;
  }
  if (!check.ok && check.optional) {
    emit("downloads:log", {
      ts: new Date().toISOString(),
      level: "warn",
      message: `未检测到 yt-dlp，继续以免登录直链模式运行（兜底不可用）: ${check.error}`
    });
  }
  if (settings.cookiesTxtOnlyMode) {
    emit("downloads:log", {
      ts: new Date().toISOString(),
      level: "info",
      message: "已启用“仅使用 cookies.txt”模式：本次下载将跳过浏览器 Cookie 尝试"
    });
  }
  downloader.start().catch((error) => {
    emit("downloads:log", { ts: new Date().toISOString(), level: "error", message: error.message || String(error) });
  });
  return { ok: true, ytDlp: check.ytDlp || "", directOnly: !check.ok };
});
ipcMain.handle("downloads:stop", async () => {
  downloader.stop();
  return { ok: true };
});
ipcMain.handle("downloads:check-cookie-login", async (_event, payload) => {
  const url = String(payload?.url || "").trim();
  const browser = String(payload?.browser || db.getSettings().cookieBrowser || "auto");
  const result = await downloader.checkCookieLogin({
    browser,
    url,
    cookiesTxtOnlyMode: !!db.getSettings().cookiesTxtOnlyMode
  });
  emit("downloads:log", {
    ts: new Date().toISOString(),
    level: result.ok ? "info" : "warn",
    message: result.message || (result.ok ? "Cookie 登录态检测通过" : "Cookie 登录态检测失败")
  });
  return result;
});
ipcMain.handle("downloads:simulate-probe", async (_event, payload) => {
  const url = String(payload?.url || "").trim();
  const browser = String(payload?.browser || db.getSettings().cookieBrowser || "auto");
  const result = await downloader.runYtDlpSimulateProbe({
    browser,
    url,
    cookiesTxtOnlyMode: !!db.getSettings().cookiesTxtOnlyMode
  });
  const lines = (result.results || []).map((x) =>
    `${x.ok ? "通过" : "失败"} ${x.label}: ${x.detailText}${x.message ? ` | ${x.message}` : ""}`
  );
  emit("downloads:log", {
    ts: new Date().toISOString(),
    level: result.ok ? "info" : "warn",
    message: [result.summary, ...lines].filter(Boolean).join(" || ")
  });
  return result;
});
ipcMain.handle("tasks:retry", async (_event, taskId) => db.retryTask(taskId));
ipcMain.handle("tasks:open-download-dir", async (_event, taskId) => {
  const task = db.getTask(taskId);
  if (!task || !task.downloadDir) return { ok: false };
  await shell.openPath(task.downloadDir);
  return { ok: true };
});

ipcMain.handle("clipboard:read-text", async () => {
  return { text: clipboard.readText() || "" };
});

ipcMain.handle("tasks:get-media-preview", async (_event, taskId) => {
  const task = db.getTask(taskId);
  if (!task || !task.downloadDir || !fs.existsSync(task.downloadDir)) {
    return { videos: [], images: [], thumbnails: [] };
  }
  const files = fs.readdirSync(task.downloadDir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name);

  const videoExts = new Set([".mp4", ".mkv", ".webm", ".mov"]);
  const imageExts = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
  const filesToObjects = (names) => names.map((name) => ({
    name,
    path: path.join(task.downloadDir, name),
    url: `file:///${path.join(task.downloadDir, name).replace(/\\/g, "/")}`,
    sizeBytes: fs.statSync(path.join(task.downloadDir, name)).size
  }));

  const thumbnails = [];
  const images = [];
  const videos = [];
  for (const name of files) {
    const ext = path.extname(name).toLowerCase();
    if (videoExts.has(ext)) videos.push(name);
    else if (imageExts.has(ext)) {
      if (/thumb|thumbnail|cover/i.test(name)) thumbnails.push(name);
      else images.push(name);
    }
  }

  return {
    videos: filesToObjects(videos),
    images: filesToObjects(images),
    thumbnails: filesToObjects(thumbnails)
  };
});

function isLikelyShareLine(line) {
  const text = String(line || "");
  if (!text) return false;
  if (/https?:\/\/\S+/i.test(text)) return true;
  if (/抖音|douyin/i.test(text) && /【[^】]+】/.test(text)) return true;
  if (/[a-zA-Z0-9@._-]+:\//.test(text) && /抖音|douyin/i.test(text)) return true;
  return false;
}

function validateCookiesTxtFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return { ok: false, message: "未配置 cookies.txt", code: "not_configured" };
    }
    const stat = fs.statSync(filePath);
    const raw = fs.readFileSync(filePath);
    let text = raw.toString("utf8");
    if (text.charCodeAt(0) === 0xfeff) {
      text = text.slice(1);
    }
    const lines = text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    const dataLines = lines.filter((x) => !x.startsWith("#"));
    if (dataLines.length < 3) {
      return withFileMeta({ ok: false, message: "cookies.txt 内容过少，可能导出不完整", code: "too_few_lines" }, stat);
    }
    const looksNetscape = lines.some((x) => /Netscape HTTP Cookie File/i.test(x)) || dataLines.every((x) => x.split("\t").length >= 6);
    const hasDouyinDomain = dataLines.some((x) => /douyin\.com/i.test(x));
    const requiredCookieNames = ["ttwid", "sessionid", "odin_tt", "passport_csrf_token"];
    const presentCookieNames = new Set();
    for (const line of dataLines) {
      const parts = line.split("\t");
      const name = String(parts[5] || "").trim();
      if (name) presentCookieNames.add(name.toLowerCase());
    }
    const missingKeyCookies = requiredCookieNames.filter((name) => !presentCookieNames.has(name.toLowerCase()));
    const hasKeyCookies = missingKeyCookies.length < requiredCookieNames.length;

    if (!looksNetscape) {
      return withFileMeta({ ok: false, message: "cookies.txt 格式不是标准 Netscape 格式", code: "bad_format" }, stat);
    }
    if (!hasDouyinDomain) {
      return withFileMeta({ ok: false, message: "cookies.txt 中未发现 douyin.com 域名 Cookie（可能不是在抖音页面导出）", code: "no_douyin_domain" }, stat);
    }
    if (!hasKeyCookies) {
      return withFileMeta({
        ok: false,
        message: "已发现 douyin.com Cookie，但关键登录态字段较少，可能导出不完整或未登录",
        code: "weak_login_cookies",
        missingKeyCookies
      }, stat);
    }
    return withFileMeta({
      ok: true,
      message: "cookies.txt 格式检查通过（仅本地静态检查）",
      code: "ok",
      missingKeyCookies
    }, stat);
  } catch (error) {
    return { ok: false, message: `cookies.txt 校验失败: ${error.message || String(error)}`, code: "read_error" };
  }
}

function withFileMeta(result, stat) {
  return {
    ...result,
    sizeBytes: stat?.size || 0,
    mtimeMs: stat?.mtimeMs || 0,
    mtimeText: stat?.mtime ? stat.mtime.toLocaleString() : ""
  };
}
