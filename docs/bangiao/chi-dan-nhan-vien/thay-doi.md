# Thay đổi: AI làm theo chỉ dẫn của nhân viên khi nhân viên đã tham gia trả lời

Làm theo `.bangiao/ke-hoach.md`. Cả 7 câu hỏi bỏ ngỏ đã được người dùng chọn phương án mặc định (đã ghi lại trong kế hoạch). Không sửa `webhook.js`, `channels/*`. Không commit.

## File đã thay đổi

Server:
- `server/src/models/Message.js`: thêm `author` (tên nhân viên gửi tin).
- `server/src/models/Conversation.js`: export `staffDiscountSchema`, thêm `staffDiscount` (mặc định null).
- `server/src/models/Order.js`: thêm `discount` (mặc định 0) và `staffDiscount` (bản chụp ghi vết).
- `server/src/utils/text.js`: thêm `mentionedNumbers` (đọc số tiền, %, số lượng từ tin) và `stripStaffMarkers` (đổi nhãn giả danh nhân viên thành `(trích dẫn)`).
- `server/src/services/cart.js`: thêm `staffDiscountAmount`, `describeStaffDiscount`; `cartTotals`/`describeCart` nhận thêm `sd` (gọi 2 tham số như cũ thì kết quả y cũ, chỉ có thêm `discount: 0`). Ngưỡng free ship tính sau giảm.
- `server/src/agent/tools.js`: tool mới `apply_staff_discount` (tổng 10 tool); `update_cart`/`view_cart` truyền ưu đãi; `create_order` kiểm ưu đãi còn hiệu lực, đủ điều kiện, lưu `discount` + `staffDiscount` vào đơn, xoá ưu đãi sau khi tạo (cả nhánh Chat thử).
- `server/src/agent/agent.js`: `runAgent` nhận `staffInstructions`, đưa vào `ctx` và prompt.
- `server/src/agent/prompt.js`: mục "Chỉ dẫn của nhân viên trong hội thoại này" (chỉ khi có tin), sửa 2 quy tắc, thêm quy tắc chống giả danh.
- `server/src/services/conversationService.js`: lưu `author` cho tin nhân viên; `loadHistory` vô hiệu nhãn giả danh ở tin khách/bot; `loadStaffInstructions` (sau đơn gần nhất, tối đa 10 tin); lưu tin `system` khi AI áp/bỏ ưu đãi; `conversationView` thêm `staffDiscountView`.

Client:
- `client/src/pages/Inbox.jsx`: dòng "Ưu đãi NV" trong khung Giỏ hàng.
- `client/src/pages/Orders.jsx`: dòng "Giảm theo nhân viên" trước Phí ship.

Test:
- `server/test/staffInstructions.test.js` (mới, 13 test, client OpenAI giả): kịch bản 200k/5 bao, chốt đơn, số không khớp, message_id sai, giả danh, thiếu số lượng, unit_price, percent/remove, Chat thử, tin cũ hơn đơn, hàm thuần.
- `server/test/agent.test.js`: số tool 9 thành 10.
- `.bangiao/ke-hoach.md`: mục câu hỏi cập nhật thành "Đã trả lời: MĐ cho cả 7 câu".

## Kết quả chạy
- `cd server && npm test`: 300 test, 300 qua, 0 lỗi.
- `cd client && npm run build`: xem báo cáo trả về.

## Chỗ Tester nên soi kỹ
1. Chống giả danh: tin khách có `[Nhân viên trả lời]`, `[admin]`, `[Chủ shop]`... phải thành `(trích dẫn)`; biến thể khác (ngoặc tròn, viết liền, ký tự lạ) hiện KHÔNG bị chặn bằng regex, chỉ được chặn bằng việc tool chỉ nhận id tin `role: 'agent'`.
2. `mentionedNumbers`: "mua 5 bao" cho `plain` 5, nhưng "5 kg" không bị coi là tiền; "1tr2" và số viết bằng chữ không hỗ trợ (tool báo không khớp).
3. Số không có đơn vị dưới 1000 được hiểu là nghìn ("giảm 200" = 200.000), kiểm tra không gây giảm nhầm.
4. `create_order`: thứ tự kiểm tra (ưu đãi hết hiệu lực, rồi priceChanged, rồi chưa đủ điều kiện); đơn thật lưu `discount`, `staffDiscount`; `total = subtotal - discount + shippingFee`.
5. Đơn cũ không có `discount` (hiểu là 0): Orders.jsx chỉ hiện dòng giảm khi `discount > 0`.
6. Tin nhân viên gửi thẳng trên Facebook không vào hệ thống nên không có thẩm quyền (giữ nguyên theo câu 6).
7. Cam kết không phải giảm giá (miễn ship, quà...) chỉ nhờ prompt (ghi vào note bằng `save_customer_info`), không có kiểm tra cứng ở server.
8. Hiển thị Inbox/Orders chưa được kiểm tra bằng trình duyệt, chỉ build qua.

## Sửa sau vòng test 1
Lỗi: tin "giảm thêm 200k nếu mua 20 bao" cho phép AI áp 20.000đ vì số "20" của "20 bao" bị coi là nghìn đồng.
- `server/src/utils/text.js`: `mentionedNumbers` trả thêm `qty` (số lượng). Số không đơn vị đứng ngay trước đơn vị hàng (bao, kg, chai, cái, gói, thùng, hộp, túi, bịch, can, lít, sp, sản phẩm) hoặc đứng sau "mua / từ / tối thiểu / ít nhất" là số lượng và không vào `money`. "giảm 200" vẫn là 200.000đ. Chưa dùng `unit` của sản phẩm trong DB (dùng danh sách cố định).
- `server/src/agent/tools.js` (`apply_staff_discount`): nếu tin nhân viên có điều kiện số lượng thì `min_quantity` bắt buộc và phải nằm trong `qty`; thiếu hoặc lệch thì lỗi "Số lượng không khớp: ... Phải truyền min_quantity ..." để AI gọi lại. Tin không có điều kiện số lượng giữ hành vi cũ.
- `server/test/staffInstructions.test.js`: thêm 4 test (qty không vào money, min_quantity thiếu/lệch/đúng, "mua 20 bao" không cho 20000, tin không có điều kiện số lượng).
- Kết quả: `npm test` 348/348 qua (gồm `staffInstructionsTester.test.js`), `npm run build` client thành công.
- Cần soi: tin có số lượng không viết kèm đơn vị hàng hay từ khoá (vd "5 phần") sẽ vẫn bị coi là tiền nếu < 1000.
