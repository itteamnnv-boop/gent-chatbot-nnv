import { io } from 'socket.io-client';
import { auth } from './api.js';

export function createAdminSocket() {
  return io({ auth: { token: auth.token } });
}

export function createCustomerSocket(sessionId) {
  const socket = io();
  socket.on('connect', () => socket.emit('web:join', sessionId));
  return socket;
}
