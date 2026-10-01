import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export function signAdminToken(username) {
  return jwt.sign({ sub: username, role: 'admin' }, config.jwtSecret, { expiresIn: '12h' });
}

export function verifyAdminToken(token) {
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    return payload.role === 'admin' ? payload : null;
  } catch {
    return null;
  }
}

export function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const admin = verifyAdminToken(token);
  if (!admin) return res.status(401).json({ error: 'Chưa đăng nhập hoặc phiên đã hết hạn' });
  req.admin = admin;
  return next();
}
