import { Navigate, Route, Routes, useOutletContext } from 'react-router-dom';
import { auth } from './api.js';
import AdminLayout from './pages/AdminLayout.jsx';
import AgentHome from './pages/AgentHome.jsx';
import AgentInfo from './pages/AgentInfo.jsx';
import AgentSettings from './pages/AgentSettings.jsx';
import Channels from './pages/Channels.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Inbox from './pages/Inbox.jsx';
import Login from './pages/Login.jsx';
import Orders from './pages/Orders.jsx';
import PlaygroundPage from './pages/PlaygroundPage.jsx';
import Products from './pages/Products.jsx';
import Promotions from './pages/Promotions.jsx';
import ShopDemo from './pages/ShopDemo.jsx';
import Users from './pages/Users.jsx';
import { can } from './permissions.js';

function RequireAuth({ children }) {
  return auth.token ? children : <Navigate to="/admin/login" replace />;
}

function RequirePermission({ perm, children }) {
  const { me } = useOutletContext();
  return can(me, perm) ? children : <p className="error">Bạn không có quyền truy cập chức năng này.</p>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ShopDemo />} />
      <Route path="/admin/login" element={<Login />} />
      <Route
        path="/admin"
        element={
          <RequireAuth>
            <AdminLayout />
          </RequireAuth>
        }
      >
        {/* Khu vực AI Agent */}
        <Route index element={<AgentHome />} />
        <Route path="info" element={<RequirePermission perm="settings.view"><AgentInfo /></RequirePermission>} />
        <Route path="guidance" element={<RequirePermission perm="settings.view"><AgentSettings section="guidance" /></RequirePermission>} />
        <Route path="playground" element={<RequirePermission perm="playground.use"><PlaygroundPage /></RequirePermission>} />
        <Route path="settings" element={<RequirePermission perm="settings.view"><AgentSettings section="settings" /></RequirePermission>} />
        {/* Công cụ vận hành */}
        <Route path="inbox" element={<RequirePermission perm="inbox.view"><Inbox /></RequirePermission>} />
        <Route path="orders" element={<RequirePermission perm="orders.view"><Orders /></RequirePermission>} />
        <Route path="products" element={<RequirePermission perm="products.view"><Products /></RequirePermission>} />
        <Route path="stats" element={<RequirePermission perm="stats.view"><Dashboard /></RequirePermission>} />
        <Route path="channels" element={<RequirePermission perm="channels.view"><Channels /></RequirePermission>} />
        <Route path="promotions" element={<RequirePermission perm="promotions.view"><Promotions /></RequirePermission>} />
        <Route path="users" element={<RequirePermission perm="users.manage"><Users /></RequirePermission>} />
        <Route path="knowledge" element={<Navigate to="/admin/info" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
