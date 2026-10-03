import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../api.js';
import Modal from '../components/Modal.jsx';

const EMPTY = { username: '', displayName: '', password: '', role: 'staff', permissions: [], active: true, inboxScope: 'all', pageIds: [], inboxOther: false };

function toForm(u) {
  return { ...EMPTY, ...u, password: '' };
}

export default function Users() {
  const { me } = useOutletContext();
  const [users, setUsers] = useState([]);
  const [catalog, setCatalog] = useState({ roles: [], permissions: [], pages: [] });
  const [editing, setEditing] = useState(null); // null | form object
  const [error, setError] = useState('');

  const load = () => api('/admin/users').then(setUsers).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    api('/admin/permissions').then(setCatalog).catch((e) => setError(e.message));
  }, []);

  const isSelf = (u) => u._id === me._id;
  const isStaff = me.role === 'staff';
  // Nhân viên (có quyền quản lý người dùng) không được đụng tới tài khoản quản trị
  const canTouch = (u) => !(isStaff && u.role === 'admin');

  async function save(e) {
    e.preventDefault();
    setError('');
    try {
      const self = editing._id && isSelf(editing);
      const body = { displayName: editing.displayName };
      if (!editing._id) body.username = editing.username;
      if (!editing._id || editing.password) body.password = editing.password;
      if (!self) {
        body.role = editing.role;
        body.permissions = editing.permissions;
        body.active = editing.active;
        body.inboxScope = editing.inboxScope;
        body.pageIds = editing.pageIds;
        body.inboxOther = editing.inboxOther;
      }
      if (editing._id) await api(`/admin/users/${editing._id}`, { method: 'PUT', body });
      else await api('/admin/users', { method: 'POST', body });
      setEditing(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(u) {
    if (!window.confirm(`Xoá người dùng "${u.username}"?`)) return;
    await api(`/admin/users/${u._id}`, { method: 'DELETE' }).catch((e) => setError(e.message));
    load();
  }

  const togglePermission = (key, on) =>
    setEditing({ ...editing, permissions: on ? [...editing.permissions, key] : editing.permissions.filter((k) => k !== key) });

  const togglePage = (pageId, on) =>
    setEditing({ ...editing, pageIds: on ? [...editing.pageIds, pageId] : editing.pageIds.filter((id) => id !== pageId) });

  // Page đã giao nhưng không còn trong danh sách kết nối vẫn hiện để bỏ tick được
  const scopePages = [
    ...catalog.pages,
    ...(editing?.pageIds || []).filter((id) => !catalog.pages.some((p) => p.pageId === id)).map((id) => ({ pageId: id, name: '', gone: true })),
  ];
  const groups = [...new Set(catalog.permissions.map((p) => p.group))];
  const editingSelf = editing?._id && isSelf(editing);

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Người dùng</h1>
        <button className="btn" onClick={() => { setError(''); setEditing({ ...EMPTY }); }}>+ Thêm người dùng</button>
      </div>
      <p className="muted">Quản trị viên có toàn quyền. Nhân viên chỉ dùng được những chức năng được tick chọn. Có thể giới hạn nhân viên chỉ xem hội thoại và đơn hàng của một số Page. Ngắt kết nối Page sẽ tự bỏ Page đó khỏi nhân viên được giao.</p>
      {error && !editing && <p className="error">{error}</p>}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Tên đăng nhập</th><th>Tên hiển thị</th><th>Vai trò</th><th>Trạng thái</th><th /></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u._id}>
                <td><strong>{u.username}</strong></td>
                <td>{u.displayName}</td>
                <td>{u.role === 'admin' ? 'Quản trị viên' : 'Nhân viên'}</td>
                <td>{u.active ? <span className="badge badge-ok">Đang hoạt động</span> : <span className="badge">Đã khoá</span>}</td>
                <td className="actions">
                  {canTouch(u) && <button className="btn-ghost" onClick={() => { setError(''); setEditing(toForm(u)); }}>Sửa</button>}
                  {canTouch(u) && !isSelf(u) && <button className="btn-ghost danger" onClick={() => remove(u)}>Xoá</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal title={editing._id ? 'Sửa người dùng' : 'Thêm người dùng'} onClose={() => setEditing(null)}>
          <form className="form-grid" onSubmit={save}>
            <label>
              Tên đăng nhập
              <input
                value={editing.username}
                onChange={(e) => setEditing({ ...editing, username: e.target.value })}
                required
                disabled={!!editing._id}
              />
            </label>
            <label>
              Tên hiển thị
              <input value={editing.displayName} onChange={(e) => setEditing({ ...editing, displayName: e.target.value })} />
            </label>
            <label className="span-2">
              {editing._id ? 'Mật khẩu mới (để trống nếu không đổi)' : 'Mật khẩu'}
              <input
                type="password"
                autoComplete="new-password"
                value={editing.password}
                onChange={(e) => setEditing({ ...editing, password: e.target.value })}
                required={!editing._id}
                minLength={editing._id && !editing.password ? undefined : 8}
              />
            </label>
            <label className="span-2">
              Vai trò
              <select value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value })} disabled={editingSelf}>
                {!isStaff && <option value="admin">Quản trị viên</option>}
                <option value="staff">Nhân viên</option>
              </select>
            </label>
            {editing.role === 'staff' ? (
              groups.map((g) => (
                <div key={g} className="span-2">
                  <strong>{g}</strong>
                  {catalog.permissions.filter((p) => p.group === g).map((p) => (
                    <label key={p.key} className="check">
                      <input
                        type="checkbox"
                        checked={editing.permissions.includes(p.key)}
                        onChange={(e) => togglePermission(p.key, e.target.checked)}
                        disabled={editingSelf}
                      />
                      {p.label}
                    </label>
                  ))}
                </div>
              ))
            ) : (
              <p className="muted span-2">Quản trị viên có toàn bộ quyền.</p>
            )}
            {editing.role === 'staff' && (
              <div className="span-2">
                <strong>Phạm vi Hộp thư và Đơn hàng</strong>
                <select
                  value={editing.inboxScope}
                  onChange={(e) => setEditing({ ...editing, inboxScope: e.target.value })}
                  disabled={editingSelf}
                  aria-label="Phạm vi Hộp thư và Đơn hàng"
                >
                  <option value="all">Tất cả Page và kênh</option>
                  <option value="pages">Chỉ Page được giao</option>
                </select>
                {editing.inboxScope === 'pages' && (
                  <>
                    {scopePages.length === 0 && <p className="muted">Chưa có Page nào được kết nối.</p>}
                    {scopePages.map((p) => (
                      <label key={p.pageId} className="check">
                        <input
                          type="checkbox"
                          checked={editing.pageIds.includes(p.pageId)}
                          onChange={(e) => togglePage(p.pageId, e.target.checked)}
                          disabled={editingSelf}
                        />
                        {p.name || p.pageId}
                        {p.gone && ' (đã ngắt kết nối)'}
                      </label>
                    ))}
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={editing.inboxOther}
                        onChange={(e) => setEditing({ ...editing, inboxOther: e.target.checked })}
                        disabled={editingSelf}
                      />
                      Xem cả hội thoại ngoài Fanpage (Website, Instagram, WhatsApp)
                    </label>
                  </>
                )}
              </div>
            )}
            <label className="check span-2">
              <input
                type="checkbox"
                checked={editing.active}
                onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
                disabled={editingSelf}
              />
              Đang hoạt động
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
