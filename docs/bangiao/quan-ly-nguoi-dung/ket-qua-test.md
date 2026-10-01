# Kết quả test: Vòng sửa 2 (ghi đè hoàn toàn file vòng trước)

## Tóm tắt: TẤT CẢ ĐẠT (không có test rớt)

| Hạng mục | Kết quả |
|---|---|
| `cd server && npm test` | ĐẠT: 40 test, 40 pass, 0 fail (35 cũ + 5 mới) |
| `vite build` của client (`client/`) | ĐẠT: built in 169ms, không lỗi |
| Test `active` dạng chuỗi có bắt được lỗi cũ không | CÓ (đã chứng minh bằng đột biến, xem dưới) |
| Test cho điều kiện 401 ở `client/src/api.js` | PHỦ, khả thi mà không sửa code sản phẩm và không thêm thư viện |

## Test thêm mới (chỉ file test)

`D:\00_DuAnTest\chatbot\server\test\clientApi401.test.js` (5 ca). Không tách hàm thuần vì không được sửa code sản phẩm. File này import trực tiếp `client/src/api.js` và giả lập `fetch`, `localStorage`, `window.location.assign` bằng stub, rồi kiểm tra hành vi của `api()`:
- 401 ở `/auth/me`: xoá token và chuyển về `/admin/login` (đường chạy thuận lợi).
- 401 ở `/admin/orders`: xoá token và chuyển về `/admin/login`.
- 403 hoặc 500 ở `/auth/me`: KHÔNG đăng xuất, token còn nguyên (ca bắt lỗi thiếu ngoặc cũ).
- 401 ở `/auth/login`: không đăng xuất (không thuộc `/admin` hay `/auth/me`).
- 200 ở `/auth/me`: trả dữ liệu, giữ token.

Ghi chú: chạy nằm trong `npm test` của server nên không cần framework mới. Phạm vi chỉ là `api()`. Các trang React (`AdminLayout`, `Users.jsx`, `RequirePermission`...) vẫn CHƯA có test tự động và chưa chạy thử trên trình duyệt.

## Kiểm tra test có bắt được lỗi cũ (đột biến trên bản sao, không đụng code thật)

Tôi sao chép `server/src`, `server/test` và `client/src` vào thư mục scratchpad, rồi gỡ lại hai chỗ đã sửa:

1. Xoá cả hai dòng chặn `typeof data.active !== 'boolean'` ở `admin.js`. Test `active không phải boolean bị từ chối (400)...` RỚT với `actual: 200, expected: 400`. Đây là kiểu `PUT {active:"false"}` lọt qua chốt tự khoá. Vậy ca mới bắt được lỗi cũ ở PUT.
   - Ca này nằm chung với kiểm tra POST bên dưới, và assert PUT chạy trước nên chỉ thấy nó rớt ở PUT. Nhánh POST (`active:"false"` phải bị 400 và không tạo user) chưa được kiểm chứng riêng qua đột biến. Cách để kiểm chứng độc lập là chỉ gỡ guard ở POST.
2. Đưa dòng 47 của `api.js` về dạng thiếu ngoặc: `res.status === 401 && path.startsWith('/admin') || path === '/auth/me'`. Hai test RỚT: `lỗi khác 401 ở /auth/me ... KHÔNG đăng xuất` (token bị xoá, `actual: undefined, expected: 'tok'`) và `200 ở /auth/me: trả dữ liệu, giữ token` (cùng lỗi). Vậy test bắt được lỗi ngoặc cũ.

## Các điểm Coder dặn soi

- Thứ tự lỗi khi PUT vừa có `active` sai kiểu vừa vi phạm quy tắc staff hoặc tự thao tác: `admin.js` dòng 335 và 352 đặt kiểm tra kiểu ngay sau kiểm tra quyền, nên kiểu sai trả 400 trước. Test chưa phủ riêng ca kết hợp này.
- `active: null` bị 400: theo code (`!== undefined && typeof !== 'boolean'`) là đúng. Chưa có test riêng cho `null`.
- README dòng 176–177: chưa kiểm bằng test tự động, vì đây là tài liệu.

## Chưa phủ (nói rõ)

- Đường `LAST_ADMIN` thật sự (cần hai admin mà một người thao tác lên người kia): chỉ phủ phần "admin cuối không tự xoá được".
- Giao diện React và realtime socket đang mở: chưa có test.
- Chưa đọc `server/.env`. Không commit.
