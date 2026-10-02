import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { connectDB, disconnectDB } from '../src/db.js';
import { parseMetaWebhook } from '../src/channels/meta.js';
import { Conversation } from '../src/models/Conversation.js';
import { MetaPage } from '../src/models/MetaPage.js';
import { User } from '../src/models/User.js';
import { handleIncomingMessage } from '../src/services/conversationService.js';
import { _resetOAuthMemory, resolvePageToken, SESSION_TTL_MS } from '../src/services/metaPageService.js';
import { hashPassword } from '../src/utils/password.js';

// Bộ test độc lập của Tester, soi 6 điểm Coder đề nghị. Graph API được giả lập bằng cách bọc globalThis.fetch.
let server;
let io;
let base;
const realFetch = globalThis.fetch;
const realDateNow = Date.now;

const APP_SECRET = 'APPSECRET_ZZZ_777';
const CODE = 'CODE_XYZ_987';
const SHORT = 'SHORT_TOKEN_AAA';
const LONG = 'LONG_TOKEN_BBB';
const TOK1 = 'PAGE_TOKEN_ONE_111';
const TOK2 = 'PAGE_TOKEN_TWO_222';
const ENV_TOKEN = 'ENV_TOKEN_FALLBACK';
const ALL_SECRETS = [APP_SECRET, CODE, SHORT, LONG, TOK1, TOK2];

let calls = [];
let graph = {};
const resetGraph = () => {
  calls = [];
  graph = {
    failStep: 0, // 3, 4, 5: trả HTTP 400; -3/-4/-5: ném lỗi mạng
    accounts: [
      { id: '111', name: 'Page Một', access_token: TOK1, tasks: ['MESSAGING'] },
      { id: '222', name: 'Page Hai', access_token: TOK2, tasks: ['MESSAGING'] },
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
  const step = u.includes('fb_exchange_token') ? 4 : u.includes('/oauth/access_token') ? 3 : u.includes('/me/accounts') ? 5 : 0;
  if (step && graph.failStep === step) return json({ error: { message: `leak ${APP_SECRET} ${CODE} ${LONG}` } }, 400);
  if (step && graph.failStep === -step) throw new Error(`network ${u}`);
  if (step === 3) return json({ access_token: SHORT });
  if (step === 4) return json({ access_token: LONG });
  if (step === 5) return json({ data: graph.accounts });
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
let ipSeq = 0;
const callback = async (query, ip) => {
  // trust proxy = 1: mỗi lần gọi dùng một IP giả để không đụng rate limit 30/15 phút
  const res = await fetch(`${base}/api/meta/oauth/callback?${query}`, { redirect: 'manual', headers: { 'X-Forwarded-For': ip ?? `10.1.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}` } });
  return { status: res.status, location: res.headers.get('location'), text: await res.text() };
};
const newState = async (token) => new URL((await call('POST', '/api/admin/meta/oauth/start', { token })).json.url).searchParams.get('state');
async function openSession(token) {
  const state = await newState(token);
  const r = await callback(`code=${CODE}&state=${state}`);
  return new URL(r.location, base).searchParams.get('session');
}
const sentMessages = () => calls.filter((c) => c.url.includes('/me/messages') && c.method === 'POST');

describe('Tester: kết nối Facebook Page', () => {
  let admin1;
  let admin2;
  let staffNone;
  let staffView;
  let staffManageOnly;
  const logs = [];
  const realConsole = { error: console.error, log: console.log, warn: console.warn };

  before(async () => {
    await connectDB('memory');
    ({ server, io } = createApp());
    await new Promise((resolve) => server.listen(0, resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    globalThis.fetch = (url, opts) => (String(url).startsWith('https://graph.facebook.com') ? fakeGraph(url, opts) : realFetch(url, opts));
    const passwordHash = await hashPassword('matkhau-123');
    await User.create({ username: 't-ad1', role: 'admin', passwordHash });
    await User.create({ username: 't-ad2', role: 'admin', passwordHash });
    await User.create({ username: 't-none', role: 'staff', permissions: ['orders.view'], passwordHash });
    await User.create({ username: 't-view', role: 'staff', permissions: ['channels.view'], passwordHash });
    await User.create({ username: 't-manage', role: 'staff', permissions: ['channels.manage'], passwordHash });
    admin1 = await tokenOf('t-ad1');
    admin2 = await tokenOf('t-ad2');
    staffNone = await tokenOf('t-none');
    staffView = await tokenOf('t-view');
    staffManageOnly = await tokenOf('t-manage');
  });
  after(async () => {
    globalThis.fetch = realFetch;
    Date.now = realDateNow;
    Object.assign(console, realConsole);
    io.close();
    await disconnectDB();
  });
  beforeEach(async () => {
    Date.now = realDateNow;
    Object.assign(console, realConsole);
    logs.length = 0;
    _resetOAuthMemory();
    resetGraph();
    await MetaPage.deleteMany({});
    Object.assign(config.meta, { appId: 'APP', appSecret: APP_SECRET, oauthRedirectUri: 'http://localhost/api/meta/oauth/callback', pageAccessToken: '' });
  });
  const captureLogs = () => {
    const push = (...a) => logs.push(a.map((x) => (x instanceof Error ? `${x.message}\n${x.stack}` : typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' '));
    console.error = push;
    console.log = push;
    console.warn = push;
  };
  const releaseLogs = () => Object.assign(console, realConsole);

  // ---------- (6) Quyền ----------
  describe('quyền channels.view / channels.manage', () => {
    const routes = [
      ['GET', '/api/admin/meta/pages', 'channels.view'],
      ['POST', '/api/admin/meta/oauth/start', 'channels.manage'],
      ['GET', '/api/admin/meta/oauth/sessions/abc', 'channels.manage'],
      ['POST', '/api/admin/meta/pages', 'channels.manage'],
      ['DELETE', '/api/admin/meta/pages/111', 'channels.manage'],
    ];
    it('không đăng nhập thì 401 ở mọi route', async () => {
      for (const [m, p] of routes) assert.equal((await call(m, p)).status, 401, `${m} ${p}`);
    });
    it('staff không có quyền nào thì 403 ở mọi route', async () => {
      for (const [m, p] of routes) assert.equal((await call(m, p, { token: staffNone, body: m === 'POST' ? {} : undefined })).status, 403, `${m} ${p}`);
    });
    it('chỉ channels.view: xem được, mọi route manage bị 403', async () => {
      assert.equal((await call('GET', '/api/admin/meta/pages', { token: staffView })).status, 200);
      for (const [m, p, perm] of routes) {
        if (perm !== 'channels.manage') continue;
        assert.equal((await call(m, p, { token: staffView, body: m === 'POST' ? {} : undefined })).status, 403, `${m} ${p}`);
      }
    });
    it('chỉ channels.manage: GET /meta/pages bị 403, start được 200', async () => {
      assert.equal((await call('GET', '/api/admin/meta/pages', { token: staffManageOnly })).status, 403);
      assert.equal((await call('POST', '/api/admin/meta/oauth/start', { token: staffManageOnly })).status, 200);
    });
    it('403 không làm lộ hay thay đổi dữ liệu: DELETE bởi người chỉ có view không xoá Page', async () => {
      await MetaPage.create({ pageId: '111', name: 'P', accessToken: TOK1 });
      assert.equal((await call('DELETE', '/api/admin/meta/pages/111', { token: staffView })).status, 403);
      assert.equal(await MetaPage.countDocuments({ pageId: '111' }), 1);
    });
    it('callback có rate limit: lần thứ 31 từ cùng IP bị 429', async () => {
      const statuses = [];
      for (let i = 0; i < 31; i += 1) statuses.push((await callback('error=access_denied', '10.99.99.99')).status);
      assert.equal(statuses.slice(0, 30).every((s) => s === 302), true);
      assert.equal(statuses[30], 429);
    });
    it('callback công khai: không cần JWT', async () => {
      const r = await callback('error=access_denied');
      assert.equal(r.status, 302);
    });
  });

  // ---------- (5) State OAuth ----------
  describe('state OAuth', () => {
    it('state sai, thiếu, dạng mảng, thiếu code đều bị từ chối (error=state)', async () => {
      assert.match((await callback(`code=${CODE}&state=khong-ton-tai`)).location, /error=state/);
      assert.match((await callback(`code=${CODE}`)).location, /error=state/);
      assert.match((await callback('')).location, /error=state/);
      const s = await newState(admin1);
      assert.match((await callback(`code=${CODE}&state[]=${s}`)).location, /error=state/);
      assert.match((await callback(`code=${CODE}&state=${s}&state=${s}`)).location, /error=state/);
      // state thiếu code: bị từ chối và bị đốt (dùng một lần)
      const s2 = await newState(admin1);
      assert.match((await callback(`state=${s2}`)).location, /error=state/);
      assert.match((await callback(`code=${CODE}&state=${s2}`)).location, /error=state/);
      assert.equal(calls.length, 0, 'không được gọi Graph khi state sai');
    });
    it('state hết hạn sau 10 phút bị từ chối và không gọi Graph', async () => {
      const s = await newState(admin1);
      Date.now = () => realDateNow() + SESSION_TTL_MS + 1000;
      const r = await callback(`code=${CODE}&state=${s}`);
      Date.now = realDateNow;
      assert.match(r.location, /error=state/);
      assert.equal(calls.length, 0);
    });
    it('state chưa hết hạn (9 phút) vẫn dùng được', async () => {
      const s = await newState(admin1);
      Date.now = () => realDateNow() + SESSION_TTL_MS - 60000;
      const r = await callback(`code=${CODE}&state=${s}`);
      Date.now = realDateNow;
      assert.match(r.location, /session=/);
    });
    it('state chỉ dùng một lần kể cả khi lần đầu thất bại ở bước đổi token', async () => {
      const s = await newState(admin1);
      graph.failStep = 3;
      assert.match((await callback(`code=${CODE}&state=${s}`)).location, /error=exchange/);
      graph.failStep = 0;
      assert.match((await callback(`code=${CODE}&state=${s}`)).location, /error=state/);
    });
    it('state bị đốt cả khi người dùng huỷ (error=...)', async () => {
      const s = await newState(admin1);
      assert.match((await callback(`error=access_denied&state=${s}`)).location, /error=cancelled/);
      assert.match((await callback(`code=${CODE}&state=${s}`)).location, /error=state/);
    });
    it('phiên (session) hết hạn sau 10 phút thì GET và POST đều 404', async () => {
      const sessionId = await openSession(admin1);
      Date.now = () => realDateNow() + SESSION_TTL_MS + 1000;
      const g = await call('GET', `/api/admin/meta/oauth/sessions/${sessionId}`, { token: admin1 });
      const p = await call('POST', '/api/admin/meta/pages', { token: admin1, body: { sessionId, pageIds: ['111'] } });
      Date.now = realDateNow;
      assert.equal(g.status, 404);
      assert.equal(p.status, 404);
      assert.equal(await MetaPage.countDocuments(), 0);
    });
    it('người khác không dùng được phiên: GET 404, POST 404 và không lưu gì; người tạo vẫn dùng được sau đó', async () => {
      const sessionId = await openSession(admin1);
      assert.equal((await call('GET', `/api/admin/meta/oauth/sessions/${sessionId}`, { token: admin2 })).status, 404);
      assert.equal((await call('POST', '/api/admin/meta/pages', { token: admin2, body: { sessionId, pageIds: ['111'] } })).status, 404);
      assert.equal(await MetaPage.countDocuments(), 0);
      assert.equal((await call('GET', `/api/admin/meta/oauth/sessions/${sessionId}`, { token: admin1 })).status, 200);
    });
    it('sessionId bịa hoặc sai kiểu', async () => {
      assert.equal((await call('GET', '/api/admin/meta/oauth/sessions/bia-dat', { token: admin1 })).status, 404);
      assert.equal((await call('POST', '/api/admin/meta/pages', { token: admin1, body: { sessionId: 'bia-dat', pageIds: ['111'] } })).status, 404);
    });
    it('Graph lỗi ở bước 3, 4, 5 (HTTP 400 hoặc ném lỗi mạng) đều cho error=exchange', async () => {
      for (const step of [3, 4, 5, -3, -4, -5]) {
        graph.failStep = step;
        const s = await newState(admin1);
        assert.match((await callback(`code=${CODE}&state=${s}`)).location, /error=exchange/, `bước ${step}`);
      }
    });
  });

  // ---------- (1) Log khi lỗi ----------
  describe('log không chứa bí mật', () => {
    it('lỗi đổi token ở mọi bước không ghi token/code/app secret ra log và redirect', async () => {
      captureLogs();
      const seen = [];
      try {
        for (const step of [3, 4, 5, -3, -4, -5]) {
          graph.failStep = step;
          const s = await newState(admin1);
          const r = await callback(`code=${CODE}&state=${s}`);
          seen.push(r.location, r.text);
        }
      } finally {
        releaseLogs();
      }
      assert.ok(logs.length > 0, 'kỳ vọng có ghi log lỗi để vận hành điều tra');
      const blob = [...logs, ...seen].join('\n');
      for (const secret of ALL_SECRETS) assert.ok(!blob.includes(secret), `log/redirect lộ chuỗi bí mật: ${secret}`);
      assert.ok(!/client_secret|fb_exchange_token|access_token=/.test(blob), 'log lộ tên tham số nhạy cảm/URL');
    });
    it('lỗi đăng ký webhook không ghi token ra log', async () => {
      captureLogs();
      try {
        graph.subscribeFail = true;
        const sessionId = await openSession(admin1);
        await call('POST', '/api/admin/meta/pages', { token: admin1, body: { sessionId, pageIds: ['111'] } });
      } finally {
        releaseLogs();
      }
      for (const secret of ALL_SECRETS) assert.ok(!logs.join('\n').includes(secret), `lộ ${secret}`);
    });
    it('gửi tin lỗi 190 không ghi token ra log', async () => {
      await MetaPage.create({ pageId: '111', name: 'P', accessToken: TOK1 });
      graph.messagesStatus = 400;
      graph.messagesBody = { error: { code: 190, message: 'expired' } };
      captureLogs();
      try {
        await handleIncomingMessage({ channel: 'messenger', externalId: 'LOG1', pageId: '111', text: 'gặp nhân viên' });
      } finally {
        releaseLogs();
      }
      for (const secret of ALL_SECRETS) assert.ok(!logs.join('\n').includes(secret), `lộ ${secret}`);
    });
    it('lastError của Page invalid không chứa token', async () => {
      await MetaPage.create({ pageId: '111', name: 'P', accessToken: TOK1 });
      graph.messagesStatus = 400;
      graph.messagesBody = { error: { code: 190, message: 'expired' } };
      await handleIncomingMessage({ channel: 'messenger', externalId: 'LOG2', pageId: '111', text: 'gặp nhân viên' });
      const page = await MetaPage.findOne({ pageId: '111' });
      assert.equal(page.status, 'invalid');
      for (const secret of ALL_SECRETS) assert.ok(!page.lastError.includes(secret));
      const list = await call('GET', '/api/admin/meta/pages', { token: admin1 });
      assert.equal(list.json.pages[0].status, 'invalid');
    });
  });

  // ---------- (4) Không API nào trả token ----------
  describe('không API nào trả token', () => {
    it('quét mọi response sau khi kết nối, kể cả hộp thư và GET danh sách', async () => {
      const sessionId = await openSession(admin1);
      const session = await call('GET', `/api/admin/meta/oauth/sessions/${sessionId}`, { token: admin1 });
      const connect = await call('POST', '/api/admin/meta/pages', { token: admin1, body: { sessionId, pageIds: ['111', '222'] } });
      assert.equal(connect.json.connected.length, 2);
      await handleIncomingMessage({ channel: 'messenger', externalId: 'API1', pageId: '111', text: 'gặp nhân viên' });
      const list = await call('GET', '/api/admin/meta/pages', { token: admin1 });
      const convs = await call('GET', '/api/admin/conversations', { token: admin1 });
      assert.equal(convs.status, 200);
      const convId = (convs.json.items ?? convs.json.conversations ?? convs.json)[0]?._id;
      const detail = convId ? await call('GET', `/api/admin/conversations/${convId}`, { token: admin1 }) : { text: '' };
      const roleFail = await call('GET', '/api/admin/meta/pages', { token: staffNone });
      const callbackRes = await callback(`code=${CODE}&state=x`);
      const blob = [session, connect, list, convs, detail, roleFail].map((r) => r.text).join('\n') + callbackRes.location + callbackRes.text;
      for (const secret of ALL_SECRETS) assert.ok(!blob.includes(secret), `API lộ ${secret}`);
      assert.ok(!/accessToken|access_token/i.test(blob), 'response chứa khoá accessToken');
      // token thật sự đã được lưu (không phải do không lưu nên không lộ)
      assert.equal((await MetaPage.findOne({ pageId: '111' }).select('+accessToken')).accessToken, TOK1);
    });
    it('MetaPage mặc định không select accessToken và toJSON/toObject-JSON không có token', async () => {
      const created = await MetaPage.create({ pageId: '333', name: 'P', accessToken: TOK1 });
      assert.ok(!('accessToken' in created.toJSON()));
      assert.ok(!JSON.stringify(created).includes(TOK1));
      const found = await MetaPage.findOne({ pageId: '333' });
      assert.equal(found.accessToken, undefined);
    });
    it('Page invalid/lastError qua GET cũng không có token; envTokenConfigured chỉ là boolean', async () => {
      config.meta.pageAccessToken = ENV_TOKEN;
      await MetaPage.create({ pageId: '111', name: 'P', accessToken: TOK1, status: 'invalid', lastError: 'x' });
      const r = await call('GET', '/api/admin/meta/pages', { token: admin1 });
      assert.equal(r.json.envTokenConfigured, true);
      assert.ok(!r.text.includes(ENV_TOKEN));
      assert.ok(!r.text.includes(TOK1));
    });
  });

  // ---------- Kiểm tra đầu vào ----------
  describe('kiểm tra đầu vào POST /meta/pages và DELETE', () => {
    it('dữ liệu sai thì 400 (không phải 500) và không gọi Graph', async () => {
      const sessionId = await openSession(admin1);
      const before = calls.length;
      const bad = [
        {},
        { sessionId },
        { sessionId, pageIds: [] },
        { sessionId, pageIds: 'abc' },
        { sessionId, pageIds: ['abc'] },
        { sessionId, pageIds: [111] },
        { sessionId, pageIds: ['1'.repeat(33)] },
        { sessionId: 123, pageIds: ['111'] },
        { sessionId, pageIds: Array.from({ length: 101 }, (_, i) => String(i + 1)) },
      ];
      for (const body of bad) assert.equal((await call('POST', '/api/admin/meta/pages', { token: admin1, body })).status, 400, JSON.stringify(body).slice(0, 80));
      assert.equal(calls.length, before);
      // phiên vẫn dùng được sau các request sai
      assert.equal((await call('POST', '/api/admin/meta/pages', { token: admin1, body: { sessionId, pageIds: ['111'] } })).status, 200);
    });
    it('đúng 100 phần tử thì được chấp nhận (biên)', async () => {
      const sessionId = await openSession(admin1);
      const pageIds = Array.from({ length: 100 }, (_, i) => String(i + 1));
      const r = await call('POST', '/api/admin/meta/pages', { token: admin1, body: { sessionId, pageIds } });
      assert.equal(r.status, 200);
      assert.equal(r.json.connected.length + r.json.failed.length, 100);
    });
    it('pageId không có trong phiên hoặc không có quyền MESSAGING thì vào failed, không lưu', async () => {
      graph.accounts = [{ id: '111', name: 'A', access_token: TOK1, tasks: ['MANAGE'] }];
      const sessionId = await openSession(admin1);
      const r = await call('POST', '/api/admin/meta/pages', { token: admin1, body: { sessionId, pageIds: ['111', '999'] } });
      assert.equal(r.json.connected.length, 0);
      assert.equal(r.json.failed.length, 2);
      assert.equal(await MetaPage.countDocuments(), 0);
      assert.equal(calls.filter((c) => c.url.includes('subscribed_apps')).length, 0);
    });
    it('start khi thiếu appSecret hoặc redirectUri cũng 400', async () => {
      config.meta.appSecret = '';
      assert.equal((await call('POST', '/api/admin/meta/oauth/start', { token: admin1 })).status, 400);
      config.meta.appSecret = APP_SECRET;
      config.meta.oauthRedirectUri = '';
      assert.equal((await call('POST', '/api/admin/meta/oauth/start', { token: admin1 })).status, 400);
    });
    it('url start chứa state ngẫu nhiên khác nhau, scope đúng, và không chứa app secret', async () => {
      const a = (await call('POST', '/api/admin/meta/oauth/start', { token: admin1 })).json.url;
      const b = (await call('POST', '/api/admin/meta/oauth/start', { token: admin1 })).json.url;
      assert.notEqual(new URL(a).searchParams.get('state'), new URL(b).searchParams.get('state'));
      assert.equal(new URL(a).searchParams.get('scope'), 'pages_show_list,pages_messaging,pages_manage_metadata,business_management');
      assert.ok(!a.includes(APP_SECRET));
    });
    it('kết nối lại Page đã có: cập nhật token, đưa về active, xoá lastError', async () => {
      await MetaPage.create({ pageId: '111', name: 'Cũ', accessToken: 'OLD', status: 'invalid', lastError: 'hết hạn' });
      const sessionId = await openSession(admin1);
      const s = await call('GET', `/api/admin/meta/oauth/sessions/${sessionId}`, { token: admin1 });
      assert.equal(s.json.pages.find((p) => p.pageId === '111').connected, true);
      await call('POST', '/api/admin/meta/pages', { token: admin1, body: { sessionId, pageIds: ['111'] } });
      const page = await MetaPage.findOne({ pageId: '111' }).select('+accessToken');
      assert.equal(page.status, 'active');
      assert.equal(page.lastError, '');
      assert.equal(page.accessToken, TOK1);
      assert.equal(await MetaPage.countDocuments(), 1);
    });
    it('/me/accounts phân trang: chỉ đi theo paging.next thuộc graph.facebook.com', async () => {
      let n = 0;
      const prev = graph;
      globalThis.fetch = (url, opts) => {
        const u = String(url);
        if (u.includes('/me/accounts')) {
          calls.push({ url: u, method: 'GET', auth: opts?.headers?.Authorization });
          n += 1;
          return json({ data: [{ id: String(n), name: 'P', access_token: 'T', tasks: ['MESSAGING'] }], paging: { next: 'https://evil.example.com/steal' } });
        }
        return String(url).startsWith('https://graph.facebook.com') ? fakeGraph(url, opts) : realFetch(url, opts);
      };
      try {
        const s = await newState(admin1);
        const r = await callback(`code=${CODE}&state=${s}`);
        assert.match(r.location, /session=/);
      } finally {
        globalThis.fetch = (url, opts) => (String(url).startsWith('https://graph.facebook.com') ? fakeGraph(url, opts) : realFetch(url, opts));
        graph = prev;
      }
      assert.equal(n, 1, 'không được theo paging.next sang domain lạ');
      assert.ok(!calls.some((c) => c.url.includes('evil.example.com')));
    });
    it('DELETE: Page có -> 200 + gọi DELETE subscribed_apps, lần hai 404, định dạng sai 404', async () => {
      await MetaPage.create({ pageId: '111', name: 'P', accessToken: TOK1 });
      assert.equal((await call('DELETE', '/api/admin/meta/pages/111', { token: admin1 })).status, 200);
      assert.ok(calls.some((c) => c.method === 'DELETE' && c.url.includes('/111/subscribed_apps') && c.auth === `Bearer ${TOK1}`));
      assert.equal((await call('DELETE', '/api/admin/meta/pages/111', { token: admin1 })).status, 404);
      assert.equal((await call('DELETE', '/api/admin/meta/pages/1%24ne', { token: admin1 })).status, 404);
    });
    it('DELETE vẫn xoá khi Facebook lỗi mạng (best-effort)', async () => {
      await MetaPage.create({ pageId: '111', name: 'P', accessToken: TOK1 });
      const prev = globalThis.fetch;
      globalThis.fetch = (url, opts) => {
        if (String(url).includes('/subscribed_apps')) throw new Error('mạng đứt');
        return prev(url, opts);
      };
      try {
        assert.equal((await call('DELETE', '/api/admin/meta/pages/111', { token: admin1 })).status, 200);
      } finally {
        globalThis.fetch = prev;
      }
      assert.equal(await MetaPage.countDocuments(), 0);
    });
  });

  // ---------- (2) $set pageId + $setOnInsert ----------
  describe('handleIncomingMessage lưu pageId', () => {
    it('hội thoại mới có pageId: lưu pageId, không lỗi xung đột $set/$setOnInsert', async () => {
      await handleIncomingMessage({ channel: 'messenger', externalId: 'N1', pageId: '111', text: 'gặp nhân viên' });
      const conv = await Conversation.findOne({ channel: 'messenger', externalId: 'N1' });
      assert.equal(conv.pageId, '111');
      assert.equal(await Conversation.countDocuments({ channel: 'messenger', externalId: 'N1' }), 1);
      assert.ok(conv.customer);
    });
    it('hội thoại mới không có pageId: pageId rỗng (mặc định), vẫn tạo bình thường', async () => {
      await handleIncomingMessage({ channel: 'messenger', externalId: 'N2', text: 'gặp nhân viên' });
      const conv = await Conversation.findOne({ channel: 'messenger', externalId: 'N2' });
      assert.ok(conv);
      assert.ok(!conv.pageId);
    });
    it('hội thoại cũ chưa có pageId: tin mới có pageId thì cập nhật, không tạo trùng', async () => {
      await handleIncomingMessage({ channel: 'messenger', externalId: 'N3', text: 'gặp nhân viên' });
      await handleIncomingMessage({ channel: 'messenger', externalId: 'N3', pageId: '222', text: 'xin chào' });
      const convs = await Conversation.find({ channel: 'messenger', externalId: 'N3' });
      assert.equal(convs.length, 1);
      assert.equal(convs[0].pageId, '222');
    });
    it('hội thoại cũ có pageId: tin không có pageId KHÔNG xoá pageId', async () => {
      await handleIncomingMessage({ channel: 'messenger', externalId: 'N4', pageId: '111', text: 'gặp nhân viên' });
      await handleIncomingMessage({ channel: 'messenger', externalId: 'N4', text: 'xin chào' });
      assert.equal((await Conversation.findOne({ channel: 'messenger', externalId: 'N4' })).pageId, '111');
    });
    it('hội thoại cũ: tin có pageId mới thì ghi đè pageId (khách chuyển sang Page khác)', async () => {
      await handleIncomingMessage({ channel: 'messenger', externalId: 'N5', pageId: '111', text: 'gặp nhân viên' });
      await handleIncomingMessage({ channel: 'messenger', externalId: 'N5', pageId: '222', text: 'xin chào' });
      assert.equal((await Conversation.findOne({ channel: 'messenger', externalId: 'N5' })).pageId, '222');
    });
    it('hai tin đồng thời cùng khách mới có pageId: chỉ một hội thoại', async () => {
      await Promise.all([
        handleIncomingMessage({ channel: 'messenger', externalId: 'N6', pageId: '111', text: 'gặp nhân viên' }),
        handleIncomingMessage({ channel: 'messenger', externalId: 'N6', pageId: '111', text: 'gặp nhân viên' }),
      ]);
      assert.equal(await Conversation.countDocuments({ channel: 'messenger', externalId: 'N6' }), 1);
    });
    it('pageId rỗng "" được coi như không có pageId (không ghi đè)', async () => {
      await handleIncomingMessage({ channel: 'messenger', externalId: 'N7', pageId: '111', text: 'gặp nhân viên' });
      await handleIncomingMessage({ channel: 'messenger', externalId: 'N7', pageId: '', text: 'xin chào' });
      assert.equal((await Conversation.findOne({ channel: 'messenger', externalId: 'N7' })).pageId, '111');
    });
    it('parseMetaWebhook: entry.id không phải chuỗi (số/null) thì không có khoá pageId', () => {
      const mk = (id) => ({ object: 'page', entry: [{ id, messaging: [{ sender: { id: 'U' }, message: { mid: 'm', text: 'a' } }] }] });
      assert.equal(parseMetaWebhook(mk('P9'))[0].pageId, 'P9');
      assert.ok(!('pageId' in parseMetaWebhook(mk(123))[0]));
      assert.ok(!('pageId' in parseMetaWebhook(mk(null))[0]));
      const wa = parseMetaWebhook({ object: 'whatsapp_business_account', entry: [{ id: 'W', changes: [{ value: { messages: [{ from: '84', id: 'w', type: 'text', text: { body: 'hi' } }] } }] }] });
      assert.ok(!('pageId' in wa[0]));
    });
  });

  // ---------- (3) Chọn token ----------
  describe('chọn token theo Page, fallback .env', () => {
    it('hai Page dùng đúng token riêng của mình', async () => {
      await MetaPage.create({ pageId: '111', name: 'A', accessToken: TOK1 });
      await MetaPage.create({ pageId: '222', name: 'B', accessToken: TOK2 });
      config.meta.pageAccessToken = ENV_TOKEN;
      await handleIncomingMessage({ channel: 'messenger', externalId: 'T1', pageId: '111', text: 'gặp nhân viên' });
      await handleIncomingMessage({ channel: 'messenger', externalId: 'T2', pageId: '222', text: 'gặp nhân viên' });
      const auths = sentMessages().map((c) => c.auth);
      assert.deepEqual([...new Set(auths)].sort(), [`Bearer ${TOK1}`, `Bearer ${TOK2}`].sort());
      assert.ok(!auths.includes(`Bearer ${ENV_TOKEN}`));
    });
    it('Page chưa kết nối -> dùng token .env', async () => {
      config.meta.pageAccessToken = ENV_TOKEN;
      await handleIncomingMessage({ channel: 'messenger', externalId: 'T3', pageId: '999', text: 'gặp nhân viên' });
      assert.ok(sentMessages().length >= 1);
      assert.ok(sentMessages().every((c) => c.auth === `Bearer ${ENV_TOKEN}`));
    });
    it('Page invalid -> dùng token .env, không dùng token Page cũ', async () => {
      await MetaPage.create({ pageId: '111', name: 'A', accessToken: TOK1, status: 'invalid' });
      config.meta.pageAccessToken = ENV_TOKEN;
      await handleIncomingMessage({ channel: 'messenger', externalId: 'T4', pageId: '111', text: 'gặp nhân viên' });
      assert.ok(sentMessages().length >= 1);
      assert.ok(sentMessages().every((c) => c.auth === `Bearer ${ENV_TOKEN}`));
    });
    it('hội thoại không có pageId -> dùng token .env', async () => {
      await MetaPage.create({ pageId: '111', name: 'A', accessToken: TOK1 });
      config.meta.pageAccessToken = ENV_TOKEN;
      await handleIncomingMessage({ channel: 'messenger', externalId: 'T5', text: 'gặp nhân viên' });
      assert.ok(sentMessages().length >= 1);
      assert.ok(sentMessages().every((c) => c.auth === `Bearer ${ENV_TOKEN}`));
    });
    it('Instagram luôn dùng token .env, kể cả khi pageId trùng Page đã kết nối', async () => {
      await MetaPage.create({ pageId: '111', name: 'A', accessToken: TOK1 });
      config.meta.pageAccessToken = ENV_TOKEN;
      await handleIncomingMessage({ channel: 'instagram', externalId: 'IG1', pageId: '111', text: 'gặp nhân viên' });
      assert.ok(sentMessages().length >= 1);
      assert.ok(sentMessages().every((c) => c.auth === `Bearer ${ENV_TOKEN}`));
      assert.ok(!sentMessages().some((c) => c.auth === `Bearer ${TOK1}`));
    });
    it('Instagram nhận lỗi 190 thì MetaPage trùng pageId vẫn active', async () => {
      await MetaPage.create({ pageId: '111', name: 'A', accessToken: TOK1 });
      config.meta.pageAccessToken = ENV_TOKEN;
      graph.messagesStatus = 400;
      graph.messagesBody = { error: { code: 190, message: 'expired' } };
      await handleIncomingMessage({ channel: 'instagram', externalId: 'IG2', pageId: '111', text: 'gặp nhân viên' });
      assert.equal((await MetaPage.findOne({ pageId: '111' })).status, 'active');
    });
    it('không có token nào (không Page, không .env): không gọi me/messages, hội thoại needsAttention, không ném lỗi', async () => {
      await handleIncomingMessage({ channel: 'messenger', externalId: 'T6', pageId: '999', text: 'gặp nhân viên' });
      assert.equal(sentMessages().length, 0);
      assert.equal((await Conversation.findOne({ channel: 'messenger', externalId: 'T6' })).needsAttention, true);
    });
    it('lỗi 190 với token .env thì KHÔNG đánh dấu Page nào invalid; lỗi khác 190 với token Page cũng không', async () => {
      await MetaPage.create({ pageId: '111', name: 'A', accessToken: TOK1 });
      config.meta.pageAccessToken = ENV_TOKEN;
      graph.messagesStatus = 400;
      graph.messagesBody = { error: { code: 190, message: 'expired' } };
      await handleIncomingMessage({ channel: 'messenger', externalId: 'T7', pageId: '999', text: 'gặp nhân viên' });
      assert.equal((await MetaPage.findOne({ pageId: '111' })).status, 'active');
      graph.messagesBody = { error: { code: 4, message: 'rate' } };
      await handleIncomingMessage({ channel: 'messenger', externalId: 'T8', pageId: '111', text: 'gặp nhân viên' });
      assert.equal((await MetaPage.findOne({ pageId: '111' })).status, 'active');
      assert.equal((await Conversation.findOne({ channel: 'messenger', externalId: 'T8' })).needsAttention, true);
    });
    it('lỗi 190 trả về body không phải JSON thì vẫn không làm sập và không đánh dấu invalid', async () => {
      await MetaPage.create({ pageId: '111', name: 'A', accessToken: TOK1 });
      graph.messagesStatus = 502;
      graph.messagesBody = 'not json';
      await handleIncomingMessage({ channel: 'messenger', externalId: 'T9', pageId: '111', text: 'gặp nhân viên' });
      assert.equal((await MetaPage.findOne({ pageId: '111' })).status, 'active');
      assert.equal((await Conversation.findOne({ channel: 'messenger', externalId: 'T9' })).needsAttention, true);
    });
    it('resolvePageToken: Page active -> page; invalid/không có -> env; pageId undefined -> env; không gì -> null', async () => {
      await MetaPage.create({ pageId: '111', name: 'A', accessToken: TOK1 });
      await MetaPage.create({ pageId: '222', name: 'B', accessToken: TOK2, status: 'invalid' });
      config.meta.pageAccessToken = ENV_TOKEN;
      assert.deepEqual(await resolvePageToken('111'), { token: TOK1, source: 'page' });
      assert.deepEqual(await resolvePageToken('222'), { token: ENV_TOKEN, source: 'env' });
      assert.deepEqual(await resolvePageToken('999'), { token: ENV_TOKEN, source: 'env' });
      assert.deepEqual(await resolvePageToken(undefined), { token: ENV_TOKEN, source: 'env' });
      assert.deepEqual(await resolvePageToken(''), { token: ENV_TOKEN, source: 'env' });
      config.meta.pageAccessToken = '';
      assert.equal(await resolvePageToken('222'), null);
      assert.equal(await resolvePageToken(undefined), null);
      assert.deepEqual(await resolvePageToken('111'), { token: TOK1, source: 'page' });
    });
  });
});
