# Kết quả kiểm thử: Sidebar admin mở rộng khi hover/focus, nút ghim, chấm chưa đọc Hộp thư

Người kiểm thử chỉ tạo file test và file này. Không sửa code sản phẩm, không commit.

## Kết luận: CÓ 1 LỖI THẬT (giao diện điện thoại) và 1 lỗi nhỏ (rò listener). Dây chuyền DỪNG cho Reviewer.

Test tự động: tất cả xanh. Lỗi nằm ở CSS và hook, không có test tự động nào của repo bắt được (client không có hạ tầng test), nên được ghi ở đây dưới dạng phát hiện.

## 1. Lệnh đã chạy
- `cd client && npm run build`: thành công (`✓ built in 168ms`, CSS 31.22 kB, JS 399.60 kB).
- `cd server && npm test`: tests 365, pass 365, fail 0 (47.8 giây).
- Test mới `server/test/inboxDot.test.js` chạy riêng: tests 5, pass 5, fail 0. Nó được thêm sau lần chạy toàn bộ nên tổng khi chạy lại sẽ là 370.

## 2. Test server mới: nguồn dữ liệu chấm đỏ
File: `server/test/inboxDot.test.js` (client giả, không gọi OpenAI, không gọi mạng ngoài). Dùng đúng công thức của hook: `otherUnread > 0 || pages.some((p) => p.unread > 0)`.

Đã có sẵn từ trước (đã kiểm tra, không viết lại): `server/test/inboxPages.test.js`, `inboxScope.test.js`, `inboxScopeLeak.test.js` kiểm `/inbox/pages` về 401/403/200, đếm unread theo Page, `otherUnread`, không lộ token, nhân viên giới hạn Page. Phần còn thiếu là kiểm theo hành vi "có chấm hay không", nên bổ sung:
- Đường thuận lợi: Page được giao có chưa đọc thì có chấm; đọc hết thì tắt.
- Biên: chưa đọc chỉ ở Page 222, web và hội thoại `test` thì nhân viên chỉ Page 111 không có chấm.
- Biên: nhân viên có "ngoài Fanpage" thì web chưa đọc bật chấm, Page 222 vẫn không tính.
- Admin không giới hạn: chưa đọc ở Page nào cũng bật chấm.
- Phải thất bại: không có `inbox.view` thì 403 và không có `pages`; không token thì 401.

## 3. Rà tĩnh (đã đọc `AdminLayout.jsx`, `styles.css`, `Inbox.jsx`, `socket.js`, `api.js`)

Đạt:
- Luật hooks: `useState` cho `pinned` và `useInboxUnread` đều đặt TRƯỚC `if (!me) return`. `can(null, ...)` trả `false` an toàn (`!!me && ...`).
- Không có `inbox.view`: effect trả sớm, không gọi API, không mở socket.
- Cleanup: `alive = false`, `clearTimeout`, `socket.disconnect()`, `removeEventListener` có đủ. `load` có `.catch(() => {})` giữ giá trị cũ; `setUnread` chỉ khi `alive`. Debounce 1000ms đúng.
- localStorage: `storage.get/set` trong `api.js` bọc try/catch. Ghim lưu `'1'`, bỏ ghim `set(key, null)` (xoá key).
- Nút ghim: `aria-pressed`, `aria-label="Ghim thanh bên"` cố định, `title` đổi theo trạng thái. Các mục rail không còn `title` (chỉ còn `title` ở `Avatar` cho chấm kênh, không liên quan rail). Mục Hộp thư đổi `aria-label` khi có chấm.
- CSS: luật `:hover` nằm trong `@media (hover: hover) and (min-width: 761px)`; luật ghim cùng khối đó và đặt sau luật hover nên thắng (cùng specificity). `@media (max-width: 760px)` không bị `.mba.pinned` đè vì ghim có `min-width: 761px`. `prefers-reduced-motion` đặt `transition-duration: 0s` (delay giữ). `@media (hover: none) { .rail-pin { display: none; } }` có.
- z-index: `.rail` 30 < `.cw` 40 < `.modal-backdrop` 50. Các z-index khác trong nội dung (1) thấp hơn rail.
- Tương phản: chữ `#1c2b33` trên nền xám 12% (~#e3e6e8) hơn 10:1; active (0.12) đậm hơn hover (0.06), active:hover 0.16.
- Đo thật bằng Chrome headless (trang HTML dựng lại khối rail, dùng CSS đã build, 12 mục): ở viewport 784px, panel rộng 56px, không tràn ngang (docScrollW 769), mục rộng 39 đến 40px.

### LỖI 1 (thật, mức vừa): thanh ngang ≤760px bị tràn ngang, mục cuối (Đăng xuất, avatar) nằm ngoài màn hình
- Bằng chứng đo trên Chrome headless (cửa sổ tối thiểu của headless là 500px, nên 375px còn tệ hơn): `{"vw":500,"docScrollW":582,"lastRight":570,"panelW":582,"panelH":53,"minW":"40,...,40"}`. Nghĩa là thanh rộng 582px trong cửa sổ 500px, mục cuối kết thúc ở x=570 > 500.
- Nguyên nhân (suy ra từ CSS): `.rail-item, .rail-row` có `flex: none; width: 40px` (kể cả ở khối ≤760px: `width: 40px`), `.rail-panel` ≤760px là `flex-direction: row; overflow: visible` không `flex-wrap`. Tài khoản đủ quyền có 8 mục nav + 2 mục bottom + head + user = 12 ô × 40px + khoảng cách ≈ 560 đến 580px, lớn hơn bề rộng điện thoại (360 đến 430px). CSS cũ (HEAD) cho `.rail-item` co được (không `flex: none`) nên vừa màn hình.
- Hồi quy so với bản trước. Gợi ý cho Reviewer/Coder (không sửa ở đây): cho thanh ngang `flex-wrap: wrap` hoặc `overflow-x: auto`, hoặc để mục co được ở ≤760px.
- Mức độ: chỉ ảnh hưởng điện thoại và cửa sổ hẹp; admin trên máy tính không thấy.

### LỖI 2 (nhỏ): hook không gỡ listener `reconnect` khi unmount
- `socket.io.on('reconnect', load)` (AdminLayout.jsx dòng 97) không có `socket.io.off('reconnect', load)` trong cleanup. `socket.disconnect()` chỉ ngắt socket, listener nằm trên Manager. Khi Manager được tái sử dụng từ cache (lần mount sau, ví dụ đăng xuất rồi đăng nhập), `load` cũ còn nằm đó và gọi thêm API mỗi lần reconnect. `alive=false` nên không `setState` sau unmount, chỉ thừa request. Đây là suy luận từ cách socket.io-client dùng lại Manager, chưa chạy thực tế.

## 4. Không kiểm tự động được: cần kiểm bằng mắt
Playwright/puppeteer/jsdom/vitest/testing-library không có trong `client/node_modules`, `server/node_modules` hay thư mục gốc. Có Chrome cài sẵn nhưng chỉ dùng được để đo layout tĩnh như trên, chưa mô phỏng được hover/focus/đăng nhập.

Cần người kiểm bằng trình duyệt:
1. Hover mở sau ~150ms, đóng sau ~200ms, nội dung không dịch; thu gọn không lộ chữ hay nút ghim.
2. Mục active nền xám đậm hơn hover, kể cả AI Agent ở `/admin/settings`.
3. Tab vào rail thì mở rộng, tới được nút ghim; click chuột không làm panel kẹt mở.
4. Ghim: cột 240px đẩy nội dung, F5 giữ nguyên, key `admin_rail_pinned=1`, bỏ ghim thì key biến mất; chặn localStorage thì không lỗi.
5. Hộp thư khi ghim ở ~1300px: `.inbox-side` ẩn, khung chat đủ rộng.
6. Chấm đỏ thời gian thực: tắt ~1s sau khi đọc hết, hiện lại khi có tin mới không cần F5; tài khoản không có `inbox.view` thì tab Network không có `/api/admin/inbox/pages`.
7. Modal và widget chat nằm trên rail; màn thấp thì panel cuộn dọc, `.rail-bottom` không mất.
8. Thanh ngang ≤760px (sau khi Coder xử lý Lỗi 1): kiểm lại bằng Device Toolbar 375px.
9. Lưu ý đã ghi ở thay-doi.md: `.rail:has(:focus-visible)` không giới hạn hover, trên cảm ứng >760px bàn phím vẫn mở được rail. Đây là hành vi đã chủ ý.
