@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title Widget Quay Tiep Nhan - Build and Publish GitHub Release (32-bit + 64-bit)
echo ======================================================
echo   Widget Quay Tiep Nhan - Build va Publish GitHub Release
echo ======================================================
echo.

where node >nul 2>nul || goto :NO_NODE
where npm >nul 2>nul || goto :NO_NODE

if not exist "package.json" (
  echo LOI: Khong tim thay package.json.
  echo Hay dat file build-and-publish.bat trong thu muc goc du an widget.
  goto :FAIL
)

for /f "delims=" %%v in ('node -p "require('./package.json').version"') do set "APP_VERSION=%%v"
for /f "delims=" %%o in ('node -p "require('./package.json').build.publish[0].owner"') do set "GH_OWNER=%%o"
for /f "delims=" %%r in ('node -p "require('./package.json').build.publish[0].repo"') do set "GH_REPO=%%r"

if not defined APP_VERSION (
  echo LOI: Khong doc duoc version trong package.json.
  goto :FAIL
)
if not defined GH_OWNER (
  echo LOI: Chua cau hinh build.publish[0].owner trong package.json.
  goto :FAIL
)
if not defined GH_REPO (
  echo LOI: Chua cau hinh build.publish[0].repo trong package.json.
  goto :FAIL
)

echo Repository : https://github.com/%GH_OWNER%/%GH_REPO%
echo Version    : v%APP_VERSION%
echo.

echo Kiem tra cau hinh package.json...
node -e "const p=require('./package.json');const q=p.build&&p.build.publish&&p.build.publish[0];if(!q||q.provider!=='github'||!q.owner||!q.repo)throw Error('build.publish phai dung provider github, owner va repo');if(/^YOUR_/.test(q.owner)||/^YOUR_/.test(q.repo))throw Error('Hay sua build.publish[0].owner/repo trong package.json thanh tai khoan/repo GitHub that');console.log('Cau hinh hop le.')"
if errorlevel 1 goto :FAIL

if not defined GH_TOKEN (
  echo.
  echo Chua co GH_TOKEN. Hay nhap token GitHub moi.
  echo Ky tu token se duoc an khi nhap.
  echo.
  for /f "usebackq delims=" %%T in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=Read-Host 'GH_TOKEN' -AsSecureString; $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try {[Runtime.InteropServices.Marshal]::PtrToStringBSTR($p)} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}"`) do set "GH_TOKEN=%%T"
  if not defined GH_TOKEN (
    echo LOI: Ban chua nhap token.
    goto :FAIL
  )
)

echo.
echo LUU Y: version v%APP_VERSION% phai lon hon ban release hien tai.
choice /C YN /N /M "Tiep tuc build va publish? [Y/N]: "
if errorlevel 2 goto :CANCEL

echo.
echo [1/3] Cai dat dependencies theo package-lock.json...
if exist "package-lock.json" (
  call npm ci
) else (
  call npm install
)
if errorlevel 1 goto :FAIL

echo.
echo [2/3] Kiem tra cu phap source...
for %%F in (main.js preload.js config.js updater.js) do (
  call node --check %%F
  if errorlevel 1 goto :FAIL
)
if not exist "assets\icon.png" (
  echo LOI: Thieu icon ung dung: assets\icon.png
  goto :FAIL
)

echo.
echo [3/3] Build bo cai gop 32-bit + 64-bit, ban portable 64-bit va publish GitHub Release v%APP_VERSION%...
echo Bo cai tu chon ban 32-bit hoac 64-bit theo Windows cua tung may.
if exist "dist" rmdir /s /q "dist"
call npx electron-builder --win --publish always
if errorlevel 1 goto :FAIL

echo.
echo ======================================================
echo THANH CONG: Da publish v%APP_VERSION%
echo https://github.com/%GH_OWNER%/%GH_REPO%/releases/tag/v%APP_VERSION%
echo.
echo GitHub Release phai co cac file:
echo   - QuayTiepNhan-Widget-Setup-%APP_VERSION%.exe  ^(bo cai gop 32-bit + 64-bit^)
echo   - QuayTiepNhan-Widget-Portable-%APP_VERSION%.exe  ^(ban chay ngay 64-bit^)
echo   - latest.yml
echo   - file .blockmap
echo ======================================================
pause
exit /b 0

:NO_NODE
echo LOI: Chua cai Node.js LTS hoac Node.js chua co trong PATH.
goto :FAIL

:CANCEL
echo Da huy. Khong co release nao duoc tao.
exit /b 0

:FAIL
echo.
echo BUILD/PUBLISH THAT BAI. Xem loi o phia tren.
pause
exit /b 1
