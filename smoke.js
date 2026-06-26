const assert = require("assert");
const http = require("http");
const { resetForTest, startServer } = require("./server");

(async () => {
  resetForTest();
  const upstream = await startUpstream();
  const server = startServer(0);
  await onceListening(server);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const html = await fetchText(`${base}/`);
    assert.match(html, /短视频素材下载/);
    const script = await fetch(`${base}/renderer.js?v=7`);
    assert.strictEqual(script.status, 200);
    assert.match(script.headers.get("content-type") || "", /application\/javascript/);

    const added = await fetchJson(`${base}/api/tasks/add-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputText: "【烟测视频】 https://example.com/smoke.mp4" })
    });
    assert.strictEqual(added.count, 1);

    const media = await fetchJson(`${base}/api/tasks/${added.tasks[0].id}/media-preview`);
    assert.strictEqual(media.videos[0].downloadUrl.endsWith("?download=1"), true);

    const badJson = await fetch(`${base}/api/tasks/add-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{"
    });
    assert.strictEqual(badJson.status, 400);

    const ranged = await fetch(`${base}/api/tasks/add-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputText: `【Range视频】 http://127.0.0.1:${upstream.address().port}/video.mp4` })
    }).then((r) => r.json());
    const proxied = await fetch(`${base}/api/tasks/${ranged.tasks[0].id}/video`, { headers: { Range: "bytes=0-3" } });
    assert.strictEqual(proxied.status, 206);
    assert.strictEqual(proxied.headers.get("content-range"), "bytes 0-3/10");

    console.log("smoke OK");
  } finally {
    await closeServer(server);
    await closeServer(upstream);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

function onceListening(server) {
  return new Promise((resolve) => server.once("listening", resolve));
}

async function startUpstream() {
  const server = http.createServer((req, res) => {
    if (req.headers.range === "bytes=0-3") {
      res.writeHead(206, {
        "content-type": "video/mp4",
        "accept-ranges": "bytes",
        "content-range": "bytes 0-3/10",
        "content-length": "4"
      });
      return res.end("0123");
    }
    res.writeHead(200, { "content-type": "video/mp4", "content-length": "10" });
    res.end("0123456789");
  });
  server.listen(0);
  await onceListening(server);
  return server;
}

function closeServer(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function fetchText(url) {
  const res = await fetch(url);
  assert.strictEqual(res.status, 200);
  return res.text();
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  assert.strictEqual(res.status, 200);
  return res.json();
}
