import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { Server } from 'socket.io';
import { config } from './config.js';
import { verifyAdminToken } from './middleware/auth.js';
import { setIO } from './realtime.js';
import adminRoutes from './routes/admin.js';
import authRoutes from './routes/auth.js';
import chatRoutes, { isValidSessionId } from './routes/chat.js';
import webhookRoutes from './routes/webhook.js';

const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { 'img-src': ["'self'", 'data:', 'https:'] } },
    }),
  );
  app.use(cors({ origin: config.clientOrigin }));
  // Giữ raw body để xác thực chữ ký webhook Meta
  app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, db: mongoose.connection.readyState === 1 }));
  app.use('/api/auth', authRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/webhook/meta', webhookRoutes);

  // Production: phục vụ luôn bản build React
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/^\/(?!api|webhook|socket\.io).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  app.use((err, _req, res, _next) => {
    if (err instanceof mongoose.Error.ValidationError || err instanceof mongoose.Error.CastError) {
      return res.status(400).json({ error: err.message });
    }
    if (err.code === 11000) return res.status(409).json({ error: 'Dữ liệu bị trùng (vd: SKU đã tồn tại)' });
    console.error(err);
    return res.status(500).json({ error: 'Lỗi máy chủ' });
  });

  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: config.clientOrigin } });
  io.on('connection', (socket) => {
    if (verifyAdminToken(socket.handshake.auth?.token)) socket.join('admin');
    socket.on('web:join', (sessionId) => {
      if (isValidSessionId(sessionId)) socket.join(`web:${sessionId}`);
    });
  });
  setIO(io);

  return { app, server, io };
}
