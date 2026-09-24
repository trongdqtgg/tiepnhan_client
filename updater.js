/**
 * updater.js - Tu dong kiem tra & cap nhat WIDGET tu GitHub Release (MUC 117).
 *
 * - Dung electron-updater doc latest.yml ma build-and-publish.bat (electron-builder --publish always)
 *   da day len GitHub Release - repo lay tu build.publish trong package.json (electron-builder tu ghi
 *   vao resources/app-update.yml khi build).
 * - CHAY NGAM: kiem tra 1 phut sau khi mo app, sau do moi 4 gio; co ban moi thi TU TAI NGAM, tai xong
 *   bao bang thong bao Windows (toast - KHONG cuop focus nhu hop thoai) + muc menu khay he thong
 *   "Cap nhat len vX (khoi dong lai)". Khong bam thi ban moi tu cai khi thoat ung dung.
 * - Nut "Kiem tra cap nhat" (khay he thong, va trang chu "/" khi mo trong widget): kiem tra ngay,
 *   bao ket qua bang hop thoai rieng cua ung dung (showAppDialog - tu tra focus, xem MUC 111).
 * - Ban PORTABLE khong tu cai duoc (gioi han electron-updater) -> chi bao co ban moi + mo trang tai.
 * - Luc chay dev (npm start, chua dong goi) -> bo qua, khong kiem tra.
 */
const fs = require('fs');
const path = require('path');
const { app, Notification, shell } = require('electron');

let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch {
  autoUpdater = null;
}

const FIRST_CHECK_DELAY_MS = 60 * 1000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

const state = {
  status: 'idle', // idle | checking | none | available | downloading | downloaded | error | unsupported
  currentVersion: app.getVersion(),
  latestVersion: null,
  percent: 0,
  error: null,
  checkedAt: null,
  portable: !!process.env.PORTABLE_EXECUTABLE_DIR,
  releasesUrl: null,
};

let hooks = { onChange: () => {}, showDialog: null };
let interactive = false; // lan kiem tra hien tai do nguoi dung bam nut (can bao ket qua)
let pendingResolvers = [];
let lastPercentNotified = -1;

function releasesUrlFromConfig() {
  try {
    const yml = fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8');
    const owner = (yml.match(/^owner:\s*(.+)$/m) || [])[1];
    const repo = (yml.match(/^repo:\s*(.+)$/m) || [])[1];
    if (owner && repo) return `https://github.com/${owner.trim()}/${repo.trim()}/releases/latest`;
  } catch { /* chua dong goi */ }
  return null;
}

function setState(patch) {
  Object.assign(state, patch);
  try { hooks.onChange(getState()); } catch { /* bo qua */ }
}

function getState() {
  return { ...state };
}

function isSupported() {
  return !!(autoUpdater && app.isPackaged);
}

function toast(title, body) {
  try {
    if (Notification.isSupported()) new Notification({ title, body, silent: false }).show();
  } catch { /* bo qua */ }
}

async function dialog(opts) {
  if (!hooks.showDialog) return -1;
  try { return await hooks.showDialog(null, opts); } catch { return -1; }
}

function resolvePending() {
  const list = pendingResolvers;
  pendingResolvers = [];
  for (const r of list) r(getState());
}

function init(options = {}) {
  hooks = { ...hooks, ...options };
  state.releasesUrl = releasesUrlFromConfig();
  if (!isSupported()) {
    setState({ status: 'unsupported' });
    return;
  }
  autoUpdater.autoDownload = !state.portable;
  autoUpdater.autoInstallOnAppQuit = !state.portable;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = null;

  autoUpdater.on('checking-for-update', () => setState({ status: 'checking', error: null }));

  autoUpdater.on('update-not-available', (info) => {
    setState({ status: 'none', latestVersion: info && info.version, checkedAt: new Date().toISOString() });
    if (interactive) {
      interactive = false;
      dialog({ title: 'Kiểm tra cập nhật', message: `Widget đang dùng phiên bản mới nhất (v${state.currentVersion}).`, buttons: ['Đóng'] });
    }
    resolvePending();
  });

  autoUpdater.on('update-available', (info) => {
    const v = info && info.version;
    setState({ status: state.portable ? 'available' : 'downloading', latestVersion: v, percent: 0, checkedAt: new Date().toISOString() });
    if (state.portable) {
      if (interactive) {
        interactive = false;
        dialog({
          title: 'Có phiên bản mới',
          message: `Đã có Widget v${v} (đang dùng v${state.currentVersion}).\nBản portable không tự cập nhật được - tải bản mới trên trang phát hành.`,
          buttons: ['Để sau', 'Mở trang tải về'], defaultId: 1, cancelId: 0,
        }).then((i) => { if (i === 1 && state.releasesUrl) shell.openExternal(state.releasesUrl); });
      } else {
        toast('Có phiên bản Widget mới', `v${v} - mở menu khay hệ thống > Kiểm tra cập nhật.`);
      }
    } else if (interactive) {
      interactive = false;
      dialog({
        title: 'Có phiên bản mới',
        message: `Đã có Widget v${v} (đang dùng v${state.currentVersion}).\nĐang tải ngầm - tải xong sẽ có thông báo, vẫn dùng widget bình thường trong lúc chờ.`,
        buttons: ['Đóng'],
      });
    }
    resolvePending();
  });

  autoUpdater.on('download-progress', (p) => {
    const percent = Math.floor((p && p.percent) || 0);
    if (percent - lastPercentNotified >= 5 || percent === 100) {
      lastPercentNotified = percent;
      setState({ status: 'downloading', percent });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    lastPercentNotified = -1;
    const v = (info && info.version) || state.latestVersion;
    setState({ status: 'downloaded', latestVersion: v, percent: 100 });
    toast('Bản cập nhật Widget đã sẵn sàng', `v${v} - bấm "Cập nhật lên v${v}" trong menu khay hệ thống, hoặc tự cài khi thoát ứng dụng.`);
  });

  autoUpdater.on('error', (err) => {
    const msg = (err && err.message ? err.message : String(err)).split('\n')[0].slice(0, 300);
    setState({ status: 'error', error: msg, checkedAt: new Date().toISOString() });
    if (interactive) {
      interactive = false;
      dialog({ title: 'Kiểm tra cập nhật', message: `Không kiểm tra được cập nhật:\n${msg}\n\nKiểm tra kết nối Internet của máy này.`, buttons: ['Đóng'] });
    }
    resolvePending();
  });

  setTimeout(() => check(false), FIRST_CHECK_DELAY_MS);
  setInterval(() => check(false), CHECK_INTERVAL_MS);
}

/** Kiem tra ngay. userInitiated=true -> bao ket qua bang hop thoai. Tra ve Promise<state>. */
function check(userInitiated) {
  if (!isSupported()) {
    if (userInitiated) {
      dialog({ title: 'Kiểm tra cập nhật', message: 'Chỉ kiểm tra cập nhật được ở bản đã cài đặt (không áp dụng khi chạy thử bằng npm start).', buttons: ['Đóng'] });
    }
    return Promise.resolve(getState());
  }
  if (state.status === 'downloaded') {
    if (userInitiated) promptInstall();
    return Promise.resolve(getState());
  }
  if (state.status === 'downloading') {
    if (userInitiated) {
      dialog({ title: 'Đang tải bản cập nhật', message: `Đang tải ngầm Widget v${state.latestVersion} (${state.percent}%). Tải xong sẽ có thông báo.`, buttons: ['Đóng'] });
    }
    return Promise.resolve(getState());
  }
  if (userInitiated) interactive = true;
  const p = new Promise((resolve) => pendingResolvers.push(resolve));
  autoUpdater.checkForUpdates().catch(() => { /* da xu ly o su kien 'error' */ });
  return p;
}

async function promptInstall() {
  const i = await dialog({
    title: 'Cập nhật Widget',
    message: `Bản v${state.latestVersion} đã tải xong.\nKhởi động lại widget để cập nhật ngay? (mất khoảng 10-20 giây)`,
    buttons: ['Để sau', 'Khởi động lại & cập nhật'], defaultId: 1, cancelId: 0,
  });
  if (i === 1) install();
}

function install() {
  if (!isSupported() || state.status !== 'downloaded') return false;
  // isSilent=true: cai im lang (khong hien trinh cai dat), isForceRunAfter=true: tu mo lai widget
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
  return true;
}

/** Cac muc menu khay he thong (goi tu buildTrayMenu() trong main.js). */
function trayMenuItems() {
  const s = state;
  if (s.status === 'unsupported') {
    return [{ label: `Phiên bản v${s.currentVersion}`, enabled: false }];
  }
  if (s.status === 'downloaded') {
    return [{ label: `⬆ Cập nhật lên v${s.latestVersion} (khởi động lại)`, click: () => promptInstall() }];
  }
  if (s.status === 'downloading') {
    return [{ label: `Đang tải bản cập nhật v${s.latestVersion} (${s.percent}%)...`, enabled: false }];
  }
  if (s.status === 'checking') {
    return [{ label: 'Đang kiểm tra cập nhật...', enabled: false }];
  }
  if (s.status === 'available' && s.portable) {
    return [{ label: `Có bản mới v${s.latestVersion} - mở trang tải về`, click: () => s.releasesUrl && shell.openExternal(s.releasesUrl) }];
  }
  return [{ label: `Kiểm tra cập nhật (đang dùng v${s.currentVersion})`, click: () => check(true) }];
}

module.exports = { init, check, install, getState, trayMenuItems, promptInstall };
