import { Navigate, Route, Routes } from 'react-router-dom';
import { auth } from './api.js';
import AdminLayout from './pages/AdminLayout.jsx';
import AgentHome from './pages/AgentHome.jsx';
import AgentInfo from './pages/AgentInfo.jsx';
import AgentSettings from './pages/AgentSettings.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Inbox from './pages/Inbox.jsx';
import Login from './pages/Login.jsx';
import Orders from './pages/Orders.jsx';
import PlaygroundPage from './pages/PlaygroundPage.jsx';
import Products from './pages/Products.jsx';
import ShopDemo from './pages/ShopDemo.jsx';

function RequireAuth({ children }) {
  return auth.token ? children : <Navigate to="/admin/login" replace />;
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
        <Route path="info" element={<AgentInfo />} />
        <Route path="guidance" element={<AgentSettings section="guidance" />} />
        <Route path="playground" element={<PlaygroundPage />} />
        <Route path="settings" element={<AgentSettings section="settings" />} />
        {/* Công cụ vận hành */}
        <Route path="inbox" element={<Inbox />} />
        <Route path="orders" element={<Orders />} />
        <Route path="products" element={<Products />} />
        <Route path="stats" element={<Dashboard />} />
        <Route path="knowledge" element={<Navigate to="/admin/info" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
