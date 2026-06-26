const { spawnSync } = require("child_process");

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 18) {
  console.error(`Node.js 版本过低: ${process.version}，请安装 Node.js 18+`);
  process.exit(1);
}

const result = spawnSync("yt-dlp", ["--version"], { encoding: "utf8", windowsHide: true });
if (result.error || result.status !== 0) {
  console.error("未检测到 yt-dlp。");
  console.error("Windows: py -m pip install -U yt-dlp");
  console.error("CentOS: python3 -m pip install -U yt-dlp");
  process.exit(1);
}

console.log(`Node.js ${process.version}`);
console.log(`yt-dlp ${String(result.stdout || "").trim()}`);
console.log("doctor OK");
