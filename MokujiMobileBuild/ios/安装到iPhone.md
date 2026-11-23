# 安装目次 Mokuji 到 iPhone / iPad（最省事指南）

针对 iOS 系统的证书限制，目次 Mokuji 提供**三套方案**，推荐优先使用**方案一（免签名全屏独立应用 + 快捷指令一键导书）**，30 秒装好且**永久不会每 7 天掉签**。

---

## 方案一：免签名全屏独立 App（推荐 · 30 秒搞定 · 永不过期）

目次已内置 **iOS 全屏 WebClip 描述文件 (`FullScreen = true`)** 与 **Service Worker 离线章节缓存**：

1. 在电脑启动目次，进入顶栏 **「手机连接」**（`#/mobile`），点击 **「开启手机连接」** 并切到 **「下载安装」** 二维码。
2. 用 iPhone 的 **Safari** 扫码打开安装页：
   - **方式 A（一键安装描述文件）**：点击 **「下载 iPhone 全屏桌面图标 (.mobileconfig)」**，然后打开 iPhone **「设置 → 已下载描述文件 → 安装」**。
   - **方式 B（零描述文件）**：在 Safari 打开目次书架首页后，点击底部 **「分享 → 添加到主屏幕」**。
3. 从主屏幕点开「目次」图标，即可以**无 Safari 地址栏、无底部工具栏的原生全屏形态**运行，且已读章节与下一章预加载内容支持断网离线阅读。

---

## 配合 iOS「快捷指令」一键抓书入库（Safari 看到任何书一键进目次）

目次支持 `/?sniff=<网页或文件直链>` 参数自动嗅探。你可以在 iPhone 自带的 **「快捷指令 (Shortcuts)」** App 里花 20 秒建一个分享菜单动作：

1. 打开 iPhone **快捷指令 App** → 右上角 **「+」** 新建快捷指令，命名为 **「收入目次书架」**。
2. 点击顶部设置图标 → 开启 **「在共享表单中显示」**（接收类型勾选 **「URL」** 与 **「Safari 网页」**）。
3. 添加唯一一个动作：**「打开 URL (Open URLs)」**，网址填入：
   ```text
   http://你的电脑局域网IP:5199/?sniff=[快捷指令输入]
   ```
   *（可在电脑目次 `#/mobile` 页面一键复制这段前缀）*
4. 以后在 iPhone Safari 看到任何**无书源小说目录页、轻小说贴子、漫画话页或 `.txt/.epub/.cbz` 下载链接**，点 Safari 底部分享 → **「收入目次书架」**，就会自动唤醒目次并嗅探解析入库！

---

## 方案二：SideStore / AltStore / TrollStore 安装原生 IPA

如果你习惯使用 iOS 原生 WebView 容器外壳（`Mokuji-iPhone-Unsigned.ipa`），包内已提供预编译的未签名安装包：

- **位置**：`MokujiMobileBuild/server/web/install/Mokuji-iPhone-Unsigned.ipa`
- **TrollStore（巨魔商店）**：直接在 iPhone 下载该 `.ipa` 并用 TrollStore 打开即可永久签名安装。
- **SideStore / AltStore**：在 iPhone 上用 SideStore 导入该 `.ipa`，开启 SideStore 后台自动刷新即可免电脑续签。
- **Sideloadly / Xcode**：用数据线连接电脑，将 `Mokuji-iPhone-Unsigned.ipa` 拖入 Sideloadly，用个人 Apple ID 签名安装（普通免费 Apple ID 每 7 天需重签一次，因此日常更推荐方案一）。
