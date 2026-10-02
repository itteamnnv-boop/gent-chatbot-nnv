import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { handleOAuthCallback } from '../services/metaPageService.js';

// Facebook chuyển hướng trình duyệt về đây sau khi đăng nhập; không có JWT, xác thực bằng state
const router = Router();

const str = (v) => (typeof v === 'string' ? v : undefined);

router.get('/oauth/callback', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30 }), async (req, res) => {
  const result = await handleOAuthCallback({ code: str(req.query.code), state: str(req.query.state), error: str(req.query.error) });
  if (result.sessionId) return res.redirect(302, `/admin/channels?session=${encodeURIComponent(result.sessionId)}`);
  return res.redirect(302, `/admin/channels?error=${result.error}`);
});

export default router;
