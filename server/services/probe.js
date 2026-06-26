const { spawn } = require("child_process");

async function detectYtDlpRunner() {
  const candidates = [
    { command: "yt-dlp", prefixArgs: [] },
    { command: "python", prefixArgs: ["-m", "yt_dlp"] },
    { command: "py", prefixArgs: ["-m", "yt_dlp"] }
  ];
  for (const candidate of candidates) {
    if (await probeCommand(candidate.command, [...candidate.prefixArgs, "--version"])) return candidate;
  }
  throw new Error("未检测到 yt-dlp。请安装 yt-dlp 并加入 PATH，或执行: python -m pip install -U yt-dlp");
}

function probeCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true });
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.on("error", () => finish(false));
    child.on("close", (code) => finish(code === 0));
    setTimeout(() => {
      try { if (!child.killed) child.kill(); } catch (_error) {}
      finish(false);
    }, 5000);
  });
}

module.exports = { detectYtDlpRunner };
