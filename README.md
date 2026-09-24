# Widget Quầy Tiếp Nhận (ứng dụng desktop)

Ứng dụng desktop nhỏ gọn, **luôn nổi bên trên** mọi cửa sổ khác, hiển thị mã quầy, số thứ tự (STT)
đang phục vụ, 3 nút 📢 Gọi tiếp theo / 🔁 Gọi lại / ⏭️ Bỏ qua, và số lượng hàng chờ theo từng đối
tượng ưu tiên — dùng để cài trên máy tính của nhân viên tiếp nhận, hỗ trợ song song với phần mềm
khác (HIS, Excel...) mà không cần mở hẳn trình duyệt.

Ứng dụng này là 1 client kết nối tới **máy chủ của Hệ thống bắt số** (dự án Node.js riêng, chạy
lệnh `npm start` trên máy chủ). Máy chủ phải đang chạy thì widget mới hoạt động được.

## 1. Cài đặt (máy đã có Node.js ≥ 18)

```bash
npm install
npm start
```

Lần đầu mở, widget sẽ hiện "Chưa chọn quầy trực" — bấm nút **⚙️** để mở cửa sổ quản lý đầy đủ,
đăng nhập bằng mật khẩu nhân viên rồi chọn quầy/bắt đầu ca trực. Widget sẽ **tự nhận biết ngay**
sau đó, không cần khởi động lại ứng dụng.

## 2. Đổi địa chỉ máy chủ

Mặc định ứng dụng kết nối tới `http://localhost:4000` (máy chủ chạy cùng máy). Nếu máy chủ nằm
trên **máy khác** trong cùng mạng LAN:

- Chuột phải vào **icon khay hệ thống** (system tray, góc dưới-phải màn hình Windows) →
  **"🌐 Đổi địa chỉ máy chủ..."** → nhập địa chỉ IP LAN của máy chủ, ví dụ `http://192.168.1.23:4000`
  (lấy địa chỉ này ở trang chủ hệ thống trên máy chủ → "🌐 Hiện địa chỉ mạng").
- Ứng dụng tự tải lại sau khi lưu. Cấu hình được lưu riêng cho từng máy, không ảnh hưởng máy khác.

## 3. Đóng gói thành file cài đặt Windows (.exe)

Chạy trên máy Windows (không cần cài Node.js trên các máy sẽ cài ứng dụng sau khi đã có file cài):

```bash
npm install
npm run build:win        # tạo bộ cài .exe (NSIS) + bản portable trong dist/
```

Sau khi cài, ứng dụng có tên **"Widget Quầy Tiếp Nhận"** trong Start Menu.

## 4. Các tính năng trong menu khay hệ thống (chuột phải vào icon tray)

- **🖥️ Mở màn hình quản lý** — mở cửa sổ đầy đủ để đăng nhập/chọn quầy/đổi thứ tự ưu tiên...
- **👁️ Hiện / Ẩn widget** — ẩn nhanh khi không cần, không tắt hẳn ứng dụng.
- **📌 Luôn nổi bên trên** (bật/tắt, mặc định bật).
- **🚀 Khởi động cùng Windows** (bật/tắt, mặc định bật) — dùng API chính thức của Windows, không
  cần tự tạo shortcut trong thư mục Startup.
- **🖥️ Tự động mở kiosk bốc số khi khởi động** (bật/tắt, mặc định TẮT) — bật để mỗi lần ứng dụng
  khởi động (thường dùng chung với "Khởi động cùng Windows" ở trên) sẽ tự động mở toàn màn hình
  (fullscreen) màn hình "Kiosk bốc số – Bệnh nhân" (/kiosk) ngay, không cần nhân viên tự mở qua menu
  này mỗi lần bật máy — phù hợp máy đặt cố định ở quầy/sảnh chỉ dùng để bốc số. Bấm tích/bỏ tích sẽ
  mở/đóng kiosk ngay lập tức để thấy hiệu ứng rõ ràng, không cần khởi động lại ứng dụng.
- **🌐 Đổi địa chỉ máy chủ...**
- **Thoát** — tắt hẳn ứng dụng (đóng widget bằng cách kéo/ẩn không làm thoát hẳn, phải bấm mục này).

## 5. Thay icon riêng của đơn vị

Thay file `assets/icon.png` (khuyến nghị 256x256, nền trong suốt) bằng logo riêng trước khi chạy
`npm run build:win`. File `assets/generate-icon.js` chỉ là script tạo icon mẫu ban đầu, không bắt
buộc phải dùng lại.

## 6. Phát hành lên GitHub Release bằng `build-and-publish.bat`

Theo đúng mẫu `build-and-publish.bat` của đơn vị (thay cho `publish.bat` bản trước):

1. Tạo repo GitHub cho widget, sửa `package.json` → `build.publish[0].owner` / `repo`
   (`"releaseType": "release"` = công khai ngay, không để nháp).
2. Tăng `"version"` trong `package.json`.
3. Nhấp đúp `build-and-publish.bat` → nhập `GH_TOKEN` (ẩn ký tự, hoặc đặt sẵn biến môi trường) → **Y**.

Script: `npm ci` → kiểm tra cú pháp `main.js`, `preload.js`, `config.js` + `assets\icon.png` →
`electron-builder --win --publish always`. Release `vX.Y.Z` gồm:
- `QuayTiepNhan-Widget-Setup-X.Y.Z.exe` — **bộ cài gộp 32-bit + 64-bit** (tự chọn theo Windows từng máy)
- `QuayTiepNhan-Widget-Portable-X.Y.Z.exe` — bản chạy ngay 64-bit
- `latest.yml` + `.blockmap` (sẵn sàng nếu sau này bật tự cập nhật bằng electron-updater)

## 7. Hộp thoại không cướp focus (từ bản có mục 111 của server)

Widget không còn dùng hộp thoại native (`alert`/`confirm`/`dialog.showMessageBox`). Trang web gọi
`widgetBridge.showDialog()` khi cửa sổ quá nhỏ; `main.js` mở cửa sổ hộp thoại riêng (`showAppDialog()`)
và trả focus về cửa sổ gốc khi đóng. Cần cập nhật **cả server và widget** để hết lỗi hoàn toàn.

## 8. Tự động cập nhật (từ bản có mục 117 của server)

- Widget tự kiểm tra GitHub Release (repo trong `build.publish` của `package.json`) 1 phút sau khi mở rồi
  mỗi 4 giờ, có bản mới thì tải ngầm; tải xong báo bằng thông báo Windows + mục khay hệ thống
  **"⬆ Cập nhật lên vX (khởi động lại)"**. Không bấm thì tự cài khi thoát ứng dụng.
- Khay hệ thống → **"Kiểm tra cập nhật (đang dùng vX)"** để kiểm tra ngay.
- Bản portable không tự cài được: chỉ báo có bản mới và mở trang tải về.
- Repo widget nên để public. Máy đang dùng bản cũ (chưa có tính năng này) cần cài tay bản mới 1 lần.
- Mã: `updater.js` (+ vài dòng trong `main.js`, `preload.js`), thư viện `electron-updater`.
