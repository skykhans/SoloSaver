# SoloSaver

抖音分享文本和 X 视频素材提取工具。

当前核心是网页前端和一个 Node 服务，另新增微信小程序目录：

- 不使用数据库
- 不保存下载队列
- 不在服务端落盘下载文件
- 提取到视频/图片地址后，在浏览器里预览和下载

## 环境要求

- Node.js 18+
- yt-dlp（X 视频提取需要）

Windows 安装 `yt-dlp`：

```powershell
py -m pip install -U yt-dlp
```

## 本地启动

```powershell
npm install
npm run doctor
npm start
```

打开：

```text
http://localhost:3000
```

端口被占用时：

```powershell
$env:PORT=3001
npm start
```

然后打开：

```text
http://localhost:3001
```

本地自检：

```powershell
npm run verify
```

联网验证 X 提取：

```powershell
npm run smoke:x
```

## 使用方式

1. 粘贴抖音分享文本或 X 视频链接。
2. 点击“开始提取”。
3. 在“预览”页签查看视频或图片。
4. 视频点“下载视频”，多视频可切换预览并批量下载；单张图片点图片上的“下载”，图片合集点“批量下载图片”。

X 链接示例：

```text
https://x.com/i/status/2066958204870017355
```

## CentOS 启动

```bash
npm install
python3 -m pip install -U yt-dlp
npm run doctor
PORT=3000 npm start
```

浏览器访问：

```text
http://服务器IP:3000
```

长期运行建议交给 `systemd`、`pm2` 或服务器现有进程管理器。

## 微信小程序

已新增原生微信小程序目录：

```text
wechat-miniprogram
```

本地调试：

1. 先启动后端：`npm start`
2. 用微信开发者工具导入 `wechat-miniprogram`
3. 小程序默认请求 `http://127.0.0.1:3000`，用于开发者工具模拟器调试

小程序功能与网页保持一致：粘贴、提取、预览、任务列表、复制链接、切换多个视频、保存单个/批量视频、保存单图、批量保存图片。

上线前把 `wechat-miniprogram/pages/index/index.js` 里的 `API_BASE` 改成 HTTPS 后端域名，并在微信公众平台配置 request/downloadFile 合法域名。真机预览不能使用 `127.0.0.1`，需要局域网地址或 HTTPS 域名。

## 说明

任务只存在当前 Node 进程内存里，重启服务后会清空。
