export const ROLES = ['admin', 'staff'];

export const PERMISSIONS = [
  { key: 'stats.view', label: 'Xem thống kê', group: 'Thống kê' },
  { key: 'inbox.view', label: 'Xem hộp thư', group: 'Hộp thư' },
  { key: 'inbox.reply', label: 'Trả lời khách, tiếp quản / trả lại cho AI', group: 'Hộp thư' },
  { key: 'orders.view', label: 'Xem đơn hàng', group: 'Đơn hàng' },
  { key: 'orders.update', label: 'Đổi trạng thái / huỷ đơn', group: 'Đơn hàng' },
  { key: 'products.view', label: 'Xem sản phẩm', group: 'Sản phẩm' },
  { key: 'products.manage', label: 'Thêm / sửa / xoá / nhập bảng giá sản phẩm', group: 'Sản phẩm' },
  { key: 'knowledge.view', label: 'Xem kho kiến thức & tài liệu', group: 'Kiến thức' },
  { key: 'knowledge.manage', label: 'Sửa kho kiến thức & tài liệu', group: 'Kiến thức' },
  { key: 'settings.view', label: 'Xem cấu hình AI Agent', group: 'AI Agent' },
  { key: 'settings.manage', label: 'Sửa cấu hình AI Agent, bật/tắt AI', group: 'AI Agent' },
  { key: 'playground.use', label: 'Dùng Chat thử', group: 'AI Agent' },
  { key: 'channels.view', label: 'Xem các Facebook Page đã kết nối', group: 'Kênh kết nối' },
  { key: 'channels.manage', label: 'Kết nối / ngắt kết nối Facebook Page', group: 'Kênh kết nối' },
  { key: 'promotions.view', label: 'Xem chương trình khuyến mãi', group: 'Khuyến mãi' },
  { key: 'promotions.manage', label: 'Thêm / sửa / xoá chương trình khuyến mãi', group: 'Khuyến mãi' },
  { key: 'users.manage', label: 'Quản lý người dùng & phân quyền', group: 'Hệ thống' },
];

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

export function effectivePermissions(user) {
  if (!user) return [];
  if (user.role === 'admin') return [...PERMISSION_KEYS];
  return (user.permissions || []).filter((k) => PERMISSION_KEYS.includes(k));
}

export function hasPermission(user, key) {
  return effectivePermissions(user).includes(key);
}
