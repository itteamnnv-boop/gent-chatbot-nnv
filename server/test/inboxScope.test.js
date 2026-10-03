import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
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
import { attachAdminSocket, emitAdmin, setIO } from '../src/realtime.js';
import { seedDatabase } from '../src/seedData.js';
import { inboxScopeOf } from '../src/services/inboxScope.js';
import { _resetOAuthMemory } from '../src/services/metaPageService.js';
import { hashPassword } from '../src/utils/password.js';

// Kiểm thử giao Page cho nhân viên: lọc Hộp thư, Đơn hàng, realtime và tự gỡ Page khi ngắt kết nối.

let server;
let io;
let base;
const realFetch = globalThis.fetch;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
function fakeGraph(url) {
  const u = String(url);
  if (u.includes('/oauth/access_token')) return json({ access_token: u.includes('fb_exchange_token') ? 'LONG_TOKEN' : 'SHORT_TOKEN' });
  if (u.includes('/me/accounts')) return json({ data: [{ id: '111', name: 'Page Một', access_token: 'PAGE_TOKEN_SECRET_111', tasks: ['MESSAGING'] }] });
  if (u.includes('/subscribed_apps')) return json({ success: true });
  return json({}, 404);
}

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, json: text ? JSON.parse(text) : null };
}

// io giả chỉ có những gì realtime.js dùng
function fakeIO() {
  const rooms = new Map();
  const sockets = new Map();
  const toEmits = [];
  const fake = {
    to: (r) => ({ emit: (event, payload) => toEmits.push({ rooms: r, event, payload }) }),
    sockets: { adapter: { rooms }, sockets },
  };
  let n = 0;
  function addSocket(user) {
    n += 1;
    const id = `s${n}`;
    const socket = {
      id,
      data: {},
      rooms: new Set(),
      emitted: [],
      disconnected: false,
      emit(event, payload) {
        this.emitted.push({ event, payload });
      },
      join(r) {
        for (const room of [].concat(r)) {
          this.rooms.add(room);
          if (!rooms.has(room)) rooms.set(room, new Set());
          rooms.get(room).add(id);
        }
      },
      leave(room) {
        this.rooms.delete(room);
        rooms.get(room)?.delete(id);
      },
      disconnect() {
        this.disconnected = true;
      },
    };
    sockets.set(id, socket);
    attachAdminSocket(socket, user);
    return socket;
  }
  return { fake, addSocket, toEmits };
}

describe('Giao Page cho nhân viên', () => {
  const tokens = {};
  const users = {};
  const conv = {};
  const order = {};
  let admin;
  let seq = 0;

  const get = (path, who) => call('GET', `/api/admin${path}`, { token: tokens[who] });
  const convIds = (res) => Object.entries(conv).filter(([, id]) => res.json.some((c) => String(c._id) === id)).map(([k]) => k).sort();
  const reload = (name) => User.findOne({ username: name }).lean();

  async function makeConv(key, channel, pageId, extra = {}) {
    seq += 1;
    const externalId = `sc-${seq}`;
    const customer = await Customer.create({ channel, externalId });
    const c = await Conversation.create({ customer: customer._id, channel, externalId, ...(pageId === undefined ? {} : { pageId }), ...extra });
    conv[key] = String(c._id);
  }
  async function makeOrder(key, channel, pageId) {
    seq += 1;
    const o = await Order.create({ code: `SC${seq}`, channel, pageId, status: 'new', items: [], subtotal: 0, shippingFee: 0, total: 0, shipping: { name: 'A', phone: '0900000000', address: 'x' } });
    order[key] = String(o._id);
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
      if (u.startsWith('https://graph.facebook.com')) return Promise.resolve(fakeGraph(url));
      return Promise.reject(new Error(`Chặn request ra ngoài: ${url}`));
    };
    config.meta.appId = 'APP';
    config.meta.appSecret = 'SECRET';
    config.meta.oauthRedirectUri = 'http://localhost/api/meta/oauth/callback';
    config.meta.pageAccessToken = '';
  });
  after(async () => {
    setIO(io);
    globalThis.fetch = realFetch;
    io.close();
    await disconnectDB();
  });

  beforeEach(async () => {
    _resetOAuthMemory();
    setIO(io);
    await Promise.all([Conversation.deleteMany({}), Customer.deleteMany({}), Message.deleteMany({}), Order.deleteMany({}), MetaPage.deleteMany({}), User.deleteMany({ username: /^sc-/ })]);
    await MetaPage.create({ pageId: '111', name: 'Page Một', accessToken: 'SECRET-TOK-1' });
    await MetaPage.create({ pageId: '222', name: 'Page Hai', accessToken: 'SECRET-TOK-2' });

    const passwordHash = await hashPassword('matkhau-123');
    const permissions = ['inbox.view', 'inbox.reply', 'orders.view', 'orders.update'];
    await User.create({ username: 'sc-admin', role: 'admin', passwordHash });
    // Bản ghi cũ: không có trường phạm vi
    await User.collection.insertOne({ username: 'sc-all', displayName: '', passwordHash, role: 'staff', permissions, active: true, tokenVersion: 0, createdAt: new Date(), updatedAt: new Date() });
    await User.create({ username: 'sc-p1', role: 'staff', permissions, passwordHash, inboxScope: 'pages', pageIds: ['111'] });
    await User.create({ username: 'sc-p1o', role: 'staff', permissions, passwordHash, inboxScope: 'pages', pageIds: ['111'], inboxOther: true });
    await User.create({ username: 'sc-p12', role: 'staff', permissions, passwordHash, inboxScope: 'pages', pageIds: ['111', '222'] });
    await User.create({ username: 'sc-empty', role: 'staff', permissions, passwordHash, inboxScope: 'pages', pageIds: [] });
    for (const name of ['admin', 'all', 'p1', 'p1o', 'p12', 'empty']) {
      users[name] = await reload(`sc-${name}`);
      tokens[name] = signUserToken(users[name]); // ký trực tiếp để khỏi vướng giới hạn tần suất đăng nhập
    }
    admin = tokens.admin;

    for (const k of Object.keys(conv)) delete conv[k];
    await makeConv('m111', 'messenger', '111', { unreadCount: 2 });
    await makeConv('m222', 'messenger', '222', { unreadCount: 1 });
    await makeConv('mNone', 'messenger');
    await makeConv('ig', 'instagram', '111');
    await makeConv('web', 'web');
    await makeConv('wa', 'whatsapp');
    await makeConv('test', 'test', '111');
    await makeOrder('o111', 'messenger', '111');
    await makeOrder('o222', 'messenger', '222');
    await makeOrder('oWeb', 'web', '');
  });

  describe('API Người dùng', () => {
    const put = (id, body, token = admin) => call('PUT', `/api/admin/users/${id}`, { token, body });
    const post = (body) => call('POST', '/api/admin/users', { token: admin, body: { password: 'matkhau-123', ...body } });

    it('lưu phạm vi hợp lệ và trả đủ ba trường', async () => {
      const res = await put(users.all._id, { inboxScope: 'pages', pageIds: ['222', '222'], inboxOther: true });
      assert.equal(res.status, 200);
      assert.equal(res.json.inboxScope, 'pages');
      assert.deepEqual(res.json.pageIds, ['222']);
      assert.equal(res.json.inboxOther, true);
      const created = await post({ username: 'sc-new', role: 'staff', permissions: [], inboxScope: 'pages', pageIds: ['111'] });
      assert.equal(created.status, 201);
      assert.deepEqual(created.json.pageIds, ['111']);
    });

    it('dữ liệu sai trả 400', async () => {
      const id = users.all._id;
      const many = Array.from({ length: 101 }, (_, i) => String(1000 + i));
      for (const body of [
        { inboxScope: 'x' },
        { inboxScope: 'pages', pageIds: ['abc'] },
        { inboxScope: 'pages', pageIds: many },
        { inboxScope: 'pages', pageIds: ['999'] },
        { inboxScope: 'pages', pageIds: '111' },
        { inboxScope: 'pages', inboxOther: 'true' },
      ]) {
        assert.equal((await put(id, body)).status, 400, JSON.stringify(body).slice(0, 60));
      }
      assert.equal((await post({ username: 'sc-bad', inboxScope: 'pages', pageIds: ['999'] })).status, 400);
      assert.equal((await reload('sc-all')).inboxScope, undefined);
    });

    it('Page đã giao từ trước nhưng MetaPage bị xoá thì vẫn lưu được', async () => {
      await MetaPage.deleteOne({ pageId: '111' });
      const res = await put(users.p1._id, { displayName: 'Đổi tên', pageIds: ['111'] });
      assert.equal(res.status, 200);
      assert.deepEqual(res.json.pageIds, ['111']);
    });

    it('chuyển sang admin hoặc phạm vi all thì reset', async () => {
      let res = await put(users.p1o._id, { inboxScope: 'all' });
      assert.deepEqual([res.json.inboxScope, res.json.pageIds, res.json.inboxOther], ['all', [], false]);
      res = await put(users.p12._id, { role: 'admin' });
      assert.equal(res.status, 200);
      assert.deepEqual([res.json.inboxScope, res.json.pageIds, res.json.inboxOther], ['all', [], false]);
    });

    it('tự sửa phạm vi của chính mình: 400 SELF_LOCK', async () => {
      const me = await User.create({ username: 'sc-self', role: 'staff', permissions: ['users.manage'], passwordHash: await hashPassword('matkhau-123') });
      const t = signUserToken(me);
      const res = await put(me._id, { inboxScope: 'pages' }, t);
      assert.equal(res.status, 400);
      assert.match(res.json.error, /chính bạn/);
      assert.equal((await put(me._id, { displayName: 'ok' }, t)).status, 200);
    });

    it('/auth/me có đủ ba trường; admin luôn là all', async () => {
      const me = await call('GET', '/api/auth/me', { token: tokens.p1o });
      const body = me.json.user ?? me.json;
      assert.deepEqual([body.inboxScope, body.pageIds, body.inboxOther], ['pages', ['111'], true]);
      const a = await call('GET', '/api/auth/me', { token: admin });
      const ab = a.json.user ?? a.json;
      assert.deepEqual([ab.inboxScope, ab.pageIds, ab.inboxOther], ['all', [], false]);
    });

    it('GET /permissions có pages và không lộ token', async () => {
      const res = await call('GET', '/api/admin/permissions', { token: admin });
      assert.deepEqual(res.json.pages.map((p) => p.pageId).sort(), ['111', '222']);
      assert.doesNotMatch(res.text, /accessToken|SECRET/);
    });
  });

  describe('Hộp thư', () => {
    it('sc-p1 chỉ thấy Messenger 111; Page khác và ngoài Fanpage trả []', async () => {
      assert.deepEqual(convIds(await get('/conversations', 'p1')), ['m111']);
      assert.deepEqual((await get('/conversations?page=222', 'p1')).json, []);
      assert.deepEqual((await get('/conversations?page=none', 'p1')).json, []);
      assert.deepEqual(convIds(await get('/conversations?page=111', 'p1')), ['m111']);
    });

    it('sc-p1 mở hoặc thao tác hội thoại ngoài phạm vi: 404 và DB không đổi', async () => {
      for (const key of ['m222', 'web', 'test', 'mNone']) {
        assert.equal((await get(`/conversations/${conv[key]}`, 'p1')).status, 404, key);
        const msg = await call('POST', `/api/admin/conversations/${conv[key]}/messages`, { token: tokens.p1, body: { text: 'hi' } });
        assert.equal(msg.status, 404, key);
        assert.equal((await call('POST', `/api/admin/conversations/${conv[key]}/mode`, { token: tokens.p1, body: { mode: 'human' } })).status, 404, key);
        assert.equal((await call('POST', `/api/admin/conversations/${conv[key]}/read`, { token: tokens.p1 })).status, 404, key);
      }
      const c = await Conversation.findById(conv.m222).lean();
      assert.equal(c.unreadCount, 1);
      assert.equal(c.mode, 'bot');
      assert.equal(await Message.countDocuments({}), 0);
      assert.equal((await get(`/conversations/${conv.m111}`, 'p1')).status, 200);
      assert.equal((await call('POST', `/api/admin/conversations/${conv.m111}/read`, { token: tokens.p1 })).status, 200);
    });

    it('sc-p1o thấy thêm hội thoại ngoài Fanpage nhưng không thấy 222 và test', async () => {
      assert.deepEqual(convIds(await get('/conversations', 'p1o')), ['ig', 'm111', 'mNone', 'wa', 'web']);
      assert.equal((await get(`/conversations/${conv.web}`, 'p1o')).status, 200);
      assert.equal((await get(`/conversations/${conv.m222}`, 'p1o')).status, 404);
      assert.equal((await get(`/conversations/${conv.test}`, 'p1o')).status, 404);
    });

    it('sc-p12 thấy 111 và 222', async () => {
      assert.deepEqual(convIds(await get('/conversations', 'p12')), ['m111', 'm222']);
    });

    it('sc-empty không thấy gì; /inbox/pages báo restricted', async () => {
      assert.deepEqual((await get('/conversations', 'empty')).json, []);
      const res = await get('/inbox/pages', 'empty');
      assert.deepEqual(res.json, { restricted: true, canSeeOther: false, otherUnread: 0, pages: [] });
    });

    it('sc-all (bản ghi cũ) và admin thấy mọi hội thoại trừ test', async () => {
      const expected = ['ig', 'm111', 'm222', 'mNone', 'wa', 'web'];
      assert.deepEqual(convIds(await get('/conversations', 'all')), expected);
      assert.deepEqual(convIds(await get('/conversations', 'admin')), expected);
      assert.equal((await get('/inbox/pages', 'all')).json.restricted, false);
      assert.equal((await get('/inbox/pages', 'admin')).json.restricted, false);
    });

    it('/inbox/pages của sc-p1 chỉ có Page 111', async () => {
      const res = await get('/inbox/pages', 'p1');
      assert.deepEqual(res.json.pages.map((p) => p.pageId), ['111']);
      assert.equal(res.json.pages[0].unread, 1);
      assert.equal(res.json.otherUnread, 0);
      assert.equal(res.json.canSeeOther, false);
      assert.doesNotMatch(res.text, /accessToken|SECRET/);
    });
  });

  describe('Đơn hàng', () => {
    const ids = (res) => Object.entries(order).filter(([, id]) => res.json.some((o) => String(o._id) === id)).map(([k]) => k).sort();

    it('GET /orders theo phạm vi, kể cả khi tìm kiếm q', async () => {
      assert.deepEqual(ids(await get('/orders', 'p1')), ['o111']);
      assert.deepEqual(ids(await get('/orders', 'p1o')), ['o111', 'oWeb']);
      assert.deepEqual(ids(await get('/orders', 'empty')), []);
      assert.deepEqual(ids(await get('/orders', 'all')), ['o111', 'o222', 'oWeb']);
      assert.deepEqual(ids(await get('/orders?q=SC', 'p1')), ['o111']);
    });

    it('PATCH đơn ngoài phạm vi: 404 và đơn không đổi', async () => {
      const res = await call('PATCH', `/api/admin/orders/${order.o222}`, { token: tokens.p1, body: { status: 'cancelled' } });
      assert.equal(res.status, 404);
      assert.equal((await Order.findById(order.o222)).status, 'new');
      const ok = await call('PATCH', `/api/admin/orders/${order.o111}`, { token: tokens.p1, body: { status: 'confirmed' } });
      assert.equal(ok.status, 200);
    });
  });

  describe('Realtime', () => {
    it('emitAdmin lọc theo phạm vi từng socket', () => {
      const { fake, addSocket } = fakeIO();
      setIO(fake);
      const all = addSocket(users.all);
      const p1 = addSocket(users.p1);
      const p1o = addSocket(users.p1o);
      assert.equal(all.data.scope, null);
      assert.equal(p1.data.scope.pageIds.has('111'), true);

      emitAdmin('message:new', { x: 1 }, { channel: 'messenger', pageId: '222' });
      assert.equal(all.emitted.length, 1);
      assert.equal(p1.emitted.length, 0);
      assert.equal(p1o.emitted.length, 0);

      emitAdmin('conversation:update', { x: 2 }, { channel: 'web' });
      assert.equal(all.emitted.length, 2);
      assert.equal(p1.emitted.length, 0);
      assert.equal(p1o.emitted.length, 1);

      emitAdmin('order:new', { x: 3 }, { channel: 'messenger', pageId: '111' });
      assert.deepEqual([all.emitted.length, p1.emitted.length, p1o.emitted.length], [3, 1, 2]);

      emitAdmin('conversation:update', { x: 4 }, { channel: 'test', pageId: '111' });
      assert.deepEqual([all.emitted.length, p1.emitted.length, p1o.emitted.length], [4, 1, 2]);
    });

    it('thiếu source: chỉ socket không giới hạn nhận và có cảnh báo', () => {
      const { fake, addSocket } = fakeIO();
      setIO(fake);
      const all = addSocket(users.all);
      const p1o = addSocket(users.p1o);
      const warns = [];
      const realWarn = console.warn;
      console.warn = (...a) => warns.push(a.join(' '));
      try {
        emitAdmin('order:update', { x: 1 });
      } finally {
        console.warn = realWarn;
      }
      assert.equal(all.emitted.length, 1);
      assert.equal(p1o.emitted.length, 0);
      assert.equal(warns.length, 1);
    });

    it('socket thiếu quyền không nhận; page:bot vẫn qua to().emit', () => {
      const { fake, addSocket, toEmits } = fakeIO();
      setIO(fake);
      const noPerm = addSocket({ ...users.all, permissions: ['stats.view'] });
      emitAdmin('message:new', {}, { channel: 'web' });
      assert.equal(noPerm.emitted.length, 0);
      emitAdmin('page:bot', { pageId: '111', botEnabled: false });
      assert.equal(toEmits.length, 1);
      assert.equal(toEmits[0].event, 'page:bot');
    });

    it('PUT đổi pageIds làm mới phạm vi socket; khoá hoặc xoá thì ngắt', async () => {
      const { fake, addSocket } = fakeIO();
      setIO(fake);
      const s = addSocket(users.p1);
      assert.equal(s.data.scope.pageIds.has('222'), false);
      const res = await call('PUT', `/api/admin/users/${users.p1._id}`, { token: admin, body: { pageIds: ['222'] } });
      assert.equal(res.status, 200);
      assert.equal(s.disconnected, false);
      assert.deepEqual([...s.data.scope.pageIds], ['222']);
      assert.ok(s.rooms.has('perm:inbox.view'));

      const s2 = addSocket(users.p12);
      await call('PUT', `/api/admin/users/${users.p12._id}`, { token: admin, body: { active: false } });
      assert.equal(s2.disconnected, true);

      const s3 = addSocket(users.p1o);
      await call('PUT', `/api/admin/users/${users.p1o._id}`, { token: admin, body: { password: 'matkhau-moi-456' } });
      assert.equal(s3.disconnected, true);

      const s4 = addSocket(users.empty);
      await call('DELETE', `/api/admin/users/${users.empty._id}`, { token: admin });
      assert.equal(s4.disconnected, true);
    });

    it('inboxScopeOf: admin và bản ghi cũ không giới hạn', () => {
      assert.equal(inboxScopeOf(users.admin), null);
      assert.equal(inboxScopeOf(users.all), null);
      assert.equal(inboxScopeOf(users.p1).other, false);
    });
  });

  describe('Ngắt kết nối Page', () => {
    it('gỡ Page khỏi người dùng, giữ nguyên phạm vi và vẫn cho admin xem', async () => {
      const del = await call('DELETE', '/api/admin/meta/pages/111', { token: admin });
      assert.equal(del.status, 200);
      assert.deepEqual((await reload('sc-p1')).pageIds, []);
      assert.deepEqual((await reload('sc-p1o')).pageIds, []);
      assert.deepEqual((await reload('sc-p12')).pageIds, ['222']);
      for (const n of ['p1', 'p1o', 'p12']) assert.equal((await reload(`sc-${n}`)).inboxScope, 'pages');
      assert.equal((await reload('sc-p1o')).inboxOther, true);

      assert.deepEqual((await get('/conversations', 'p1')).json, []);
      assert.deepEqual((await get('/inbox/pages', 'p1')).json, { restricted: true, canSeeOther: false, otherUnread: 0, pages: [] });
      assert.equal((await get(`/conversations/${conv.m111}`, 'p1')).status, 404);
      assert.deepEqual(convIds(await get('/conversations', 'p1o')), ['ig', 'mNone', 'wa', 'web']);
      assert.ok(convIds(await get('/conversations', 'admin')).includes('m111'));
      const gone = (await get('/inbox/pages', 'admin')).json.pages.find((p) => p.pageId === '111');
      assert.equal(gone.connected, false);
    });

    it('socket đang mở được làm mới, không bị ngắt', async () => {
      const { fake, addSocket } = fakeIO();
      setIO(fake);
      const s = addSocket(users.p1);
      assert.equal((await call('DELETE', '/api/admin/meta/pages/111', { token: admin })).status, 200);
      assert.equal(s.data.scope.pageIds.size, 0);
      assert.equal(s.disconnected, false);
    });

    it('Page không tồn tại: 404 và không đụng tới người dùng', async () => {
      assert.equal((await call('DELETE', '/api/admin/meta/pages/999', { token: admin })).status, 404);
      assert.deepEqual((await reload('sc-p1')).pageIds, ['111']);
      assert.deepEqual((await reload('sc-p12')).pageIds, ['111', '222']);
    });

    it('kết nối lại Page không tự giao lại', async () => {
      await call('DELETE', '/api/admin/meta/pages/111', { token: admin });
      const { url } = (await call('POST', '/api/admin/meta/oauth/start', { token: admin })).json;
      const state = new URL(url).searchParams.get('state');
      const location = (await fetch(`${base}/api/meta/oauth/callback?code=CODE&state=${state}`, { redirect: 'manual' })).headers.get('location');
      const sessionId = new URL(location, base).searchParams.get('session');
      const result = await call('POST', '/api/admin/meta/pages', { token: admin, body: { sessionId, pageIds: ['111'] } });
      assert.equal(result.status, 200);
      assert.deepEqual((await reload('sc-p1')).pageIds, []);
    });
  });
});
