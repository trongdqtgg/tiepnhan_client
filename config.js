/**
 * Luu/doc cau hinh nho cua ung dung (dia chi may chu, vi tri/kich thuoc widget, bat/tat luon-noi-
 * ben-tren...) vao 1 file JSON trong thu muc du lieu nguoi dung cua Electron (an toan, khong lo
 * theo ban cai dat, moi may tinh giu rieng cau hinh cua minh). Chi dung module `fs` co san,
 * khong can them thu vien nao.
 */
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  serverUrl: 'http://localhost:4000',
  alwaysOnTop: true,
  autoLaunch: true,
  widgetBounds: null, // { x, y, width, height } - null = de Electron tu dat vi tri mac dinh (CHIEU NGANG)
  // Vi tri/kich thuoc RIENG cho CHIEU DOC (xem widgetOrientation ben duoi) - luu tach biet voi
  // widgetBounds o tren de doi qua doi lai giua 2 chieu KHONG lam mat vi tri/kich thuoc da tung
  // chinh tay cho chieu kia. null = de Electron tu dat vi tri/kich thuoc mac dinh cua chieu doc.
  widgetBoundsVertical: null,
  // 'horizontal' (mac dinh, 1 thanh ngang duy nhat) hoac 'vertical' (moi - xep noi dung tu tren
  // xuong duoi, be rong nho nhat co the) - doi qua muc "Hiển thị widget theo chiều dọc" trong menu
  // khay he thong (tray), xem setWidgetOrientation() trong main.js.
  widgetOrientation: 'horizontal',
  // Ten may in nhiet dung de IN LANG LE (khong hop thoai) phieu so thu tu tu /kiosk va
  // /staff-kiosk - xem printTicketSilently() trong main.js. null/'' = dung MAY IN MAC DINH cua he
  // dieu hanh (thuong la lua chon dung nhat, chi can dat may in nhiet lam mac dinh trong Windows).
  // Doi qua muc "Máy in nhiệt" trong menu khay he thong (tray).
  printerDeviceName: null,
  // Cong TCP (chi lang nghe 127.0.0.1, khong lo ra mang LAN) de widget nhan yeu cau in LANG LE tu
  // CAC TRANG WEB THUONG dang chay tren CHINH MAY NAY (vi du /staff-kiosk mo bang Chrome/Edge binh
  // thuong, khong qua menu tray) - xem startLocalPrintServer() trong main.js va
  // public/print-receipt.js (hang so LOCAL_PRINT_BRIDGE_PORT, PHAI khop voi gia tri nay).
  localPrintServerPort: 58585,
  // MOI (theo yeu cau): TU DONG mo toan man hinh (fullscreen) man hinh "Kiosk bốc số - Bệnh nhân"
  // (/kiosk) NGAY KHI ung dung widget khoi dong (thuong dung chung voi autoLaunch=true o tren, de
  // may kiosk dat o quay/sanh tu bat len la san sang cho benh nhan bam ngay, khong can nhan vien
  // tu tay mo qua menu khay he thong moi lan khoi dong may/mo lai ung dung). Mac dinh TAT (false) -
  // GIU NGUYEN hanh vi cu (chi hien widget, benh nhan phai duoc nhan vien tu mo kiosk qua tray) cho
  // cac ban cai dat hien co, tranh doi hanh vi ngoai y muon. Bat/tat qua muc "Tự động mở kiosk bốc
  // số khi khởi động" trong menu khay he thong (tray) - xem openKioskWindow() va app.whenReady()
  // trong main.js.
  autoOpenKioskOnStartup: false,
};

function configPath(app) {
  return path.join(app.getPath('userData'), 'widget-config.json');
}

function loadConfig(app) {
  try {
    const raw = fs.readFileSync(configPath(app), 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveConfig(app, config) {
  try {
    fs.writeFileSync(configPath(app), JSON.stringify(config, null, 2), 'utf8');
  } catch (err) {
    console.error('[config] Không lưu được cấu hình:', err.message);
  }
}

module.exports = { DEFAULTS, loadConfig, saveConfig };
