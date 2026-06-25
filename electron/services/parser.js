const URL_PATTERN = /https?:\/\/[^\s]+/gi;
const TITLE_PATTERN = /【([^】]+)】/;
const TOKEN_PATTERN = /(?<!\S)[a-zA-Z0-9@._-]+:\//g;
const FRAGMENT_PATTERN = /\b[a-zA-Z0-9@._-]{3,}\b/g;
const AD_NOISE_PATTERNS = [
  /^广告[:：]?\s*/i,
  /永久免费使用/i,
  /您的分享是最大支持/i,
  /进入小游戏/i,
  /立即玩/i,
  /使用教程/i,
  /邀请好友/i,
  /历史记录/i,
  /常见问题/i,
  /视频归平台及作者所有/i
];

function cleanUrl(url) {
  return String(url || "").replace(/[，。；;,.!?）)】]+$/g, "");
}

function parseShareText(text) {
  const rawText = String(text || "").trim();
  const cleanedText = stripAdNoise(rawText);
  const urls = (cleanedText.match(URL_PATTERN) || []).map(cleanUrl);
  const shortUrl = urls.find((u) => /v\.douyin\.com/i.test(u)) || urls[0] || "";
  const titleMatch = cleanedText.match(TITLE_PATTERN);
  const title = titleMatch ? titleMatch[1].trim() : "";

  const withoutUrls = cleanedText.replace(URL_PATTERN, " ");
  const tokens = withoutUrls.match(TOKEN_PATTERN) || [];
  const fragments = withoutUrls.match(FRAGMENT_PATTERN) || [];
  const codeFragments = [];
  const seen = new Set();
  for (const value of [...tokens, ...fragments]) {
    if (!value || value.length < 4) continue;
    if (/^\d+([./-]\d+)*$/.test(value)) continue;
    if (/^(复制打开抖音极速版|复制打开抖音|看看)$/.test(value)) continue;
    if (!seen.has(value)) {
      seen.add(value);
      codeFragments.push(value);
    }
  }

  let appHint = "";
  if (cleanedText.includes("抖音极速版")) appHint = "抖音极速版";
  else if (cleanedText.includes("抖音")) appHint = "抖音";

  return {
    rawText,
    cleanedText,
    urls,
    shortUrl,
    title,
    appHint,
    platform: /douyin|抖音/i.test(cleanedText) ? "douyin" : "",
    codeFragments
  };
}

function stripAdNoise(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);

  const kept = [];
  for (const line of lines) {
    if (AD_NOISE_PATTERNS.some((p) => p.test(line))) continue;
    kept.push(line);
  }

  // If the source contains a real share URL, prefer the line/segment around that URL.
  const joined = kept.join(" ");
  const shareMatch = joined.match(/.{0,80}https?:\/\/(?:v\.)?douyin\.com\/[^\s]+.{0,60}/i);
  if (shareMatch) {
    return shareMatch[0].trim();
  }
  return joined.trim();
}

module.exports = { parseShareText };
