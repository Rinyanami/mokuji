@echo off
setlocal
cd /d "%~dp0"
where node.exe >nul 2>nul
if not errorlevel 1 goto run
if exist "D:\APP\nodejs\node.exe" (
  "D:\APP\nodejs\node.exe" --preserve-symlinks --input-type=module -e "import('node:url').then(u=>import(u.pathToFileURL(process.argv[1])))" "%~dp0launcher.mjs" %*
  goto done
)
echo Node.js 24 or newer is required.
pause
exit /b 1
:run
node.exe --preserve-symlinks --input-type=module -e "import('node:url').then(u=>import(u.pathToFileURL(process.argv[1])))" "%~dp0launcher.mjs" %*
:done
if errorlevel 1 pause
