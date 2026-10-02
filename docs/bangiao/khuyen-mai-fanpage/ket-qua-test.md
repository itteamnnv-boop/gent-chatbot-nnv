# Kết quả test: Vòng sửa 2 (khuyến mãi theo Page)

Nhánh: fix/kiem-tra-chot-don-bao-gia. Ngày chạy: 2026-10-02.

## Kết luận: ĐẠT, xanh hết

| Hạng mục | Kết quả |
|---|---|
| `cd server && npm test` (bản thật, sau khi thêm 1 test) | 165/165 đạt, 0 rớt (trước khi thêm test: 164/164) |
| `vite build` (client) | Thành công, built in 152ms |

Không có test nào rớt trên mã thật. Không sửa code sản phẩm, không commit, không đụng `webhook.js`, không đọc `server/.env`.

## Kiểm chứng test bắt được lỗi cũ (gỡ từng sửa đổi, trên bản sao ở scratchpad)

Mỗi sửa đổi được gỡ RIÊNG trên một bản sao riêng của `server/src` + `server/test`. Mã thật không bị đụng.

| Gỡ sửa đổi | Test bắt được? | Test rớt |
|---|---|---|
| (1) `agent.js`: `promoPageId = conversation.pageId` (bỏ điều kiện messenger) | Có | `Khuyến mãi > AI agent > kênh instagram dù pageId trùng "111" vẫn không nhận KM riêng của Page, đơn có pageId rỗng` |
| (2) `tools.js`: `Order.pageId = conversation.pageId \|\| ''` (bỏ điều kiện messenger) | Có | Cũng chính test Instagram ở trên (kiểm đơn có `pageId ''`) |
| (3) `tools.js`: nhánh trừ kho tính lại `pickBestPromotion(p, promotions)` trên document sau `findOneAndUpdate` | Không có test nào trước đó (chạy 164 test với bản gỡ (3) chỉ rớt `clientApi401`, xem lưu ý) | Sau khi thêm test mới: rớt đúng test mới |

Output khi gỡ (3) và chạy test mới:
```
✖ nhánh trừ kho dùng giá đã kiểm: giá/KM đổi sau bước kiểm giá (lúc trừ kho) không làm đổi giá trên đơn
  950000 !== 600000
```
(Mã thật chạy test này đạt.)

### Test mới (đã thêm)
`server/test/promotionsTester.test.js`, trong `create_order`:
"nhánh trừ kho dùng giá đã kiểm: giá/KM đổi sau bước kiểm giá (lúc trừ kho) không làm đổi giá trên đơn".
- Tạo KM cố định 50.000 cho URE-46, khách thêm giỏ 2 bao (giá 600.000), điền thông tin giao hàng.
- Bọc `Product.findOneAndUpdate` để ngay sau bước trừ kho, document trả về có `price = 1.000.000` (giả lập đổi giá giữa bước kiểm giá và bước trừ kho). Bản bọc được trả về nguyên trạng trong `finally`.
- Khẳng định đơn giữ đúng giá đã kiểm: `price` 600000, `listPrice` 650000, tên KM "URE -50k", `lineTotal`/`subtotal` 1.200.000, kết quả tool khớp đơn.

## Lưu ý
- Khi chạy trên bản sao ở scratchpad, `test/clientApi401.test.js` rớt cả ở 3 bản sao. Đây là hiện tượng của bản sao: test import `../../client/src/api.js` theo đường dẫn tương đối, mà bản sao không có thư mục `client` ở đó. Trên mã thật test này đạt (165/165). Không phải lỗi sản phẩm.
- Giao diện form khuyến mãi (datetime-local, múi giờ) vẫn chưa thử trên trình duyệt, chỉ build.
