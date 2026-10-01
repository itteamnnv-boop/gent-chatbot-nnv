import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, signUserToken } from '../middleware/auth.js';
import { User } from '../models/User.js';
import { publicUser } from '../services/userService.js';
import { hashPassword, verifyPassword } from '../utils/password.js';

const router = Router();

// Băm giả để thời gian phản hồi không lộ tên đăng nhập có tồn tại hay không
const DUMMY_HASH = await hashPassword('dummy-password-for-timing');

router.post('/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20 }), async (req, res) => {
  const { username = '', password = '' } = req.body || {};
  const user = await User.findOne({ username: String(username).trim().toLowerCase() }).select('+passwordHash');
  const passOk = await verifyPassword(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !passOk) return res.status(401).json({ error: 'Sai tên đăng nhập hoặc mật khẩu' });
  if (!user.active) return res.status(403).json({ error: 'Tài khoản đã bị khoá' });
  return res.json({ token: signUserToken(user), username: user.username, user: publicUser(user) });
});

router.get('/me', requireAuth, (req, res) => res.json(publicUser(req.user)));

export default router;
