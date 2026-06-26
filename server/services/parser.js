const URL_PATTERN = /https?:\/\/[^\s，。；！？）)】]+/gi;
const TITLE_PATTERN = /【([^】]+)】/;

function cleanUrl(url) {
  return String(url || "").replace(/[，。；;,.!?）)】]+$/g, "");
}

function parseShareText(text) {
  const rawText = String(text || "").trim();
  const urls = (rawText.match(URL_PATTERN) || []).map(cleanUrl);
  const shortUrl = urls.find((u) => /v\.douyin\.com/i.test(u)) || urls[0] || "";
  const titleMatch = rawText.match(TITLE_PATTERN);
  const title = titleMatch ? titleMatch[1].trim() : "";
  const platform = /douyin|抖音/i.test(rawText) ? "douyin" : (/https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i.test(rawText) ? "x" : "");

  return {
    rawText,
    urls,
    shortUrl,
    title,
    platform
  };
}

module.exports = { parseShareText };
