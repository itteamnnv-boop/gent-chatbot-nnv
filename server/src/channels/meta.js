import crypto from 'node:crypto';
import { config } from '../config.js';
import { chunkText } from '../utils/text.js';

const graphUrl = (path) => `https://graph.facebook.com/${config.meta.graphVersion}/${path}`;

async function postGraph(path, token, body) {
  const res = await fetch(graphUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const raw = await res.text();
    const err = new Error(`Graph API ${res.status}: ${raw}`);
    try {
      err.graphCode = JSON.parse(raw)?.error?.code;
    } catch {
      // body không phải JSON
    }
    throw err;
  }
  return res.json();
}

// Messenger & Instagram dùng chung Send API của Page; token của Page được truyền vào
export async function sendMessengerText(recipientId, text, token) {
  if (!token) throw new Error('Chưa có Page Access Token cho Page này');
  for (const part of chunkText(text, 1900)) {
    await postGraph('me/messages', token, {
      recipient: { id: recipientId },
      messaging_type: 'RESPONSE',
      message: { text: part },
    });
  }
}

export async function sendMessengerTyping(recipientId, token) {
  if (!token) return;
  await postGraph('me/messages', token, { recipient: { id: recipientId }, sender_action: 'typing_on' }).catch(() => {});
}

export async function sendWhatsAppText(to, text) {
  const { waPhoneNumberId, waAccessToken } = config.meta;
  if (!waPhoneNumberId || !waAccessToken) throw new Error('WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN chưa được cấu hình');
  for (const part of chunkText(text, 4000)) {
    await postGraph(`${waPhoneNumberId}/messages`, waAccessToken, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: part, preview_url: false },
    });
  }
}

// Xác thực header X-Hub-Signature-256 = "sha256=" + HMAC_SHA256(appSecret, rawBody)
export function verifyMetaSignature(rawBody, header, secret) {
  if (!rawBody || !header?.startsWith('sha256=')) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// entry.id của webhook Page/Instagram chính là ID của Page nhận tin
const pageIdOf = (entry) => (typeof entry.id === 'string' ? { pageId: entry.id } : {});

/**
 * Chuẩn hoá payload webhook Meta (Messenger / Instagram / WhatsApp) thành danh sách tin nhắn vào.
 * @returns {Array<{channel, externalId, text, externalMessageId, profileName?, pageId?}>}
 */
export function parseMetaWebhook(body) {
  const out = [];
  if (!body || !Array.isArray(body.entry)) return out;

  if (body.object === 'page' || body.object === 'instagram') {
    const channel = body.object === 'page' ? 'messenger' : 'instagram';
    for (const entry of body.entry) {
      for (const ev of entry.messaging || []) {
        const senderId = ev.sender?.id;
        if (!senderId) continue;
        if (ev.message) {
          if (ev.message.is_echo) continue; // tin do chính Page gửi
          const text = ev.message.text || ev.message.quick_reply?.payload || (ev.message.attachments?.length ? '[Khách gửi tệp đính kèm]' : '');
          if (text) out.push({ channel, externalId: senderId, text, externalMessageId: ev.message.mid, ...pageIdOf(entry) });
        } else if (ev.postback) {
          out.push({ channel, externalId: senderId, text: ev.postback.title || ev.postback.payload, externalMessageId: ev.postback.mid, ...pageIdOf(entry) });
        }
      }
    }
  } else if (body.object === 'whatsapp_business_account') {
    for (const entry of body.entry) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        const names = Object.fromEntries((value.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
        for (const m of value.messages || []) {
          const text =
            m.text?.body ||
            m.button?.text ||
            m.interactive?.button_reply?.title ||
            m.interactive?.list_reply?.title ||
            (m.type !== 'text' ? '[Khách gửi tệp đính kèm]' : '');
          if (text) out.push({ channel: 'whatsapp', externalId: m.from, text, externalMessageId: m.id, profileName: names[m.from] });
        }
      }
    }
  }
  return out;
}
