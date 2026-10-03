import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api, auth, storage } from '../api.js';
import Avatar from '../components/Avatar.jsx';
import Icon from '../components/Icons.jsx';
import { can } from '../permissions.js';
import { createAdminSocket, INBOX_READ_EVENT } from '../socket.js';

// Khoá localStorage lưu trạng thái ghim thanh bên
const PIN_KEY = 'admin_rail_pinned';

// Menu phụ của khu vực AI Agent (giống Business Agent: Trang chủ / Thông tin / Hướng dẫn / Chat thử / Cài đặt)
const AGENT_NAV = [
  { to: '/admin', label: 'Trang chủ', icon: 'home', end: true },
  { to: '/admin/info', label: 'Thông tin của bạn', icon: 'bulb', perm: 'settings.view' },
  { to: '/admin/guidance', label: 'Hướng dẫn', icon: 'guide', perm: 'settings.view' },
  { to: '/admin/playground', label: 'Chat thử', icon: 'flask', perm: 'playground.use' },
  { to: '/admin/settings', label: 'Cài đặt', icon: 'gear', perm: 'settings.view' },
];
const AGENT_PATHS = AGENT_NAV.map((n) => n.to);

// Cột icon ngoài cùng bên trái
const RAIL = [
  { to: '/admin', label: 'AI Agent', icon: 'sparkle', agent: true },
  { to: '/admin/inbox', label: 'Hộp thư', icon: 'chat', perm: 'inbox.view', badge: 'inbox' },
  { to: '/admin/orders', label: 'Đơn hàng', icon: 'receipt', perm: 'orders.view' },
  { to: '/admin/products', label: 'Sản phẩm', icon: 'box', perm: 'products.view' },
  { to: '/admin/stats', label: 'Thống kê', icon: 'chart', perm: 'stats.view' },
  { to: '/admin/channels', label: 'Kênh kết nối', icon: 'link', perm: 'channels.view' },
  { to: '/admin/promotions', label: 'Khuyến mãi', icon: 'tag', perm: 'promotions.view' },
  { to: '/admin/users', label: 'Người dùng', icon: 'person', perm: 'users.manage' },
];

function AiToggle({ me }) {
  const [enabled, setEnabled] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (can(me, 'settings.view')) api('/admin/settings').then((s) => setEnabled(s.botEnabled)).catch(() => {});
  }, [me]);

  async function toggle() {
    setBusy(true);
    try {
      const s = await api('/admin/settings', { method: 'PUT', body: { botEnabled: !enabled } });
      setEnabled(s.botEnabled);
    } finally {
      setBusy(false);
    }
  }

  if (enabled === null) return null;
  return (
    <div className="ai-toggle">
      <span className={`ai-badge${enabled ? ' on' : ''}`}>{enabled ? 'AI đang bật' : 'AI đang tắt'}</span>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Bật/tắt AI tự động trả lời"
        className={`switch${enabled ? ' on' : ''}`}
        onClick={toggle}
        disabled={busy || !can(me, 'settings.manage')}
      >
        <span />
      </button>
    </div>
  );
}

// true khi có hội thoại chưa đọc trong phạm vi người xem; enabled = có quyền inbox.view
function useInboxUnread(enabled) {
  const [unread, setUnread] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setUnread(false);
      return undefined;
    }
    let alive = true;
    let timer = null;
    const load = () => {
      api('/admin/inbox/pages')
        .then((r) => {
          if (alive) setUnread((r.otherUnread || 0) > 0 || (r.pages || []).some((p) => p.unread > 0));
        })
        .catch(() => {});
    };
    // Gom nhiều sự kiện dồn dập thành một lần gọi API
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 1000);
    };
    load();
    const socket = createAdminSocket();
    socket.on('conversation:update', schedule);
    socket.io.on('reconnect', load);
    window.addEventListener(INBOX_READ_EVENT, schedule);
    return () => {
      alive = false;
      clearTimeout(timer);
      socket.disconnect();
      window.removeEventListener(INBOX_READ_EVENT, schedule);
    };
  }, [enabled]);

  return unread;
}

export default function AdminLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isAgent = AGENT_PATHS.includes(pathname.replace(/\/$/, '') || '/admin');
  const [me, setMe] = useState(null);
  const [pinned, setPinned] = useState(() => storage.get(PIN_KEY) === '1');
  const hasUnread = useInboxUnread(can(me, 'inbox.view'));

  function togglePin() {
    const next = !pinned;
    setPinned(next);
    storage.set(PIN_KEY, next ? '1' : null);
  }

  useEffect(() => {
    api('/auth/me').then(setMe).catch(() => {});
  }, []);

  if (!me) return <p className="muted pad">Đang tải...</p>;
  const allowed = (n) => !n.perm || can(me, n.perm);

  return (
    <div className={`mba${pinned ? ' pinned' : ''}`}>
      <aside className="rail">
        <div className="rail-panel">
          <div className="rail-row rail-head">
            <span className="rail-icon"><span className="rail-brand">AI</span></span>
            <span className="rail-label rail-title">AI Sales Agent</span>
            <button type="button" className="rail-pin" aria-pressed={pinned} aria-label="Ghim thanh bên" title={pinned ? 'Bỏ ghim thanh bên' : 'Ghim thanh bên'} onClick={togglePin}>
              <Icon name="pin" size={18} />
            </button>
          </div>
          <nav className="rail-nav">
            {RAIL.filter(allowed).map((r) => {
              const dot = r.badge === 'inbox' && hasUnread;
              return (
                <NavLink
                  key={r.to}
                  to={r.to}
                  end={!r.agent}
                  aria-label={dot ? `${r.label} (có tin chưa đọc)` : r.label}
                  className={({ isActive }) => `rail-item${(r.agent ? isAgent : isActive) ? ' active' : ''}`}
                >
                  <span className="rail-icon"><Icon name={r.icon} size={22} />{dot && <span className="rail-dot" />}</span>
                  <span className="rail-label">{r.label}</span>
                </NavLink>
              );
            })}
          </nav>
          <div className="rail-bottom">
            <a className="rail-item" href="/" target="_blank" rel="noreferrer" aria-label="Mở widget chat">
              <span className="rail-icon"><Icon name="external" size={22} /></span>
              <span className="rail-label">Mở widget chat</span>
            </a>
            <button
              type="button"
              className="rail-item"
              aria-label="Đăng xuất"
              onClick={() => {
                auth.clear();
                navigate('/admin/login');
              }}
            >
              <span className="rail-icon"><Icon name="logout" size={22} /></span>
              <span className="rail-label">Đăng xuất</span>
            </button>
            <div className="rail-row rail-user">
              <span className="rail-icon"><Avatar name={me.displayName || me.username} size={32} /></span>
              <span className="rail-label">{me.displayName || me.username}</span>
            </div>
          </div>
        </div>
      </aside>

      <main className="mba-main">
        {isAgent ? (
          <>
            <header className="mba-header">
              <div>
                <h1>AI Business Agent</h1>
                <p>Quản lý những gì AI biết và cách AI hành động thay mặt doanh nghiệp bạn.</p>
              </div>
              <AiToggle me={me} />
            </header>
            <div className="mba-layout">
              <nav className="mba-subnav">
                {AGENT_NAV.filter(allowed).map((n) => (
                  <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `subnav-item${isActive ? ' active' : ''}`}>
                    <Icon name={n.icon} size={20} />
                    <span>{n.label}</span>
                  </NavLink>
                ))}
              </nav>
              <div className="mba-content">
                <Outlet context={{ me }} />
              </div>
            </div>
          </>
        ) : (
          <div className="mba-page">
            <Outlet context={{ me }} />
          </div>
        )}
      </main>
    </div>
  );
}
