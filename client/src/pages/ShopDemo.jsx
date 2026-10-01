import { Link } from 'react-router-dom';
import ChatWidget from '../components/ChatWidget.jsx';

// Trang demo phía khách: mô phỏng website shop có gắn widget chat AI
export default function ShopDemo() {
  return (
    <div className="shop">
      <header className="shop-nav">
        <strong>🌾 Shop demo</strong>
        <Link to="/admin">Quản trị →</Link>
      </header>
      <main className="shop-hero">
        <h1>AI Sales Agent</h1>
        <p>
          Trợ lý AI tư vấn sản phẩm, trả lời chính sách, lên giỏ hàng, thu thập thông tin giao hàng và chốt đơn ngay trong khung chat.
          Cùng một bộ não phục vụ Website, Messenger, Instagram và WhatsApp.
        </p>
        <ol className="shop-steps">
          <li>Mở khung chat góc phải và hỏi: “Tôi cần phân bón cho lúa”.</li>
          <li>Đặt mua, cung cấp tên, SĐT, địa chỉ rồi xác nhận đơn.</li>
          <li>Vào trang Quản trị để xem hội thoại realtime, đơn hàng và tiếp quản khi cần.</li>
        </ol>
      </main>
      <ChatWidget defaultOpen />
    </div>
  );
}
