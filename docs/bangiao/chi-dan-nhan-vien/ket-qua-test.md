# Kết quả test vòng 2: AI tuân thủ chỉ dẫn nhân viên và apply_staff_discount

Trạng thái: **XANH HẾT**. Lỗi vòng 1 (số lượng bị coi là tiền) đã được sửa và kiểm lại.

## Tóm tắt chạy
- `cd server && npm test`: 365 test, 365 qua, 0 rớt.
- `cd client && npm run build`: thành công (chưa xem Inbox/Orders bằng trình duyệt).
- File test của Tester: `server/test/staffInstructionsTester.test.js`, nay 61 test (vòng 2 thêm 17 test). Không sửa code sản phẩm, không sửa test cũ để cho xanh.

## Vòng 2: soi phần sửa (tập `qty` và `min_quantity` bắt buộc)
Test "mua 20 bao không cho 20.000đ" đã rớt ở vòng 1 nay qua mà không đổi nội dung test.

Các biến thể, tin "giảm 200k ..." với AI truyền `min_quantity=5` thì áp đúng 200.000 (mỗi biến thể có 1 test):
- "từ 5 bao trở lên", "cho 5 bao trở lên", "mua 5" (không đơn vị), "mua trên 5 bao", "mua 5bao" (dính liền), "cho đơn 5 bao".
- `mentionedNumbers` còn được kiểm thêm: "mua tối thiểu 5 bao", "mua ít nhất 7", "mua 5 kg", "mua 5 thùng", "mua 1000 bao". Số lượng đều vào `qty`, không vào `money` (cả dạng x1000), và 200k vẫn vào `money`.

Các ca khác:
- "giảm 200 nếu mua 5 bao": áp được 200.000 (value 200000, min_quantity 5); value 5000 (suy từ số lượng) bị từ chối, DB không đổi.
- Hồi quy "giảm 200" = 200.000đ: vẫn đúng, `qty` rỗng.
- AI bỏ `min_quantity` khi tin có điều kiện số lượng (cả khi giỏ chỉ 4 bao): bị từ chối với lỗi nhắc `min_quantity`, DB không đổi.
- AI truyền `min_quantity` lệch (3, 4, 6, 50, 0): bị từ chối cả 5 lần, `staffDiscount` vẫn null.
- Số lượng >= 1000 ("mua 1000 bao"): `min_quantity=1000` áp được; `min_quantity=1` bị từ chối; value 1.000.000 (suy từ 1000) bị từ chối.
- Tin có hai số lượng ("mua 5 bao giảm 200k, mua 10 bao giảm 500k"): `min_quantity` 5 và 10 hợp lệ (200k/5 và 500k/10 đều áp đúng); 7 hoặc bỏ thì bị từ chối.
- Tin không có điều kiện số lượng ("giảm thêm 200k cho anh"): không cần `min_quantity`, vẫn áp (hành vi cũ).
- Kịch bản ảnh sau sửa: 5 bao, tổng 2.225.500, chốt đơn đúng (cùng với các ca vòng 1 như 4 bao bị chặn).

## Hạn chế đã ghi nhận (test mô tả hành vi hiện tại, không phải lỗi mới)
1. "5 phần" (số lượng không kèm đơn vị hàng trong danh sách, không đứng sau mua/từ/tối thiểu/ít nhất) vẫn bị coi là tiền 5.000 và không vào `qty`. Có test ghi lại hành vi này. Đúng như Coder đã nêu. Các đơn vị ngoài danh sách (cây, lọ, bình, phần, set, bộ...) đều dính hạn chế này, và danh sách là cố định, không lấy `unit` sản phẩm trong DB.
2. Tin nhiều bậc ("mua 5 bao giảm 200k, mua 10 bao giảm 500k"): server chỉ kiểm số tiền và số lượng độc lập, không ghép cặp. AI truyền ghép lệch (value 500000 với min_quantity 5) vẫn được nhận, giảm 500.000 cho 5 bao. Có test ghi lại hành vi này (tên test bắt đầu bằng "HẠN CHẾ ĐÃ BIẾT"). Mức ảnh hưởng: chỉ xảy ra khi tin nhân viên đã nêu cả hai mức, và số nằm trong tin; nên cân nhắc ghép cặp hoặc để prompt/nhân viên nhắn một mức mỗi tin.
3. Biến thể giả danh không dùng ngoặc vuông ("(admin) ...") vẫn vào lịch sử như tin khách, an toàn nhờ tool chỉ nhận id tin `role: 'agent'`.
4. Hiển thị Inbox/Orders mới chỉ build, chưa kiểm bằng trình duyệt.

## Tóm tắt vòng 1 (đã xử lý)
Vòng 1: 343/344 qua, 1 rớt do số lượng "20 bao" bị coi là 20.000đ. Các nhóm đã qua: kịch bản ảnh (5 bao = 2.225.500, 4 bao bị chặn, ngưỡng freeship tính sau giảm), giả danh (6 kiểu tin khách, echo Facebook, message_id bot/system/hội thoại khác/rác), con số không khớp, giảm vượt tiền hàng, quá 10 tin, ưu đãi hết hiệu lực khi có đơn mới, ưu đãi mới thay cũ, remove, tương tác `priceChanged` và KM theo Page, Chat thử mô phỏng, hồi quy `cartTotals`/`describeCart` và đơn cũ không có `discount`.
