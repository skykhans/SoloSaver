const fs = require("fs");
const http = require("http");
const https = require("https");
const net = require("net");
const path = require("path");
const { extractAwemeId, fetchDouyinMetadataByApi } = require("./server/services/douyin");
const { parseShareText } = require("./server/services/parser");
const { expandUrl } = require("./server/services/url");
const { fetchXMetadata, pipeXVideo } = require("./server/services/x");

const PORT = parsePort(process.env.PORT || "3000");
const root = __dirname;
const publicDir = path.join(root, "src", "renderer");
const tasks = [];
let nextTaskId = 1;

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || String(error));
    process.exit(1);
  });
}

async function main() {
  await assertPortFree(PORT);
  return startServer(PORT);
}

function startServer(port = 0) {
  const server = http.createServer(handleRequest);
  server.listen(port, () => {
    const actualPort = server.address().port;
    console.log(`SoloSaver: http://localhost:${actualPort}`);
  });
  return server;
}

function assertPortFree(port) {
  return new Promise((resolve, reject) => {
    const probeServer = net.createServer()
      .once("error", (error) => {
        reject(error.code === "EADDRINUSE"
          ? new Error(`端口 ${port} 已被占用，服务可能已经启动： http://localhost:${port}\n如需重新启动，请先关闭占用 ${port} 的 node 进程，或用 PORT=3001 node server.js 换端口。`)
          : error);
      })
      .once("listening", () => probeServer.close(resolve))
      .listen(port);
  });
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    return sendStatic(res, url.pathname === "/" ? "/index.html" : url.pathname);
  } catch (error) {
    sendJson(res, { error: error.message || String(error) }, error.statusCode || 500);
  }
}

async function handleApi(req, res, url) {
  const body = req.method === "POST" ? await readJson(req) : {};

  if (req.method === "GET" && url.pathname === "/api/tasks") return sendJson(res, tasks);
  if (req.method === "POST" && url.pathname === "/api/tasks/add-batch") return sendJson(res, await addBatch(body.inputText));

  const imageMatch = url.pathname.match(/^\/api\/tasks\/(\d+)\/image\/(\d+)$/);
  if (req.method === "GET" && imageMatch) return sendTaskRemoteMedia(req, res, Number(imageMatch[1]), "images", Number(imageMatch[2]), url.searchParams.has("download"));
  const videoMatch = url.pathname.match(/^\/api\/tasks\/(\d+)\/video$/);
  if (req.method === "GET" && videoMatch) return sendTaskRemoteMedia(req, res, Number(videoMatch[1]), "videoUrl", 0, url.searchParams.has("download"));
  const mediaMatch = url.pathname.match(/^\/api\/tasks\/(\d+)\/media-preview$/);
  if (req.method === "GET" && mediaMatch) return sendJson(res, getTaskMediaPreview(Number(mediaMatch[1])));

  sendJson(res, { error: "not found" }, 404);
}

async function addBatch(inputText) {
  const lines = String(inputText || "").split(/\r?\n/).map((line) => line.trim()).filter(isLikelyShareLine);
  const added = [];
  for (const line of lines) {
    const task = { id: nextTaskId++, ...(await extractShareLine(line)), createdAt: new Date().toISOString() };
    tasks.unshift(task);
    added.push(task);
  }
  return { count: added.length, tasks: added };
}

async function extractShareLine(line) {
  const parsed = parseShareText(line);
  let finalUrl = "";
  let expandError = "";
  let metadata = null;
  if (/v\.douyin\.com/i.test(parsed.shortUrl)) {
    try {
      finalUrl = (await expandUrl(parsed.shortUrl)).finalUrl || "";
    } catch (error) {
      expandError = error.message || String(error);
    }
  }
  let awemeId = "";
  if (parsed.platform === "x" && parsed.shortUrl) {
    try {
      metadata = await fetchXMetadata(parsed.shortUrl);
    } catch (error) {
      expandError = error.message || String(error);
    }
  } else {
    awemeId = extractAwemeId(finalUrl || parsed.shortUrl);
  }
  if (!metadata && awemeId) {
    try {
      metadata = await fetchDouyinMetadataByApi(awemeId);
    } catch (error) {
      expandError = expandError || error.message || String(error);
    }
  }
  const directImages = parsed.urls.filter((x) => /\.(jpe?g|png|webp|gif)(?:[?#]|$)/i.test(x));
  const directVideo = parsed.urls.find((x) => /\.(mp4|webm|mov|mkv)(?:[?#]|$)/i.test(x)) || "";
  const images = metadata?.images?.length ? metadata.images : directImages;
  const videoUrl = metadata?.videoUrl || directVideo;
  const output = {
    awemeId: metadata?.awemeId || awemeId || "",
    mediaType: metadata?.mediaType || (images.length ? "image" : (videoUrl ? "video" : "unknown")),
    images,
    videoUrl,
    httpHeaders: metadata?.httpHeaders || {},
    apiResolved: !!metadata
  };

  return {
    rawText: line,
    title: metadata?.title || parsed.title,
    shortUrl: parsed.shortUrl,
    finalUrl,
    platform: parsed.platform,
    status: images.length || videoUrl ? "extracted" : "failed",
    output,
    error: images.length || videoUrl ? "" : (expandError || "未提取到图片或视频地址")
  };
}

function getTaskMediaPreview(taskId) {
  const task = getTask(taskId);
  if (!task) return { videos: [], images: [], thumbnails: [] };
  const images = Array.isArray(task.output?.images) ? task.output.images.map((_src, i) => ({
    kind: "image",
    name: `${safeFileBase(task.title || task.output?.awemeId || `task-${taskId}`)}_${String(i + 1).padStart(2, "0")}.jpg`,
    url: `/api/tasks/${taskId}/image/${i}`,
    downloadUrl: `/api/tasks/${taskId}/image/${i}?download=1`,
    sizeBytes: 0
  })) : [];
  const videos = task.output?.videoUrl ? [{
    kind: "video",
    name: `${safeFileBase(task.title || task.output?.awemeId || `task-${taskId}`)}.mp4`,
    url: `/api/tasks/${taskId}/video`,
    downloadUrl: `/api/tasks/${taskId}/video?download=1`,
    sizeBytes: 0
  }] : [];
  return { videos, images, thumbnails: [] };
}

function sendTaskRemoteMedia(req, res, taskId, field, index, download) {
  const task = getTask(taskId);
  const source = field === "images" ? task?.output?.images?.[index] : task?.output?.videoUrl;
  if (!source) return sendJson(res, { error: "not found" }, 404);
  const filename = field === "images"
    ? `${safeFileBase(task.title || task.output?.awemeId || `task-${taskId}`)}_${String(index + 1).padStart(2, "0")}.jpg`
    : `${safeFileBase(task.title || task.output?.awemeId || `task-${taskId}`)}.mp4`;
  if (field === "videoUrl" && task.platform === "x") {
    return pipeXVideo(task.shortUrl || task.rawText, res, filename, download);
  }
  return pipeRemoteMedia(res, source, filename, download, req.headers.range || "", task.output?.httpHeaders || {});
}

function pipeRemoteMedia(res, source, filename, download, range = "", extraHeaders = {}, redirects = 0) {
  const parsed = new URL(source);
  if (!["http:", "https:"].includes(parsed.protocol)) return sendJson(res, { error: "bad url" }, 400);
  const client = parsed.protocol === "https:" ? https : http;
  const headers = { ...defaultRemoteHeaders(), ...extraHeaders, ...(range ? { Range: range } : {}) };
  const req = client.get(source, { headers }, (upstream) => {
    if ([301, 302, 303, 307, 308].includes(upstream.statusCode) && upstream.headers.location && redirects < 5) {
      upstream.resume();
      return pipeRemoteMedia(res, new URL(upstream.headers.location, source).toString(), filename, download, range, extraHeaders, redirects + 1);
    }
    if ((upstream.statusCode || 0) >= 400) {
      upstream.resume();
      return sendJson(res, { error: `remote ${upstream.statusCode}` }, 502);
    }
    res.statusCode = upstream.statusCode || 200;
    res.setHeader("Content-Type", upstream.headers["content-type"] || mediaType(filename));
    res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(filename)}`);
    for (const name of ["accept-ranges", "content-length", "content-range"]) {
      if (upstream.headers[name]) res.setHeader(name, upstream.headers[name]);
    }
    upstream.pipe(res);
  });
  req.setTimeout(45000, () => req.destroy(new Error("remote timeout")));
  req.on("error", (error) => {
    if (!res.headersSent) sendJson(res, { error: error.message || String(error) }, 502);
  });
}

function sendStatic(res, pathname) {
  const filePath = path.resolve(publicDir, `.${decodeURIComponent(pathname)}`);
  if (!isInside(publicDir, filePath) || !fs.existsSync(filePath)) return sendJson(res, { error: "not found" }, 404);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "application/javascript; charset=utf-8" }[path.extname(filePath)] || "application/octet-stream");
  fs.createReadStream(filePath).pipe(res);
}

function getTask(taskId) {
  return tasks.find((task) => task.id === Number(taskId)) || null;
}

function isInside(base, filePath) {
  const rel = path.relative(path.resolve(base), path.resolve(filePath));
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function mediaType(filePath) {
  return {
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif"
  }[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (error) {
        error.statusCode = 400;
        reject(error);
      }
    });
  });
}

function sendJson(res, value, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

function defaultRemoteHeaders() {
  return {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36",
    Referer: "https://www.douyin.com/"
  };
}

function safeFileBase(text) {
  return String(text || "media").replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 60) || "media";
}

function isLikelyShareLine(line) {
  const text = String(line || "");
  return /https?:\/\/\S+/i.test(text) || (/抖音|douyin/i.test(text) && /【[^】]+】/.test(text));
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT 无效: ${value}`);
  }
  return port;
}

function resetForTest() {
  tasks.length = 0;
  nextTaskId = 1;
}

module.exports = {
  addBatch,
  getTaskMediaPreview,
  handleRequest,
  resetForTest,
  startServer,
  parseShareText
};
