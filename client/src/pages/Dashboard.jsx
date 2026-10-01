import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { CHANNEL_LABEL, ORDER_STATUS_LABEL, formatVND } from '../format.js';

function Tile({ label, value, hint }) {
  return (
    <div className="card tile">
      <span className="tile-label">{label}</span>
      <strong className="tile-value">{value}</strong>
      {hint && <span className="tile-hint">{hint}</span>}
    </div>
  );
}

export default function Dashboard() {
  const [s, setS] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = () => api('/admin/stats').then(setS).catch((e) => setError(e.message));
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!s) return <p className="muted">Đang tải...</p>;

  const maxRevenue = Math.max(1, ...s.daily.map((d) => d.revenue));
  return (
    <>
      <h1 className="page-title">Thống kê</h1>
      <div className="tiles">
        <Tile label="Doanh thu hôm nay" value={formatVND(s.revenueToday)} hint={`${s.ordersToday} đơn`} />
        <Tile label="Hội thoại hôm nay" value={s.conversationsToday} hint={`${s.totalConversations} tổng`} />
        <Tile label="Tỉ lệ chốt đơn" value={`${(s.conversionRate * 100).toFixed(1)}%`} hint="hội thoại có đơn / tổng" />
        <Tile label="Chờ nhân viên" value={s.humanMode} hint={`${s.needsAttention} cần chú ý`} />
      </div>

      <div className="grid-2">
        <section className="card">
          <h3>Doanh thu 7 ngày</h3>
          {s.daily.length === 0 && <p className="muted">Chưa có đơn hàng.</p>}
          <div className="bars">
            {s.daily.map((d) => (
              <div key={d._id} className="bar-row">
                <span className="bar-label">{d._id.slice(5)}</span>
                <div className="bar-track">
                  <div className="bar" style={{ width: `${(d.revenue / maxRevenue) * 100}%` }} />
                </div>
                <span className="bar-value">{formatVND(d.revenue)} · {d.orders} đơn</span>
              </div>
            ))}
          </div>
        </section>
        <section className="card">
          <h3>Đơn theo trạng thái</h3>
          <ul className="kv">
            {Object.entries(ORDER_STATUS_LABEL).map(([k, v]) => (
              <li key={k}><span>{v}</span><strong>{s.ordersByStatus[k] || 0}</strong></li>
            ))}
          </ul>
          <h3>Hội thoại theo kênh</h3>
          <ul className="kv">
            {Object.entries(CHANNEL_LABEL).map(([k, v]) => (
              <li key={k}><span>{v}</span><strong>{s.byChannel[k] || 0}</strong></li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
