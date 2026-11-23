# 目次 Mokuji本地版前端

本工程包含 Windows 本地版的 React 客户端。桌面和手机浏览器使用同一套页面。目次 Mokuji启动器负责提供同源的书架、手机连接和阅读接口。

## 重新构建

安装 Node.js 22.13 或更高版本，进入本目录后运行

```shell
npm ci
npm run typecheck
npm run build
```

构建更新相邻 `web` 目录中的首页、JavaScript 和 CSS。随发行包提供的封面、图标、来源说明和第三方许可文件也位于该目录。构建会保留这些文件。运行发行包中的 `Start-Duji.cmd` 查看应用。

## 主要入口

- `main.tsx` 读取本机书架并启动页面。
- `app/reader-app.tsx` 包含网站导航、书架、作品详情与备份。
- `app/bangumi-catalog.tsx` 和 `app/catalog-editor.tsx` 提供发现与书源匹配。
- `app/reader-hub.tsx` 和 `app/reader-view.tsx` 提供书源选择、TXT 导入与正文阅读。
- `app/mobile-connection.tsx` 管理局域网访问，`vendor/offline-qr` 用于本地绘制网址二维码。许可见相邻 `web/QR-CODE-LICENSE.txt` 与 `web/QRCODE-TERMINAL-LICENSE.txt`。
