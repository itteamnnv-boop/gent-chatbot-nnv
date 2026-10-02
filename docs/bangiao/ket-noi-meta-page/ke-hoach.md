# Kế hoạch: Kết nối Meta App để chọn Facebook Page và lấy Page Access Token

## ĐÃ CHỐT (2026-10-01)

Người dùng đã đồng ý **toàn bộ phương án mặc định (MĐ)** cho cả 9 câu bên dưới. Không còn câu hỏi bỏ ngỏ; coder triển khai đúng theo MĐ.

## Các câu hỏi đã được trả lời (giữ lại để tham khảo)

Kế hoạch dưới đây viết theo **phương án mặc định (MĐ)** của từng câu. **Coder KHÔNG bắt đầu khi người dùng chưa trả lời.** Nếu người dùng chọn khác MĐ thì phải sửa đúng các mục ghi trong ngoặc trước khi làm.

1. **Cách đăng nhập Facebook.** MĐ: dùng luồng OAuth chuyển hướng phía server (Facebook Login "manual flow"). Không dùng Facebook JS SDK, nên không phải nới CSP của helmet. Phương án khác: (B) JS SDK `FB.login` dạng popup, phải sửa CSP trong `server/src/app.js`; (C) "Facebook Login for Business" có `config_id`, cần biến môi trường mới. (Mục 1, 2.1, 2.4)
2. **Kênh áp dụng.** MĐ: chỉ áp dụng cho **Messenger**. Instagram vẫn dùng `META_PAGE_ACCESS_TOKEN` trong `.env` như hiện nay, WhatsApp giữ nguyên. Nếu muốn có cả Instagram thì phải xin thêm quyền `instagram_basic` và `instagram_manage_messages`, lưu thêm `instagram_business_account`, và ánh xạ ID tài khoản IG sang Page. (Mục 2.4, 2.6)
3. **Quyền mới.** MĐ: thêm 2 khoá theo cặp xem/thao tác như các module khác: `channels.view` "Xem các Facebook Page đã kết nối" và `channels.manage` "Kết nối / ngắt kết nối Facebook Page", cùng nhóm "Kênh kết nối". Phương án khác: gộp vào quyền `settings.view` / `settings.manage` đang có. (Mục 2.2, 2.7, 3, 4)
4. **Giữ `META_PAGE_ACCESS_TOKEN` trong `.env` làm token dự phòng không?** MĐ: CÓ. Nếu hội thoại không có `pageId`, hoặc Page của hội thoại chưa kết nối hay đang ở trạng thái `invalid`, thì dùng token trong `.env` (nếu có). Như vậy các hội thoại cũ và Instagram không bị gãy. Phương án khác: bỏ hẳn biến này. (Mục 2.4 `resolvePageToken`)
5. **Lưu Page Access Token.** MĐ: lưu nguyên văn trong MongoDB, đặt `select: false`, và không bao giờ trả token qua API (làm giống `passwordHash` trong `server/src/models/User.js`). Phương án khác: mã hoá AES-256-GCM, cần thêm biến môi trường khoá mã hoá. (Mục 2.3)
6. **Danh sách quyền (scope) xin Facebook.** MĐ: `pages_show_list,pages_messaging,pages_manage_metadata`. Cần xác nhận có Page nào thuộc Business Manager không. Nếu có, thường phải thêm `business_management` thì `/me/accounts` mới trả về đủ Page. (Mục 2.1 `META_OAUTH_SCOPES`)
7. **Chọn Page sau khi đăng nhập.** MĐ: làm 2 bước. Facebook trả về danh sách Page, sau đó người dùng tick chọn trong giao diện của mình rồi mới lưu. Phương án khác: tự lưu tất cả Page mà Facebook trả về. (Mục 2.4, 2.7, 3.3)
8. **Tự đăng ký webhook cho Page** (`POST /{page-id}/subscribed_apps` với `messages,messaging_postbacks`). MĐ: CÓ, làm ngay khi kết nối. Page nào đăng ký thất bại thì KHÔNG lưu và báo lỗi riêng cho Page đó. Phương án khác: vẫn lưu và chỉ hiện cảnh báo. (Mục 2.4 `connectPages`)
9. **Nhiều tiến trình server.** MĐ: lưu phiên OAuth (state và danh sách Page chờ chọn) trong bộ nhớ, hết hạn sau 10 phút. Cách này giống khoá hội thoại hiện có, và README đã ghi rõ hệ thống chạy 1 tiến trình. Nếu restart giữa chừng, người dùng phải bấm kết nối lại. Phương án khác: lưu vào MongoDB có TTL index. (Mục 2.4)

---

## 0. Bối cảnh hiện tại (coder không cần tra lại)

- Server dùng Node ≥ 20, ESM, Express 5 (handler async ném lỗi thì được bắt tự động), Mongoose 9. Gọi Graph API bằng `fetch` toàn cục, không có SDK. **Không thêm dependency.**
- Token hiện lấy từ **một nguồn duy nhất** là `config.meta.pageAccessToken` (biến `META_PAGE_ACCESS_TOKEN`, xem `server/src/config.js`). Token này được dùng trong `sendMessengerText` / `sendMessengerTyping` ở `server/src/channels/meta.js`, cho cả Messenger lẫn Instagram. Vì chỉ có một token nên hiện chỉ phục vụ được một Page.
- Luồng nhận tin: `POST /webhook/meta` (`server/src/routes/webhook.js`) → `parseMetaWebhook(body)` → `handleIncomingMessage({channel, externalId, text, externalMessageId, profileName})` (`server/src/services/conversationService.js`).
- Luồng gửi tin: `sendOutbound` → `deliver(conversation.channel, conversation.externalId, text)` (`server/src/channels/index.js`). Có thêm `showTyping(channel, externalId)`. Nếu `deliver` lỗi thì hội thoại được gắn `needsAttention: true`.
- Hiện **không lưu Page ID** ở đâu cả. `parseMetaWebhook` bỏ qua `entry.id` (chính là Page ID). `Conversation` và `Customer` khoá theo `{channel, externalId}`.
- Phân quyền: `server/src/permissions.js` (mảng `PERMISSIONS`), `requireAuth` + `requirePermission(key)` ở `server/src/middleware/auth.js`. Mọi route trong `server/src/routes/admin.js` đều có đúng một `requirePermission`. Client có `can(me, key)` ở `client/src/permissions.js`. Menu dùng mảng `RAIL` trong `client/src/pages/AdminLayout.jsx`, route khai báo ở `client/src/App.jsx` và bọc bằng `RequirePermission`.
- `server/src/app.js`: SPA fallback loại trừ các path `/api`, `/webhook`, `/socket.io`. Vite dev proxy `/api` sang cổng 4000 (`client/vite.config.js`).
- KHÔNG đọc hay sửa `server/.env`.

## 1. Luồng tổng thể (MĐ câu 1, 7, 8)

1. Người có `channels.manage` bấm "Kết nối Facebook". Client gọi `POST /api/admin/meta/oauth/start` và nhận `{ url }`, rồi chạy `window.location.assign(url)`.
2. Người dùng đăng nhập Facebook và cấp quyền. Facebook chuyển hướng về `GET /api/meta/oauth/callback?code=…&state=…` (route công khai, không có JWT, xác thực bằng `state`).
3. Server làm lần lượt: đổi `code` lấy user token ngắn hạn, đổi tiếp sang user token dài hạn, rồi gọi `/me/accounts` để lấy danh sách Page kèm Page token. Page token lấy từ user token dài hạn sẽ không hết hạn. Server lưu danh sách vào phiên chờ trong bộ nhớ, sau đó trả `302 Location: /admin/channels?session=<id>`. Location là đường dẫn tương đối, để chạy đúng cả khi dev (5173) lẫn prod.
4. Trang `/admin/channels` thấy `?session=` thì gọi `GET /api/admin/meta/oauth/sessions/:id` để hiện danh sách Page cho người dùng tick chọn, rồi gọi `POST /api/admin/meta/pages`. Server đăng ký webhook cho từng Page và lưu `MetaPage`.
5. Khi webhook có tin vào, server lưu `pageId = entry.id` lên hội thoại. Khi gửi tin, server lấy token theo `conversation.pageId`.

## 2. Server

### 2.1 SỬA `server/src/config.js` và `server/.env.example`

Thêm vào `config.meta`:
```js
appId: env.META_APP_ID || '',
oauthRedirectUri: env.META_OAUTH_REDIRECT_URI || '',
```
Thêm vào `server/.env.example`, ngay dưới dòng `META_APP_SECRET=`:
```
# App ID của Meta App (dùng cho nút "Kết nối Facebook" trong trang quản trị)
META_APP_ID=
# URL callback OAuth, phải khai báo y hệt trong Facebook Login > Valid OAuth Redirect URIs
# vd: https://<domain>/api/meta/oauth/callback  (dev: http://localhost:5173/api/meta/oauth/callback)
META_OAUTH_REDIRECT_URI=
```
Không sửa `assertProductionConfig`, vì tính năng này là tuỳ chọn.

### 2.2 SỬA `server/src/permissions.js` (MĐ câu 3)

Chèn 2 dòng vào **trước** dòng `users.manage`:
```js
{ key: 'channels.view', label: 'Xem các Facebook Page đã kết nối', group: 'Kênh kết nối' },
{ key: 'channels.manage', label: 'Kết nối / ngắt kết nối Facebook Page', group: 'Kênh kết nối' },
```
Tổng số quyền sẽ thành 15.

### 2.3 TẠO `server/src/models/MetaPage.js`

Copy cấu trúc từ `server/src/models/User.js` (schema, `{ timestamps: true }`, `toJSON.transform`).

- `pageId`: String, required, unique, `match: /^\d{1,32}$/`.
- `name`: String, default `''`.
- `accessToken`: String, required, `select: false`.
- `tasks`: `[String]`, default `[]`.
- `status`: String, `enum: ['active', 'invalid']`, default `'active'`.
- `lastError`: String, default `''`.
- `connectedBy`: String, default `''` (username).
- `connectedAt`: Date, default `Date.now`.

`toJSON.transform` xoá `ret.accessToken`. Export: `export const PAGE_STATUSES = ['active', 'invalid'];` và `export const MetaPage = mongoose.model('MetaPage', metaPageSchema);`.

### 2.4 TẠO `server/src/services/metaPageService.js`

Quy ước: hàm export có tên, khai báo `async function` như `server/src/services/userService.js`. Mọi lời gọi Graph đi qua `fetch` toàn cục, dùng `graphUrl` cùng kiểu với `server/src/channels/meta.js` (`https://graph.facebook.com/${config.meta.graphVersion}/...`).

```js
export const META_OAUTH_SCOPES = 'pages_show_list,pages_messaging,pages_manage_metadata'; // MĐ câu 6
export const SESSION_TTL_MS = 10 * 60 * 1000;

export function isOAuthConfigured()
// -> Boolean(config.meta.appId && config.meta.appSecret && config.meta.oauthRedirectUri)

export function createOAuthState(userId)
// state = crypto.randomBytes(24).toString('hex'); lưu vào Map nội bộ `states`: state -> { userId: String(userId), expiresAt }
// -> URL: `https://www.facebook.com/${graphVersion}/dialog/oauth?` + URLSearchParams
//    { client_id: appId, redirect_uri: oauthRedirectUri, state, scope: META_OAUTH_SCOPES, response_type: 'code' }

export async function handleOAuthCallback({ code, state, error })
// -> { sessionId } hoặc { error: 'cancelled' | 'state' | 'exchange' | 'no_pages' }
// Các bước:
//  1. `error` có giá trị (người dùng bấm huỷ) -> xoá state nếu có, trả 'cancelled'.
//  2. state không có trong Map, đã hết hạn, hoặc `code` rỗng -> 'state'. State chỉ dùng MỘT lần: luôn xoá khỏi Map ngay khi đọc.
//  3. GET /oauth/access_token?client_id&redirect_uri&client_secret&code -> access_token (user, ngắn hạn).
//  4. GET /oauth/access_token?grant_type=fb_exchange_token&client_id&client_secret&fb_exchange_token=<token bước 3> -> user token dài hạn.
//  5. GET /me/accounts?fields=id,name,access_token,tasks&limit=100, header Authorization: Bearer <token bước 4>.
//     Đi theo paging.next tối đa 10 trang.
//  Bất kỳ bước 3–5 nào trả !res.ok hoặc ném lỗi -> 'exchange'. console.error chỉ ghi số bước và status HTTP;
//  TUYỆT ĐỐI không log URL, code, client_secret hay token.
//  6. Danh sách Page rỗng -> 'no_pages'.
//  7. sessionId = crypto.randomUUID(); lưu Map `sessions`: sessionId -> { userId, expiresAt, pages: [{ pageId, name, accessToken, tasks }] }.

export async function getOAuthSession(sessionId, userId)
// Không có, hết hạn, hoặc userId khác người tạo -> null.
// -> { pages: [{ pageId, name, canMessage, connected }] } (KHÔNG có accessToken)
//    canMessage = tasks.includes('MESSAGING'); connected = pageId đã có trong MetaPage.

export async function connectPages(sessionId, userId, pageIds, username)
// Phiên không hợp lệ (cùng điều kiện như getOAuthSession) -> null.
// Với mỗi pageId nằm trong pageIds VÀ có trong phiên VÀ canMessage:
//   POST /{pageId}/subscribed_apps, body JSON { subscribed_fields: 'messages,messaging_postbacks' }, Bearer page token.
//   Lỗi -> đưa vào failed: { pageId, name, error: 'Không đăng ký được webhook cho Page' } và KHÔNG lưu (MĐ câu 8).
//   Thành công -> MetaPage.findOneAndUpdate({ pageId }, { name, accessToken, tasks, status: 'active', lastError: '',
//                 connectedBy: username, connectedAt: new Date() }, { upsert: true, returnDocument: 'after' }) -> connected.
// pageId không có trong phiên hoặc canMessage=false -> failed với error 'Page không hợp lệ hoặc tài khoản không có quyền nhắn tin'.
// Xử lý xong thì xoá phiên khỏi Map.
// -> { connected: [pageRow], failed: [...] }

export async function disconnectPage(pageId)
// Không có -> false. Có -> gọi DELETE /{pageId}/subscribed_apps bằng page token (best-effort, bỏ qua lỗi), xoá doc, trả true.

export function pageRow(page)
// -> { pageId, name, status, lastError, tasks, connectedBy, connectedAt } (không có accessToken)

export async function resolvePageToken(pageId)
// -> { token, source: 'page' | 'env' } hoặc null
// pageId có giá trị và có MetaPage { pageId, status: 'active' } (.select('+accessToken')) -> { token, source: 'page' }
// ngược lại, config.meta.pageAccessToken có giá trị -> { token, source: 'env' } (MĐ câu 4); không thì null.

export async function markPageInvalid(pageId, message)
// MetaPage.updateOne({ pageId }, { status: 'invalid', lastError: String(message).slice(0, 300) })

export function _resetOAuthMemory() // chỉ dùng trong test: xoá cả states lẫn sessions
```
Mỗi lần gọi `createOAuthState` hoặc `handleOAuthCallback`, quét và xoá các mục đã hết hạn trong cả hai Map.

### 2.5 SỬA `server/src/channels/meta.js`

- `postGraph`: khi `!res.ok`, đọc body (text) rồi thử `JSON.parse`. Ném `Error` với message như hiện tại, gắn thêm `err.graphCode = parsed?.error?.code`.
- `sendMessengerText(recipientId, text, token)` và `sendMessengerTyping(recipientId, token)`: nhận token qua tham số, không đọc `config.meta.pageAccessToken` nữa. `sendMessengerText` thiếu token thì ném `Error('Chưa có Page Access Token cho Page này')`. `sendMessengerTyping` thiếu token thì `return`.
- `parseMetaWebhook`: chỉ ở nhánh `page`/`instagram`, thêm `pageId: entry.id` vào mỗi phần tử, **chỉ khi** `typeof entry.id === 'string'` (spread có điều kiện, để không sinh khoá mang giá trị `undefined`). Nhánh WhatsApp giữ nguyên.

### 2.6 SỬA `server/src/channels/index.js`

```js
export async function deliver(channel, externalId, text, { pageId } = {})
export async function showTyping(channel, externalId, { pageId } = {})
```
- `messenger` / `instagram`: `const r = await resolvePageToken(pageId)`, sau đó `sendMessengerText(externalId, text, r?.token)`. Bắt lỗi: nếu `err.graphCode === 190 && r?.source === 'page'` thì `await markPageInvalid(pageId, err.message)`. Sau đó luôn ném lại lỗi để `sendOutbound` gắn `needsAttention` như cũ.
- `showTyping` chỉ áp dụng cho `messenger`: resolve token, gọi `sendMessengerTyping(externalId, r?.token)`.
- WhatsApp giữ nguyên.

### 2.7 SỬA `server/src/models/Conversation.js` và `server/src/services/conversationService.js`

- Thêm vào `conversationSchema`: `pageId: { type: String, default: '' }` (Page nhận tin, chỉ dùng cho Messenger/Instagram).
- `handleIncomingMessage` nhận thêm `pageId` trong object tham số (cập nhật JSDoc). Ở `Conversation.findOneAndUpdate`, nếu có `pageId` thì thêm `$set: { pageId }`. KHÔNG đưa `pageId` vào `$setOnInsert`, vì Mongo báo xung đột khi cùng một trường nằm ở cả hai.
- `sendOutbound`: `deliver(conversation.channel, conversation.externalId, text, { pageId: conversation.pageId })`.
- `showTyping(channel, externalId, { pageId: conversation.pageId })`.
- `server/src/routes/webhook.js` không phải sửa, vì đối tượng từ `parseMetaWebhook` được truyền nguyên vào `handleIncomingMessage`.

### 2.8 SỬA `server/src/routes/admin.js`

Thêm khối `// ---------- Kết nối Facebook Page ----------` đặt trước khối Người dùng. Dùng các helper sẵn có `bad`, `notFound`. Lưu ý `bad` hiện đang khai báo ở khối Người dùng, nên phải chuyển khai báo `const bad = ...` lên gần `notFound` ở đầu file.

| Method | Path | Quyền | Body | Response |
|---|---|---|---|---|
| GET | `/meta/pages` | `channels.view` | – | `{ configured: isOAuthConfigured(), envTokenConfigured: Boolean(config.meta.pageAccessToken), pages: [pageRow] }`, sắp xếp `connectedAt: -1` |
| POST | `/meta/oauth/start` | `channels.manage` | – | `{ url }`; chưa cấu hình thì 400 `'Chưa cấu hình META_APP_ID / META_APP_SECRET / META_OAUTH_REDIRECT_URI'` |
| GET | `/meta/oauth/sessions/:id` | `channels.manage` | – | kết quả `getOAuthSession(id, req.user._id)`; null thì 404 `'Phiên kết nối không tồn tại hoặc đã hết hạn'` |
| POST | `/meta/pages` | `channels.manage` | `{ sessionId, pageIds }` | kết quả `connectPages(...)`; null thì 404 cùng thông báo trên |
| DELETE | `/meta/pages/:pageId` | `channels.manage` | – | `{ ok: true }`; không có thì `notFound` |

Kiểm tra đầu vào, lỗi trả 400 `'Dữ liệu không hợp lệ'`:
- `sessionId` phải là chuỗi.
- `pageIds` phải là mảng khác rỗng, tối đa 100 phần tử, mỗi phần tử khớp `/^\d{1,32}$/`. Loại trùng trước khi xử lý.
- `:pageId` của DELETE không khớp regex thì trả `notFound`.

Không response nào được chứa `accessToken`.

### 2.9 TẠO `server/src/routes/metaOAuth.js` và SỬA `server/src/app.js`

Copy khung router từ `server/src/routes/webhook.js`.
```js
router.get('/oauth/callback', async (req, res) => { ... })
```
- Gọi `handleOAuthCallback({ code: req.query.code, state: req.query.state, error: req.query.error })`, chỉ nhận giá trị dạng chuỗi.
- Thành công thì `res.redirect(302, '/admin/channels?session=' + encodeURIComponent(sessionId))`. Lỗi thì `res.redirect(302, '/admin/channels?error=' + code)`.
- Áp `rateLimit({ windowMs: 15 * 60 * 1000, limit: 30 })`, giống cách `server/src/routes/auth.js` dùng.

`server/src/app.js`: thêm `app.use('/api/meta', metaOAuthRoutes);`, đặt ngay sau dòng `/api/admin`.

## 3. Client

### 3.1 SỬA `client/src/components/Icons.jsx`

Thêm icon `link: 'M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z'`.

### 3.2 SỬA `client/src/pages/AdminLayout.jsx` và `client/src/App.jsx`

- `RAIL`: chèn mục `{ to: '/admin/channels', label: 'Kênh kết nối', icon: 'link', perm: 'channels.view' }` vào trước mục Người dùng.
- `App.jsx`: thêm `<Route path="channels" element={<RequirePermission perm="channels.view"><Channels /></RequirePermission>} />`.

### 3.3 TẠO `client/src/pages/Channels.jsx`

Copy cấu trúc và class CSS từ `client/src/pages/Users.jsx` / `client/src/pages/Products.jsx` (`page-head`, `page-title`, `card table-wrap`, `Modal` + `form-grid`, `label.check`, `badge badge-ok`, `btn-ghost danger`, `p.error`, `form-actions`). **Không thêm CSS mới.** Lấy `me` bằng `useOutletContext()`, đặt `canManage = can(me, 'channels.manage')`. Ngày hiển thị bằng `formatTime` trong `client/src/format.js`.

- `load()` gọi `api('/admin/meta/pages')`.
- Tiêu đề "Kênh kết nối". Nút "+ Kết nối Facebook Page" chỉ hiện khi `canManage && configured`. Bấm nút thì gọi `api('/admin/meta/oauth/start', { method: 'POST' })`, rồi `window.location.assign(url)`.
- `!configured`: hiện `<p className="muted">` "Chưa cấu hình META_APP_ID, META_APP_SECRET, META_OAUTH_REDIRECT_URI trong server/.env." `envTokenConfigured`: hiện `<p className="muted">` "Page chưa kết nối sẽ dùng META_PAGE_ACCESS_TOKEN trong .env."
- Bảng gồm các cột: Tên Page | Page ID | Trạng thái (`active` hiện `badge badge-ok` "Đang hoạt động"; `invalid` hiện `badge` "Cần kết nối lại" và `title={lastError}`) | Người kết nối | Ngày kết nối | nút "Ngắt kết nối" (chỉ khi `canManage`). Trước khi ngắt hỏi `window.confirm(\`Ngắt kết nối Page "${p.name}"? Bot sẽ không trả lời tin nhắn từ Page này nữa.\`)`, đồng ý thì gọi `DELETE` rồi `load()`. Danh sách rỗng thì hiện một dòng "Chưa có Page nào được kết nối."
- Dùng `useSearchParams()` của react-router-dom:
  - `?error=`: hiện `<p className="error">` theo bảng sau. `cancelled`: "Bạn đã huỷ đăng nhập Facebook." `state`: "Phiên kết nối không hợp lệ hoặc đã hết hạn, vui lòng thử lại." `exchange`: "Không lấy được token từ Facebook, vui lòng thử lại." `no_pages`: "Tài khoản Facebook này không quản lý Page nào (hoặc chưa cấp quyền Page)." Mã khác: "Kết nối thất bại." Hiện xong thì `setSearchParams({}, { replace: true })`.
  - `?session=`: gọi `GET /admin/meta/oauth/sessions/:id` rồi mở `Modal` "Chọn Page cần kết nối". Mỗi Page là một checkbox `label.check`, mặc định tick các Page có `canMessage`. Page có `canMessage === false` thì `disabled` và kèm ghi chú "(không có quyền nhắn tin)". Page có `connected` thì kèm ghi chú "(đã kết nối, sẽ cập nhật token)". Nút "Kết nối" gọi `POST /admin/meta/pages { sessionId, pageIds }`. Sau đó đóng modal, `load()`, và nếu `failed.length` thì hiện `<p className="error">` liệt kê `name: error`. Nút "Huỷ" chỉ đóng modal. Mở modal hay gặp lỗi 404 đều phải `setSearchParams({}, { replace: true })`. Lỗi thì hiện thông báo lỗi của server.

## 4. Test

Copy khung từ `server/test/users.test.js`: `createApp()`, `server.listen(0)`, hàm `call()` dùng `fetch`, `before: connectDB('memory')`, `after: io.close(); disconnectDB()`.

### 4.1 SỬA test cũ
- `server/test/users.test.js`: đổi `13` thành `15` ở ca đăng nhập.
- `server/test/meta.test.js`: thêm `id: 'PAGE1'` vào `entry` của ca Messenger, và thêm `pageId: 'PAGE1'` vào 2 phần tử mong đợi. Thêm một ca: entry không có `id` thì kết quả không có khoá `pageId`.

### 4.2 TẠO `server/test/metaPages.test.js`

Giả lập Graph bằng cách bọc fetch: lưu `realFetch = globalThis.fetch`, rồi thay `globalThis.fetch = (url, opts) => String(url).startsWith('https://graph.facebook.com') ? fakeGraph(url, opts) : realFetch(url, opts)`. Hàm `fakeGraph` ghi lại các lời gọi và trả `new Response(JSON.stringify(...), { status })`. Ở `after` thì trả lại fetch thật. Trong `before`, gán trực tiếp `config.meta.appId = 'APP'`, `config.meta.appSecret = 'SECRET'`, `config.meta.oauthRedirectUri = 'http://localhost/api/meta/oauth/callback'`, `config.meta.pageAccessToken = ''`. Mỗi ca gọi `_resetOAuthMemory()`. Callback gọi bằng `fetch(..., { redirect: 'manual' })` và đọc header `location`.

Ca bắt buộc:
1. Staff không có `channels.view` gọi `GET /meta/pages` thì nhận 403. Staff chỉ có `channels.view` gọi `POST /meta/oauth/start` thì nhận 403.
2. Thiếu `appId`: `start` trả 400 (nhớ gán lại sau ca này).
3. Luồng đủ: `start` trả `url` chứa `client_id=APP` và `state`. Callback với state đó trả 302 về `/admin/channels?session=…`. `GET sessions/:id` trả 2 Page (một Page có `MESSAGING`, một Page không có) và response không chứa chuỗi token giả. `POST /meta/pages` với cả 2 id cho kết quả `connected` 1, `failed` 1. Có đúng 1 lời gọi `subscribed_apps`. `GET /meta/pages` không chứa token.
4. Callback dùng lại state cũ thì Location chứa `error=state`. Callback có `error=access_denied` thì chứa `error=cancelled`. Graph đổi code trả 400 thì chứa `error=exchange`. `/me/accounts` rỗng thì chứa `error=no_pages`.
5. Một admin khác (không phải người tạo phiên) gọi `GET sessions/:id` thì nhận 404. Gọi `POST /meta/pages` lần hai với cùng session thì nhận 404.
6. `subscribed_apps` trả lỗi thì Page vào `failed` và không được lưu.
7. Gửi tin: gọi `handleIncomingMessage({ channel: 'messenger', externalId: 'PSID1', pageId: '<page đã kết nối>', text: 'gặp nhân viên' })` (rẽ nhánh từ khoá handoff, nên không gọi OpenAI). Kiểm tra `Conversation.pageId` được lưu, và lời gọi `me/messages` dùng header `Bearer <page token>`.
8. `me/messages` trả `{ error: { code: 190 } }` thì `MetaPage.status === 'invalid'` và hội thoại có `needsAttention: true`.
9. `resolvePageToken`: Page không tồn tại và có `config.meta.pageAccessToken = 'ENV'` thì trả `{ source: 'env' }`. Không có cả hai thì trả `null`.
10. `DELETE /meta/pages/:pageId` trả 200 và doc bị xoá. Gọi lại lần nữa thì nhận 404. pageId sai định dạng thì nhận 404.

`cd server && npm test`: toàn bộ test cũ phải vẫn xanh.

## 5. Tài liệu: SỬA `README.md`

- Mục "Kết nối Facebook Messenger…": thêm các bước khai báo `META_APP_ID`, `META_OAUTH_REDIRECT_URI` (Facebook Login > Valid OAuth Redirect URIs), sau đó vào **Kênh kết nối** bấm "Kết nối Facebook Page". Ghi rõ `META_PAGE_ACCESS_TOKEN` giờ chỉ còn là token dự phòng. Nhắc rằng App Review cần thêm `pages_show_list`, `pages_manage_metadata`.
- Mục "Trang quản trị": thêm gạch đầu dòng **Kênh kết nối**.
- Bảng API: thêm các route ở mục 2.8 và `GET /api/meta/oauth/callback`.

## 6. Ngoài phạm vi (KHÔNG làm)

Instagram/WhatsApp qua OAuth (trừ khi câu 2 đổi), mã hoá token (trừ khi câu 5 đổi), hiển thị Page trên Hộp thư, tự làm mới token, audit log, CSS mới, thư viện mới.
