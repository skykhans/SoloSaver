# SoloSaver

抖音分享文本和 X 视频素材提取工具。

当前项目只有网页前端和一个 Node 服务：

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
4. 视频点“下载视频”，单张图片点图片上的“下载”，图片合集点“批量下载图片”。

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

## 说明

任务只存在当前 Node 进程内存里，重启服务后会清空。
