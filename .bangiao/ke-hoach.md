# Kế hoạch: Sidebar (rail) mở rộng khi hover, có nút ghim và chấm báo chưa đọc của Hộp thư

Yêu cầu gốc (nguyên văn): "Bổ sung chức năng mở rộng slidebar menu khi hover vào".
Tham chiếu: sidebar Meta Business Suite ở trạng thái mở rộng. Mỗi mục có icon và nhãn chữ. Mục hover và mục đang chọn có nền xám nhạt bo góc. Nhãn dài bị cắt "…". Hộp thư có chấm đỏ.

Phạm vi: chỉ sửa client, KHÔNG sửa server, không thêm thư viện, không thêm API.

## Đã trả lời (người dùng chốt)

1. Nút ghim: CÓ. Khi ghim, sidebar luôn mở rộng và ĐẨY nội dung: cột lưới đổi từ 56px sang 240px. Khi bỏ ghim, sidebar quay về chế độ hover kiểu overlay. Lựa chọn được lưu vào localStorage (có try/catch). Ghim không áp dụng ở màn ≤760px và trên thiết bị cảm ứng.
2. Chấm đỏ Hộp thư: CÓ. Chỉ hiện khi có hội thoại chưa đọc trong phạm vi Page mà người xem được phép thấy. Cập nhật realtime qua socket hiện có, có debounce. Chỉ hiện với người có quyền `inbox.view`.
3. Mục đang chọn: nền xám nhạt bo góc như ảnh Meta. Phải đủ tương phản và phân biệt được với trạng thái hover.
4. Bề rộng khi mở rộng: 240px.

## Quyết định thiết kế (đã chốt)

### Hover và mở rộng
- Khi chưa ghim, panel mở rộng kiểu ĐÈ LÊN nội dung. Cột lưới vẫn 56px nên nội dung không dịch. Khi mở rộng, panel có nền trắng đặc và bóng `var(--shadow-lg)`.
- Hover và focus làm thuần bằng CSS: `:hover`, `:has(:focus-visible)`, `transition-delay`. React chỉ giữ state `pinned` và trạng thái chưa đọc.
- Độ trễ chống nháy: mở sau 150ms, đóng sau 200ms. Chuyển động `width` 180ms `ease`, nhãn đổi `opacity` 120ms.
- `prefers-reduced-motion: reduce`: đặt `transition-duration: 0s`, vẫn giữ delay.
- Bàn phím: Tab vào bất kỳ phần tử nào trong rail thì panel mở rộng, Tab ra thì thu lại. Click chuột không tạo `:focus-visible` nên không làm panel kẹt ở trạng thái mở.
- Cảm ứng: các luật hover và ghim chỉ đặt trong `@media (hover: hover) and (min-width: 761px)`.
- Màn ≤760px: rail vẫn là thanh ngang như hiện tại, không mở rộng, ẩn nhãn, ẩn nút ghim.
- Tooltip: bỏ `title` trên các mục rail và trên logo, giữ `aria-label`. Riêng nút ghim chỉ có icon nên giữ `title`.
- z-index của `.rail` là 30: thấp hơn `.cw` (40) và `.modal-backdrop` (50).

### Ghim
- Vị trí: cuối hàng đầu (`.rail-head`), bên phải nhãn "AI Sales Agent". Khi thu gọn, nút nằm ngoài vùng 56px và bị `overflow-x: hidden` cắt mất, nên không bấm nhầm được. Khi Tab tới nút, panel tự mở rộng (`:focus-visible`) nên bàn phím vẫn dùng được.
- Thuộc tính của nút: `<button type="button" className="rail-pin" aria-pressed={pinned} aria-label="Ghim thanh bên" title={pinned ? 'Bỏ ghim thanh bên' : 'Ghim thanh bên'}>`. Icon mới tên `pin`. Khi `pinned`, nút có màu `var(--mba-blue)` và nền `var(--primary-soft)`.
- Lưu trữ: key `admin_rail_pinned`, giá trị `'1'` khi ghim. Khi bỏ ghim thì xoá key (`storage.set(key, null)`). Giá trị khởi tạo là `storage.get('admin_rail_pinned') === '1'`. `storage` trong `api.js` đã bọc try/catch sẵn.
- Khi ghim: `.mba` có thêm class `pinned`, cột lưới thành `240px 1fr`. Panel rộng 240px, không bóng, nhãn hiện, không transition (đồng bộ với cú nhảy của lưới).
- Bỏ ghim trong lúc chuột còn ở trên rail: panel vẫn mở kiểu overlay, rời chuột thì thu lại.
- Hộp thư khi ghim: nội dung hẹp đi 184px. Vì vậy dời các ngưỡng responsive của `.inbox` lên thêm 240px khi đang ghim (xem mục CSS).

### Chấm chưa đọc
- Nguồn dữ liệu: `GET /api/admin/inbox/pages` (đã có ở `server/src/routes/admin.js` dòng 128). Route này đã yêu cầu quyền `inbox.view` và đã lọc theo phạm vi Page qua `inboxScopeOf`. Kết quả trả về `{ restricted, canSeeOther, otherUnread, pages: [{ pageId, unread, ... }] }`. Có chưa đọc khi `otherUnread > 0 || pages.some((p) => p.unread > 0)`. Không đổi server.
- Realtime: tạo một socket bằng `createAdminSocket()` (`client/src/socket.js`) và nghe `conversation:update`. Event này đã được lọc theo phạm vi ở `server/src/realtime.js`. Debounce 1000ms rồi gọi lại API. Khi `socket.io` phát `reconnect` thì gọi lại API ngay.
- Route `POST /conversations/:id/read` không phát socket. Vì vậy `Inbox.jsx`, sau khi đánh dấu đã đọc thành công, phát event cửa sổ `INBOX_READ_EVENT`; layout nghe event này (cũng debounce) và gọi lại API.
- Chấm hiển thị ở góc trên phải icon Hộp thư, cả khi thu gọn lẫn khi mở rộng. `aria-label` của mục Hộp thư đổi thành `Hộp thư (có tin chưa đọc)` khi có chấm.
- Đang ở trang Hộp thư vẫn hiện chấm nếu API báo còn chưa đọc. Số liệu luôn khớp với bộ đếm trong bộ chọn Page của Hộp thư.

## File cần sửa

### 1. `client/src/api.js`
Chỉ thêm `export` trước `const storage` (dòng 3). Không đổi gì khác.

### 2. `client/src/socket.js`
Thêm:
```js
// Event cửa sổ: Hộp thư vừa đánh dấu đã đọc một hội thoại (route /read không phát socket)
export const INBOX_READ_EVENT = 'inbox:read';
```

### 3. `client/src/components/Icons.jsx`
Thêm vào `PATHS` key `pin`, theo đúng kiểu các key đang có:
`pin: 'M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z',`

### 4. `client/src/pages/Inbox.jsx`
Dòng 130: đổi `.then(loadPages)` thành `.then(() => { loadPages(); window.dispatchEvent(new Event(INBOX_READ_EVENT)); })`. Import `INBOX_READ_EVENT` từ `../socket.js` (file này đã import `createAdminSocket` từ đó). Không sửa gì khác.

### 5. `client/src/pages/AdminLayout.jsx`

- Mảng `RAIL`: thêm `badge: 'inbox'` vào mục `/admin/inbox`. Không đổi nhãn, quyền hay thứ tự.
- Thêm hook đặt cùng file, phía trên `AdminLayout` (cùng cách `AiToggle` đang được đặt trong file):
  ```js
  // true khi có hội thoại chưa đọc trong phạm vi người xem; enabled = có quyền inbox.view
  function useInboxUnread(enabled) // trả về boolean
  ```
  Hành vi:
  - Khi `!enabled`: trả về `false`, không gọi API, không mở socket.
  - Khi `enabled`: gọi `load()` một lần. Mở `createAdminSocket()`. Nghe `conversation:update` và `window` `INBOX_READ_EVENT` để gọi `schedule()` (`clearTimeout` rồi `setTimeout(load, 1000)`). Gắn `socket.io.on('reconnect', load)`.
  - `load()` gọi `api('/admin/inbox/pages')`. Bỏ qua lỗi (`.catch(() => {})`, giữ giá trị cũ). Dùng cờ `alive` để không `setState` sau khi unmount.
  - Cleanup: `alive = false`, `clearTimeout`, `socket.disconnect()`, `removeEventListener`.
  - `useEffect` phụ thuộc `[enabled]`.
- Trong `AdminLayout`, đặt các dòng sau TRƯỚC dòng `if (!me) return …` (quy tắc hook):
  ```js
  const [pinned, setPinned] = useState(() => storage.get(PIN_KEY) === '1');
  const hasUnread = useInboxUnread(can(me, 'inbox.view'));
  ```
  - Khai báo `const PIN_KEY = 'admin_rail_pinned';` ở đầu module.
  - Hàm `togglePin()` đảo `pinned` và gọi `storage.set(PIN_KEY, next ? '1' : null)`.
  - Import `storage` từ `../api.js`, `createAdminSocket` và `INBOX_READ_EVENT` từ `../socket.js`.
- Root: `<div className={`mba${pinned ? ' pinned' : ''}`}>`.
- Khối `<aside className="rail">` dựng lại như sau (`<main>` giữ nguyên):
  ```jsx
  <aside className="rail">
    <div className="rail-panel">
      <div className="rail-row rail-head">
        <span className="rail-icon"><span className="rail-brand">AI</span></span>
        <span className="rail-label rail-title">AI Sales Agent</span>
        <button type="button" className="rail-pin" aria-pressed={pinned} aria-label="Ghim thanh bên"
          title={pinned ? 'Bỏ ghim thanh bên' : 'Ghim thanh bên'} onClick={togglePin}>
          <Icon name="pin" size={18} />
        </button>
      </div>
      <nav className="rail-nav">
        {RAIL.filter(allowed).map((r) => {
          const dot = r.badge === 'inbox' && hasUnread;
          return (
            <NavLink key={r.to} to={r.to} end={!r.agent} aria-label={dot ? `${r.label} (có tin chưa đọc)` : r.label}
              className={({ isActive }) => `rail-item${(r.agent ? isAgent : isActive) ? ' active' : ''}`}>
              <span className="rail-icon"><Icon name={r.icon} size={22} />{dot && <span className="rail-dot" />}</span>
              <span className="rail-label">{r.label}</span>
            </NavLink>
          );
        })}
      </nav>
      <div className="rail-bottom">
        {/* <a> "Mở widget chat" và <button type="button"> "Đăng xuất": giữ href/target/rel/onClick/aria-label, BỎ title,
            bên trong là rail-icon + rail-label với nhãn "Mở widget chat" / "Đăng xuất" */}
        <div className="rail-row rail-user">
          <span className="rail-icon"><Avatar name={me.displayName || me.username} size={32} /></span>
          <span className="rail-label">{me.displayName || me.username}</span>
        </div>
      </div>
    </div>
  </aside>
  ```
- Chú thích trong code dùng tiếng Việt có dấu, kiểu `//` một dòng như trong file hiện có.

### 6. `client/src/styles.css`

Sửa khối "Admin layout" (dòng 110–135) và các khối `@media` ở cuối file. Mỗi rule viết trên một dòng như quy ước của file. Dùng các biến `--ink`, `--ink-2`, `--mba-blue`, `--primary-soft`, `--danger`, `--shadow-lg`.

Trạng thái cơ bản (thu gọn):
- `.rail`: `position: sticky; top: 0; height: 100vh; z-index: 30;`. Bỏ background, border, flex và padding khỏi `.rail`.
- `.rail-panel`: `position: absolute; top: 0; left: 0; bottom: 0; width: 56px; display: flex; flex-direction: column; gap: 8px; padding: 12px 8px; overflow-x: hidden; overflow-y: auto; background: rgba(255, 255, 255, 0.85); border-right: 1px solid #dee3e9; transition: width .18s ease .2s, box-shadow .18s ease .2s;`.
- `.rail-nav, .rail-bottom`: flex cột, `align-items: stretch; gap: 6px;`. `.rail-bottom { margin-top: auto; }`.
- `.rail-item, .rail-row`: `display: flex; align-items: center; height: 40px; width: 100%; flex: none; border-radius: 8px; color: var(--ink); background: transparent; border: 0; padding: 0; font: inherit; font-size: 14px; font-weight: 600; text-align: left; white-space: nowrap;`. `.rail-head { margin-bottom: 12px; }`.
- `.rail-icon`: `position: relative; flex: none; width: 40px; height: 40px; display: grid; place-items: center;`.
- `.rail-brand`: giữ hình tròn 36px gradient, bỏ `margin-bottom`.
- `.rail-label`: `flex: 1; min-width: 0; padding-right: 12px; overflow: hidden; text-overflow: ellipsis; opacity: 0; transition: opacity .12s ease .2s;`.
- `.rail-pin`: `flex: none; width: 32px; height: 32px; margin-right: 4px; border: 0; border-radius: 50%; background: transparent; color: var(--ink-2); display: grid; place-items: center;`. `.rail-pin:hover { background: rgba(28, 43, 51, 0.08); }`. `.rail-pin[aria-pressed="true"] { color: var(--mba-blue); background: var(--primary-soft); }`.
- `.rail-dot`: `position: absolute; top: 6px; right: 6px; width: 10px; height: 10px; border-radius: 50%; background: var(--danger); border: 2px solid #fff;`.
- Màu nền theo trạng thái (thay cho nền đậm hiện tại):
  - `.rail-item:hover { background: rgba(28, 43, 51, 0.06); text-decoration: none; }`
  - `.rail-item.active { background: rgba(28, 43, 51, 0.12); color: var(--ink); }` và `.rail-item.active:hover { background: rgba(28, 43, 51, 0.16); }`
  - Chữ `--ink` (#1c2b33) trên nền khoảng #e0e3e5 cho tương phản trên 10:1. Mục active đậm hơn hover thấy rõ. Lúc thu gọn chỉ ô 40px có nền.
  - KHÔNG đổi `.subnav-item.active` (menu phụ khu AI Agent).
- `.rail-item:focus-visible, .rail-pin:focus-visible { outline: 2px solid var(--mba-blue); outline-offset: -2px; }`.

Trạng thái mở rộng (overlay): panel `width: 240px; background: #fff; box-shadow: var(--shadow-lg); transition-delay: .15s;`, nhãn `.rail-label { opacity: 1; transition-delay: .15s; }`. Áp bằng hai selector:
- `.rail:has(:focus-visible) .rail-panel` (và `… .rail-label`), đặt trong `@media (min-width: 761px)`.
- `.rail:hover .rail-panel` (và `… .rail-label`), đặt trong `@media (hover: hover) and (min-width: 761px)`.

Trạng thái ghim: đặt SAU các luật mở rộng, trong `@media (hover: hover) and (min-width: 761px)`:
- `.mba.pinned { grid-template-columns: 240px 1fr; }`
- `.mba.pinned .rail-panel { width: 240px; background: rgba(255, 255, 255, 0.85); box-shadow: none; transition: none; }`
- `.mba.pinned .rail-label { opacity: 1; transition: none; }`

Thiết bị không có hover: `@media (hover: none) { .rail-pin { display: none; } }`.

Hộp thư khi ghim (bù 240px so với các ngưỡng 1200px và 1000px hiện có), đặt sau các `@media` hiện có:
- `@media (hover: hover) and (min-width: 761px) and (max-width: 1440px) { .mba.pinned .inbox { grid-template-columns: 320px 1fr; } .mba.pinned .inbox-side { display: none; } }`
- `@media (hover: hover) and (min-width: 761px) and (max-width: 1240px) { .mba.pinned .inbox { grid-template-columns: 280px 1fr; } }`

Giảm chuyển động: `@media (prefers-reduced-motion: reduce) { .rail-panel, .rail-label { transition-duration: 0s; } }`.

`@media (max-width: 760px)`: thay các luật rail cũ bằng:
- `.rail { height: auto; }`
- `.rail-panel { position: static; width: auto; flex-direction: row; align-items: center; padding: 6px 12px; overflow: visible; border-right: 0; border-bottom: 1px solid #dee3e9; }`
- `.rail-nav, .rail-bottom` đổi sang hàng ngang; `.rail-bottom { margin: 0 0 0 auto; }`; `.rail-head { margin: 0 8px 0 0; }`
- `.rail-item, .rail-row { width: 40px; }`; `.rail-label, .rail-pin { display: none; }`
- Giữ `.mba { grid-template-columns: 1fr; }`. Luật này phải thắng `.mba.pinned`; điều đó đã được đảm bảo vì luật ghim có `min-width: 761px`.

## Các trường hợp biên bắt buộc xử lý

1. Lúc thu gọn và chưa ghim, rail trông như hiện tại (56px, chỉ icon), không lộ chữ hay nút ghim.
2. Nhãn và tên người dùng dài bị cắt "…", không xuống dòng.
3. Chưa ghim: mở rộng không làm nội dung dịch. Đã ghim: nội dung dời sang phải 240px, không bị panel che.
4. Lia chuột qua nhanh (<150ms) thì không mở. Rời ra rồi quay lại nhanh (<200ms) thì không nháy.
5. localStorage bị chặn: không lỗi, mặc định là chưa ghim (bỏ ghim/ghim vẫn chạy trong phiên).
6. Ghim rồi thu cửa sổ xuống ≤760px: thanh ngang như cũ, không có cột 240px. Phóng to lại thì trạng thái ghim quay lại.
7. Người không có `inbox.view`: không gọi `/admin/inbox/pages`, không mở socket cho chấm, không có chấm (mục Hộp thư cũng không hiện, vì `allowed`).
8. Nhân viên bị giới hạn Page: chấm chỉ tính các Page được giao (cùng với "khác" nếu `canSeeOther`). Đây là logic sẵn có của server; client chỉ đọc kết quả và không tự tính từ nguồn nào khác.
9. API lỗi hoặc socket rớt: giữ trạng thái chấm cũ, không ném lỗi ra UI. Khi socket kết nối lại thì tải lại.
10. Nhiều `conversation:update` dồn dập: tối đa một lần gọi API mỗi 1 giây sau sự kiện cuối.
11. Rời trang layout (đăng xuất): socket của hook bị ngắt, timer bị huỷ.
12. Mục "AI Agent" vẫn active trên mọi đường dẫn thuộc `AGENT_PATHS` (logic `isAgent` không đổi).
13. Modal vẫn nằm trên rail.
14. Màn thấp: panel cuộn dọc, `.rail-bottom` không bị mất.

## Cách kiểm (client chưa có hạ tầng test, không thêm test tự động)

1. `cd client && npm run build`: build phải thành công.
2. Chạy server ở cổng 4000 và `cd client && npm run dev`, mở `http://localhost:5173/admin` bằng Chrome hoặc Edge:
   - Hover: mở sau khoảng 150ms, đóng sau khoảng 200ms, nội dung không dịch, không còn tooltip gốc trên các mục.
   - Mục active có nền xám nhạt, đậm hơn nền hover. Ở `/admin/settings` thì mục AI Agent active.
   - Tab vào rail: rail mở rộng, thấy viền focus. Tab tới được nút ghim, Enter để ghim.
   - Ghim: cột 240px đẩy nội dung, F5 vẫn còn ghim. Trong DevTools > Application > Local Storage có `admin_rail_pinned = 1`. Bỏ ghim thì key bị xoá.
   - Ghim, mở `/admin/inbox` ở bề rộng cửa sổ khoảng 1300px: cột phải `.inbox-side` ẩn, khung chat vẫn đủ rộng.
   - Chấm đỏ: dùng tài khoản có hội thoại chưa đọc, chấm hiện. Mở hội thoại đó trong Hộp thư cho đến khi hết chưa đọc, chấm tắt sau khoảng 1 giây. Gửi tin mới từ widget khách (mở `/` ở tab khác), chấm hiện lại mà không cần F5.
   - Tài khoản nhân viên chỉ được giao Page A: tin mới ở Page B không làm hiện chấm.
   - Tài khoản không có `inbox.view`: tab Network không có request `/api/admin/inbox/pages`.
   - DevTools > Rendering > "Emulate CSS prefers-reduced-motion: reduce": không có chuyển động, vẫn có độ trễ.
   - Device Toolbar, thiết bị cảm ứng ≤760px: thanh ngang, không nhãn, không nút ghim, không bị đẩy dù trước đó đã ghim. Thiết bị cảm ứng >760px: chạm vào icon thì điều hướng, rail không mở dính.
   - Mở một modal rồi hover rail: modal vẫn nằm trên.
