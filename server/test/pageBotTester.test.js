import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { connectDB, disconnectDB } from '../src/db.js';
import { Conversation } from '../src/models/Conversation.js';
import { MetaPage } from '../src/models/MetaPage.js';
import { Settings } from '../src/models/Settings.js';
import { User } from '../src/models/User.js';
import { seedDatabase } from '../src/seedData.js';
import { handleIncomingMessage } from '../src/services/conversationService.js';
import { hashPassword } from '../src/utils/password.js';

// Tester bổ sung cho pageBot.test.js: các ca biên còn thiếu (realtime thật, payload, quyền, dữ liệu rác).
// Không gọi OpenAI thật (client giả), Graph bị chặn.

let server;
let io;
let base;
const realFetch = globalThis.fetch;
const graphCalls = [];

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, json: text ? JSON.parse(text) : null };
}
const tokenOf = async (username) => (await call('POST', '/api/auth/login', { body: { username, password: 'matkhau-123' } })).json.token;
function scriptedClient(steps) {
  const requests = [];
  return {
    requests,
    chat: {
      completions: {
        create: async (body) => {
          requests.push(structuredClone(body));
          const next = steps.shift();
          if (!next) throw new Error('OpenAI được gọi ngoài kịch bản');
          return { choices: [{ message: next }] };
        },
      },
    },
  };
}
const say = (content) => ({ role: 'assistant', content });

describe('Tester: bật/tắt bot theo Page (ca bổ sung)', () => {
  let admin;
  let seq = 0;
  const ext = () => `pbt-${(seq += 1)}`;
  const send = (channel, externalId, text, client, pageId) =>
    handleIncomingMessage({ channel, externalId, text, client, ...(pageId ? { pageId } : {}) });
  const patch = (pageId, body, token = admin) => call('PATCH', `/api/admin/meta/pages/${pageId}`, { token, body });
  const conv = (channel, externalId) => Conversation.findOne({ channel, externalId });

  // Ghi lại mọi emit qua io.to(rooms).emit(event, payload)
  let emitted = [];
  let realTo;

  before(async () => {
    await connectDB('memory');
    await seedDatabase();
    ({ server, io } = createApp());
    await new Promise((r) => server.listen(0, r));
    base = `http://127.0.0.1:${server.address().port}`;
    globalThis.fetch = (url, opts) => {
      const u = String(url);
      if (/^https?:\/\/127\.0\.0\.1/.test(u)) return realFetch(url, opts);
      graphCalls.push(u);
      if (u.startsWith('https://graph.facebook.com') && u.includes('/me/messages')) return Promise.resolve(new Response(JSON.stringify({ message_id: 'm1' }), { status: 200 }));
      return Promise.reject(new Error(`Chặn request ra ngoài: ${url}`));
    };
    config.meta.pageAccessToken = '';
    const passwordHash = await hashPassword('matkhau-123');
    await User.create({ username: 'pbt-admin', role: 'admin', passwordHash });
    admin = await tokenOf('pbt-admin');
    realTo = io.to.bind(io);
    io.to = (rooms) => {
      const target = realTo(rooms);
      return {
        emit: (event, payload) => {
          emitted.push({ rooms, event, payload });
          return target.emit(event, payload);
        },
      };
    };
  });
  after(async () => {
    io.to = realTo;
    globalThis.fetch = realFetch;
    io.close();
    await disconnectDB();
  });
  beforeEach(async () => {
    emitted = [];
    graphCalls.length = 0;
    await MetaPage.deleteMany({});
    await MetaPage.create({ pageId: '111', name: 'Page Một', accessToken: 'TOK-1' });
    await MetaPage.create({ pageId: '222', name: 'Page Hai', accessToken: 'TOK-2', status: 'invalid' });
    const s = await Settings.get();
    s.botEnabled = true;
    await s.save();
  });

  it('PATCH phát event page:bot tới phòng inbox.view với payload đúng', async () => {
    const res = await patch('111', { botEnabled: false });
    assert.equal(res.status, 200);
    const ev = emitted.filter((e) => e.event === 'page:bot');
    assert.equal(ev.length, 1);
    assert.deepEqual(ev[0].payload, { pageId: '111', botEnabled: false });
    assert.deepEqual([].concat(ev[0].rooms), ['perm:inbox.view']);
  });

  it('PATCH thất bại (403/400/404) không phát event page:bot', async () => {
    await patch('111', { botEnabled: 'false' });
    await patch('999', { botEnabled: false });
    await call('PATCH', '/api/admin/meta/pages/111', { body: { botEnabled: false } });
    assert.equal(emitted.filter((e) => e.event === 'page:bot').length, 0);
  });

  it('chỉ có channels.view: GET thấy botEnabled nhưng PATCH 403 và cờ không đổi', async () => {
    const passwordHash = await hashPassword('matkhau-123');
    await User.deleteOne({ username: 'pbt-view' });
    await User.create({ username: 'pbt-view', role: 'staff', permissions: ['channels.view'], passwordHash });
    const t = await tokenOf('pbt-view');
    const list = await call('GET', '/api/admin/meta/pages', { token: t });
    assert.equal(list.status, 200);
    assert.equal(list.json.pages.find((p) => p.pageId === '111').botEnabled, true);
    const res = await patch('111', { botEnabled: false }, t);
    assert.equal(res.status, 403);
    assert.equal((await MetaPage.findOne({ pageId: '111' })).botEnabled, true);
  });

  it('chỉ có channels.manage (không inbox.view) vẫn bật/tắt được; page invalid cũng tắt được', async () => {
    const passwordHash = await hashPassword('matkhau-123');
    await User.deleteOne({ username: 'pbt-mng' });
    await User.create({ username: 'pbt-mng', role: 'staff', permissions: ['channels.manage'], passwordHash });
    const t = await tokenOf('pbt-mng');
    const res = await patch('222', { botEnabled: false }, t);
    assert.equal(res.status, 200);
    assert.equal(res.json.botEnabled, false);
    assert.equal(res.json.status, 'invalid');
  });

  it('PATCH chỉ nhận botEnabled: trường lạ (name, status, accessToken) bị bỏ qua, idempotent', async () => {
    const r1 = await patch('111', { botEnabled: false, name: 'HACK', status: 'invalid', accessToken: 'X' });
    assert.equal(r1.status, 200);
    const r2 = await patch('111', { botEnabled: false });
    assert.equal(r2.status, 200);
    const doc = await MetaPage.findOne({ pageId: '111' }).select('+accessToken');
    assert.equal(doc.name, 'Page Một');
    assert.equal(doc.status, 'active');
    assert.equal(doc.accessToken, 'TOK-1');
    assert.equal(doc.botEnabled, false);
  });

  it('Page tắt: conversation:update mang needsAttention và pageBotOff = true; message:new vẫn phát', async () => {
    await patch('111', { botEnabled: false });
    emitted = [];
    // Event có phạm vi Page được gửi tới từng socket (không qua io.to), nên gắn một socket giả không bị giới hạn để hứng
    const fakeSocket = { data: { scope: null }, emit: (event, payload) => emitted.push({ event, payload }) };
    io.sockets.sockets.set('fake-pbt', fakeSocket);
    io.sockets.adapter.rooms.set('perm:inbox.view', new Set(['fake-pbt']));
    const e = ext();
    try {
      await send('messenger', e, 'hello', scriptedClient([]), '111');
    } finally {
      io.sockets.sockets.delete('fake-pbt');
      io.sockets.adapter.rooms.delete('perm:inbox.view');
    }
    assert.ok(emitted.some((x) => x.event === 'message:new'), 'thiếu message:new');
    const upd = emitted.filter((x) => x.event === 'conversation:update');
    assert.ok(upd.length >= 1);
    const last = upd[upd.length - 1].payload;
    const c = last.conversation || last;
    assert.equal(c.needsAttention, true);
    assert.equal(c.pageBotOff, true);
  });

  it('Page tắt: unreadCount tăng theo từng tin, không ghi thêm Message system/assistant', async () => {
    await patch('111', { botEnabled: false });
    const e = ext();
    await send('messenger', e, 'a', scriptedClient([]), '111');
    await send('messenger', e, 'b', scriptedClient([]), '111');
    await send('messenger', e, 'c', scriptedClient([]), '111');
    const c = await conv('messenger', e);
    assert.equal(c.unreadCount, 3);
    const { Message } = await import('../src/models/Message.js');
    assert.equal(await Message.countDocuments({ conversation: c._id, role: { $ne: 'customer' } }), 0);
  });

  it('bật/tắt không sửa Conversation nào trong DB và không ghi tin system', async () => {
    const e = ext();
    await send('messenger', e, 'hi', scriptedClient([say('chào')]), '111');
    const { Message } = await import('../src/models/Message.js');
    const before1 = await conv('messenger', e);
    const msgs = await Message.countDocuments({ conversation: before1._id });
    await patch('111', { botEnabled: false });
    await patch('111', { botEnabled: true });
    const after1 = await conv('messenger', e);
    assert.equal(String(after1.updatedAt), String(before1.updatedAt));
    assert.equal(after1.needsAttention, before1.needsAttention);
    assert.equal(await Message.countDocuments({ conversation: after1._id }), msgs);
  });

  it('hội thoại Messenger có pageId không thuộc MetaPage nào: bot trả lời, không cờ', async () => {
    config.meta.pageAccessToken = 'ENV-TOKEN'; // token .env để giao tin không lỗi (lỗi giao tin tự gắn cờ, hành vi cũ)
    try {
      const e = ext();
      const client = scriptedClient([say('ok')]);
      const r = await send('messenger', e, 'hi', client, '55555');
      assert.equal(r.replies.length, 1);
      assert.equal('pageBotOff' in r, false);
      assert.equal((await conv('messenger', e)).needsAttention, false);
    } finally {
      config.meta.pageAccessToken = '';
    }
  });

  it('Chat thử với Page tắt: handedOff false, mode bot, gắn Cần chú ý', async () => {
    const off = await patch('111', { botEnabled: false });
    assert.equal(off.status, 200);
    const sessionId = `${ext()}-playgr0und`;
    const res = await call('POST', '/api/admin/playground/message', { token: admin, body: { sessionId, text: 'hi', pageId: '111' } });
    assert.equal(res.status, 200);
    assert.equal(res.json.pageBotOff, true);
    assert.equal(res.json.handedOff, false);
    const c = await conv('test', sessionId);
    assert.equal(c.mode, 'bot');
    assert.equal(c.needsAttention, true);
  });
});
