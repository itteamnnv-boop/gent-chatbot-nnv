// Cầu nối Socket.IO: dashboard admin (room "perm:<quyền>") và widget web (room "web:<sessionId>")
let io = null;

// Event nào gửi tới người có (ít nhất) một trong các quyền này
const EVENT_PERMISSIONS = {
  'message:new': ['inbox.view'],
  'conversation:update': ['inbox.view'],
  'order:new': ['orders.view', 'inbox.view'],
  'order:update': ['orders.view', 'inbox.view'],
};

export const permissionRoom = (key) => `perm:${key}`;

export function setIO(instance) {
  io = instance;
}

export function emitAdmin(event, payload) {
  const keys = EVENT_PERMISSIONS[event];
  if (!keys) {
    console.warn(`emitAdmin: event "${event}" chưa khai báo quyền, bỏ qua`);
    return;
  }
  io?.to(keys.map(permissionRoom)).emit(event, payload);
}

export function emitCustomer(channel, externalId, event, payload) {
  if (channel === 'web') io?.to(`web:${externalId}`).emit(event, payload);
}
