const assert = require("assert");
const { Readable, Writable } = require("stream");
const { addBatch, getTaskMediaPreview, handleRequest, parseShareText, resetForTest } = require("./server");
const { normalizeAwemeResponse } = require("./server/services/douyin");
const { pickVideoUrl } = require("./server/services/x");

(async () => {
  resetForTest();
  const parsed = parseShareText("1.23 复制打开抖音，看看【测试标题】 https://example.com/a.jpg");
  assert.strictEqual(parsed.title, "测试标题");
  assert.strictEqual(parsed.shortUrl, "https://example.com/a.jpg");
  assert.strictEqual(parseShareText("https://x.com/i/status/2066958204870017355").platform, "x");
  assert.strictEqual(
    parseShareText("https://x.com/HYPEX/status/2070061003144864147/video/1，X的视频提取不了").shortUrl,
    "https://x.com/HYPEX/status/2070061003144864147/video/1"
  );
  assert.strictEqual(parseShareText("https://x.com/HYPEX/status/2070061003144864147/video/1").platform, "x");

  const imageResult = await addBatch("【图片标题】 https://example.com/a.jpg");
  assert.strictEqual(imageResult.count, 1);
  assert.strictEqual(imageResult.tasks[0].id, 1);
  assert.strictEqual(imageResult.tasks[0].status, "extracted");
  assert.strictEqual(imageResult.tasks[0].output.images[0], "https://example.com/a.jpg");
  assert.strictEqual(getTaskMediaPreview(imageResult.tasks[0].id).images[0].kind, "image");
  assert.strictEqual(getTaskMediaPreview(imageResult.tasks[0].id).images[0].downloadUrl.endsWith("?download=1"), true);
  const note = normalizeAwemeResponse({
    aweme_detail: {
      desc: "图文",
      images: [{ url_list: ["https://example.com/p.jpg"] }],
      video: { play_addr: { url_list: ["https://example.com/not-real.mp4"] } }
    }
  }, "1");
  assert.strictEqual(note.mediaType, "image");
  assert.strictEqual(note.videoUrl, "");

  const videoResult = await addBatch("【视频标题】 https://example.com/a.mp4");
  assert.strictEqual(videoResult.count, 1);
  assert.strictEqual(videoResult.tasks[0].status, "extracted");
  assert.strictEqual(getTaskMediaPreview(videoResult.tasks[0].id).videos[0].kind, "video");
  assert.strictEqual(getTaskMediaPreview(videoResult.tasks[0].id).videos[0].downloadUrl.endsWith("?download=1"), true);
  assert.strictEqual(pickVideoUrl({
    formats: [
      { url: "https://video.example/360.mp4", vcodec: "h264", height: 360 },
      { url: "https://video.example/720.mp4", vcodec: "h264", height: 720 }
    ]
  }), "https://video.example/720.mp4");

  const httpAdd = await requestJson("POST", "/api/tasks/add-batch", { inputText: "【接口视频】 https://example.com/http.mp4" });
  assert.strictEqual(httpAdd.body.count, 1);
  const httpPreview = await requestJson("GET", `/api/tasks/${httpAdd.body.tasks[0].id}/media-preview`);
  assert.strictEqual(httpPreview.body.videos[0].downloadUrl.endsWith("?download=1"), true);
  const badJson = await requestJson("POST", "/api/tasks/add-batch", "{");
  assert.strictEqual(badJson.statusCode, 400);
  assert.match(badJson.body.error, /JSON/);

  console.log("self-test OK");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

function requestJson(method, url, body) {
  return new Promise((resolve, reject) => {
    const raw = typeof body === "string" ? body : (body ? JSON.stringify(body) : "");
    const req = Readable.from(raw ? [raw] : []);
    req.method = method;
    req.url = url;
    req.headers = { host: "localhost" };

    const chunks = [];
    const res = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      }
    });
    res.setHeader = () => {};
    res.writeHead = (status, headers) => {
      res.statusCode = status;
      res.headers = headers;
    };
    res.end = (chunk) => {
      if (chunk) chunks.push(Buffer.from(chunk));
      resolve({
        statusCode: res.statusCode || 200,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8"))
      });
    };

    handleRequest(req, res).catch(reject);
  });
}
