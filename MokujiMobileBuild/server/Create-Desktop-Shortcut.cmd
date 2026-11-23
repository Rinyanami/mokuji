@echo off
chcp 65001 >nul
setlocal
set "TARGET=%~dp0Mokuji.exe"
set "WORKDIR=%~dp0"

if not exist "%TARGET%" (
  echo 未找到 Mokuji.exe，请先确保位于服务端目录。
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; ^
   $desktop = [Environment]::GetFolderPath('Desktop'); ^
   $s = $ws.CreateShortcut((Join-Path $desktop '目次 Mokuji.lnk')); ^
   $s.TargetPath = '%TARGET%'; ^
   $s.WorkingDirectory = '%WORKDIR%'; ^
   $s.IconLocation = '%TARGET%,0'; ^
   $s.Description = '目次 Mokuji（书架管理 · 摸鱼工作区 · 书源嗅探 · 多端同步一体化桌面端）'; ^
   $s.Save();"

echo 已在桌面生成统一的「目次 Mokuji」快捷方式（Ctrl+Alt+M 隐藏/呼出，Ctrl+Shift+W 切换书架与工作区）！
pause
