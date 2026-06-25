# SoloSaver (Electron + SQLite)

桌面版抖音分享提取/批量下载工具。

## 技术栈

- `Electron`：桌面 UI
- `SQLite`（`sql.js`，WASM 版本）：任务与设置存储（免本地编译）
- `yt-dlp`：实际下载视频/图集（支持批量）

## 功能

- 分享文本批量导入（每行一条）
- 提取短链/标题/口令片段
- 默认下载目录设置（持久化）
- 批量下载对应视频和图片（图集）
- 任务状态与日志

## 运行前准备

1. 安装 `Node.js`（建议 18+）
2. 安装 `yt-dlp` 并加入 `PATH`
3. 可选安装 `ffmpeg`（部分视频格式合并需要）

## 安装与运行

在项目目录执行：

```powershell
npm install
npm start
```

如果 PowerShell 里设置过 `ELECTRON_RUN_AS_NODE=1`，先清掉再启动：

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm start
```

当前版本使用 `sql.js`，通常不需要 `rebuild`。
如你之前装过旧版本（`better-sqlite3`），建议先删除 `node_modules` 和 `package-lock.json` 再执行 `npm install`。

项目已不再提供 `start.bat` / `start.ps1`，统一使用 `npm start` 启动。

## 打包 Windows 安装包（exe）

先安装依赖后执行：

```powershell
npm run pack:win
```

产物默认输出到 `dist/`。
