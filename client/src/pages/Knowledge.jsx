import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Modal from '../components/Modal.jsx';

const EMPTY = { title: '', content: '', tags: '', active: true };

export default function Knowledge() {
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');

  const load = () => api('/admin/knowledge').then(setItems).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  async function save(e) {
    e.preventDefault();
    setError('');
    const body = { ...editing, tags: editing.tags.split(',').map((t) => t.trim()).filter(Boolean) };
    try {
      if (editing._id) await api(`/admin/knowledge/${editing._id}`, { method: 'PUT', body });
      else await api('/admin/knowledge', { method: 'POST', body });
      setEditing(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(k) {
    if (!window.confirm(`Xoá "${k.title}"?`)) return;
    await api(`/admin/knowledge/${k._id}`, { method: 'DELETE' }).catch((e) => setError(e.message));
    load();
  }

  return (
    <>
      <div className="page-head">
        <h2 className="section-title">Câu hỏi thường gặp & kiến thức</h2>
        <button className="btn" onClick={() => setEditing({ ...EMPTY })}>+ Thêm mục</button>
      </div>
      <p className="muted">FAQ, chính sách, hướng dẫn kỹ thuật. AI tra cứu ở đây trước khi trả lời để không “bịa” thông tin.</p>
      {error && !editing && <p className="error">{error}</p>}
      <div className="kb-list">
        {items.map((k) => (
          <article key={k._id} className={`card kb-item${k.active ? '' : ' inactive'}`}>
            <header>
              <strong>{k.title}</strong>
              <div className="actions">
                <button className="btn-ghost" onClick={() => setEditing({ ...k, tags: (k.tags || []).join(', ') })}>Sửa</button>
                <button className="btn-ghost danger" onClick={() => remove(k)}>Xoá</button>
              </div>
            </header>
            <p>{k.content}</p>
            <div className="conv-badges">{(k.tags || []).map((t) => <span key={t} className="badge">{t}</span>)}</div>
          </article>
        ))}
      </div>

      {editing && (
        <Modal title={editing._id ? 'Sửa mục kiến thức' : 'Thêm mục kiến thức'} onClose={() => setEditing(null)}>
          <form className="form-grid" onSubmit={save}>
            <label className="span-2">
              Tiêu đề
              <input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} required />
            </label>
            <label className="span-2">
              Nội dung
              <textarea rows={6} value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} required />
            </label>
            <label className="span-2">
              Từ khoá (phân cách bằng dấu phẩy — giúp AI tìm đúng mục)
              <input value={editing.tags} onChange={(e) => setEditing({ ...editing, tags: e.target.value })} />
            </label>
            <label className="check span-2">
              <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
              Đang dùng
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
