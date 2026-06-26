const { spawn } = require("child_process");
const { detectYtDlpRunner } = require("./probe");

async function fetchXMetadata(url) {
  const runner = await detectYtDlpRunner();
  let info = null;
  let lastError = null;
  for (let i = 0; i < 3; i += 1) {
    try {
      info = await dumpYtDlpJson(runner, url);
      break;
    } catch (error) {
      lastError = error;
      if (!/SSL|EOF|timeout|timed out|Unable to download JSON metadata/i.test(error.message || "")) break;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  if (!info) throw lastError || new Error("X 视频提取失败");
  const videoUrl = pickVideoUrl(info);
  if (!videoUrl) throw new Error("未提取到 X 视频地址");
  return {
    title: info.title || "",
    videoUrl,
    httpHeaders: info.http_headers || {}
  };
}

async function pipeXVideo(url, res, filename = "x-video.mp4", download = false) {
  const runner = await detectYtDlpRunner();
  const format = download ? "best[ext=mp4]/best" : "worst[ext=mp4]/worst";
  const args = [...runner.prefixArgs, "-f", format, "--no-playlist", "-o", "-", url];
  const child = spawn(runner.command, args, { windowsHide: true });
  let stderr = "";
  let sent = false;
  let closed = false;

  res.on("close", () => {
    closed = true;
    try { if (!child.killed) child.kill(); } catch (_error) {}
  });
  child.stderr.on("data", (b) => { stderr += b.toString(); });
  child.stdout.on("data", (chunk) => {
    if (closed) return;
    if (!sent) {
      sent = true;
      res.writeHead(200, {
        "Content-Type": "video/mp4",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(filename)}`
      });
    }
    res.write(chunk);
  });
  child.stdout.on("end", () => {
    if (sent && !res.writableEnded) res.end();
  });
  child.on("error", (error) => {
    if (!sent && !res.writableEnded) {
      res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: error.message || String(error) }));
    }
  });
  child.on("close", (code) => {
    if (sent || res.writableEnded) return;
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({
      error: stderr.trim().split(/\r?\n/).filter(Boolean).pop() || `yt-dlp 退出码 ${code}`
    }));
  });
  child.stdin?.end?.();
}

function dumpYtDlpJson(runner, url) {
  return new Promise((resolve, reject) => {
    const args = [...runner.prefixArgs, "--dump-single-json", "-f", "best[ext=mp4]/best", "--no-playlist", url];
    const child = spawn(runner.command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer = null;
    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    timer = setTimeout(() => {
      try { if (!child.killed) child.kill(); } catch (_error) {}
      done(reject, new Error("X 视频提取超时"));
    }, 30000);
    child.stdout.on("data", (b) => { stdout += b.toString(); });
    child.stderr.on("data", (b) => { stderr += b.toString(); });
    child.on("error", (error) => done(reject, error));
    child.on("close", (code) => {
      if (code !== 0) return done(reject, new Error(stderr.trim().split(/\r?\n/).pop() || `yt-dlp 退出码 ${code}`));
      try { done(resolve, JSON.parse(stdout)); } catch (error) { done(reject, error); }
    });
  });
}

function pickVideoUrl(info) {
  if (info.url && /^https?:/i.test(info.url)) return info.url;
  const formats = Array.isArray(info.formats) ? info.formats : [];
  const videos = formats.filter((f) => f.url && f.vcodec && f.vcodec !== "none");
  videos.sort((a, b) => Number(b.height || 0) - Number(a.height || 0));
  return videos[0]?.url || "";
}

module.exports = { fetchXMetadata, pickVideoUrl, pipeXVideo };
