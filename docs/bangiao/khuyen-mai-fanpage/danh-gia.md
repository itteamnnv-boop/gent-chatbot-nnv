PHAN QUYET: CHOT

# Đánh giá lần cuối: Khuyến mãi theo Page / áp dụng chung (sau Vòng sửa 2)

Phạm vi đã xem: `git diff 6ea9270` cùng các file chưa track. Đã bỏ qua `server/src/routes/webhook.js`, `.claude/settings.local.json` và `.bangiao/_raw.txt`.

Theo thời gian sửa file, sau lần đánh giá trước chỉ có 4 file thay đổi: `server/src/agent/agent.js`, `server/src/agent/tools.js`, `server/test/promotions.test.js` và `server/test/promotionsTester.test.js`. Các file khác giữ nguyên như lúc đã được đánh giá ở vòng trước.

Reviewer tự chạy `cd server && npm test`: **165/165 đạt**, 0 rớt, 0 bỏ qua. Kết quả khớp `.bangiao/ket-qua-test.md`.

## Xác minh 3 sửa đổi

### 1. (Bắt buộc) `server/src/agent/agent.js` dòng 29–32: đã sửa đúng
```js
const promoPageId = conversation.channel === 'messenger' ? conversation.pageId : '';
const promotions = await activePromotionsFor(promoPageId, new Date());
```
- Chỉ Messenger được nạp khuyến mãi riêng của Page. Website, WhatsApp, Chat thử và Instagram truyền `''`, nên chỉ nhận chương trình chung (câu 6). Quy tắc này giống `server/src/channels/index.js` dòng 10.
- `activePromotionsFor` chỉ được gọi ở đúng một chỗ này. Mọi tool đều lấy khuyến mãi qua `ctx.promotions`, nên không còn đường nào bỏ qua điều kiện kênh.
- Đã có test cho trường hợp ID trùng: `server/test/promotions.test.js` dòng 284–299. Instagram dùng `pageId '111'` trùng với Page có khuyến mãi riêng. Test kiểm 3 điều:
  - giá NPK-16168 là 399000 và không có `promotion`;
  - system prompt không có `# Khuyến mãi đang áp dụng`;
  - đơn Instagram có `pageId ''` và `promotion` là null.
- Tester đã thử gỡ sửa đổi này (kiểm đột biến) và test bắt được.

### 2. (Nên sửa, đã làm) `server/src/agent/tools.js` dòng 282: đã sửa đúng
`pageId: conversation.channel === 'messenger' ? conversation.pageId || '' : ''`
- Đơn Messenger vẫn lưu đúng pageId. Test `promotions.test.js` dòng 281 kiểm `fb.pageId === '111'`.
- Đơn Instagram và web có `pageId ''`. Kiểm ở dòng 274 và 298.
- Kiểm đột biến bắt được.

### 3. (Nên sửa, đã làm) `server/src/agent/tools.js` dòng 265–266: đã sửa đúng
- Nhánh trừ kho dùng `item.price/listPrice/promotion`. Các giá trị này đã được đồng bộ ở bước kiểm giá (dòng 217–225). Nếu có dòng nào lệch giá thì hàm đã trả lỗi ở dòng 226–232, nên tới đây giá trên đơn đúng bằng giá khách đã xác nhận.
- `lineTotal = item.price * item.quantity`. `cartTotals(items)` ở dòng 273 tính subtotal/total từ chính các dòng đó, nên tổng tiền nhất quán.
- Dòng giỏ cũ chưa có `listPrice` vẫn ổn, vì bước kiểm giá đã ghi `listPrice` trước khi tới nhánh này.
- `sku/name/unit` vẫn lấy từ document mới nhất. Kiểu `promotion` (`{id, name}`, `_id: false`) giống nhau ở cả Conversation và Order, nên sao chép subdocument không lỗi. Test dòng 348 xác nhận tên khuyến mãi lưu đúng.
- Tester đã thêm test `promotionsTester.test.js` dòng 327–352. Test bọc `Product.findOneAndUpdate` để giả lập admin đổi giá giữa hai bước, khẳng định đơn giữ 600000 / 650000 / 'URE -50k' / 1.200.000, và trả lại hàm gốc trong `finally`. Gỡ sửa đổi thì test rớt (950000 !== 600000). Test này có giá trị thật.

## Trả lời ba câu hỏi

### 1. Code có khớp kế hoạch không?
Có. Mọi điểm đã xác nhận khớp ở vòng trước vẫn giữ nguyên. Mục bắt buộc duy nhất của vòng trước đã được sửa. Hai sửa đổi thêm làm code chặt hơn kế hoạch mục 2.3 về `Order.pageId` và giá trên đơn, nhưng không đổi hành vi mà người dùng đã chốt (câu 6, câu 8). Vẫn giữ 9 tool, 17 quyền và 4 route.

### 2. Test có giá trị thật không?
Có.
- Test mới dùng ID cố tình trùng, đúng tình huống mà test cũ (dùng ID IG thật) bỏ lọt.
- Test nhánh trừ kho giả lập đúng khoảng thời gian giữa hai bước.
- Tester đã kiểm đột biến riêng cho từng sửa đổi, và test bắt được cả 3.
- Các test cũ về lệch giá trên kênh web, messenger và test (không tạo đơn, không trừ kho, xác nhận lại thì chốt giá mới) vẫn xanh.

### 3. Bảo mật, hiệu năng, tính đúng đắn
- Bảo mật: không có gì mới. Sửa đổi chỉ thêm điều kiện theo kênh, không thêm dữ liệu đầu vào mới.
- Hiệu năng: không đổi. Bỏ việc tính lại `pickBestPromotion` ở nhánh trừ kho nên còn nhẹ hơn một chút.
- Tính đúng đắn: phạm vi Instagram đã đúng câu 6. Giá trên đơn luôn bằng giá khách đã xác nhận. Không trừ hai lần, việc hoàn kho khi lỗi giữ nguyên.

## Còn lại (không tính vào phán quyết, người dùng chưa yêu cầu làm)
- `server/src/agent/tools.js` dòng 137: thiếu dấu cách ở `[]),description`, chỉ là định dạng.
- `client/src/pages/Promotions.jsx` dòng 53, 112–118: khi mở `?page=<id>` của Page đã ngắt, ô lọc hiện "Tất cả" trong khi bảng vẫn lọc theo Page đó.
- Form khuyến mãi (datetime-local, múi giờ) mới chỉ được build, chưa thử trên trình duyệt. Nên bấm thử bằng tay trước khi phát hành.

Kết luận: CHOT.
