# AI Sales Agent — Chatbot tư vấn & chốt đơn

Hệ thống chatbot bán hàng mô phỏng **Meta Business Agent**: AI (OpenAI) tư vấn sản phẩm từ catalog, trả lời chính sách
từ kho kiến thức, lên giỏ hàng, thu thập thông tin giao hàng, **chốt đơn** và **chuyển cho nhân viên** khi cần —
trên Website, Facebook Messenger, Instagram và WhatsApp.

> Tìm hiểu cách Meta Business Agent vận hành và cách dự án ánh xạ: [docs/META_BUSINESS_AGENT.md](docs/META_BUSINESS_AGENT.md)

**Công nghệ:** Node.js (Express 5, Socket.IO) · React 19 (Vite) · MongoDB (Mongoose) · OpenAI (function calling)

## Kiến trúc

```
 Website widget ─┐                       ┌─────────────── OpenAI (Chat Completions + tools)
 Messenger ──────┤  webhook / REST       │                     ▲   │ tool calls
 Instagram ──────┼──────────────► conversationService ──► runAgent()  ▼
 WhatsApp ───────┘   (chống trùng,        │  (khoá theo hội thoại)   tools.js: search_products, search_knowledge,
                      thread control)     │                          update_cart, save_customer_info, create_order,
                                          │                          lookup_order, handoff_to_human
                                          ▼                                  │
                               MongoDB: Product, Knowledge, Customer,  ◄─────┘
                                        Conversation, Message, Order, Settings
                                          │
                                 Socket.IO realtime ──► Admin dashboard (React)
```

Luồng một tin nhắn (`server/src/services/conversationService.js`):

1. Nhận tin từ kênh → bỏ qua nếu trùng `mid` (Meta có thể gửi lại webhook).
2. Tạo/tìm khách + hội thoại, lưu tin nhắn, đẩy realtime lên dashboard.
3. Nếu nhân viên đang giữ hội thoại (`mode=human`) hoặc bot tắt → dừng, chờ nhân viên.
4. Nếu chứa từ khoá handoff → chuyển nhân viên ngay.
5. Ngược lại chạy **agent loop**: system prompt (persona, chính sách, giỏ hàng, thông tin giao hàng hiện tại) + 20 tin gần nhất
   → OpenAI → thực thi tool → lặp tối đa 6 vòng → câu trả lời cuối gửi về đúng kênh.
6. Lỗi OpenAI → gửi câu trả lời dự phòng và gắn cờ “cần chú ý” cho nhân viên.

Các chốt an toàn khi chốt đơn: `create_order` bắt buộc `customer_confirmed=true`, kiểm tra đủ tên/SĐT/địa chỉ, lấy giá mới nhất
từ DB, trừ kho nguyên tử (hoàn kho nếu lỗi), huỷ đơn trong admin sẽ hoàn kho.

## Cấu trúc thư mục

```
server/
  src/
    agent/        agent.js (vòng lặp OpenAI), prompt.js (system prompt), tools.js (định nghĩa + xử lý tool)
    channels/     meta.js (Messenger/Instagram/WhatsApp: gửi tin, parse webhook, xác thực chữ ký)
    models/       Product, Knowledge, Customer, Conversation, Message, Order, Settings
    routes/       chat.js (widget), webhook.js (Meta), admin.js, auth.js
    services/     conversationService.js (điều phối), cart.js
    app.js, index.js, seed.js, seedData.js
  test/           test luồng chốt đơn với OpenAI client giả lập, test webhook
client/
  src/components/ChatWidget.jsx     widget chat cho khách
  src/pages/                        Dashboard, Inbox, Orders, Products, Knowledge, AgentSettings, Login, ShopDemo
docs/META_BUSINESS_AGENT.md
```

## Chạy thử nhanh (không cần cài MongoDB)

Yêu cầu Node.js ≥ 20.

```bash
cd server && npm install
```

```bash
cd client && npm install && npm run build
```

Tạo `server/.env` từ `server/.env.example` và điền ít nhất `OPENAI_API_KEY`, rồi:

```bash
cd server && npm run dev:memory
```

Mở http://localhost:4000 (widget chat) và http://localhost:4000/admin (mặc định `admin` / `admin123` — **đổi trong `.env`**; tài khoản này chỉ dùng để tạo tài khoản quản trị đầu tiên khi DB chưa có người dùng).
Chế độ `dev:memory` chạy MongoDB in-memory và tự nạp dữ liệu mẫu (catalog phân bón giả lập); dữ liệu mất khi tắt server.

### Phát triển frontend với hot reload

Chạy server như trên, sau đó:

```bash
cd client && npm run dev
```

Mở http://localhost:5173 (Vite proxy `/api` và `/socket.io` sang cổng 4000).

### Dùng MongoDB thật

Đặt `MONGODB_URI` trong `server/.env` (local hoặc MongoDB Atlas), nạp dữ liệu mẫu một lần:

```bash
cd server && npm run seed
```

rồi `npm start` (hoặc `npm run dev`).

## Kết nối Facebook Messenger / Instagram / WhatsApp

1. Tạo app tại [developers.facebook.com](https://developers.facebook.com), thêm sản phẩm **Messenger** (và/hoặc **Instagram**, **WhatsApp**).
2. Server cần URL HTTPS công khai (deploy, hoặc dùng tunnel như ngrok/cloudflared khi dev).
3. Webhook: Callback URL = `https://<domain>/webhook/meta`, Verify token = giá trị `META_VERIFY_TOKEN`.
   Đăng ký field `messages`, `messaging_postbacks` (Messenger/Instagram) hoặc `messages` (WhatsApp).
4. Điền vào `server/.env`:
   - `META_APP_SECRET` — bắt buộc ở production để xác thực chữ ký `X-Hub-Signature-256`;
   - `META_APP_ID` — App ID, dùng cho nút "Kết nối Facebook Page" trong trang quản trị;
   - `META_OAUTH_REDIRECT_URI` — `https://<domain>/api/meta/oauth/callback`, khai báo y hệt trong
     Facebook Login > Settings > Valid OAuth Redirect URIs;
   - `META_PAGE_ACCESS_TOKEN` — Page token **dự phòng** cho Messenger/Instagram: chỉ dùng khi hội thoại chưa có Page
     hoặc Page chưa được kết nối (vd: hội thoại cũ, Instagram);
   - `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN` — cho WhatsApp Cloud API.
5. Vào **Kênh kết nối** trong trang quản trị, bấm **Kết nối Facebook Page**, đăng nhập Facebook và tick các Page cần dùng.
   Hệ thống tự lấy Page Access Token và đăng ký webhook cho từng Page (chỉ áp dụng cho Messenger).
6. Để chạy công khai cần qua **App Review** (quyền `pages_messaging`, `pages_show_list`, `pages_manage_metadata`, `business_management`, …).
   `business_management` cần để `/me/accounts` trả về cả các Page nằm trong Business Manager.

Lưu ý chính sách Meta: chỉ được nhắn tự do trong **24 giờ** kể từ tin cuối của khách. Ngoài khung này, Messenger cần tag
`HUMAN_AGENT` (phải xin quyền), WhatsApp cần template đã duyệt.

## Trang quản trị

Bố cục theo kiểu Business Agent: cột icon bên trái (AI Agent, Hộp thư, Đơn hàng, Sản phẩm, Thống kê) và công tắc **AI đang bật/tắt** ở header.

- **AI Agent → Trang chủ** — thẻ mẹo, hiệu quả AI 7 ngày (số cuộc trò chuyện, khách có ý định mua, tỉ lệ tự xử lý),
  việc cần xử lý, đơn hàng mới, và **Đoạn chat thử nghiệm** bên phải.
- **AI Agent → Thông tin của bạn / Hướng dẫn / Chat thử / Cài đặt** — thông tin doanh nghiệp + câu hỏi thường gặp;
  giọng điệu + quy tắc chuyển nhân viên; chat thử toàn màn hình; model OpenAI.
  Chat thử dùng kênh riêng `test`: không hiện trong Hộp thư/thống kê, đơn tạo ra chỉ là mô phỏng (không lưu, không trừ kho).
- **Thống kê** — doanh thu, số hội thoại, tỉ lệ chốt đơn, số hội thoại chờ nhân viên.
- **Hộp thư** — realtime mọi kênh; lọc Bot/Nhân viên/Cần chú ý; xem giỏ hàng, thông tin giao hàng, đơn; xem log tool AI đã gọi;
  **Tiếp quản** / **Trả lại cho Bot**; nhân viên gửi tin sẽ tự tiếp quản.
- **Đơn hàng** — tìm kiếm, đổi trạng thái (huỷ ⇒ hoàn kho).
- **Sản phẩm** — CRUD catalog AI dùng để tư vấn.
- **Kênh kết nối** — kết nối / ngắt kết nối các Facebook Page (Messenger), xem trạng thái token của từng Page.
- **Người dùng** — tạo tài khoản, vai trò Quản trị viên / Nhân viên, tick quyền từng chức năng.

## API chính

| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/chat/config` | Tên bot, lời chào (widget) |
| GET | `/api/chat/history?sessionId=` | Lịch sử chat web |
| POST | `/api/chat/message` | `{sessionId, text}` → tin của khách + câu trả lời |
| GET/POST | `/webhook/meta` | Xác minh & nhận webhook Messenger/Instagram/WhatsApp |
| POST | `/api/auth/login` | Đăng nhập admin → JWT |
| GET | `/api/auth/me` | Thông tin và quyền của người đang đăng nhập |
| GET | `/api/meta/oauth/callback` | Facebook chuyển hướng về sau khi đăng nhập (công khai, xác thực bằng `state`) |
| GET | `/api/admin/meta/pages` | Các Page đã kết nối (không trả token) |
| POST | `/api/admin/meta/oauth/start` | Trả `{url}` để chuyển sang Facebook đăng nhập |
| GET | `/api/admin/meta/oauth/sessions/:id` | Danh sách Page Facebook trả về, chờ chọn |
| POST | `/api/admin/meta/pages` | `{sessionId, pageIds}` → đăng ký webhook và lưu Page |
| DELETE | `/api/admin/meta/pages/:pageId` | Ngắt kết nối Page |
| GET | `/api/admin/stats` | Thống kê |
| GET | `/api/admin/conversations[/:id]` | Danh sách / chi tiết hội thoại |
| POST | `/api/admin/conversations/:id/messages` | Nhân viên trả lời |
| POST | `/api/admin/conversations/:id/mode` | `{mode: "bot" \| "human"}` |
| GET/PATCH | `/api/admin/orders[/:id]` | Đơn hàng |
| CRUD | `/api/admin/products`, `/api/admin/knowledge` | Catalog, kiến thức |
| GET/PUT | `/api/admin/settings` | Cấu hình agent |
| GET | `/api/admin/permissions` | Danh mục vai trò và quyền |
| CRUD | `/api/admin/users` | Người dùng & phân quyền |

Sự kiện Socket.IO: `message:new`, `conversation:update`, `order:new`, `order:update`.

## Test

```bash
cd server && npm test
```

Test dùng MongoDB in-memory và **OpenAI client giả lập theo kịch bản**, nên không tốn token. Các ca được kiểm tra:
tìm sản phẩm không dấu, chặn vượt tồn kho, chuẩn hoá/kiểm tra SĐT, không tạo đơn khi chưa xác nhận, tạo đơn và trừ kho,
không tạo đơn trùng, bảo vệ tra cứu đơn, handoff bằng từ khoá, lỗi OpenAI, chống webhook trùng, parse webhook,
xác thực chữ ký.

## Triển khai production

- `NODE_ENV=production`. Server sẽ từ chối khởi động nếu còn dùng `JWT_SECRET`/`ADMIN_PASSWORD` mặc định hoặc thiếu `OPENAI_API_KEY`.
- Build client (`npm run build` trong `client/`); server tự phục vụ `client/dist`.
- Đặt sau reverse proxy HTTPS (nginx/Caddy), hỗ trợ WebSocket cho `/socket.io`.
- Khoá theo hội thoại hiện ở trong bộ nhớ (1 tiến trình). Muốn chạy nhiều instance, chuyển sang khoá phân tán
  (Redis) và dùng `@socket.io/redis-adapter`.

## Hướng mở rộng

- Tìm kiếm ngữ nghĩa bằng embeddings + MongoDB Atlas Vector Search cho catalog lớn.
- Gửi ảnh sản phẩm / carousel (Messenger generic template, WhatsApp interactive).
- Tích hợp cổng thanh toán (VNPay, MoMo…) và hãng vận chuyển (GHN, GHTK) qua thêm tool.
- Nhắc giỏ hàng bị bỏ dở (trong khung 24h), khảo sát sau mua.
- Phân công hội thoại cho nhân viên.
