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
  throw lastError || new Error("metadata API unavailable");
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
