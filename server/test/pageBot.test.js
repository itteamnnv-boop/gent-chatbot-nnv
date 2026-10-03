import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { connectDB, disconnectDB } from '../src/db.js';
import { Conversation } from '../src/models/Conversation.js';
import { Message } from '../src/models/Message.js';
import { MetaPage } from '../src/models/MetaPage.js';
import { Settings } from '../src/models/Settings.js';
import { User } from '../src/models/User.js';
import { seedDatabase } from '../src/seedData.js';
import { handleIncomingMessage } from '../src/services/conversationService.js';
import { _resetOAuthMemory } from '../src/services/metaPageService.js';
import { emitAdmin } from '../src/realtime.js';
import { hashPassword } from '../src/utils/password.js';

// Kiểm thử bật/tắt bot theo từng Page. Không gọi OpenAI thật (client giả theo kịch bản),
// Graph của Facebook được giả lập và ghi lại lời gọi.

let server;
let io;
let base;
const realFetch = globalThis.fetch;

const PAGE_TOKEN = 'PAGE_TOKEN_SECRET_111';
let calls = [];
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
function fakeGraph(url, opts = {}) {
  const u = String(url);
  calls.push({ url: u, method: opts.method || 'GET' });
  if (u.includes('/oauth/access_token')) return json({ access_token: u.includes('fb_exchange_token') ? 'LONG_TOKEN' : 'SHORT_TOKEN' });
  if (u.includes('/me/accounts')) return json({ data: [{ id: '111', name: 'Page Một', access_token: PAGE_TOKEN, tasks: ['MESSAGING'] }] });
  if (u.includes('/subscribed_apps')) return json({ success: true });
  if (u.includes('/me/messages')) return json({ message_id: 'm1' });
  return json({}, 404);
}
const messageCalls = () => calls.filter((c) => c.url.includes('/me/messages'));

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

describe('Bật/tắt bot theo Page', () => {
  let admin;
  let staffView;
  let seq = 0;
  const ext = () => `pb-${(seq += 1)}`;
  const send = (channel, externalId, text, client, pageId) =>
    handleIncomingMessage({ channel, externalId, text, client, ...(pageId ? { pageId } : {}) });
  const patch = (pageId, botEnabled, token = admin) => call('PATCH', `/api/admin/meta/pages/${pageId}`, { token, body: { botEnabled } });
  const conv = (channel, externalId) => Conversation.findOne({ channel, externalId });
  const setGlobalBot = async (on) => {
    const s = await Settings.get();
    s.botEnabled = on;
    await s.save();
  };

  before(async () => {
    await connectDB('memory');
    await seedDatabase();
    ({ server, io } = createApp());
    await new Promise((r) => server.listen(0, r));
    base = `http://127.0.0.1:${server.address().port}`;
    // Tuyệt đối không để request ra ngoài; Graph dùng bản giả
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
    const passwordHash = await hashPassword('matkhau-123');
    await User.create({ username: 'pb-admin', role: 'admin', passwordHash });
    await User.create({ username: 'pb-view', role: 'staff', permissions: ['channels.view'], passwordHash });
    admin = await tokenOf('pb-admin');
    staffView = await tokenOf('pb-view');
  });
  after(async () => {
    globalThis.fetch = realFetch;
    io.close();
    await disconnectDB();
  });
  beforeEach(async () => {
    calls = [];
    _resetOAuthMemory();
    await MetaPage.deleteMany({});
    await MetaPage.create({ pageId: '111', name: 'Page Một', accessToken: PAGE_TOKEN });
    await MetaPage.create({ pageId: '222', name: 'Page Hai', accessToken: 'SECRET-TOK-2' });
    await setGlobalBot(true);
  });

  it('PATCH bị từ chối: 401, 403, 404, 400', async () => {
    assert.equal((await call('PATCH', '/api/admin/meta/pages/111', { body: { botEnabled: false } })).status, 401);
    assert.equal((await patch('111', false, staffView)).status, 403);
    assert.equal((await patch('abc', false)).status, 404);
    assert.equal((await patch('999', false)).status, 404);
    for (const body of [{ botEnabled: 'false' }, { botEnabled: 0 }, {}, { botEnabled: null }]) {
      assert.equal((await call('PATCH', '/api/admin/meta/pages/111', { token: admin, body })).status, 400, JSON.stringify(body));
    }
    assert.equal((await MetaPage.findOne({ pageId: '111' })).botEnabled, true);
  });

  it('PATCH thành công: trả botEnabled, không lộ token, GET /meta/pages phản ánh', async () => {
    const res = await patch('111', false);
    assert.equal(res.status, 200);
    assert.equal(res.json.botEnabled, false);
    assert.doesNotMatch(res.text, /SECRET|accessToken/);
    const list = (await call('GET', '/api/admin/meta/pages', { token: admin })).json.pages;
    assert.equal(list.find((p) => p.pageId === '111').botEnabled, false);
    assert.equal(list.find((p) => p.pageId === '222').botEnabled, true);
  });

  it('bản ghi cũ không có botEnabled: coi là bật, bot vẫn trả lời, không gắn cờ', async () => {
    await MetaPage.collection.insertOne({ pageId: '333', name: 'Page Cũ', accessToken: 'TOK-OLD', tasks: [], status: 'active', connectedAt: new Date() });
    const list = (await call('GET', '/api/admin/meta/pages', { token: admin })).json.pages;
    assert.equal(list.find((p) => p.pageId === '333').botEnabled, true);
    const e = ext();
    const client = scriptedClient([say('chào')]);
    const r = await send('messenger', e, 'hi', client, '333');
    assert.equal(r.replies.length, 1);
    assert.equal((await conv('messenger', e)).needsAttention, false);
  });

  it('Messenger tới Page đang tắt: lưu tin, gắn Cần chú ý, không trả lời, không gọi Graph', async () => {
    await patch('111', false);
    const e = ext();
    const client = scriptedClient([]);
    const r = await send('messenger', e, 'giá urê bao nhiêu', client, '111');
    assert.deepEqual(r.replies, []);
    assert.equal(r.pageBotOff, true);
    assert.equal(client.requests.length, 0);
    assert.equal(messageCalls().length, 0);
    const c = await conv('messenger', e);
    assert.equal(await Message.countDocuments({ conversation: c._id, role: 'customer' }), 1);
    assert.equal(c.unreadCount, 1);
    assert.equal(c.mode, 'bot');
    assert.equal(c.needsAttention, true);
  });

  it('Cần chú ý gắn lại với mỗi tin, kể cả khi đang ở chế độ human', async () => {
    await patch('111', false);
    const e = ext();
    await send('messenger', e, 'tin 1', scriptedClient([]), '111');
    const c = await conv('messenger', e);
    await call('POST', `/api/admin/conversations/${c._id}/read`, { token: admin });
    assert.equal((await conv('messenger', e)).needsAttention, false);
    await send('messenger', e, 'tin 2', scriptedClient([]), '111');
    assert.equal((await conv('messenger', e)).needsAttention, true);

    await call('POST', `/api/admin/conversations/${c._id}/read`, { token: admin });
    await call('POST', `/api/admin/conversations/${c._id}/mode`, { token: admin, body: { mode: 'human' } });
    assert.equal((await conv('messenger', e)).needsAttention, false);
    await send('messenger', e, 'tin 3', scriptedClient([]), '111');
    const after3 = await conv('messenger', e);
    assert.equal(after3.mode, 'human');
    assert.equal(after3.needsAttention, true);
  });

  it('từ khoá chuyển nhân viên tới Page tắt: không gửi handoffMessage, mode vẫn bot', async () => {
    await patch('111', false);
    const e = ext();
    const r = await send('messenger', e, 'cho tôi gặp nhân viên', scriptedClient([]), '111');
    assert.deepEqual(r.replies, []);
    assert.equal(messageCalls().length, 0);
    const c = await conv('messenger', e);
    assert.equal(c.mode, 'bot');
    assert.equal(c.needsAttention, true);
  });

  it('công tắc tổng không đổi hành vi: chỉ tổng tắt thì không gắn cờ; tổng và Page cùng tắt thì gắn cờ', async () => {
    try {
      await setGlobalBot(false);
      const e1 = ext();
      const r1 = await send('messenger', e1, 'hi', scriptedClient([]), '222');
      assert.deepEqual(r1.replies, []);
      assert.equal('pageBotOff' in r1, false);
      assert.equal((await conv('messenger', e1)).needsAttention, false);

      await patch('111', false);
      const e2 = ext();
      const r2 = await send('messenger', e2, 'hi', scriptedClient([]), '111');
      assert.equal(r2.pageBotOff, true);
      assert.equal((await conv('messenger', e2)).needsAttention, true);
    } finally {
      await setGlobalBot(true);
    }
  });

  it('Page khác đang bật: bot trả lời bình thường', async () => {
    await patch('111', false);
    const e = ext();
    const client = scriptedClient([say('chào anh')]);
    const r = await send('messenger', e, 'hi', client, '222');
    assert.equal(r.replies.length, 1);
    assert.equal(client.requests.length, 1);
    assert.equal((await conv('messenger', e)).needsAttention, false);
  });

  it('bật lại: tin tiếp theo trên cùng hội thoại được bot trả lời', async () => {
    await patch('111', false);
    const e = ext();
    const r1 = await send('messenger', e, 'hi', scriptedClient([]), '111');
    assert.deepEqual(r1.replies, []);
    await patch('111', true);
    const client = scriptedClient([say('em đây ạ')]);
    const r2 = await send('messenger', e, 'hi lại', client, '111');
    assert.equal(r2.replies.length, 1);
    assert.equal(client.requests.length, 1);
  });

  it('phạm vi kênh: instagram và web mang pageId của Page tắt vẫn được trả lời', async () => {
    await patch('111', false);
    config.meta.pageAccessToken = 'ENV-TOKEN'; // Instagram dùng token .env, có token thì giao tin không lỗi
    const ids = {};
    for (const channel of ['instagram', 'web']) {
      ids[channel] = ext();
      const client = scriptedClient([say('ok')]);
      const r = await send(channel, ids[channel], 'hi', client, '111');
      assert.equal(r.replies.length, 1, channel);
      assert.equal('pageBotOff' in r, false, channel);
      assert.equal((await conv(channel, ids[channel])).needsAttention, false, channel);
    }
    config.meta.pageAccessToken = '';
    const list = (await call('GET', '/api/admin/conversations', { token: admin })).json;
    for (const channel of ['instagram', 'web']) {
      assert.equal(list.find((c) => c.externalId === ids[channel]).pageBotOff, false, channel);
    }
  });

  it('nhãn Hộp thư tính theo trạng thái hiện tại, không lưu DB', async () => {
    await patch('111', false);
    const [a, b, c] = [ext(), ext(), ext()];
    await send('messenger', a, 'hi', scriptedClient([]), '111');
    await send('messenger', b, 'hi', scriptedClient([say('ok')]), '222');
    await send('messenger', c, 'hi', scriptedClient([say('ok')]));
    const flags = async () => {
      const list = (await call('GET', '/api/admin/conversations', { token: admin })).json;
      return [a, b, c].map((x) => list.find((v) => v.externalId === x).pageBotOff);
    };
    assert.deepEqual(await flags(), [true, false, false]);
    const id = String((await conv('messenger', a))._id);
    assert.equal((await call('GET', `/api/admin/conversations/${id}`, { token: admin })).json.conversation.pageBotOff, true);
    assert.equal('pageBotOff' in (await Conversation.findById(id).lean()), false);

    await patch('111', true);
    assert.deepEqual(await flags(), [false, false, false]);
    assert.equal((await call('GET', `/api/admin/conversations/${id}`, { token: admin })).json.conversation.pageBotOff, false);
  });

  it('event page:bot đã khai báo quyền (không in cảnh báo)', async () => {
    const warns = [];
    const realWarn = console.warn;
    console.warn = (...args) => warns.push(args.join(' '));
    try {
      emitAdmin('page:bot', { pageId: '111', botEnabled: false });
      await patch('111', false);
    } finally {
      console.warn = realWarn;
    }
    assert.equal(warns.filter((w) => w.includes('chưa khai báo quyền')).length, 0);
  });

  it('kết nối lại Page đang tắt giữ nguyên botEnabled', async () => {
    await patch('111', false);
    const { url } = (await call('POST', '/api/admin/meta/oauth/start', { token: admin })).json;
    const state = new URL(url).searchParams.get('state');
    const location = (await fetch(`${base}/api/meta/oauth/callback?code=CODE&state=${state}`, { redirect: 'manual' })).headers.get('location');
    const sessionId = new URL(location, base).searchParams.get('session');
    const result = await call('POST', '/api/admin/meta/pages', { token: admin, body: { sessionId, pageIds: ['111'] } });
    assert.equal(result.status, 200);
    assert.equal(result.json.connected.length, 1);
    assert.equal(result.json.connected[0].botEnabled, false);
    assert.equal((await MetaPage.findOne({ pageId: '111' })).botEnabled, false);
  });

  it('Chat thử: Page tắt thì không trả lời và báo pageBotOff; Page bật thì pageBotOff false', async () => {
    await patch('111', false);
    const pages = (await call('GET', '/api/admin/playground/pages', { token: admin })).json.pages;
    assert.equal(pages.find((p) => p.pageId === '111').botEnabled, false);
    assert.equal(pages.find((p) => p.pageId === '222').botEnabled, true);

    const off = await call('POST', '/api/admin/playground/message', { token: admin, body: { sessionId: `${ext()}-playgr0und`, text: 'hi', pageId: '111' } });
    assert.equal(off.status, 200);
    assert.deepEqual(off.json.replies, []);
    assert.equal(off.json.pageBotOff, true);
  });
});
