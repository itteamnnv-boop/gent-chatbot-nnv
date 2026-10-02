# Thay đổi: Kết nối Meta App, chọn Facebook Page, lấy Page Access Token

Triển khai đúng `ke-hoach.md` với toàn bộ phương án mặc định. Không thêm dependency, không đụng `server/.env`, không commit.
Kết quả: `cd server && npm test` 51/51 xanh; `vite build` của client thành công.

## Server
- `server/src/config.js`: thêm `meta.appId`, `meta.oauthRedirectUri` (biến `META_APP_ID`, `META_OAUTH_REDIRECT_URI`).
- `server/.env.example`: thêm 2 biến trên (chỉ file này, không sửa `.env`).
- `server/src/permissions.js`: thêm `channels.view`, `channels.manage` (tổng 15 quyền).
- `server/src/models/MetaPage.js` (mới): Page đã kết nối; `accessToken` có `select: false` và bị xoá trong `toJSON`.
- `server/src/services/metaPageService.js` (mới): OAuth state/phiên trong bộ nhớ (TTL 10 phút), đổi code lấy token dài hạn,
  lấy `/me/accounts`, `connectPages` (đăng ký webhook từng Page), `disconnectPage`, `resolvePageToken` (Page rồi đến token `.env`),
  `markPageInvalid`.
- `server/src/channels/meta.js`: `postGraph` gắn `err.graphCode`; `sendMessengerText/Typing` nhận token qua tham số;
  `parseMetaWebhook` thêm `pageId = entry.id` (chỉ nhánh page/instagram, chỉ khi `entry.id` là chuỗi).
- `server/src/channels/index.js`: `deliver`/`showTyping` nhận `{ pageId }`, resolve token; lỗi code 190 với token Page thì đánh dấu `invalid`, vẫn ném lại lỗi.
- `server/src/models/Conversation.js`, `server/src/services/conversationService.js`: lưu `pageId` (qua `$set`, không đặt trong `$setOnInsert`); truyền `pageId` khi gửi tin và hiện "đang gõ".
- `server/src/routes/admin.js`: 5 route `/meta/...`; chuyển khai báo `bad` lên đầu file (cạnh `notFound`).
- `server/src/routes/metaOAuth.js` (mới) và `server/src/app.js`: `GET /api/meta/oauth/callback` công khai, rate limit 30/15 phút, redirect 302.

## Client
- `client/src/pages/Channels.jsx` (mới), route trong `client/src/App.jsx`, mục menu trong `client/src/pages/AdminLayout.jsx`, icon `link` trong `client/src/components/Icons.jsx`.

## Test và tài liệu
- Sửa test cũ: `server/test/users.test.js` (13 thành 15), `server/test/meta.test.js` (thêm `pageId` và ca không có `entry.id`).
- `server/test/metaPages.test.js` (mới): 9 ca, bao phủ 10 mục của kế hoạch (mục 5 và 6 gộp theo ca riêng).
- `README.md`: hướng dẫn kết nối, mục Kênh kết nối, bảng API.

## Tester nên soi kỹ
- Chưa thử với Facebook thật: chỉ kiểm bằng Graph giả. Cần chạy thử OAuth thật (redirect URI khớp, scope, Page thuộc Business Manager).
- Callback không bao giờ log hay trả về token/code/secret; kiểm tra log server khi lỗi exchange (chỉ nên có số bước và HTTP status).
- `$set: { pageId }` cùng `$setOnInsert` trong `handleIncomingMessage` (đã xanh trong test, nhưng nên thử thêm hội thoại mới và cũ, tin không có `pageId`).
- Phiên OAuth nằm trong bộ nhớ: restart server giữa chừng thì phải kết nối lại; phiên chỉ dùng được bởi người tạo và chỉ dùng một lần.
- `/me/accounts` đi theo `paging.next` chỉ khi URL bắt đầu bằng `https://graph.facebook.com/` (tối đa 10 trang).
- Instagram vẫn dùng token `.env` dù có Page (hội thoại Instagram không được ánh xạ sang Page).
- Giao diện `/admin/channels`: các nhánh `?error=`, `?session=`, Page `canMessage=false`, hiển thị lỗi `failed`.

## Vòng sửa 2
- `server/src/channels/index.js` (mục 4.1): Instagram chỉ dùng token `.env` (`resolvePageToken(channel === 'messenger' ? pageId : undefined)`); `markPageInvalid` chỉ gọi khi `channel === 'messenger'`. `showTyping` vốn chỉ chạy cho Messenger nên không cần sửa.
- `server/test/metaPagesTester.test.js` (mục 4.2): viết lại ca Instagram thành "luôn dùng token .env kể cả khi pageId trùng Page đã kết nối" (mọi lời gọi dùng `Bearer ${ENV_TOKEN}`, không lời gọi nào dùng token Page); thêm ca Instagram nhận lỗi 190 thì MetaPage vẫn `active`. Cập nhật chuỗi scope mong đợi.
- `client/src/App.jsx` (mục 4.3): trả lại khoảng trắng `path="users" element=`.
- Scope `business_management`: thêm vào `META_OAUTH_SCOPES` trong `server/src/services/metaPageService.js` (hằng số nằm ở đây, KHÔNG phải `config.js`), cập nhật README (mục App Review) và test kiểm chuỗi scope. `server/src/config.js` và `server/.env.example` không có biến `META_OAUTH_SCOPES` nên không sửa; không tự thêm biến mới vì ngoài kế hoạch. Không đọc/sửa `server/.env`.
- Lưu ý: hiện scope là hằng số trong code, không đọc từ env. Nếu người dùng có dòng `META_OAUTH_SCOPES` trong `server/.env` thì code hiện tại cũng bỏ qua; còn nếu sau này thêm cơ chế đọc từ env thì giá trị trong `.env` sẽ ghi đè mặc định và người dùng phải tự thêm `business_management`. Người dùng cũng cần xin quyền `business_management` trong App Review / bật trong Meta App.
- Kết quả: `npm test` 101/101 pass; `vite build` thành công.
- Tester nên soi: Instagram với pageId trùng Page đã kết nối (không dùng token Page, không đánh dấu invalid); OAuth thật có trả đủ Page trong Business Manager khi có `business_management`.
