import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAdmin } from '../middleware/auth.js';
import { Conversation, STAGES } from '../models/Conversation.js';
import { Knowledge } from '../models/Knowledge.js';
import { Message } from '../models/Message.js';
import { Order, ORDER_STATUSES } from '../models/Order.js';
import { Product } from '../models/Product.js';
import { Settings } from '../models/Settings.js';
import { emitAdmin } from '../realtime.js';
import { Customer } from '../models/Customer.js';
import { conversationView, handleIncomingMessage, sendAgentMessage, setConversationMode } from '../services/conversationService.js';
import { chunkDocument, importPriceList } from '../services/infoImport.js';
import { escapeRegex } from '../utils/text.js';

const router = Router();
router.use(requireAdmin);

const pick = (obj = {}, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
const notFound = (res) => res.status(404).json({ error: 'Không tìm thấy' });
const validId = (req, res, next) => (mongoose.isValidObjectId(req.params.id) ? next() : notFound(res));

// ---------- Tổng quan ----------
router.get('/stats', async (_req, res) => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const weekAgo = new Date(startOfToday.getTime() - 6 * 86400000);

  const real = { channel: { $ne: 'test' } }; // bỏ hội thoại "Chat thử" khỏi số liệu
  const recent = { ...real, lastMessageAt: { $gte: weekAgo } };

  const [totalConversations, humanMode, needsAttention, convToday, withOrders, ordersByStatus, daily, byChannel, recentIds, newOrders, ordersWeek] =
    await Promise.all([
      Conversation.countDocuments(real),
      Conversation.countDocuments({ ...real, mode: 'human' }),
      Conversation.countDocuments({ ...real, needsAttention: true }),
      Conversation.countDocuments({ ...real, lastMessageAt: { $gte: startOfToday } }),
      Conversation.countDocuments({ ...real, 'orders.0': { $exists: true } }),
      Order.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Order.aggregate([
        { $match: { createdAt: { $gte: weekAgo }, status: { $ne: 'cancelled' } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Ho_Chi_Minh' } }, orders: { $sum: 1 }, revenue: { $sum: '$total' } } },
        { $sort: { _id: 1 } },
      ]),
      Conversation.aggregate([{ $match: real }, { $group: { _id: '$channel', count: { $sum: 1 } } }]),
      Conversation.find(recent).select('_id stage').lean(),
      Order.countDocuments({ status: 'new' }),
      Order.countDocuments({ createdAt: { $gte: weekAgo } }),
    ]);

  // Hiệu quả AI 7 ngày: số hội thoại, số khách có ý định mua, tỉ lệ AI tự xử lý (không phải chuyển nhân viên)
  const handedOff = await Message.distinct('conversation', {
    conversation: { $in: recentIds.map((c) => c._id) },
    role: 'system',
    text: /chuyển cho nhân viên/i,
  });
  const agent = {
    windowDays: 7,
    conversations: recentIds.length,
    purchaseIntent: recentIds.filter((c) => ['cart', 'checkout', 'ordered'].includes(c.stage)).length,
    autoResolveRate: recentIds.length ? 1 - handedOff.length / recentIds.length : null,
  };

  const todayKey = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
  const today = daily.find((d) => d._id === todayKey) || { orders: 0, revenue: 0 };
  res.json({
    agent,
    newOrders,
    ordersWeek,
    totalConversations,
    humanMode,
    needsAttention,
    conversationsToday: convToday,
    ordersToday: today.orders,
    revenueToday: today.revenue,
    conversionRate: totalConversations ? withOrders / totalConversations : 0,
    ordersByStatus: Object.fromEntries(ordersByStatus.map((o) => [o._id, o.count])),
    byChannel: Object.fromEntries(byChannel.map((c) => [c._id, c.count])),
    daily,
  });
});

// ---------- Hộp thư ----------
router.get('/conversations', async (req, res) => {
  const filter = { channel: { $ne: 'test' } };
  if (['bot', 'human'].includes(req.query.mode)) filter.mode = req.query.mode;
  if (STAGES.includes(req.query.stage)) filter.stage = req.query.stage;
  if (req.query.attention === '1') filter.needsAttention = true;
  const list = await Conversation.find(filter).sort({ lastMessageAt: -1 }).limit(200).populate('customer', 'name phone channel').lean();
  res.json(list);
});

router.get('/conversations/:id', validId, async (req, res) => {
  const conversation = await conversationView(req.params.id);
  if (!conversation) return notFound(res);
  const messages = await Message.find({ conversation: conversation._id }).sort({ createdAt: -1 }).limit(300).lean();
  const orders = await Order.find({ conversation: conversation._id }).sort({ createdAt: -1 }).lean();
  return res.json({ conversation, messages: messages.reverse(), orders });
});

router.post('/conversations/:id/messages', validId, async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) return res.status(400).json({ error: 'Tin nhắn trống' });
  const message = await sendAgentMessage(req.params.id, text, req.admin.sub);
  return message ? res.json(message) : notFound(res);
});

router.post('/conversations/:id/mode', validId, async (req, res) => {
  const { mode } = req.body || {};
  if (!['bot', 'human'].includes(mode)) return res.status(400).json({ error: 'mode phải là bot hoặc human' });
  const conv = await setConversationMode(req.params.id, mode, req.admin.sub);
  return conv ? res.json(conv) : notFound(res);
});

router.post('/conversations/:id/read', validId, async (req, res) => {
  await Conversation.updateOne({ _id: req.params.id }, { unreadCount: 0, needsAttention: false });
  res.json({ ok: true });
});

// ---------- Chat thử (playground) ----------
// Chủ shop chat với AI như khách hàng. Kênh "test": không hiện trong hộp thư/thống kê, không tạo đơn thật.
const validTestSession = (id) => typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id);

router.post('/playground/message', async (req, res) => {
  const { sessionId, text } = req.body || {};
  const clean = typeof text === 'string' ? text.trim() : '';
  if (!validTestSession(sessionId) || !clean || clean.length > 2000) return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });
  const { replies } = await handleIncomingMessage({ channel: 'test', externalId: sessionId, text: clean });
  const conv = await Conversation.findOne({ channel: 'test', externalId: sessionId }).select('mode').lean();
  res.json({
    replies: replies.map(({ _id, role, text: t, createdAt, toolCalls }) => ({ _id, role, text: t, createdAt, toolCalls })),
    handedOff: conv?.mode === 'human',
  });
});

router.delete('/playground/:sessionId', async (req, res) => {
  if (!validTestSession(req.params.sessionId)) return res.status(400).json({ error: 'sessionId không hợp lệ' });
  const conv = await Conversation.findOne({ channel: 'test', externalId: req.params.sessionId });
  if (conv) {
    await Message.deleteMany({ conversation: conv._id });
    await Customer.deleteOne({ _id: conv.customer });
    await conv.deleteOne();
  }
  res.json({ ok: true });
});

// ---------- Đơn hàng ----------
router.get('/orders', async (req, res) => {
  const filter = {};
  if (ORDER_STATUSES.includes(req.query.status)) filter.status = req.query.status;
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(String(req.query.q).trim()), 'i');
    filter.$or = [{ code: rx }, { 'shipping.name': rx }, { 'shipping.phone': rx }];
  }
  res.json(await Order.find(filter).sort({ createdAt: -1 }).limit(300).lean());
});

router.patch('/orders/:id', validId, async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return notFound(res);
  const { status, note } = req.body || {};
  if (status !== undefined && status !== order.status) {
    if (!ORDER_STATUSES.includes(status)) return res.status(400).json({ error: 'Trạng thái không hợp lệ' });
    if (order.status === 'cancelled') return res.status(400).json({ error: 'Đơn đã huỷ không thể đổi trạng thái' });
    if (status === 'cancelled') {
      // Hoàn lại tồn kho đã trừ khi tạo đơn
      await Promise.all(order.items.map((i) => Product.updateOne({ _id: i.product }, { $inc: { stock: i.quantity } })));
    }
    order.status = status;
    order.statusHistory.push({ status, by: req.admin.sub });
  }
  if (typeof note === 'string') order.note = note;
  await order.save();
  emitAdmin('order:update', order.toObject());
  return res.json(order);
});

// ---------- Sản phẩm ----------
const PRODUCT_FIELDS = ['sku', 'name', 'category', 'description', 'usage', 'price', 'salePrice', 'unit', 'stock', 'images', 'tags', 'active'];

router.get('/products', async (req, res) => {
  const filter = {};
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(String(req.query.q).trim()), 'i');
    filter.$or = [{ name: rx }, { sku: rx }, { category: rx }];
  }
  // không dùng lean() để toJSON có virtual effectivePrice
  res.json(await Product.find(filter).sort({ category: 1, name: 1 }));
});

router.post('/products', async (req, res) => {
  const product = await Product.create(pick(req.body, PRODUCT_FIELDS));
  res.status(201).json(product);
});

router.put('/products/:id', validId, async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) return notFound(res);
  product.set(pick(req.body, PRODUCT_FIELDS));
  await product.save();
  return res.json(product);
});

router.delete('/products/:id', validId, async (req, res) => {
  const r = await Product.deleteOne({ _id: req.params.id });
  return r.deletedCount ? res.json({ ok: true }) : notFound(res);
});

// Nhập bảng giá: upsert theo SKU (client đã parse CSV thành rows)
router.post('/products/import', async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  if (!rows || rows.length === 0) return res.status(400).json({ error: 'Không có dòng dữ liệu nào' });
  if (rows.length > 2000) return res.status(400).json({ error: 'Tối đa 2000 dòng mỗi lần nhập' });
  const result = await importPriceList(rows);
  const settings = await Settings.get();
  settings.set('sectionUpdatedAt.priceList', new Date());
  await settings.save();
  return res.json(result);
});

// ---------- Nguồn: tài liệu tải lên ----------
router.get('/sources', async (_req, res) => {
  const files = await Knowledge.aggregate([
    { $match: { source: /^file:/ } },
    { $group: { _id: '$source', chunks: { $sum: 1 }, updatedAt: { $max: '$updatedAt' } } },
    { $sort: { updatedAt: -1 } },
  ]);
  res.json(files.map((f) => ({ name: f._id.slice(5), chunks: f.chunks, updatedAt: f.updatedAt })));
});

router.post('/sources', async (req, res) => {
  const { fileName, text } = req.body || {};
  const name = typeof fileName === 'string' ? fileName.trim().slice(0, 120) : '';
  if (!name || typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'Thiếu tên tệp hoặc nội dung' });
  if (text.length > 500_000) return res.status(400).json({ error: 'Tài liệu quá lớn (tối đa ~500.000 ký tự)' });
  const source = `file:${name}`;
  await Knowledge.deleteMany({ source }); // tải lại cùng tên = thay thế
  const chunks = chunkDocument(name, text);
  await Knowledge.create(chunks.map((c) => ({ ...c, source })));
  return res.status(201).json({ name, chunks: chunks.length });
});

router.delete('/sources/:name', async (req, res) => {
  const r = await Knowledge.deleteMany({ source: `file:${req.params.name}` });
  return r.deletedCount ? res.json({ ok: true }) : notFound(res);
});

// ---------- Kho kiến thức ----------
const KNOWLEDGE_FIELDS = ['title', 'content', 'tags', 'active'];

router.get('/knowledge', async (req, res) => {
  // mặc định chỉ trả mục nhập tay; ?all=1 để lấy cả đoạn trích từ tài liệu
  const filter = req.query.all === '1' ? {} : { source: { $not: /^file:/ } };
  res.json(await Knowledge.find(filter).sort({ updatedAt: -1 }).lean());
});

router.post('/knowledge', async (req, res) => {
  res.status(201).json(await Knowledge.create(pick(req.body, KNOWLEDGE_FIELDS)));
});

router.put('/knowledge/:id', validId, async (req, res) => {
  const doc = await Knowledge.findById(req.params.id);
  if (!doc) return notFound(res);
  doc.set(pick(req.body, KNOWLEDGE_FIELDS));
  await doc.save();
  return res.json(doc);
});

router.delete('/knowledge/:id', validId, async (req, res) => {
  const r = await Knowledge.deleteOne({ _id: req.params.id });
  return r.deletedCount ? res.json({ ok: true }) : notFound(res);
});

// ---------- Cấu hình agent ----------
const SETTINGS_FIELDS = [
  'botEnabled', 'botName', 'businessName', 'tone', 'greeting', 'businessInfo', 'hotline', 'address', 'openingHours',
  'policies', 'paymentInfo', 'customInstructions', 'shippingFee', 'freeShippingThreshold',
  'handoffKeywords', 'handoffRules', 'handoffMessage', 'model', 'temperature',
];
// Trường nào thuộc mục nào trên trang "Thông tin của bạn" (để ghi thời gian cập nhật)
const SECTION_FIELDS = {
  basic: ['businessName', 'botName', 'businessInfo', 'hotline', 'address', 'openingHours'],
  shipping: ['policies', 'shippingFee', 'freeShippingThreshold'],
  payment: ['paymentInfo'],
};

router.get('/settings', async (_req, res) => {
  res.json(await Settings.get());
});

router.put('/settings', async (req, res) => {
  const settings = await Settings.get();
  settings.set(pick(req.body, SETTINGS_FIELDS));
  const now = new Date();
  for (const [section, fields] of Object.entries(SECTION_FIELDS)) {
    if (fields.some((f) => settings.isModified(f))) settings.set(`sectionUpdatedAt.${section}`, now);
  }
  await settings.save();
  res.json(settings);
});

export default router;
