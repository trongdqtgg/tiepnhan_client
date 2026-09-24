/**
 * Preload chay TRUOC khi trang web duoc tai, voi contextIsolation:true (an toan - trang web KHONG
 * dung truc tiep duoc cac API cua Node/Electron, chi dung duoc dung nhung gi ta chu dong "lo ra"
 * qua contextBridge o day).
 *
 * `window.widgetBridge.openSettings()` duoc trang public/counter/widget/widget.js goi khi bam nut
 * ⚙️ - bao main.js mo (hoac dua ra truoc) cua so quan ly day du (/counter/) thay vi dieu huong
 * chinh cua so widget nho sang trang khac.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widgetBridge', {
  // `openTarget` (tuy chon): 'priority-order' hoac 'skipped' - mo san dung modal tren trang
  // /counter thay vi chi mo man hinh lam viec thuong (xem createSettingsWindow() trong main.js va
  // 2 nut moi tren widget goi ham nay trong widget.js).
  openSettings: (openTarget) => ipcRenderer.send('open-settings', openTarget),
  // An (khong dong) cua so /counter dang mo - dung boi counter.js ngay sau khi dang nhap 1 quay
  // xong, de chi con hien man hinh benh nhan toan man hinh (xem hideSettingsWindow() trong main.js).
  hideSettings: () => ipcRenderer.send('hide-settings-window'),
  // Mo man hinh benh nhan (/patient-screen) cua quay dang chon - main.js se tu dua cua so nay
  // sang man hinh phu (neu may co nhieu man hinh) va tu dong vao toan man hinh.
  openPatientScreen: (counterId) => ipcRenderer.send('open-patient-screen', counterId),
  // Dung boi cac nut GOI SO tren widget (Gọi tiếp theo/Gọi lại/Bỏ qua/Gọi riêng đối tượng) - CHI tu
  // mo man hinh benh nhan neu CHUA mo san, khong cuop focus neu da dang mo - xem ensurePatientScreen()
  // trong widget.js va kenh IPC 'ensure-patient-screen' trong main.js. Dung `invoke` (tra ve Promise,
  // KHONG phai `send` bắn đi rồi thôi) - widget.js CAN CHO xong promise nay (man hinh da mo VA da
  // đợi đủ thời gian kết nối socket) TRƯỚC KHI thực sự gọi API gọi số, tránh bị mất tiếng thông báo
  // ở lần gọi đầu tiên khi màn hình bệnh nhân vừa tự bật.
  ensurePatientScreen: (counterId) => ipcRenderer.invoke('ensure-patient-screen', counterId),
  // Dong cua so man hinh benh nhan dang mo (neu co) - dung khi bam nut "Đăng xuất nhanh" tren
  // widget (xem logoutCounter() trong widget.js va closePatientScreenWindow() trong main.js).
  closePatientScreen: () => ipcRenderer.send('close-patient-screen'),
  // Mo THANG kiosk cap so - Nhan vien (/staff-kiosk) ngay trong ung dung nay (dung nut moi tren
  // widget) - xem openStaffKioskWindow() trong main.js.
  openStaffKiosk: () => ipcRenderer.send('open-staff-kiosk'),
  // MOI - nut "Thoát ứng dụng" tren trang "/" (public/index.html, xem #exitAppLink): chi hien nut
  // khi CHINH trang do dang chay trong Electron nay (kiem tra `window.widgetBridge` ton tai), goi
  // thang `app.quit()` phia main.js - xem giai thich chi tiet tai ipcMain.on('quit-app', ...) trong
  // main.js (giong het co che "Thoát" co san trong menu tray, la cach thoat THAT SU duy nhat).
  quitApp: () => ipcRenderer.send('quit-app'),
  // MUC 111: hop thoai tu ve (thay alert/confirm native) cho trang o cua so qua nho nhu thanh widget -
  // main process mo 1 cua so hop thoai rieng va TU TRA FOCUS ve cua so nay khi dong. Tra ve Promise<index nut>.
  showDialog: (opts) => ipcRenderer.invoke('show-dialog', opts),
  // MUC 117: cap nhat widget (trang chu "/" hien trang thai + nut cap nhat khi mo trong widget)
  getWidgetUpdateStatus: () => ipcRenderer.invoke('widget-update-status'),
  checkWidgetUpdate: () => ipcRenderer.invoke('widget-update-check'),
  installWidgetUpdate: () => ipcRenderer.invoke('widget-update-install'),
  // Dung rieng cho cua so nho "Đổi địa chỉ máy chủ" (server-url-prompt.html)
  getServerUrl: () => ipcRenderer.invoke('get-server-url'),
  saveServerUrl: (url) => ipcRenderer.send('save-server-url', url),
  closePrompt: () => ipcRenderer.send('close-server-url-prompt'),
});

/**
 * `window.electronPrint.print()` - danh cho public/print-receipt.js: neu trang /kiosk hoac
 * /staff-kiosk dang chay BEN TRONG ung dung Electron nay (xem openKioskWindow()/
 * openStaffKioskWindow() trong main.js, ca 2 deu gan preload nay), print-receipt.js se goi ham
 * nay THAY VI window.print() thuong - main.js se tu in LANG LE (khong hop thoai/xem truoc nao ca)
 * thang ra may in nhiet da chon (xem printerDeviceName trong config.js), dung API
 * `webContents.print({ silent: true })` cua chinh Electron. Khi trang chay trong trinh duyet
 * thuong (khong phai Electron) thi `window.electronPrint` khong ton tai, print-receipt.js tu quay
 * ve dung window.print() nhu cu.
 */
contextBridge.exposeInMainWorld('electronPrint', {
  // `contentHeightPx` (tuy chon) - chieu cao THUC TE (px) cua noi dung phieu vua render, do
  // public/print-receipt.js do truoc khi goi - main.js dung gia tri nay de dat KHO GIAY IN dung
  // bang do dai that cua phieu (xem printTicketSilently() trong main.js), tranh in du 1 trang giay
  // dai co dinh (thua giay trang phia duoi).
  //
  // FIX (phat hien qua phan anh cua nguoi dung: "kiểm tra lại phần in hàng loạt nhiều stt tiếp
  // nhận widget nó chỉ có 1 lệnh in duy nhất"): TRUOC DAY dung `ipcRenderer.send()` (ban tin nhan
  // "bắn đi rồi thôi", KHONG doi phan hoi) - ham `print()` nay tra ve NGAY LAP TUC, khien
  // printReceipt() (public/print-receipt.js) - dang la 1 ham `async` - cung tra ve/ket thuc NGAY,
  // trong khi lenh in THAT SU o main.js (printTicketSilently()) van con dang chay ngam (xuat PDF,
  // goi SumatraPDF...) mat vai tram ms toi vai giay. Khi cap NHIEU so lien tiep (tinh nang moi -
  // xem issueBatch() trong public/staff-kiosk/staff-kiosk.js), vong lap `for...of` co `await
  // printTicketReceipt(...)` TUONG NHU dang cho tung phieu in xong moi in phieu tiep theo, nhung
  // vi `await` o day thuc chat ket thuc GAN NHU NGAY LAP TUC (khong doi lenh in that su xong), tat
  // ca N lenh in bi ban di GAN NHU CUNG LUC - N lenh nay CHIA SE CHUNG 1 cua so nguon (kioskWindow/
  // staffKioskWindow) va portrait DOM `#printReceipt` (bi ghi de lien tuc boi phieu SAU truoc khi
  // phieu TRUOC kip chup PDF xong), gay chong cheo/mat du lieu - dan den chi co 1 (hoac vai) phieu
  // thuc su in duoc dung noi dung, cac phieu con lai bi mat/sai.
  //
  // SUA: doi sang `ipcRenderer.invoke()` (co doi PHAN HOI THAT SU tu main process, khop voi
  // `ipcMain.handle('print-ticket', ...)` moi trong main.js, thay cho `ipcMain.on()` cu) - nho vay
  // Promise tra ve o day CHI resolve SAU KHI `printTicketSilently()` o main.js THUC SU chay xong
  // toan bo (ke ca cho SumatraPDF/webContents.print() hoan tat), khien `await` trong
  // print-receipt.js/staff-kiosk.js tro thanh 1 su cho THAT (khong con la "cho gia") - moi phieu
  // trong 1 lo se in XONG HAN roi moi bat dau xu ly phieu tiep theo, khong con chong cheo DOM/file
  // tam nua.
  print: (contentHeightPx) => ipcRenderer.invoke('print-ticket', contentHeightPx),
  // MOI - danh RIENG cho public/print-ticket-frame/print-ticket-frame.js (trang AN, chi duoc
  // chinh electron-widget/main.js tu mo de in ho cho 1 trang WEB THUONG - xem
  // openPrintFrameWindow()/startLocalPrintServer() trong main.js): sau khi in xong (thanh cong hay
  // that bai), trang an nay GOI HAM NAY de bao ket qua NGUOC LAI cho main.js, main.js dung ket qua
  // do de THAT SU tra loi (response) yeu cau HTTP cua trinh duyet dang cho, thay vi tra loi
  // "200 OK" NGAY LAP TUC ngay khi VUA MO trang an (truoc day lam nhu vay - xem FIX ben duoi -
  // khien trinh duyet tuong da in xong trong khi thuc te lenh in van dang chay ngam trong 1 cua so
  // an khac, gay ra dung y het loi "cấp nhiều số tự động không đợi in xong đã sang số tiếp theo").
  reportFrameDone: (requestId, result) => ipcRenderer.send('print-frame-done', { requestId, result }),
  // MUC 106 - "kiểm tra chức năng máy quét ... mất form nhập liệu": TRUOC DAY main.js bao loi in
  // lang le qua dialog.showErrorBox() (hop thoai He dieu hanh cuop OS focus, treo vo thoi han tren
  // man hinh kiosk khong ai truc - xem ghi chu chi tiet trong printTicketSilently() cua main.js) -
  // NAY thay bang kenh IPC nay: main.js `win.webContents.send('print-error', message)` moi khi in
  // that bai, trang goi ham nay MOT LAN de dang ky lang nghe va tu hien 1 dong canh bao NHO/KHONG
  // CHAN gi tren chinh trang (xem showPrintErrorToast() trong public/kiosk/kiosk.js va
  // public/staff-kiosk/staff-kiosk.js) - khong con nguy co mat OS focus nua.
  onPrintError: (callback) => ipcRenderer.on('print-error', (_event, message) => callback(message)),
});
