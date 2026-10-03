import { io } from 'socket.io-client';
import { auth } from './api.js';

// Event cửa sổ: Hộp thư vừa đánh dấu đã đọc một hội thoại (route /read không phát socket)
export const INBOX_READ_EVENT = 'inbox:read';

export function createAdminSocket() {
  return io({ auth: { token: auth.token } });
}

export function createCustomerSocket(sessionId) {
  const socket = io();
  socket.on('connect', () => socket.emit('web:join', sessionId));
  return socket;
}
