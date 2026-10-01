import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { Conversation } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { Settings } from '../models/Settings.js';
import { handleIncomingMessage } from '../services/conversationService.js';

// API công khai cho widget chat trên website
const router = Router();
router.use(rateLimit({ windowMs: 60 * 1000, limit: 40 }));

export const isValidSessionId = (id) => typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id);

router.get('/config', async (_req, res) => {
  const s = await Settings.get();
  res.json({ botName: s.botName, businessName: s.businessName, greeting: s.greeting });
});

router.get('/history', async (req, res) => {
  const { sessionId } = req.query;
  if (!isValidSessionId(sessionId)) return res.status(400).json({ error: 'sessionId không hợp lệ' });
  const conv = await Conversation.findOne({ channel: 'web', externalId: sessionId }).lean();
  if (!conv) return res.json({ messages: [] });
  const messages = await Message.find({ conversation: conv._id, role: { $ne: 'system' } })
    .select('role text createdAt')
    .sort({ createdAt: 1 })
    .limit(200)
    .lean();
  return res.json({ messages });
});

router.post('/message', async (req, res) => {
  const { sessionId, text } = req.body || {};
  if (!isValidSessionId(sessionId)) return res.status(400).json({ error: 'sessionId không hợp lệ' });
  const clean = typeof text === 'string' ? text.trim() : '';
  if (!clean || clean.length > 2000) return res.status(400).json({ error: 'Tin nhắn trống hoặc quá dài' });

  const { customerMessage, replies } = await handleIncomingMessage({ channel: 'web', externalId: sessionId, text: clean });
  const strip = ({ _id, role, text: t, createdAt }) => ({ _id, role, text: t, createdAt });
  return res.json({ messages: [customerMessage, ...replies].filter(Boolean).map(strip) });
});

export default router;
