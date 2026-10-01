// Cầu nối Socket.IO: dashboard admin (room "admin") và widget web (room "web:<sessionId>")
let io = null;

export function setIO(instance) {
  io = instance;
}

export function emitAdmin(event, payload) {
  io?.to('admin').emit(event, payload);
}

export function emitCustomer(channel, externalId, event, payload) {
  if (channel === 'web') io?.to(`web:${externalId}`).emit(event, payload);
}
