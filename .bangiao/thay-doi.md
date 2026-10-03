# Thay đổi: Sidebar admin mở rộng khi hover/focus, nút ghim, chấm chưa đọc Hộp thư

Chỉ sửa client, không thêm thư viện, không sửa server, không commit.

## File đã thay đổi
- `client/src/api.js`: thêm `export` cho `storage` (dòng 3).
- `client/src/socket.js`: thêm hằng `INBOX_READ_EVENT = 'inbox:read'`.
- `client/src/components/Icons.jsx`: thêm icon `pin` vào `PATHS` (đặt ở đầu danh sách).
- `client/src/pages/Inbox.jsx`: import `INBOX_READ_EVENT`; sau khi `POST .../read` thành công thì `loadPages()` rồi phát event cửa sổ (để layout cập nhật chấm). Không sửa gì khác.
- `client/src/pages/AdminLayout.jsx`:
  - `PIN_KEY = 'admin_rail_pinned'`; mục Hộp thư trong `RAIL` thêm `badge: 'inbox'`.
  - Hook `useInboxUnread(enabled)`: gọi `/admin/inbox/pages`, nghe socket `conversation:update` và `INBOX_READ_EVENT` (debounce 1000ms), `reconnect` thì tải lại; không gọi API/không mở socket khi không có `inbox.view`.
  - State `pinned` (khởi tạo từ localStorage), `togglePin()` (ghim lưu `'1'`, bỏ ghim xoá key), class `pinned` trên `.mba`.
  - Dựng lại `<aside className="rail">` theo kế hoạch: `rail-panel`, `rail-head` + nút ghim, `rail-icon` + `rail-label`, chấm `rail-dot`; bỏ `title` ở các mục (giữ `aria-label`, nút ghim giữ `title`).
- `client/src/styles.css`: viết lại khối rail (panel 56px, mở rộng 240px đè lên khi hover/`:has(:focus-visible)`, trạng thái ghim đẩy cột lưới 240px, màu hover/active xám nhạt, chấm đỏ, ẩn nút ghim ở thiết bị không hover, reduced-motion, thanh ngang ≤760px, ngưỡng responsive của `.inbox` khi ghim).

## Kiểm tra đã chạy
- `cd client && npm run build`: thành công.
- `cd server && npm test`: 365 test, pass 365, fail 0.
- Chưa kiểm tra bằng trình duyệt (client chưa có hạ tầng test).

## Tester nên soi kỹ
1. Hover: mở sau ~150ms, đóng sau ~200ms, nội dung không dịch; thu gọn thì không lộ chữ/nút ghim.
2. Mục active (nền xám đậm hơn hover) kể cả AI Agent ở `/admin/settings`.
3. Tab vào rail thì mở rộng, tới được nút ghim; click chuột không làm panel kẹt mở.
4. Ghim: cột 240px đẩy nội dung, F5 vẫn giữ, key `admin_rail_pinned=1`, bỏ ghim thì key bị xoá. Ghim rồi thu ≤760px thì về thanh ngang, không nút ghim, không nhãn.
5. Hộp thư khi ghim ở ~1300px: `.inbox-side` ẩn, khung chat đủ rộng.
6. Chấm đỏ: hiện khi còn chưa đọc, tắt ~1s sau khi đọc hết, hiện lại khi có tin mới không cần F5; nhân viên giới hạn Page chỉ tính Page được giao; không có `inbox.view` thì không có request `/api/admin/inbox/pages`.
7. Modal (z-index 50) và widget chat (40) vẫn nằm trên rail (z-index 30); màn thấp thì panel cuộn dọc, `.rail-bottom` không mất.
8. Lưu ý: luật `.rail:has(:focus-visible)` đặt trong `@media (min-width: 761px)`, không giới hạn hover, nên trên cảm ứng >760px, bàn phím vẫn mở được rail.
