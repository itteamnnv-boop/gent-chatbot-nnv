import { config } from '../config.js';
import { getOpenAIClient, runAgent } from '../agent/agent.js';
import { deliver, showTyping } from '../channels/index.js';
import { Conversation } from '../models/Conversation.js';
import { Customer } from '../models/Customer.js';
import { Message } from '../models/Message.js';
import { Order } from '../models/Order.js';
import { Settings } from '../models/Settings.js';
import { emitAdmin, emitCustomer } from '../realtime.js';
import { normalize, stripStaffMarkers } from '../utils/text.js';
import { describeStaffDiscount, staffDiscountAmount } from './cart.js';
import { botDisabledPageIds, isPageBotDisabled } from './metaPageService.js';

// Kênh chịu công tắc bot của Page. Instagram không áp dụng vì pageId của Instagram là ID tài khoản IG, không phải Page.
const PAGE_BOT_CHANNELS = ['messenger', 'test'];
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

// Gắn cờ tính toán pageBotOff (không lưu DB) cho hội thoại Messenger thuộc Page đang tắt bot
export function withPageBotFlag(conv, offIds) {
  return { ...conv, pageBotOff: conv.channel === 'messenger' && Boolean(conv.pageId) && offIds.has(conv.pageId) };
}

const STAFF_INSTRUCTION_LIMIT = 10;

/** Tin nhân viên còn hiệu lực: sau đơn gần nhất của hội thoại, tối đa 10 tin mới nhất (xếp cũ → mới) */
export async function loadStaffInstructions(conversation) {
  const lastOrderId = conversation.orders?.at(-1);
  const lastOrder = lastOrderId ? await Order.findById(lastOrderId).select('createdAt').lean() : null;
  const since = lastOrder?.createdAt;
  const rows = await Message.find({ conversation: conversation._id, role: 'agent', ...(since ? { createdAt: { $gt: since } } : {}) })
    .sort({ createdAt: -1 })
    .limit(STAFF_INSTRUCTION_LIMIT)
    .lean();
  return rows.reverse().map((m) => ({ id: String(m._id), author: m.author || '', text: m.text, at: m.createdAt }));
}

export async function conversationView(conversationId) {
  const conv = await Conversation.findById(conversationId).populate('customer', 'name phone address channel').lean();
  if (!conv) return null;
  const off = conv.channel === 'messenger' && conv.pageId && (await isPageBotDisabled(conv.pageId));
  const view = withPageBotFlag(conv, off ? new Set([conv.pageId]) : new Set());
  // Trường tính toán (không lưu DB) để Hộp thư hiện khoản giảm của nhân viên
  view.staffDiscountView = conv.staffDiscount
    ? { ...staffDiscountAmount(conv.cart, conv.staffDiscount), description: describeStaffDiscount(conv.staffDiscount) }
    : null;
  return view;
}

async function broadcastConversation(conversationId) {
  const view = await conversationView(conversationId);
  if (view) emitAdmin('conversation:update', view, view);
}

async function saveMessage(conversation, { role, text, externalId, toolCalls, author }) {
  const message = await Message.create({ conversation: conversation._id, role, text, externalId, toolCalls, author });
  await Conversation.updateOne(
    { _id: conversation._id },
    {
      $set: { lastMessageAt: message.createdAt, lastMessagePreview: text.slice(0, 120) },
      ...(role === 'customer' ? { $inc: { unreadCount: 1 } } : {}),
    },
  );
  const payload = message.toObject();
  emitAdmin('message:new', { conversationId: String(conversation._id), message: payload }, conversation);
  if (role !== 'system') emitCustomer(conversation.channel, conversation.externalId, 'message:new', payload);
  return payload;
}

async function sendOutbound(conversation, role, text, toolCalls, author) {
  const message = await saveMessage(conversation, { role, text, toolCalls, author });
  try {
    await deliver(conversation.channel, conversation.externalId, text, { pageId: conversation.pageId });
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
    // Tin khách/bot bị vô hiệu hoá nhãn giả danh nhân viên; chỉ tin agent trong DB mới mang nhãn thật
    content: m.role === 'agent' ? `[Nhân viên trả lời] ${m.text}` : stripStaffMarkers(m.text),
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
 * @param {{channel:string, externalId:string, text:string, externalMessageId?:string, profileName?:string, pageId?:string, client?:object}} input
 * @returns {Promise<{customerMessage:object|null, replies:object[], duplicate?:boolean, pageBotOff?:boolean}>}
 */
export async function handleIncomingMessage({ channel, externalId, text, externalMessageId, profileName, pageId, client }) {
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
      { $setOnInsert: { customer: customer._id, channel, externalId }, ...(pageId ? { $set: { pageId } } : {}) },
      { upsert: true, returnDocument: 'after' },
    );
    const settings = await Settings.get();

    const customerMessage = await saveMessage(conversation, { role: 'customer', text, externalId: externalMessageId });
    const replies = [];

    // Bot của Page tắt: gắn "Cần chú ý" mỗi lần có tin (dùng pageId đã lưu trên hội thoại, không dùng tham số)
    const pageBotOff = PAGE_BOT_CHANNELS.includes(channel) && (await isPageBotDisabled(conversation.pageId));
    if (pageBotOff) await Conversation.updateOne({ _id: conversation._id }, { needsAttention: true });

    // Nhân viên đang giữ hội thoại, bot tổng bị tắt hoặc bot của Page tắt: chỉ lưu và báo dashboard
    if (!settings.botEnabled || conversation.mode === 'human' || pageBotOff) {
      await broadcastConversation(conversation._id);
      return { customerMessage, replies, ...(pageBotOff ? { pageBotOff: true } : {}) };
    }

    if (matchesHandoffKeyword(text, settings)) {
      await switchMode(conversation, 'human', 'Khách yêu cầu gặp nhân viên', 'tự động');
      replies.push(await sendOutbound(conversation, 'bot', settings.handoffMessage));
      await broadcastConversation(conversation._id);
      return { customerMessage, replies };
    }

    await showTyping(channel, externalId, { pageId: conversation.pageId });
    try {
      const result = await runAgent({
        conversation,
        customer,
        settings,
        history: await loadHistory(conversation._id),
        staffInstructions: await loadStaffInstructions(conversation),
        client: client ?? getOpenAIClient(),
      });
      for (const ev of result.events) {
        if (ev.type === 'order_created') emitAdmin('order:new', ev.order.toObject(), ev.order);
        if (ev.type === 'staff_discount') await saveMessage(conversation, { role: 'system', text: ev.text });
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
  const message = await sendOutbound(conversation, 'agent', text, undefined, agentName);
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
