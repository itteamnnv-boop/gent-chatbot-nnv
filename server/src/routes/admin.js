import { Router } from 'express';
import mongoose from 'mongoose';
import { config } from '../config.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { Conversation, STAGES } from '../models/Conversation.js';
import { Knowledge } from '../models/Knowledge.js';
import { Message } from '../models/Message.js';
import { MetaPage } from '../models/MetaPage.js';
import { Order, ORDER_STATUSES } from '../models/Order.js';
import { Product } from '../models/Product.js';
import { Promotion } from '../models/Promotion.js';
import { Settings } from '../models/Settings.js';
import { User } from '../models/User.js';
import { PERMISSIONS, PERMISSION_KEYS, ROLES } from '../permissions.js';
import { emitAdmin, refreshUserSockets } from '../realtime.js';
import { Customer } from '../models/Customer.js';
import { conversationView, handleIncomingMessage, sendAgentMessage, setConversationMode, withPageBotFlag } from '../services/conversationService.js';
import { chunkDocument, importPriceList } from '../services/infoImport.js';
import { botDisabledPageIds, connectPages, createOAuthState, disconnectPage, getOAuthSession, isOAuthConfigured, pageRow, setPageBotEnabled } from '../services/metaPageService.js';
import { canSee, inboxScopeOf, scopeFilter } from '../services/inboxScope.js';
import { promotionRow,validatePromotionInput } from '../services/promotionService.js';
import { countOtherActiveAdmins, userRow } from '../services/userService.js';
import { PASSWORD_MAX, PASSWORD_MIN, hashPassword, isValidPassword } from '../utils/password.js';
import { escapeRegex } from '../utils/text.js';

const router = Router();
router.use(requireAuth);

const pick = (obj = {}, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
const notFound = (res) => res.status(404).json({ error: 'Không tìm thấy' });
const bad = (res, error, status = 400) => res.status(status).json({ error });
const validId = (req, res, next) => (mongoose.isValidObjectId(req.params.id) ? next() : notFound(res));
const PAGE_ID_RE = /^\d{1,32}$/;

// Hội thoại ngoài phạm vi Page của người dùng: trả 404 như không tồn tại
const conversationAccess = async (req, res, next) => {
  const scope = inboxScopeOf(req.user);
  if (!scope) return next();
  const conv = await Conversation.findById(req.params.id).select('channel pageId').lean();
  return conv && canSee(scope, conv) ? next() : notFound(res);
};

// Điều kiện "Ngoài Fanpage" (không tính Chat thử), dùng chung cho danh sách và đếm chưa đọc
const OTHER_FILTER = { $or: [{ channel: { $nin: ['messenger', 'test'] } }, { channel: 'messenger', pageId: '' }] };

// Bộ lọc Page của Hộp thư: {} (không lọc), một điều kiện Mongo, hoặc null khi giá trị không hợp lệ
function inboxPageFilter(page) {
  if (page === undefined || page === '') return {};
  if (page === 'none') return OTHER_FILTER;
  if (typeof page === 'string' && PAGE_ID_RE.test(page)) return { channel: 'messenger', pageId: page };
  return null;
}

// ---------- Tổng quan ----------
router.get('/stats', requirePermission('stats.view'), async (_req, res) => {
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
router.get('/conversations', requirePermission('inbox.view'), async (req, res) => {
  const pageFrag = inboxPageFilter(req.query.page);
  if (pageFrag === null) return bad(res, 'Page không hợp lệ');
  const filter = { $and: [{ channel: { $ne: 'test' } }, pageFrag, scopeFilter(inboxScopeOf(req.user))] };
  if (['bot', 'human'].includes(req.query.mode)) filter.mode = req.query.mode;
  if (STAGES.includes(req.query.stage)) filter.stage = req.query.stage;
  if (req.query.attention === '1') filter.needsAttention = true;
  const list = await Conversation.find(filter).sort({ lastMessageAt: -1 }).limit(200).populate('customer', 'name phone channel').lean();
  const offIds = await botDisabledPageIds();
  res.json(list.map((c) => withPageBotFlag(c, offIds)));
});

// Danh sách Page cho bộ chọn của Hộp thư, kèm số hội thoại chưa đọc trong phạm vi người xem
router.get('/inbox/pages', requirePermission('inbox.view'), async (req, res) => {
  const scope = inboxScopeOf(req.user);
  const pageMatch = scope ? { pageId: { $in: [...scope.pageIds] } } : { pageId: { $ne: '' } };
  const [metaPages, counts] = await Promise.all([
    MetaPage.find().select('pageId name status botEnabled').sort({ connectedAt: -1 }).lean(),
    Conversation.aggregate([
      { $match: { channel: 'messenger', ...pageMatch } },
      { $group: { _id: '$pageId', unread: { $sum: { $cond: [{ $gt: ['$unreadCount', 0] }, 1, 0] } } } },
    ]),
  ]);
  const unread = new Map(counts.map((c) => [c._id, c.unread]));
  const row = ({ pageId, name, status, botEnabled }) => ({ pageId, name, status, botEnabled: botEnabled !== false, connected: true, unread: unread.get(pageId) || 0 });
  const gone = (pageId) => ({ pageId, name: '', status: null, botEnabled: true, connected: false, unread: unread.get(pageId) || 0 });

  let pages;
  if (scope) {
    // Giữ thứ tự gán; Page được giao mà không còn trong MetaPage thì báo đã ngắt kết nối
    const byId = new Map(metaPages.map((p) => [p.pageId, p]));
    pages = [...scope.pageIds].map((id) => (byId.has(id) ? row(byId.get(id)) : gone(id)));
  } else {
    const known = new Set(metaPages.map((p) => p.pageId));
    const goneIds = [...unread.keys()].filter((id) => !known.has(id)).sort();
    pages = [...metaPages.map(row), ...goneIds.map(gone)];
  }
  const canSeeOther = scope ? scope.other : true;
  const otherUnread = canSeeOther ? await Conversation.countDocuments({ unreadCount: { $gt: 0 }, ...OTHER_FILTER }) : 0;
  res.json({ restricted: Boolean(scope), canSeeOther, otherUnread, pages });
});

router.get('/conversations/:id', requirePermission('inbox.view'), validId, conversationAccess, async (req, res) => {
  const conversation = await conversationView(req.params.id);
  if (!conversation) return notFound(res);
  const messages = await Message.find({ conversation: conversation._id }).sort({ createdAt: -1 }).limit(300).lean();
  const orders = await Order.find({ conversation: conversation._id }).sort({ createdAt: -1 }).lean();
  return res.json({ conversation, messages: messages.reverse(), orders });
});

router.post('/conversations/:id/messages', requirePermission('inbox.reply'), validId, conversationAccess, async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) return res.status(400).json({ error: 'Tin nhắn trống' });
  const message = await sendAgentMessage(req.params.id, text, req.user.username);
  return message ? res.json(message) : notFound(res);
});

router.post('/conversations/:id/mode', requirePermission('inbox.reply'), validId, conversationAccess, async (req, res) => {
  const { mode } = req.body || {};
  if (!['bot', 'human'].includes(mode)) return res.status(400).json({ error: 'mode phải là bot hoặc human' });
  const conv = await setConversationMode(req.params.id, mode, req.user.username);
  return conv ? res.json(conv) : notFound(res);
});

router.post('/conversations/:id/read', requirePermission('inbox.view'), validId, conversationAccess, async (req, res) => {
  await Conversation.updateOne({ _id: req.params.id }, { unreadCount: 0, needsAttention: false });
  res.json({ ok: true });
});

// ---------- Chat thử (playground) ----------
// Chủ shop chat với AI như khách hàng. Kênh "test": không hiện trong hộp thư/thống kê, không tạo đơn thật.
const validTestSession = (id) => typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id);

const PLAYGROUND_PAGE_GONE = 'Page không hợp lệ hoặc đã ngắt kết nối';
const PLAYGROUND_PAGE_MISMATCH = 'Phiên chat thử đang gắn với Page khác, hãy làm mới đoạn chat';

router.get('/playground/pages', requirePermission('playground.use'), async (_req, res) => {
  const pages = await MetaPage.find().select('pageId name status botEnabled').sort({ connectedAt: -1 }).lean();
  res.json({ pages: pages.map(({ pageId, name, status, botEnabled }) => ({ pageId, name, status, botEnabled: botEnabled !== false })) });
});

router.post('/playground/message', requirePermission('playground.use'), async (req, res) => {
  const { sessionId, text } = req.body || {};
  const clean = typeof text === 'string' ? text.trim() : '';
  if (!validTestSession(sessionId) || !clean || clean.length > 2000) return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });
  // Page giả lập: không chọn thì coi là '' (chỉ khuyến mãi chung)
  const pageId = req.body.pageId ?? '';
  if (pageId !== '') {
    if (typeof pageId !== 'string' || !PAGE_ID_RE.test(pageId) || !(await MetaPage.exists({ pageId }))) return bad(res, PLAYGROUND_PAGE_GONE);
  }
  const existing = await Conversation.findOne({ channel: 'test', externalId: sessionId }).select('pageId').lean();
  if (existing && (existing.pageId || '') !== pageId) return bad(res, PLAYGROUND_PAGE_MISMATCH, 409);
  const { replies, pageBotOff } = await handleIncomingMessage({ channel: 'test', externalId: sessionId, text: clean, ...(pageId ? { pageId } : {}) });
  const conv = await Conversation.findOne({ channel: 'test', externalId: sessionId }).select('mode').lean();
  res.json({
    replies: replies.map(({ _id, role, text: t, createdAt, toolCalls }) => ({ _id, role, text: t, createdAt, toolCalls })),
    handedOff: conv?.mode === 'human',
    pageBotOff: Boolean(pageBotOff),
  });
});

router.delete('/playground/:sessionId', requirePermission('playground.use'), async (req, res) => {
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
router.get('/orders', requirePermission('orders.view'), async (req, res) => {
  const filter = {};
  if (ORDER_STATUSES.includes(req.query.status)) filter.status = req.query.status;
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(String(req.query.q).trim()), 'i');
    filter.$or = [{ code: rx }, { 'shipping.name': rx }, { 'shipping.phone': rx }];
  }
  // $and để điều kiện phạm vi Page không đè lên $or của ô tìm kiếm
  res.json(await Order.find({ $and: [filter, scopeFilter(inboxScopeOf(req.user))] }).sort({ createdAt: -1 }).limit(300).lean());
});

router.patch('/orders/:id', requirePermission('orders.update'), validId, async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order || !canSee(inboxScopeOf(req.user), order)) return notFound(res);
  const { status, note } = req.body || {};
  if (status !== undefined && status !== order.status) {
    if (!ORDER_STATUSES.includes(status)) return res.status(400).json({ error: 'Trạng thái không hợp lệ' });
    if (order.status === 'cancelled') return res.status(400).json({ error: 'Đơn đã huỷ không thể đổi trạng thái' });
    if (status === 'cancelled') {
      // Hoàn lại tồn kho đã trừ khi tạo đơn
      await Promise.all(order.items.map((i) => Product.updateOne({ _id: i.product }, { $inc: { stock: i.quantity } })));
    }
    order.status = status;
    order.statusHistory.push({ status, by: req.user.username });
  }
  if (typeof note === 'string') order.note = note;
  await order.save();
  emitAdmin('order:update', order.toObject(), order);
  return res.json(order);
});

// ---------- Sản phẩm ----------
const PRODUCT_FIELDS = ['sku', 'name', 'category', 'description', 'usage', 'price', 'salePrice', 'unit', 'stock', 'images', 'tags', 'active'];

router.get('/products', requirePermission('products.view'), async (req, res) => {
  const filter = {};
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(String(req.query.q).trim()), 'i');
    filter.$or = [{ name: rx }, { sku: rx }, { category: rx }];
  }
  // không dùng lean() để toJSON có virtual effectivePrice
  res.json(await Product.find(filter).sort({ category: 1, name: 1 }));
});

router.post('/products', requirePermission('products.manage'), async (req, res) => {
  const product = await Product.create(pick(req.body, PRODUCT_FIELDS));
  res.status(201).json(product);
});

router.put('/products/:id', requirePermission('products.manage'), validId, async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) return notFound(res);
  product.set(pick(req.body, PRODUCT_FIELDS));
  await product.save();
  return res.json(product);
});

router.delete('/products/:id', requirePermission('products.manage'), validId, async (req, res) => {
  const r = await Product.deleteOne({ _id: req.params.id });
  return r.deletedCount ? res.json({ ok: true }) : notFound(res);
});

// Nhập bảng giá: upsert theo SKU (client đã parse CSV thành rows)
router.post('/products/import', requirePermission('products.manage'), async (req, res) => {
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
router.get('/sources', requirePermission('knowledge.view'), async (_req, res) => {
  const files = await Knowledge.aggregate([
    { $match: { source: /^file:/ } },
    { $group: { _id: '$source', chunks: { $sum: 1 }, updatedAt: { $max: '$updatedAt' } } },
    { $sort: { updatedAt: -1 } },
  ]);
  res.json(files.map((f) => ({ name: f._id.slice(5), chunks: f.chunks, updatedAt: f.updatedAt })));
});

router.post('/sources', requirePermission('knowledge.manage'), async (req, res) => {
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

router.delete('/sources/:name', requirePermission('knowledge.manage'), async (req, res) => {
  const r = await Knowledge.deleteMany({ source: `file:${req.params.name}` });
  return r.deletedCount ? res.json({ ok: true }) : notFound(res);
});

// ---------- Kho kiến thức ----------
const KNOWLEDGE_FIELDS = ['title', 'content', 'tags', 'active'];

router.get('/knowledge', requirePermission('knowledge.view'), async (req, res) => {
  // mặc định chỉ trả mục nhập tay; ?all=1 để lấy cả đoạn trích từ tài liệu
  const filter = req.query.all === '1' ? {} : { source: { $not: /^file:/ } };
  res.json(await Knowledge.find(filter).sort({ updatedAt: -1 }).lean());
});

router.post('/knowledge', requirePermission('knowledge.manage'), async (req, res) => {
  res.status(201).json(await Knowledge.create(pick(req.body, KNOWLEDGE_FIELDS)));
});

router.put('/knowledge/:id', requirePermission('knowledge.manage'), validId, async (req, res) => {
  const doc = await Knowledge.findById(req.params.id);
  if (!doc) return notFound(res);
  doc.set(pick(req.body, KNOWLEDGE_FIELDS));
  await doc.save();
  return res.json(doc);
});

router.delete('/knowledge/:id', requirePermission('knowledge.manage'), validId, async (req, res) => {
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

router.get('/settings', requirePermission('settings.view'), async (_req, res) => {
  res.json(await Settings.get());
});

router.put('/settings', requirePermission('settings.manage'), async (req, res) => {
  const settings = await Settings.get();
  settings.set(pick(req.body, SETTINGS_FIELDS));
  const now = new Date();
  for (const [section, fields] of Object.entries(SECTION_FIELDS)) {
    if (fields.some((f) => settings.isModified(f))) settings.set(`sectionUpdatedAt.${section}`, now);
  }
  await settings.save();
  res.json(settings);
});

// ---------- Kết nối Facebook Page ----------
const SESSION_GONE = 'Phiên kết nối không tồn tại hoặc đã hết hạn';

router.get('/meta/pages', requirePermission('channels.view'), async (_req, res) => {
  const pages = await MetaPage.find().sort({ connectedAt: -1 });
  // Số chương trình riêng của từng Page (đang chạy hoặc sắp chạy)
  const promos = await Promotion.find({ active: true, scope: 'pages', $or: [{ endAt: null }, { endAt: { $gt: new Date() } }] })
    .select('pageIds')
    .lean();
  const promotionCount = {};
  for (const promo of promos) for (const id of promo.pageIds) promotionCount[id] = (promotionCount[id] || 0) + 1;
  res.json({
    configured: isOAuthConfigured(),
    envTokenConfigured: Boolean(config.meta.pageAccessToken),
    pages: pages.map((p) => ({ ...pageRow(p), promotionCount: promotionCount[p.pageId] || 0 })),
  });
});

router.post('/meta/oauth/start', requirePermission('channels.manage'), (req, res) => {
  if (!isOAuthConfigured()) return bad(res, 'Chưa cấu hình META_APP_ID / META_APP_SECRET / META_OAUTH_REDIRECT_URI');
  return res.json({ url: createOAuthState(req.user._id) });
});

router.get('/meta/oauth/sessions/:id', requirePermission('channels.manage'), async (req, res) => {
  const session = await getOAuthSession(req.params.id, req.user._id);
  return session ? res.json(session) : bad(res, SESSION_GONE, 404);
});

router.post('/meta/pages', requirePermission('channels.manage'), async (req, res) => {
  const { sessionId, pageIds } = req.body || {};
  const validIds =
    Array.isArray(pageIds) && pageIds.length > 0 && pageIds.length <= 100 && pageIds.every((id) => typeof id === 'string' && PAGE_ID_RE.test(id));
  if (typeof sessionId !== 'string' || !validIds) return bad(res, 'Dữ liệu không hợp lệ');
  const result = await connectPages(sessionId, req.user._id, [...new Set(pageIds)], req.user.username);
  return result ? res.json(result) : bad(res, SESSION_GONE, 404);
});

router.delete('/meta/pages/:pageId', requirePermission('channels.manage'), async (req, res) => {
  if (!PAGE_ID_RE.test(req.params.pageId)) return notFound(res);
  if (!(await disconnectPage(req.params.pageId))) return notFound(res);
  await unassignPage(req.params.pageId);
  return res.json({ ok: true });
});

router.patch('/meta/pages/:pageId', requirePermission('channels.manage'), async (req, res) => {
  if (!PAGE_ID_RE.test(req.params.pageId)) return notFound(res);
  if (typeof req.body?.botEnabled !== 'boolean') return bad(res, 'Dữ liệu không hợp lệ');
  const doc = await setPageBotEnabled(req.params.pageId, req.body.botEnabled);
  if (!doc) return notFound(res);
  emitAdmin('page:bot', { pageId: doc.pageId, botEnabled: doc.botEnabled });
  return res.json(pageRow(doc));
});

// ---------- Khuyến mãi ----------
router.get('/promotions', requirePermission('promotions.view'), async (_req, res) => {
  const now = new Date();
  const [promotions, pages, products] = await Promise.all([
    Promotion.find().sort({ createdAt: -1 }),
    MetaPage.find().select('pageId name status').lean(),
    Product.find().sort({ name: 1 }),
  ]);
  res.json({
    promotions: promotions.map((p) => promotionRow(p, now)),
    pages: pages.map(({ pageId, name, status }) => ({ pageId, name, status })),
    products: products.map(({ _id, sku, name, effectivePrice, active }) => ({ _id, sku, name, effectivePrice, active })),
  });
});

router.post('/promotions', requirePermission('promotions.manage'), async (req, res) => {
  const { data, error } = await validatePromotionInput(req.body || {});
  if (error) return bad(res, error);
  const promotion = await Promotion.create({ ...data, createdBy: req.user.username });
  return res.status(201).json(promotionRow(promotion));
});

router.put('/promotions/:id', requirePermission('promotions.manage'), validId, async (req, res) => {
  const doc = await Promotion.findById(req.params.id);
  if (!doc) return notFound(res);
  const { data, error } = await validatePromotionInput(req.body || {}, doc);
  if (error) return bad(res, error);
  doc.set(data);
  await doc.save();
  return res.json(promotionRow(doc));
});

router.delete('/promotions/:id', requirePermission('promotions.manage'), validId, async (req, res) => {
  const r = await Promotion.deleteOne({ _id: req.params.id });
  return r.deletedCount ? res.json({ ok: true }) : notFound(res);
});

// ---------- Người dùng ----------
const USER_FIELDS = ['displayName', 'role', 'permissions', 'active', 'inboxScope', 'pageIds', 'inboxOther'];
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const ADMIN_ONLY = 'Chỉ quản trị viên mới thao tác được tài khoản quản trị';
const SELF_LOCK = 'Không thể xoá, khoá hoặc đổi quyền tài khoản của chính bạn';
const LAST_ADMIN = 'Phải còn ít nhất một quản trị viên đang hoạt động';

const validPermissions = (p) => Array.isArray(p) && p.every((k) => typeof k === 'string' && PERMISSION_KEYS.includes(k));
const sameSet = (a, b) => a.length === b.length && a.every((k) => b.includes(k));

// Kiểm tra phạm vi Hộp thư/Đơn hàng trong body; trả chuỗi lỗi hoặc null. Bỏ trùng pageIds ngay trên data.
async function validateInboxScope(data, existing) {
  if (data.inboxScope !== undefined && !['all', 'pages'].includes(data.inboxScope)) return 'Phạm vi Hộp thư không hợp lệ';
  if (data.inboxOther !== undefined && typeof data.inboxOther !== 'boolean') return 'Dữ liệu không hợp lệ';
  if (data.pageIds !== undefined) {
    const bad = 'Page không hợp lệ';
    const raw = data.pageIds;
    if (!Array.isArray(raw) || raw.length > 100 || !raw.every((id) => typeof id === 'string' && PAGE_ID_RE.test(id))) return bad;
    data.pageIds = [...new Set(raw)];
    // Page đã giao từ trước thì không cần còn kết nối; Page mới phải tồn tại
    const kept = new Set(existing?.pageIds ?? []);
    const toCheck = data.pageIds.filter((id) => !kept.has(id));
    if (toCheck.length && (await MetaPage.countDocuments({ pageId: { $in: toCheck } })) !== toCheck.length) return bad;
  }
  return null;
}

// Chuẩn hoá phạm vi theo vai trò/phạm vi cuối; sau hàm này data luôn có đủ ba trường
function normalizeInboxScope(data, finalRole, existing) {
  const scope = finalRole === 'admin' ? 'all' : (data.inboxScope ?? existing?.inboxScope ?? 'all');
  data.inboxScope = scope;
  if (scope === 'all') {
    data.pageIds = [];
    data.inboxOther = false;
  } else {
    data.pageIds = data.pageIds ?? existing?.pageIds ?? [];
    data.inboxOther = data.inboxOther ?? existing?.inboxOther === true;
  }
}

// Ngắt kết nối Page: bỏ Page khỏi mọi người dùng và làm mới socket đang mở
async function unassignPage(pageId) {
  const affected = await User.find({ pageIds: pageId }).select('_id').lean();
  await User.updateMany({ pageIds: pageId }, { $pull: { pageIds: pageId } });
  for (const { _id } of affected) refreshUserSockets(String(_id), await User.findById(_id).lean());
}

router.get('/permissions', requirePermission('users.manage'), async (_req, res) => {
  const pages = await MetaPage.find().select('pageId name status').sort({ connectedAt: -1 }).lean();
  res.json({ roles: ROLES, permissions: PERMISSIONS, pages: pages.map(({ pageId, name, status }) => ({ pageId, name, status })) });
});

router.get('/users', requirePermission('users.manage'), async (_req, res) => {
  const users = await User.find().sort({ createdAt: 1 });
  res.json(users.map(userRow));
});

router.post('/users', requirePermission('users.manage'), async (req, res) => {
  const username = String(req.body?.username ?? '').trim().toLowerCase();
  if (!USERNAME_RE.test(username)) return bad(res, 'Tên đăng nhập 3–32 ký tự: chữ thường không dấu, số, dấu . _ -');
  if (await User.exists({ username })) return bad(res, 'Tên đăng nhập đã tồn tại', 409);
  const { password } = req.body || {};
  if (!isValidPassword(password)) return bad(res, `Mật khẩu phải từ ${PASSWORD_MIN} đến ${PASSWORD_MAX} ký tự`);
  const data = pick(req.body, USER_FIELDS);
  if (data.role !== undefined && !ROLES.includes(data.role)) return bad(res, 'Vai trò không hợp lệ');
  if (data.permissions !== undefined && !validPermissions(data.permissions)) return bad(res, 'Quyền không hợp lệ');
  if (data.active !== undefined && typeof data.active !== 'boolean') return bad(res, 'Trạng thái không hợp lệ');
  if (req.user.role === 'staff' && data.role === 'admin') return bad(res, ADMIN_ONLY, 403);
  if (data.permissions !== undefined) data.permissions = [...new Set(data.permissions)];
  if (data.role === 'admin') data.permissions = [];
  const scopeError = await validateInboxScope(data, null);
  if (scopeError) return bad(res, scopeError);
  normalizeInboxScope(data, data.role ?? 'staff', null);
  const user = await User.create({ ...data, username, passwordHash: await hashPassword(password) });
  res.status(201).json(userRow(user));
});

router.put('/users/:id', requirePermission('users.manage'), validId, async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return notFound(res);
  const data = pick(req.body, USER_FIELDS);
  const { password } = req.body || {};
  const changePassword = typeof password === 'string' && password !== '';
  if (changePassword && !isValidPassword(password)) return bad(res, `Mật khẩu phải từ ${PASSWORD_MIN} đến ${PASSWORD_MAX} ký tự`);
  if (data.role !== undefined && !ROLES.includes(data.role)) return bad(res, 'Vai trò không hợp lệ');
  if (data.permissions !== undefined && !validPermissions(data.permissions)) return bad(res, 'Quyền không hợp lệ');
  if (data.active !== undefined && typeof data.active !== 'boolean') return bad(res, 'Trạng thái không hợp lệ');
  if (data.permissions !== undefined) data.permissions = [...new Set(data.permissions)];
  const finalRole = data.role ?? user.role;
  if (finalRole === 'admin') data.permissions = [];
  if (req.user.role === 'staff' && (data.role === 'admin' || user.role === 'admin')) return bad(res, ADMIN_ONLY, 403);

  const scopeError = await validateInboxScope(data, user);
  if (scopeError) return bad(res, scopeError);
  normalizeInboxScope(data, finalRole, user);

  const finalActive = data.active === undefined ? user.active : Boolean(data.active);
  const finalPermissions = data.permissions ?? user.permissions;
  if (req.params.id === String(req.user._id)) {
    const oldPageIds = user.pageIds ?? [];
    if (
      finalRole !== user.role ||
      finalActive !== user.active ||
      !sameSet(finalPermissions, user.permissions) ||
      data.inboxScope !== (user.inboxScope ?? 'all') ||
      data.inboxOther !== (user.inboxOther === true) ||
      !sameSet(data.pageIds, oldPageIds)
    ) {
      return bad(res, SELF_LOCK);
    }
  }
  if (user.role === 'admin' && user.active && (finalRole !== 'admin' || !finalActive) && (await countOtherActiveAdmins(user._id)) === 0) {
    return bad(res, LAST_ADMIN);
  }

  user.set(data);
  if (changePassword) {
    user.passwordHash = await hashPassword(password);
    user.tokenVersion += 1;
  }
  await user.save();
  refreshUserSockets(String(user._id), user);
  return res.json(userRow(user));
});

router.delete('/users/:id', requirePermission('users.manage'), validId, async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return notFound(res);
  if (req.user.role === 'staff' && user.role === 'admin') return bad(res, ADMIN_ONLY, 403);
  if (req.params.id === String(req.user._id)) return bad(res, SELF_LOCK);
  if (user.role === 'admin' && user.active && (await countOtherActiveAdmins(user._id)) === 0) return bad(res, LAST_ADMIN);
  await user.deleteOne();
  refreshUserSockets(req.params.id, null);
  return res.json({ ok: true });
});

export default router;
