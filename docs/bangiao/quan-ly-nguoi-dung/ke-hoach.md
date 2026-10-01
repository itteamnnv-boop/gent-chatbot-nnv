# Kế hoạch: Quản lý người dùng và phân quyền theo chức năng

## ĐÃ CHỐT (2026-10-01)

Người dùng đã đồng ý **toàn bộ phương án mặc định (MĐ)** cho cả 11 câu bên dưới. Không còn câu hỏi bỏ ngỏ; coder triển khai đúng theo MĐ.

## Các câu hỏi đã được trả lời (giữ lại để tham khảo)

Kế hoạch bên dưới viết theo **phương án mặc định (MĐ)** của từng câu. Coder KHÔNG bắt đầu khi chưa có câu trả lời; nếu người dùng chọn khác MĐ thì sửa đúng mục ghi trong ngoặc trước.

1. **Mô hình phân quyền.** (A) Mỗi user có 1 vai trò `admin` (toàn quyền) hoặc `staff`; quyền của `staff` là danh sách tick chọn riêng cho từng user. (B) Có thêm "nhóm quyền" tạo được trong UI, user gán vào nhóm. MĐ = A. (Mục 2.1, 2.3, 3.6)
2. **Danh sách quyền và độ chi tiết.** MĐ = 13 quyền ở bảng 1.1 (mỗi module tách "xem" và "thao tác"). Cần xác nhận có cần chi tiết hơn không (ví dụ tách "huỷ đơn" khỏi "đổi trạng thái đơn", tách "bật/tắt AI" khỏi "sửa cấu hình agent"). (Mục 1.1)
3. **Nhân viên được cấp `users.manage` được làm tới đâu?** MĐ: chỉ quản lý được tài khoản `staff` — không được tạo/sửa/xoá tài khoản `admin`, không được đặt `role='admin'`. Phương án khác: `users.manage` chỉ dành cho `admin` (bỏ khỏi danh sách tick của staff). (Mục 2.7)
4. **Tài khoản `ADMIN_USERNAME`/`ADMIN_PASSWORD` trong `.env`.** MĐ: chỉ dùng để tạo user admin đầu tiên khi bảng User đang trống; sau đó đăng nhập chỉ kiểm tra DB, đổi `.env` không còn tác dụng. Phương án khác: giữ `.env` làm "siêu admin" luôn đăng nhập được. (Mục 2.4, 2.6, 2.9)
5. **Băm mật khẩu.** MĐ: `node:crypto` scrypt, không thêm thư viện. Phương án khác: thêm `bcrypt`/`argon2`. (Mục 2.2)
6. **Độ dài mật khẩu.** MĐ: tối thiểu 8, tối đa 128. (Mục 2.2, 2.7)
7. **User tự đổi mật khẩu của mình** (không cần `users.manage`). MĐ: KHÔNG làm; chỉ người có `users.manage` đặt lại mật khẩu trong trang Người dùng (kể cả mật khẩu của chính mình).
8. **Phân công hội thoại / nhân viên chỉ thấy hội thoại được giao.** MĐ: KHÔNG làm; ai có `inbox.view` thấy toàn bộ hộp thư.
9. **Xoá user.** MĐ: xoá cứng. Lịch sử cũ (`statusHistory.by`, tin hệ thống "Chuyển cho nhân viên (xxx)") vẫn giữ chuỗi username. Phương án khác: chỉ cho khoá, không cho xoá. (Mục 2.7, 3.6)
10. **Đổi quyền khi user đang mở realtime.** MĐ: REST có hiệu lực ngay; socket đang mở giữ room cũ tới khi tải lại trang. Có chấp nhận được không? (Mục 2.8)
11. **Nhật ký thao tác (audit log).** MĐ: KHÔNG làm.

---

## 0. Bối cảnh hiện tại (để coder khỏi phải tra)

- Server: Node ≥ 20, ESM, Express 5 (handler/middleware async ném lỗi được bắt tự động), Mongoose 9, `jsonwebtoken`, `express-rate-limit`. Test: `node:test` + `node:assert/strict`, MongoDB in-memory qua `connectDB('memory')` (`server/src/db.js`).
- Hiện chỉ có 1 tài khoản admin lấy từ `config.admin` (`server/src/config.js`). Đăng nhập ở `server/src/routes/auth.js`; JWT `{ sub: username, role: 'admin' }` hạn 12h ký trong `server/src/middleware/auth.js`.
- Mọi API quản trị nằm trong `server/src/routes/admin.js`, bảo vệ bằng `router.use(requireAdmin)`. `req.admin.sub` dùng ở 3 chỗ: `sendAgentMessage(...)`, `setConversationMode(...)`, `order.statusHistory.push({ status, by: req.admin.sub })`.
- Socket.IO (`server/src/app.js`): socket có token hợp lệ thì join room `'admin'`; `emitAdmin(event, payload)` trong `server/src/realtime.js` phát tới room đó. Event: `message:new`, `conversation:update`, `order:new` (từ `server/src/services/conversationService.js`), `order:update` (từ admin.js).
- Client: React 19 + react-router-dom; gọi API qua `api()` trong `client/src/api.js` (token ở localStorage key `admin_token`; 401 trên path `/admin...` thì xoá token và về `/admin/login`). Route ở `client/src/App.jsx`; khung + menu ở `client/src/pages/AdminLayout.jsx` (mảng `RAIL`, `AGENT_NAV`).
- KHÔNG đọc/sửa `server/.env`. Không có biến môi trường mới.

## 1. Danh mục quyền

### 1.1 Bảng quyền và API được bảo vệ (tiền tố `/api/admin`)

| Khoá | Nhãn UI | Nhóm | API yêu cầu quyền này |
|---|---|---|---|
| `stats.view` | Xem thống kê | Thống kê | `GET /stats` |
| `inbox.view` | Xem hộp thư | Hộp thư | `GET /conversations`, `GET /conversations/:id`, `POST /conversations/:id/read` |
| `inbox.reply` | Trả lời khách, tiếp quản / trả lại cho AI | Hộp thư | `POST /conversations/:id/messages`, `POST /conversations/:id/mode` |
| `orders.view` | Xem đơn hàng | Đơn hàng | `GET /orders` |
| `orders.update` | Đổi trạng thái / huỷ đơn | Đơn hàng | `PATCH /orders/:id` |
| `products.view` | Xem sản phẩm | Sản phẩm | `GET /products` |
| `products.manage` | Thêm / sửa / xoá / nhập bảng giá sản phẩm | Sản phẩm | `POST /products`, `PUT /products/:id`, `DELETE /products/:id`, `POST /products/import` |
| `knowledge.view` | Xem kho kiến thức & tài liệu | Kiến thức | `GET /knowledge`, `GET /sources` |
| `knowledge.manage` | Sửa kho kiến thức & tài liệu | Kiến thức | `POST /knowledge`, `PUT /knowledge/:id`, `DELETE /knowledge/:id`, `POST /sources`, `DELETE /sources/:name` |
| `settings.view` | Xem cấu hình AI Agent | AI Agent | `GET /settings` |
| `settings.manage` | Sửa cấu hình AI Agent, bật/tắt AI | AI Agent | `PUT /settings` |
| `playground.use` | Dùng Chat thử | AI Agent | `POST /playground/message`, `DELETE /playground/:sessionId` |
| `users.manage` | Quản lý người dùng & phân quyền | Hệ thống | `GET /permissions`, mọi route `/users...` (mục 2.7) |

- Mọi route trong admin.js đều phải có đúng 1 quyền theo bảng; không route nào chỉ có đăng nhập là đủ.
- Không có quyền tự kéo theo quyền khác (có `orders.update` mà thiếu `orders.view` thì vẫn bị chặn `GET /orders`). UI không tự tick kèm.
- Vai trò `admin` có toàn bộ quyền, bỏ qua mảng `permissions`.

## 2. Server

### 2.1 TẠO `server/src/permissions.js`

Quy ước hằng số export như `ORDER_STATUSES` trong `server/src/models/Order.js`.

```js
export const ROLES = ['admin', 'staff'];
export const PERMISSIONS = [{ key: 'stats.view', label: 'Xem thống kê', group: 'Thống kê' }, /* ... */]; // đúng 13 dòng, đúng thứ tự bảng 1.1
export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);
export function effectivePermissions(user) // null -> []; role 'admin' -> [...PERMISSION_KEYS]; staff -> user.permissions lọc chỉ giữ khoá thuộc PERMISSION_KEYS
export function hasPermission(user, key)   // effectivePermissions(user).includes(key)
```

### 2.2 TẠO `server/src/utils/password.js`

Quy ước hàm thuần, export có tên như `server/src/utils/text.js`.

```js
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export async function hashPassword(plain)           // -> 'scrypt$<saltHex>$<hashHex>'; salt 16 byte crypto.randomBytes; keylen 64; crypto.scrypt qua util.promisify
export async function verifyPassword(plain, stored) // -> boolean; stored rỗng/sai định dạng -> false (không ném); so sánh bằng crypto.timingSafeEqual
export function isValidPassword(plain)              // typeof plain === 'string' && PASSWORD_MIN <= length <= PASSWORD_MAX
```

### 2.3 TẠO `server/src/models/User.js`

Copy cấu trúc `server/src/models/Customer.js` (schema, `{ timestamps: true }`, `export const User = mongoose.model('User', userSchema)`).

- `username`: String, required, unique, trim, lowercase, `match: /^[a-z0-9._-]{3,32}$/`.
- `displayName`: String, default `''`, trim, `maxlength: 80`.
- `passwordHash`: String, required, `select: false`.
- `role`: String, `enum: ROLES`, default `'staff'`.
- `permissions`: `{ type: [String], enum: PERMISSION_KEYS, default: [] }`.
- `active`: Boolean, default `true`.
- `tokenVersion`: Number, default `0` (tăng khi đổi mật khẩu để vô hiệu token cũ).

Option schema thêm `toJSON: { transform: (_doc, ret) => { delete ret.passwordHash; delete ret.tokenVersion; return ret; } }`.

### 2.4 TẠO `server/src/services/userService.js`

```js
export function publicUser(user) // -> { _id, username, displayName, role, active, permissions: effectivePermissions(user) }  (dùng cho /auth/me và login)
export function userRow(user)    // -> { _id, username, displayName, role, active, permissions: user.permissions, createdAt, updatedAt }  (dùng cho trang Người dùng)
export async function ensureBootstrapAdmin() // nếu (await User.estimatedDocumentCount()) === 0: tạo { username: config.admin.username, displayName: 'Admin', role: 'admin', passwordHash: await hashPassword(config.admin.password) } và trả user; ngược lại trả null
export async function countOtherActiveAdmins(excludeId) // User.countDocuments({ role: 'admin', active: true, _id: { $ne: excludeId } })
```

### 2.5 SỬA `server/src/middleware/auth.js` (viết lại toàn bộ)

Xoá `signAdminToken`, `verifyAdminToken`, `requireAdmin`. Thay bằng:

```js
export function signUserToken(user) // jwt.sign({ sub: user.username, uid: String(user._id), tv: user.tokenVersion }, config.jwtSecret, { expiresIn: '12h' })
export async function authenticateToken(token) // jwt.verify lỗi -> null; uid không phải ObjectId hợp lệ -> null; User.findById(uid).lean(); null nếu không có, active=false, hoặc tokenVersion !== payload.tv; ngược lại trả user
export async function requireAuth(req, res, next) // tách token như code hiện tại; không hợp lệ -> 401 { error: 'Chưa đăng nhập hoặc phiên đã hết hạn' }; hợp lệ -> req.user = user; next()
export function requirePermission(key) // -> middleware: hasPermission(req.user, key) ? next() : 403 { error: 'Bạn không có quyền thực hiện chức năng này' }
```

Token cũ (không có `uid`) phải bị coi là không hợp lệ -> người đang đăng nhập bị đưa về trang đăng nhập một lần sau khi deploy. Đó là hành vi đúng.

### 2.6 SỬA `server/src/routes/auth.js`

- `POST /login` (giữ rateLimit hiện có):
  - `username = String(username).trim().toLowerCase()`; `User.findOne({ username }).select('+passwordHash')`.
  - Không có user: vẫn chạy `verifyPassword(password, DUMMY_HASH)` (DUMMY_HASH = `await hashPassword(...)` một lần ở top-level module) rồi trả 401 `'Sai tên đăng nhập hoặc mật khẩu'`.
  - Sai mật khẩu: 401, cùng thông báo trên.
  - Đúng mật khẩu nhưng `active=false`: 403 `'Tài khoản đã bị khoá'`.
  - Thành công: `{ token: signUserToken(user), username: user.username, user: publicUser(user) }`.
  - Xoá `safeEqual`, import `crypto`, `config` nếu không còn dùng.
- THÊM `router.get('/me', requireAuth, (req, res) => res.json(publicUser(req.user)))`.

### 2.7 SỬA `server/src/routes/admin.js`

1. Import `requireAuth, requirePermission` thay `requireAdmin`; `router.use(requireAuth)`.
2. Mỗi route hiện có thêm `requirePermission('<khoá>')` làm middleware đầu tiên (trước `validId`) theo bảng 1.1. Ví dụ: `router.patch('/orders/:id', requirePermission('orders.update'), validId, async (req, res) => {...})`.
3. Thay 3 chỗ `req.admin.sub` bằng `req.user.username`.
4. THÊM khối cuối file (trước `export default`), comment tiêu đề `// ---------- Người dùng ----------` như các khối khác. Mọi route có `requirePermission('users.manage')`; route có `:id` dùng `validId`, `notFound` sẵn có; lọc body bằng `pick` sẵn có với `USER_FIELDS = ['displayName', 'role', 'permissions', 'active']`.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/permissions` | – | `{ roles: ROLES, permissions: PERMISSIONS }` |
| GET | `/users` | – | mảng `userRow`, sort `createdAt: 1` |
| POST | `/users` | `username, displayName, password, role, permissions, active` | 201 `userRow` |
| PUT | `/users/:id` | `displayName, role, permissions, active, password` — đều tuỳ chọn; `username` bị bỏ qua | `userRow` |
| DELETE | `/users/:id` | – | `{ ok: true }` |

PUT: nếu `password` là chuỗi khác rỗng -> kiểm tra, hash mới, `tokenVersion += 1`. Chuỗi rỗng hoặc không gửi = giữ mật khẩu.

Kiểm tra bắt buộc, theo đúng thứ tự, trả 400 kèm `error` (trừ khi ghi khác):
1. (POST) `username` không khớp regex mục 2.3 sau khi trim + lowercase -> `'Tên đăng nhập 3–32 ký tự: chữ thường không dấu, số, dấu . _ -'`.
2. (POST) `User.exists({ username })` -> 409 `'Tên đăng nhập đã tồn tại'`.
3. (POST bắt buộc; PUT nếu có gửi) `!isValidPassword(password)` -> `` `Mật khẩu phải từ ${PASSWORD_MIN} đến ${PASSWORD_MAX} ký tự` ``.
4. `role` có gửi mà không thuộc `ROLES` -> `'Vai trò không hợp lệ'`.
5. `permissions` có gửi mà không phải mảng string hoặc có khoá ngoài `PERMISSION_KEYS` -> `'Quyền không hợp lệ'`. Loại trùng trước khi lưu. Nếu role sau cùng là `admin` thì lưu `permissions = []`.
6. Người thao tác là `staff` (MĐ câu hỏi 3): đặt `role='admin'`, hoặc PUT/DELETE vào user đang là admin -> 403 `'Chỉ quản trị viên mới thao tác được tài khoản quản trị'`.
7. Tự thao tác lên chính mình (`req.params.id === String(req.user._id)`): DELETE, hoặc PUT có thay đổi `role`, `permissions` hay `active` -> `'Không thể xoá, khoá hoặc đổi quyền tài khoản của chính bạn'`. (Tự đổi `displayName`, `password` được phép.)
8. Chốt an toàn: thao tác xoá / khoá / hạ `admin` -> `staff` nhắm vào một admin đang active mà `countOtherActiveAdmins(id) === 0` -> `'Phải còn ít nhất một quản trị viên đang hoạt động'`.

Response không bao giờ chứa `passwordHash` (luôn trả qua `userRow`).

### 2.8 SỬA `server/src/realtime.js` và `server/src/app.js` (realtime theo quyền)

`realtime.js` — giữ chữ ký `emitAdmin(event, payload)` (nơi gọi không phải sửa), thêm:

```js
const EVENT_PERMISSIONS = {
  'message:new': ['inbox.view'],
  'conversation:update': ['inbox.view'],
  'order:new': ['orders.view', 'inbox.view'],
  'order:update': ['orders.view', 'inbox.view'],
};
export const permissionRoom = (key) => `perm:${key}`;
```

`emitAdmin` phát `io?.to(EVENT_PERMISSIONS[event].map(permissionRoom)).emit(event, payload)` (Socket.IO tự gộp, mỗi socket nhận 1 lần). Event không có trong bảng -> không phát, `console.warn` một dòng.

`app.js` — import `authenticateToken` thay `verifyAdminToken`. Trong `io.on('connection', (socket) => {...})`: đăng ký handler `web:join` đồng bộ như cũ trước; sau đó `authenticateToken(socket.handshake.auth?.token).then((user) => { if (user) socket.join(effectivePermissions(user).map(permissionRoom)); }).catch(() => {})`. Bỏ room `'admin'`.

### 2.9 SỬA `server/src/index.js`

Sau khối seed in-memory, gọi `const bootstrap = await ensureBootstrapAdmin();` và nếu có thì `console.log(\`Đã tạo tài khoản quản trị đầu tiên: ${bootstrap.username}\`)`. Không log mật khẩu. `assertProductionConfig` giữ nguyên.

## 3. Client

### 3.1 TẠO `client/src/permissions.js`

Quy ước module tiện ích nhỏ như `client/src/format.js`.

```js
export function can(me, key) // !!me && Array.isArray(me.permissions) && me.permissions.includes(key)
```

### 3.2 SỬA `client/src/api.js`

Điều kiện tự đăng xuất khi 401 đổi thành `path.startsWith('/admin') || path === '/auth/me'`. Không đổi gì khác.

### 3.3 SỬA `client/src/pages/AdminLayout.jsx`

- State `me` (null khi đang tải); `useEffect` gọi `api('/auth/me').then(setMe).catch(() => {})`. Khi `me === null` render `<p className="muted pad">Đang tải...</p>` thay toàn bộ layout.
- Thêm thuộc tính `perm` cho mục menu, lọc bằng `!perm || can(me, perm)`:
  - `AGENT_NAV`: Trang chủ — không; Thông tin của bạn — `settings.view`; Hướng dẫn — `settings.view`; Chat thử — `playground.use`; Cài đặt — `settings.view`.
  - `RAIL`: AI Agent — không; Hộp thư — `inbox.view`; Đơn hàng — `orders.view`; Sản phẩm — `products.view`; Thống kê — `stats.view`; THÊM cuối mảng `{ to: '/admin/users', label: 'Người dùng', icon: 'person', perm: 'users.manage' }` (icon `person` đã có trong `client/src/components/Icons.jsx`).
  - `AGENT_PATHS` vẫn tính từ mảng `AGENT_NAV` gốc (chưa lọc).
- `AiToggle` nhận prop `me`: chỉ render khi `can(me, 'settings.view')`; switch `disabled={busy || !can(me, 'settings.manage')}`.
- `<Avatar name={me.displayName || me.username} size={32} />` thay `"Admin"`.
- Cả hai `<Outlet />` đổi thành `<Outlet context={{ me }} />`.

### 3.4 SỬA `client/src/App.jsx`

Thêm component cục bộ cạnh `RequireAuth`:

```jsx
function RequirePermission({ perm, children }) {
  const { me } = useOutletContext();
  return can(me, perm) ? children : <p className="error">Bạn không có quyền truy cập chức năng này.</p>;
}
```

Bọc route: `info`, `guidance`, `settings` -> `settings.view`; `playground` -> `playground.use`; `inbox` -> `inbox.view`; `orders` -> `orders.view`; `products` -> `products.view`; `stats` -> `stats.view`. THÊM `<Route path="users" element={<RequirePermission perm="users.manage"><Users /></RequirePermission>} />`. Route `index` và redirect `knowledge` không bọc.

### 3.5 Ẩn thao tác trong trang có sẵn (lấy `me` bằng `useOutletContext()` của react-router-dom)

- `client/src/pages/AgentHome.jsx`: chỉ gọi `/admin/stats` (kể cả interval 30s) khi `can(me,'stats.view')`; chỉ gọi `/admin/settings` khi `can(me,'settings.view')`; chỉ render `<Playground />` khi `can(me,'playground.use')`.
- `client/src/pages/AgentInfo.jsx`: chỉ render `<Playground />` khi `can(me,'playground.use')`. Các nút sửa trong trang này giữ nguyên; thiếu quyền thì server trả 403 và thông báo hiện qua xử lý lỗi sẵn có.
- `client/src/pages/Inbox.jsx`: khi `!can(me,'inbox.reply')` không render nút "Tiếp quản"/"Trả lại cho AI" và không render `<form className="composer">`.
- `client/src/pages/Orders.jsx`: `<select>` trạng thái `disabled={o.status === 'cancelled' || !can(me,'orders.update')}`.
- `client/src/pages/Products.jsx`: khi `!can(me,'products.manage')` ẩn nút "+ Thêm sản phẩm" và các nút Sửa/Xoá.

### 3.6 TẠO `client/src/pages/Users.jsx`

Copy NGUYÊN cấu trúc và class CSS của `client/src/pages/Products.jsx` (`load()`, `save()`, `remove()`, `page-head`, `page-title`, `card table-wrap`, `Modal` + `form-grid`, `span-2`, `form-actions`, `label.check`, `badge badge-ok`, `btn-ghost danger`). Không thêm CSS mới.

- Tải `api('/admin/users')` và `api('/admin/permissions')`. Lấy `me` từ `useOutletContext()`.
- Tiêu đề "Người dùng"; nút "+ Thêm người dùng".
- Cột bảng: Tên đăng nhập | Tên hiển thị | Vai trò ("Quản trị viên" / "Nhân viên") | Trạng thái (`badge badge-ok` "Đang hoạt động" / `badge` "Đã khoá") | nút Sửa / Xoá. Dòng của chính mình (`u._id === me._id`) không có nút Xoá. Nếu `me.role === 'staff'` thì dòng có `role === 'admin'` không có nút Sửa/Xoá.
- Modal:
  - Tên đăng nhập (`required`; `disabled` khi sửa).
  - Tên hiển thị.
  - Mật khẩu `type="password"` `autoComplete="new-password"`: khi tạo `required minLength={8}`; khi sửa nhãn "Mật khẩu mới (để trống nếu không đổi)". Không điền sẵn.
  - Vai trò `<select>` Quản trị viên / Nhân viên; nếu `me.role === 'staff'` chỉ có option Nhân viên. Khi đang sửa chính mình: `disabled`.
  - Vai trò `staff`: checkbox `label.check` cho từng quyền, gom theo `group` (tiêu đề nhóm `<strong>`), thứ tự theo `/admin/permissions`; khi sửa chính mình: `disabled`. Vai trò `admin`: thay bằng `<p className="muted span-2">Quản trị viên có toàn bộ quyền.</p>`.
  - Checkbox "Đang hoạt động"; khi sửa chính mình: `disabled`.
- Payload: khi sửa mà mật khẩu rỗng thì không gửi `password`; khi sửa chính mình không gửi `role`, `permissions`, `active`. Lỗi server hiển thị `<p className="error span-2">` như Products.
- Xoá: `window.confirm(\`Xoá người dùng "${u.username}"?\`)`.

## 4. Test

TẠO `server/test/users.test.js`. Copy khung `server/test/agent.test.js` (`describe/it/before/after` từ `node:test`, `assert/strict`, `before: connectDB('memory')`, `after: disconnectDB`). Không có supertest: `const { server, io } = createApp()` từ `server/src/app.js`, `server.listen(0)`, cổng từ `server.address().port`, gọi bằng `fetch` toàn cục; trong `after` gọi `io.close()` rồi `disconnectDB()`. Tạo user test bằng `User.create({ ..., passwordHash: await hashPassword('...') })`. Không thêm dependency.

Ca bắt buộc:
1. `hashPassword`/`verifyPassword`: đúng -> true; sai -> false; chuỗi lưu sai định dạng -> false.
2. `ensureBootstrapAdmin`: DB trống -> tạo 1 admin; gọi lần 2 -> `null`.
3. Login: đúng -> 200 có `token`, `user.permissions` của admin đủ 13 khoá; sai mật khẩu -> 401; username không tồn tại -> 401 cùng thông báo; user bị khoá, đúng mật khẩu -> 403.
4. Không token / token rác -> 401 ở `GET /api/admin/orders`.
5. Staff chỉ có `orders.view`: `GET /api/admin/orders` 200; `PATCH /api/admin/orders/<ObjectId hợp lệ bất kỳ>` 403; `GET /api/admin/users` 403.
6. Admin khoá staff -> token cũ của staff bị 401 ở request kế tiếp.
7. Admin đổi mật khẩu staff -> token cũ 401; đăng nhập bằng mật khẩu mới 200.
8. Admin tự xoá mình -> 400; admin tự gửi PUT `role: 'staff'` -> 400.
9. Staff có `users.manage`: tạo user `role: 'admin'` -> 403; PUT vào admin -> 403; tự thêm quyền cho mình -> 400.
10. Username trùng -> 409; quyền `'foo.bar'` -> 400; mật khẩu 7 ký tự -> 400.
11. Không response nào từ `/api/admin/users` chứa khoá `passwordHash`.

`cd server && npm test`: các test cũ (`agent.test.js`, `meta.test.js`, `infoImport.test.js`) phải vẫn xanh.

## 5. Tài liệu — SỬA `README.md`

- Bảng "API chính": thêm `GET /api/auth/me`, `GET /api/admin/permissions`, `CRUD /api/admin/users`.
- Mục "Trang quản trị": thêm gạch đầu dòng **Người dùng** (tạo tài khoản, vai trò Quản trị viên / Nhân viên, tick quyền từng chức năng).
- Câu "mặc định `admin` / `admin123`": thêm "chỉ dùng để tạo tài khoản quản trị đầu tiên khi DB chưa có người dùng".
- Mục "Hướng mở rộng": dòng cuối đổi thành "Phân công hội thoại cho nhân viên."

## 6. Ngoài phạm vi (KHÔNG làm)

Nhóm quyền tuỳ biến, tự đổi mật khẩu ngoài trang Người dùng, phân công hội thoại, audit log, quên mật khẩu, đổi username, CSS mới, thư viện mới.
