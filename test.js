const assert = require("assert");
const { Readable, Writable } = require("stream");
const { addBatch, getTaskMediaPreview, handleRequest, parseShareText, resetForTest } = require("./server");
const { normalizeAwemeResponse } = require("./server/services/douyin");
const { pickVideoUrl, pickVideoUrls } = require("./server/services/x");

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
      video: {
        duration: 1234,
        play_addr: { url_list: ["https://aweme.snssdk.com/aweme/v1/playwm/?video_id=https://example.com/not-real.mp4&ratio=720p"] }
      }
    }
  }, "1");
  assert.strictEqual(note.mediaType, "video");
  assert.strictEqual(note.videoUrl, "https://example.com/not-real.mp4");
  assert.strictEqual(note.images.length, 1);
  const videoIdOnly = normalizeAwemeResponse({
    aweme_detail: {
      desc: "视频",
      video: {
        duration: 1234,
        play_addr: { url_list: ["https://aweme.snssdk.com/aweme/v1/playwm/?video_id=v2700foo&ratio=720p"] }
      }
    }
  }, "3");
  assert.strictEqual(videoIdOnly.videoUrl, "https://aweme.snssdk.com/aweme/v1/playwm/?video_id=v2700foo&ratio=720p");
  const imagePostWithAudio = normalizeAwemeResponse({
    aweme_detail: {
      desc: "实况图文",
      images: [{ url_list: ["https://example.com/live.jpg"] }],
      video: {
        duration: 0,
        play_addr: { url_list: ["https://aweme.snssdk.com/aweme/v1/playwm/?video_id=https://example.com/audio.mp4&ratio=720p"] }
      }
    }
  }, "2");
  assert.strictEqual(imagePostWithAudio.mediaType, "image");
  assert.strictEqual(imagePostWithAudio.videoUrl, "");
  assert.deepStrictEqual(imagePostWithAudio.videos, []);
  assert.strictEqual(imagePostWithAudio.images.length, 1);

  const videoResult = await addBatch("【视频标题】 https://example.com/a.mp4");
  assert.strictEqual(videoResult.count, 1);
  assert.strictEqual(videoResult.tasks[0].status, "extracted");
  assert.deepStrictEqual(videoResult.tasks[0].output.videos, ["https://example.com/a.mp4"]);
  assert.strictEqual(getTaskMediaPreview(videoResult.tasks[0].id).videos[0].kind, "video");
  assert.strictEqual(getTaskMediaPreview(videoResult.tasks[0].id).videos[0].downloadUrl.endsWith("?download=1"), true);
  const multiVideoResult = await addBatch("【多视频】 https://example.com/a.mp4 https://example.com/b.mp4");
  assert.strictEqual(multiVideoResult.tasks[0].output.videos.length, 2);
  assert.strictEqual(getTaskMediaPreview(multiVideoResult.tasks[0].id).videos[1].url, `/api/tasks/${multiVideoResult.tasks[0].id}/video/1`);
  assert.strictEqual(pickVideoUrl({
    formats: [
      { url: "https://video.example/360.mp4", vcodec: "h264", height: 360 },
      { url: "https://video.example/720.mp4", vcodec: "h264", height: 720 }
    ]
  }), "https://video.example/720.mp4");
  assert.deepStrictEqual(pickVideoUrls({
    entries: [
      { formats: [{ url: "https://video.example/1.mp4", vcodec: "h264", height: 360 }] },
      { formats: [{ url: "https://video.example/2.mp4", vcodec: "h264", height: 360 }] }
    ]
  }), ["https://video.example/1.mp4", "https://video.example/2.mp4"]);

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
