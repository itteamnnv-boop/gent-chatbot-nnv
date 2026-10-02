import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api, auth } from '../api.js';
import Avatar from '../components/Avatar.jsx';
import Icon from '../components/Icons.jsx';
import { can } from '../permissions.js';

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
  { to: '/admin/inbox', label: 'Hộp thư', icon: 'chat', perm: 'inbox.view' },
  { to: '/admin/orders', label: 'Đơn hàng', icon: 'receipt', perm: 'orders.view' },
  { to: '/admin/products', label: 'Sản phẩm', icon: 'box', perm: 'products.view' },
  { to: '/admin/stats', label: 'Thống kê', icon: 'chart', perm: 'stats.view' },
  { to: '/admin/channels', label: 'Kênh kết nối', icon: 'link', perm: 'channels.view' },
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

export default function AdminLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isAgent = AGENT_PATHS.includes(pathname.replace(/\/$/, '') || '/admin');
  const [me, setMe] = useState(null);

  useEffect(() => {
    api('/auth/me').then(setMe).catch(() => {});
  }, []);

  if (!me) return <p className="muted pad">Đang tải...</p>;
  const allowed = (n) => !n.perm || can(me, n.perm);

  return (
    <div className="mba">
      <aside className="rail">
        <div className="rail-brand" title="AI Sales Agent">AI</div>
        <nav className="rail-nav">
          {RAIL.filter(allowed).map((r) => (
            <NavLink
              key={r.to}
              to={r.to}
              end={!r.agent}
              title={r.label}
              aria-label={r.label}
              className={({ isActive }) => `rail-item${(r.agent ? isAgent : isActive) ? ' active' : ''}`}
            >
              <Icon name={r.icon} size={22} />
            </NavLink>
          ))}
        </nav>
        <div className="rail-bottom">
          <a className="rail-item" href="/" target="_blank" rel="noreferrer" title="Mở widget chat" aria-label="Mở widget chat">
            <Icon name="external" size={22} />
          </a>
          <button
            className="rail-item"
            title="Đăng xuất"
            aria-label="Đăng xuất"
            onClick={() => {
              auth.clear();
              navigate('/admin/login');
            }}
          >
            <Icon name="logout" size={22} />
          </button>
          <Avatar name={me.displayName || me.username} size={32} />
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
