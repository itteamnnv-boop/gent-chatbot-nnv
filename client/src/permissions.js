// Kiểm tra người dùng hiện tại (từ /auth/me) có quyền `key` không
export function can(me, key) {
  return !!me && Array.isArray(me.permissions) && me.permissions.includes(key);
}
