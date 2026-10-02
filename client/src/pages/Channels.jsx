import { useEffect, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import Modal from '../components/Modal.jsx';
import { formatTime } from '../format.js';
import { can } from '../permissions.js';

const OAUTH_ERRORS = {
  cancelled: 'Bạn đã huỷ đăng nhập Facebook.',
  state: 'Phiên kết nối không hợp lệ hoặc đã hết hạn, vui lòng thử lại.',
  exchange: 'Không lấy được token từ Facebook, vui lòng thử lại.',
  no_pages: 'Tài khoản Facebook này không quản lý Page nào (hoặc chưa cấp quyền Page).',
};

export default function Channels() {
  const { me } = useOutletContext();
  const canManage = can(me, 'channels.manage');
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState({ configured: true, envTokenConfigured: false, pages: [] });
  const [picking, setPicking] = useState(null); // null | { sessionId, pages, selected }
  const [error, setError] = useState('');
  const [failed, setFailed] = useState([]);

  const load = () => api('/admin/meta/pages').then(setData).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const code = searchParams.get('error');
    const sessionId = searchParams.get('session');
    if (code) {
      setError(OAUTH_ERRORS[code] || 'Kết nối thất bại.');
      setSearchParams({}, { replace: true });
    } else if (sessionId) {
      setSearchParams({}, { replace: true });
      api(`/admin/meta/oauth/sessions/${encodeURIComponent(sessionId)}`)
        .then((s) => setPicking({ sessionId, pages: s.pages, selected: s.pages.filter((p) => p.canMessage).map((p) => p.pageId) }))
        .catch((e) => setError(e.message));
    }
  }, []);

  async function startConnect() {
    setError('');
    try {
      const { url } = await api('/admin/meta/oauth/start', { method: 'POST' });
      window.location.assign(url);
    } catch (err) {
      setError(err.message);
    }
  }

  async function connect(e) {
    e.preventDefault();
    setError('');
    try {
      const result = await api('/admin/meta/pages', { method: 'POST', body: { sessionId: picking.sessionId, pageIds: picking.selected } });
      setPicking(null);
      setFailed(result.failed);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(p) {
    if (!window.confirm(`Ngắt kết nối Page "${p.name}"? Bot sẽ không trả lời tin nhắn từ Page này nữa.`)) return;
    await api(`/admin/meta/pages/${p.pageId}`, { method: 'DELETE' }).catch((err) => setError(err.message));
    load();
  }

  const toggle = (pageId, on) =>
    setPicking({ ...picking, selected: on ? [...picking.selected, pageId] : picking.selected.filter((id) => id !== pageId) });

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Kênh kết nối</h1>
        {canManage && data.configured && <button className="btn" onClick={startConnect}>+ Kết nối Facebook Page</button>}
      </div>
      {!data.configured && <p className="muted">Chưa cấu hình META_APP_ID, META_APP_SECRET, META_OAUTH_REDIRECT_URI trong server/.env.</p>}
      {data.envTokenConfigured && <p className="muted">Page chưa kết nối sẽ dùng META_PAGE_ACCESS_TOKEN trong .env.</p>}
      {error && !picking && <p className="error">{error}</p>}
      {failed.length > 0 && <p className="error">{failed.map((f) => `${f.name || f.pageId}: ${f.error}`).join('; ')}</p>}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Tên Page</th><th>Page ID</th><th>Trạng thái</th><th>Khuyến mãi riêng</th><th>Người kết nối</th><th>Ngày kết nối</th><th /></tr>
          </thead>
          <tbody>
            {data.pages.map((p) => (
              <tr key={p.pageId}>
                <td><strong>{p.name}</strong></td>
                <td>{p.pageId}</td>
                <td>
                  {p.status === 'active' ? <span className="badge badge-ok">Đang hoạt động</span> : <span className="badge" title={p.lastError}>Cần kết nối lại</span>}
                </td>
                <td>
                  {can(me, 'promotions.view') ? <Link to={`/admin/promotions?page=${p.pageId}`}>{p.promotionCount}</Link> : p.promotionCount}
                </td>
                <td>{p.connectedBy}</td>
                <td>{formatTime(p.connectedAt)}</td>
                <td className="actions">
                  {canManage && <button className="btn-ghost danger" onClick={() => remove(p)}>Ngắt kết nối</button>}
                </td>
              </tr>
            ))}
            {data.pages.length === 0 && (
              <tr><td colSpan={7} className="muted">Chưa có Page nào được kết nối.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {picking && (
        <Modal title="Chọn Page cần kết nối" onClose={() => setPicking(null)}>
          <form className="form-grid" onSubmit={connect}>
            <div className="span-2">
              {picking.pages.map((p) => (
                <label key={p.pageId} className="check">
                  <input
                    type="checkbox"
                    checked={picking.selected.includes(p.pageId)}
                    onChange={(e) => toggle(p.pageId, e.target.checked)}
                    disabled={!p.canMessage}
                  />
                  {p.name}
                  {!p.canMessage && ' (không có quyền nhắn tin)'}
                  {p.connected && ' (đã kết nối, sẽ cập nhật token)'}
                </label>
              ))}
            </div>
            {error && <p className="error span-2">{error}</p>}
            <div className="span-2 form-actions">
              <button type="button" className="btn-ghost" onClick={() => setPicking(null)}>Huỷ</button>
              <button className="btn" disabled={picking.selected.length === 0}>Kết nối</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
