import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { config } from '../config.js';
import { User } from '../models/User.js';
import { hasPermission } from '../permissions.js';

export function signUserToken(user) {
  return jwt.sign({ sub: user.username, uid: String(user._id), tv: user.tokenVersion }, config.jwtSecret, { expiresIn: '12h' });
}

export async function authenticateToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return null;
  }
  if (!mongoose.isValidObjectId(payload.uid)) return null;
  const user = await User.findById(payload.uid).lean();
  if (!user || !user.active || user.tokenVersion !== payload.tv) return null;
  return user;
}

export async function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user = await authenticateToken(token);
  if (!user) return res.status(401).json({ error: 'Chưa đăng nhập hoặc phiên đã hết hạn' });
  req.user = user;
  return next();
}

export function requirePermission(key) {
  return (req, res, next) =>
    hasPermission(req.user, key) ? next() : res.status(403).json({ error: 'Bạn không có quyền thực hiện chức năng này' });
}
