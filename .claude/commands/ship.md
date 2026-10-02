---
description: Chạy trọn dây chuyền bốn agent cho một yêu cầu tính năng.
---

Chạy trọn dây chuyền làm tính năng cho: $ARGUMENTS

Toàn bộ dây chuyền dùng tiếng Việt có dấu: lời giao việc bạn viết cho từng
subagent, các file bàn giao trong .bangiao/, và mọi báo cáo gửi tôi. Khi
giao việc, nhắc subagent trả lời bằng tiếng Việt. Nếu một file bàn giao
bị viết bằng tiếng Anh, yêu cầu subagent đó viết lại bằng tiếng Việt rồi
mới sang chặng kế tiếp.

Làm lần lượt các chặng dưới đây, không nhảy cóc. Sau mỗi chặng, kiểm tra
file bàn giao đã tồn tại rồi mới sang chặng kế tiếp.

0. Xem đang đứng trên nhánh git nào. Nếu là nhánh chính (main hoặc
   master), dừng lại và báo cho tôi, không chạy tiếp.
   Sau đó dọn thư mục .bangiao/, tức xoá ke-hoach.md, thay-doi.md,
   ket-qua-test.md và danh-gia.md của lần chạy trước, để không ai đọc
   nhầm file cũ.

1. Giao việc cho subagent planner kèm yêu cầu tính năng ở trên.
   Chờ tới khi có .bangiao/ke-hoach.md.

2. Nếu bản kế hoạch có mục CÂU HỎI CÒN BỎ NGỎ, dừng lại và đưa các câu
   hỏi đó cho tôi. Nếu không có, giao việc cho subagent coder.
   Chờ tới khi có .bangiao/thay-doi.md.

3. Giao việc cho subagent tester.
   Chờ tới khi có .bangiao/ket-qua-test.md.
   Có test rớt thì dừng lại và cho tôi xem phần rớt.

4. Giao việc cho subagent reviewer. Cho tôi xem .bangiao/danh-gia.md.

Báo lại phán quyết cuối cùng. Không gộp nhánh, không push, không tạo pull
request. Cứ để nguyên nhánh đó cho tôi tự xem.