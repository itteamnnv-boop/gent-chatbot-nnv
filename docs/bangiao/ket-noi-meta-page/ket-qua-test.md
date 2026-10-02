# Kết quả test: Vòng sửa 2 (Kết nối Meta Page)

Kết luận: ĐẠT toàn bộ. Không có ca nào rớt. Không sửa code sản phẩm, không commit, không đọc `server/.env`.

## 1. `cd server && npm test`
- ĐẠT: tests 101, suites 16, pass 101, fail 0, cancelled 0, skipped 0.
- Các ca Instagram mới đều xanh:
  - "Instagram luôn dùng token .env, kể cả khi pageId trùng Page đã kết nối"
  - "Instagram nhận lỗi 190 thì MetaPage trùng pageId vẫn active"

## 2. `vite build` (client)
- ĐẠT: "built in 151ms", sinh `dist/assets/index-*.js` (382.61 kB) và css, không có lỗi.

## 3. Kiểm chứng các ca Instagram bắt được lỗi cũ (đột biến trên bản sao)
- Thực hiện trên bản sao trong scratchpad (`...\scratchpad\srv2`), code thật không bị đụng.
- Đã gỡ 2 sửa đổi trong `channels/index.js` của bản sao:
  - `resolvePageToken(channel === 'messenger' ? pageId : undefined)` đổi lại thành `resolvePageToken(pageId)`.
  - Bỏ điều kiện `channel === 'messenger' &&` trước `err.graphCode === 190`.
- Chạy `test/metaPagesTester.test.js` trên bản sao: pass 48, fail 2.
  - RỚT đúng 2 ca Instagram mới: "Instagram luôn dùng token .env, kể cả khi pageId trùng Page đã kết nối" và "Instagram nhận lỗi 190 thì MetaPage trùng pageId vẫn active".
  - Mọi ca khác vẫn xanh.
- Kết luận: 2 ca mới bắt được lỗi cũ.
- Hạn chế: tôi gỡ hai sửa đổi cùng lúc, chưa đột biến riêng từng cái. Vì vậy chưa biết mỗi ca bắt riêng sửa đổi nào.

## 4. URL dialog OAuth có `business_management`
- ĐẠT.
  - `META_OAUTH_SCOPES = 'pages_show_list,pages_messaging,pages_manage_metadata,business_management'` (`server/src/services/metaPageService.js` dòng 5). `createOAuthState` đưa nó vào tham số `scope` của `https://www.facebook.com/<ver>/dialog/oauth`.
  - Ca "url start chứa state ngẫu nhiên khác nhau, scope đúng, và không chứa app secret" (metaPagesTester dòng 389-395) so sánh đúng chuỗi scope trên và đang xanh.
  - Ca này cũng kiểm URL không chứa app secret.

## 5. Khác
- `client/src/App.jsx` dòng 52 đã có `path="users" element=` (khoảng trắng đúng). Build qua.
- Chưa kiểm với Facebook thật, ví dụ việc `business_management` có trả đủ Page trong Business Manager hay không. Cần xin quyền trong App Review và bật trong Meta App.
