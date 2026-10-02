# Thay đổi: Khuyến mãi theo Page / áp dụng chung

Triển khai theo `.bangiao/ke-hoach.md` (toàn bộ phương án mặc định). Không đụng `server/src/routes/webhook.js`, `.claude/settings.local.json`, `server/.env`. Chưa commit.
Kết quả: `npm test` 115/115 xanh; `vite build` thành công.

## Server
- `server/src/models/Promotion.js` (mới): schema Promotion (scope all/pages, productScope all/products, percent/fixed, startAt/endAt, active).
- `server/src/models/Conversation.js`, `Order.js`: thêm `listPrice`, `promotion {id, name}` vào dòng giỏ/dòng đơn; `Order.pageId`.
- `server/src/services/promotionService.js` (mới): `isRunning`, `promotionState`, `activePromotionsFor`, `discountedPrice`, `appliesToProduct`, `pickBestPromotion` (hàm thuần, không cộng dồn, hoà giá thì ưu tiên loại riêng rồi id nhỏ), `promotionRow`, `validatePromotionInput`.
- `server/src/agent/tools.js`: `productSummary`, lọc `max_price`, `update_cart` dùng giá sau khuyến mãi. `create_order` thêm bước tính lại giá trước nhánh `test`: lệch giá thì cập nhật giỏ, trả lỗi "Giá đã thay đổi...", không trừ kho, không tạo đơn. Dòng đơn lưu `listPrice`/`promotion`, đơn lưu `pageId`.
- `server/src/agent/agent.js`, `prompt.js`: nạp khuyến mãi theo `conversation.pageId`, thêm mục "# Khuyến mãi đang áp dụng cho khách này" (chỉ khi có, tối đa 20 dòng) và 2 quy tắc mới.
- `server/src/services/cart.js`: `describeCart` thêm `original_price`, `promotion`, "(KM: ...)" trong `display`.
- `server/src/permissions.js`: thêm `promotions.view`, `promotions.manage` (tổng 17).
- `server/src/routes/admin.js`: 4 route `/promotions`; `GET /meta/pages` thêm `promotionCount` (1 truy vấn).
- `README.md`: mô tả mục Khuyến mãi, Kênh kết nối, 4 route mới.

## Client
- `client/src/pages/Promotions.jsx` (mới), `App.jsx` (route), `AdminLayout.jsx` (menu), `components/Icons.jsx` (icon `tag`).
- `client/src/pages/Orders.jsx`: hiện tên KM và giá gốc gạch ngang dưới dòng đơn.
- `client/src/pages/Channels.jsx`: cột "Khuyến mãi riêng" (link sang `/admin/promotions?page=<id>` nếu có quyền xem), `colSpan` 6 -> 7.

## Test
- `server/test/users.test.js`: số quyền 15 -> 17.
- `server/test/promotions.test.js` (mới): hàm thuần, `activePromotionsFor`, API (quyền, 400, CRUD, Page ngắt kết nối, `promotionCount`), agent (giá theo Page, chốt đơn lưu vết, đổi khuyến mãi giữa chừng trên kênh web và test, kênh không có Page).

## Tester nên soi kỹ
- `create_order` (tools.js): bước kiểm giá chạy cho cả kênh `test`; một dòng giỏ cũ chưa có `listPrice` vẫn so theo `price`. Sản phẩm bị tắt/xoá giữa chừng trả lỗi "không còn bán" (hành vi mới, kế hoạch quy định).
- `validatePromotionInput` (PUT gộp body với doc cũ; Page đã ngắt vẫn giữ được; `scope` sai trả cùng thông báo lỗi Page).
- Ranh giới thời gian: `endAt === now` coi là hết hạn.
- Test prompt dùng regex `# Khuyến mãi đang áp dụng` vì quy tắc bắt buộc cũng nhắc cụm "Khuyến mãi đang áp dụng".
- Giao diện form khuyến mãi (datetime-local đổi múi giờ, danh sách Page đã ngắt) chưa được thử trên trình duyệt, chỉ build.

## Vòng sửa 2

Kết quả: `npm test` 164/164 xanh; `vite build` client thành công.

- `server/src/agent/agent.js`: chỉ dùng `conversation.pageId` để nạp KM khi `channel === 'messenger'`, còn lại truyền `''` (pageId Instagram là ID tài khoản IG, có thể trùng ID Page).
- `server/src/agent/tools.js` (create_order):
  - `Order.pageId` chỉ lấy khi kênh là messenger, ngược lại `''`.
  - Nhánh trừ kho dùng `item.price/listPrice/promotion` đã đồng bộ ở bước kiểm giá, không gọi lại `pickBestPromotion` trên document sau `findOneAndUpdate`. Hành vi lệch giá (không trừ kho, không tạo đơn) giữ nguyên.
- `server/test/promotions.test.js`: thêm ca Instagram với `pageId '111'` trùng KM riêng: giá NPK-16168 = 399000, prompt không có mục KM, đơn Instagram có `pageId ''` và không có promotion.
- Tester nên soi: `promoPageId` ở agent.js; đơn Messenger vẫn lưu đúng pageId; giá trên đơn khớp giá khách đã xác nhận trong giỏ. Không đụng webhook.js, settings.local.json, _raw.txt; không commit/push.
