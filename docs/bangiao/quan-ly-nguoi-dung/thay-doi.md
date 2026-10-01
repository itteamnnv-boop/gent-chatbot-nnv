# Thay đổi: Quản lý người dùng và phân quyền theo chức năng

Triển khai đúng `ke-hoach.md` với toàn bộ phương án mặc định. Không commit, không đọc `server/.env`.
`cd server && npm test`: 29/29 xanh (gồm test cũ). `vite build` của client thành công.

## File TẠO MỚI

Server
- `server/src/permissions.js` — `ROLES`, `PERMISSIONS` (13 quyền), `PERMISSION_KEYS`, `effectivePermissions`, `hasPermission`.
- `server/src/utils/password.js` — băm/kiểm tra mật khẩu bằng scrypt (`node:crypto`), `isValidPassword` (8–128 ký tự).
- `server/src/models/User.js` — model User (`passwordHash` select:false, `tokenVersion`, toJSON ẩn hash).
- `server/src/services/userService.js` — `publicUser`, `userRow`, `ensureBootstrapAdmin`, `countOtherActiveAdmins`.
- `server/test/users.test.js` — test cho người dùng, đăng nhập, phân quyền, khoá, đổi mật khẩu, ràng buộc tự thao tác, staff có `users.manage`, kiểm tra đầu vào, không lộ `passwordHash`.

Client
- `client/src/permissions.js` — `can(me, key)`.
- `client/src/pages/Users.jsx` — trang Người dùng (theo cấu trúc `Products.jsx`, không thêm CSS).

## File SỬA

- `server/src/middleware/auth.js` — viết lại: `signUserToken`, `authenticateToken`, `requireAuth`, `requirePermission`. Token cũ (không có `uid`) bị coi là không hợp lệ.
- `server/src/routes/auth.js` — login kiểm tra DB (băm giả khi không có user, 401/403 theo kế hoạch); thêm `GET /me`.
- `server/src/routes/admin.js` — `requireAuth` + `requirePermission(<khoá>)` cho đủ 24 route hiện có; `req.admin.sub` thành `req.user.username`; thêm khối "Người dùng" (`GET /permissions`, CRUD `/users`) với các kiểm tra 1–8 theo thứ tự trong kế hoạch.
- `server/src/realtime.js` — `emitAdmin` phát theo room `perm:<quyền>` (bảng `EVENT_PERMISSIONS`); event lạ thì `console.warn` và không phát.
- `server/src/app.js` — socket dùng `authenticateToken`, join các room quyền; bỏ room `admin`.
- `server/src/index.js` — gọi `ensureBootstrapAdmin()` sau khối seed, chỉ log username.
- `client/src/api.js` — tự đăng xuất khi 401 ở `/auth/me`.
- `client/src/pages/AdminLayout.jsx` — tải `/auth/me`, lọc menu theo quyền, thêm mục Người dùng, `AiToggle` theo quyền, avatar theo tên, `Outlet context={{ me }}`.
- `client/src/App.jsx` — `RequirePermission` bọc các route; thêm route `users`.
- `client/src/pages/AgentHome.jsx`, `AgentInfo.jsx` — chỉ gọi API/hiện Playground khi đủ quyền.
- `client/src/pages/Inbox.jsx` — ẩn Tiếp quản/Trả lại AI và ô soạn tin khi thiếu `inbox.reply`.
- `client/src/pages/Orders.jsx` — `<select>` trạng thái bị khoá khi thiếu `orders.update`.
- `client/src/pages/Products.jsx` — ẩn Thêm/Sửa/Xoá khi thiếu `products.manage`.
- `README.md` — cập nhật 4 mục theo kế hoạch mục 5.

## Chỗ Tester nên soi kỹ

1. Test mới dùng `config.admin.username/password` để đăng nhập admin bootstrap (không hard-code `admin123`, vì `.env` có thể đặt khác).
2. `PUT /users/:id`: "tự thay đổi role/permissions/active" được so sánh với giá trị hiện tại, nên gửi lại đúng giá trị cũ cho chính mình vẫn qua. Kiểm tra thứ tự 400/403 khi vừa phạm quy tắc staff vừa phạm quy tắc tự thao tác.
3. Staff có `users.manage`: không được đặt/sửa/xoá admin (403); đổi vai trò admin sang staff do staff làm cũng bị 403.
4. Chốt an toàn "còn ít nhất một admin hoạt động" (xoá/khoá/hạ vai trò admin cuối). Test tự động chỉ phủ phần tự thao tác (400 nhờ quy tắc 7); đường `LAST_ADMIN` cần thử tay với 2 admin.
5. Khoá hoặc đổi mật khẩu có hiệu lực ngay ở request kế tiếp (đọc DB mỗi request); socket đang mở giữ room cũ tới khi tải lại (đúng câu 10).
6. Client: `AdminLayout` hiện "Đang tải..." mãi nếu `/auth/me` lỗi khác 401. `AgentInfo` vẫn gọi các API view; thiếu quyền thì thông báo 403 qua xử lý lỗi sẵn có (đúng kế hoạch, không sửa).
7. User chỉ có `orders.update` mà không có `orders.view` vẫn bị chặn `GET /orders` (không tự kéo theo quyền).
8. README: dòng cuối "Hướng mở rộng" (nhắc giỏ hàng bỏ dở, khảo sát sau mua) đã được thay bằng "Phân công hội thoại cho nhân viên." đúng chữ kế hoạch; nếu muốn giữ dòng cũ thì cần khôi phục.
9. Chưa chạy giao diện trên trình duyệt; chỉ kiểm tra build và test server.

## Vòng sửa 2

Sửa đúng 3 mục "Phải sửa" của `danh-gia.md`. Không làm các mục "Nên sửa". Không commit, không đọc `server/.env`.
`cd server && npm test`: 35/35 xanh. `vite build` của client thành công.

- `client/src/api.js` (dòng 47) — thêm ngoặc: `res.status === 401 && (path.startsWith('/admin') || path === '/auth/me')`. Trước đó `/auth/me` bị đăng xuất cả khi lỗi khác 401.
- `server/src/routes/admin.js` — `POST /users` và `PUT /users/:id`: nếu `data.active !== undefined && typeof data.active !== 'boolean'` thì trả 400 `'Trạng thái không hợp lệ'`. Ở PUT đặt ngay sau kiểm tra quyền (bước 5), trước khi tính `finalActive`; ở POST đặt sau kiểm tra quyền, trước kiểm tra staff. Chặn việc `Boolean("false") === true` làm lọt chốt tự khoá / admin cuối.
- `server/test/users-lastadmin.test.js` — thêm 1 ca: admin duy nhất gửi `{active: "false"}` vào chính mình nhận 400 và vẫn active trong DB; thêm POST với `active: "false"` nhận 400 và không tạo user.
- `README.md` (dòng 176–177) — khôi phục "- Nhắc giỏ hàng bị bỏ dở (trong khung 24h), khảo sát sau mua."; dòng 177 thành "- Phân công hội thoại cho nhân viên.". (Mục 8 phía trên về README nay đã được xử lý theo hướng giữ dòng cũ.)

Tester nên soi: thứ tự lỗi khi body PUT vừa có `active` sai kiểu vừa vi phạm quy tắc staff/tự thao tác (kiểu dữ liệu sai được trả 400 trước); `active` gửi `null` cũng bị 400.
