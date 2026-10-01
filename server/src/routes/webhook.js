import { Router } from 'express';
import { config } from '../config.js';
import { parseMetaWebhook, verifyMetaSignature } from '../channels/meta.js';
import { handleIncomingMessage } from '../services/conversationService.js';

// Webhook chung cho Messenger, Instagram và WhatsApp Cloud API
const router = Router();

// Bước xác minh khi đăng ký webhook trong Meta App Dashboard
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  if (mode === 'subscribe' && config.meta.verifyToken && token === config.meta.verifyToken) {
    return res.status(200).send(String(req.query['hub.challenge'] ?? ''));
  }
  return res.sendStatus(403);
});

router.post('/', (req, res) => {
  if (config.meta.appSecret) {
    if (!verifyMetaSignature(req.rawBody, req.get('x-hub-signature-256'), config.meta.appSecret)) {
      return res.sendStatus(401);
    }
  } else if (config.env === 'production') {
    console.error('[webhook] META_APP_SECRET chưa cấu hình — từ chối webhook');
    return res.sendStatus(500);
  }

  // Meta yêu cầu phản hồi 200 nhanh; xử lý AI chạy nền
  res.sendStatus(200);
  const incoming = parseMetaWebhook(req.body);
  for (const msg of incoming) {
    handleIncomingMessage(msg).catch((err) => console.error('[webhook] xử lý tin nhắn lỗi', err));
  }
  return undefined;
});

export default router;
