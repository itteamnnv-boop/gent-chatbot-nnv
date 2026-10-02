import { markPageInvalid, resolvePageToken } from '../services/metaPageService.js';
import { sendMessengerText, sendMessengerTyping, sendWhatsAppText } from './meta.js';

// Gửi tin nhắn ra kênh tương ứng. Web nhận qua Socket.IO nên không cần gửi ở đây.
export async function deliver(channel, externalId, text, { pageId } = {}) {
  switch (channel) {
    case 'messenger':
    case 'instagram': {
      // Instagram chỉ dùng token .env (chưa hỗ trợ kết nối qua OAuth)
      const r = await resolvePageToken(channel === 'messenger' ? pageId : undefined);
      try {
        return await sendMessengerText(externalId, text, r?.token);
      } catch (err) {
        // Token của Page hết hạn / bị thu hồi: đánh dấu để admin kết nối lại
        if (channel === 'messenger' && err.graphCode === 190 && r?.source === 'page') await markPageInvalid(pageId, err.message);
        throw err;
      }
    }
    case 'whatsapp':
      return sendWhatsAppText(externalId, text);
    default:
      return undefined;
  }
}

export async function showTyping(channel, externalId, { pageId } = {}) {
  if (channel !== 'messenger') return;
  const r = await resolvePageToken(pageId);
  await sendMessengerTyping(externalId, r?.token);
}
