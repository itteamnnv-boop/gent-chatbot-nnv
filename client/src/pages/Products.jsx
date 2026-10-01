import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../api.js';
import Modal from '../components/Modal.jsx';
import { formatVND } from '../format.js';
import { can } from '../permissions.js';

const EMPTY = { sku: '', name: '', category: '', price: 0, salePrice: '', unit: 'sản phẩm', stock: 0, tags: '', description: '', usage: '', active: true };

function toForm(p) {
  return { ...EMPTY, ...p, salePrice: p.salePrice ?? '', tags: (p.tags || []).join(', ') };
}

function toPayload(f) {
  return {
    ...f,
    price: Number(f.price),
    stock: Number(f.stock),
    salePrice: f.salePrice === '' ? null : Number(f.salePrice),
    tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean),
  };
}

export default function Products() {
  const { me } = useOutletContext();
  const canManage = can(me, 'products.manage');
  const [products, setProducts] = useState([]);
  const [editing, setEditing] = useState(null); // null | form object
  const [error, setError] = useState('');

  const load = () => api('/admin/products').then(setProducts).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  async function save(e) {
    e.preventDefault();
    setError('');
    try {
      const body = toPayload(editing);
      if (editing._id) await api(`/admin/products/${editing._id}`, { method: 'PUT', body });
      else await api('/admin/products', { method: 'POST', body });
      setEditing(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(p) {
    if (!window.confirm(`Xoá sản phẩm "${p.name}"?`)) return;
    await api(`/admin/products/${p._id}`, { method: 'DELETE' }).catch((e) => setError(e.message));
    load();
  }

  const field = (key, label, props = {}) => (
    <label>
      {label}
      <input value={editing[key]} onChange={(e) => setEditing({ ...editing, [key]: e.target.value })} {...props} />
    </label>
  );

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Sản phẩm</h1>
        {canManage && <button className="btn" onClick={() => setEditing({ ...EMPTY })}>+ Thêm sản phẩm</button>}
      </div>
      <p className="muted">AI chỉ tư vấn & bán sản phẩm đang bật. Mô tả, tags và hướng dẫn sử dụng càng rõ, AI tư vấn càng chính xác.</p>
      {error && !editing && <p className="error">{error}</p>}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>SKU</th><th>Tên</th><th>Danh mục</th><th className="num">Giá bán</th><th className="num">Tồn kho</th><th>Trạng thái</th><th /></tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p._id}>
                <td>{p.sku}</td>
                <td><strong>{p.name}</strong><div className="muted">{p.unit}</div></td>
                <td>{p.category}</td>
                <td className="num">
                  {formatVND(p.effectivePrice)}
                  {p.effectivePrice < p.price && <div className="muted strike">{formatVND(p.price)}</div>}
                </td>
                <td className={`num${p.stock === 0 ? ' error' : ''}`}>{p.stock}</td>
                <td>{p.active ? <span className="badge badge-ok">Đang bán</span> : <span className="badge">Ẩn</span>}</td>
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
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal title={editing._id ? 'Sửa sản phẩm' : 'Thêm sản phẩm'} onClose={() => setEditing(null)}>
          <form className="form-grid" onSubmit={save}>
            {field('sku', 'SKU', { required: true })}
            {field('name', 'Tên sản phẩm', { required: true })}
            {field('category', 'Danh mục')}
            {field('unit', 'Đơn vị (vd: bao 25kg)')}
            {field('price', 'Giá gốc (đ)', { type: 'number', min: 0, required: true })}
            {field('salePrice', 'Giá khuyến mãi (đ, để trống nếu không có)', { type: 'number', min: 0 })}
            {field('stock', 'Tồn kho', { type: 'number', min: 0, required: true })}
            {field('tags', 'Tags (phân cách bằng dấu phẩy)')}
            <label className="span-2">
              Mô tả
              <textarea rows={3} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            </label>
            <label className="span-2">
              Hướng dẫn sử dụng
              <textarea rows={3} value={editing.usage} onChange={(e) => setEditing({ ...editing, usage: e.target.value })} />
            </label>
            <label className="check span-2">
              <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
              Đang bán
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
