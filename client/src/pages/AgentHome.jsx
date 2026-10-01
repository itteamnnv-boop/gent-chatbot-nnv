import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icons.jsx';
import Playground from '../components/Playground.jsx';
import { ChannelsArt, HandoffArt, OrdersArt, TeachArt } from '../components/TipArt.jsx';

const TIPS = [
  { Art: OrdersArt, title: 'Chốt đơn với tác nhân AI', text: 'AI tư vấn, lên giỏ hàng, xin thông tin giao hàng và tạo đơn ngay trong khung chat.', link: '/admin/orders', cta: 'Xem đơn hàng' },
  { Art: TeachArt, title: 'Dạy và thử nghiệm AI', text: 'Thêm thông tin quan trọng để AI có thể phản hồi tốt hơn. Sau đó, hãy dùng Đoạn chat thử nghiệm để xem cách AI phản hồi.', link: '/admin/info', cta: 'Thêm thông tin' },
  { Art: HandoffArt, title: 'Chuyển cho nhân viên đúng lúc', text: 'Đặt quy tắc để AI chuyển khiếu nại, đơn sỉ hoặc câu hỏi khó cho nhân viên kèm toàn bộ lịch sử.', link: '/admin/guidance', cta: 'Thiết lập' },
  { Art: ChannelsArt, title: 'Một AI cho mọi kênh', text: 'Cùng một AI trả lời trên Website, Messenger, Instagram và WhatsApp. Xem mọi hội thoại trong Hộp thư.', link: '/admin/inbox', cta: 'Mở hộp thư' },
];

function Collapsible({ title, subtitle, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mba-card">
      <header className="mba-card-head">
        <div>
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button className="mba-round" onClick={() => setOpen((o) => !o)} aria-label={open ? 'Thu gọn' : 'Mở rộng'} aria-expanded={open}>
          <Icon name={open ? 'chevronUp' : 'chevronDown'} />
        </button>
      </header>
      {open && children}
    </section>
  );
}

function Metric({ value, label, hint }) {
  return (
    <div className="mba-metric">
      <strong>{value}</strong>
      <span>
        <span className="mba-hint" title={hint}><Icon name="info" size={14} /></span> {label}
      </span>
    </div>
  );
}

export default function AgentHome() {
  const [stats, setStats] = useState(null);
  const [businessName, setBusinessName] = useState('');
  const track = useRef(null);

  useEffect(() => {
    const load = () => api('/admin/stats').then(setStats).catch(() => {});
    load();
    api('/admin/settings').then((s) => setBusinessName(s.businessName)).catch(() => {});
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  const scrollTips = (dir) => track.current?.scrollBy({ left: dir * 244, behavior: 'smooth' });
  const a = stats?.agent;

  return (
    <div className="mba-home">
      <div className="mba-col">
        <Collapsible title="Chào mừng đến với AI Business Agent" subtitle="Khám phá các cách để tận dụng tối đa tác nhân AI.">
          <div className="tips">
            <button className="tips-nav prev mba-round" onClick={() => scrollTips(-1)} aria-label="Mẹo trước">
              <Icon name="chevronRight" />
            </button>
            <div className="tips-track" ref={track}>
              {TIPS.map(({ Art, title, text, link, cta }) => (
                <article key={title} className="tip">
                  <Art />
                  <h4>{title}</h4>
                  <p>
                    {text} <Link to={link}>{cta}.</Link>
                  </p>
                </article>
              ))}
            </div>
            <button className="tips-nav next mba-round" onClick={() => scrollTips(1)} aria-label="Mẹo tiếp theo">
              <Icon name="chevronRight" />
            </button>
          </div>
        </Collapsible>

        <section className="mba-card">
          <h3>Hiệu quả AI của {businessName || 'bạn'}</h3>
          <p className="mba-sub">Dựa theo cuộc trò chuyện {a?.windowDays ?? 7} ngày qua</p>
          <div className="mba-metrics">
            <Metric value={a?.conversations ?? '–'} label="Cuộc trò chuyện với AI" hint="Số cuộc trò chuyện có tin nhắn trong 7 ngày qua (không tính Chat thử)" />
            <Metric value={a?.purchaseIntent ?? '–'} label="Người liên hệ có ý định mua hàng" hint="Khách đã thêm sản phẩm vào giỏ, đang chốt thông tin hoặc đã đặt hàng" />
            <Metric
              value={a?.autoResolveRate == null ? '–' : `${Math.round(a.autoResolveRate * 100)}%`}
              label="Tỷ lệ tự xử lý"
              hint="Tỷ lệ cuộc trò chuyện AI tự xử lý, không phải chuyển cho nhân viên"
            />
          </div>
        </section>

        <section className="mba-card">
          <span className="mba-card-icon"><Icon name="checklist" size={22} /></span>
          {stats?.needsAttention ? (
            <>
              <h3>{stats.needsAttention} cuộc trò chuyện cần bạn xử lý</h3>
              <p className="mba-sub">
                AI gặp lỗi hoặc không gửi được tin. <Link to="/admin/inbox">Mở hộp thư</Link>
              </p>
            </>
          ) : (
            <>
              <h3>Tất cả đã xong!</h3>
              <p className="mba-sub">Bạn sẽ tìm thấy cơ hội cải thiện AI tại đây.</p>
            </>
          )}
        </section>

        <Collapsible title="Đơn hàng" subtitle="Quản lý đơn hàng AI đã chốt">
          <Link to="/admin/orders" className="mba-row">
            <Icon name="cart" />
            <div>
              <strong>{stats?.newOrders ?? 0} đơn hàng mới cần xác nhận</strong>
              <span>{stats?.ordersToday ?? 0} hôm nay · {stats?.ordersWeek ?? 0} tuần này</span>
            </div>
            <Icon name="chevronRight" />
          </Link>
        </Collapsible>
      </div>

      <aside className="mba-side">
        <Playground />
      </aside>
    </div>
  );
}
