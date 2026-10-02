import { Fragment, useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../api.js';
import { CHANNEL_LABEL, ORDER_STATUS_LABEL, formatTime, formatVND } from '../format.js';
import { can } from '../permissions.js';
import { createAdminSocket } from '../socket.js';

export default function Orders() {
  const { me } = useOutletContext();
  const [orders, setOrders] = useState([]);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (q.trim()) params.set('q', q.trim());
    const t = setTimeout(() => {
      api(`/admin/orders?${params}`).then(setOrders).catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [status, q]);

  useEffect(() => {
    const socket = createAdminSocket();
    socket.on('order:new', (o) => setOrders((list) => [o, ...list.filter((x) => x._id !== o._id)]));
    socket.on('order:update', (o) => setOrders((list) => list.map((x) => (x._id === o._id ? o : x))));
    return () => socket.disconnect();
  }, []);

  async function changeStatus(order, next) {
    if (next === 'cancelled' && !window.confirm(`Huỷ đơn ${order.code}? Tồn kho sẽ được hoàn lại.`)) return;
    try {
      const updated = await api(`/admin/orders/${order._id}`, { method: 'PATCH', body: { status: next } });
      setOrders((list) => list.map((x) => (x._id === updated._id ? updated : x)));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <h1 className="page-title">Đơn hàng</h1>
      <div className="toolbar">
        <input placeholder="Tìm mã đơn, tên, SĐT..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm đơn" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Lọc trạng thái">
          <option value="">Tất cả trạng thái</option>
          {Object.entries(ORDER_STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Mã đơn</th>
              <th>Khách hàng</th>
              <th>Kênh</th>
              <th className="num">Tổng tiền</th>
              <th>Thời gian</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 && (
              <tr><td colSpan={6} className="muted">Chưa có đơn hàng.</td></tr>
            )}
            {orders.map((o) => (
              <Fragment key={o._id}>
                <tr className="clickable" onClick={() => setExpanded(expanded === o._id ? null : o._id)}>
                  <td><strong>{o.code}</strong></td>
                  <td>{o.shipping?.name}<div className="muted">{o.shipping?.phone}</div></td>
                  <td>{CHANNEL_LABEL[o.channel]}</td>
                  <td className="num">{formatVND(o.total)}</td>
                  <td>{formatTime(o.createdAt)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <select
                      className={`status status-${o.status}`}
                      value={o.status}
                      disabled={o.status === 'cancelled' || !can(me, 'orders.update')}
                      onChange={(e) => changeStatus(o, e.target.value)}
                      aria-label={`Trạng thái đơn ${o.code}`}
                    >
                      {Object.entries(ORDER_STATUS_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </td>
                </tr>
                {expanded === o._id && (
                  <tr className="detail-row">
                    <td colSpan={6}>
                      <div className="order-detail">
                        <div>
                          <h4>Sản phẩm</h4>
                          <ul className="kv">
                            {o.items.map((i) => (
                              <li key={i.sku}>
                                <span>
                                  {i.name} ×{i.quantity}
                                  {i.promotion && <div className="muted">KM: {i.promotion.name}</div>}
                                </span>
                                <strong>
                                  {formatVND(i.lineTotal)}
                                  {i.promotion && i.listPrice > i.price && <div className="muted strike">{formatVND(i.listPrice * i.quantity)}</div>}
                                </strong>
                              </li>
                            ))}
                            <li><span>Phí ship</span><strong>{formatVND(o.shippingFee)}</strong></li>
                            <li><span>Tổng</span><strong>{formatVND(o.total)}</strong></li>
                          </ul>
                        </div>
                        <div>
                          <h4>Giao đến</h4>
                          <p>{o.shipping?.name} · {o.shipping?.phone}<br />{o.shipping?.address}</p>
                          {o.note && <p className="muted">Ghi chú: {o.note}</p>}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
