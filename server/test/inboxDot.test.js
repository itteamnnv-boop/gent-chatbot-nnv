import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { connectDB, disconnectDB } from '../src/db.js';
import { signUserToken } from '../src/middleware/auth.js';
import { Conversation } from '../src/models/Conversation.js';
import { Customer } from '../src/models/Customer.js';
import { MetaPage } from '../src/models/MetaPage.js';
import { User } from '../src/models/User.js';
import { seedDatabase } from '../src/seedData.js';
import { hashPassword } from '../src/utils/password.js';

// Nguồn dữ liệu của chấm đỏ Hộp thư ở sidebar: GET /api/admin/inbox/pages.
// Công thức của client (useInboxUnread): otherUnread > 0 || pages.some((p) => p.unread > 0).
// Không gọi OpenAI, không gọi mạng ngoài.

let server;
let io;
let base;
const dot = (r) => (r.otherUnread || 0) > 0 || (r.pages || []).some((p) => p.unread > 0);

async function pagesOf(token) {
  const res = await fetch(`${base}/api/admin/inbox/pages`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

describe('Chấm đỏ Hộp thư: nguồn dữ liệu /inbox/pages', () => {
  const tok = {};
  let seq = 0;

  async function conv(channel, pageId, unreadCount) {
    seq += 1;
    const customer = await Customer.create({ channel, externalId: `dot-${seq}` });
    await Conversation.create({ customer: customer._id, channel, externalId: `dot-${seq}`, ...(pageId === undefined ? {} : { pageId }), unreadCount });
  }

  before(async () => {
    await connectDB('memory');
    await seedDatabase();
    ({ server, io } = createApp());
    await new Promise((r) => server.listen(0, r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    io.close();
    await disconnectDB();
  });

  beforeEach(async () => {
    await Promise.all([Conversation.deleteMany({}), Customer.deleteMany({}), MetaPage.deleteMany({}), User.deleteMany({ username: /^dot-/ })]);
    await MetaPage.create({ pageId: '111', name: 'Một', accessToken: 'T1' });
    await MetaPage.create({ pageId: '222', name: 'Hai', accessToken: 'T2' });
    const passwordHash = await hashPassword('matkhau-123');
    const permissions = ['inbox.view'];
    await User.create({ username: 'dot-admin', role: 'admin', passwordHash });
    await User.create({ username: 'dot-p1', role: 'staff', permissions, passwordHash, inboxScope: 'pages', pageIds: ['111'] });
    await User.create({ username: 'dot-p1o', role: 'staff', permissions, passwordHash, inboxScope: 'pages', pageIds: ['111'], inboxOther: true });
    await User.create({ username: 'dot-noview', role: 'staff', permissions: ['orders.view'], passwordHash, inboxScope: 'pages', pageIds: ['111'] });
    for (const n of ['admin', 'p1', 'p1o', 'noview']) tok[n] = signUserToken(await User.findOne({ username: `dot-${n}` }).lean());
  });

  it('đường thuận lợi: Page được giao có chưa đọc thì bật chấm; đọc hết thì tắt', async () => {
    await conv('messenger', '111', 3);
    assert.equal(dot((await pagesOf(tok.p1)).json), true);
    await Conversation.updateMany({}, { unreadCount: 0 });
    assert.equal(dot((await pagesOf(tok.p1)).json), false);
  });

  it('biên: chưa đọc chỉ ở Page khác, web và hội thoại test thì nhân viên chỉ Page 111 KHÔNG có chấm', async () => {
    await conv('messenger', '222', 5);
    await conv('web', undefined, 4);
    await conv('test', '111', 9);
    await conv('messenger', '111', 0);
    const r = await pagesOf(tok.p1);
    assert.equal(r.status, 200);
    assert.equal(r.json.otherUnread, 0);
    assert.deepEqual(r.json.pages.map((p) => p.pageId), ['111']);
    assert.equal(dot(r.json), false);
  });

  it('biên: nhân viên có thêm "ngoài Fanpage" thì web chưa đọc bật chấm, Page 222 vẫn không tính', async () => {
    await conv('messenger', '222', 5);
    assert.equal(dot((await pagesOf(tok.p1o)).json), false);
    await conv('web', undefined, 1);
    assert.equal(dot((await pagesOf(tok.p1o)).json), true);
  });

  it('admin không giới hạn: chưa đọc ở Page nào cũng bật chấm', async () => {
    await conv('messenger', '222', 1);
    assert.equal(dot((await pagesOf(tok.admin)).json), true);
  });

  it('phải thất bại: không có inbox.view thì 403 (client không gọi, nếu gọi cũng không lộ số liệu); không token thì 401', async () => {
    await conv('messenger', '111', 3);
    const r = await pagesOf(tok.noview);
    assert.equal(r.status, 403);
    assert.equal(r.json.pages, undefined);
    assert.equal((await pagesOf(null)).status, 401);
  });
});
