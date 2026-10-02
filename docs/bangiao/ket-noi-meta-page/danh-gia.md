PHAN QUYET: CHOT

# Đánh giá lần cuối: Kết nối Meta App, chọn Facebook Page, lấy Page Access Token

- Nhánh: `feature/ket-noi-meta-page`. Thay đổi chưa commit so với `f33bcfc`: 15 file đã sửa, 7 file/thư mục chưa track (gồm `.bangiao/`, `client/src/pages/Channels.jsx`, `server/src/models/MetaPage.js`, `server/src/routes/metaOAuth.js`, `server/src/services/metaPageService.js`, `server/test/metaPages.test.js`, `server/test/metaPagesTester.test.js`).
- Reviewer tự chạy `cd server && npm test`: 101 ca, 16 suite, 101 đạt, 0 rớt, 0 bỏ qua. Khớp với `.bangiao/ket-qua-test.md`.
- Vòng trước (CAN SUA) yêu cầu 3 mục: 4.1, 4.2, 4.3. Vòng này có thêm 1 mục theo yêu cầu người dùng: scope `business_management`.

## 1. Kiểm từng mục

### 4.1 Instagram chỉ dùng token .env: ĐẠT
- File `server/src/channels/index.js`:
  - Dòng 10 gọi `resolvePageToken(channel === 'messenger' ? pageId : undefined)`. Instagram luôn rơi về token .env, nên `r.source` của Instagram là `'env'`.
  - Dòng 15 chỉ gọi `markPageInvalid` khi đủ cả ba điều kiện: `channel === 'messenger'`, `graphCode === 190` và `r?.source === 'page'`.
- Code này khớp quyết định câu 2 của kế hoạch và khớp `.bangiao/thay-doi.md`.
- `showTyping` đã có `return` sớm khi kênh không phải Messenger, nên không cần sửa.

### 4.2 Ca test Instagram: ĐẠT, và có giá trị thật
- File `server/test/metaPagesTester.test.js`:
  - Dòng 540-547: Instagram có `pageId` trùng một Page đã kết nối. Test kiểm có ít nhất một tin được gửi, mọi lời gọi dùng `Bearer ${ENV_TOKEN}`, và không lời gọi nào dùng `TOK1`.
  - Dòng 548-555: Instagram nhận lỗi 190 thì `MetaPage` `111` vẫn ở trạng thái `active`.
- Tester đã kiểm đột biến trên một bản sao: gỡ 2 sửa đổi thì đúng 2 ca này rớt, các ca khác vẫn xanh. Như vậy test khoá được ranh giới thật.
- Ghi chú nhỏ:
  - Ca dòng 548 thực chất được bảo vệ hai lớp. Nếu chỉ gỡ điều kiện `channel === 'messenger'` ở dòng 15 thì `r.source` vẫn là `'env'`, nên ca này vẫn xanh. Ca chỉ rớt khi cả hai sửa đổi cùng hỏng. Đây là phòng thủ theo chiều sâu, chấp nhận được, không phải lỗi.
  - Ca dòng 548 không kiểm có lời gọi gửi đi. Có thể thêm `sentMessages().length >= 1` để chắc ca thật sự đi qua nhánh lỗi. Việc này không bắt buộc.

### 4.3 Khoảng trắng trong App.jsx: ĐẠT
- `git diff client/src/App.jsx` giờ chỉ còn 2 dòng thêm: import `Channels` và route `channels` có `RequirePermission perm="channels.view"`.
- Dòng `users` không còn nằm trong diff.

### Scope business_management: ĐẠT
- `server/src/services/metaPageService.js`:
  - Dòng 5: `META_OAUTH_SCOPES = 'pages_show_list,pages_messaging,pages_manage_metadata,business_management'`.
  - Dòng 36: hằng số này được đưa vào tham số `scope` của URL dialog.
- Test dòng 389-395 so khớp đúng chuỗi scope trên và kiểm URL không chứa app secret.
- README dòng 115-116 đã thêm `business_management` vào mục App Review và giải thích lý do.
- Coder không thêm biến env mới. Như vậy là đúng phạm vi kế hoạch.

## 2. Có phát sinh lỗi mới không
- Không thấy lỗi mới. Các phần đã duyệt ở vòng trước không bị đụng lại theo cách làm hỏng:
  - state và CSRF;
  - redirect URI cố định;
  - không có open redirect;
  - không log hay trả token, code, app secret;
  - phân quyền `channels.view` và `channels.manage`;
  - paging giới hạn 10 trang, chỉ đi theo link thuộc graph.facebook.com;
  - đăng ký webhook xong mới lưu Page.
- `git diff --stat` khớp đúng phạm vi tính năng. Không có file ngoài luồng.

## 3. Ghi chú, không chặn việc chốt
- `business_management` là quyền rộng: nó cho đọc tài sản trong Business Manager. Code hiện chỉ dùng nó để `/me/accounts` trả đủ Page, chỉ lưu token của Page và không lưu token người dùng. Như vậy là chấp nhận được. Khi xin App Review cần nêu rõ mục đích này.
- Phải chạy thử OAuth với Facebook thật trước khi phát hành:
  - redirect URI phải khớp từng ký tự;
  - quyền `business_management` phải được bật hoặc duyệt trong Meta App;
  - phải xác nhận Page thuộc Business Manager có xuất hiện trong danh sách.
- Chú thích schema `Conversation.pageId` ghi "Page nhận tin", nhưng với Instagram trường này chứa ID tài khoản IG. Có thể sửa chú thích cho rõ.
- Chưa có test UI cho client. `vite build` đã qua. Đây là giới hạn đã ghi lại.

## 4. Kết luận
Cả 4 mục đều đã đúng. Test có giá trị thật và đã được kiểm đột biến. Không thấy vấn đề bảo mật, hiệu năng hay tính đúng đắn mới. Phán quyết: CHOT. Tính năng sẵn sàng để commit, sau đó cần chạy thử với Facebook thật như mục 3.
