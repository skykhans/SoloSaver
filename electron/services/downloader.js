const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const https = require("https");
const http = require("http");
const sanitize = require("sanitize-filename");
const { parseShareText } = require("./parser");
const { expandUrl } = require("./url");
const { extractAwemeId, fetchDouyinMetadataByApi } = require("./douyin");

function createDownloader({ db, onTaskUpdate, onLog, onProgress }) {
  let running = false;
  let stopRequested = false;
  let activeChild = null;
  let resolvedYtDlpRunner = null;

  const log = (message, level = "info") => onLog && onLog({ ts: new Date().toISOString(), level, message });
  const emit = (task) => onTaskUpdate && onTaskUpdate(task);

  async function start() {
    if (running) return;
    try {
      resolvedYtDlpRunner = await detectYtDlpRunner(log);
    } catch (error) {
      resolvedYtDlpRunner = null;
      log(`未检测到 yt-dlp，将仅使用免登录直链模式（失败时无法使用兜底）: ${error.message}`, "warn");
    }
    running = true;
    stopRequested = false;
    log("开始处理下载队列");
    try {
      while (!stopRequested) {
        const next = db.getNextQueuedTask();
        if (!next) break;
        await processTask(next.id);
      }
    } finally {
      running = false;
      activeChild = null;
      log("下载队列已停止");
    }
  }

  function stop() {
    stopRequested = true;
    if (activeChild && !activeChild.killed) activeChild.kill();
    log("收到停止请求", "warn");
  }

  async function processTask(taskId) {
    let task = db.getTask(taskId);
    if (!task) return;
    task = db.updateTask({ id: task.id, status: "resolving", error: "" });
    emit(task);

    const parsed = parseShareText(task.rawText);
    let finalUrl = task.finalUrl;
    if (!finalUrl && parsed.shortUrl) {
      try {
        finalUrl = (await expandUrl(parsed.shortUrl)).finalUrl || "";
      } catch (_error) {
        finalUrl = "";
      }
    }

    const awemeId = extractAwemeId(finalUrl || parsed.shortUrl);
    let metadata = null;
    if (awemeId) {
      try {
        metadata = await fetchDouyinMetadataByApi(awemeId);
      } catch (error) {
        log(`任务#${task.id} 元数据接口失败: ${error.message}`, "warn");
      }
    }

    const settings = db.getSettings();
    const taskDir = path.join(
      settings.downloadDir,
      buildTaskFolderName(task.id, metadata?.awemeId || awemeId, metadata?.title || parsed.title || task.title)
    );
    fs.mkdirSync(taskDir, { recursive: true });

    task = db.updateTask({
      id: task.id,
      title: metadata?.title || parsed.title || task.title,
      shortUrl: parsed.shortUrl || task.shortUrl,
      finalUrl: finalUrl || task.finalUrl,
      platform: parsed.platform || task.platform,
      appHint: parsed.appHint || task.appHint,
      codeFragments: parsed.codeFragments || task.codeFragments,
      downloadDir: taskDir,
      status: "downloading",
      output: metadata
        ? {
            awemeId: metadata.awemeId,
            mediaType: metadata.mediaType,
            imageCount: metadata.images.length,
            hasVideo: Boolean(metadata.videoUrl),
            apiResolved: true
          }
        : { awemeId: awemeId || "", apiResolved: false },
      error: ""
    });
    emit(task);

    const url = task.finalUrl || task.shortUrl || parsed.shortUrl;
    if (!url) {
      task = db.updateTask({ id: task.id, status: "failed", error: "未找到分享链接" });
      emit(task);
      return;
    }

    try {
      let downloadedBy = "";
      const mediaUrls = parsed.urls;
      if (mediaUrls.length) {
        try {
          downloadedBy = await downloadInputMediaUrls({
            taskId: task.id,
            taskDir,
            urls: mediaUrls,
            title: parsed.title || task.title,
            log,
            onProgress: (progress) => onProgress && onProgress(progress)
          });
        } catch (directError) {
          log(`任务#${task.id} 输入链接不是可下载媒体直链: ${directError.message}`, "warn");
        }
      }
      if (!downloadedBy && metadata && (metadata.videoUrl || (metadata.images && metadata.images.length))) {
        try {
          downloadedBy = await downloadByDirectLinks({
            taskId: task.id,
            taskDir,
            metadata,
            log,
            onProgress: (progress) => onProgress && onProgress(progress)
          });
        } catch (directError) {
          log(`任务#${task.id} 免登录直链下载失败，转用 yt-dlp 兜底: ${directError.message}`, "warn");
        }
      }

      if (!downloadedBy) {
        const ytDlpUrl = awemeId && /douyin\.com\/note\//i.test(url) ? `https://www.douyin.com/video/${awemeId}` : url;
      await runYtDlp(
        task.id,
        ytDlpUrl,
        taskDir,
        (child) => (activeChild = child),
        log,
        (progress) => onProgress && onProgress(progress),
        resolvedYtDlpRunner,
        db.getSettings().cookieBrowser || "auto",
        db.getSettings().cookiesTxtPath || "",
        !!db.getSettings().cookiesTxtOnlyMode
      );
        downloadedBy = "yt-dlp";
      }
      task = db.updateTask({
        id: task.id,
        status: "completed",
        downloadedCount: countFiles(taskDir),
        output: {
          ...(task.output || {}),
          downloadMethod: downloadedBy
        },
        error: ""
      });
      emit(task);
      log(`任务#${task.id} 完成（${downloadedBy}）`);
    } catch (error) {
      task = db.updateTask({
        id: task.id,
        status: stopRequested ? "queued" : "failed",
        error: error.message || String(error)
      });
      emit(task);
      log(`任务#${task.id} 失败: ${task.error}`, "error");
    } finally {
      activeChild = null;
    }
  }

  return {
    start,
    stop,
    isRunning: () => running,
    checkTools: async () => {
      try {
        const runner = await detectYtDlpRunner(log);
        return { ok: true, ytDlp: runner.label };
      } catch (error) {
        return { ok: false, error: error.message || String(error), optional: true };
      }
    },
    checkCookieLogin: async ({ browser = "auto", url = "", cookiesTxtOnlyMode = false } = {}) => {
      try {
        const runner = await detectYtDlpRunner(log);
        const targetUrl = String(url || "").trim() || "https://www.douyin.com/video/7608097922970635443";
        const cookiesTxtPath = db.getSettings().cookiesTxtPath || "";
        let attempts = buildCookieAttempts(runner, browser, cookiesTxtPath, { cookiesTxtOnlyMode })
          .filter((a) => a.extraArgs.length > 0 || browser === "auto");
        const cookiesTxtAttempt = attempts.find((a) => /\bcookies\.txt\b/i.test(a.label));
        if (cookiesTxtAttempt) {
          // 检测按钮优先只验证导入的 cookies.txt，避免浏览器 DPAPI/数据库占用干扰判断。
          attempts = [cookiesTxtAttempt];
        }

        for (const attempt of attempts) {
          const probe = await probeYtDlpLoginCheck(runner, attempt, targetUrl);
          if (probe.ok) {
            return { ok: true, browserTried: attempt.label, message: `登录态可用（${attempt.label}）` };
          }
          if (probe.needFreshCookies || probe.cookieDbLocked) {
            continue;
          }
          return { ok: false, browserTried: attempt.label, message: probe.message || `检测失败（${attempt.label}）` };
        }

        if (cookiesTxtAttempt) {
          return {
            ok: false,
            message: "已导入 cookies.txt，但未通过认证。可能是导出不完整、内容不匹配当前抖音请求，或被风控拦截。请在抖音网页标签页重新导出 cookies.txt 后重试。"
          };
        }
        return {
          ok: false,
          message: "Cookie 登录态不可用，或浏览器 Cookie 数据库被占用。请登录抖音网页版并彻底关闭浏览器后重试。"
        };
      } catch (error) {
        return { ok: false, message: error.message || String(error) };
      }
    }
    ,
    runYtDlpSimulateProbe: async ({ browser = "auto", url = "", cookiesTxtOnlyMode = false } = {}) => {
      try {
        const runner = await detectYtDlpRunner(log);
        const targetUrl = String(url || "").trim() || "https://www.douyin.com/video/7608097922970635443";
        const cookiesTxtPath = db.getSettings().cookiesTxtPath || "";
        let attempts = buildCookieAttempts(runner, browser, cookiesTxtPath, { cookiesTxtOnlyMode })
          .filter((a) => a.extraArgs.length > 0 || browser === "auto");
        const cookiesTxtAttempt = attempts.find((a) => /\bcookies\.txt\b/i.test(a.label));
        if (cookiesTxtAttempt) attempts = [cookiesTxtAttempt, ...attempts.filter((a) => a !== cookiesTxtAttempt)];

        const results = [];
        for (const attempt of attempts) {
          const probe = await probeYtDlpLoginCheck(runner, attempt, targetUrl);
          const detail = classifyProbeFailure(probe);
          results.push({
            label: attempt.label,
            ok: !!probe.ok,
            message: probe.message || "",
            detailCode: detail.code,
            detailText: detail.text
          });
          if (probe.ok) break;
        }
        const firstOk = results.find((x) => x.ok);
        return {
          ok: !!firstOk,
          summary: firstOk ? `自检通过（${firstOk.label}）` : "自检未通过",
          results
        };
      } catch (error) {
        return { ok: false, summary: error.message || String(error), results: [] };
      }
    }
  };
}

function buildTaskFolderName(taskId, awemeId, title) {
  const safe = sanitize(String(title || "").slice(0, 60)).trim() || "untitled";
  return `${String(taskId).padStart(5, "0")}_${awemeId || "unknown"}_${safe}`;
}

function countFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir, { withFileTypes: true }).filter((x) => x.isFile()).length;
}

async function downloadInputMediaUrls({ taskId, taskDir, urls, title, log, onProgress }) {
  let saved = 0;
  let lastError = null;
  for (const url of urls) {
    saved += 1;
    const ext = path.extname(new URL(url).pathname) || ".bin";
    const name = sanitize(String(title || "media").slice(0, 60)).trim() || "media";
    try {
      await downloadToFile(url, path.join(taskDir, `${name}_${String(saved).padStart(2, "0")}${ext}`), {
        headers: defaultHttpHeaders(),
        mediaOnly: true,
        onProgress: (p) => onProgress && onProgress({ taskId, ...p })
      });
      log(`任务#${taskId} 输入媒体直链下载 ${saved}/${urls.length}`);
    } catch (error) {
      saved -= 1;
      lastError = error;
    }
  }
  if (!saved) throw lastError || new Error("未找到媒体直链");
  return "input-media";
}

async function downloadByDirectLinks({ taskId, taskDir, metadata, log, onProgress }) {
  const titleBase = sanitize(String(metadata.title || metadata.awemeId || "douyin").slice(0, 60)).trim() || "douyin";
  if (metadata.mediaType === "image" && metadata.images?.length) {
    let index = 0;
    for (const imgUrl of metadata.images) {
      index += 1;
      const filePath = path.join(taskDir, `${titleBase}_${String(index).padStart(2, "0")}.jpg`);
      await downloadToFile(imgUrl, filePath, {
        headers: defaultHttpHeaders(),
        onProgress: (p) => {
          const totalPercent = ((index - 1) / metadata.images.length) * 100 + (p.percent || 0) / metadata.images.length;
          onProgress && onProgress({
            taskId,
            percent: totalPercent,
            totalText: `${index}/${metadata.images.length}`,
            speedText: p.speedText || "",
            etaText: ""
          });
        }
      });
      log(`任务#${taskId} 直链下载图片 ${index}/${metadata.images.length}`);
    }
    return "direct-image";
  }

  if (metadata.videoUrl) {
    const filePath = path.join(taskDir, `${titleBase}_${metadata.awemeId || "video"}.mp4`);
    await downloadToFile(metadata.videoUrl, filePath, {
      headers: defaultHttpHeaders(),
      onProgress: (p) => {
        onProgress && onProgress({
          taskId,
          percent: p.percent || 0,
          totalText: p.totalText || "",
          speedText: p.speedText || "",
          etaText: p.etaText || ""
        });
      }
    });
    log(`任务#${taskId} 直链下载视频完成`);
    return "direct-video";
  }

  throw new Error("metadata has no direct media urls");
}

function downloadToFile(url, filePath, { headers = {}, onProgress, mediaOnly = false } = {}) {
  return new Promise((resolve, reject) => {
    const client = String(url).startsWith("https:") ? https : http;
    const startedAt = Date.now();
    const req = client.request(url, { method: "GET", headers }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const nextUrl = new URL(res.headers.location, url).toString();
        res.resume();
        return resolve(downloadToFile(nextUrl, filePath, { headers, onProgress, mediaOnly }));
      }
      if ((res.statusCode || 0) >= 400) {
        const code = res.statusCode;
        res.resume();
        return reject(new Error(`直链下载失败 HTTP ${code}`));
      }
      const contentType = String(res.headers["content-type"] || "").split(";")[0].toLowerCase();
      const isMedia = contentType.startsWith("image/") || contentType.startsWith("video/");
      const maybeMedia = (!contentType || contentType === "application/octet-stream") && isMediaLikeUrl(url);
      if (mediaOnly && !isMedia && !maybeMedia) {
        res.resume();
        return reject(new Error("不是图片/视频直链"));
      }

      const total = Number(res.headers["content-length"] || 0);
      let received = 0;
      const finalPath = path.extname(filePath) === ".bin" ? filePath.replace(/\.bin$/, extFromContentType(contentType)) : filePath;
      const writer = fs.createWriteStream(finalPath);
      res.on("data", (chunk) => {
        received += chunk.length;
        if (onProgress && total > 0) {
          const elapsedSec = Math.max(1, (Date.now() - startedAt) / 1000);
          const speed = received / elapsedSec;
          onProgress({
            percent: (received / total) * 100,
            totalText: formatBytes(total),
            speedText: `${formatBytes(speed)}/s`
          });
        }
      });
      res.pipe(writer);
      writer.on("finish", () => {
        writer.close(() => resolve());
      });
      writer.on("error", (error) => {
        try { writer.close(() => {}); } catch (_e) {}
        reject(error);
      });
      res.on("error", reject);
    });
    req.setTimeout(20000, () => req.destroy(new Error("直链下载超时")));
    req.on("error", reject);
    req.end();
  });
}

function defaultHttpHeaders() {
  return {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36",
    Referer: "https://www.douyin.com/"
  };
}

function isMediaLikeUrl(url) {
  return /\.(mp4|m4v|mov|webm|mkv|jpg|jpeg|png|webp|gif)(?:[?#]|$)/i.test(String(url || ""));
}

function extFromContentType(contentType) {
  return {
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif"
  }[contentType] || ".bin";
}

function runYtDlp(taskId, url, outDir, onSpawn, log, onProgress, runner, cookieBrowserPref = "auto", cookiesTxtPath = "", cookiesTxtOnlyMode = false) {
  return new Promise((resolve, reject) => {
    if (!runner) {
      reject(new Error("未检测到可用下载器。请安装 yt-dlp，或安装 Python 包 yt-dlp（python -m yt_dlp）。"));
      return;
    }
    const baseArgs = [
      "--ignore-config",
      "--no-mtime",
      "--write-info-json",
      "--write-thumbnail",
      "-P",
      outDir,
      "-o",
      "%(uploader|unknown)s_%(id|unknown)s_%(title).120B.%(ext)s",
      url
    ];
    const attempts = buildCookieAttempts(runner, cookieBrowserPref, cookiesTxtPath, { cookiesTxtOnlyMode });
    const profiles = buildYtDlpFallbackProfiles();

    runAttempt(0, 0);

    function runAttempt(profileIndex, attemptIndex) {
      const profile = profiles[profileIndex];
      if (!profile) {
        reject(new Error("下载失败：抖音返回风控校验（Fresh cookies）。请重新导出更“新”的 cookies.txt，或稍后重试。"));
        return;
      }
      const attempt = attempts[attemptIndex];
      if (!attempt) {
        reject(new Error("下载失败：请先在 Edge/Chrome 登录抖音，并关闭浏览器后重试"));
        return;
      }

      const spawnArgs = [...runner.prefixArgs, ...attempt.extraArgs, ...profile.extraArgs, ...baseArgs];
      const child = spawn(runner.command, spawnArgs, { windowsHide: true });
      onSpawn && onSpawn(child);
      log(`任务#${taskId} 启动下载器: ${attempt.label}${profile.labelSuffix}`);

      let stderr = "";
      let stdoutTail = "";
      child.stdout.on("data", (buf) => {
        const text = buf.toString();
        stdoutTail += text;
        const lines = text.split(/\r?\n/).filter(Boolean);
        for (const line of lines.slice(-2)) {
          log(`任务#${taskId} ${line}`);
          const parsed = parseYtDlpProgressLine(line);
          if (parsed) onProgress && onProgress({ taskId, ...parsed });
        }
      });
      child.stderr.on("data", (buf) => {
        const text = buf.toString();
        stderr += text;
        const lines = text.split(/\r?\n/).filter(Boolean);
        for (const line of lines.slice(-2)) {
          if (/\[download\]/i.test(line)) log(`任务#${taskId} ${line}`);
          const parsed = parseYtDlpProgressLine(line);
          if (parsed) onProgress && onProgress({ taskId, ...parsed });
        }
      });
      child.on("error", (error) => {
        if (error.code === "ENOENT") return reject(new Error("未找到 yt-dlp，请先安装并加入 PATH"));
        reject(error);
      });
      child.on("close", (code) => {
        if (code === 0) return resolve();

        const combined = `${stdoutTail}\n${stderr}`;
        const lastLine = combined.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] || `yt-dlp 退出码 ${code}`;
        if (isUnsupportedImpersonateError(combined)) {
          if (profileIndex < profiles.length - 1) {
            log(`任务#${taskId} 当前 yt-dlp 不支持浏览器伪装参数，跳过该模式，继续尝试下一个备用模式`, "warn");
            runAttempt(profileIndex + 1, 0);
            return;
          }
          log(`任务#${taskId} 当前 yt-dlp 不支持浏览器伪装参数，已跳过该模式`, "warn");
          reject(new Error("当前 yt-dlp 不支持浏览器伪装模式，且前序模式均未成功（多数为抖音风控 Fresh cookies）。建议升级 yt-dlp、重新导出更“新”的 cookies.txt，或稍后重试。"));
          return;
        }
        if (shouldRetryWithNextCookieAttempt(combined) && attemptIndex < attempts.length - 1) {
          log(`任务#${taskId} 检测到 Cookie 问题，自动重试 (${attempts[attemptIndex + 1].label}${profile.labelSuffix})`, "warn");
          runAttempt(profileIndex, attemptIndex + 1);
          return;
        }
        if (shouldRetryWithFallbackProfile(combined) && profileIndex < profiles.length - 1) {
          log(`任务#${taskId} 检测到抖音风控/响应异常，切换备用下载模式重试（${profiles[profileIndex + 1].name}）`, "warn");
          runAttempt(profileIndex + 1, 0);
          return;
        }
        if (isCookieDbCopyError(combined)) {
          if (profileIndex < profiles.length - 1) {
            log(`任务#${taskId} 浏览器 Cookie 数据库不可用，继续尝试备用下载模式（${profiles[profileIndex + 1].name}）`, "warn");
            runAttempt(profileIndex + 1, 0);
            return;
          }
          reject(new Error("无法读取浏览器 Cookie（Cookie 数据库被占用）。请关闭 Edge/Chrome 所有窗口和后台进程后重试。"));
          return;
        }
        reject(new Error(lastLine));
      });
    }
  });
}

function buildYtDlpFallbackProfiles() {
  const commonHeaders = [
    "--add-header", "Referer:https://www.douyin.com/",
    "--add-header", "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36"
  ];
  return [
    { name: "默认模式", labelSuffix: "", extraArgs: [] },
    { name: "请求头+IPv4", labelSuffix: " [备用:Headers+IPv4]", extraArgs: [...commonHeaders, "--force-ipv4"] },
    { name: "浏览器伪装", labelSuffix: " [备用:Impersonate]", extraArgs: ["--impersonate", "chrome", ...commonHeaders] }
  ];
}

function parseYtDlpProgressLine(line) {
  const text = String(line || "");
  const m = text.match(/\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+([^\s]+)(?:\s+at\s+([^\s]+))?(?:\s+ETA\s+([0-9:]+))?/i);
  if (!m) return null;
  return {
    percent: Number(m[1]),
    totalText: m[2] || "",
    speedText: m[3] || "",
    etaText: m[4] || ""
  };
}

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

function needsFreshCookies(text) {
  return /Fresh cookies .* needed/i.test(String(text || ""));
}

function isCookieDbCopyError(text) {
  return /Could not copy Chrome cookie database/i.test(String(text || ""))
    || /Failed to decrypt with DPAPI/i.test(String(text || ""));
}

function shouldRetryWithNextCookieAttempt(text) {
  const s = String(text || "");
  return needsFreshCookies(s) || isCookieDbCopyError(s);
}

function shouldRetryWithFallbackProfile(text) {
  const s = String(text || "");
  return needsFreshCookies(s) || /Failed to parse JSON/i.test(s);
}

function isUnsupportedImpersonateError(text) {
  return /Impersonate target .* is not available/i.test(String(text || ""))
    || /--list-impersonate-targets/i.test(String(text || ""));
}

function buildCookieAttempts(runner, pref, cookiesTxtPath = "", options = {}) {
  const cookiesTxtOnlyMode = !!options.cookiesTxtOnlyMode;
  const base = { label: runner.label, extraArgs: [] };
  const cookiesTxt = (isUsableCookiesTxt(cookiesTxtPath))
    ? { label: `${runner.label} + cookies.txt`, extraArgs: ["--cookies", cookiesTxtPath] }
    : null;
  const edge = { label: `${runner.label} + Edge Cookies`, extraArgs: ["--cookies-from-browser", "edge"] };
  const edgeProfile = { label: `${runner.label} + Edge Cookies (Profile 4)`, extraArgs: ["--cookies-from-browser", "edge:Profile 4"] };
  const chrome = { label: `${runner.label} + Chrome Cookies`, extraArgs: ["--cookies-from-browser", "chrome"] };
  const list = [];
  if (cookiesTxt) list.push(cookiesTxt); // Always prefer explicit cookies.txt
  if (cookiesTxtOnlyMode) {
    return cookiesTxt ? [cookiesTxt, base] : [base];
  }
  // 即使用户偏好 Edge/Chrome，也先给无浏览器数据库依赖的模式机会，减少 DPAPI/数据库占用导致的提前失败。
  if (pref === "edge") return [...list, base, edgeProfile, edge, chrome];
  if (pref === "chrome") return [...list, base, chrome, edge];
  return [...list, base, edge, chrome];
}

function isUsableCookiesTxt(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  if (lines.length < 3 || !lines.some((line) => /douyin\.com/i.test(line))) return false;
  const names = new Set(lines.map((line) => line.split("\t")[5]).filter(Boolean));
  return ["ttwid", "sessionid", "odin_tt", "passport_csrf_token"].some((name) => names.has(name));
}

async function detectYtDlpRunner(log) {
  const candidates = [
    { label: "yt-dlp", command: "yt-dlp", prefixArgs: [] },
    { label: "python -m yt_dlp", command: "python", prefixArgs: ["-m", "yt_dlp"] },
    { label: "py -m yt_dlp", command: "py", prefixArgs: ["-m", "yt_dlp"] }
  ];

  for (const candidate of candidates) {
    const ok = await probeCommand(candidate.command, [...candidate.prefixArgs, "--version"]);
    if (ok) {
      log(`检测到可用下载器: ${candidate.label}`);
      return candidate;
    }
  }

  throw new Error(
    "未检测到 yt-dlp。请安装 yt-dlp 并加入 PATH，或执行: python -m pip install -U yt-dlp"
  );
}

function probeCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true });
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.on("error", () => finish(false));
    child.on("close", (code) => finish(code === 0));
    setTimeout(() => {
      try {
        if (!child.killed) child.kill();
      } catch (_error) {}
      finish(false);
    }, 5000);
  });
}

function probeYtDlpLoginCheck(runner, attempt, url) {
  return new Promise((resolve) => {
    const args = [
      ...runner.prefixArgs,
      ...attempt.extraArgs,
      "--ignore-config",
      "--simulate",
      "--skip-download",
      url
    ];
    const child = spawn(runner.command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const done = (val) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };
    child.stdout.on("data", (b) => { stdout += b.toString(); });
    child.stderr.on("data", (b) => { stderr += b.toString(); });
    child.on("error", (error) => done({ ok: false, message: error.message || String(error) }));
    child.on("close", (code) => {
      const text = `${stdout}\n${stderr}`;
      if (code === 0) return done({ ok: true });
      done({
        ok: false,
        needFreshCookies: needsFreshCookies(text),
        cookieDbLocked: isCookieDbCopyError(text),
        message: text.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] || `yt-dlp 退出码 ${code}`
      });
    });
    setTimeout(() => {
      try { if (!child.killed) child.kill(); } catch (_error) {}
      done({ ok: false, message: "检测超时，请稍后重试" });
    }, 12000);
  });
}

function classifyProbeFailure(probe) {
  const msg = String(probe?.message || "");
  if (!probe || probe.ok) return { code: "ok", text: "通过" };
  if (/Fresh cookies .* needed/i.test(msg)) return { code: "fresh_cookies", text: "抖音要求更“新”的 Cookies（风控/环境校验）" };
  if (/Failed to parse JSON/i.test(msg)) return { code: "json_parse", text: "抖音返回非预期内容（常见于风控拦截）" };
  if (/Failed to decrypt with DPAPI/i.test(msg)) return { code: "dpapi", text: "浏览器 Cookie 解密失败（DPAPI）" };
  if (/Could not copy Chrome cookie database/i.test(msg)) return { code: "cookie_db_locked", text: "浏览器 Cookie 数据库被占用" };
  return { code: "unknown", text: "未知错误（见原始信息）" };
}

module.exports = { createDownloader };
