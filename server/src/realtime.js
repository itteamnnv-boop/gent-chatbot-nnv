// Cầu nối Socket.IO: dashboard admin (room "perm:<quyền>") và widget web (room "web:<sessionId>")
import { effectivePermissions } from './permissions.js';
import { canSee, inboxScopeOf } from './services/inboxScope.js';

let io = null;

// Event nào gửi tới người có (ít nhất) một trong các quyền này
const EVENT_PERMISSIONS = {
  'message:new': ['inbox.view'],
  'conversation:update': ['inbox.view'],
  'page:bot': ['inbox.view'],
  'order:new': ['orders.view', 'inbox.view'],
  'order:update': ['orders.view', 'inbox.view'],
};

// Event mang dữ liệu của một hội thoại/đơn: chỉ gửi cho socket có phạm vi Page cho phép
const SCOPED_EVENTS = new Set(['message:new', 'conversation:update', 'order:new', 'order:update']);

export const permissionRoom = (key) => `perm:${key}`;
const userRoom = (userId) => `user:${userId}`;

export function setIO(instance) {
  io = instance;
}

/** source = { channel, pageId } của hội thoại/đơn; bắt buộc với các event có phạm vi */
export function emitAdmin(event, payload, source) {
  const keys = EVENT_PERMISSIONS[event];
  if (!keys) {
    console.warn(`emitAdmin: event "${event}" chưa khai báo quyền, bỏ qua`);
    return;
  }
  if (!io) return;
  if (!SCOPED_EVENTS.has(event)) {
    io.to(keys.map(permissionRoom)).emit(event, payload);
    return;
  }
  if (!source) console.warn(`emitAdmin: event "${event}" thiếu source, chỉ gửi cho người không bị giới hạn Page`);
  // Gom socket từ các room quyền (bỏ trùng), rồi lọc theo phạm vi từng socket
  const ids = new Set();
  for (const room of keys.map(permissionRoom)) for (const id of io.sockets.adapter.rooms.get(room) ?? []) ids.add(id);
  for (const id of ids) {
    const socket = io.sockets.sockets.get(id);
    if (!socket) continue;
    const scope = socket.data.scope ?? null;
    if (source ? canSee(scope, source) : scope === null) socket.emit(event, payload);
  }
}

export function emitCustomer(channel, externalId, event, payload) {
  if (channel === 'web') io?.to(`web:${externalId}`).emit(event, payload);
}

/** Gắn quyền và phạm vi Page của người dùng vào socket dashboard */
export function attachAdminSocket(socket, user) {
  socket.data.userId = String(user._id);
  socket.data.tokenVersion = user.tokenVersion;
  socket.data.scope = inboxScopeOf(user);
  socket.join([...effectivePermissions(user).map(permissionRoom), userRoom(socket.data.userId)]);
}

/** Áp lại quyền/phạm vi cho mọi socket của người dùng sau khi sửa; user = null nghĩa là đã bị xoá */
export function refreshUserSockets(userId, user) {
  if (!io) return;
  for (const id of [...(io.sockets.adapter.rooms.get(userRoom(userId)) ?? [])]) {
    const socket = io.sockets.sockets.get(id);
    if (!socket) continue;
    if (!user || !user.active || user.tokenVersion !== socket.data.tokenVersion) {
      socket.disconnect(true);
      continue;
    }
    for (const room of [...socket.rooms]) if (room.startsWith('perm:')) socket.leave(room);
    attachAdminSocket(socket, user);
  }
}
