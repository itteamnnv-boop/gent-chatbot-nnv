# Kế hoạch: Quản lý fanpage và chương trình khuyến mãi (theo từng Page hoặc áp dụng chung)

## ĐÃ CHỐT (2026-10-02)

Người dùng đã đồng ý **toàn bộ phương án mặc định (MĐ)** cho cả 11 câu bên dưới. Không còn câu hỏi bỏ ngỏ; coder triển khai đúng theo MĐ.

## Các câu hỏi đã được trả lời (giữ lại để tham khảo)

Kế hoạch dưới đây viết theo **phương án mặc định (MĐ)** của từng câu. **Coder KHÔNG bắt đầu khi người dùng chưa trả lời.** Nếu người dùng chọn khác MĐ thì phải sửa đúng các mục ghi trong ngoặc trước khi làm.

1. **"Quản lý fanpage" gồm những gì?** Trang `/admin/channels` (kết nối, ngắt kết nối, trạng thái token) đã có sẵn. MĐ: KHÔNG làm trang fanpage mới. Chỉ thêm vào bảng Page một cột "Khuyến mãi riêng" (số chương trình riêng của Page đó đang chạy hoặc sắp chạy), kèm link sang trang Khuyến mãi đã lọc theo Page. Phương án khác (người dùng phải chỉ rõ): đặt tên hiển thị riêng, bật/tắt AI theo từng Page, lời chào hay hướng dẫn riêng cho từng Page... (Mục 2.6, 3.4)
2. **Loại khuyến mãi.** MĐ: chỉ giảm giá **trên đơn giá từng sản phẩm**, có 2 kiểu: `percent` (giảm %) và `fixed` (giảm số tiền cố định trên mỗi đơn vị). Áp cho *tất cả sản phẩm* hoặc *danh sách sản phẩm chọn sẵn*. KHÔNG làm giảm theo tổng đơn, miễn phí ship, mua X tặng Y, mã giảm giá, điều kiện số lượng hay giá trị đơn tối thiểu, áp theo danh mục. (Mục 2.1, 2.2)
3. **Cộng dồn và ưu tiên.** MĐ: **không cộng dồn**. Với mỗi sản phẩm, trong các chương trình đang áp dụng được (cả loại riêng của Page lẫn loại chung), chọn chương trình cho **giá cuối thấp nhất**. Hai chương trình cho cùng giá thì ưu tiên loại riêng của Page, sau đó đến `_id` nhỏ hơn. Phương án khác: (B) có chương trình riêng của Page thì bỏ qua toàn bộ chương trình chung; (C) cộng dồn. (Mục 2.2 `pickBestPromotion`)
4. **Nền để tính giảm.** MĐ: tính trên `effectivePrice`, tức `salePrice` nếu có, không thì `price`. Nghĩa là khuyến mãi chồng lên giá sale của sản phẩm. Phương án khác: tính trên `price` gốc rồi lấy giá thấp hơn giữa kết quả đó và `salePrice`. (Mục 2.2)
5. **Thời hạn.** MĐ: `startAt` và `endAt` đều tuỳ chọn, giờ chính xác tới phút. Chương trình hiệu lực khi `active && (startAt null hoặc startAt <= now) && (endAt null hoặc now < endAt)`. Không có lịch lặp (vd "mỗi thứ 6"). (Mục 2.1, 2.2)
6. **Kênh không có pageId hợp lệ** (Website, WhatsApp, Chat thử, Instagram). `conversation.pageId` của Instagram là ID tài khoản IG, không trùng ID MetaPage. MĐ: các kênh này **chỉ nhận chương trình chung**. Chương trình chung áp cho **mọi kênh**, kể cả Chat thử. Chat thử không chọn được Page để giả lập. (Mục 2.2, 2.4)
7. **AI có được tự nhắc khuyến mãi không?** MĐ: CÓ. System prompt liệt kê các chương trình đang hiệu lực cho hội thoại. AI được nhắc khi tư vấn sản phẩm liên quan, nhưng không được nhắc dồn dập, và không được hứa khuyến mãi nằm ngoài danh sách. (Mục 2.4)
8. **Khuyến mãi đổi hoặc hết hạn giữa lúc thêm giỏ và lúc chốt đơn.** MĐ: `create_order` tính lại giá. Nếu có dòng nào lệch giá so với giỏ thì KHÔNG tạo đơn, cập nhật giá mới vào giỏ, rồi trả lỗi để AI báo lại tổng mới và xin khách xác nhận lại. Áp dụng cho cả kênh `test`. Phương án khác: lặng lẽ dùng giá mới như hiện nay. (Mục 2.3 `create_order`)
9. **Lưu vết trên đơn.** MĐ: mỗi dòng đơn lưu `listPrice` (giá trước khuyến mãi) và `promotion { id, name }`. Đơn lưu thêm `pageId`. Trang Đơn hàng hiện tên khuyến mãi dưới từng dòng. Không làm báo cáo hay thống kê theo khuyến mãi. (Mục 2.1, 3.3)
10. **Quyền.** MĐ: thêm 2 quyền mới `promotions.view` và `promotions.manage`, nhóm "Khuyến mãi". Phương án khác: gộp vào `products.view` / `products.manage`. (Mục 2.5, 3)
11. **Page bị ngắt kết nối.** MĐ: KHÔNG sửa hay xoá chương trình chứa Page đó. Chương trình vẫn lưu `pageId`, không áp cho ai (Page không còn gửi tin tới), và tự hoạt động lại khi kết nối lại. Giao diện ghi "(đã ngắt kết nối)". Khi lưu chương trình chỉ được chọn Page đang có trong MetaPage. Các Page đã ngắt sẵn trong chương trình thì vẫn được giữ khi sửa. (Mục 2.2 `validatePromotionInput`, 3.2)

---

## 0. Bối cảnh (coder không cần tra lại)

- Server: Node ≥ 20, ESM, Express 5, Mongoose 9. **Không thêm dependency.** KHÔNG đọc hay sửa `server/.env`. **KHÔNG đụng `server/src/routes/webhook.js`**, vì file này đang có 2 dòng `console.log` debug của người dùng.
- Giá hiện lấy từ virtual `Product.effectivePrice` (`server/src/models/Product.js`) ở 4 chỗ trong `server/src/agent/tools.js`: `productSummary` (dòng 64–77), lọc `max_price` trong `search_products`, `update_cart` (gán `price` vào giỏ), và `create_order` (đọc lại giá khi trừ kho). Tổng tiền tính bằng `cartTotals` / `describeCart` trong `server/src/services/cart.js` theo công thức `item.price * item.quantity`. Phí ship lấy từ `settings`.
- `runAgent` (`server/src/agent/agent.js`) tạo `ctx = { conversation, customer, settings, events }` rồi gọi `buildSystemPrompt` (`server/src/agent/prompt.js`).
- `conversation.pageId` (`server/src/models/Conversation.js`) chỉ được gán cho Messenger/Instagram. Các kênh khác có `pageId = ''`.
- Seed: `NPK-16168` có `price 420000`, `salePrice 399000` (nên `effectivePrice = 399000`). `URE-46` có giá 650000, không có sale.

## 1. Mô hình nghiệp vụ (theo MĐ)

Chương trình khuyến mãi (Promotion) gồm các thuộc tính sau:
- Phạm vi Page `scope`: `'all'` (áp dụng chung) hoặc `'pages'` (chỉ áp cho các `pageIds`). **Không dùng "mảng rỗng = tất cả"**. Bỏ hết Page khỏi một chương trình không bao giờ được biến nó thành chương trình chung.
- Phạm vi sản phẩm `productScope`: `'all'` hoặc `'products'` (chỉ áp cho các `productIds`).
- Mức giảm `type` / `value`: `percent` thì `value` thuộc khoảng (0, 100]; `fixed` thì `value` là số nguyên VND > 0, trừ trên mỗi đơn vị.
- `startAt`, `endAt`, `active` như câu 5.

Giá cuối của 1 sản phẩm: `base = product.effectivePrice`. Kiểu `percent` thì `Math.round(base * (100 - value) / 100)`. Kiểu `fixed` thì `Math.max(0, base - value)`. Chọn chương trình tốt nhất theo câu 3. Nếu không có chương trình nào cho giá `< base` thì không gắn khuyến mãi.

## 2. Server

### 2.1 Model

**TẠO `server/src/models/Promotion.js`.** Copy kiểu khai báo từ `server/src/models/MetaPage.js`.
```js
export const PROMO_TYPES = ['percent', 'fixed'];
export const PROMO_SCOPES = ['all', 'pages'];
export const PRODUCT_SCOPES = ['all', 'products'];
// schema, { timestamps: true }
name:         { type: String, required: true, trim: true, maxlength: 120 }
description:  { type: String, default: '', maxlength: 1000 }   // AI đọc để giới thiệu cho khách
type:         { type: String, enum: PROMO_TYPES, required: true }
value:        { type: Number, required: true, min: 0 }
scope:        { type: String, enum: PROMO_SCOPES, default: 'all' }
pageIds:      { type: [String], default: [] }
productScope: { type: String, enum: PRODUCT_SCOPES, default: 'all' }
productIds:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }]
startAt:      { type: Date, default: null }
endAt:        { type: Date, default: null }
active:       { type: Boolean, default: true }
createdBy:    { type: String, default: '' }   // username
// index: { active: 1, scope: 1 }
export const Promotion = mongoose.model('Promotion', promotionSchema);
```

**SỬA `server/src/models/Conversation.js`.** Thêm 2 trường vào `cartItemSchema`:
`listPrice: Number` và `promotion: { type: { _id: false, id: mongoose.Schema.Types.ObjectId, name: String }, default: null }`.

**SỬA `server/src/models/Order.js`.** Thêm đúng 2 trường trên vào `orderItemSchema`, và thêm `pageId: { type: String, default: '' }` vào `orderSchema`.

### 2.2 TẠO `server/src/services/promotionService.js`

Quy ước: export hàm có tên, giống `server/src/services/metaPageService.js`. Hàm tính giá phải là **hàm thuần** (không truy vấn DB) để test trực tiếp được.

```js
// Hình dạng "promo" dùng chung (plain object):
// { id: String, name, description, type, value, scope, pageIds: [String],
//   productScope, productIds: [String], productNames: [String], startAt, endAt }

export function isRunning(promo, now = new Date())          // active && trong khung thời gian (câu 5)
export function promotionState(doc, now = new Date())       // 'off' | 'scheduled' | 'running' | 'ended'
  // !active -> 'off'; startAt > now -> 'scheduled'; endAt <= now -> 'ended'; còn lại 'running'

export async function activePromotionsFor(pageId, now = new Date())
  // Promotion.find({ active: true, startAt null|<=now, endAt null|>now,
  //   $or: [{ scope: 'all' }, ...(pageId ? [{ scope: 'pages', pageIds: pageId }] : [])] })
  //   .populate('productIds', 'name').lean()
  // -> mảng promo (productIds -> String id, productNames -> tên). pageId rỗng thì CHỈ lấy scope 'all'.
  // Sắp xếp: scope 'pages' trước, rồi endAt gần nhất trước (null cuối), rồi _id tăng dần.

export function discountedPrice(base, promo)                 // công thức ở Mục 1, luôn là số nguyên >= 0
export function appliesToProduct(promo, productId)           // productScope 'all' || productIds.includes(String(productId))

export function pickBestPromotion(product, promotions = [])
  // -> { price, listPrice, promotion: { id, name } | null }
  // listPrice = product.effectivePrice. Chọn theo câu 3. Không có hoặc không giảm được -> { price: listPrice, listPrice, promotion: null }.

export function promotionRow(doc, now = new Date())
  // -> { _id, name, description, type, value, scope, pageIds, productScope, productIds (String),
  //      startAt, endAt, active, createdBy, createdAt, updatedAt, state: promotionState(doc, now) }

export async function validatePromotionInput(body, existing = null)
  // -> { data } | { error }. Chỉ nhận đúng các trường:
  //    name, description, type, value, scope, pageIds, productScope, productIds, startAt, endAt, active.
  // existing = doc đang sửa (PUT) hoặc null (POST). Kết quả là giá trị cuối sau khi gộp body với existing.
```

Quy tắc `validatePromotionInput`. Lỗi nào cũng trả **chính xác** chuỗi ghi bên dưới:
- `name` sau `trim` phải dài 1–120 ký tự → `'Tên chương trình 1–120 ký tự'`. `description` phải là chuỗi ≤ 1000 ký tự → `'Mô tả tối đa 1000 ký tự'`.
- `type` phải nằm trong `PROMO_TYPES` → `'Loại giảm giá không hợp lệ'`.
- `value` phải là number hữu hạn. Với `percent` thì `0 < value <= 100`. Với `fixed` thì là số nguyên `> 0`. Sai → `'Mức giảm không hợp lệ'`.
- `scope` phải nằm trong `PROMO_SCOPES`. Khi `scope === 'pages'`, `pageIds` phải là mảng 1–100 phần tử, mỗi phần tử khớp `/^\d{1,32}$/`. Loại trùng. Mỗi id phải có trong `MetaPage` **hoặc** đã nằm trong `existing.pageIds` (câu 11). Sai → `'Phải chọn ít nhất một Page hợp lệ'`. Khi `scope === 'all'` thì đặt `pageIds = []`.
- `productScope` phải nằm trong `PRODUCT_SCOPES`. Khi là `'products'`, `productIds` phải là mảng 1–500 phần tử, mỗi phần tử là ObjectId hợp lệ và có tồn tại trong `Product` (dùng `countDocuments` sau khi loại trùng). Sai → `'Phải chọn ít nhất một sản phẩm hợp lệ'`. Khi là `'all'` thì đặt `productIds = []`.
- `startAt` / `endAt`: chấp nhận `null`, `''` (coi như `null`), hoặc chuỗi ISO parse được ra Date. Parse không được → `'Thời gian không hợp lệ'`. Có cả hai mà `endAt <= startAt` → `'Thời gian kết thúc phải sau thời gian bắt đầu'`.
- `active`, nếu có gửi, phải là boolean → `'Trạng thái không hợp lệ'`.

### 2.3 SỬA `server/src/agent/tools.js`

- `ctx.promotions` là mảng promo, do `runAgent` nạp (Mục 2.4). Trong handler, đọc bằng `ctx.promotions ?? []`.
- `productSummary(p, promotions)`: lấy `const r = pickBestPromotion(p, promotions)`, rồi:
  - `price: r.price`
  - `original_price: p.price > r.price ? p.price : undefined`
  - `promotion: r.promotion?.name` (undefined nếu không có khuyến mãi)

  Hai nơi đang gọi hàm này (`search_products`, `get_product_details`) phải truyền thêm `ctx.promotions`. `get_product_details` hiện chưa nhận `ctx`, cần thêm tham số.
- `search_products`: lọc `max_price` theo `pickBestPromotion(p, ctx.promotions).price`.
- `update_cart`: khi thêm hoặc sửa một dòng, gán `price`, `listPrice`, `promotion` lấy từ `pickBestPromotion` (thay cho `p.effectivePrice`). Các dòng khác trong giỏ giữ nguyên.
- `create_order` (MĐ câu 8). Chèn **trước** nhánh `channel === 'test'` một bước kiểm giá:
  1. Với mỗi dòng giỏ: `Product.findById(item.product)`. Không có hoặc `!active` thì trả `{ error: \`Sản phẩm "${item.name}" không còn bán.\` }`.
  2. Tính `r = pickBestPromotion(p, promotions)`. Nếu `r.price !== item.price` thì đánh dấu có thay đổi, rồi gán `item.price/listPrice/promotion` theo `r`.
  3. Có thay đổi thì `await conversation.save()` và trả về
     `{ error: 'Giá đã thay đổi do khuyến mãi thay đổi hoặc hết hạn. Báo khách giỏ hàng và tổng tiền mới, xin xác nhận lại rồi mới tạo đơn.', cart: describeCart(conversation.cart, settings) }`. KHÔNG trừ kho, KHÔNG tạo đơn.
  - Nhánh trừ kho hiện có: dùng `pickBestPromotion(p, promotions)` cho `price`, `listPrice`, `promotion`, `lineTotal` của từng dòng đơn (thay cho `p.effectivePrice`). `Order.create` thêm `pageId: conversation.pageId || ''`.
  - Nhánh `test` giữ nguyên, chỉ khác là chạy sau bước kiểm giá.
- KHÔNG thêm tool mới (test hiện có kiểm `tools.length === 9`).

**SỬA `server/src/services/cart.js`.** Trong `describeCart`, mỗi item thêm `original_price: i.listPrice > i.price ? i.listPrice : undefined` và `promotion: i.promotion?.name`. Đoạn `display` của từng dòng: khi có `i.promotion` thì nối thêm ` (KM: ${i.promotion.name})` ngay sau `x${i.quantity}`. `cartTotals` giữ nguyên.

### 2.4 SỬA `server/src/agent/agent.js` và `server/src/agent/prompt.js`

- `runAgent`: nạp `const promotions = await activePromotionsFor(conversation.pageId, new Date())`, đặt `ctx = { conversation, customer, settings, promotions, events: [] }` và truyền `promotions` vào `buildSystemPrompt`.
- `buildSystemPrompt({ ..., promotions = [], now })`: thêm mục ngay sau "# Thanh toán" và **chỉ khi** `promotions.length > 0`:
  ```
  # Khuyến mãi đang áp dụng cho khách này
  - <name>: giảm <value>% | giảm <formatVND(value)>/<đơn vị sản phẩm>; áp dụng: tất cả sản phẩm | <tối đa 10 tên, quá thì thêm "…">; đến <endAt dạng vi-VN Asia/Ho_Chi_Minh> | không thời hạn. <description nếu có>
  ```
  Chỉ in tối đa 20 dòng, theo thứ tự `activePromotionsFor` đã sắp. Với kiểu `fixed`, ghi "giảm <số tiền>/sản phẩm".
- Thêm 2 gạch đầu dòng vào "# Quy tắc bắt buộc", ngay sau dòng "Không hứa giảm giá…":
  - `- Giá trong kết quả công cụ đã trừ khuyến mãi; không tự trừ thêm. Chỉ nhắc khuyến mãi có trong mục "Khuyến mãi đang áp dụng", nhắc khi liên quan tới sản phẩm khách quan tâm, không lặp lại liên tục.`
  - `- Nếu create_order báo giá đã thay đổi: báo khách giỏ hàng và tổng tiền mới, xin xác nhận lại.`

### 2.5 SỬA `server/src/permissions.js` (MĐ câu 10)

Chèn 2 dòng ngay **sau** `channels.manage`, trước `users.manage`:
```js
{ key: 'promotions.view', label: 'Xem chương trình khuyến mãi', group: 'Khuyến mãi' },
{ key: 'promotions.manage', label: 'Thêm / sửa / xoá chương trình khuyến mãi', group: 'Khuyến mãi' },
```
Tổng số quyền thành 17.

### 2.6 SỬA `server/src/routes/admin.js`

Thêm khối `// ---------- Khuyến mãi ----------` ngay sau khối "Kết nối Facebook Page". Dùng các helper sẵn có `bad`, `notFound`, `validId`. Mỗi route có đúng 1 `requirePermission`.

| Method | Path | Quyền | Response |
|---|---|---|---|
| GET | `/promotions` | `promotions.view` | `{ promotions: [promotionRow], pages: [{ pageId, name, status }], products: [{ _id, sku, name, effectivePrice, active }] }`. Promotions sắp xếp `createdAt: -1`. Pages lấy từ `MetaPage` (không select token), products sắp xếp `name: 1`. |
| POST | `/promotions` | `promotions.manage` | 201 `promotionRow`. Lỗi validate thì 400 `{ error }`. Gán `createdBy = req.user.username`. |
| PUT | `/promotions/:id` | `promotions.manage` + `validId` | `promotionRow`. Không có thì `notFound`. Gọi `validatePromotionInput(req.body, doc)`, rồi `doc.set(data)`, `save`. |
| DELETE | `/promotions/:id` | `promotions.manage` + `validId` | `{ ok: true }`. Không có thì `notFound`. |

Sửa `GET /meta/pages`: mỗi phần tử `pages` thêm `promotionCount`, tính bằng **một** truy vấn
`Promotion.find({ active: true, scope: 'pages', $or: [{ endAt: null }, { endAt: { $gt: new Date() } }] }).select('pageIds').lean()`
rồi đếm theo `pageId`. Kết quả có cả chương trình đang chạy lẫn sắp chạy. Không sửa `pageRow` trong service. Response vẫn không được chứa token.

## 3. Client

Copy cấu trúc và class từ `client/src/pages/Products.jsx` (`page-head`, `page-title`, `card table-wrap`, `Modal` + `form-grid`, `label.check`, `span-2`, `badge badge-ok`, `btn-ghost danger`, `p.error`, `form-actions`). **Không thêm CSS mới.** Lấy `me` bằng `useOutletContext()`. Định dạng bằng `formatVND`, `formatTime` trong `client/src/format.js`.

### 3.1 SỬA `client/src/components/Icons.jsx`, `client/src/pages/AdminLayout.jsx`, `client/src/App.jsx`
- Icons: thêm `tag: 'M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z'`.
- `RAIL`: chèn `{ to: '/admin/promotions', label: 'Khuyến mãi', icon: 'tag', perm: 'promotions.view' }` ngay sau mục Kênh kết nối.
- `App.jsx`: thêm `<Route path="promotions" element={<RequirePermission perm="promotions.view"><Promotions /></RequirePermission>} />`.

### 3.2 TẠO `client/src/pages/Promotions.jsx`
- `canManage = can(me, 'promotions.manage')`. `load()` gọi `api('/admin/promotions')`.
- Tiêu đề "Khuyến mãi". Nút "+ Thêm chương trình" chỉ hiện khi `canManage`. Thêm dòng `<p className="muted">` "Khuyến mãi chung áp dụng cho mọi kênh (Website, WhatsApp, Instagram, Chat thử và mọi Page). Khuyến mãi riêng chỉ áp dụng cho tin nhắn đến từ Page đã chọn. Mỗi sản phẩm chỉ nhận một khuyến mãi có giá tốt nhất."
- Ô lọc `<select>`: "Tất cả" | "Áp dụng chung" | từng Page (theo `pages`). Giá trị khởi tạo lấy từ `?page=<pageId>` qua `useSearchParams()`. Lọc ngay trên client.
- Bảng có các cột:
  - **Tên** (`name`, dưới là `description` dạng muted).
  - **Mức giảm** (`10%` hoặc `formatVND(value)`).
  - **Áp dụng cho**: "Tất cả Page/kênh", hoặc tên các Page. `pageId` không có trong `pages` thì hiện `pageId + ' (đã ngắt kết nối)'`.
  - **Sản phẩm**: "Tất cả", hoặc "N sản phẩm" kèm `title` liệt kê tên.
  - **Thời gian**: `formatTime(startAt) – formatTime(endAt)`. Thiếu đầu nào thì ghi "—".
  - **Trạng thái**: `running` hiện `badge badge-ok` "Đang chạy"; `scheduled` "Sắp chạy"; `ended` "Đã kết thúc"; `off` "Đang tắt" (3 trạng thái sau dùng `badge`).
  - **Thao tác**: nút Sửa/Xoá, chỉ hiện khi `canManage`. Xoá hỏi `window.confirm(\`Xoá chương trình "${p.name}"?\`)`.
  - Danh sách rỗng thì hiện một dòng "Chưa có chương trình khuyến mãi."
- Form trong `Modal`, gồm các trường:
  - Tên (required), Mô tả (textarea).
  - Loại (`select`: Giảm theo % / Giảm số tiền mỗi sản phẩm), Mức giảm (number, `min` 0).
  - Phạm vi Page: radio "Áp dụng chung" / "Chỉ các Page đã chọn". Chọn "Chỉ các Page" thì hiện danh sách checkbox Page. Page đã ngắt nhưng đang có trong chương trình vẫn hiện, kèm "(đã ngắt kết nối)".
  - Phạm vi sản phẩm: radio "Tất cả sản phẩm" / "Sản phẩm đã chọn". Chọn "Sản phẩm đã chọn" thì hiện danh sách checkbox sản phẩm `name (sku) – formatVND(effectivePrice)`.
  - Bắt đầu, Kết thúc: `input type="datetime-local"`. Khi gửi thì đổi bằng `value ? new Date(value).toISOString() : null`. Khi mở form sửa thì đổi ISO sang chuỗi local `YYYY-MM-DDTHH:mm`.
  - Checkbox "Đang bật".
  - Lỗi server hiện trong `<p className="error span-2">`.

### 3.3 SỬA `client/src/pages/Orders.jsx`
Trong phần chi tiết đơn, với dòng có `i.promotion`: dưới tên sản phẩm thêm `<div className="muted">KM: {i.promotion.name}</div>`, và nếu `i.listPrice > i.price` thì thêm `<div className="muted strike">{formatVND(i.listPrice * i.quantity)}</div>` dưới thành tiền. Không đổi gì khác.

### 3.4 SỬA `client/src/pages/Channels.jsx` (MĐ câu 1)
Thêm cột "Khuyến mãi riêng" ngay sau cột Trạng thái (nhớ cập nhật `colSpan` từ 6 lên 7). Ô hiển thị `p.promotionCount`. Nếu `can(me, 'promotions.view')` thì ô là `<Link to={\`/admin/promotions?page=${p.pageId}\`}>`, lấy `Link` từ `react-router-dom`.

## 4. Test

Giả lập LLM bằng `scriptedClient` / `toolCall` / `say`, copy y nguyên từ `server/test/agent.test.js`. Khung HTTP (`createApp`, `server.listen(0)`, `call()`, staff + `tokenOf`) và cách bọc `globalThis.fetch` cho `graph.facebook.com` (trả `200 {}` cho `me/messages`, để Messenger không ghi lỗi gửi tin) copy từ `server/test/metaPages.test.js`. Không gọi API thật.

### 4.1 SỬA test cũ
- `server/test/users.test.js` dòng 67: đổi `15` thành `17`.
- Các test khác phải giữ nguyên kết quả. Seed không có khuyến mãi nên giá trong `agent.test.js` không đổi.

### 4.2 TẠO `server/test/promotions.test.js`
`before`: `connectDB('memory')`, `seedDatabase()`, tạo trực tiếp `MetaPage` `'111'` và `'222'` (accessToken `'TOK'`), khởi động app. Mỗi ca tự dọn bằng `Promotion.deleteMany({})`.

Hàm thuần:
1. `discountedPrice`: percent 10 trên 399000 cho 359100; fixed 50000 cho 349000; fixed lớn hơn giá cho 0; percent 100 cho 0.
2. `pickBestPromotion`: chọn giá thấp nhất giữa loại chung và loại riêng; hoà giá thì chọn loại riêng; sản phẩm không thuộc `productIds` thì `promotion: null`; base tính trên `effectivePrice` (NPK-16168 có `listPrice = 399000`).
3. `promotionState` đủ 4 trạng thái.

`activePromotionsFor`:
4. `pageId '111'` nhận loại chung và loại riêng của 111, không nhận loại của 222. `pageId ''` chỉ nhận loại chung. Bỏ qua chương trình `active: false`, chưa tới `startAt`, hoặc đã qua `endAt` (`endAt === now` coi là hết hạn).

API:
5. Staff không có `promotions.view` gọi GET thì nhận 403. Staff chỉ có `promotions.view` gọi POST thì nhận 403.
6. POST 400 với đúng thông báo cho từng trường hợp: percent 0, percent 101, fixed 1.5, `scope: 'pages'` với `pageIds: []`, pageId không tồn tại, productId sai định dạng, productId không tồn tại, `endAt <= startAt`.
7. Tạo, sửa, xoá thành công. GET trả `pages` (không chứa `'TOK'`) và `products`. Xoá lại lần nữa thì nhận 404.
8. Câu 11: tạo chương trình riêng của 111, xoá MetaPage 111, rồi PUT đổi tên vẫn 200 và `pageIds` vẫn giữ `'111'`. Tạo mới với `'111'` thì 400.
9. `GET /api/admin/meta/pages` có `promotionCount` đúng: 1 cho 111 và 0 cho 222, khi có 1 chương trình riêng 111 và 1 chương trình chung.

Agent (dùng `handleIncomingMessage` với `client` giả):
10. Promo riêng 111, giảm 10% cho NPK-16168. Hội thoại `messenger`, `pageId: '111'`, gọi `search_products` "phan bon cho lua". Kết quả tool có NPK-16168 với `price 359100`, `original_price 420000`, có tên promotion. System prompt có mục "Khuyến mãi đang áp dụng" chứa tên chương trình. Cùng kịch bản với `pageId '222'` thì giá 399000 và prompt **không** có mục khuyến mãi.
11. Promo chung, fixed 50000 cho tất cả sản phẩm. Hội thoại `web`: `update_cart` NPK-16168 x2, `save_customer_info`, `create_order` true. Đơn có `subtotal = 2*349000`, `items[0].listPrice = 399000`, `items[0].promotion.name` đúng, `pageId = ''`. Hội thoại messenger 111 có cả promo chung lẫn promo riêng 10%: đơn dùng giá 349000 (thấp hơn) và `order.pageId = '111'`.
12. Câu 8: thêm giỏ khi promo đang bật, đặt `active: false` trực tiếp trong DB, rồi `create_order` true. Kết quả tool có `error` chứa "Giá đã thay đổi", không tạo `Order`, tồn kho không đổi, `cart[0].price` thành 399000. Lặp lại kịch bản trên kênh `test`: cũng trả lỗi, không có `test_mode`.
13. Kênh `test` / `web` (pageId rỗng) không bao giờ nhận promo riêng của Page.

Chạy `cd server && npm test`: toàn bộ test phải xanh.

## 5. Tài liệu: SỬA `README.md`
- Mục "Trang quản trị" (khoảng dòng 121–136): thêm gạch đầu dòng **Khuyến mãi**, mô tả áp chung hoặc theo Page, không cộng dồn, chọn giá tốt nhất. Thêm vào gạch **Kênh kết nối**: "xem số khuyến mãi riêng của từng Page".
- Bảng "API chính": thêm 4 route `/api/admin/promotions`.

## 6. Ngoài phạm vi (KHÔNG làm)
Các loại khuyến mãi ở câu 2 phần "KHÔNG làm", mã giảm giá, báo cáo theo khuyến mãi, chọn Page trong Chat thử, cấu hình riêng cho từng Page (trừ khi câu 1 đổi), sửa `server/src/routes/webhook.js`, CSS mới, thư viện mới.
