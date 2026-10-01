# Meta Business Agent hoạt động thế nào — và hệ thống này mô phỏng ra sao

## 1. Meta Business Agent là gì

Meta ra mắt toàn cầu **Meta Business Agent** ngày 03/06/2026, sau gần 2 năm thử nghiệm ở Ấn Độ, Mexico… Agent chạy ngay trong
**WhatsApp, Instagram và Messenger**, thay doanh nghiệp:

- trả lời câu hỏi của khách bằng ngôn ngữ của khách;
- gợi ý sản phẩm **từ catalog**, so sánh sản phẩm;
- chấm điểm / thu thập thông tin khách tiềm năng (qualify lead), đặt lịch hẹn;
- **chốt đơn ngay trong khung chat** (mua hàng, thanh toán), tra cứu đơn;
- gọi API hệ thống của doanh nghiệp (Shopify, Zendesk, Shopee…);
- **chuyển cho nhân viên (handoff)** khi vượt khả năng, kèm toàn bộ lịch sử hội thoại.

Cách thiết lập phía doanh nghiệp: *cấu hình kiến thức → đặt giọng điệu → định nghĩa khi nào chuyển cho người → go live*.
Về kỹ thuật, handoff dùng cơ chế **thread control** của Messenger Platform: quyền giữ hội thoại chuyển từ bot sang
hộp thư nhân viên, webhook báo cho phần mềm liên quan, khách vẫn ở cùng một luồng chat.

Giá: hiện miễn phí cho SMB; sắp có gói qua WhatsApp Business Premium; doanh nghiệp lớn tính theo token.

## 2. Vòng đời một hội thoại (theo mô hình Meta)

```
Khách nhắn  ──►  Agent hiểu ý định ──► Tra kiến thức / catalog ──► Tư vấn + gợi ý
                                                                      │
                ┌──────────── khách muốn mua ◄────────────────────────┘
                ▼
        Lên giỏ hàng ──► Thu thập thông tin ──► Tóm tắt & xác nhận ──► Tạo đơn ──► Báo mã đơn
                │
     (khiếu nại / ngoài khả năng / khách yêu cầu)
                ▼
        HANDOFF → nhân viên (thread control) → trả lại bot khi xong
```

## 3. Ánh xạ sang hệ thống này

| Năng lực Meta Business Agent | Cài đặt trong dự án |
|---|---|
| Chạy trên Messenger / Instagram / WhatsApp | `server/src/routes/webhook.js` + `channels/meta.js` (Send API, WhatsApp Cloud API), thêm kênh **Website** (widget React) |
| “Bộ não” AI | `agent/agent.js`: vòng lặp **OpenAI function calling** (model → tool → kết quả → model…) |
| Configure knowledge | Collection `Knowledge` + tool `search_knowledge`; trang **Kho kiến thức** |
| Recommend products from catalog | Collection `Product` + tool `search_products`, `get_product_details` (tìm không dấu tiếng Việt) |
| Set your tone | `Settings.tone`, `greeting`, `businessInfo`, `customInstructions` → system prompt (`agent/prompt.js`) |
| Complete purchases in-thread | Tool `update_cart`, `save_customer_info`, `create_order` (bắt buộc `customer_confirmed=true`, trừ kho nguyên tử) |
| Look up orders | Tool `lookup_order` (chỉ trả đơn của chính khách hoặc khi SĐT khớp) |
| Qualify leads | Trường `stage` của hội thoại: new → consulting → cart → checkout → ordered |
| Define when to hand off | `Settings.handoffRules` (AI tự quyết qua tool `handoff_to_human`) + `handoffKeywords` (chuyển ngay, không cần AI) |
| Thread control | `Conversation.mode = bot | human`; nhân viên trả lời ⇒ tự tiếp quản; nút “Trả lại cho Bot” |
| Hand over full history | Hộp thư admin realtime (Socket.IO) hiển thị toàn bộ tin nhắn + log thao tác AI |
| Language of the customer | Prompt yêu cầu trả lời theo ngôn ngữ khách |

## 4. Những điểm khác / giới hạn

- **Thanh toán trong chat**: Meta có payment native ở một số thị trường; dự án này dùng COD/chuyển khoản, chưa tích hợp cổng thanh toán.
- **Cửa sổ 24 giờ của Messenger**: ngoài 24h kể từ tin cuối của khách, Page chỉ được gửi tin có tag
  (ví dụ `HUMAN_AGENT`, cần xin quyền trong App Review). Code hiện gửi `messaging_type: RESPONSE`.
- **WhatsApp**: ngoài 24h phải gửi *template message* đã được duyệt.
- **Tìm kiếm**: dùng tìm theo từ khoá không dấu, đủ cho catalog vài trăm–vài nghìn sản phẩm. Catalog lớn nên chuyển sang
  embeddings (OpenAI `text-embedding-3-*` + MongoDB Atlas Vector Search).

## Nguồn

- [TechCrunch — Meta's AI agent for WhatsApp Business is now available globally](https://techcrunch.com/2026/06/03/metas-ai-agent-for-whatsapp-business-is-now-available-globally/)
- [CNBC — Meta is trying to sell AI agents to businesses](https://www.cnbc.com/2026/06/03/meta-business-agent-is-zuckerberg-latest-effort-to-diversify-from-ads.html)
- [Dataconomy — Meta Launches AI Business Agents On WhatsApp, Instagram And Messenger](https://dataconomy.com/2026/06/04/meta-ai-business-agents-whatsapp-instagram-messenger/)
- [Wati — Meta Business Agent: Features, Limitations](https://www.wati.io/en/blog/meta-business-agent/)
- [Woztell — Meta Business Agent: the complete guide](https://woztell.com/meta-business-agent-complete-guide/)
