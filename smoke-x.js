const assert = require("assert");
const { resetForTest, startServer } = require("./server");

const X_URL = "https://x.com/i/status/2066958204870017355";

(async () => {
  resetForTest();
  const server = startServer(0);
  await onceListening(server);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const added = await addXTask(base);
    assert.strictEqual(added.count, 1);
    assert.strictEqual(added.tasks[0].status, "extracted");

    const media = await fetchJson(`${base}/api/tasks/${added.tasks[0].id}/media-preview`);
    assert.strictEqual(media.videos.length, 1);
    const preview = await firstChunk(`${base}${media.videos[0].url}`);
    assert.strictEqual(preview.status, 200);
    assert.match(preview.contentType, /video\/mp4/);
    assert.strictEqual(preview.hex, "0000001866747970");
    const download = await firstChunk(`${base}${media.videos[0].downloadUrl}`);
    assert.strictEqual(download.status, 200);
    assert.match(download.contentType, /video\/mp4/);
    assert.match(download.disposition, /attachment/);
    assert.strictEqual(download.hex, "0000001866747970");
    console.log("smoke-x OK");
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

async function addXTask(base) {
  let last = null;
  for (let i = 0; i < 2; i += 1) {
    last = await fetchJson(`${base}/api/tasks/add-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputText: X_URL })
    });
    if (last.tasks?.[0]?.status === "extracted") return last;
  }
  return last;
}

async function firstChunk(url) {
  const res = await fetch(url);
  const reader = res.body.getReader();
  const chunk = await reader.read();
  await reader.cancel();
  return {
    status: res.status,
    contentType: res.headers.get("content-type") || "",
    disposition: res.headers.get("content-disposition") || "",
    hex: Buffer.from(chunk.value || []).slice(0, 8).toString("hex")
  };
}
