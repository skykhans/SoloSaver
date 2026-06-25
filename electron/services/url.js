const http = require("http");
const https = require("https");

function expandUrl(url, maxRedirects = 8) {
  return new Promise((resolve, reject) => {
    follow(url, 0);

    function follow(currentUrl, depth) {
      if (!currentUrl) return reject(new Error("empty url"));
      if (depth > maxRedirects) {
        return resolve({ inputUrl: url, finalUrl: currentUrl, redirects: depth, truncated: true });
      }

      const client = currentUrl.startsWith("https:") ? https : http;
      const req = client.request(
        currentUrl,
        {
          method: "GET",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36"
          }
        },
        (res) => {
          const status = res.statusCode || 0;
          const location = res.headers.location;
          if (location && [301, 302, 303, 307, 308].includes(status)) {
            const nextUrl = new URL(location, currentUrl).toString();
            res.resume();
            return follow(nextUrl, depth + 1);
          }
          res.resume();
          resolve({ inputUrl: url, finalUrl: currentUrl, redirects: depth });
        }
      );
      req.setTimeout(12000, () => req.destroy(new Error("request timeout")));
      req.on("error", reject);
      req.end();
    }
  });
}

module.exports = { expandUrl };
