const assert = require("assert");
const { resetForTest, startServer } = require("./server");

const DOUYIN_URL = "0.51 aaN:/ U@l.Cu 12/16 :0pm 近几年来尺度最大，也是最好看的国产悬疑片...# 默杀 # 青年创作者成长计划 https://v.douyin.com/aHKqQXAsGA0/";

(async () => {
  resetForTest();
  const server = startServer(0);
  await onceListening(server);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const added = await fetchJson(`${base}/api/tasks/add-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputText: DOUYIN_URL })
    });
    assert.strictEqual(added.tasks[0].status, "extracted");
    const media = await fetchJson(`${base}/api/tasks/${added.tasks[0].id}/media-preview`);
    assert.strictEqual(media.videos.length, 1);
    for (const url of [media.videos[0].url, media.videos[0].downloadUrl]) {
      const chunk = await firstChunk(`${base}${url}`);
      assert.strictEqual(chunk.status, 206);
      assert.match(chunk.contentType, /video\/mp4/);
      assert.strictEqual(chunk.hex, "00000020");
    }
    const download = await firstChunk(`${base}${media.videos[0].downloadUrl}`, {});
    assert.strictEqual(download.status, 200);
    assert.match(download.contentType, /video\/mp4/);
    assert.match(download.disposition, /attachment/);
    assert.strictEqual(download.hex, "00000020");
    console.log("smoke-douyin OK");
  } finally {
    await closeServer(server);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

function onceListening(server) {
  return new Promise((resolve) => server.once("listening", resolve));
}

function closeServer(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  assert.strictEqual(res.status, 200);
  return res.json();
}

async function firstChunk(url, headers = { Range: "bytes=0-3" }) {
  const res = await fetch(url, { headers });
  const reader = res.body.getReader();
  const chunk = await reader.read();
  await reader.cancel();
  return {
    status: res.status,
    contentType: res.headers.get("content-type") || "",
    disposition: res.headers.get("content-disposition") || "",
    hex: Buffer.from(chunk.value || []).slice(0, 4).toString("hex")
  };
}
