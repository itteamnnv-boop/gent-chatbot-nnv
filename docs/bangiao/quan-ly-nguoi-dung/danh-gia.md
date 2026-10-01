PHAN QUYET: CHOT

## Tóm tắt
Vòng sửa 2 đã xử lý đúng cả 3 mục "Phải sửa" của vòng trước, không phát sinh lỗi mới. Hai test mới có giá trị thật: tester đã gỡ lại lỗi cũ trên một bản sao để thử, và test rớt đúng chỗ. Các mục "Nên sửa" (4, 5 và các ghi chú phụ) người dùng đã chốt không làm ở vòng này, nên không tính vào phán quyết. Kết quả 40/40 đạt và vite build thành công lấy theo .bangiao/ket-qua-test.md; reviewer chỉ đọc code, không tự chạy lại. (Ghi chú của bên điều phối: đã chạy lại `npm test` độc lập, 40/40 đạt, 0 rớt.)

## Xác minh 3 mục phải sửa

1. client/src/api.js dòng 47: ĐÃ SỬA ĐÚNG.
   Điều kiện hiện tại: `if (res.status === 401 && (path.startsWith('/admin') || path === '/auth/me'))`.
   - /auth/me trả 200, 403 hoặc 500 thì không còn bị đăng xuất, nên hết vòng lặp đá về trang đăng nhập.
   - /auth/login trả 401 (sai mật khẩu) thì không bị chuyển trang, vẫn hiện lỗi bình thường.
   - server/test/clientApi401.test.js import thẳng client/src/api.js (client/package.json có "type": "module"), giả lập fetch, localStorage, window và kiểm đủ 5 ca: 401 ở /auth/me, 401 ở /admin/..., 403/500 ở /auth/me, 401 ở /auth/login, 200 ở /auth/me. Tester đã đưa lại biểu thức thiếu ngoặc trên bản sao thì 2 ca rớt. Test bắt được đúng lỗi cũ.

2. server/src/routes/admin.js: ĐÃ SỬA ĐÚNG.
   - POST /users dòng 335 và PUT /users/:id dòng 352: nếu `data.active !== undefined && typeof data.active !== 'boolean'` thì trả 400 "Trạng thái không hợp lệ".
   - Ở PUT, phép kiểm tra nằm trước bước tính finalActive (dòng 358) và trước user.set(data) (dòng 369). Vì vậy chỗ dùng Boolean(data.active) ở dòng 358 giờ chỉ nhận boolean thật, và kết quả kiểm tra luôn khớp giá trị Mongoose ghi xuống. Lỗ hổng gửi "false" để vượt SELF_LOCK và LAST_ADMIN đã đóng.
   - Gửi `active: null` cũng bị 400, vì typeof null là 'object'. Như vậy là đúng.
   - Các trường còn lại không có lỗ ép kiểu tương tự: role so khớp chặt bằng ROLES.includes, permissions được validPermissions kiểm cả kiểu lẫn khoá.
   - server/test/users-lastadmin.test.js có ca mới. Admin duy nhất gửi PUT {active:"false"} vào chính mình thì nhận 400 và DB vẫn active = true. POST có active:"false" thì nhận 400 và không tạo user. Tester đã gỡ cả hai chốt trên bản sao thì ca PUT rớt (200 thay vì 400). Ca POST chưa được thử riêng bằng cách chỉ gỡ chốt ở POST, nhưng code ở dòng 335 đúng. Chấp nhận được.

3. README.md dòng 176–177: ĐÃ SỬA ĐÚNG.
   Dòng 176 là "- Nhắc giỏ hàng bị bỏ dở (trong khung 24h), khảo sát sau mua." (giữ nguyên như bản gốc). Dòng 177 là "- Phân công hội thoại cho nhân viên." Không còn trùng ý, và không còn liệt kê "nhiều tài khoản, phân quyền" là việc chưa làm.

## Ba câu hỏi

Code có khớp kế hoạch không? Có. Vòng sửa 2 chỉ đụng đúng các chỗ được yêu cầu, không lan ra ngoài. Phần còn lại vẫn khớp kế hoạch như đã đánh giá ở vòng trước.

Test có giá trị thật không? Có. Cả hai nhóm test mới đều được chứng minh bằng cách thử đưa lỗi cũ trở lại, và test bắt được lỗi. Test client gọi đúng hàm api() thật, không viết lại logic ra hàm riêng để test. Vẫn còn thiếu (đã biết, không chặn): chưa có test cho giao diện React (AdminLayout, Users.jsx, RequirePermission), chưa test realtime theo room quyền, và nhánh LAST_ADMIN vẫn chỉ là lớp phòng thủ thêm, không chạm tới được qua HTTP bình thường.

Bảo mật, hiệu năng, tính đúng đắn: không có vấn đề mới. Các mục đã nêu ở vòng trước và người dùng đã chốt để sau:
- AdminLayout.jsx kẹt ở "Đang tải..." khi /auth/me lỗi khác 401.
- Kiểm tra LAST_ADMIN đếm rồi mới ghi nên chưa nguyên tử; có race khi hai admin khoá nhau cùng lúc.
- Staff có users.manage tạo được một staff khác có đủ 12 quyền. Đây là leo thang quyền gián tiếp nhưng đúng thiết kế đã chốt.
- ensureBootstrapAdmin làm sập server lúc khởi động nếu ADMIN_USERNAME trong .env không khớp regex tên đăng nhập.

Ghi chú nhỏ: test client đang nằm trong bộ test của server và import đường dẫn ../../client/src/api.js. Nếu sau này đổi cấu trúc thư mục thì cần nhớ chuyển test này theo.

## Trước khi merge (khuyến nghị, không chặn)
Đăng nhập thử trên trình duyệt:
- bằng tài khoản admin;
- bằng một tài khoản staff có ít quyền, kiểm tra menu bị lọc và nút bị ẩn đúng;
- mở trang /admin/users bằng staff không có users.manage, kiểm tra bị chặn;
- khoá một staff đang đăng nhập, kiểm tra người đó bị đẩy về trang đăng nhập.
