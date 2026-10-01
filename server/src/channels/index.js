import { sendMessengerText, sendMessengerTyping, sendWhatsAppText } from './meta.js';

// Gửi tin nhắn ra kênh tương ứng. Web nhận qua Socket.IO nên không cần gửi ở đây.
export async function deliver(channel, externalId, text) {
  switch (channel) {
    case 'messenger':
    case 'instagram':
      return sendMessengerText(externalId, text);
    case 'whatsapp':
      return sendWhatsAppText(externalId, text);
    default:
      return undefined;
  }
}

export async function showTyping(channel, externalId) {
  if (channel === 'messenger') await sendMessengerTyping(externalId);
}
