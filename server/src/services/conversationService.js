import { config } from '../config.js';
import { getOpenAIClient, runAgent } from '../agent/agent.js';
import { deliver, showTyping } from '../channels/index.js';
import { Conversation } from '../models/Conversation.js';
import { Customer } from '../models/Customer.js';
import { Message } from '../models/Message.js';
import { Settings } from '../models/Settings.js';
import { emitAdmin, emitCustomer } from '../realtime.js';
import { normalize } from '../utils/text.js';

const BUSY_REPLY = 'Dạ hệ thống đang bận một chút, nhân viên sẽ phản hồi anh/chị ngay ạ.';

// Xử lý tuần tự từng hội thoại để không chạy 2 lượt agent song song trên cùng giỏ hàng
const locks = new Map();
async function withLock(key, fn) {
  const prev = locks.get(key) ?? Promise.resolve();
  let release;
  const current = new Promise((r) => {
    release = r;
  });
  const tail = prev.then(() => current);
  locks.set(key, tail);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === tail) locks.delete(key);
  }
}

export async function conversationView(conversationId) {
  return Conversation.findById(conversationId).populate('customer', 'name phone address channel').lean();
}

async function broadcastConversation(conversationId) {
  emitAdmin('conversation:update', await conversationView(conversationId));
}

async function saveMessage(conversation, { role, text, externalId, toolCalls }) {
  const message = await Message.create({ conversation: conversation._id, role, text, externalId, toolCalls });
  await Conversation.updateOne(
    { _id: conversation._id },
    {
      $set: { lastMessageAt: message.createdAt, lastMessagePreview: text.slice(0, 120) },
      ...(role === 'customer' ? { $inc: { unreadCount: 1 } } : {}),
    },
  );
  const payload = message.toObject();
  emitAdmin('message:new', { conversationId: String(conversation._id), message: payload });
  if (role !== 'system') emitCustomer(conversation.channel, conversation.externalId, 'message:new', payload);
  return payload;
}

async function sendOutbound(conversation, role, text, toolCalls) {
  const message = await saveMessage(conversation, { role, text, toolCalls });
  try {
    await deliver(conversation.channel, conversation.externalId, text);
  } catch (err) {
    console.error(`[deliver:${conversation.channel}]`, err.message);
    await Conversation.updateOne({ _id: conversation._id }, { needsAttention: true });
  }
  return message;
}

async function loadHistory(conversationId) {
  const rows = await Message.find({ conversation: conversationId, role: { $ne: 'system' } })
    .sort({ createdAt: -1 })
    .limit(config.agent.historyLimit)
    .lean();
  return rows.reverse().map((m) => ({
    role: m.role === 'customer' ? 'user' : 'assistant',
    content: m.role === 'agent' ? `[Nhân viên trả lời] ${m.text}` : m.text,
  }));
}

function matchesHandoffKeyword(text, settings) {
  const t = normalize(text);
  return settings.handoffKeywords.some((k) => k && t.includes(normalize(k)));
}

async function switchMode(conversation, mode, reason, by) {
  conversation.mode = mode;
  if (mode === 'human') {
    conversation.stage = 'handoff';
    conversation.handoffReason = reason;
  } else {
    conversation.handoffReason = '';
    conversation.needsAttention = false;
    if (conversation.stage === 'handoff') conversation.stage = conversation.cart.length ? 'cart' : 'consulting';
  }
  await conversation.save();
  await saveMessage(conversation, {
    role: 'system',
    text: mode === 'human' ? `Chuyển cho nhân viên (${by}): ${reason}` : `Bot tiếp tục hỗ trợ (${by})`,
  });
}

/**
 * Điểm vào duy nhất cho mọi tin nhắn của khách, từ mọi kênh.
 * @param {{channel:string, externalId:string, text:string, externalMessageId?:string, profileName?:string, client?:object}} input
 */
export async function handleIncomingMessage({ channel, externalId, text, externalMessageId, profileName, client }) {
  return withLock(`${channel}:${externalId}`, async () => {
    if (externalMessageId && (await Message.exists({ externalId: externalMessageId }))) {
      return { duplicate: true, customerMessage: null, replies: [] };
    }

    const customer = await Customer.findOneAndUpdate(
      { channel, externalId },
      { $setOnInsert: { channel, externalId, name: profileName || '' } },
      { upsert: true, returnDocument: 'after' },
    );
    const conversation = await Conversation.findOneAndUpdate(
      { channel, externalId },
      { $setOnInsert: { customer: customer._id, channel, externalId } },
      { upsert: true, returnDocument: 'after' },
    );
    const settings = await Settings.get();

    const customerMessage = await saveMessage(conversation, { role: 'customer', text, externalId: externalMessageId });
    const replies = [];

    // Nhân viên đang giữ hội thoại hoặc bot bị tắt: chỉ lưu và báo dashboard
    if (!settings.botEnabled || conversation.mode === 'human') {
      await broadcastConversation(conversation._id);
      return { customerMessage, replies };
    }

    if (matchesHandoffKeyword(text, settings)) {
      await switchMode(conversation, 'human', 'Khách yêu cầu gặp nhân viên', 'tự động');
      replies.push(await sendOutbound(conversation, 'bot', settings.handoffMessage));
      await broadcastConversation(conversation._id);
      return { customerMessage, replies };
    }

    await showTyping(channel, externalId);
    try {
      const result = await runAgent({
        conversation,
        customer,
        settings,
        history: await loadHistory(conversation._id),
        client: client ?? getOpenAIClient(),
      });
      for (const ev of result.events) {
        if (ev.type === 'order_created') emitAdmin('order:new', ev.order.toObject());
        if (ev.type === 'handoff') await saveMessage(conversation, { role: 'system', text: `Bot chuyển cho nhân viên: ${ev.reason}` });
      }
      replies.push(await sendOutbound(conversation, 'bot', result.text, result.toolLog.length ? result.toolLog : undefined));
    } catch (err) {
      console.error('[agent]', err);
      await Conversation.updateOne({ _id: conversation._id }, { needsAttention: true });
      replies.push(await sendOutbound(conversation, 'bot', BUSY_REPLY));
    }

    await broadcastConversation(conversation._id);
    return { customerMessage, replies };
  });
}

// ---- Thao tác của nhân viên từ dashboard ----

export async function sendAgentMessage(conversationId, text, agentName) {
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) return null;
  // Nhân viên trả lời = tiếp quản hội thoại (giống thread control của Meta)
  if (conversation.mode === 'bot') await switchMode(conversation, 'human', 'Nhân viên trả lời trực tiếp', agentName);
  const message = await sendOutbound(conversation, 'agent', text);
  await Conversation.updateOne({ _id: conversation._id }, { unreadCount: 0 });
  await broadcastConversation(conversation._id);
  return message;
}

export async function setConversationMode(conversationId, mode, agentName) {
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) return null;
  if (conversation.mode !== mode) {
    await switchMode(conversation, mode, mode === 'human' ? 'Nhân viên tiếp quản' : '', agentName);
  }
  await broadcastConversation(conversation._id);
  return conversationView(conversation._id);
}
