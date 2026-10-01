import crypto from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { signAdminToken } from '../middleware/auth.js';

const router = Router();

// So sánh hằng thời gian (băm trước để độ dài luôn bằng nhau)
const safeEqual = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};

router.post('/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20 }), (req, res) => {
  const { username = '', password = '' } = req.body || {};
  const userOk = safeEqual(username, config.admin.username);
  const passOk = safeEqual(password, config.admin.password);
  if (!userOk || !passOk) return res.status(401).json({ error: 'Sai tên đăng nhập hoặc mật khẩu' });
  return res.json({ token: signAdminToken(username), username });
});

export default router;
