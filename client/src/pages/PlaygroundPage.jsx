import Playground from '../components/Playground.jsx';

export default function PlaygroundPage() {
  return (
    <div className="mba-single">
      <section className="mba-card">
        <h3>Chat thử</h3>
        <p className="mba-sub">
          Đóng vai khách hàng để kiểm tra AI. Đơn hàng tạo ở đây chỉ là mô phỏng: không lưu đơn, không trừ kho, không hiện trong Hộp thư.
        </p>
      </section>
      <Playground large />
    </div>
  );
}
