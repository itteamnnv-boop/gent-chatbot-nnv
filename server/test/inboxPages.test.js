import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { connectDB, disconnectDB } from '../src/db.js';
import { Conversation } from '../src/models/Conversation.js';
import { Customer } from '../src/models/Customer.js';
import { MetaPage } from '../src/models/MetaPage.js';
import { User } from '../src/models/User.js';
import { seedDatabase } from '../src/seedData.js';
import { hashPassword } from '../src/utils/password.js';

// Kiểm thử lọc Hộp thư theo Page và /inbox/pages (người xem không bị giới hạn Page).

let server;
let io;
let base;
const realFetch = globalThis.fetch;

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

describe('Hộp thư theo Page', () => {
  let admin;
  let seq = 0;
  const ids = {};

  async function make(key, channel, pageId, extra = {}) {
    seq += 1;
    const externalId = `ip-${seq}`;
    const customer = await Customer.create({ channel, externalId });
    const c = await Conversation.create({ customer: customer._id, channel, externalId, ...(pageId === undefined ? {} : { pageId }), ...extra });
    ids[key] = String(c._id);
    return c;
  }
  const list = async (qs = '', token = admin) => call('GET', `/api/admin/conversations${qs}`, { token });
  const keysOf = (res) => Object.entries(ids).filter(([, id]) => res.json.some((c) => String(c._id) === id)).map(([k]) => k).sort();

  before(async () => {
    await connectDB('memory');
    await seedDatabase();
    ({ server, io } = createApp());
    await new Promise((r) => server.listen(0, r));
    base = `http://127.0.0.1:${server.address().port}`;
    globalThis.fetch = (url, opts) => {
      if (/^https?:\/\/127\.0\.0\.1/.test(String(url))) return realFetch(url, opts);
      return Promise.reject(new Error(`Chặn request ra ngoài: ${url}`));
    };
    const passwordHash = await hashPassword('matkhau-123');
    await User.create({ username: 'ip-admin', role: 'admin', passwordHash });
    await User.create({ username: 'ip-chan', role: 'staff', permissions: ['channels.view'], passwordHash });
    await User.create({ username: 'ip-inbox', role: 'staff', permissions: ['inbox.view'], passwordHash });
    admin = await tokenOf('ip-admin');
  });
  after(async () => {
    globalThis.fetch = realFetch;
    io.close();
    await disconnectDB();
  });
  beforeEach(async () => {
    await Conversation.deleteMany({});
    await Customer.deleteMany({});
    await MetaPage.deleteMany({});
    await MetaPage.create({ pageId: '111', name: 'Page Một', accessToken: 'SECRET-TOK-1' });
    await MetaPage.create({ pageId: '222', name: 'Page Hai', accessToken: 'SECRET-TOK-2', botEnabled: false });
    for (const k of Object.keys(ids)) delete ids[k];
    await make('m111', 'messenger', '111', { unreadCount: 3, mode: 'human', needsAttention: true });
    await make('m111b', 'messenger', '111');
    await make('m222', 'messenger', '222');
    await make('mNone', 'messenger');
    await make('ig111', 'instagram', '111');
    await make('web', 'web');
    await make('wa', 'whatsapp');
    await make('test', 'test', '111', { unreadCount: 5 });
  });

  it('?page=111 chỉ trả Messenger 111', async () => {
    const res = await list('?page=111');
    assert.equal(res.status, 200);
    assert.deepEqual(keysOf(res), ['m111', 'm111b']);
  });

  it('?page=none trả hội thoại ngoài Fanpage, không có Messenger có pageId và test', async () => {
    assert.deepEqual(keysOf(await list('?page=none')), ['ig111', 'mNone', 'wa', 'web']);
  });

  it('page không hợp lệ trả 400; page rỗng như không lọc', async () => {
    for (const qs of ['?page=abc', '?page=111&page=222', `?page=${'1'.repeat(33)}`]) {
      assert.equal((await list(qs)).status, 400, qs);
    }
    assert.deepEqual(keysOf(await list('?page=')), keysOf(await list('')));
    assert.ok(!keysOf(await list('')).includes('test'));
  });

  it('kết hợp với mode và attention', async () => {
    assert.deepEqual(keysOf(await list('?page=111&mode=human')), ['m111']);
    assert.deepEqual(keysOf(await list('?page=111&attention=1')), ['m111']);
    assert.deepEqual(keysOf(await list('?page=222&mode=human')), []);
  });

  it('Page không có trong MetaPage nhưng có hội thoại vẫn lọc được', async () => {
    await make('m999', 'messenger', '999');
    assert.deepEqual(keysOf(await list('?page=999')), ['m999']);
  });

  it('/inbox/pages: 401, 403, 200 theo quyền', async () => {
    assert.equal((await call('GET', '/api/admin/inbox/pages')).status, 401);
    assert.equal((await call('GET', '/api/admin/inbox/pages', { token: await tokenOf('ip-chan') })).status, 403);
    assert.equal((await call('GET', '/api/admin/inbox/pages', { token: await tokenOf('ip-inbox') })).status, 200);
  });

  it('/inbox/pages: unread theo hội thoại, botEnabled, không lộ token', async () => {
    const res = await call('GET', '/api/admin/inbox/pages', { token: admin });
    assert.doesNotMatch(res.text, /accessToken|SECRET/);
    assert.equal(res.json.restricted, false);
    assert.equal(res.json.canSeeOther, true);
    const p = (id) => res.json.pages.find((x) => x.pageId === id);
    assert.equal(p('111').unread, 1); // 3 tin chưa đọc chỉ tính 1 hội thoại (Instagram và test không tính)
    assert.equal(p('222').unread, 0);
    assert.equal(p('111').botEnabled, true);
    assert.equal(p('222').botEnabled, false);
    assert.equal(p('111').connected, true);
  });

  it('/inbox/pages: Page đã ngắt kết nối mà còn hội thoại nằm cuối với connected=false', async () => {
    await make('m999', 'messenger', '999', { unreadCount: 2 });
    const pages = (await call('GET', '/api/admin/inbox/pages', { token: admin })).json.pages;
    const last = pages[pages.length - 1];
    assert.equal(last.pageId, '999');
    assert.equal(last.connected, false);
    assert.equal(last.name, '');
    assert.equal(last.unread, 1);
  });

  it('/inbox/pages: otherUnread đếm web, instagram, Messenger không pageId; không đếm test', async () => {
    await Conversation.updateMany({ _id: { $in: [ids.web, ids.ig111, ids.mNone] } }, { unreadCount: 1 });
    assert.equal((await call('GET', '/api/admin/inbox/pages', { token: admin })).json.otherUnread, 3);
  });

  it('đọc hội thoại làm unread của Page giảm 1', async () => {
    const unread = async () => (await call('GET', '/api/admin/inbox/pages', { token: admin })).json.pages.find((x) => x.pageId === '111').unread;
    assert.equal(await unread(), 1);
    assert.equal((await call('POST', `/api/admin/conversations/${ids.m111}/read`, { token: admin })).status, 200);
    assert.equal(await unread(), 0);
  });
});
