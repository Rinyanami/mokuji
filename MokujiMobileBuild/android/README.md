# 目次 Mokuji · Android（离线优先本地版）

独立签名安装包支持 Android 8.0 及更新版本。2.0 版已内置完整前端与 IndexedDB 本地书库：
- **开箱即本地可用**：打开 App 直接进入「我的书架」与「摸鱼工作区」，支持手机断网直接导入本地 TXT / EPUB、Bangumi 自定义分类/评分/标签与全套工作区伪装壳。
- **连接电脑/服务器改为可选同步**：仅在需要把手机与电脑（`Mokuji.exe`「手机连接」）或自建服务器同步时，前往「个人主页 → 本机独立运行与可选主机同步」填入局域网/HTTPS 地址或七牛云/NAS 即可双向同步。
- 也可在系统浏览器使用「分享 → 目次 Mokuji」直接带入网页链接嗅探。

## 从源码生成 APK

在 Windows 安装 JDK 17、Android SDK Build Tools 35.0.0 和 Android SDK Platform 35。准备同一签名用的 PKCS12 密钥库，在当前 PowerShell 进程通过环境变量 `MOKUJI_SIGN_PASS` 提供口令，执行以下命令。保留自己的签名私钥以便应用升级。

```powershell
.\build.ps1 -Jdk $env:JAVA_HOME -BuildTools "$env:ANDROID_HOME\build-tools\35.0.0" -PlatformJar "$env:ANDROID_HOME\platforms\android-35\android.jar" -Keystore C:\private\mokuji.p12 -KeyAlias mokuji-release
```

产物为 `dist\Mokuji-Android.apk`。构建脚本使用官方 aapt2、javac、D8、zipalign 及 apksigner，交付的 APK 使用 Android V2/V3 签名。
