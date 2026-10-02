import { useEffect, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import Modal from '../components/Modal.jsx';
import { formatTime, formatVND } from '../format.js';
import { can } from '../permissions.js';

const EMPTY = {
  name: '',
  description: '',
  type: 'percent',
  value: '',
  scope: 'all',
  pageIds: [],
  productScope: 'all',
  productIds: [],
  startAt: '',
  endAt: '',
  active: true,
};

const STATE_LABEL = { running: 'Đang chạy', scheduled: 'Sắp chạy', ended: 'Đã kết thúc', off: 'Đang tắt' };

// ISO -> chuỗi giờ địa phương YYYY-MM-DDTHH:mm cho input datetime-local
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const toForm = (p) => ({ ...EMPTY, ...p, startAt: toLocalInput(p.startAt), endAt: toLocalInput(p.endAt) });

const toPayload = (f) => ({
  name: f.name,
  description: f.description,
  type: f.type,
  value: Number(f.value),
  scope: f.scope,
  pageIds: f.pageIds,
  productScope: f.productScope,
  productIds: f.productIds,
  startAt: f.startAt ? new Date(f.startAt).toISOString() : null,
  endAt: f.endAt ? new Date(f.endAt).toISOString() : null,
  active: f.active,
});

export default function Promotions() {
  const { me } = useOutletContext();
  const canManage = can(me, 'promotions.manage');
  const [searchParams] = useSearchParams();
  const [data, setData] = useState({ promotions: [], pages: [], products: [] });
  const [filter, setFilter] = useState(searchParams.get('page') || 'all'); // 'all' | 'shared' | pageId
  const [editing, setEditing] = useState(null); // null | form object
  const [error, setError] = useState('');

  const load = () => api('/admin/promotions').then(setData).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const pageName = (pageId) => data.pages.find((p) => p.pageId === pageId)?.name || `${pageId} (đã ngắt kết nối)`;
  const productName = (id) => data.products.find((p) => p._id === id)?.name || id;

  const rows = data.promotions.filter((p) => {
    if (filter === 'all') return true;
    if (filter === 'shared') return p.scope === 'all';
    return p.scope === 'pages' && p.pageIds.includes(filter);
  });

  async function save(e) {
    e.preventDefault();
    setError('');
    try {
      const body = toPayload(editing);
      if (editing._id) await api(`/admin/promotions/${editing._id}`, { method: 'PUT', body });
      else await api('/admin/promotions', { method: 'POST', body });
      setEditing(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(p) {
    if (!window.confirm(`Xoá chương trình "${p.name}"?`)) return;
    await api(`/admin/promotions/${p._id}`, { method: 'DELETE' }).catch((e) => setError(e.message));
    load();
  }

  const toggleIn = (key, id, on) =>
    setEditing({ ...editing, [key]: on ? [...editing[key], id] : editing[key].filter((x) => x !== id) });

  // Page đã ngắt kết nối nhưng đang có trong chương trình vẫn hiện để giữ/bỏ chọn
  const formPages = [
    ...data.pages,
    ...(editing?.pageIds || []).filter((id) => !data.pages.some((p) => p.pageId === id)).map((id) => ({ pageId: id, name: '', gone: true })),
  ];

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Khuyến mãi</h1>
        {canManage && <button className="btn" onClick={() => setEditing({ ...EMPTY })}>+ Thêm chương trình</button>}
      </div>
      <p className="muted">
        Khuyến mãi chung áp dụng cho mọi kênh (Website, WhatsApp, Instagram, Chat thử và mọi Page). Khuyến mãi riêng chỉ áp dụng cho tin nhắn đến từ Page
        đã chọn. Mỗi sản phẩm chỉ nhận một khuyến mãi có giá tốt nhất.
      </p>
      <label>
        Lọc
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">Tất cả</option>
          <option value="shared">Áp dụng chung</option>
          {data.pages.map((p) => (
            <option key={p.pageId} value={p.pageId}>{p.name || p.pageId}</option>
          ))}
        </select>
      </label>
      {error && !editing && <p className="error">{error}</p>}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Tên</th><th>Mức giảm</th><th>Áp dụng cho</th><th>Sản phẩm</th><th>Thời gian</th><th>Trạng thái</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p._id}>
                <td><strong>{p.name}</strong>{p.description && <div className="muted">{p.description}</div>}</td>
                <td>{p.type === 'percent' ? `${p.value}%` : formatVND(p.value)}</td>
                <td>{p.scope === 'all' ? 'Tất cả Page/kênh' : p.pageIds.map(pageName).join(', ')}</td>
                <td>
                  {p.productScope === 'all' ? 'Tất cả' : <span title={p.productIds.map(productName).join(', ')}>{p.productIds.length} sản phẩm</span>}
                </td>
                <td>{p.startAt ? formatTime(p.startAt) : '—'} – {p.endAt ? formatTime(p.endAt) : '—'}</td>
                <td>
                  <span className={p.state === 'running' ? 'badge badge-ok' : 'badge'}>{STATE_LABEL[p.state]}</span>
                </td>
                <td className="actions">
                  {canManage && (
                    <>
                      <button className="btn-ghost" onClick={() => setEditing(toForm(p))}>Sửa</button>
                      <button className="btn-ghost danger" onClick={() => remove(p)}>Xoá</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="muted">Chưa có chương trình khuyến mãi.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal title={editing._id ? 'Sửa chương trình' : 'Thêm chương trình'} onClose={() => setEditing(null)}>
          <form className="form-grid" onSubmit={save}>
            <label className="span-2">
              Tên chương trình
              <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} required />
            </label>
            <label className="span-2">
              Mô tả
              <textarea rows={2} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            </label>
            <label>
              Loại
              <select value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value })}>
                <option value="percent">Giảm theo %</option>
                <option value="fixed">Giảm số tiền mỗi sản phẩm</option>
              </select>
            </label>
            <label>
              Mức giảm
              <input type="number" min={0} value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} required />
            </label>
            <div className="span-2">
              <label className="check">
                <input type="radio" name="scope" checked={editing.scope === 'all'} onChange={() => setEditing({ ...editing, scope: 'all' })} />
                Áp dụng chung
              </label>
              <label className="check">
                <input type="radio" name="scope" checked={editing.scope === 'pages'} onChange={() => setEditing({ ...editing, scope: 'pages' })} />
                Chỉ các Page đã chọn
              </label>
              {editing.scope === 'pages' &&
                formPages.map((p) => (
                  <label key={p.pageId} className="check">
                    <input type="checkbox" checked={editing.pageIds.includes(p.pageId)} onChange={(e) => toggleIn('pageIds', p.pageId, e.target.checked)} />
                    {p.gone ? p.pageId : p.name || p.pageId}
                    {p.gone && ' (đã ngắt kết nối)'}
                  </label>
                ))}
            </div>
            <div className="span-2">
              <label className="check">
                <input type="radio" name="productScope" checked={editing.productScope === 'all'} onChange={() => setEditing({ ...editing, productScope: 'all' })} />
                Tất cả sản phẩm
              </label>
              <label className="check">
                <input type="radio" name="productScope" checked={editing.productScope === 'products'} onChange={() => setEditing({ ...editing, productScope: 'products' })} />
                Sản phẩm đã chọn
              </label>
              {editing.productScope === 'products' &&
                data.products.map((p) => (
                  <label key={p._id} className="check">
                    <input type="checkbox" checked={editing.productIds.includes(p._id)} onChange={(e) => toggleIn('productIds', p._id, e.target.checked)} />
                    {p.name} ({p.sku}) – {formatVND(p.effectivePrice)}
                  </label>
                ))}
            </div>
            <label>
              Bắt đầu
              <input type="datetime-local" value={editing.startAt} onChange={(e) => setEditing({ ...editing, startAt: e.target.value })} />
            </label>
            <label>
              Kết thúc
              <input type="datetime-local" value={editing.endAt} onChange={(e) => setEditing({ ...editing, endAt: e.target.value })} />
            </label>
            <label className="check span-2">
              <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
              Đang bật
            </label>
            {error && <p className="error span-2">{error}</p>}
            <div className="span-2 form-actions">
              <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>Huỷ</button>
              <button className="btn">Lưu</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
