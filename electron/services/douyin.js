const axios = require("axios");

function extractAwemeId(url) {
  if (!url) return "";
  const patterns = [/\/video\/(\d+)/i, /\/note\/(\d+)/i, /modal_id=(\d+)/i, /aweme_id=(\d+)/i];
  for (const p of patterns) {
    const m = String(url).match(p);
    if (m) return m[1];
  }
  return "";
}

async function fetchDouyinMetadataByApi(awemeId) {
  if (!awemeId) throw new Error("missing aweme id");
  const endpoints = [
    `https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=${encodeURIComponent(awemeId)}`,
    `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${encodeURIComponent(awemeId)}&aid=6383&channel=channel_pc_web`
  ];

  let lastError = null;
  for (const url of endpoints) {
    try {
      const res = await axios.get(url, {
        timeout: 15000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36",
          Referer: "https://www.douyin.com/"
        },
        validateStatus: () => true
      });
      if (res.status >= 200 && res.status < 300) {
        const normalized = normalizeAwemeResponse(res.data, awemeId);
        if (normalized) return normalized;
        lastError = new Error("api response missing aweme detail");
        continue;
      }
      lastError = new Error(`status ${res.status}`);
    } catch (error) {
      lastError = error;
    }
  }
  try {
    const fromSharePage = await fetchDouyinMetadataBySharePage(awemeId);
    if (fromSharePage) return fromSharePage;
  } catch (error) {
    lastError = error;
  }
  throw lastError || new Error("metadata API unavailable");
}

async function fetchDouyinMetadataBySharePage(awemeId) {
  const res = await axios.get(`https://www.iesdouyin.com/share/video/${encodeURIComponent(awemeId)}/`, {
    timeout: 15000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/122.0 Mobile Safari/537.36",
      Referer: "https://www.iesdouyin.com/"
    },
    validateStatus: () => true
  });
  if (res.status < 200 || res.status >= 300) throw new Error(`share page status ${res.status}`);

  const html = decodeHtml(String(res.data || ""));
  const routerData = extractWindowJson(html, "_ROUTER_DATA");
  const videoInfoRes = routerData?.loaderData?.["video_(id)/page"]?.videoInfoRes
    || routerData?.loaderData?.["note_(id)/page"]?.videoInfoRes;
  const normalized = normalizeAwemeResponse(videoInfoRes, awemeId);
  if (normalized && (normalized.videoUrl || normalized.images.length)) return normalized;

  const images = [];
  const seen = new Set();
  for (const match of html.matchAll(/<img\b[^>]+\bsrc=["']([^"']*douyinpic\.com[^"']*)["']/gi)) {
    const url = match[1];
    if (!/biz_tag=aweme_images/i.test(url)) continue;
    if (!seen.has(url)) {
      seen.add(url);
      images.push(url);
    }
  }
  if (!images.length) throw new Error("share page missing media urls");

  const title = (html.match(/<title[^>]*>([^<]+)/i)?.[1] || "").replace(/\s*-\s*抖音\s*$/, "").trim();
  return {
    awemeId,
    title,
    mediaType: "image",
    images,
    videoUrl: ""
  };
}

function normalizeAwemeResponse(data, awemeId) {
  const detail = data?.item_list?.[0] || data?.aweme_detail || data?.data?.aweme_detail;
  if (!detail) return null;
  const images = [];
  const imageGroups = detail.images || detail.image_post_info?.images || [];
  for (const img of imageGroups) {
    const url =
      img?.url_list?.[0] ||
      img?.display_image?.url_list?.[0] ||
      img?.owner_watermark_image?.url_list?.[0] ||
      "";
    if (url) images.push(url);
  }
  const videoUrl =
    detail?.video?.play_addr?.url_list?.[0] ||
    detail?.video?.bit_rate?.[0]?.play_addr?.url_list?.[0] ||
    "";

  return {
    awemeId,
    title: detail?.desc || "",
    mediaType: images.length ? "image" : (videoUrl ? "video" : "unknown"),
    images,
    videoUrl
  };
}

module.exports = { extractAwemeId, fetchDouyinMetadataByApi };

function decodeHtml(text) {
  return text
    .replace(/\\u002[fF]/g, "/")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"");
}

function extractWindowJson(html, name) {
  const start = html.indexOf(`window.${name} = `);
  if (start < 0) return null;
  const from = start + `window.${name} = `.length;
  const end = html.indexOf("</script>", from);
  if (end < 0) return null;
  try {
    return JSON.parse(html.slice(from, end).trim());
  } catch (_error) {
    return null;
  }
}
