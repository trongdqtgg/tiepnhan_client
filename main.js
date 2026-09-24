/**
 * Widget desktop LUON-NOI-BEN-TREN cho man hinh quay tiep nhan cua He thong bat so.
 *
 * Kien truc:
 *  - Cua so "widget": khung sieu nho, khong vien (frame:false), trong suot, luon noi tren cung
 *    (alwaysOnTop), tai trang /counter/widget/ tu chinh may chu Node.js dang chay he thong (server
 *    ban da `npm start` o may chu, XEM `config.js`/tray de doi dia chi neu widget nay chay khac
 *    may voi server).
 *  - Cua so "quan ly" (mo bang icon banh rang hoac tray): cua so trinh duyet binh thuong, tai
 *    trang /counter/ day du (dang nhap, chon quay, bat dau ca, keo-tha thu tu uu tien...).
 *  - Cua so "kiosk boc so - Benh nhan" (/kiosk) va "kiosk cap so - Nhan vien" (/staff-kiosk): mo tu
 *    menu tray, chay NGAY TRONG ung dung nay (khong phai trinh duyet ngoai) de dung duoc tinh nang
 *    IN LANG LE (khong hop thoai) qua may in nhiet - xem printTicketSilently() ben duoi.
 *  - Tat ca cac cua so dung CHUNG 1 `partition` (session rieng cua ung dung, tach biet voi
 *    Chrome/Edge that cua may) nen chia se chung cookie (staff_token dang nhap) va localStorage
 *    (counterId da chon) - chi can dang nhap/chon quay 1 lan o cua so quan ly, cac cua so khac se
 *    tu biet ngay.
 *  - Khay he thong (Tray): bat/tat "Luon noi ben tren", bat/tat "Khoi dong cung Windows" (dung
 *    thang API cua Electron, KHONG can tu tao shortcut trong thu muc Startup nhu cach lam thu
 *    cong truoc day), doi dia chi may chu, chon may in nhiet, an/hien widget, thoat ung dung.
 */
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, dialog, shell, session } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { loadConfig, saveConfig } = require('./config');

/**
 * `pdf-to-printer` (goi rieng, xem package.json "dependencies") - dung SumatraPDF (dong goi san
 * ben trong thu vien, khong can cai them gi) de in TRUC TIEP 1 file PDF ra may in, KHONG di qua
 * API in cua Chromium/Electron (webContents.print()) nua - xem printTicketSilently() ben duoi de
 * biet ly do phai doi sang cach nay (webContents.print() voi pageSize tuy chinh van bi driver may
 * in Epson BO QUA tren thuc te, du gia tri gui di hoan toan dung). Bao trong try/catch vi day la
 * dependency MOI - neu ai do quen chay "npm install" lai sau khi cap nhat, ung dung se KHONG bi
 * crash ma tu dong roi ve cach in cu (webContents.print(), co the van bi hien hop thoai) kem canh
 * bao ro rang trong file log, thay vi lam sap toan bo widget.
 */
let pdfToPrinter = null;
try {
  pdfToPrinter = require('pdf-to-printer');
} catch (err) {
  console.error('[PRINT] Không tải được thư viện pdf-to-printer (có thể thiếu "npm install" trong electron-widget/) - sẽ dùng phương án in dự phòng cũ:', err.message);
}

/**
 * TRUOC DAY co ghi log chan doan in ra 1 FILE TEXT tren Desktop (kem 1 ban sao PDF cua lan in gan
 * nhat) de ho tro chan doan loi in lang le - nay BO HAN viec ghi file nay (ca 2 muc tray "Mở file
 * nhật ký in"/"Mở file PDF phiếu vừa in" cũng đã bỏ) theo yêu cầu tắt bớt ghi log cho widget nhẹ
 * máy hơn (bớt I/O đĩa không cần thiết chạy nền liên tục). Giữ lại HAM debugLog() dạng NO-OP (rong)
 * thay vi xoa tung loi goi debugLog(...) rai rac trong printTicketSilently() o duoi - tranh sua
 * hang chuc dong khong lien quan, dong thoi neu sau nay can bat lai chan doan chi can doi lai than
 * ham nay.
 */
function debugLog() {
  // Khong lam gi ca (no-op) - xem ghi chu o tren.
}

const PARTITION = 'persist:queue-widget';

// "Chia khoa" gui kem qua header cho MOI request toi /kiosk tren server, de man hinh kiosk boc so
// cho benh nhan LUON vao thang duoc MA KHONG CAN dang nhap - xem giai thich day du (ly do, pham vi,
// danh doi bao mat) tai dinh nghia DEFAULT_KIOSK_WIDGET_SECRET trong src/server.js. Widget luon tu
// GAN header nay (setupKioskWidgetSecretHeader() ben duoi) - KHONG doi qua man hinh nao, chi co the
// doi bang cach sua truc tiep hang so nay (va gia tri KIOSK_WIDGET_SECRET tren server) roi dong goi
// lai widget, danh cho truong hop can that chat hon gia tri mac dinh dung chung.
const KIOSK_WIDGET_SECRET = 'queue-widget-kiosk-2024';

/**
 * Tu dong gan header "X-Kiosk-Widget-Secret" vao MOI request (trang chinh /kiosk/ VA moi tai
 * nguyen con nhu kiosk.js, anh, API goi tu trang do) co duong dan bat dau bang "/kiosk" - dung
 * `session.webRequest.onBeforeSendHeaders` tren TOAN BO PARTITION dung chung (thay vi rieng cho 1
 * cua so) vi PARTITION nay dung chung cho ca widget/kiosk/staff-kiosk/settings - loc theo DUONG DAN
 * cua tung request (khong phai theo cua so nao goi) de header CHI di kem cac request toi /kiosk,
 * khong "ro ri" sang /staff-kiosk hay /counter (nhung man hinh do van phai dang nhap binh thuong).
 * Goi 1 LAN DUY NHAT luc app khoi dong (app.whenReady()) - khong phu thuoc kioskWindow co dang mo
 * hay khong, ke ca tat/mo lai cua so kiosk nhieu lan trong 1 phien widget van hoat dong dung.
 */
function setupKioskWidgetSecretHeader() {
  const ses = session.fromPartition(PARTITION);
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    try {
      const { pathname } = new URL(details.url);
      if (pathname === '/kiosk' || pathname.startsWith('/kiosk/')) {
        details.requestHeaders['X-Kiosk-Widget-Secret'] = KIOSK_WIDGET_SECRET;
      }
    } catch {
      // URL khong hop le (hiem gap) - bo qua, gui request nhu cu khong kem header.
    }
    callback({ requestHeaders: details.requestHeaders });
  });
}
// Widget la 1 THANH NGANG DUY NHAT (khong xuong dong) - chi can du cao cho 1 dong noi dung. Tung
// co luc tang len 76/66 (2 dong) khi 8 nut "goi rieng tung doi tuong" con nam o 1 dong RIENG ben
// duoi - nay da GOP lai vao chinh cum so luong dang cho (#queueCounts, xem
// public/counter/widget/index.html/widget.js) nen quay VE LAI 1 dong duy nhat, chieu cao tro ve
// nhu cu (40/36). Chieu RONG mac dinh tang nhe (430 -> 480) de cum #queueCounts (gio la 8 nut bam
// duoc, can khoang cham/bam rong hon chu so thuan tuy truoc day) co du cho hien het tren 1 dong ma
// khong phai cuon ngang; cua so van luon RESIZE duoc tay neu nhan vien muon thu gon hon.
const WIDGET_DEFAULT_SIZE = { width: 480, height: 40 };
// Theo yeu cau: "widget ngang nó đang k có giới hạn đó" - be RONG toi thieu (min) TRUOC DAY la
// 340px, qua nho so voi luong noi dung HIEN TAI (ma quay + so + 3 nut goi so + 8 nut cap so nhanh -
// muc 58 + 3 nut khac + cum so luong cho + nut banh rang), du muc 59 da cho ca thanh #mainView tu
// cuon ngang duoc khi thieu cho (khong con bi "vo" bo cuc/de bi hieu nham la chong len nhau nua) -
// nhung o 340px, PHAN "LOI" luon hien san (ma quay/so dang phuc vu/3 nut goi chinh) van bi eo hep
// qua muc, nhin roi mat. Tang len 420px de PHAN LOI do luon co du cho thoai mai KHONG CAN cuon,
// chi phan con lai (cac nut cap so nhanh/so luong cho o xa hon) moi can cuon ngang khi widget dang
// de nho hon muc mac dinh (480px). Chieu cao (height) tang tu 36 -> 40 (khop dung chieu cao co dinh
// cua #mainView, 38px + 2px du phong) de tranh bi cat mat 1 chut o duoi khi ha window xuong toi
// thieu chieu cao.
// Theo phan anh moi nhat ("khi thu nhỏ quá nó bị mất luôn nội dung"): tang them 1 chut du phong
// chieu cao (40 -> 44px) so voi #mainView (co dinh 40px, xem index.html) de chac chan khong bao
// gio bi cat mat noi dung ke ca sai so lam tron/vien cua so. LUU Y QUAN TRONG: Electron ap dung gioi
// han nay NGAY LUC TAO cua so (thuoc tinh native cua he dieu hanh, khong phai CSS) - neu ung dung
// widget dang MO SAN tu TRUOC KHI cap nhat len ban co gia tri moi nay, gioi han CU (vi du 340x36 tu
// cac ban rat cu, hoac 420x40 tu ban truoc) van con hieu luc cho toi khi THOAT HAN va MO LAI ung
// dung (khong chi keo/tha lai cua so) - day rat co the la nguyen nhan cua hien tuong "vẫn kéo được
// nhỏ xíu" da phan anh, neu chua thoat han ung dung sau khi cap nhat.
const WIDGET_MIN_SIZE = { width: 420, height: 44 };
// CHE DO DOC (moi, theo yeu cau): "xoay" y het noi dung/kich thuoc cac phan tu cua thanh ngang o
// tren sang xep TU TREN XUONG DUOI thay vi TRAI SANG PHAI - be RONG thu nho toi da (gan bang be
// RONG 1 nut vuong, ~26px + le), be CAO thi du de hien duoc het cac nhom noi dung (co the cuon rieng
// #queueCounts neu qua nhieu doi tuong uu tien - xem CSS ".vertical #queueCounts" trong
// public/counter/widget/index.html) - cua so van RESIZE duoc tay nhu binh thuong neu can thu gon/mo
// rong them. Dung RIENG 1 cap hang so nay (khong dung chung WIDGET_DEFAULT_SIZE/WIDGET_MIN_SIZE o
// tren) vi 2 huong co ty le rat khac nhau.
const WIDGET_DEFAULT_SIZE_VERTICAL = { width: 54, height: 480 };
const WIDGET_MIN_SIZE_VERTICAL = { width: 46, height: 260 };

function isWidgetVertical() {
  return config.widgetOrientation === 'vertical';
}
/** Tra ve dung cap "kich thuoc mac dinh/toi thieu" theo huong HIEN TAI cua widget (xem
 * config.widgetOrientation - doi qua muc tray "Hiển thị widget theo chiều dọc"). */
function currentWidgetDefaultSize() {
  return isWidgetVertical() ? WIDGET_DEFAULT_SIZE_VERTICAL : WIDGET_DEFAULT_SIZE;
}
function currentWidgetMinSize() {
  return isWidgetVertical() ? WIDGET_MIN_SIZE_VERTICAL : WIDGET_MIN_SIZE;
}
/** Ten field luu vi tri/kich thuoc trong config - LUU RIENG cho tung huong (widgetBounds cho ngang,
 * widgetBoundsVertical cho doc) de doi qua doi lai KHONG lam mat vi tri/kich thuoc da tung chinh tay
 * cho huong kia (nguoi dung co the doi qua doi lai nhieu lan tuy luc). */
function currentWidgetBoundsKey() {
  return isWidgetVertical() ? 'widgetBoundsVertical' : 'widgetBounds';
}

let config = null;
let widgetWindow = null;
let settingsWindow = null;
let promptWindow = null;
let patientScreenWindow = null;
let patientScreenCounterId = null;
let kioskWindow = null;
let staffKioskWindow = null;
let waitingScreenWindow = null;
let widgetWasVisibleBeforeKiosk = false;
let tray = null;
/**
 * MUC 106 - "kiểm tra chức năng máy quét trên widget ... mất form nhập liệu": danh dau dang co 1
 * hop thoai He dieu hanh (dialog.showErrorBox()/showMessageBox() - KHONG gan `parent`) dang mo (do
 * NHAN VIEN CHU DONG mo, vi du chon may in tu khay he thong - xem pickPrinterFromTray()). Cac hop
 * thoai nay CUOP OS-level keyboard focus, nen kioskWindow.on('blur', ...) ben duoi (co che tu dong
 * lay lai focus cho man hinh boc so benh nhan luon fullscreen/khong co ai truc) can biet de TAM
 * HOAN, tranh giat hop thoai that su can nhan vien tuong tac ra khoi tay ho.
 */
let blockingDialogOpen = false;
// Bo dem (debounce) cua lan luu vi tri/kich thuoc widget GAN NHAT dang cho (xem scheduleSaveBounds()
// trong createWidgetWindow() va flushWidgetBoundsSave() ngay duoi) - de o pham vi module (khong con
// nam rieng trong createWidgetWindow()) de app.on('before-quit') o cuoi file co the GHI NGAY LAP TUC
// (khong cho du 400ms debounce) truoc khi ung dung thuc su thoat.
let widgetBoundsSaveTimer = null;

/**
 * Theo phan anh: "widget dọc không lưu lại vị trí và kích thước tôi đã điều chỉnh" - NGUYEN NHAN:
 * scheduleSaveBounds() (gan trong createWidgetWindow(), theo doi su kien 'move'/'resize' cua
 * widgetWindow) chi LUU SAU 400ms debounce (tranh ghi file lien tuc trong luc dang keo/tha) - neu
 * nguoi dung keo/thu widget xong RỒI THOÁT ỨNG DỤNG NGAY (qua mục tray "Thoát", vốn gọi thẳng
 * `app.quit()`) TRONG VÒNG CHƯA ĐẾN 400ms đó, hẹn giờ debounce CHƯA KỊP CHẠY thì tiến trình đã bị
 * thoát rồi - lần chỉnh cuối cùng KHÔNG BAO GIỜ được ghi vào file cấu hình, mở lại ứng dụng thấy
 * widget về đúng vị trí/kích thước CŨ (trước lần chỉnh) chứ không phải "không lưu" theo nghĩa cơ
 * chế lưu bị hỏng hoàn toàn - đây LÀ kịch bản rất tự nhiên: chỉnh xong widget dọc là thoát luôn để
 * xem có lưu không (hoặc tắt máy/khởi động lại Windows ngay sau khi vừa chỉnh). Hàm này GHI NGAY
 * LẬP TỨC (bỏ qua debounce) vị trí/kích thước hiện tại của widget - gọi từ app.on('before-quit')
 * bên dưới để đảm bảo LUÔN lưu đúng lần chỉnh cuối cùng trước khi ứng dụng thực sự thoát, bất kể
 * người dùng thoát nhanh thế nào sau khi vừa kéo/thả xong.
 */
function flushWidgetBoundsSave() {
  if (widgetBoundsSaveTimer) {
    clearTimeout(widgetBoundsSaveTimer);
    widgetBoundsSaveTimer = null;
  }
  if (!config || !widgetWindow || widgetWindow.isDestroyed()) return;
  config[currentWidgetBoundsKey()] = widgetWindow.getBounds();
  saveConfig(app, config);
}

function widgetUrl() {
  // `?orientation=vertical` (khi dang o che do doc) de public/counter/widget/widget.js tu doc qua
  // location.search luc tai trang, gan class CSS tuong ung ngay tu dau (tranh "nhap nhay" doi bo
  // cuc SAU khi trang da hien ra) - xem applyOrientationFromQuery() trong widget.js.
  return `${config.serverUrl}/counter/widget/${isWidgetVertical() ? '?orientation=vertical' : ''}`;
}
function settingsUrl() {
  return `${config.serverUrl}/counter/`;
}
function patientScreenUrl(counterId) {
  return `${config.serverUrl}/patient-screen/?counter=${encodeURIComponent(counterId)}`;
}
function kioskUrl() {
  return `${config.serverUrl}/kiosk/`;
}
function staffKioskUrl() {
  return `${config.serverUrl}/staff-kiosk/`;
}
function waitingScreenUrl() {
  return `${config.serverUrl}/waiting-screen/`;
}

/** Vi tri mac dinh: goc tren-ben-phai man hinh chinh, cach le 1 chut - noi de nhin thay nhat
 * ma khong che thanh taskbar (thuong o duoi hoac tren cung Windows). */
function defaultWidgetBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  const size = currentWidgetDefaultSize();
  return {
    x: workArea.x + workArea.width - size.width - 16,
    y: workArea.y + 16,
    width: size.width,
    height: size.height,
  };
}

/**
 * Neu vi tri/kich thuoc da luu tu 1 LAN CHAY CU (vi du ban cu cua ung dung, hoac nguoi dung tung
 * keo/thu nho cua so) nho hon kich thuoc toi thieu HIEN TAI cua thanh ngang 1 dong, ep no ve dung
 * kich thuoc toi thieu - tranh tinh trang widget "ket" o kich thuoc cu qua nho khien noi dung bi
 * cat mat (vi du chi con thay ma quay + icon banh rang, cac nut/so lieu o giua bien mat vi khong
 * du cho).
 */
function sanitizeBounds(bounds) {
  if (!bounds) return null;
  const min = currentWidgetMinSize();
  return {
    ...bounds,
    width: Math.max(bounds.width, min.width),
    height: Math.max(bounds.height, min.height),
  };
}

/**
 * Trang "đang chờ kết nối máy chủ" hiện TẠM trong 1 cửa sổ khi loadURL() tới máy chủ Node.js thất
 * bại (ví dụ server chưa khởi động, sai địa chỉ, mạng lỗi...) - THAY VÌ để Electron hiện trang lỗi
 * mặc định của Chromium ("Không thể truy cập trang này") rồi "kẹt" luôn ở đó, không thao tác được
 * gì cả (đúng lỗi ERR_CONNECTION_REFUSED người dùng gặp phải). Widget/các cửa sổ khác PHẢI luôn mở
 * ra được và TỰ ĐỘNG thử kết nối lại định kỳ cho tới khi máy chủ sẵn sàng - hữu ích nhất lúc mới
 * bật máy tính (ứng dụng widget khởi động cùng Windows nhưng máy chủ Node.js có thể chưa kịp chạy),
 * hoặc lúc đang khởi động lại máy chủ riêng.
 */
function offlinePlaceholderHtml(serverUrl) {
  const safeUrl = String(serverUrl || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8" />
<style>
  html, body { margin:0; padding:0; height:100%; background:#0f172a; color:#e2e8f0;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif; }
  .wrap { height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center;
    text-align:center; padding:16px; box-sizing:border-box; }
  .spinner { width:26px; height:26px; border-radius:50%; border:3px solid rgba(226,232,240,0.25);
    border-top-color:#38bdf8; animation:spin 0.9s linear infinite; margin-bottom:12px; }
  @keyframes spin { to { transform:rotate(360deg); } }
  h1 { font-size:14px; font-weight:600; margin:0 0 6px; }
  p { font-size:12px; color:#94a3b8; margin:0; max-width:320px; line-height:1.5; }
  code { color:#e2e8f0; }
</style></head>
<body><div class="wrap">
  <div class="spinner"></div>
  <h1>Đang chờ kết nối tới máy chủ...</h1>
  <p>Không kết nối được <code>${safeUrl}</code>. Ứng dụng sẽ tự động thử kết nối lại, không cần
  thao tác gì thêm - vui lòng kiểm tra máy chủ hệ thống (<code>npm start</code>) đã được bật hay
  chưa.</p>
</div></body></html>`;
}

/**
 * Gắn cơ chế TỰ ĐỘNG THỬ KẾT NỐI LẠI cho 1 cửa sổ tải nội dung từ máy chủ Node.js (widget, màn
 * hình quản lý, kiosk...). Nếu `loadURL()` thất bại vì KHÔNG KẾT NỐI ĐƯỢC máy chủ (server chưa
 * chạy, sai địa chỉ, mất mạng... - phân biệt với lỗi Ở TẦNG HTTP như 404/500, những lỗi đó nghĩa là
 * máy chủ ĐÃ CHẠY nên không cần xử lý ở đây, cứ hiển thị bình thường), hiện trang "đang chờ kết
 * nối" tối giản ở trên ngay trong cửa sổ (thay vì để Electron hiện trang lỗi mặc định rồi kẹt luôn
 * ở đó) và TỰ ĐỘNG `loadURL()` lại nội dung thật mỗi `retryMs` (mặc định 3 giây) cho tới khi vào
 * được - không cần đóng/mở lại ứng dụng thủ công.
 */
function attachReconnectOnFail(win, urlFn, retryMs = 3000) {
  let retryTimer = null;
  win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    // -3 (ERR_ABORTED): do CHINH cua so nay tu huy 1 lan tai truoc do (vi du dang loadURL() lien
    // tiep, hoac nguoi dung dieu huong sang trang khac ngay giua chung) - khong phai loi ket noi
    // that su toi may chu, bo qua de tranh hien nham trang "dang cho ket noi"/lap lich thu lai
    // khong can thiet.
    if (errorCode === -3) return;
    console.error(
      `[RECONNECT] Không tải được ${validatedURL} (${errorDescription}, mã lỗi ${errorCode}) - sẽ tự động thử kết nối lại sau ${retryMs}ms.`
    );
    if (win.isDestroyed()) return;
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(offlinePlaceholderHtml(config.serverUrl)));
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      win.loadURL(urlFn());
    }, retryMs);
  });
  win.on('closed', () => clearTimeout(retryTimer));
}

function createWidgetWindow() {
  const bounds = sanitizeBounds(config[currentWidgetBoundsKey()]) || defaultWidgetBounds();
  const minSize = currentWidgetMinSize();
  widgetWindow = new BrowserWindow({
    ...bounds,
    minWidth: minSize.width,
    minHeight: minSize.height,
    frame: false,
    transparent: true,
    hasShadow: true,
    resizable: true,
    alwaysOnTop: config.alwaysOnTop,
    skipTaskbar: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (config.alwaysOnTop) widgetWindow.setAlwaysOnTop(true, 'screen-saver');
  widgetWindow.setMenu(null);
  widgetWindow.loadURL(widgetUrl());
  // Widget PHAI luon mo duoc va tu dong cho/thu ket noi lai neu may chu chua san sang - xem
  // attachReconnectOnFail() o tren (khac phuc loi ERR_CONNECTION_REFUSED khien widget "kẹt" hoan
  // toan khong dung duoc, tung gap khi may chu chua kip khoi dong luc widget tu chay cung Windows).
  attachReconnectOnFail(widgetWindow, widgetUrl);

  // Luu lai vi tri/kich thuoc moi khi nguoi dung keo/doi co widget - de lan sau mo lai dung y
  // cho da dat (debounce nhe de khong ghi file lien tuc trong luc dang keo). Dung bien dem
  // `widgetBoundsSaveTimer` O PHAM VI MODULE (khong con khai bao rieng bien `let saveTimer` trong
  // ham nay nhu truoc) de flushWidgetBoundsSave() (goi tu app.on('before-quit')) co the huy hen gio
  // nay va ghi NGAY LAP TUC truoc khi ung dung thoat - xem ghi chu day du o flushWidgetBoundsSave().
  const scheduleSaveBounds = () => {
    clearTimeout(widgetBoundsSaveTimer);
    widgetBoundsSaveTimer = setTimeout(() => {
      widgetBoundsSaveTimer = null;
      if (!widgetWindow || widgetWindow.isDestroyed()) return;
      // Luu vao DUNG field cua HUONG HIEN TAI (widgetBounds hoac widgetBoundsVertical) - xem
      // currentWidgetBoundsKey() o tren.
      config[currentWidgetBoundsKey()] = widgetWindow.getBounds();
      saveConfig(app, config);
    }, 400);
  };
  widgetWindow.on('move', scheduleSaveBounds);
  widgetWindow.on('resize', scheduleSaveBounds);

  widgetWindow.on('closed', () => { widgetWindow = null; });
}

/**
 * `openTarget` (tuy chon): 'priority-order' hoac 'skipped' - duoc gan vao CUOI URL dang "hash"
 * (vi du "/counter/#priority-order") de trang /counter (counter.js) TU DONG mo san dung modal
 * tuong ung ngay khi tai xong, thay vi luon mo ra man hinh lam viec thuong roi nguoi dung phai tu
 * bam nut. Dung cho 2 nut moi tren widget sieu nho (⏱️ Thứ tự ưu tiên / 👥 DS vắng mặt - xem
 * widget.js) - vi widget qua nho de nhet them 2 khoi giao dien day du (keo-tha thu tu, danh sach
 * bo qua) ngay trong do, nen "dan" sang cua so /counter day du nhung mo THANG vao dung phan can
 * xem, khong bat nhan vien phai tu tim lai.
 *
 * LUON dieu huong lai (loadURL) moi lan goi ham nay, ke ca khi cua so settings DA MO SAN (khong
 * chi show()+focus() nhu truoc) - vi tu khi co hideSettingsWindow() (goi ngay sau khi dang nhap
 * quay xong, xem selectCounter() trong counter.js) cua so nay co the bi AN (hide(), khong destroy)
 * voi trang thai CU (vi du van con hien "dang lam viec" cua 1 quay da THOAT tu widget qua nut
 * "Đăng xuất nhanh" - counter.js trong cua so nay khong tu biet duoc thay doi do vi dang bi an,
 * khong nhan duoc su kien nao) - tai lai trang moi lan mo dam bao LUON dung dong bo voi phien quay
 * hien tai (localStorage) thay vi hien nham trang thai cu.
 *
 * KHONG toan man hinh (theo yeu cau moi nhat): muc 45 co lan doi cua so nay sang LUON toan man hinh
 * giong /kiosk/, /staff-kiosk/, /waiting-screen/ - nhung sau khi dung thu, nguoi dung yeu cau doi
 * lai NHU CU cho rieng man hinh nay (mo cua so binh thuong, co the thu nho/phong to/keo canh) - vi
 * day la man hinh THAO TAC nhieu (chon quay, keo-tha thu tu uu tien, xem danh sach bo qua...), toan
 * man hinh gay bat tien khi can thao tac linh hoat. `/staff-kiosk` va `/waiting-screen` VAN GIU toan
 * man hinh nhu mo ta o muc 45 - CHI RIENG cua so nay (`/counter`) quay lai kieu cua so thuong.
 */
function createSettingsWindow(openTarget) {
  const url = openTarget ? `${settingsUrl()}#${openTarget}` : settingsUrl();
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.loadURL(url);
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 1000,
    height: 780,
    minWidth: 480,
    minHeight: 480,
    title: 'Màn hình quầy tiếp nhận',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      // Gan preload de trang /counter cung dung duoc window.widgetBridge (vi du openPatientScreen()
      // trong counter.js goi widgetBridge.openPatientScreen() thay vi window.open() thuong, de mo
      // dung man hinh benh nhan qua co che TU DONG chon man hinh phu + toan man hinh cua main.js -
      // xem openPatientScreenWindow() - thay vi 1 popup binh thuong khong toan man hinh/khong doi
      // duoc man hinh nhu truoc).
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  settingsWindow.setMenu(null);
  settingsWindow.loadURL(url);
  attachReconnectOnFail(settingsWindow, settingsUrl);
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

/**
 * An (KHONG dong) cua so man hinh quan ly (/counter) - goi ngay sau khi dang nhap 1 quay xong (xem
 * selectCounter() trong counter.js), theo yeu cau: "sau khi đăng nhập quầy chỉ hiện màn hình
 * patient-screen fullscreen ở màn hình thứ 2, không cần bật các màn hình nào khác" - truoc day sau
 * khi dang nhap, cua so /counter nay VAN o lai tren man hinh (hien "dang lam viec"), trung lap voi
 * widget nho (ca 2 cung dieu khien duoc goi so) va choan man hinh chinh cua nhan vien khong can
 * thiet. Dung hide() (khong dung close()) de nhan vien van mo lai duoc ngay qua nut ⚙️ tren widget
 * bat ky luc nao can (vi du sua thu tu uu tien, xem danh sach bo qua...) ma khong mat trang thai
 * dang dang nhap - createSettingsWindow() o tren se tu tai lai trang moi lan mo lai de luon dong bo.
 */
function hideSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.hide();
}

/**
 * Man hinh benh nhan (/patient-screen) - benh nhan trong phong cho se nhin man hinh nay, nen
 * PHAI: (1) tu dong chuyen sang MAN HINH PHU neu may co nhieu man hinh (khong hien tren man hinh
 * cua nhan vien), (2) tu dong vao TOAN MAN HINH ngay, khong can nhan vien tu keo cua so + bam F11
 * nhu cach lam thu cong truoc day (van con lam duoc thu cong o /counter neu can, xem
 * openPatientScreen() trong counter.js).
 *
 * Chon "man hinh phu": Electron liet ke TAT CA man hinh dang cam qua `screen.getAllDisplays()` -
 * neu co nhieu hon 1, lay man hinh dau tien KHONG PHAI la man hinh chinh (primary, thuong la man
 * hinh dat cua nhan vien). Neu chi co 1 man hinh (may khong noi them man hinh phu), danh cho toan
 * man hinh chinh - van tot hon la khong tu dong gi ca.
 */
function pickSecondaryDisplay() {
  const displays = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;
  return displays.find((d) => d.id !== primaryId) || displays[0];
}

/**
 * `opts.bringToFront` (mac dinh true): khi cua so man hinh benh nhan ĐÃ MỞ SẴN đúng quầy này rồi,
 * co dua no ra truoc + focus + ep lai toan man hinh hay KHONG. Nut "Mở màn hình bệnh nhân" tren
 * widget/trang /counter (bam thu cong) LUON muon dua ra truoc (mac dinh true, giu nguyen hanh vi cu)
 * - nhung cac nut GOI SO (Gọi tiếp theo/Gọi lại/Bỏ qua/Gọi riêng đối tượng, xem ensurePatientScreen()
 * trong widget.js) chỉ muốn "ĐẢM BẢO đang mở, nếu CHƯA mở thì tự mở" - KHÔNG muốn cướp focus/hiện lại
 * mỗi lần bấm nếu màn hình đó ĐÃ đang mở sẵn rồi (nhân viên gọi số hàng chục lần/ca, dua cua so ra
 * truoc moi lan se rat phien, lam mat tap trung cua so widget dang thao tac) - truyen
 * `{ bringToFront: false }` cho truong hop nay.
 *
 * TRA VE 1 PROMISE - giai quyet (resolve) ngay neu man hinh DA mo san dung quay, hoac SAU KHI trang
 * moi mo da tai xong + doi them 1 khoang du de socket.io ket noi xong (toi da 3 giay - luoi an toan
 * neu mang cham/loi). Ly do can cho: man hinh benh nhan CHI phat am thanh goi so khi NHAN duoc su
 * kien socket "counter:called"/"counter:reannounce" LUC DO (xem public/patient-screen/index.html) -
 * neu lenh goi so (API) chay TRUOC KHI man hinh nay kip mo/ket noi socket xong, su kien se "bay qua
 * dau" (man hinh chua ton tai de nhan), phieu van goi duoc nhung KHONG co am thanh cho lan goi do,
 * chi thay dung SO qua 1 lan fetch trang thai ban dau (khong phat am). Ham `ensurePatientScreen()`
 * trong widget.js se CHO (await) promise nay xong MOI thuc su goi API goi so, dam bao khong bi mat
 * tieng o lan goi dau tien khi man hinh benh nhan tu dong bat.
 */
function openPatientScreenWindow(counterId, opts = {}) {
  const { bringToFront = true } = opts;
  if (!counterId) return Promise.resolve();

  if (patientScreenWindow && !patientScreenWindow.isDestroyed()) {
    if (String(patientScreenCounterId) === String(counterId)) {
      // Dung quay da mo san - CHI dua ra truoc + dam bao van dang toan man hinh NEU duoc yeu cau
      // (xem giai thich opts.bringToFront o tren) - neu khong, coi nhu "da dam bao mo roi", khong
      // lam gi them ca, tranh cuop focus/hien lai cua so khong can thiet. Da mo san tu truoc nen
      // KHONG can cho gi them - socket chac chan da ket noi xong tu lau roi.
      if (bringToFront) {
        patientScreenWindow.show();
        patientScreenWindow.focus();
        if (!patientScreenWindow.isFullScreen()) patientScreenWindow.setFullScreen(true);
      }
      return Promise.resolve();
    }
    // Doi sang quay khac - dong cua so cu, mo cua so moi dung quay vua chon (LUON mo trong truong
    // hop nay du bringToFront la gi, vi man hinh dang mo KHONG PHAI dung quay hien tai).
    patientScreenWindow.close();
  }

  const target = pickSecondaryDisplay();
  patientScreenCounterId = counterId;
  patientScreenWindow = new BrowserWindow({
    x: target.bounds.x,
    y: target.bounds.y,
    width: target.bounds.width,
    height: target.bounds.height,
    show: false, // chi hien sau khi da vao toan man hinh (ready-to-show ben duoi) - tranh nhap nhay
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const win = patientScreenWindow;
  win.setMenu(null);
  win.loadURL(patientScreenUrl(counterId));
  attachReconnectOnFail(win, () => patientScreenUrl(counterId));
  // Doi trang tai xong roi moi vao toan man hinh - tranh nhap nhay/chuyen dung vi tri man hinh
  // truoc khi noi dung san sang.
  win.once('ready-to-show', () => {
    if (!win || win.isDestroyed()) return;
    win.setFullScreen(true);
    win.show();
  });
  win.on('closed', () => {
    patientScreenWindow = null;
    patientScreenCounterId = null;
  });

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    // 'did-finish-load': script cua trang (bao gom dong dau tien "const socket = io();") da CHAY
    // xong - socket.io da BAT DAU ket noi tu day, nhung co the chua HOAN TAT ngay lap tuc - doi them
    // 500ms nua (thua du tren mang LAN/localhost) truoc khi coi la "san sang".
    win.webContents.once('did-finish-load', () => setTimeout(finish, 500));
    win.once('closed', finish); // cua so bi dong giua chung (vi du doi quay khac ngay lap tuc) - khong cho mai mai
    setTimeout(finish, 3000); // luoi an toan tuyet doi - mang qua cham/loi tai trang cung khong chan qua 3 giay
  });
}

/**
 * Dong cua so man hinh benh nhan dang mo (neu co) - dung cho nut "Đăng xuất nhanh" moi tren widget
 * (xem logoutCounter() trong widget.js): nhan vien roi quay thi man hinh benh nhan cung KHONG con
 * ly do gi de tiep tuc hien (khong ai goi so nua) - tu dong dong luon cho gon, khong bat nhan vien
 * phai tu tay dong rieng cua so nay (thuong dang toan man hinh o man hinh phu, de quen mo lai gay
 * nham cho benh nhan ke tiep). An toan goi ke ca khi khong co cua so nao dang mo (khong lam gi).
 */
function closePatientScreenWindow() {
  if (patientScreenWindow && !patientScreenWindow.isDestroyed()) {
    patientScreenWindow.close();
  }
}

/**
 * Man hinh kiosk boc so cho BENH NHAN (/kiosk) - moi thao tac deu TU DONG qua may quet QR, khong
 * can bam nut/ban phim/chuot gi ca (xem README muc 4b), nen mo TOAN MAN HINH luon cho gon, khong
 * con thanh dia chi/khung trinh duyet de benh nhan khong thay duoc dia chi IP/localhost cua may
 * chu (giong tinh than nut "Chế độ Kiosk ⛶" o ban trinh duyet thuong, nhung tu dong hoan toan).
 *
 * Vi day la man hinh cho BENH NHAN thao tac (khong phai nhan vien), nen luc mo se TU DONG AN
 * widget - widget la cong cu rieng cho nhan vien tiep nhan, hien ra luc nay chi gay roi hoac khien
 * benh nhan tuong nham la co the bam vao. Dong cua so kiosk (Alt+F4, hoac tu tray) se TU DONG HIEN
 * LAI widget - nhung CHI khi widget dang hien truoc do (neu nhan vien da chu dong an widget tu
 * truoc khi mo kiosk, dong kiosk se khong tu lam widget hien ra ngoai y muon).
 */
function openKioskWindow() {
  if (kioskWindow && !kioskWindow.isDestroyed()) {
    kioskWindow.show();
    kioskWindow.focus();
    if (!kioskWindow.isFullScreen()) kioskWindow.setFullScreen(true);
    return;
  }

  widgetWasVisibleBeforeKiosk = !!(widgetWindow && !widgetWindow.isDestroyed() && widgetWindow.isVisible());
  if (widgetWasVisibleBeforeKiosk) widgetWindow.hide();

  kioskWindow = new BrowserWindow({
    show: false, // chi hien sau khi da vao toan man hinh (ready-to-show ben duoi) - tranh nhap nhay
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      partition: PARTITION,
      // Gan preload.js de trang /kiosk dung duoc `window.electronPrint.print()` - in phieu LANG LE
      // (khong hop thoai) qua may in nhiet, xem printTicketSilently() ben duoi va preload.js.
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  kioskWindow.setMenu(null);
  kioskWindow.loadURL(kioskUrl());
  attachReconnectOnFail(kioskWindow, kioskUrl);
  kioskWindow.once('ready-to-show', () => {
    if (!kioskWindow || kioskWindow.isDestroyed()) return;
    kioskWindow.setFullScreen(true);
    kioskWindow.show();
  });
  /**
   * MUC 106 - "kiểm tra chức năng máy quét trên widget ... mất form nhập liệu": kioskWindow la man
   * hinh boc so cho BENH NHAN, LUON fullscreen va KHONG CO AI TRUC de tu bam lay lai cua so neu no
   * lo mat OS-level keyboard focus (vi du: mot cua so khac duoc tao/hien len ngay dung luc do - xem
   * openPatientScreenWindow(), hoac nhan vien vo tinh mo /counter, /staff-kiosk... tu khay he thong
   * tren CUNG 1 may voi kiosk). Truoc day KHONG co bat ky co che nao tu dong TRA LAI focus cho
   * kioskWindow sau khi no bi "blur" (mat focus) - may quet ma (hoat dong y het ban phim vat ly) khi
   * do se gui ky tu toi cua so DANG CO OS FOCUS luc nay (khong phai kioskWindow nua), khien man hinh
   * kiosk "khong nhap lieu duoc nua" dung nhu phan anh, ke ca sau khi cua so/hop thoai kia da dong -
   * vi khong ai chu dong bam lai vao kiosk de tra focus thu cong.
   * SUA: lang nghe su kien 'blur', CHO 1 khoang tre ngan (1200ms - du de 1 hop thoai/cua so HOP LE
   * thuc su can tuong tac (vi du dialog chon may in - xem blockingDialogOpen o dau file) kip hien ra
   * va nguoi dung kip thay, tranh giat focus NGAY LAP TUC ngay khi no vua xuat hien), roi TU DONG
   * goi lai .focus() NEU: (1) kioskWindow van con ton tai (chua bi dong trong luc cho), (2) KHONG co
   * hop thoai He dieu hanh hop le nao dang mo can nhan vien tuong tac (blockingDialogOpen), va (3)
   * kioskWindow THUC SU van chua duoc focus lai (tranh goi .focus() thua neu nguoi dung/he thong da
   * tu tra lai focus trong luc cho). Day la LUOI AN TOAN CHUNG cho MOI nguyen nhan gay mat focus co
   * the co, khong chi rieng loi in (da tu bo dialog.showErrorBox() gay loi cho o printTicketSilently()
   * - xem ghi chu MUC 106 tai do - la nguyen nhan CU THE duoc xac dinh gay ra phan anh cua nguoi dung).
   */
  kioskWindow.on('blur', () => {
    const winRef = kioskWindow;
    if (!winRef || winRef.isDestroyed()) return;
    setTimeout(() => {
      if (!winRef || winRef.isDestroyed()) return;
      if (blockingDialogOpen) return; // hop thoai hop le dang mo - khong giat focus khoi tay nhan vien
      if (winRef.isFocused()) return; // da tu lay lai focus roi (vi du nguoi dung da bam lai) - khong can lam gi them
      debugLog('[KIOSK] Phát hiện kioskWindow mất OS focus - tự động lấy lại focus (chống mất khả năng nhập liệu từ máy quét).');
      winRef.focus();
    }, 1200);
  });
  kioskWindow.on('closed', () => {
    kioskWindow = null;
    if (widgetWasVisibleBeforeKiosk && widgetWindow && !widgetWindow.isDestroyed()) {
      widgetWindow.show();
    }
  });
}

/**
 * Man hinh kiosk cap so cho NHAN VIEN (/staff-kiosk) - KHONG toan man hinh (theo yeu cau moi nhat,
 * sau khi da thu qua toan man hinh o muc 45 - giong nhu /counter o muc 46, nguoi dung muon quay lai
 * cua so binh thuong cho man hinh nay - nhan vien can thao tac nhieu: chon doi tuong, quet/chup QR
 * xac minh..., toan man hinh gay bat tien khi can thao tac linh hoat). Van gan preload.js de dung
 * duoc in lang le giong het kiosk benh nhan.
 */
function openStaffKioskWindow() {
  if (staffKioskWindow && !staffKioskWindow.isDestroyed()) {
    staffKioskWindow.show();
    staffKioskWindow.focus();
    return;
  }
  staffKioskWindow = new BrowserWindow({
    width: 900,
    height: 780,
    minWidth: 480,
    minHeight: 480,
    title: 'Nhân viên hỗ trợ cấp số',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  staffKioskWindow.setMenu(null);
  staffKioskWindow.loadURL(staffKioskUrl());
  attachReconnectOnFail(staffKioskWindow, staffKioskUrl);
  /**
   * MUC 108 - "trên widget ... quét xong nó chỉ cần hiện 1 cái cảnh báo lên là bị ... không nhập dc
   * gì được nữa": cung 1 lop an toan da lam cho kioskWindow o MUC 106, NAY BO SUNG THEM cho
   * staffKioskWindow (man hinh cap so - Nhan vien, noi nguoi dung phan anh cu the "màn hình quét ưu
   * tiên" bi loi - xem giai thich chi tiet trong public/staff-kiosk/staff-kiosk.js: `alert()` goi TU
   * RENDERER (khac voi `dialog.showErrorBox()` cua main process da sua o MUC 106) khi bi rao can
   * cap so uu tien tu choi CUNG co the khien cua so nay mat OS-level keyboard focus ma khong tu
   * phuc hoi trong Electron). Da SUA GOC RE (bo alert() trong staff-kiosk.js, doi sang canh bao
   * inline khong chan) - vach chan nay la LUOI AN TOAN BO SUNG cho MOI nguyen nhan mat focus khac co
   * the con sot (vi du cac `confirm()` khac trong file do nguoi dung chu dong bam nhung van co the
   * khong tra lai focus dung tren 1 so cau hinh Windows/driver). CHI khac kioskWindow o 1 diem: KHONG
   * kiem tra "fullscreen" gi (staffKioskWindow von di khong fullscreen) - logic con lai giong het.
   */
  staffKioskWindow.on('blur', () => {
    const winRef = staffKioskWindow;
    if (!winRef || winRef.isDestroyed()) return;
    setTimeout(() => {
      if (!winRef || winRef.isDestroyed()) return;
      if (blockingDialogOpen) return; // hop thoai hop le dang mo (vi du chon may in) - khong giat focus
      if (winRef.isFocused()) return; // da tu lay lai focus roi - khong can lam gi them
      debugLog('[STAFF-KIOSK] Phát hiện staffKioskWindow mất OS focus - tự động lấy lại focus (chống mất khả năng nhập liệu từ máy quét).');
      winRef.focus();
    }, 1200);
  });
  staffKioskWindow.on('closed', () => { staffKioskWindow = null; });
}

/**
 * Man hinh "Xem tất cả các quầy đang phục vụ" (/waiting-screen - trang CONG KHAI, CHI XEM, khong
 * thao tac gi - xem ghi chu trong src/server.js) - THEO YEU CAU moi: mo duoc NGAY tu menu khay he
 * thong cua widget (truoc day chi mo duoc bang cach tu go dia chi nay vao trinh duyet ngoai), LUON
 * toan man hinh giong /kiosk, /staff-kiosk, /counter o tren - dung khi nhan vien/quan ly muon xem
 * nhanh tinh trang tat ca cac quay (dang phuc vu so nao, quay nao dang trong) ma khong can biet
 * truoc dia chi trang nay.
 */
function openWaitingScreenWindow() {
  if (waitingScreenWindow && !waitingScreenWindow.isDestroyed()) {
    waitingScreenWindow.show();
    waitingScreenWindow.focus();
    if (!waitingScreenWindow.isFullScreen()) waitingScreenWindow.setFullScreen(true);
    return;
  }
  waitingScreenWindow = new BrowserWindow({
    show: false, // chi hien sau khi da vao toan man hinh (ready-to-show ben duoi) - tranh nhap nhay
    autoHideMenuBar: true,
    minWidth: 480,
    minHeight: 480,
    title: 'Tất cả các quầy đang phục vụ',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  waitingScreenWindow.setMenu(null);
  waitingScreenWindow.loadURL(waitingScreenUrl());
  attachReconnectOnFail(waitingScreenWindow, waitingScreenUrl);
  waitingScreenWindow.once('ready-to-show', () => {
    if (!waitingScreenWindow || waitingScreenWindow.isDestroyed()) return;
    waitingScreenWindow.setFullScreen(true);
    waitingScreenWindow.show();
  });
  waitingScreenWindow.on('closed', () => { waitingScreenWindow = null; });
}

/**
 * Cua so AN (show:false, KHONG BAO GIO hien) dung LAM NOI IN cho cac yeu cau in toi tu "cau noi
 * in cuc bo" (xem startLocalPrintServer() ben duoi) - tai lai trang cong khai
 * `/print-ticket-frame/` cua chinh may chu (public/print-ticket-frame/, gan preload nay nen co
 * `window.electronPrint`), trang do se tu doc du lieu phieu tu query string, dung lai chinh
 * printReceipt() (public/print-receipt.js) y het /kiosk va /staff-kiosk, roi tu in LANG LE ngay -
 * tai su dung TOAN BO logic in da co (do chieu cao, doi khop may in...), khong lam lai gi ca. Dung
 * chung 1 cua so, tai lai URL moi cho moi lan in (thay vi tao cua so moi lien tuc) cho gon nhe.
 */
let printFrameWindow = null;
function openPrintFrameWindow(url) {
  if (!printFrameWindow || printFrameWindow.isDestroyed()) {
    printFrameWindow = new BrowserWindow({
      show: false,
      skipTaskbar: true,
      webPreferences: {
        partition: PARTITION,
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    printFrameWindow.setMenu(null);
    printFrameWindow.on('closed', () => { printFrameWindow = null; });
  }
  printFrameWindow.loadURL(url);
}

/**
 * FIX (nguoi dung phan anh: "quét qua nhiều số nhưng sao nó k gọi in từng số đợi in xong rồi hay
 * qua số tiếp theo" - xay ra khi /staff-kiosk mo bang trinh duyet THUONG, khong qua dung cua so
 * cua widget, nen phai in HO qua "cầu nối" HTTP cuc bo o duoi): TRUOC DAY HTTP handler tra loi
 * "200 OK" cho trinh duyet NGAY SAU KHI GOI openPrintFrameWindow() - tuc la NGAY KHI VUA RA LENH
 * MO trang an, chu KHONG PHAI sau khi trang do in xong (co the mat vai giay). SUA: dung 1 Map de
 * "cho" tin bao ket qua THAT SU tu chinh trang an (`window.electronPrint.reportFrameDone()` trong
 * print-ticket-frame.js, qua kenh IPC 'print-frame-done' o duoi) truoc khi tra loi HTTP - moi lan
 * in duoc gan 1 `requestId` rieng (tranh nham lan neu co nhieu yeu cau in chong nhau tu nhieu trang
 * khac nhau cung luc), kem 1 nguong thoi gian cho toi da (an toan: neu trang an vi ly do gi khong
 * bao ve duoc - vi du loi tai trang - request HTTP se KHONG bi treo mai mai).
 */
const pendingFramePrints = new Map(); // requestId -> { resolve, timer }
const FRAME_PRINT_TIMEOUT_MS = 20000; // 20 giay - du du cho ca truong hop may in cham/dang xu ly lenh truoc

function waitForFramePrintDone(requestId) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingFramePrints.delete(requestId);
      debugLog(`[CẦU NỐI IN] Hết thời gian chờ (${FRAME_PRINT_TIMEOUT_MS}ms) tín hiệu in xong từ cửa sổ ẩn (requestId=${requestId}) - coi như thất bại, trả lời HTTP để không treo request.`);
      resolve({ success: false, message: 'Hết thời gian chờ máy in phản hồi.' });
    }, FRAME_PRINT_TIMEOUT_MS);
    pendingFramePrints.set(requestId, { resolve, timer });
  });
}

ipcMain.on('print-frame-done', (event, { requestId, result } = {}) => {
  const pending = pendingFramePrints.get(requestId);
  if (!pending) return; // da het han/khong ro requestId - bo qua (khong con ai cho tin nay nua)
  clearTimeout(pending.timer);
  pendingFramePrints.delete(requestId);
  pending.resolve(result || { success: true });
});

/**
 * "CAU NOI IN" CUC BO: 1 may chu HTTP nho (module `http` co san, khong can them thu vien nao) CHI
 * LANG NGHE tren 127.0.0.1 (khong lo ra mang LAN - may khac trong mang KHONG goi toi duoc) de nhan
 * yeu cau in tu CAC TRANG WEB THUONG dang chay tren CHINH MAY NAY (vi du nhan vien mo /staff-kiosk
 * bang Chrome/Edge binh thuong thay vi qua menu tray cua widget) - xem tryLocalPrintBridge() trong
 * public/print-receipt.js (ben phia trinh duyet). Nho vay, KHONG BAT BUOC phai mo /kiosk hay
 * /staff-kiosk qua dung ung dung widget nay nua thi moi in lang le duoc, mien la widget co cai va
 * dang chay tren CUNG 1 may voi may in.
 *
 * De tranh 1 trang web la (hoac mot tab khac dang mo ngoai y muon tren cung may) am tham goi in
 * lung tung, CHI CHAP NHAN yeu cau co header Origin KHOP CHINH XAC voi dia chi may chu dang cau
 * hinh (config.serverUrl) - khong khop se bi tu choi (403), khong in gi ca.
 */
function startLocalPrintServer() {
  const server = http.createServer((req, res) => {
    let allowedOrigin = '';
    try { allowedOrigin = new URL(config.serverUrl).origin; } catch { /* config.serverUrl khong hop le - bo qua */ }
    const origin = req.headers.origin || '';
    const originOk = !!origin && origin === allowedOrigin;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': originOk ? origin : 'null',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    const urlPath = (req.url || '').split('?')[0];
    if (req.method !== 'POST' || urlPath !== '/print-ticket') {
      res.writeHead(404);
      res.end();
      return;
    }

    if (!originOk) {
      debugLog(`[CẦU NỐI IN] Từ chối yêu cầu in - nguồn không khớp máy chủ đã cấu hình: "${origin}" (đang cấu hình: "${allowedOrigin}").`);
      res.writeHead(403, { 'Access-Control-Allow-Origin': 'null' });
      res.end('Forbidden');
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) req.destroy(); // an toan: chan payload bat thuong lon
    });
    req.on('end', async () => {
      let payload = {};
      try {
        payload = JSON.parse(body || '{}');
      } catch (err) {
        debugLog(`[CẦU NỐI IN] Dữ liệu yêu cầu in không hợp lệ (không parse được JSON): ${err.message}`);
      }
      debugLog(`[CẦU NỐI IN] Nhận yêu cầu in từ trang web (số "${payload.number}") - mở cửa số in ẩn...`);
      try {
        // requestId RIENG cho MOI lan in - dung de khop dung tin bao "in xong" gui nguoc lai qua
        // IPC (xem ipcMain.on('print-frame-done') o tren) voi DUNG request HTTP dang cho, tranh
        // nham lan neu (hiem gap) co 2 yeu cau in chong nhau gan nhu cung luc.
        const requestId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
        const qs = new URLSearchParams();
        ['clinicName', 'number', 'priorityLabel', 'time', 'footerText', 'footerText2', 'logoImage', 'idQrRaw', 'patientName', 'patientDob'].forEach((key) => {
          if (payload[key] != null) qs.set(key, String(payload[key]));
        });
        qs.set('__printReqId', requestId);
        const donePromise = waitForFramePrintDone(requestId);
        openPrintFrameWindow(`${config.serverUrl}/print-ticket-frame/?${qs.toString()}`);
        // FIX (nguoi dung phan anh: "không đợi in xong đã sang số tiếp theo"): CHO (await) THAT SU
        // ket qua in tu cua so an (xem waitForFramePrintDone() o tren) TRUOC KHI tra loi HTTP -
        // truoc day tra loi "200 OK" ngay tai day, khong cho gi ca.
        const result = await donePromise;
        res.writeHead(200, { 'Access-Control-Allow-Origin': origin, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, result }));
      } catch (err) {
        debugLog(`[CẦU NỐI IN] Lỗi xử lý yêu cầu in: ${err.message}`);
        res.writeHead(500, { 'Access-Control-Allow-Origin': origin });
        res.end('Error');
      }
    });
  });

  server.on('error', (err) => {
    // Loi thuong gap nhat: cong da bi chuong trinh khac dung - ghi log de biet, KHONG lam sap ung
    // dung (tinh nang in tu /kiosk, /staff-kiosk mo qua tray van hoat dong binh thuong, chi rieng
    // "cau noi" cho trinh duyet thuong la khong dung duoc).
    debugLog(`[CẦU NỐI IN] Không khởi động được (cổng ${config.localPrintServerPort} có thể đã bị chương trình khác dùng): ${err.message}`);
  });

  server.listen(config.localPrintServerPort, '127.0.0.1', () => {
    debugLog(`[CẦU NỐI IN] Sẵn sàng nhận yêu cầu in từ trang web tại http://127.0.0.1:${config.localPrintServerPort}/print-ticket`);
  });
}

function createServerUrlPrompt() {
  if (promptWindow && !promptWindow.isDestroyed()) { promptWindow.focus(); return; }
  const PROMPT_WIDTH = 440;
  const PROMPT_HEIGHT = 220;
  // Tu tinh vi tri CHINH GIUA man hinh dang chua widget (hoac man hinh chinh neu chua xac dinh
  // duoc) - theo yeu cau: "Đổi địa chỉ máy chủ khi widget nó đang chiều dọc nó bị kẹt ở màn hình
  // bên phải". Nguyen nhan: KHONG truyen san x/y, Electron mac dinh tu "can giua" cua so con dua
  // theo vi tri/kich thuoc cua `parent` (widgetWindow) - o che do doc (mục 49), widget rat hep
  // (54px) va mac dinh nam SAT CANH PHAI man hinh (xem defaultWidgetBounds() o tren), nen cua so
  // con 440px duoc "can giua" theo 1 parent hep + sat le nhu vay se bi tinh lech han sang phai,
  // trong ra nhu bi "kẹt" o canh phai man hinh thay vi nam GIUA man hinh that su. Sua bang cach tu
  // tinh toa do x/y CAN GIUA theo workArea cua dung man hinh (display) dang chua widget, khong phu
  // thuoc vi tri/kich thuoc hep cua parent nua.
  const display = widgetWindow && !widgetWindow.isDestroyed()
    ? screen.getDisplayMatching(widgetWindow.getBounds())
    : screen.getPrimaryDisplay();
  const { workArea } = display;
  const x = Math.round(workArea.x + (workArea.width - PROMPT_WIDTH) / 2);
  const y = Math.round(workArea.y + (workArea.height - PROMPT_HEIGHT) / 2);
  promptWindow = new BrowserWindow({
    x,
    y,
    width: PROMPT_WIDTH,
    height: PROMPT_HEIGHT,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'Đổi địa chỉ máy chủ',
    parent: widgetWindow || undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  promptWindow.setMenu(null);
  promptWindow.loadFile(path.join(__dirname, 'server-url-prompt.html'));
  promptWindow.on('closed', () => { promptWindow = null; });
}

function reloadAllWindows() {
  if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.loadURL(widgetUrl());
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.loadURL(settingsUrl());
  if (patientScreenWindow && !patientScreenWindow.isDestroyed() && patientScreenCounterId) {
    patientScreenWindow.loadURL(patientScreenUrl(patientScreenCounterId));
  }
  if (kioskWindow && !kioskWindow.isDestroyed()) kioskWindow.loadURL(kioskUrl());
  if (staffKioskWindow && !staffKioskWindow.isDestroyed()) staffKioskWindow.loadURL(staffKioskUrl());
  if (waitingScreenWindow && !waitingScreenWindow.isDestroyed()) waitingScreenWindow.loadURL(waitingScreenUrl());
}

/**
 * File log RIENG cho LOI IN (khac han file log chan doan cu da bo hoan toan - xem debugLog() o dau
 * file) - CHI GHI khi thuc su co dau hieu bat thuong (may in bao loi qua trang thai, hoac lenh in
 * nem loi ngoai le), KHONG ghi lien tuc moi lan in nhu file cu, nen khong di nguoc lai yeu cau tat
 * bot ghi log cho widget nhe may hon. Muc dich: khi nhan vien bao "in khong ra phieu" (vi du hop
 * thoai "Print Notification" cua chinh Windows bao loi - xem giai thich o logPrintIssue() ben
 * duoi), co the mo file nay (qua muc tray "Mở file log lỗi in", chi hien khi file da ton tai) de
 * biet CHINH XAC lan in do: may in nao, trang thai luc do the nao, kho giay tinh ra sao - thay vi
 * chi doan mo dua tren 1 tam anh chup hop thoai loi chung chung cua Windows (khong co chi tiet ky
 * thuat gi ca).
 */
function printIssueLogPath() {
  return path.join(app.getPath('userData'), 'loi-in.log');
}

function logPrintIssue(message) {
  try {
    const alreadyExisted = fs.existsSync(printIssueLogPath());
    const line = `[${new Date().toISOString()}] ${message}\n`;
    fs.appendFileSync(printIssueLogPath(), line, 'utf8');
    // Lan dau tien file nay duoc tao (truoc do chua tung co loi nao) - lam moi lai menu tray NGAY
    // de muc "Mở file log lỗi in" (xem buildTrayMenu()) xuat hien ngay lap tuc, khong bat nhan vien
    // phai khoi dong lai ung dung moi thay duoc.
    if (!alreadyExisted && tray) tray.setContextMenu(buildTrayMenu());
  } catch (err) {
    console.error('[PRINT] Không ghi được file log lỗi in:', err.message);
  }
}

/**
 * Giai ma bitmask `status` (kieu so nguyen) Electron tra ve trong `PrinterInfo.status` (xem
 * `win.webContents.getPrintersAsync()` trong printTicketSilently() ben duoi) - tren Windows, gia
 * tri nay lay THANG tu API `GetPrinter()` (`PRINTER_INFO_2.Status`) cua chinh he dieu hanh, la
 * NGUON DU LIEU DUY NHAT ma ung dung nay CO THE doc duoc VE TINH TRANG THUC TE cua may in TRUOC KHI
 * gui lenh in - vi (xem ghi chu o printTicketSilently()) SAU KHI gui xong lenh in qua SumatraPDF,
 * ung dung KHONG CON CACH NAO biet duoc may in THUC SU co in ra giay hay khong nua (Windows Print
 * Spooler xu ly & bao loi/thanh cong hoan toan RIENG, NGOAI TAM voi cua tien trinh SumatraPDF da
 * thoat - day chinh la ly do hop thoai "Print Notification" cua Windows (chup man hinh nguoi dung
 * gui) xuat hien RIENG, KHONG DI KEM bat ky loi/canh bao nao tu chinh ung dung nay ca, du log da
 * ghi "in qua SumatraPDF thanh cong").
 *
 * Chi liet ke cac bit CO Y NGHIA THUC TE voi 1 may in nhiet/POS (bo qua cac bit chi co nghia voi
 * may in laser nhu TONER_LOW/WARMING_UP...). Gia tri bit tra ve dung theo tai lieu WinSpool chinh
 * thuc cua Microsoft (hang so PRINTER_STATUS_*).
 */
function decodePrinterStatusIssues(status) {
  if (!status) return [];
  const BITS = [
    [0x00000001, 'đang tạm dừng (paused)'],
    [0x00000002, 'đang báo lỗi (error)'],
    [0x00000008, 'kẹt giấy (paper jam)'],
    [0x00000010, 'hết giấy (paper out)'],
    [0x00000040, 'có vấn đề với giấy (paper problem)'],
    [0x00000080, 'ngoại tuyến / mất kết nối (offline)'],
    [0x00001000, 'không sẵn sàng (not available)'],
    [0x00100000, 'cần can thiệp thủ công (user intervention required)'],
    [0x00200000, 'hết bộ nhớ (out of memory)'],
    [0x00400000, 'đang mở nắp (door open)'],
  ];
  return BITS.filter(([bit]) => (status & bit) !== 0).map(([, label]) => label);
}

/**
 * IN LANG LE (khong hop thoai/xem truoc nao ca) phieu vua duoc public/print-receipt.js dung sẵn
 * trong DOM (div #printReceipt, an hien bang CSS @media print trong common.css) cua CHINH cua so
 * vua goi in (kiosk benh nhan hoac kiosk nhan vien - xac dinh qua `event.sender`, khong gia dinh
 * cua so nao).
 *
 * LICH SU DOI CACH IN (quan trong, giai thich vi sao code duoi day KHONG con dung
 * `win.webContents.print({silent:true, pageSize:...})` truc tiep nhu truoc): da thu qua thuc te
 * tren may that (Epson TM-T82III) - MAC DU log xac nhan Electron TINH DUNG kho giay nho (58 x
 * ~68mm, khop dung noi dung phieu) va webContents.print() bao `success:true`, ban IN THUC TE VAN
 * DAI Y HET NHU TRUOC (rat nhieu giay trang), KHONG DOI GI CA giua nhieu lan thu voi cac gia tri
 * kho giay khac nhau. Ket luan: DRIVER may in (qua co che DEVMODE/PageSize chuan cua Windows GDI
 * ma Chromium dang dung) dang BO QUA hoan toan kho giay tuy chinh ma Chromium gui xuong, tu dung
 * kho giay MAC DINH rieng cua no (dai hon nhieu) - day la gioi han cua chinh driver/Windows GDI,
 * KHONG phai loi tinh toan cua ung dung.
 *
 * CACH MOI: xuat phieu ra 1 FILE PDF (qua `webContents.printToPDF()`, kho giay dung trong FILE PDF
 * do, khong can driver "hop tac") roi dung thu vien `pdf-to-printer` (chay SumatraPDF di kem) de
 * gui THANG file PDF do toi may in - SumatraPDF tu dat kich thuoc trang IN THEO DUNG KICH THUOC
 * TRANG PDF (khong can driver co san 1 "kho giay" khop san), day la cach lam pho bien va da duoc
 * kiem chung rong rai cho dung truong hop "Electron in lang le ra may in nhiet/POS tren Windows bi
 * driver phot lo kho giay tuy chinh" - khac han co che cua webContents.print() truoc day.
 *
 * `deviceName` bo trong ('' hoac chua cau hinh) => dung MAY IN MAC DINH cua he dieu hanh.
 */
/**
 * FIX (theo phan anh cua nguoi dung: "khi hết giấy in nó sẽ không in lại được số đang bị lỗi") -
 * TRUOC DAY ham nay khong bao gio bao THAT BAI ve phia renderer: du lenh in that su LOI (het giay,
 * kẹt giấy, mất kết nối máy in...), ham chỉ hiện 1 hộp thoại lỗi rồi vẫn coi như XONG (return binh
 * thuong, khong nem loi) - khien vong lap in hang loat (issueBatch() trong staff-kiosk.js) TUONG
 * la phieu do da in xong, tiep tuc chay sang phieu tiep theo (cung se loi vi may in van dang het
 * giay), VA khong co cach nao de biet CHINH XAC nhung so nao da thuc su in duoc, so nao chua - nhan
 * vien phai tu doan/dem lai bang mat.
 *
 * SUA: ham nay nay tra ve 1 object { success, message } thay vi khong tra ve gi - true/false ro
 * rang cho tung lenh in. Xem issueBatch() o staff-kiosk.js: khi gap 1 phieu in THAT BAI, vong lap
 * DUNG LAI NGAY (khong in tiep cac phieu con lai - vi kha nang cao may in van dang loi, in tiep chi
 * ton giay/thoi gian vo ich), va hien ro cho nhan vien biet CHINH XAC da in duoc bao nhieu phieu,
 * so nao la so DAU TIEN CHUA IN DUOC - kem 1 nut "In tiếp các số còn lại" de thu in lai PHAN CON
 * LAI (khong phai in lai tu dau, tranh in trung cac so da in thanh cong) ngay sau khi da khac phuc
 * xong may in (tiep giay, het ket...).
 */
/**
 * MUC 95 - HANG DOI IN TOAN CUC (theo phan anh cua nguoi dung: "widget máy quét zebra quét 1 hồi ở
 * màn hình kiosk ứng dụng bị treo dùng màn hình cảm ứng nhập phím ảo cũng k ăn input").
 *
 * NGUYEN NHAN: `ipcMain.handle('print-ticket', ...)` (dang ky o duoi cung file nay) truoc day goi
 * THANG `printTicketSilently()` cho MOI request `invoke()` toi - Electron KHONG tu serialize cac
 * lenh `invoke()` don le nay, nen neu 2 (hoac nhieu) yeu cau in toi GAN NHU CUNG LUC (vi du: may
 * quet Zebra quet lien tuc nhieu ma QR "cấp nhanh" - xem processQuickQrScan() trong public/kiosk/
 * kiosk.js, muc 94 - MOI lan quet tao+in ve NGAY LAP TUC, KHONG co bat ky do tre/khoa nao giua 2
 * lan quet lien tiep), nhieu lenh `printTicketSilently()` se chay CHONG CHEO/SONG SONG voi nhau,
 * ke ca goi ĐÈ LEN NHAU `win.webContents.printToPDF()` tren CUNG 1 webContents khi lenh truoc VAN
 * con dang xuat PDF do dang do - day la kieu goi API MA Chromium/Electron KHONG dam bao an toan
 * (khong thiet ke de goi chong cheo tren cung 1 webContents), co the khien tien trinh renderer/
 * toan bo ung dung bi "ket" (treo) - dung khop trieu chung nguoi dung mo ta (treo sau 1 hoi quet
 * lien tuc, ke ca ban phim ao cham cung khong con phan hoi vi renderer dang bi khoa cung).
 *
 * SUA: moi lenh in (bat ke tu cua so nao - kiosk, staff-kiosk, hay cua so an cua "cầu nối in" HTTP
 * cuc bo o muc 88) deu di qua 1 HANG DOI DUY NHAT (`printQueueTail`, 1 chuoi Promise noi tiep) -
 * lenh in SAU chi THAT SU bat dau chay (goi printTicketSilently() that su) SAU KHI lenh in TRUOC no
 * đã hoàn tất HẲN (thành công hay thất bại), khong bao gio co 2 lenh printToPDF() chay chong cheo
 * tren cung 1 lien tuc trinh duyet nua - loai bo tan goc nguyen nhan treo ung dung nay.
 */
let printQueueTail = Promise.resolve();

function queuePrintJob(event, contentHeightPx) {
  const job = printQueueTail.then(() => printTicketSilently(event, contentHeightPx));
  // Du lenh in nay co that bai (reject) hay khong, VAN phai de hang doi tiep tuc chay cho lenh SAU
  // no - printTicketSilently() thuc te LUON tu bat loi va tra ve { success:false, message } (khong
  // bao gio thuc su `throw`/reject), nhung vAN boc them `.catch()` o day nhu 1 luoi an toan bo sung
  // (phong truong hop hiem co loi JS khac ngoai du kien nem ra) - tranh 1 loi don le lam "ket" luon
  // ca hang doi, khien MOI lenh in sau do khong bao gio chay duoc nua.
  printQueueTail = job.catch(() => {});
  return job;
}

async function printTicketSilently(event, contentHeightPx) {
  debugLog('IPC "print-ticket" đã tới main process (bridge preload.js hoạt động đúng).');

  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) {
    debugLog('LỖI: không tìm được cửa sổ nguồn (BrowserWindow.fromWebContents trả về rỗng) - dừng lại, không in.');
    return { success: false, message: 'Không tìm thấy cửa sổ nguồn để in.' };
  }
  debugLog(`Cửa sổ nguồn: "${win.getTitle()}"`);

  // Xac nhan lai deviceName da luu (neu co) van con ton tai trong danh sach may in HIEN TAI cua
  // may - neu may in bi tat nguon/rut day/doi ten sau khi da chon qua tray, deviceName cu se KHONG
  // KHOP may in nao ca; mot so ban Windows/Electron khi gap deviceName khong khop se KHONG bao loi
  // ma lai TU MO hop thoai in binh thuong de nguoi dung tu chon (day la nguyen nhan pho bien nhat
  // khien "silent:true" nhu khong co tac dung) - vi vay o day chu dong kiem tra truoc, neu khong
  // khop thi coi nhu chua chon rieng (dung may in mac dinh he dieu hanh, deviceName = '') thay vi
  // gui thang mot cai ten khong ton tai cho Electron.
  let deviceName = config.printerDeviceName || '';
  debugLog(`Máy in đã lưu trong cấu hình (config.printerDeviceName): ${JSON.stringify(config.printerDeviceName)}`);
  try {
    const printers = await win.webContents.getPrintersAsync();
    debugLog(`Electron nhận biết được ${printers.length} máy in: ${printers.map((p) => `"${p.name}"${p.isDefault ? ' (mặc định hệ thống)' : ''}`).join(', ') || '(không có)'}`);
    let targetPrinter = null;
    if (deviceName) {
      const match = printers.find((p) => p.name === deviceName || p.displayName === deviceName);
      if (!match) {
        debugLog(`Máy in đã chọn ("${deviceName}") KHÔNG khớp máy in nào trong danh sách trên - tạm dùng máy in mặc định hệ thống thay thế.`);
        deviceName = '';
      } else {
        // Dung dung `name` (ten he thong noi bo) - KHONG dung `displayName` (ten hien thi, co the
        // khac ten he thong tren mot so may Windows) vi Electron doi khop chinh xac `deviceName`
        // voi `name`, khop sai se khien no khong in duoc va co the roi ve hien hop thoai.
        deviceName = match.name;
        targetPrinter = match;
      }
    }
    // Neu chua chon rieng may in nao (dung mac dinh he dieu hanh), lay luon may in mac dinh trong
    // danh sach de kiem tra trang thai - GIONG HET may in se duoc SumatraPDF thuc su dung khi
    // `deviceName` bo trong (xem ghi chu o dau ham).
    if (!targetPrinter) targetPrinter = printers.find((p) => p.isDefault) || null;

    // CANH BAO SOM (truoc khi gui lenh in) neu may in dang bao trang thai bat thuong qua chinh
    // Windows (het giay, mo nap, ngoai tuyen...) - xem giai thich chi tiet trong
    // decodePrinterStatusIssues() o tren VE LY DO day la co hoi DUY NHAT de ung dung biet truoc,
    // vi sau khi gui lenh in xong se KHONG con cach nao biet duoc nua. VAN gui lenh in binh thuong
    // ngay sau do (khong chan lai) - trang thai nay co the da cu/khong con dung luc thuc su in (vi
    // du nhan vien vua nap giay xong nhung Windows chua kip cap nhat) - chi la 1 canh bao THAM KHAO
    // ro rang hon nhieu so voi hop thoai "Print Notification" chung chung cua Windows.
    if (targetPrinter && typeof targetPrinter.status === 'number') {
      const issues = decodePrinterStatusIssues(targetPrinter.status);
      if (issues.length) {
        // KHONG con hien hop thoai canh bao nua (theo yeu cau - xem phan anh cua nguoi dung: may in
        // Epson TM-T82III bao "status: 2" (bit ERROR) NGAY CA KHI DANG IN BINH THUONG - Windows tra
        // ve gia tri nay khong dang tin cay/qua nhay (nhieu driver may in nhiet coi 1 trang thai noi
        // bo binh thuong nao do la "error" chung chung), gay ra canh bao SAI lien tuc lam gian doan
        // luong cap so cua nhan vien du may in van hoat dong tot. CHI GHI LOG (van huu ich de doi
        // chieu neu THUC SU khong in duoc), KHONG hien hop thoai chan nguoi dung nua - cu gui lenh
        // in xuong may in binh thuong, khong canh bao gi ca.
        const msg = `Máy in "${targetPrinter.displayName || targetPrinter.name}" đang báo: ${issues.join(', ')} (mã trạng thái: ${targetPrinter.status}).`;
        debugLog(`(chỉ ghi log, không hiện cảnh báo) Trạng thái máy in: ${msg}`);
        logPrintIssue(`Trạng thái máy in trước khi in: ${msg} — vẫn gửi lệnh in bình thường, không hiện cảnh báo (theo yêu cầu).`);
      }
    }
  } catch (err) {
    debugLog(`LỖI khi lấy danh sách máy in (getPrintersAsync): ${err.message}`);
  }

  // FIX (xac dinh qua file in-phieu-debug.log thuc te): loi that su la Chromium bao "Invalid
  // printer settings ... content size is empty; page size is empty; printable area is empty" -
  // TUC LA khong lien quan gi den deviceName/driver "xac nhan truoc khi in" nhu doan truoc, ma vi
  // webContents.print() KHONG TU DOC duoc kich thuoc kho giay tu may in cuon giay lien tuc (roll
  // paper) nhu may in nhiet - no can duoc truyen THANG kich thuoc kho giay qua tham so `pageSize`
  // (thay vi de trong/de Electron tu doan), khop voi khai bao `@page { size: 80mm auto; margin:
  // 3mm; }` da co san trong public/common.css. Day chinh la nguyen nhan khien Chromium roi ve
  // hien hop thoai in day du cho nguoi dung tu xu ly, thay vi bao loi im lang nhu binh thuong.
  // `pageSize` (dang Object) yeu cau don vi MICRON (1mm = 1000 micron); chieu cao dat mot muc du
  // dai cho 1 phieu so thu tu (co the co dong "uu tien") - may in cuon giay lien tuc se tu cat
  // theo NOI DUNG THUC TE in ra (khong in het phan giay trong con lai).
  const PAGE_WIDTH_MICRONS = 80000; // 80mm - khop @page trong common.css (kho that cua may in TM-T82III, khong phai 58mm)

  // CHIEU CAO KHO GIAY: truoc day dat CO DINH 200mm (du dai cho moi phieu) - nhung may in cuon
  // giay lien tuc thuc te se IN HET dung 200mm giay that (khong tu cat ngan lai theo noi dung nhu
  // ky vong), khien phieu bi thua rat nhieu giay trang phia duoi ("in ra dai qua, noi dung chi co
  // 1/2 to giay"). SUA: dung dung CHIEU CAO THUC TE cua noi dung (do o phia trinh duyet, gui kem
  // qua IPC - xem print-receipt.js/preload.js), cong them 1 khoang du nho de bu sai so do luong/
  // lam tron + phan margin CSS (@page margin:3mm o common.css) - gan voi do dai that cua phieu,
  // may in se cat giay dung ngay sau khi in xong thay vi keo them giay trang.
  // QUAN TRONG: san toi thieu nay PHAI LON HON PAGE_WIDTH_MICRONS (80mm) o tren. Neu chieu cao
  // nho hon chieu rong, trang giay tro thanh 1 hinh chu nhat NAM NGANG (rong hon cao) - nhieu
  // driver may in nhiet coi day la dau hieu trang "landscape" va TU DONG XOAY NGANG noi dung khi
  // in (du da truyen orientation:'portrait' cho SumatraPDF ben duoi, no chi ep huong khi GUI cho
  // may in, khong sua duoc kich thuoc trang da SAI trong chinh file PDF). Loi nay xuat hien SAU KHI
  // bo mã QR khoi phieu (phieu ngan lai, co luc chi con ~45-58mm - thap hon 80mm) - truoc do phieu
  // luon du dai (co QR + ten + ngay sinh) nen chua bao gio cham gioi han nay. Dat toi thieu 90mm
  // (> 80mm mot chut) de dam bao trang LUON cao hon rong, tranh bi coi la landscape trong moi
  // truong hop, ke ca phieu ngan nhat (khong uu tien, khong ho ten).
  const MIN_HEIGHT_MICRONS = 90000; // 90mm - luon > PAGE_WIDTH_MICRONS (80mm) de tranh bi hieu la trang landscape
  const MAX_HEIGHT_MICRONS = 400000; // 400mm - gioi han tren, tranh keo giay bat thuong neu gia tri do bi loi/qua lon
  const EXTRA_MICRONS = 10000; // du them 10mm bu sai so + margin, tranh cat mat dong cuoi cua phieu
  const FALLBACK_HEIGHT_MICRONS = 200000; // dung khi KHONG nhan duoc chieu cao (contentHeightPx trong/khong hop le)

  let pageHeightMicrons = FALLBACK_HEIGHT_MICRONS;
  const heightPxNum = Number(contentHeightPx);
  if (heightPxNum > 0) {
    // 1 px CSS chuan = 1/96 inch = 25.4/96 mm.
    pageHeightMicrons = Math.round((heightPxNum / 96) * 25.4 * 1000) + EXTRA_MICRONS;
    pageHeightMicrons = Math.min(Math.max(pageHeightMicrons, MIN_HEIGHT_MICRONS), MAX_HEIGHT_MICRONS);
  } else {
    debugLog(`Không nhận được chiều cao nội dung hợp lệ (contentHeightPx=${JSON.stringify(contentHeightPx)}) - tạm dùng khổ giấy dự phòng ${FALLBACK_HEIGHT_MICRONS / 1000}mm.`);
  }

  if (pdfToPrinter) {
    // CACH MOI (xem ghi chu dau ham): xuat PDF kho dung, roi dung SumatraPDF (qua pdf-to-printer)
    // de gui thang toi may in - khong con phu thuoc vao viec driver co "hop tac" voi kho giay tuy
    // chinh qua webContents.print() hay khong nua.
    debugLog(`Chuẩn bị xuất PDF (${PAGE_WIDTH_MICRONS}x${pageHeightMicrons} micron, từ contentHeightPx=${contentHeightPx}) rồi gửi tới máy in "${deviceName || '(mặc định hệ thống)'}" qua SumatraPDF...`);
    let pdfPath = null;
    try {
      // FIX (xac dinh qua kiem tra THUC TE kich thuoc trang cua file PDF xuat ra - nguoi dung gui
      // lai file, do duoc trang PDF rong ~1.473.200 MM, tuc la CON SO MICRON goc (58000) bi dung
      // NHU THE LA INCH roi nhan thang voi 72 de ra "points" (58000 x 72 = 4.176.000 points, dung
      // khop tuyet doi voi kich thuoc do duoc) - webContents.printToPDF() trong ban Electron nay
      // dang XU LY DON VI KHAC HOAN TOAN so voi webContents.print() (ham do MOI dung dung don vi
      // MICRON nhu tai lieu, con printToPDF() lai can INCH cho tham so `pageSize` dang Object).
      // Day la nguyen nhan khien phieu in ra TRANG HOAN TOAN: noi dung phieu (chi ~58x68mm) bi dat
      // vao 1 goc cua 1 trang khong lo hang ngan lan lon hon, nam ngoai vung co the nhin thay/in
      // duoc. SUA: DOI SANG INCH (chia cho 25400 - so micron trong 1 inch) truoc khi truyen cho
      // printToPDF(), CHI o day - webContents.print() o nhanh du phong ben duoi VAN GIU NGUYEN don
      // vi micron (da xac nhan hoat dong dung qua nhieu lan test truoc).
      const MICRONS_PER_INCH = 25400;
      const pdfBuffer = await win.webContents.printToPDF({
        printBackground: false,
        pageSize: {
          width: PAGE_WIDTH_MICRONS / MICRONS_PER_INCH,
          height: pageHeightMicrons / MICRONS_PER_INCH,
        },
        margins: { marginType: 'none' }, // le giay da co san trong CSS (@page margin:3mm), tranh cong don thanh 2 lop le
      });
      // Them 1 chuoi ngau nhien ngan vao ten file (ngoai Date.now()) de PHONG XA them truong hop 2
      // lenh in cung roi dung 1 mili-giay (vi du: /kiosk va /staff-kiosk cung in gan nhu dong thoi
      // tren 2 cua so khac nhau) tinh co trung ten file tam - du sau khi sua loi chinh (fire-and-
      // forget IPC) thi cac phieu trong CUNG 1 lo da duoc noi tiep hoa (khong con chay song song),
      // truong hop 2 cua so KHAC NHAU in dong thoi van co the xay ra. Nho cap nhat regex trong
      // cleanupOldTempPdfs() ben duoi cho khop dinh dang ten file moi nay.
      pdfPath = path.join(os.tmpdir(), `phieu-so-thu-tu-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.pdf`);
      fs.writeFileSync(pdfPath, pdfBuffer);
      debugLog(`Đã xuất PDF tạm: ${pdfPath} (${pdfBuffer.length} bytes) - đang gửi lệnh in...`);

      await pdfToPrinter.print(pdfPath, {
        printer: deviceName || undefined,
        silent: true,
        scale: 'noscale', // KHONG cho SumatraPDF tu co-gian noi dung theo kho giay mac dinh cua driver - giu dung kich thuoc trang PDF
        orientation: 'portrait', // chi dinh RO RANG (khong de driver tu quyet) - phong khi driver dang luu san huong ngang tu lan cau hinh truoc, khien noi dung dai/hep bi dat/cat sai vi tri
      });
      debugLog('In qua SumatraPDF (pdf-to-printer) thành công.');
      // FIX (phan anh cua nguoi dung SAU KHI da doi sang ipcRenderer.invoke()/ipcMain.handle():
      // "máy in vẫn nhận 1 lệnh in chưa fix được" - tuc la JS da CHO DUNG (tuan tu, khong con goi
      // chong cheo nua - da kiem chung co che invoke/handle bang test IPC rieng), nhung Windows
      // Print Spooler/driver may in nhiet VAN co the GOP nhieu lenh in gui LIEN TIEP QUA NHANH
      // (SumatraPDF.exe thoat xong la coi nhu "xong" ngay o buoc tren, nhung thoat tien trinh KHONG
      // dong nghia spooler da THUC SU tach xong thanh 1 "cong viec in" (print job) rieng biet truoc
      // khi nhan du lieu cua lenh in TIEP THEO - mot so driver may in nhiet/lien tuc, neu nhan 2
      // lenh qua sat nhau, co the noi lien du lieu lai thanh 1 luong/1 "job" duy nhat thay vi 2).
      // SUA (thuc te, khong the kiem chung tren phan cung that trong moi truong nay - xem phan
      // "Han che" trong README): CHO THEM 1 khoang nghi ngan (PRINT_JOB_GAP_MS) SAU KHI tung lenh in
      // gui xong THANH CONG, truoc khi ham nay tra ve (tuc la truoc khi vong lap issueBatch() o
      // staff-kiosk.js duoc phep chuyen sang phieu tiep theo) - cho spooler/driver du thoi gian
      // "chot" xong lenh in hien tai thanh 1 cong viec rieng biet, tranh bi may in/driver hieu nham
      // la 1 luong du lieu lien tuc roi gop lai. Neu van chua du (tuy driver may in cu the), co the
      // tang gia tri PRINT_JOB_GAP_MS ben duoi.
      // TANG tu 700ms len 2000ms (2 giay) THEO YEU CAU CU THE cua nguoi dung ("mổi phiếu 2s chờ in
      // gửi lệnh in từng phiếu cho an toàn") - cho spooler/driver may in nhiet du thoi gian "chot"
      // xong lenh in hien tai thanh 1 cong viec rieng biet truoc khi nhan lenh in tiep theo.
      const PRINT_JOB_GAP_MS = 2000;
      await new Promise((resolve) => setTimeout(resolve, PRINT_JOB_GAP_MS));
      return { success: true };
    } catch (err) {
      debugLog(`LỖI khi in qua SumatraPDF (pdf-to-printer): ${err.message}`);
      logPrintIssue(
        `LỖI khi gửi lệnh in qua SumatraPDF: ${err.message} — máy in: "${deviceName || '(mặc định hệ thống)'}", ` +
        `khổ giấy: ${PAGE_WIDTH_MICRONS / 1000}x${pageHeightMicrons / 1000}mm.`
      );
      // MUC 106 - "kiểm tra chức năng máy quét ... mất form nhập liệu": DA BO dialog.showErrorBox()
      // o day (truoc day goi ngay tai day). LY DO: day la duong in TU DONG/LANG LE, co the chay TREN
      // MAN HINH KIOSK BENH NHAN KHONG CO AI TRUC (kioskWindow luon fullscreen) - dialog.showErrorBox()
      // la HOP THOAI CAP HE DIEU HANH, KHONG gan `parent`, se CUOP OS-LEVEL KEYBOARD FOCUS khoi
      // kioskWindow va TREO VO THOI HAN (khong ai bam OK) vi khong co ai truc man hinh do de dong.
      // Trong luc hop thoai con mo, may quet ma (hoat dong y het ban phim vat ly) gui ky tu toi CUA
      // SO DANG CO OS FOCUS (hop thoai loi) chu KHONG PHAI toi #scanInput cua kioskWindow nua - dung
      // NGUYEN NHAN goc re gay ra phan anh "quét một lúc thì không nhập liệu được nữa" cua nguoi
      // dung (chi xay ra SAU 1 lan in loi dau tien, tu do "kẹt cứng" cho toi khi co nguoi vao tan
      // may bam OK - kioskWindow cung KHONG tu lay lai focus sau khi dong hop thoai vi khong co code
      // nao goi lai kioskWindow.focus()). Loi in van duoc GHI LAI DAY DU qua logPrintIssue() o tren
      // (nhan vien/IT xem lai sau qua file log), VA bao ve renderer qua kenh IPC 'print-error' ben
      // duoi de trang kiosk/staff-kiosk tu hien 1 dong canh bao NHO, KHONG CHAN gi (xem
      // showPrintErrorToast() trong public/kiosk/kiosk.js va public/staff-kiosk/staff-kiosk.js) -
      // benh nhan/nhan vien van thay duoc co loi in, nhung KHONG con nguy co mat OS focus nua.
      try { win.webContents.send('print-error', err.message); } catch { /* cua so co the da dong - bo qua */ }
      // FIX (xem ghi chu dau ham printTicketSilently()): tra ve { success:false, message } de
      // issueBatch() o staff-kiosk.js biet CHINH XAC phieu nay in THAT BAI, DUNG lai vong lap thay
      // vi in tiep cac phieu con lai (cung se loi vi nguyen nhan - vi du het giay - thuong van con
      // nguyen).
      return { success: false, message: err.message };
    } finally {
      // KHONG TU XOA file PDF tam ngay tai day nua (truoc day doi 15 giay roi xoa) - theo phan anh
      // thuc te cua nguoi dung: 15 giay co the KHONG DU trong nhieu truong hop (Windows Print
      // Spooler/driver may in nhiet co the mat lau hon de THUC SU doc/xu ly xong file nguon, dac
      // biet neu spooler dang ban voi lenh in khac, hoac may in tam thoi cham/bi loi roi tu hoi
      // phuc) - xoa som lam mat noi dung giua chung (in ra trang trang, hoac dung han - dung y het
      // trieu chung "Print Notification" bao loi ma nguoi dung gap). SumatraPDF thoat KHONG dong
      // nghia Windows da doc xong file, nen KHONG CO moc thoi gian nao chac chan la "an toan" de tu
      // xoa ngay sau 1 lan in - thay vao do, GIU LAI file va de dung 1 VONG DON DEP DINH KY rieng
      // (xem cleanupOldTempPdfs() ben duoi va setInterval trong app.whenReady()) tu xoa cac file
      // pdf-so-thu-tu-*.pdf CU HON 1 GIO - vua chac chan khong dung nham file dang duoc in dang do,
      // vua khong de file tam tich tu vo han (widget co the chay lien tuc nhieu ngay lien, khong
      // phai luc nao cung khoi dong lai).
      // (Khong con `return;` o day nua - ca 2 nhanh try/catch o tren gio deu tu `return` ket qua
      // { success, ... } cua rieng minh; finally chi lo don dep, khong can tra ve gi them.)
    }
  }

  // DU PHONG: thu vien pdf-to-printer chua duoc cai (thieu "npm install" sau khi cap nhat) - quay
  // ve cach in cu qua webContents.print() (co the van bi driver bo qua kho giay tuy chinh nhu da
  // ghi nhan thuc te, nhung con hon KHONG in duoc gi ca).
  debugLog(`[DỰ PHÒNG] pdf-to-printer không khả dụng - dùng webContents.print({ silent: true, deviceName: ${JSON.stringify(deviceName)}, pageSize: ${PAGE_WIDTH_MICRONS}x${pageHeightMicrons} micron })...`);
  // FIX (in hang loat chi ra 1 lenh in): win.webContents.print() dung API callback KIEU CU, KHONG
  // tra ve Promise - neu khong boc lai bang `new Promise(...)` nhu duoi day, ham printTicketSilently()
  // (dang la `async function`, duoc goi qua ipcMain.handle() moi) se KET THUC/resolve NGAY LAP TUC
  // (truoc khi callback (success, errorType) => {...} kip chay), khien phia renderer (print-receipt.js/
  // staff-kiosk.js) tuong lam nhu da in xong va lap tuc chuyen sang phieu tiep theo - gay chong cheo
  // y het loi da sua o nhanh pdf-to-printer chinh ben tren. Boc lai de nhanh DU PHONG nay cung THAT
  // SU cho toi khi Electron bao ket qua in (thanh cong hay that bai) roi moi resolve/tra ve.
  const fallbackResult = await new Promise((resolve) => {
    win.webContents.print(
      {
        silent: true,
        printBackground: false,
        deviceName,
        pageSize: { width: PAGE_WIDTH_MICRONS, height: pageHeightMicrons },
        margins: { marginType: 'none' },
      },
      (success, errorType) => {
        debugLog(`Kết quả webContents.print(): success=${success}, errorType=${JSON.stringify(errorType)}`);
        if (!success) {
          // MUC 106: DA BO dialog.showErrorBox() o day (cung ly do voi nhanh pdf-to-printer chinh o
          // tren - xem ghi chu chi tiet tai do) - thay bang ghi log + bao khong chan qua IPC.
          logPrintIssue(
            `LỖI khi in qua webContents.print() (dự phòng): errorType="${errorType}" — máy in: ` +
            `"${deviceName || '(mặc định hệ thống)'}".`
          );
          try { win.webContents.send('print-error', String(errorType)); } catch { /* cua so co the da dong - bo qua */ }
        }
        // FIX (xem ghi chu dau ham printTicketSilently()): bao ro THANH CONG/THAT BAI ve renderer
        // giong het nhanh pdf-to-printer chinh o tren, thay vi luon resolve() suong (coi nhu luon
        // thanh cong).
        resolve({ success: !!success, message: success ? undefined : String(errorType) });
      }
    );
  });
  // Cho them 1 khoang nghi giong het nhanh pdf-to-printer chinh o tren (xem giai thich chi tiet o
  // do - PRINT_JOB_GAP_MS, nay la 2000ms/2 giay theo yeu cau) - ap dung ca cho nhanh du phong nay
  // de tranh cung 1 van de gop lenh in neu may cua nguoi dung roi ve dung nhanh nay (thieu thu vien
  // pdf-to-printer).
  await new Promise((resolve) => setTimeout(resolve, 2000));
  return fallbackResult;
}

/** Liet ke may in he thong dang nhan biet duoc (qua widgetWindow, luon ton tai) va cho chon 1 cai
 * lam may in mac dinh de in phieu - luu vao config.printerDeviceName. Chon "(Máy in mặc định hệ
 * thống)" de xoa lua chon rieng, quay ve dung may in mac dinh cua he dieu hanh. */
/**
 * MUC 111 - Hop thoai TU VE cua ung dung, THAY THE hoan toan dialog.showMessageBox()/showErrorBox()
 * (hop thoai OS) va window.alert()/confirm() (hop thoai JS native cua Chromium).
 *
 * VI SAO: ca 2 loai hop thoai native tren deu CO THE khong tra lai OS-level keyboard focus cho cua so
 * widget/kiosk sau khi dong (xem MUC 106, 108) -> nhan vien khong go/quet duoc gi nua. Hop thoai o
 * day la 1 BrowserWindow nho do CHINH ung dung tao ra, nen khi dong ta CHU DONG goi
 * owner.focus() + owner.webContents.focus() de tra focus ve dung cua so da mo no.
 *
 * Dung cho: (1) trang web chay trong cua so QUA NHO de tu ve modal ben trong (thanh widget 480x40) -
 * goi qua widgetBridge.showDialog() -> ipcMain.handle('show-dialog') ben duoi; public/vendor/ui-dialog.js
 * tu chon duong nay; (2) cac thong bao cua main process (chon may in tu khay he thong).
 *
 * opts: { title, message, buttons: ['Huỷ','Đồng ý'], defaultId, cancelId, danger, type }
 * Tra ve Promise<so thu tu nut duoc bam> (Esc/dong cua so = cancelId).
 */
let appDialogQueueTail = Promise.resolve();
function escapeHtmlText(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function showAppDialog(ownerWin, opts = {}) {
  const run = () => new Promise((resolve) => {
    const buttons = (Array.isArray(opts.buttons) && opts.buttons.length ? opts.buttons : ['Đóng'])
      .slice(0, 16).map((b) => String(b).slice(0, 200));
    const clampIdx = (v, dflt) => (Number.isInteger(v) && v >= 0 && v < buttons.length ? v : dflt);
    const cancelId = clampIdx(opts.cancelId, buttons.length - 1);
    const defaultId = clampIdx(opts.defaultId, 0);
    const vertical = buttons.length > 3; // danh sach dai (vd chon may in) -> xep doc
    const owner = ownerWin && !ownerWin.isDestroyed() ? ownerWin : null;
    const WIDTH = vertical ? 460 : 440;

    const btnHtml = buttons.map((label, i) => {
      let cls = 'btn';
      if (i === defaultId && i !== cancelId) cls += opts.danger ? ' danger' : ' primary';
      return `<button class="${cls}" data-i="${i}">${escapeHtmlText(label)}</button>`;
    }).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>dlg</title><style>
      html,body{margin:0;background:#fff;color:#0f172a;font-family:"Segoe UI",system-ui,Arial,sans-serif;}
      #box{padding:18px 20px 16px;border:1px solid #cbd5e1;border-radius:10px;box-sizing:border-box;}
      h1{font-size:16px;margin:0 0 8px;font-weight:700;}
      #msg{font-size:14.5px;line-height:1.5;white-space:pre-wrap;word-break:break-word;max-height:420px;overflow:auto;}
      #btns{display:flex;gap:8px;margin-top:16px;${vertical ? 'flex-direction:column;' : 'justify-content:flex-end;flex-wrap:wrap;'}}
      .btn{font:inherit;font-size:14.5px;font-weight:600;padding:9px 16px;border-radius:8px;border:1px solid #cbd5e1;
        background:#f1f5f9;color:#0f172a;cursor:pointer;min-width:88px;${vertical ? 'text-align:left;' : ''}}
      .btn:focus-visible{outline:3px solid #93c5fd;outline-offset:1px;}
      .primary{background:#2563eb;border-color:#2563eb;color:#fff;}
      .danger{background:#dc2626;border-color:#dc2626;color:#fff;}
    </style></head><body><div id="box">
      ${opts.title ? `<h1>${escapeHtmlText(opts.title)}</h1>` : ''}
      <div id="msg">${escapeHtmlText(opts.message)}</div>
      <div id="btns">${btnHtml}</div>
    </div><script>
      const pick = (i) => { document.title = '__r:' + i; };
      document.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => pick(b.dataset.i)));
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); pick(${cancelId}); } });
      const d = document.querySelector('button[data-i="${defaultId}"]'); if (d) d.focus();
    </script></body></html>`;

    blockingDialogOpen = true;
    const win = new BrowserWindow({
      width: WIDTH,
      height: 200,
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: '#ffffff',
      title: opts.title || 'Thông báo',
      icon: path.join(__dirname, 'assets', 'icon.png'),
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.setAlwaysOnTop(true, 'screen-saver'); // noi tren ca widget/kiosk dang o muc 'screen-saver'
    win.setMenu(null);

    let done = false;
    const finish = (idx) => {
      if (done) return;
      done = true;
      blockingDialogOpen = false;
      if (!win.isDestroyed()) win.destroy();
      // TRA FOCUS ve dung cua so da mo hop thoai - diem mau chot so voi hop thoai native.
      if (owner && !owner.isDestroyed() && owner.isVisible()) {
        owner.focus();
        owner.webContents.focus();
      }
      resolve(idx);
    };
    win.webContents.on('page-title-updated', (event, t) => {
      const m = /^__r:(\d+)$/.exec(t || '');
      if (m) { event.preventDefault(); finish(clampIdx(Number(m[1]), cancelId)); }
    });
    win.on('closed', () => finish(cancelId));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.once('did-finish-load', async () => {
      if (win.isDestroyed()) return;
      let h = 200;
      try { h = await win.webContents.executeJavaScript('document.getElementById("box").offsetHeight'); } catch { /* giu mac dinh */ }
      if (win.isDestroyed()) return;
      const height = Math.max(120, Math.min(Math.ceil(h) + 2, 640));
      const area = screen.getDisplayMatching(owner ? owner.getBounds() : screen.getPrimaryDisplay().bounds).workArea;
      win.setBounds({
        x: Math.round(area.x + (area.width - WIDTH) / 2),
        y: Math.round(area.y + (area.height - height) / 2),
        width: WIDTH,
        height,
      });
      win.show();
      win.focus();
      win.webContents.focus();
    });
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  });
  // Xep hang: moi luc chi 1 hop thoai (giong native)
  const p = appDialogQueueTail.then(run, run);
  appDialogQueueTail = p.catch(() => {});
  return p;
}

async function pickPrinterFromTray() {
  const sourceWin = (widgetWindow && !widgetWindow.isDestroyed() && widgetWindow)
    || (kioskWindow && !kioskWindow.isDestroyed() && kioskWindow)
    || (staffKioskWindow && !staffKioskWindow.isDestroyed() && staffKioskWindow);
  if (!sourceWin) return;
  let printers = [];
  try {
    printers = await sourceWin.webContents.getPrintersAsync();
  } catch (err) {
    // MUC 106: nhan vien CHU DONG bam vao muc "Máy in nhiệt" trong khay he thong de goi ham nay -
    // ho DANG DUNG TRUOC MAY nen 1 hop thoai loi o day la hop ly (khac han loi in TU DONG/LANG LE
    // trong printTicketSilently() ben duoi - da BO hop thoai o do, xem ghi chu MUC 106 tai do). Van
    // danh dau blockingDialogOpen (het han sau 8s - showErrorBox() KHONG co callback bao luc dong)
    // de kioskWindow.on('blur', ...) tam hoan tu dong lay lai focus, tranh giat hop thoai nay ra
    // khoi tay nhan vien neu ho dang dung chung 1 may voi kiosk fullscreen.
    // MUC 111: doi dialog.showErrorBox() (hop thoai OS, cuop focus) -> showAppDialog() (tu tra focus)
    await showAppDialog(sourceWin, { title: 'Không lấy được danh sách máy in', message: err.message, buttons: ['Đóng'] });
    return;
  }
  if (!printers.length) {
    await showAppDialog(sourceWin, {
      title: 'Không tìm thấy máy in',
      message: 'Không phát hiện máy in nào trên máy này. Kiểm tra máy in nhiệt đã được cài đặt và bật nguồn chưa.',
      buttons: ['Đóng'],
    });
    return;
  }
  // `labels` de HIEN THI cho nguoi dung de doc; `names` de LUU/DUNG THUC SU khi in ("name" - ten
  // he thong noi bo Electron/Windows dung de khop may in, co the khac voi "displayName" - ten hien
  // thi than thien - tren mot so may). Hai mang nay cung chi so voi nhau.
  const labels = ['(Máy in mặc định hệ thống)', ...printers.map((p) => p.displayName || p.name)];
  const names = [null, ...printers.map((p) => p.name)];
  const currentIndex = config.printerDeviceName
    ? names.findIndex((name) => name === config.printerDeviceName)
    : 0;
  // MUC 106: dung try/finally (thay vi de mac dinh) de dam bao blockingDialogOpen LUON duoc tra ve
  // false ngay khi hop thoai dong (du chon may in hay bam Huy), khong bi "ket" mai la true.
  // MUC 111: doi dialog.showMessageBox() -> showAppDialog() (tu quan ly blockingDialogOpen + tra focus)
  const response = await showAppDialog(sourceWin, {
    title: 'Chọn máy in nhiệt',
    message: 'Chọn máy in dùng để in phiếu số thứ tự (in lặng lẽ, không hiện hộp thoại):',
    buttons: [...labels, 'Huỷ'],
    cancelId: labels.length,
    defaultId: currentIndex >= 0 ? currentIndex : 0,
  });
  if (response == null || response >= labels.length) return; // bam Huy
  config.printerDeviceName = names[response];
  saveConfig(app, config);
  if (tray) tray.setContextMenu(buildTrayMenu());
}

/** Loi thoat thu cong: dua widget ve dung 1 kich thuoc/vi tri mac dinh (thanh ngang 1 dong,
 * goc tren-phai man hinh) - dung khi cua so bi keo/thu nho lech, hoac dang ket o kich thuoc cu. */
function resetWidgetBounds() {
  // Chi xoa vi tri/kich thuoc da luu cua DUNG HUONG HIEN TAI - khong dung toi huong con lai (xem
  // currentWidgetBoundsKey()).
  config[currentWidgetBoundsKey()] = null;
  saveConfig(app, config);
  const bounds = defaultWidgetBounds();
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.setBounds(bounds);
    widgetWindow.show();
    widgetWindow.focus();
  } else {
    createWidgetWindow();
  }
}

/**
 * Doi giua CHIEU NGANG (mac dinh, 1 thanh ngang duy nhat) va CHIEU DOC (moi, theo yeu cau: "hiển
 * thị widget theo chiều dọc làm sao cho nhỏ nhất như hiện tại chỉ đổi lại là chiều dọc thôi" - xep
 * lai chinh NOI DUNG/KICH THUOC hien co theo chieu TREN XUONG DUOI thay vi TRAI SANG PHAI, khong
 * them/bot chuc nang gi) - goi tu checkbox "Hiển thị widget theo chiều dọc" trong menu tray (xem
 * buildTrayMenu() ben duoi). Doi vi tri/kich thuoc cua so sang DUNG cap da luu rieng cho huong moi
 * (hoac mac dinh cua huong do neu chua tung dat) va TAI LAI trang (widgetUrl() tu gan ?orientation=
 * vertical dung theo config moi) de public/counter/widget/widget.js ap dung dung CSS bo cuc.
 */
function setWidgetOrientation(vertical) {
  config.widgetOrientation = vertical ? 'vertical' : 'horizontal';
  saveConfig(app, config);
  if (!widgetWindow || widgetWindow.isDestroyed()) return;
  const bounds = sanitizeBounds(config[currentWidgetBoundsKey()]) || defaultWidgetBounds();
  const minSize = currentWidgetMinSize();
  widgetWindow.setMinimumSize(minSize.width, minSize.height);
  widgetWindow.setBounds(bounds);
  widgetWindow.loadURL(widgetUrl());
}

function buildTrayMenu() {
  const loginSettings = app.getLoginItemSettings();
  return Menu.buildFromTemplate([
    { label: 'Mở màn hình quản lý (/counter)', click: createSettingsWindow },
    { label: 'Mở kiosk bốc số – Bệnh nhân (/kiosk)', click: openKioskWindow },
    { label: 'Mở kiosk cấp số – Nhân viên (/staff-kiosk)', click: openStaffKioskWindow },
    // Muc moi (theo yeu cau): mo NGAY man hinh "Xem tất cả các quầy đang phục vụ" (/waiting-screen,
    // trang cong khai co san tu truoc - xem waiting-screen/index.html - nhung truoc gio chi mo duoc
    // bang cach tu go dia chi vao trinh duyet ngoai, khong co trong widget) - xem
    // openWaitingScreenWindow() o tren.
    { label: 'Xem tất cả các quầy đang phục vụ', click: openWaitingScreenWindow },
    { label: 'Hiện / Ẩn widget', click: toggleWidgetVisibility },
    { type: 'separator' },
    {
      label: `Máy in nhiệt: ${config.printerDeviceName || '(mặc định hệ thống)'}`,
      click: pickPrinterFromTray,
    },
    {
      label: 'Luôn nổi bên trên',
      type: 'checkbox',
      checked: config.alwaysOnTop,
      click: (item) => {
        config.alwaysOnTop = item.checked;
        saveConfig(app, config);
        if (widgetWindow && !widgetWindow.isDestroyed()) {
          widgetWindow.setAlwaysOnTop(item.checked, item.checked ? 'screen-saver' : undefined);
        }
      },
    },
    {
      // Muc moi (theo yeu cau): "Hiển thị widget theo chiều dọc làm sao cho nhỏ nhất như hiện tại
      // chỉ đổi lại là chiều dọc thôi" - xem setWidgetOrientation() o tren.
      label: 'Hiển thị widget theo chiều dọc',
      type: 'checkbox',
      checked: isWidgetVertical(),
      click: (item) => setWidgetOrientation(item.checked),
    },
    {
      label: 'Khởi động cùng Windows',
      type: 'checkbox',
      checked: loginSettings.openAtLogin,
      click: (item) => {
        config.autoLaunch = item.checked;
        saveConfig(app, config);
        app.setLoginItemSettings({ openAtLogin: item.checked });
      },
    },
    {
      // Muc moi (theo yeu cau): "bổ sung thêm 1 cấu hình tự động mở fullscreen kiosk bốc số của
      // bệnh nhân khi khởi động" - chi luu cau hinh + bat/tat o day, hanh dong THUC SU mo kiosk
      // luc khoi dong nam trong app.whenReady() (xem ghi chu chi tiet o do va o
      // autoOpenKioskOnStartup trong config.js). Bam tich/bo tich NGAY BAY GIO (khong doi khoi
      // dong lai ung dung) se MO/DONG luon kiosk ngay lap tuc de nguoi dung thay hieu ung ro rang,
      // giong cach cac muc checkbox khac trong menu nay (Luôn nổi bên trên, Hiển thị dọc...) đều
      // áp dụng ngay khi bấm.
      label: 'Tự động mở kiosk bốc số khi khởi động',
      type: 'checkbox',
      checked: config.autoOpenKioskOnStartup,
      click: (item) => {
        config.autoOpenKioskOnStartup = item.checked;
        saveConfig(app, config);
        if (item.checked) {
          openKioskWindow();
        } else if (kioskWindow && !kioskWindow.isDestroyed()) {
          kioskWindow.close();
        }
      },
    },
    { label: 'Đổi địa chỉ máy chủ...', click: createServerUrlPrompt },
    { label: 'Đặt lại vị trí/kích thước widget', click: resetWidgetBounds },
    // Da bo muc "Mở file nhật ký in (chẩn đoán lỗi)" GHI LIEN TUC kieu cu (moi lan in deu ghi) cung
    // nhu toan bo viec luu ban sao PDF chan doan (xem debugLog() o dau file) - theo yeu cau tat bot
    // ghi log cho widget nhe may hon. Rieng muc duoi day KHAC: chi CHINH file `loi-in.log` (xem
    // logPrintIssue() o tren) MOI GHI KHI THUC SU CO DAU HIEU BAT THUONG (may in bao trang thai loi
    // qua status, hoac lenh in nem loi ngoai le) - khong phai ghi lien tuc, nen khong di nguoc lai
    // yeu cau do. CHI HIEN muc nay trong menu khi file da thuc su ton tai (chua tung co loi nao thi
    // khong hien, tranh menu roi rac vo ich).
    ...(fs.existsSync(printIssueLogPath())
      ? [{ label: 'Mở file log lỗi in', click: () => shell.openPath(printIssueLogPath()) }]
      : []),
    { type: 'separator' },
    { label: 'Thoát', click: () => app.quit() },
  ]);
}

function toggleWidgetVisibility() {
  if (!widgetWindow || widgetWindow.isDestroyed()) { createWidgetWindow(); return; }
  if (widgetWindow.isVisible()) widgetWindow.hide();
  else { widgetWindow.show(); widgetWindow.focus(); }
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Widget Quầy Tiếp Nhận');
  tray.setContextMenu(buildTrayMenu());
  tray.on('double-click', toggleWidgetVisibility);
}

/**
 * Don DINH KY cac file PDF tam (xem printTicketSilently() - TU NAY KHONG con tu xoa file ngay sau
 * 15 giay nhu truoc nua, vi 15 giay co the KHONG DU cho Windows Print Spooler/driver may in nhiet
 * thuc su doc xong file nguon, gay mat noi dung giua chung khi in - xem ghi chu chi tiet trong
 * printTicketSilently()) - CHI xoa file CU HON 1 GIO de chac chan khong dung nham file dang co tien
 * trinh in nao khac su dung (an toan, khong bao gio can chinh xac tuyet doi o day). Duoc goi 1 lan
 * luc khoi dong ung dung (don sach file sot lai tu lan chay truoc) VA lap lai DINH KY moi 2 tieng
 * trong luc ung dung dang chay (xem setInterval trong app.whenReady() ben duoi) - vi widget thuong
 * chay LIEN TUC nhieu ngay lien (tu khoi dong cung Windows, khong tat may), neu chi don 1 lan luc
 * khoi dong thi file tam se tich tu ngay cang nhieu ma khong bao gio duoc don trong luc do.
 */
function cleanupOldTempPdfs() {
  try {
    const dir = os.tmpdir();
    const now = Date.now();
    fs.readdirSync(dir).forEach((name) => {
      if (!/^phieu-so-thu-tu-\d+(-[0-9a-f]+)?\.pdf$/.test(name)) return;
      const fullPath = path.join(dir, name);
      try {
        const stat = fs.statSync(fullPath);
        if (now - stat.mtimeMs > 60 * 60 * 1000) fs.unlinkSync(fullPath);
      } catch { /* file co the da bi xoa/dang duoc dung - bo qua */ }
    });
  } catch (err) {
    console.error('[cleanupOldTempPdfs] Lỗi dọn file PDF tạm cũ:', err.message);
  }
}

app.whenReady().then(() => {
  config = loadConfig(app);
  // Lan dau chay (chua co gi trong config) -> mac dinh BAT tu khoi dong cung Windows, dung
  // theo yeu cau ("khoi dong cung voi may tinh") ma khong bat nguoi dung phai tu bat trong tray.
  app.setLoginItemSettings({ openAtLogin: config.autoLaunch !== false });

  cleanupOldTempPdfs();
  // Lap lai dinh ky (khong chi 1 lan luc khoi dong) - xem ghi chu chi tiet trong cleanupOldTempPdfs()
  // o tren.
  setInterval(cleanupOldTempPdfs, 2 * 60 * 60 * 1000);
  // Gan header "chia khoa" cho /kiosk TRUOC KHI tao bat ky cua so nao (widget/kiosk...) - dam bao
  // ke ca lan tai trang /kiosk DAU TIEN (vi du do autoOpenKioskOnStartup ben duoi) cung da co san
  // header nay, khong bi redirect ve trang dang nhap 1 nhip roi moi vao duoc.
  setupKioskWidgetSecretHeader();
  createWidgetWindow();
  createTray();
  startLocalPrintServer();

  // MOI (theo yeu cau): "bổ sung thêm 1 cấu hình tự động mở fullscreen kiosk bốc số của bệnh nhân
  // khi khởi động" - xem autoOpenKioskOnStartup trong config.js. Goi SAU KHI da tao xong widget
  // (createWidgetWindow() o tren) de openKioskWindow() ghi nhan DUNG trang thai "widget dang hien"
  // truoc khi an no di (bien widgetWasVisibleBeforeKiosk trong openKioskWindow() - nho vay khi
  // nguoi dung dong cua so kiosk sau nay, widget se TU HIEN LAI dung nhu truong hop mo kiosk thu
  // cong qua tray). Ham nay tu xu ly toan bo (tao cua so, cho ket noi may chu neu chua san sang,
  // vao fullscreen...) - khong can cho gi them o day.
  if (config.autoOpenKioskOnStartup) openKioskWindow();

  ipcMain.on('open-settings', (event, openTarget) => createSettingsWindow(openTarget));
  // An cua so /counter ngay sau khi dang nhap 1 quay xong - xem hideSettingsWindow() o tren va
  // selectCounter() trong counter.js.
  ipcMain.on('hide-settings-window', () => hideSettingsWindow());
  ipcMain.on('open-patient-screen', (event, counterId) => openPatientScreenWindow(counterId));
  // Dung boi cac nut GOI SO tren widget (Gọi tiếp theo/Gọi lại/Bỏ qua/Gọi riêng đối tượng - xem
  // ensurePatientScreen() trong widget.js) - CHI tu mo man hinh benh nhan neu quay do CHUA mo san,
  // KHONG cuop focus/hien lai neu da dang mo (xem giai thich opts.bringToFront trong
  // openPatientScreenWindow() o tren). Dung `handle` (khong phai `on`) - widget.js CAN CHO
  // (await) ket qua truoc khi thuc su goi API goi so, de dam bao khong bi mat tieng thong bao o
  // lan goi dau tien (xem giai thich Promise trong openPatientScreenWindow() o tren).
  ipcMain.handle('ensure-patient-screen', (event, counterId) => openPatientScreenWindow(counterId, { bringToFront: false }));
  // Dong cua so man hinh benh nhan - dung khi nhan vien bam nut "Đăng xuất nhanh" tren widget (xem
  // logoutCounter() trong widget.js va closePatientScreenWindow() o tren).
  ipcMain.on('close-patient-screen', () => closePatientScreenWindow());
  // Goi tu nut moi tren widget (xem #staffKioskBtn trong public/counter/widget/index.html/widget.js)
  // - mo THANG kiosk cap so - Nhan vien (/staff-kiosk) NGAY TRONG ung dung nay, tai dung
  // openStaffKioskWindow() da co san (dung chung voi muc tray "Mở kiosk cấp số – Nhân viên"), de
  // in lang le qua may in nhiet hoat dong duoc (yeu cau chay trong Electron, khong phai trinh
  // duyet ngoai - xem preload.js).
  ipcMain.on('open-staff-kiosk', () => openStaffKioskWindow());
  /**
   * MOI (theo yeu cau): "bổ sung thêm 1 nút thoát App ở màn hình localhost:4000". Trang "/" (chon
   * Bệnh nhân/Nhân viên - public/index.html) la noi nut "Trang chủ" cua CA /kiosk LAN /staff-kiosk
   * dua nhan vien/benh nhan ve (xem home-link trong 2 trang do) - nghia la trang nay HOAN TOAN co
   * the dang hien THAT SU o trong kioskWindow/staffKioskWindow (toan man hinh, khong vien cua so/
   * thanh taskbar nao ca tren mot man hinh cam ung), luc do KHONG CO CACH NAO khac de thoat han ung
   * dung ngoai viec bam dung nut chuot phai vao icon khay he thong (tray) - rat bat tien/kho tim
   * tren 1 may kiosk cam ung thuan tuy. Nut nay goi thang `app.quit()`, Y HET nhu muc "Thoát" co san
   * trong menu chuot phai tren tray (xem buildTrayMenu() ben duoi) - la co che THOAT THAT SU duy
   * nhat da duoc kiem chung cua ung dung nay (window-all-closed luon preventDefault() de ung dung
   * o lai trong tray, CHI app.quit() moi thuc su vuot qua duoc co che do).
   */
  ipcMain.on('quit-app', () => app.quit());
  // MUC 111: hop thoai tu ve cho trang web o cua so qua nho (thanh widget) - xem showAppDialog().
  ipcMain.handle('show-dialog', (event, opts) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const o = opts && typeof opts === 'object' ? opts : {};
    return showAppDialog(owner, {
      title: typeof o.title === 'string' ? o.title.slice(0, 200) : '',
      message: typeof o.message === 'string' ? o.message.slice(0, 4000) : '',
      buttons: Array.isArray(o.buttons) ? o.buttons : undefined,
      defaultId: o.defaultId,
      cancelId: o.cancelId,
      danger: !!o.danger,
    });
  });
  ipcMain.handle('get-server-url', () => config.serverUrl);
  ipcMain.on('save-server-url', (event, url) => {
    if (typeof url === 'string' && url.trim()) {
      config.serverUrl = url.trim().replace(/\/+$/, '');
      saveConfig(app, config);
      reloadAllWindows();
    }
    if (promptWindow && !promptWindow.isDestroyed()) promptWindow.close();
  });
  ipcMain.on('close-server-url-prompt', () => {
    if (promptWindow && !promptWindow.isDestroyed()) promptWindow.close();
  });
  // Goi tu window.electronPrint.print() (xem preload.js) khi /kiosk hoac /staff-kiosk vua tao
  // xong 1 ve va muon in phieu - in LANG LE, khong hop thoai (xem printTicketSilently() o tren).
  //
  // FIX (xem giai thich chi tiet trong preload.js): doi `ipcMain.on()` (khong co phan hoi) sang
  // `ipcMain.handle()` (CO phan hoi, khop voi `ipcRenderer.invoke()` moi trong preload.js) - de
  // Promise phia trinh duyet CHI resolve SAU KHI in xong THAT SU, giup vong lap in LAN LUOT nhieu
  // phieu (issueBatch() trong staff-kiosk.js) hoat dong dung nhu ten goi - moi lenh cho lenh truoc
  // XONG HAN roi moi chay tiep, khong con bi chong cheo/mat phieu khi cap nhieu so cung luc.
  //
  // MUC 95: goi qua queuePrintJob() (hang doi in toan cuc) thay vi goi THANG printTicketSilently()
  // - dam bao MOI lenh in, tu BAT KY cua so nao (kiosk, staff-kiosk, hay cua so an cua "cầu nối in"
  // HTTP cuc bo), deu chay LAN LUOT tung lenh 1, khong bao gio chong cheo - xem giai thich chi tiet
  // o dinh nghia queuePrintJob() o tren (nguyen nhan goc gay treo ung dung khi quet lien tuc).
  ipcMain.handle('print-ticket', (event, contentHeightPx) => queuePrintJob(event, contentHeightPx));

  // Tren macOS thi giu ung dung song ngay ca khi khong cua so nao mo (khong ap dung nhieu cho
  // Windows la doi tuong chinh cua ung dung nay, nhung giu cho dung quy uoc chuan cua Electron).
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWidgetWindow();
  });
});

// KHONG thoat ung dung khi dong het cua so (widget co the bi "an" thay vi dong hoan toan) -
// ung dung nay chay thuong tru trong khay he thong, chi thoat that su qua muc "Thoat" trong tray.
app.on('window-all-closed', (e) => {
  e?.preventDefault?.();
});

// Theo phan anh: "widget dọc không lưu lại vị trí và kích thước tôi đã điều chỉnh" - GHI NGAY LAP
// TUC vi tri/kich thuoc widget hien tai (bo qua 400ms debounce cua scheduleSaveBounds()) truoc khi
// ung dung THUC SU thoat (qua muc tray "Thoát", hoac Windows dong ung dung luc tat may/dang xuat) -
// xem flushWidgetBoundsSave() o tren de biet day du nguyen nhan/ly do. 'before-quit' luon chay
// TRUOC khi cac cua so bat dau dong nen widgetWindow.getBounds() o day van con doc dung.
app.on('before-quit', () => {
  flushWidgetBoundsSave();
});
