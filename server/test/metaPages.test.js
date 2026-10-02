import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { connectDB, disconnectDB } from '../src/db.js';
import { Conversation } from '../src/models/Conversation.js';
import { MetaPage } from '../src/models/MetaPage.js';
import { User } from '../src/models/User.js';
import { _resetOAuthMemory, resolvePageToken } from '../src/services/metaPageService.js';
import { handleIncomingMessage } from '../src/services/conversationService.js';
import { hashPassword } from '../src/utils/password.js';

let server;
let io;
let base;
const realFetch = globalThis.fetch;

const PAGE_TOKEN = 'PAGE_TOKEN_SECRET_111';
const OTHER_TOKEN = 'PAGE_TOKEN_SECRET_222';
const SECRET_STRINGS = [PAGE_TOKEN, OTHER_TOKEN, 'LONG_TOKEN', 'SHORT_TOKEN'];

// Hành vi và nhật ký của Graph giả
let calls = [];
let graph = {};
const resetGraph = () => {
  calls = [];
  graph = {
    exchangeFail: false,
    accounts: [
      { id: '111', name: 'Page Một', access_token: PAGE_TOKEN, tasks: ['MESSAGING', 'MANAGE'] },
      { id: '222', name: 'Page Hai', access_token: OTHER_TOKEN, tasks: ['MANAGE'] },
    ],
    subscribeFail: false,
    messagesStatus: 200,
    messagesBody: { message_id: 'm1' },
  };
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

function fakeGraph(url, opts = {}) {
  const u = String(url);
  calls.push({ url: u, method: opts.method || 'GET', auth: opts.headers?.Authorization });
  if (u.includes('/oauth/access_token')) {
    if (graph.exchangeFail) return json({ error: { message: 'bad code' } }, 400);
    return json({ access_token: u.includes('fb_exchange_token') ? 'LONG_TOKEN' : 'SHORT_TOKEN' });
  }
  if (u.includes('/me/accounts')) return json({ data: graph.accounts });
  if (u.includes('/subscribed_apps')) return graph.subscribeFail && opts.method === 'POST' ? json({ error: { message: 'x' } }, 400) : json({ success: true });
  if (u.includes('/me/messages')) return json(graph.messagesBody, graph.messagesStatus);
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

const tokenOf = async (username) => (await call('POST', '/api/auth/login', { body: { username, password: 'matkhau-123' } })).json.token;
const callback = async (query) => (await fetch(`${base}/api/meta/oauth/callback?${query}`, { redirect: 'manual' })).headers.get('location');

// start -> callback, trả về sessionId
async function openSession(token) {
  const { url } = (await call('POST', '/api/admin/meta/oauth/start', { token })).json;
  const state = new URL(url).searchParams.get('state');
  const location = await callback(`code=CODE&state=${state}`);
  return new URL(location, base).searchParams.get('session');
}

describe('Kết nối Facebook Page', () => {
  let admin1;
  let admin2;
  let staffNone;
  let staffView;

  before(async () => {
    await connectDB('memory');
    ({ server, io } = createApp());
    await new Promise((resolve) => server.listen(0, resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    globalThis.fetch = (url, opts) => (String(url).startsWith('https://graph.facebook.com') ? fakeGraph(url, opts) : realFetch(url, opts));
    config.meta.appId = 'APP';
    config.meta.appSecret = 'SECRET';
    config.meta.oauthRedirectUri = 'http://localhost/api/meta/oauth/callback';
    config.meta.pageAccessToken = '';

    const passwordHash = await hashPassword('matkhau-123');
    await User.create({ username: 'ad1', role: 'admin', passwordHash });
    await User.create({ username: 'ad2', role: 'admin', passwordHash });
    await User.create({ username: 'nv-none', role: 'staff', permissions: ['orders.view'], passwordHash });
    await User.create({ username: 'nv-view', role: 'staff', permissions: ['channels.view'], passwordHash });
    admin1 = await tokenOf('ad1');
    admin2 = await tokenOf('ad2');
    staffNone = await tokenOf('nv-none');
    staffView = await tokenOf('nv-view');
  });
  after(async () => {
    globalThis.fetch = realFetch;
    io.close();
    await disconnectDB();
  });
  beforeEach(() => {
    _resetOAuthMemory();
    resetGraph();
    config.meta.appId = 'APP';
    config.meta.pageAccessToken = '';
  });

  it('phân quyền channels.view / channels.manage', async () => {
    assert.equal((await call('GET', '/api/admin/meta/pages', { token: staffNone })).status, 403);
    assert.equal((await call('GET', '/api/admin/meta/pages', { token: staffView })).status, 200);
    assert.equal((await call('POST', '/api/admin/meta/oauth/start', { token: staffView })).status, 403);
  });

  it('thiếu cấu hình thì start trả 400', async () => {
    config.meta.appId = '';
    assert.equal((await call('POST', '/api/admin/meta/oauth/start', { token: admin1 })).status, 400);
    const list = await call('GET', '/api/admin/meta/pages', { token: admin1 });
    assert.equal(list.json.configured, false);
  });

  it('luồng đầy đủ: start -> callback -> chọn Page -> lưu', async () => {
    const start = await call('POST', '/api/admin/meta/oauth/start', { token: admin1 });
    assert.equal(start.status, 200);
    assert.match(start.json.url, /client_id=APP/);
    const state = new URL(start.json.url).searchParams.get('state');
    assert.ok(state);

    const location = await callback(`code=CODE&state=${state}`);
    assert.match(location, /^\/admin\/channels\?session=/);
    const sessionId = new URL(location, base).searchParams.get('session');

    const session = await call('GET', `/api/admin/meta/oauth/sessions/${sessionId}`, { token: admin1 });
    assert.equal(session.status, 200);
    assert.deepEqual(
      session.json.pages.map((p) => [p.pageId, p.canMessage, p.connected]),
      [['111', true, false], ['222', false, false]],
    );
    for (const s of SECRET_STRINGS) assert.ok(!session.text.includes(s));

    const result = await call('POST', '/api/admin/meta/pages', { token: admin1, body: { sessionId, pageIds: ['111', '222', '111'] } });
    assert.equal(result.status, 200);
    assert.equal(result.json.connected.length, 1);
    assert.equal(result.json.failed.length, 1);
    assert.equal(result.json.failed[0].pageId, '222');
    for (const s of SECRET_STRINGS) assert.ok(!result.text.includes(s));
    assert.equal(calls.filter((c) => c.url.includes('/subscribed_apps')).length, 1);

    const list = await call('GET', '/api/admin/meta/pages', { token: admin1 });
    assert.equal(list.json.pages.length, 1);
    assert.equal(list.json.pages[0].pageId, '111');
    for (const s of SECRET_STRINGS) assert.ok(!list.text.includes(s));
    assert.equal((await MetaPage.findOne({ pageId: '111' }).select('+accessToken')).accessToken, PAGE_TOKEN);
  });

  it('callback lỗi: state dùng lại, huỷ, đổi code lỗi, không có Page', async () => {
    const { url } = (await call('POST', '/api/admin/meta/oauth/start', { token: admin1 })).json;
    const state = new URL(url).searchParams.get('state');
    assert.match(await callback(`code=CODE&state=${state}`), /session=/);
    assert.match(await callback(`code=CODE&state=${state}`), /error=state/);

    const second = new URL((await call('POST', '/api/admin/meta/oauth/start', { token: admin1 })).json.url).searchParams.get('state');
    assert.match(await callback(`error=access_denied&state=${second}`), /error=cancelled/);

    graph.exchangeFail = true;
    const third = new URL((await call('POST', '/api/admin/meta/oauth/start', { token: admin1 })).json.url).searchParams.get('state');
    assert.match(await callback(`code=CODE&state=${third}`), /error=exchange/);

    graph.exchangeFail = false;
    graph.accounts = [];
    const fourth = new URL((await call('POST', '/api/admin/meta/oauth/start', { token: admin1 })).json.url).searchParams.get('state');
    assert.match(await callback(`code=CODE&state=${fourth}`), /error=no_pages/);
  });

  it('phiên chỉ của người tạo và chỉ dùng một lần', async () => {
    const sessionId = await openSession(admin1);
    assert.equal((await call('GET', `/api/admin/meta/oauth/sessions/${sessionId}`, { token: admin2 })).status, 404);
    const body = { sessionId, pageIds: ['111'] };
    assert.equal((await call('POST', '/api/admin/meta/pages', { token: admin1, body })).status, 200);
    assert.equal((await call('POST', '/api/admin/meta/pages', { token: admin1, body })).status, 404);
  });

  it('đăng ký webhook lỗi thì Page không được lưu', async () => {
    await MetaPage.deleteMany({});
    graph.subscribeFail = true;
    const sessionId = await openSession(admin1);
    const result = await call('POST', '/api/admin/meta/pages', { token: admin1, body: { sessionId, pageIds: ['111'] } });
    assert.equal(result.json.connected.length, 0);
    assert.equal(result.json.failed.length, 1);
    assert.equal(await MetaPage.countDocuments(), 0);
  });

  it('gửi tin dùng token của Page và lưu pageId lên hội thoại', async () => {
    await MetaPage.deleteMany({});
    await MetaPage.create({ pageId: '111', name: 'Page Một', accessToken: PAGE_TOKEN });
    await handleIncomingMessage({ channel: 'messenger', externalId: 'PSID1', pageId: '111', text: 'gặp nhân viên' });
    const conv = await Conversation.findOne({ channel: 'messenger', externalId: 'PSID1' });
    assert.equal(conv.pageId, '111');
    const sent = calls.filter((c) => c.url.includes('/me/messages'));
    assert.ok(sent.length >= 1);
    assert.ok(sent.every((c) => c.auth === `Bearer ${PAGE_TOKEN}`));
  });

  it('token Page lỗi 190 thì đánh dấu invalid và cần chú ý', async () => {
    await MetaPage.deleteMany({});
    await MetaPage.create({ pageId: '111', name: 'Page Một', accessToken: PAGE_TOKEN });
    graph.messagesStatus = 400;
    graph.messagesBody = { error: { code: 190, message: 'expired' } };
    await handleIncomingMessage({ channel: 'messenger', externalId: 'PSID2', pageId: '111', text: 'gặp nhân viên' });
    assert.equal((await MetaPage.findOne({ pageId: '111' })).status, 'invalid');
    assert.equal((await Conversation.findOne({ channel: 'messenger', externalId: 'PSID2' })).needsAttention, true);
  });

  it('resolvePageToken: dự phòng bằng token trong .env', async () => {
    await MetaPage.deleteMany({});
    config.meta.pageAccessToken = 'ENV';
    const r = await resolvePageToken('999');
    assert.equal(r.source, 'env');
    assert.equal(r.token, 'ENV');
    config.meta.pageAccessToken = '';
    assert.equal(await resolvePageToken('999'), null);
  });

  it('ngắt kết nối Page', async () => {
    await MetaPage.deleteMany({});
    await MetaPage.create({ pageId: '111', name: 'Page Một', accessToken: PAGE_TOKEN });
    assert.equal((await call('DELETE', '/api/admin/meta/pages/111', { token: admin1 })).status, 200);
    assert.equal(await MetaPage.countDocuments({ pageId: '111' }), 0);
    assert.equal((await call('DELETE', '/api/admin/meta/pages/111', { token: admin1 })).status, 404);
    assert.equal((await call('DELETE', '/api/admin/meta/pages/abc', { token: admin1 })).status, 404);
  });
});
