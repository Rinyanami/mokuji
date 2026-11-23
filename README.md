# 目次 Mokuji v2.0

**本地优先（Local-First）的三端阅读器、Bangumi 级自定义书架、万能网页嗅探与拟真办公摸鱼工作台。**

支持 **Windows（WebView2 桌面单入口）**、**Android（原生离线 WebView APK）**、**iOS（免签名全屏 Web Clip + 快捷指令）** 以及 **电纸书（`/opds` + `/eink`）**。

---

## 核心特性

### 1. 本地优先架构（Windows / Android / iOS 独立运行）
- **无需先配服务器即可直接用**：移动端内置 IndexedDB 本地存储引擎（[local-first-engine.ts](MokujiMobileBuild/server/client-source/lib/local-first-engine.ts)），无后端时自动在手机本地保存书架、目录、阅读进度、书签与段落批注。
- **全格式本地导入**：支持 `.txt`（智能分章与 GB18030/UTF-8 自动解码）、`.epub`（含内嵌插图解析）、`.cbz` / `.zip`（多话漫画打包渲染）。
- **Linear 风格 4 Tab 主流程**：统一为 **「书架 / 找书 / 阅读 / 我的」**，默认直达「我的书架」置顶续读卡片与一键导入本地书入口。

### 2. 六套拟真摸鱼工作区（按需拆包 · 零延迟防窥）
- 内置 **Codex / Claude / WorkBuddy / 豆包 / Antigravity / VS Code** 六套工作区外观，支持浅色 / 深色切换与按需懒加载拆包（`React.lazy`）。
- **瞬间隐身快捷键**：
  - `Ctrl + Alt + M`：Windows 全局老板键，任意焦点下隐藏或呼出窗口；关闭右上角 `×` 最小化至系统托盘。
  - `Ctrl + Shift + W`：同窗口一键切换「我的书架」与「摸鱼工作区」。
  - `Space`：在工作区内瞬间切换为伪装工作摘要与项目附件，再次按下返回正文。
  - `Alt + V` / 眼睛图标 / 悬停：隐藏真实书名与章节名的工作别名下，鼠标悬停 0ms 瞬显真名或一键全显真名。

### 3. Bangumi 级书架整理 & 双向联动
- **完全自定义分类、10 分制评分档位与 Tag 库**：支持批量修改状态/门类/书单与封面墙/列表视图切换。
- **Bangumi 双向同步**：支持绑定 Bangumi Access Token，自动将阅读状态、个人评分、章节进度与私密收藏回写至 bgm.tv。

### 4. 多书源检索 & 万能网页智能嗅探
- **内置可切换书源**：晋江、SF 轻小说、ESJ Zone、成为小说家吧（Syosetu）、MangaDex（含原站漫画图片代理）、纵横、17K、维基文库，并支持导入自定义规则。
- **智能网页嗅探**：粘贴任意书籍目录页、单章长文、漫画页或 `.txt`/`.epub`/`.cbz` 直链，一键抓取入库并支持离线全书正文搜索与段落批注。

### 5. 多端同步与电纸书生态
- **七牛云 Kodo (S3 V4) / NAS WebDAV 云同步**：全量双向快照合并，数据变更 6 秒防抖自动推送；支持手机断网时先本地阅读，连网后一键拉取或合并。
- **局域网手机免安装直连**：桌面端开启「手机连接」后，iPhone Safari 扫码即可安装永久不掉签全屏 Web Clip（`.mobileconfig`）及快捷指令一键抓书。
- **墨水屏支持**：同一局域网下开放 OPDS 1.2 书库（`/opds`，自动封包 EPUB）与极简墨水屏网页（`/eink`）。

---

## 目录结构

| 目录或文件 | 用途 |
| --- | --- |
| `MokujiMobileBuild/server/client-source/` | Vite + React 前端、Linear 主题 UI 与本地优先 IndexedDB 引擎 |
| `MokujiMobileBuild/server/desktop/` | Windows WebView2 单入口宿主（`MokujiDesktop.cs`）与安装器源码 |
| `MokujiMobileBuild/server/*.mjs` | 本地 Node.js 服务、SQLite 持久层、多书源检索、网页嗅探、云同步与 OPDS |
| `MokujiMobileBuild/server/server-deploy/` | Docker + Caddy 自建云端服务器部署配置 |
| `MokujiMobileBuild/android/` | Android Java 原生壳（离线资源拦截、跨源 HTTP 桥接与本地文件保存） |
| `MokujiMobileBuild/ios/`、`ios-binary/` | Swift / Xcode 与 Objective-C 未签名 IPA 构建源码 |
| `Cotex/` | 桌面阅读联动配套模块、示例素材与 MIT 许可 |

---

## 快速运行与构建

### 运行源码服务（需要 Node.js 24+）
```powershell
cd MokujiMobileBuild/server
node launcher.mjs
# Windows 也可直接运行 MokujiMobileBuild/server/Start-Mokuji.cmd 或桌面包内的 Mokuji.exe
```

### 构建前端资源
```powershell
cd MokujiMobileBuild/server/client-source
npm ci
npm run typecheck
node build.mjs
```

### 构建 Android APK（需要 JDK 17 + Android SDK 35 + 自定义签名证书）
```powershell
$env:MOKUJI_SIGN_PASS = "<your-keystore-password>"
powershell -ExecutionPolicy Bypass -File MokujiMobileBuild/android/build.ps1 `
  -Jdk "D:\APP\jdk-17" `
  -BuildTools "D:\APP\android-sdk\build-tools\35.0.0" `
  -PlatformJar "D:\APP\android-sdk\platforms\android-35\android.jar" `
  -Keystore "<path-to-your-release.p12>" `
  -Output "MokujiMobileBuild/server/web/install/Mokuji-Android.apk"
```

### 自托管部署（VPS / NAS）
参考 [MokujiMobileBuild/server/server-deploy/README.md](MokujiMobileBuild/server/server-deploy/README.md)，通过 `compose.yaml` 与 `Caddyfile` 即可一键启用 HTTPS 公网访问。

> 本开源仓库已移除所有个人书库数据、SQLite 数据库、签名证书与云存储密钥。个人凭据请通过客户端界面填写或配置于环境变量中。
