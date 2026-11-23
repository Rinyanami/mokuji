# 目次 iPhone 安装包

适用于运行 iOS 17 或更新版的 iPhone。首次打开时，输入电脑「手机连接」显示的局域网地址，或填写已部署的 HTTPS 书架地址。应用使用系统的 Safari 阅读窗口，支持网站的配对表单、文件选择和网页导航。点「完成」可以回到连接页更换书架。

## 在 Windows 安装

1. 把 Mokuji-iPhone-Unsigned.ipa 下载到电脑，从 Sideloadly 官网下载安装 Windows 版，按官网说明准备 Apple 设备驱动。
2. 用 USB 把已解锁的 iPhone 连到电脑，在 iPhone 上选择信任这台电脑。
3. 在 Sideloadly 中选中自己的 iPhone，拖入 IPA，用自己的 Apple 账户签名并安装。
4. 按 iOS 的提示，在设置里信任自己的开发者身份，开启「开发者模式」并在需要时重新启动。
5. 免费个人签名的配置文件有效期为 7 天。继续使用时，通过同一账户和工具刷新签名。

[Sideloadly 官网](https://sideloadly.io/) · [Apple 个人开发团队说明](https://developer.apple.com/help/account/basics/about-your-developer-account/)

也可以使用 [AltStore Classic 的 Windows 安装指南](https://faq.altstore.io/altstore-classic/how-to-install-altstore-windows)。

## 所含程序

Mokuji.m 是这个 IPA 的 Objective-C 原生程序源码。使用 UIKit 显示设置页，SafariServices 打开阅读窗口。服务端保存书架和阅读进度。客户端仅保存用户选择的书架网址。输入局域网地址时，电脑需运行目次并开启手机连接，手机要在同一网络。

## 在 Windows 复现编译

安装 Python 3.12、Zig 0.13.0 和 Python 包 lief 1.0.0。将命令中的 Zig 路径换成自己的路径。

```powershell
python -m pip install lief==1.0.0
python build.py C:\Tools\zig\zig.exe Mokuji-iPhone-Unsigned.ipa
```

交叉编译使用 Clang 生成 iPhone ARM64 目标文件，并链接设备系统提供的 Objective-C 运行库和 iOS 框架。PublicAPI.h 声明代码调用的公开接口，链接用的文本描述由构建脚本在临时目录生成。压缩包内只含原生程序、应用信息和图标。Xcode 可直接用苹果 SDK 编译 Mokuji.m，此时不定义 MOKUJI_CROSS。

## 验证范围

已检查 IPA 结构、可执行权限、ARM64 iOS 平台与部署版本、启动入口和系统库绑定，以及 Mach-O 布局。在独立测试副本上已验证可写入新的代码签名并通过签名工具的内容校验。发行文件保留未签名状态，由设备所有者完成 Apple 签名。本次没有在 iPhone 真机上验证安装和阅读。
