import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { connectDB, disconnectDB } from '../src/db.js';
import { User } from '../src/models/User.js';
import { countOtherActiveAdmins } from '../src/services/userService.js';
import { hashPassword } from '../src/utils/password.js';

let server;
let io;
let base;

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}
const tokenOf = async (username) =>
  (await call('POST', '/api/auth/login', { body: { username, password: 'matkhau-123' } })).json.token;
const mk = async (username, extra = {}) =>
  User.create({ username, role: 'admin', passwordHash: await hashPassword('matkhau-123'), ...extra });

const SELF_LOCK = 'Không thể xoá, khoá hoặc đổi quyền tài khoản của chính bạn';
const LAST_ADMIN = 'Phải còn ít nhất một quản trị viên đang hoạt động';

describe('Chốt an toàn: phải còn ít nhất một admin hoạt động', () => {
  before(async () => {
    await connectDB('memory');
    ({ server, io } = createApp());
    await new Promise((resolve) => server.listen(0, resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    io.close();
    await disconnectDB();
  });

  it('countOtherActiveAdmins chỉ đếm admin đang hoạt động, bỏ qua id loại trừ', async () => {
    const a = await mk('qt-a');
    assert.equal(await countOtherActiveAdmins(a._id), 0);
    const b = await mk('qt-b');
    await mk('qt-khoa', { active: false });
    await mk('qt-staff', { role: 'staff' });
    assert.equal(await countOtherActiveAdmins(a._id), 1);
    assert.equal(await countOtherActiveAdmins(b._id), 1);
    await User.deleteMany({});
  });

  it('admin duy nhất không tự xoá / khoá / hạ vai trò được (400, chưa lộ LAST_ADMIN vì chặn tự thao tác trước)', async () => {
    const a = await mk('solo');
    const token = await tokenOf('solo');
    const del = await call('DELETE', `/api/admin/users/${a._id}`, { token });
    assert.equal(del.status, 400);
    assert.equal(del.json.error, SELF_LOCK);
    const lock = await call('PUT', `/api/admin/users/${a._id}`, { token, body: { active: false } });
    assert.equal(lock.status, 400);
    const demote = await call('PUT', `/api/admin/users/${a._id}`, { token, body: { role: 'staff', permissions: ['orders.view'] } });
    assert.equal(demote.status, 400);
    assert.equal(await User.countDocuments({ role: 'admin', active: true }), 1);
    await User.deleteMany({});
  });

  it('active không phải boolean bị từ chối (400), admin duy nhất không bị khoá bằng {active: "false"}', async () => {
    const a = await mk('kieu-active');
    const token = await tokenOf('kieu-active');
    const put = await call('PUT', `/api/admin/users/${a._id}`, { token, body: { active: 'false' } });
    assert.equal(put.status, 400);
    assert.equal((await User.findById(a._id)).active, true);
    const post = await call('POST', '/api/admin/users', { token, body: { username: 'kieu-moi', password: 'matkhau-123', active: 'false' } });
    assert.equal(post.status, 400);
    assert.equal(await User.exists({ username: 'kieu-moi' }), null);
    await User.deleteMany({});
  });

  it('có hai admin: admin này được khoá, hạ vai trò, xoá admin kia; admin cuối còn lại không tự xoá được', async () => {
    const a = await mk('hai-a');
    const b = await mk('hai-b');
    const c = await mk('hai-c');
    const token = await tokenOf('hai-a');

    const lock = await call('PUT', `/api/admin/users/${b._id}`, { token, body: { active: false } });
    assert.equal(lock.status, 200);
    assert.equal(lock.json.active, false);

    const demote = await call('PUT', `/api/admin/users/${c._id}`, { token, body: { role: 'staff' } });
    assert.equal(demote.status, 200);
    assert.equal(demote.json.role, 'staff');

    // b đã khoá nên không còn tính là admin hoạt động; xoá b vẫn được
    const delB = await call('DELETE', `/api/admin/users/${b._id}`, { token });
    assert.equal(delB.status, 200);

    // còn đúng 1 admin hoạt động (a): không tự xoá được
    const delSelf = await call('DELETE', `/api/admin/users/${a._id}`, { token });
    assert.equal(delSelf.status, 400);
    assert.ok([SELF_LOCK, LAST_ADMIN].includes(delSelf.json.error));
    assert.equal(await User.countDocuments({ role: 'admin', active: true }), 1);
    await User.deleteMany({});
  });

  it('staff có users.manage không thể xoá/khoá/hạ admin duy nhất (403)', async () => {
    const a = await mk('chot-a');
    await mk('chot-qly', { role: 'staff', permissions: ['users.manage'] });
    const token = await tokenOf('chot-qly');
    assert.equal((await call('DELETE', `/api/admin/users/${a._id}`, { token })).status, 403);
    assert.equal((await call('PUT', `/api/admin/users/${a._id}`, { token, body: { active: false } })).status, 403);
    assert.equal((await call('PUT', `/api/admin/users/${a._id}`, { token, body: { role: 'staff' } })).status, 403);
    assert.equal(await User.countDocuments({ role: 'admin', active: true }), 1);
    await User.deleteMany({});
  });

  it('admin hạ chính admin khác xuống staff rồi không còn ai ngoài mình: DB luôn giữ >= 1 admin hoạt động', async () => {
    const a = await mk('luon-a');
    const b = await mk('luon-b');
    const token = await tokenOf('luon-a');
    assert.equal((await call('PUT', `/api/admin/users/${b._id}`, { token, body: { role: 'staff' } })).status, 200);
    assert.equal((await call('PUT', `/api/admin/users/${a._id}`, { token, body: { role: 'staff' } })).status, 400);
    assert.ok((await User.countDocuments({ role: 'admin', active: true })) >= 1);
    await User.deleteMany({});
  });
});
