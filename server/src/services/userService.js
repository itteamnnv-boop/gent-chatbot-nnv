import { config } from '../config.js';
import { User } from '../models/User.js';
import { effectivePermissions } from '../permissions.js';
import { hashPassword } from '../utils/password.js';

// Dùng cho /auth/me và đăng nhập
export function publicUser(user) {
  return {
    _id: user._id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    active: user.active,
    permissions: effectivePermissions(user),
    ...scopeFields(user),
  };
}

// Phạm vi Hộp thư/Đơn hàng: admin luôn là "Tất cả"; bản ghi cũ thiếu trường thì mặc định không giới hạn
function scopeFields(user) {
  if (user.role === 'admin') return { inboxScope: 'all', pageIds: [], inboxOther: false };
  return { inboxScope: user.inboxScope || 'all', pageIds: user.pageIds || [], inboxOther: user.inboxOther === true };
}

// Dùng cho trang Người dùng
export function userRow(user) {
  return {
    _id: user._id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    active: user.active,
    permissions: user.permissions,
    ...scopeFields(user),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

// Chỉ tạo admin đầu tiên (từ .env) khi chưa có người dùng nào
export async function ensureBootstrapAdmin() {
  if ((await User.estimatedDocumentCount()) !== 0) return null;
  return User.create({
    username: config.admin.username,
    displayName: 'Admin',
    role: 'admin',
    passwordHash: await hashPassword(config.admin.password),
  });
}

export function countOtherActiveAdmins(excludeId) {
  return User.countDocuments({ role: 'admin', active: true, _id: { $ne: excludeId } });
}
