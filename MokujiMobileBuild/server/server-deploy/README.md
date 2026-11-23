# 在 Linux 服务器上打开目次

手机和电脑访问同一 HTTPS 地址，共用服务器上的书架和阅读进度。需要一台已安装 Docker Engine 和 Compose v2.20 或更高版本的 Linux 服务器、一个指向该服务器的域名，以及服务器的 SSH 登录权限。域名的 A 记录应指向服务器公网 IPv4；填写 AAAA 时，IPv6 也应可达。安全组与防火墙需允许 TCP 80、443，两个端口由 Caddy 独占。

## 首次启动

1. 把整个目次发布包解压到服务器上的固定目录，如 `/opt/mokuji`。保留 `web/`、应用模块和 `server-deploy/` 的相对位置。
2. 进入部署目录，生成配置和登录密码的 bcrypt 哈希。第二条 Docker 命令会提示输入密码，建议使用密码管理器生成并保存一条至少 20 位的随机密码。

```sh
cd /opt/mokuji/server-deploy
cp -n .env.example .env
chmod 600 .env
docker pull caddy:2.11.9-alpine
docker run --rm -it caddy:2.11.9-alpine caddy hash-password --algorithm bcrypt
```

3. 用 `nano .env` 填入 `DUJI_DOMAIN` 以及刚生成的 `DUJI_PASSWORD_HASH`。域名只写主机名，去掉协议、路径和端口。哈希整行放进已有的单引号内，以保留美元符号。用户名固定为 `reader`。应用只需要哈希，原密码由你保存。
4. 检查配置并启动。

```sh
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

5. 在手机浏览器打开 `https://你的域名/#/webfiction`，输入 `reader` 和原密码。用手机蜂窝网络访问也可以。打开一本书、翻一章，再在电脑同一网址登录，检查最近阅读位置。首次申请证书时可用 `docker compose logs --tail=60 gateway` 查看进度。

## 数据和七牛

书架、评分、阅读进度、绑定关系和 TXT 索引使用服务器磁盘上的 SQLite，保存在 Compose 卷 `duji_book-data`。Windows 里的 Cotex 私人书库不会随发布包上传。手机要读自己的 TXT，可登录后在阅读页导入。

可选的私有七牛 Kodo 处理**启用后新导入、转为 UTF-8 后不超过 8 MiB 的 TXT**。在 `.env` 填入自己的 `DUJI_KODO_REGION`、`DUJI_KODO_BUCKET`（空间的 S3 桶名）、`DUJI_KODO_ACCESS_KEY` 和 `DUJI_KODO_SECRET_KEY`；`DUJI_KODO_PREFIX` 默认是 `duji/reader/v1`。然后运行 `docker compose up -d app` 以应用新配置。满足该条件的 TXT 先写入私有云对象，再写入数据库索引。较大的 TXT 和 EPUB 按章保存在服务器数据卷。已有 TXT 继续使用原有存储。未填写七牛配置时，TXT 正文也保存在服务器磁盘。

七牛侧请选私有空间，给服务端使用的子账号只授目标桶上传、下载权限。对象路径前缀用于整理同桶内的文件。七牛以桶为授权边界；如果现在的桶还有其他重要资料，可在同一账户使用独立的目次私有桶。主机、手机和浏览器都无需把 Kodo 设为公开。

## 更新、备份与访问范围

沿用已有部署时，请保留原目录、`.env` 和 Compose 数据卷。配置变量以 `DUJI_` 开头，原有 `duji_book-data` 卷和七牛对象前缀可继续使用。在同一目录放入新版发布文件，运行 `docker compose up -d --build`。停止服务用 `docker compose down`，持久卷会保留。备份书架与进度时，先暂停应用，再复制整个数据卷以包含 SQLite 的相关文件。启用七牛后，私有桶中的正文需单独保留。

```sh
mkdir -p backups
docker compose stop app
docker run --rm -v duji_book-data:/source:ro -v "$PWD/backups:/backup" --entrypoint tar caddy:2.11.9-alpine -czf "/backup/duji-$(date +%Y%m%d-%H%M%S).tar.gz" -C /source .
docker compose start app
```

Caddy 对公开页面和业务 API 统一做 HTTPS 密码认证。Node 的 5198 端口仅在两个容器共享的回环接口上监听。公网访问配对管理和本机状态接口会返回 404。单人账号下，知道密码的人可以读取或修改同一个书架。密码和七牛密钥仅保存在自己的配置与服务器上。

## 在家庭 NAS 上长期部署（群晖 DSM / 飞牛 fnOS / 威联通）

1. **方案一：Docker 直接托管目次服务（推荐）**
   - 把本发布目录放入 NAS 共享文件夹（如 `/vol1/docker/mokuji`），直接用 `docker compose` 启动，或使用 Node 24+ 运行 `node server.mjs`（数据放在 `DUJI_DATA_DIR` 持久目录）。
   - 如果只在家庭内网 / Tailscale / WireGuard 使用、不需要公网域名 HTTPS 证书，可在 `.env` 中配置反代或端口映射（局域网访问手机端口 / 宿主机代理）。
2. **方案二：先用「七牛云 Kodo」，未来无缝迁移到「NAS WebDAV」**
   - 在前端「个人主页 -> 多端同步与电纸书」面板中，先选择 **七牛云 Kodo**（填写 AccessKey、SecretKey、私有桶、区域如 `cn-east-1`），点击「测试连接」并「立即上传同步」。
   - 以后购入 NAS 后，只需在群晖 / fnOS 开启 **WebDAV 服务**（默认端口如 5005/5006），在同一个同步面板切换为 **NAS WebDAV**（填入 `http://NAS局域网IP:5005`、账号密码与路径前缀 `mokuji-sync`），保存后点击「立即上传同步」，目次会自动检测新存储并把全部书架、书单、进度、自定义书源和本地导入书籍完整推送到 NAS（无需手动搬运数据库）。
   - 也可以先从旧七牛云在另一台设备「从云端拉取合并」，再切到 NAS 上传。

## 电纸书（Kindle / 文石 Boox / KOReader / Kobo）接入

- **OPDS 无线书库（推荐 KOReader / 多看 / 静读天下）**：在阅读器的 OPDS 网络书库中添加地址 `https://你的域名/opds`（或局域网 `http://127.0.0.1:5198/opds` / 已配对局域网地址），即可浏览全部已导入书籍、自定义书源缓存书籍和维基文库书籍，并实时生成 `.epub` 或 `.txt` 下载到电纸书。
- **墨水屏专用极简网页（`/eink`）**：适合 Kindle 自带浏览器、文石浏览器或海信墨水屏。访问 `/eink`，采用纯黑白高对比度、无动画零闪烁排版，阅读翻章后可点击「记录本章为进度」，直接写回 `reader_progress` 与桌面端/手机端互通。

[Caddy 自动 HTTPS](https://caddyserver.com/docs/automatic-https) · [Caddy 密码认证](https://caddyserver.com/docs/caddyfile/directives/basic_auth) · [Docker Compose 网络模式](https://docs.docker.com/reference/compose-file/services/#network_mode) · [Docker 持久卷](https://docs.docker.com/engine/storage/volumes/)
