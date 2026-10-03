import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { connectDB, disconnectDB } from '../src/db.js';
import { signUserToken } from '../src/middleware/auth.js';
import { Conversation } from '../src/models/Conversation.js';
import { Customer } from '../src/models/Customer.js';
import { Message } from '../src/models/Message.js';
import { MetaPage } from '../src/models/MetaPage.js';
import { Order } from '../src/models/Order.js';
import { User } from '../src/models/User.js';
import { emitAdmin } from '../src/realtime.js';
import { seedDatabase } from '../src/seedData.js';
import { handleIncomingMessage } from '../src/services/conversationService.js';
import { _resetOAuthMemory } from '../src/services/metaPageService.js';
import { hashPassword } from '../src/utils/password.js';

// Kiểm thử RÒ DỮ LIỆU của phân quyền theo Page (góc nhìn Tester, độc lập với test của Coder):
// route HTTP, realtime bằng socket.io THẬT, vòng đời socket. Không gọi OpenAI (client giả), Graph giả.

let server;
let io;
let base;
const realFetch = globalThis.fetch;
let graphCalls = [];

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
function fakeGraph(url, opts = {}) {
  const u = String(url);
  graphCalls.push({ url: u, method: opts.method || 'GET' });
  if (u.includes('/oauth/access_token')) return json({ access_token: 'T' });
  if (u.includes('/subscribed_apps')) return json({ success: true });
  if (u.includes('/me/messages')) return json({ message_id: 'm1' });
  return json({}, 404);
}

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* không phải JSON */
  }
  return { status: res.status, text, json: parsed };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const scripted = () => ({ chat: { completions: { create: async () => ({ choices: [{ message: { role: 'assistant', content: 'đã nhận' } }] }) } } });

// socket.io-client chỉ có trong client/node_modules
let ioc = null;
try {
  ({ io: ioc } = await import('../../client/node_modules/socket.io-client/build/esm/index.js'));
} catch {
  ioc = null;
}

describe('Rò dữ liệu: phân quyền theo Page', () => {
  const tokens = {};
  const users = {};
  const conv = {};
  const order = {};
  let seq = 0;
  let sockets = [];

  const get = (path, who) => call('GET', `/api/admin${path}`, { token: tokens[who] });
  const post = (path, who, body = {}) => call('POST', `/api/admin${path}`, { token: tokens[who], body });
  const ids = (res, map) => Object.entries(map).filter(([, id]) => res.json.some((c) => String(c._id) === id)).map(([k]) => k).sort();

  async function makeConv(key, channel, pageId, extra = {}) {
    seq += 1;
    const externalId = `lk-${seq}`;
    const customer = await Customer.create({ channel, externalId });
    const c = await Conversation.create({ customer: customer._id, channel, externalId, ...(pageId === undefined ? {} : { pageId }), ...extra });
    conv[key] = String(c._id);
  }
  async function makeOrder(key, channel, pageId) {
    seq += 1;
    const doc = { code: `LK${seq}`, status: 'new', items: [], subtotal: 0, shippingFee: 0, total: 0, shipping: { name: 'Khách', phone: '0900000000', address: 'x' } };
    if (channel === undefined) {
      // đơn cũ: không có channel
      const r = await Order.collection.insertOne({ ...doc, createdAt: new Date(), updatedAt: new Date() });
      order[key] = String(r.insertedId);
    } else {
      const o = await Order.create({ ...doc, channel, pageId });
      order[key] = String(o._id);
    }
  }

  before(async () => {
    await connectDB('memory');
    await seedDatabase();
    ({ server, io } = createApp());
    await new Promise((r) => server.listen(0, r));
    base = `http://127.0.0.1:${server.address().port}`;
    globalThis.fetch = (url, opts) => {
      const u = String(url);
      if (/^https?:\/\/127\.0\.0\.1/.test(u)) return realFetch(url, opts);
      if (u.startsWith('https://graph.facebook.com')) return Promise.resolve(fakeGraph(url, opts));
      return Promise.reject(new Error(`Chặn request ra ngoài: ${url}`));
    };
    config.meta.appId = 'APP';
    config.meta.appSecret = 'SECRET';
    config.meta.oauthRedirectUri = 'http://localhost/api/meta/oauth/callback';
    config.meta.pageAccessToken = '';
  });
  after(async () => {
    globalThis.fetch = realFetch;
    io.close();
    await disconnectDB();
  });
  afterEach(() => {
    for (const s of sockets) s.close();
    sockets = [];
  });

  beforeEach(async () => {
    _resetOAuthMemory();
    graphCalls = [];
    await Promise.all([Conversation.deleteMany({}), Customer.deleteMany({}), Message.deleteMany({}), Order.deleteMany({}), MetaPage.deleteMany({}), User.deleteMany({ username: /^lk-/ })]);
    await MetaPage.create({ pageId: '111', name: 'Page Một', accessToken: 'SECRET-TOK-1' });
    await MetaPage.create({ pageId: '222', name: 'Page Hai', accessToken: 'SECRET-TOK-2' });

    const passwordHash = await hashPassword('matkhau-123');
    const permissions = ['inbox.view', 'inbox.reply', 'orders.view', 'orders.update'];
    await User.create({ username: 'lk-admin', role: 'admin', passwordHash });
    // Bản ghi cũ: không có trường phạm vi
    await User.collection.insertOne({ username: 'lk-old', displayName: '', passwordHash, role: 'staff', permissions, active: true, tokenVersion: 0, createdAt: new Date(), updatedAt: new Date() });
    await User.create({ username: 'lk-p1', role: 'staff', permissions, passwordHash, inboxScope: 'pages', pageIds: ['111'] });
    await User.create({ username: 'lk-p1o', role: 'staff', permissions, passwordHash, inboxScope: 'pages', pageIds: ['111'], inboxOther: true });
    await User.create({ username: 'lk-p12', role: 'staff', permissions, passwordHash, inboxScope: 'pages', pageIds: ['111', '222'] });
    await User.create({ username: 'lk-empty', role: 'staff', permissions, passwordHash, inboxScope: 'pages', pageIds: [] });
    // nhân viên giới hạn Page nhưng có quyền quản lý người dùng
    await User.create({ username: 'lk-mgr', role: 'staff', permissions: [...permissions, 'users.manage', 'inbox.view'], passwordHash, inboxScope: 'pages', pageIds: ['111'] });
    // chỉ có quyền xem hộp thư (không có quyền đơn hàng, kênh, người dùng)
    await User.create({ username: 'lk-inboxonly', role: 'staff', permissions: ['inbox.view'], passwordHash, inboxScope: 'pages', pageIds: ['111'] });
    for (const name of ['admin', 'old', 'p1', 'p1o', 'p12', 'empty', 'mgr', 'inboxonly']) {
      users[name] = await User.findOne({ username: `lk-${name}` }).lean();
      tokens[name] = signUserToken(users[name]);
    }

    for (const k of Object.keys(conv)) delete conv[k];
    for (const k of Object.keys(order)) delete order[k];
    await makeConv('m111', 'messenger', '111', { unreadCount: 2 });
    await makeConv('m222', 'messenger', '222', { unreadCount: 1 });
    await makeConv('mNone', 'messenger');
    await makeConv('ig111', 'instagram', '111');
    await makeConv('web', 'web');
    await makeConv('wa', 'whatsapp');
    await makeConv('test', 'test', '111');
    await makeOrder('o111', 'messenger', '111');
    await makeOrder('o222', 'messenger', '222');
    await makeOrder('oWeb', 'web', '');
    await makeOrder('oMsgNone', 'messenger', '');
    await makeOrder('oIg', 'instagram', '111');
    await makeOrder('oTest', 'test', '');
    await makeOrder('oLegacy', undefined);
  });

  // ======================================================================
  describe('HTTP: nhân viên "Chỉ Page được giao" (lk-p1, chỉ Page 111)', () => {
    it('danh sách hội thoại chỉ có Messenger 111', async () => {
      const res = await get('/conversations', 'p1');
      assert.equal(res.status, 200);
      assert.deepEqual(ids(res, conv), ['m111']);
    });

    it('thử ?page= của Page khác, "none", và phép tiêm toán tử Mongo: không lộ gì', async () => {
      for (const q of ['?page=222', '?page=none', '?page=999', '?page=222&mode=bot']) {
        const res = await get(`/conversations${q}`, 'p1');
        assert.equal(res.status, 200, q);
        assert.deepEqual(res.json, [], q);
      }
      // Express 5 không phân tích cú pháp lồng nhau: page[$ne] chỉ là khoá chữ, không lọc Page nhưng phạm vi vẫn giữ
      for (const q of ['?page[$ne]=111', '?page[$ne]=']) {
        const res = await get(`/conversations${q}`, 'p1');
        assert.equal(res.status, 200, q);
        assert.deepEqual(ids(res, conv), ['m111'], q);
      }
      for (const q of ['?page=111&page=222', '?page=abc', `?page=${'1'.repeat(33)}`]) {
        const res = await get(`/conversations${q}`, 'p1');
        assert.equal(res.status, 400, q);
      }
      // tham số khác không được phá điều kiện phạm vi
      for (const q of ['?mode[$ne]=x', '?stage[$ne]=x', '?attention=1', '?mode=bot&stage=new']) {
        const res = await get(`/conversations${q}`, 'p1');
        assert.equal(res.status, 200, q);
        assert.ok(ids(res, conv).every((k) => k === 'm111'), `${q} lộ ${ids(res, conv)}`);
      }
    });

    it('GET /conversations/:id của Page khác, web, test, ig, Messenger không pageId: 404; id rác: 404', async () => {
      for (const k of ['m222', 'mNone', 'ig111', 'web', 'wa', 'test']) {
        const res = await get(`/conversations/${conv[k]}`, 'p1');
        assert.equal(res.status, 404, k);
        assert.ok(!res.text.includes('lk-'), `${k} lộ externalId`);
      }
      assert.equal((await get('/conversations/khong-phai-objectid', 'p1')).status, 404);
      assert.equal((await get(`/conversations/${conv.m111}`, 'p1')).status, 200);
    });

    it('POST messages / mode / read trên hội thoại ngoài phạm vi: 404, DB không đổi, không gửi Graph', async () => {
      for (const k of ['m222', 'mNone', 'ig111', 'web', 'wa', 'test']) {
        const before = await Conversation.findById(conv[k]).lean();
        const msgBefore = await Message.countDocuments({ conversation: conv[k] });
        const r1 = await post(`/conversations/${conv[k]}/messages`, 'p1', { text: 'xin chào' });
        const r2 = await post(`/conversations/${conv[k]}/mode`, 'p1', { mode: 'human' });
        const r3 = await post(`/conversations/${conv[k]}/read`, 'p1');
        assert.deepEqual([r1.status, r2.status, r3.status], [404, 404, 404], k);
        const after = await Conversation.findById(conv[k]).lean();
        assert.equal(after.mode, before.mode, k);
        assert.equal(after.unreadCount, before.unreadCount, k);
        assert.equal(after.needsAttention, before.needsAttention, k);
        assert.equal(await Message.countDocuments({ conversation: conv[k] }), msgBefore, k);
      }
      assert.equal(graphCalls.filter((c) => c.url.includes('/me/messages')).length, 0, 'không được gửi tin ra Graph');
    });

    it('hội thoại trong phạm vi vẫn thao tác được (đọc, đổi chế độ)', async () => {
      assert.equal((await post(`/conversations/${conv.m111}/read`, 'p1')).status, 200);
      assert.equal((await Conversation.findById(conv.m111).lean()).unreadCount, 0);
      assert.equal((await post(`/conversations/${conv.m111}/mode`, 'p1', { mode: 'human' })).status, 200);
    });

    it('/inbox/pages chỉ trả Page được giao, đếm chưa đọc trong phạm vi, không lộ token', async () => {
      const res = await get('/inbox/pages', 'p1');
      assert.equal(res.status, 200);
      assert.equal(res.json.restricted, true);
      assert.equal(res.json.canSeeOther, false);
      assert.equal(res.json.otherUnread, 0);
      assert.deepEqual(res.json.pages.map((p) => p.pageId), ['111']);
      assert.equal(res.json.pages[0].unread, 1);
      assert.ok(!/SECRET|accessToken|222|Page Hai/.test(res.text), 'lộ dữ liệu Page khác');
    });

    it('/inbox/pages: otherUnread của người có "ngoài Fanpage" không đếm Page khác và hội thoại test', async () => {
      await Conversation.updateOne({ _id: conv.web }, { unreadCount: 1 });
      await Conversation.updateOne({ _id: conv.test }, { unreadCount: 5 });
      await Conversation.updateOne({ _id: conv.m222 }, { unreadCount: 5 });
      const res = await get('/inbox/pages', 'p1o');
      assert.equal(res.json.otherUnread, 1);
      assert.deepEqual(res.json.pages.map((p) => p.pageId), ['111']);
    });

    it('/permissions, /users, /meta/pages, /stats-không-quyền: 403 với nhân viên không có quyền tương ứng', async () => {
      for (const path of ['/permissions', '/users', '/meta/pages', '/promotions', '/settings']) {
        const res = await get(path, 'inboxonly');
        assert.equal(res.status, 403, path);
      }
      assert.equal((await get('/orders', 'inboxonly')).status, 403);
    });

    it('không có token: 401 trên mọi route hội thoại/đơn', async () => {
      for (const path of ['/conversations', `/conversations/${conv.m111}`, '/orders', '/inbox/pages']) {
        const res = await call('GET', `/api/admin${path}`);
        assert.equal(res.status, 401, path);
      }
    });

    it('đơn hàng: chỉ thấy đơn Messenger 111; tìm kiếm q và status không phá phạm vi', async () => {
      const res = await get('/orders', 'p1');
      assert.equal(res.status, 200);
      assert.deepEqual(ids(res, order), ['o111']);
      // q khớp mã đơn của Page khác
      const o222 = await Order.findById(order.o222).lean();
      const byCode = await get(`/orders?q=${o222.code}`, 'p1');
      assert.deepEqual(byCode.json, []);
      // q khớp mọi đơn (số điện thoại chung): vẫn chỉ đơn trong phạm vi
      const byPhone = await get('/orders?q=0900000000', 'p1');
      assert.deepEqual(ids(byPhone, order), ['o111']);
      // q rỗng-regex, status hợp lệ, toán tử Mongo
      for (const q of ['?q=.', '?q=%2E*', '?status=new', '?status[$ne]=x', '?q[$ne]=a']) {
        const r = await get(`/orders${q}`, 'p1');
        assert.equal(r.status, 200, q);
        assert.ok(ids(r, order).every((k) => k === 'o111'), `${q} lộ ${ids(r, order)}`);
      }
    });

    it('PATCH /orders/:id ngoài phạm vi: 404 và đơn không đổi (kể cả huỷ đơn hoàn kho)', async () => {
      for (const k of ['o222', 'oWeb', 'oMsgNone', 'oIg', 'oTest', 'oLegacy']) {
        const before = await Order.findById(order[k]).lean();
        const res = await call('PATCH', `/api/admin/orders/${order[k]}`, { token: tokens.p1, body: { status: 'cancelled', note: 'xâm nhập' } });
        assert.equal(res.status, 404, k);
        const after = await Order.findById(order[k]).lean();
        assert.equal(after.status, before.status, k);
        assert.equal(after.note, before.note, k);
      }
      const ok = await call('PATCH', `/api/admin/orders/${order.o111}`, { token: tokens.p1, body: { note: 'ghi chú' } });
      assert.equal(ok.status, 200);
    });

    it('nhân viên rỗng Page (lk-empty): không thấy gì ở mọi route', async () => {
      assert.deepEqual((await get('/conversations', 'empty')).json, []);
      assert.deepEqual((await get('/orders', 'empty')).json, []);
      const pages = await get('/inbox/pages', 'empty');
      assert.deepEqual(pages.json, { restricted: true, canSeeOther: false, otherUnread: 0, pages: [] });
      for (const k of ['m111', 'm222', 'web']) assert.equal((await get(`/conversations/${conv[k]}`, 'empty')).status, 404, k);
      assert.equal((await call('PATCH', `/api/admin/orders/${order.o111}`, { token: tokens.empty, body: { note: 'x' } })).status, 404);
    });
  });

  // ======================================================================
  describe('HTTP: "Ngoài Fanpage" (lk-p1o) và dữ liệu cũ', () => {
    it('lk-p1o thấy 111 + ig + web + wa + Messenger không pageId; không thấy 222 và test', async () => {
      const res = await get('/conversations', 'p1o');
      assert.deepEqual(ids(res, conv), ['ig111', 'm111', 'mNone', 'wa', 'web']);
      for (const k of ['m222', 'test']) assert.equal((await get(`/conversations/${conv[k]}`, 'p1o')).status, 404, k);
    });

    it('đơn của lk-p1o: có 111, web, ig, Messenger không pageId và đơn cũ không channel; KHÔNG có 222 và đơn test', async () => {
      const res = await get('/orders', 'p1o');
      assert.deepEqual(ids(res, order), ['o111', 'oIg', 'oLegacy', 'oMsgNone', 'oWeb']);
      for (const k of ['o222', 'oTest']) {
        const r = await call('PATCH', `/api/admin/orders/${order[k]}`, { token: tokens.p1o, body: { note: 'x' } });
        assert.equal(r.status, 404, k);
      }
    });

    it('đơn cũ không có channel: nhân viên chỉ-Page không thấy, không sửa được', async () => {
      const res = await get('/orders', 'p1');
      assert.ok(!ids(res, order).includes('oLegacy'));
      const r = await call('PATCH', `/api/admin/orders/${order.oLegacy}`, { token: tokens.p1, body: { note: 'x' } });
      assert.equal(r.status, 404);
    });

    it('User cũ thiếu trường phạm vi: thấy mọi hội thoại (trừ test) và mọi đơn; /auth/me trả mặc định', async () => {
      const res = await get('/conversations', 'old');
      assert.deepEqual(ids(res, conv), ['ig111', 'm111', 'm222', 'mNone', 'wa', 'web']);
      const orders = await get('/orders', 'old');
      assert.equal(orders.json.length, 7);
      const meRes = await call('GET', '/api/auth/me', { token: tokens.old });
      assert.equal(meRes.json.inboxScope, 'all');
      assert.deepEqual(meRes.json.pageIds, []);
      assert.equal(meRes.json.inboxOther, false);
      const pages = await get('/inbox/pages', 'old');
      assert.equal(pages.json.restricted, false);
      assert.equal((await get(`/conversations/${conv.m222}`, 'old')).status, 200);
    });

    it('admin thấy tất cả, kể cả đơn test và đơn cũ', async () => {
      assert.equal((await get('/orders', 'admin')).json.length, 7);
      assert.equal((await get('/conversations', 'admin')).json.length, 6);
    });
  });

  // ======================================================================
  describe('HTTP: tự sửa phạm vi, ngắt kết nối Page', () => {
    const put = (id, body, token) => call('PUT', `/api/admin/users/${id}`, { token, body });

    it('nhân viên giới hạn không tự sửa phạm vi của chính mình (SELF_LOCK), phạm vi trong DB không đổi', async () => {
      const id = String(users.mgr._id);
      for (const body of [{ inboxScope: 'all' }, { pageIds: ['111', '222'] }, { inboxOther: true }, { inboxScope: 'pages', pageIds: [] }]) {
        const res = await put(id, body, tokens.mgr);
        assert.equal(res.status, 400, JSON.stringify(body));
      }
      const db = await User.findById(id).lean();
      assert.equal(db.inboxScope, 'pages');
      assert.deepEqual(db.pageIds, ['111']);
      assert.equal(db.inboxOther, false);
    });

    it('admin tự gửi phạm vi "pages" cho chính mình: bị chuẩn hoá về "all" (không tự hạn chế), DB không đổi', async () => {
      const id = String(users.admin._id);
      assert.equal((await put(id, { inboxScope: 'pages', pageIds: ['111'] }, tokens.admin)).status, 200);
      assert.equal((await put(id, { displayName: 'Quản trị' }, tokens.admin)).status, 200);
      const db = await User.findById(id).lean();
      assert.equal(db.inboxScope, 'all');
      assert.deepEqual(db.pageIds, []);
    });

    it('đặt phạm vi "all" xoá pageIds/inboxOther; hạ admin thành staff chỉ-Page hợp lệ; admin luôn bị reset', async () => {
      const id = String(users.p1o._id);
      const r = await put(id, { inboxScope: 'all' }, tokens.admin);
      assert.equal(r.status, 200);
      const db = await User.findById(id).lean();
      assert.deepEqual(db.pageIds, []);
      assert.equal(db.inboxOther, false);
      const r2 = await put(String(users.p12._id), { role: 'admin' }, tokens.admin);
      assert.equal(r2.status, 200);
      const db2 = await User.findById(users.p12._id).lean();
      assert.equal(db2.inboxScope, 'all');
      assert.deepEqual(db2.pageIds, []);
    });

    it('DELETE /meta/pages/111 gỡ Page khỏi người giao, không đổi inboxScope/inboxOther, và nhân viên mất quyền xem ngay', async () => {
      const res = await call('DELETE', '/api/admin/meta/pages/111', { token: tokens.admin });
      assert.equal(res.status, 200);
      const p1 = await User.findById(users.p1._id).lean();
      const p1o = await User.findById(users.p1o._id).lean();
      const p12 = await User.findById(users.p12._id).lean();
      assert.deepEqual(p1.pageIds, []);
      assert.deepEqual(p1o.pageIds, []);
      assert.deepEqual(p12.pageIds, ['222']);
      assert.equal(p1.inboxScope, 'pages');
      assert.equal(p1o.inboxOther, true);
      assert.deepEqual((await get('/conversations', 'p1')).json, []);
      assert.equal((await get(`/conversations/${conv.m111}`, 'p1')).status, 404);
      assert.deepEqual((await get('/orders', 'p1')).json, []);
      // Page đã ngắt kết nối vẫn còn hội thoại: admin thấy, nhân viên chỉ-Page không
      assert.equal((await get(`/conversations/${conv.m111}`, 'admin')).status, 200);
    });

    it('ngắt kết nối bởi người không có channels.manage: 403 và không ai bị gỡ Page', async () => {
      const res = await call('DELETE', '/api/admin/meta/pages/111', { token: tokens.p1 });
      assert.equal(res.status, 403);
      assert.deepEqual((await User.findById(users.p1._id).lean()).pageIds, ['111']);
      assert.ok(await MetaPage.exists({ pageId: '111' }));
    });

    it('ngắt kết nối Page không tồn tại / pageId sai định dạng: 404, không ai đổi', async () => {
      for (const id of ['999', 'abc']) {
        const res = await call('DELETE', `/api/admin/meta/pages/${id}`, { token: tokens.admin });
        assert.equal(res.status, 404, id);
      }
      assert.deepEqual((await User.findById(users.p1._id).lean()).pageIds, ['111']);
      assert.deepEqual((await User.findById(users.p12._id).lean()).pageIds, ['111', '222']);
    });
  });

  // ======================================================================
  describe('Realtime thật bằng socket.io', { skip: ioc ? false : 'Không có client/node_modules/socket.io-client' }, () => {
    async function connect(who, token = tokens[who]) {
      const s = ioc(base, { auth: token === undefined ? {} : { token }, transports: ['websocket'], forceNew: true, reconnection: false });
      s.events = [];
      s.onAny((event, payload) => s.events.push({ event, payload }));
      s.who = who;
      sockets.push(s);
      await new Promise((resolve, reject) => {
        s.once('connect', resolve);
        s.once('connect_error', reject);
      });
      // chờ server xác thực xong và gắn room
      if (who && users[who] && token) {
        for (let i = 0; i < 50; i += 1) {
          if (io.sockets.adapter.rooms.get(`user:${users[who]._id}`)?.has(s.id)) break;
          await sleep(20);
        }
      } else {
        await sleep(100);
      }
      return s;
    }
    const names = (s, event) => s.events.filter((e) => !event || e.event === event);
    const flat = (s) => JSON.stringify(s.events);
    const settle = () => sleep(250);

    async function incoming(channel, pageId, marker) {
      seq += 1;
      await handleIncomingMessage({ channel, externalId: `rt-${seq}`, text: marker, client: scripted(), ...(pageId ? { pageId } : {}) });
    }

    it('tin nhắn Page 222: chỉ nhận được người có quyền xem Page 222 (message:new và conversation:update); không lọt cho người khác', async () => {
      const sAdmin = await connect('admin');
      const sOld = await connect('old');
      const sP1 = await connect('p1');
      const sP1o = await connect('p1o');
      const sP12 = await connect('p12');
      const sEmpty = await connect('empty');
      await incoming('messenger', '222', 'BIMAT-P222');
      await settle();
      for (const s of [sAdmin, sOld, sP12]) {
        assert.ok(names(s, 'message:new').length > 0, `${s.who} phải nhận message:new`);
        assert.ok(names(s, 'conversation:update').length > 0, `${s.who} phải nhận conversation:update`);
      }
      for (const s of [sP1, sP1o, sEmpty]) {
        assert.equal(flat(s).includes('BIMAT-P222'), false, `${s.who} bị lộ nội dung tin của Page 222: ${flat(s).slice(0, 200)}`);
        assert.equal(names(s).filter((e) => e.event !== 'page:bot').length, 0, `${s.who} nhận event ngoài phạm vi`);
      }
    });

    it('tin nhắn Page 111: nhân viên được giao nhận đủ, người rỗng Page thì không', async () => {
      const sP1 = await connect('p1');
      const sEmpty = await connect('empty');
      await incoming('messenger', '111', 'BIMAT-P111');
      await settle();
      assert.ok(names(sP1, 'message:new').some((e) => JSON.stringify(e.payload).includes('BIMAT-P111')));
      assert.ok(names(sP1, 'conversation:update').length > 0);
      assert.equal(names(sEmpty).length, 0);
    });

    it('tin web / instagram / Messenger không pageId: chỉ người có "ngoài Fanpage" (và người không giới hạn) nhận', async () => {
      const sP1 = await connect('p1');
      const sP1o = await connect('p1o');
      const sOld = await connect('old');
      await incoming('web', '', 'BIMAT-WEB');
      await incoming('instagram', '111', 'BIMAT-IG');
      await incoming('messenger', '', 'BIMAT-MNONE');
      await settle();
      for (const m of ['BIMAT-WEB', 'BIMAT-IG', 'BIMAT-MNONE']) {
        assert.equal(flat(sP1).includes(m), false, `lk-p1 bị lộ ${m}`);
        assert.ok(flat(sP1o).includes(m), `lk-p1o phải nhận ${m}`);
        assert.ok(flat(sOld).includes(m), `lk-old phải nhận ${m}`);
      }
    });

    it('tin Chat thử (kênh test): nhân viên giới hạn, kể cả có "ngoài Fanpage", không bao giờ nhận', async () => {
      const sP1 = await connect('p1');
      const sP1o = await connect('p1o');
      await incoming('test', '111', 'BIMAT-TEST');
      await settle();
      assert.equal(flat(sP1).includes('BIMAT-TEST'), false);
      assert.equal(flat(sP1o).includes('BIMAT-TEST'), false);
    });

    it('order:new / order:update: lọc theo phạm vi, đơn cũ không channel tính là ngoài Fanpage', async () => {
      const sP1 = await connect('p1');
      const sP1o = await connect('p1o');
      const sP12 = await connect('p12');
      const sOld = await connect('old');
      const emitFor = async (key) => {
        const o = await Order.findById(order[key]);
        emitAdmin('order:new', { ...o.toObject(), note: `BIMAT-${key}` }, o);
      };
      for (const k of ['o111', 'o222', 'oWeb', 'oTest', 'oLegacy', 'oMsgNone']) await emitFor(k);
      await settle();
      const seen = (s) => ['o111', 'o222', 'oWeb', 'oTest', 'oLegacy', 'oMsgNone'].filter((k) => flat(s).includes(`BIMAT-${k}`)).sort();
      assert.deepEqual(seen(sP1), ['o111']);
      assert.deepEqual(seen(sP1o), ['o111', 'oLegacy', 'oMsgNone', 'oWeb']);
      assert.deepEqual(seen(sP12), ['o111', 'o222']);
      assert.ok(seen(sOld).includes('o222') && seen(sOld).includes('oLegacy'));

      // order:update thật qua PATCH
      const before = { p1: names(sP1, 'order:update').length, p12: names(sP12, 'order:update').length };
      await call('PATCH', `/api/admin/orders/${order.o222}`, { token: tokens.admin, body: { note: 'BIMAT-UPD222' } });
      await settle();
      assert.equal(names(sP1, 'order:update').length, before.p1, 'lk-p1 nhận order:update của Page 222');
      assert.equal(flat(sP1).includes('BIMAT-UPD222'), false);
      assert.equal(names(sP12, 'order:update').length, before.p12 + 1);
    });

    it('socket không token / token rác / token của người bị khoá: không nhận event nào', async () => {
      const sNone = await connect(undefined, undefined);
      const sBad = await connect('x', 'token-rac');
      await User.updateOne({ _id: users.p12._id }, { active: false });
      const sLocked = await connect('p12');
      await incoming('messenger', '111', 'BIMAT-ANON');
      await settle();
      for (const s of [sNone, sBad, sLocked]) assert.equal(flat(s).includes('BIMAT-ANON'), false);
    });

    it('page:bot (ghi nhận): payload chỉ gồm pageId và botEnabled, không lộ tên/token; ĐI TỚI cả nhân viên không được giao Page đó', async () => {
      const sP1 = await connect('p1');
      await call('PATCH', '/api/admin/meta/pages/222', { token: tokens.admin, body: { botEnabled: false } });
      await settle();
      const ev = names(sP1, 'page:bot');
      // Đây là hành vi hiện tại theo kế hoạch (page:bot không thuộc SCOPED_EVENTS): chỉ kiểm tra payload tối thiểu
      for (const e of ev) assert.deepEqual(Object.keys(e.payload).sort(), ['botEnabled', 'pageId']);
      assert.equal(/SECRET|accessToken|Page Hai/.test(flat(sP1)), false);
    });

    it('đổi pageIds khi socket đang mở: áp ngay, không cần đăng nhập lại', async () => {
      const s = await connect('p1');
      await incoming('messenger', '222', 'BIMAT-A222');
      await settle();
      assert.equal(flat(s).includes('BIMAT-A222'), false);
      const res = await call('PUT', `/api/admin/users/${users.p1._id}`, { token: tokens.admin, body: { pageIds: ['222'] } });
      assert.equal(res.status, 200);
      await incoming('messenger', '222', 'BIMAT-B222');
      await incoming('messenger', '111', 'BIMAT-B111');
      await settle();
      assert.ok(flat(s).includes('BIMAT-B222'), 'phải nhận 222 sau khi được giao');
      assert.equal(flat(s).includes('BIMAT-B111'), false, 'không được nhận 111 sau khi bị bỏ');
      assert.equal(s.connected, true);
    });

    it('thu hẹp từ "all" sang "pages" khi socket đang mở: ngừng nhận ngay', async () => {
      const s = await connect('old');
      await call('PUT', `/api/admin/users/${users.old._id}`, { token: tokens.admin, body: { inboxScope: 'pages', pageIds: ['111'] } });
      await incoming('messenger', '222', 'BIMAT-NARROW');
      await incoming('web', '', 'BIMAT-NARROW-WEB');
      await settle();
      assert.equal(flat(s).includes('BIMAT-NARROW'), false);
      assert.equal(s.connected, true);
    });

    it('thu hồi quyền inbox.view khi socket đang mở: ngừng nhận mọi event hội thoại', async () => {
      const s = await connect('p1');
      await call('PUT', `/api/admin/users/${users.p1._id}`, { token: tokens.admin, body: { permissions: ['orders.view'] } });
      await incoming('messenger', '111', 'BIMAT-PERM');
      await settle();
      assert.equal(flat(s).includes('BIMAT-PERM'), false);
    });

    it('ngắt kết nối Page 111 khi socket đang mở: ngừng nhận 111 ngay, vẫn nhận 222 (p12), không bị ngắt socket', async () => {
      const sP1 = await connect('p1');
      const sP12 = await connect('p12');
      const res = await call('DELETE', '/api/admin/meta/pages/111', { token: tokens.admin });
      assert.equal(res.status, 200);
      await incoming('messenger', '111', 'BIMAT-AFTER111');
      await incoming('messenger', '222', 'BIMAT-AFTER222');
      await settle();
      assert.equal(flat(sP1).includes('BIMAT-AFTER111'), false, 'lk-p1 vẫn nhận Page 111 đã ngắt kết nối');
      assert.equal(flat(sP12).includes('BIMAT-AFTER111'), false, 'lk-p12 vẫn nhận Page 111 đã ngắt kết nối');
      assert.ok(flat(sP12).includes('BIMAT-AFTER222'));
      assert.equal(sP1.connected, true);
      assert.equal(sP12.connected, true);
    });

    const waitClosed = async (s) => {
      for (let i = 0; i < 50 && s.connected; i += 1) await sleep(20);
      return !s.connected;
    };

    it('khoá tài khoản: socket bị ngắt', async () => {
      const s = await connect('p1');
      await call('PUT', `/api/admin/users/${users.p1._id}`, { token: tokens.admin, body: { active: false } });
      assert.equal(await waitClosed(s), true);
    });

    it('đổi mật khẩu: socket bị ngắt, token cũ không dùng lại được', async () => {
      const s = await connect('p1');
      await call('PUT', `/api/admin/users/${users.p1._id}`, { token: tokens.admin, body: { password: 'matkhau-moi-456' } });
      assert.equal(await waitClosed(s), true);
      const again = await connect('p1');
      await incoming('messenger', '111', 'BIMAT-OLDTOKEN');
      await settle();
      assert.equal(flat(again).includes('BIMAT-OLDTOKEN'), false);
      assert.equal((await get('/conversations', 'p1')).status, 401);
    });

    it('xoá người dùng: socket bị ngắt', async () => {
      const s = await connect('p1');
      const res = await call('DELETE', `/api/admin/users/${users.p1._id}`, { token: tokens.admin });
      assert.equal(res.status, 200);
      assert.equal(await waitClosed(s), true);
    });

    it('nhiều socket cùng một người (hai tab): cả hai đều bị áp phạm vi mới / bị ngắt', async () => {
      const a = await connect('p1');
      const b = await connect('p1');
      await call('PUT', `/api/admin/users/${users.p1._id}`, { token: tokens.admin, body: { pageIds: [] } });
      await incoming('messenger', '111', 'BIMAT-TWOTAB');
      await settle();
      assert.equal(flat(a).includes('BIMAT-TWOTAB') || flat(b).includes('BIMAT-TWOTAB'), false);
      await call('PUT', `/api/admin/users/${users.p1._id}`, { token: tokens.admin, body: { active: false } });
      assert.equal(await waitClosed(a), true);
      assert.equal(await waitClosed(b), true);
    });

    it('user cũ thiếu trường phạm vi vẫn nhận mọi event hội thoại thật (trừ test)', async () => {
      const s = await connect('old');
      await incoming('messenger', '222', 'BIMAT-OLD222');
      await incoming('web', '', 'BIMAT-OLDWEB');
      await settle();
      assert.ok(flat(s).includes('BIMAT-OLD222'));
      assert.ok(flat(s).includes('BIMAT-OLDWEB'));
    });
  });

  // ======================================================================
  describe('Điểm cần soi thêm (thiếu source)', () => {
    it('emitAdmin thiếu source với event có phạm vi: không gửi cho nhân viên giới hạn', async () => {
      if (!ioc) return;
      const s = ioc(base, { auth: { token: tokens.p1 }, transports: ['websocket'], forceNew: true, reconnection: false });
      sockets.push(s);
      const got = [];
      s.onAny((e, p) => got.push({ e, p }));
      await new Promise((r) => s.once('connect', r));
      for (let i = 0; i < 50; i += 1) {
        if (io.sockets.adapter.rooms.get(`user:${users.p1._id}`)?.has(s.id)) break;
        await sleep(20);
      }
      const warn = console.warn;
      console.warn = () => {};
      try {
        emitAdmin('message:new', { conversationId: 'x', message: { text: 'BIMAT-NOSOURCE' } });
        emitAdmin('order:new', { code: 'BIMAT-NOSOURCE' });
        emitAdmin('conversation:update', { _id: 'x', lastMessagePreview: 'BIMAT-NOSOURCE' });
      } finally {
        console.warn = warn;
      }
      await sleep(250);
      assert.equal(JSON.stringify(got).includes('BIMAT-NOSOURCE'), false);
    });
  });
});
