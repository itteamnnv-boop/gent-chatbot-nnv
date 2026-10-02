import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { connectDB, disconnectDB } from '../src/db.js';
import { User } from '../src/models/User.js';
import { PERMISSION_KEYS } from '../src/permissions.js';
import { ensureBootstrapAdmin } from '../src/services/userService.js';
import { hashPassword, verifyPassword } from '../src/utils/password.js';

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
  return { status: res.status, text, json: text ? JSON.parse(text) : null };
}

const login = (username, password) => call('POST', '/api/auth/login', { body: { username, password } });
const tokenOf = async (username, password) => (await login(username, password)).json.token;
const FAKE_ID = '64b7f0f0f0f0f0f0f0f0f0f0';

describe('Quản lý người dùng & phân quyền', () => {
  let adminToken;
  let adminId;
  let staff;
  let staffToken;

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

  it('hashPassword/verifyPassword', async () => {
    const stored = await hashPassword('matkhau-123');
    assert.equal(await verifyPassword('matkhau-123', stored), true);
    assert.equal(await verifyPassword('sai-mat-khau', stored), false);
    assert.equal(await verifyPassword('x', 'khong-dung-dinh-dang'), false);
    assert.equal(await verifyPassword('x', ''), false);
    assert.equal(await verifyPassword('x', undefined), false);
  });

  it('ensureBootstrapAdmin chỉ tạo khi DB trống', async () => {
    const first = await ensureBootstrapAdmin();
    assert.equal(first.role, 'admin');
    assert.equal(await User.countDocuments(), 1);
    assert.equal(await ensureBootstrapAdmin(), null);
    adminId = String(first._id);
  });

  it('đăng nhập', async () => {
    const ok = await login(config.admin.username, config.admin.password);
    assert.equal(ok.status, 200);
    assert.ok(ok.json.token);
    assert.equal(ok.json.user.permissions.length, 17);
    assert.deepEqual(ok.json.user.permissions, PERMISSION_KEYS);
    adminToken = ok.json.token;

    const wrong = await login(config.admin.username, 'sai-mat-khau');
    assert.equal(wrong.status, 401);
    const missing = await login('khong-ton-tai', config.admin.password);
    assert.equal(missing.status, 401);
    assert.equal(missing.json.error, wrong.json.error);

    await User.create({ username: 'bi-khoa', role: 'staff', active: false, passwordHash: await hashPassword('matkhau-123') });
    assert.equal((await login('bi-khoa', 'matkhau-123')).status, 403);
  });

  it('không token / token rác -> 401', async () => {
    assert.equal((await call('GET', '/api/admin/orders')).status, 401);
    assert.equal((await call('GET', '/api/admin/orders', { token: 'rac' })).status, 401);
  });

  it('staff chỉ có orders.view', async () => {
    staff = await User.create({ username: 'nv1', role: 'staff', permissions: ['orders.view'], passwordHash: await hashPassword('matkhau-123') });
    staffToken = await tokenOf('nv1', 'matkhau-123');
    assert.equal((await call('GET', '/api/admin/orders', { token: staffToken })).status, 200);
    assert.equal((await call('PATCH', `/api/admin/orders/${FAKE_ID}`, { token: staffToken, body: { note: 'x' } })).status, 403);
    assert.equal((await call('GET', '/api/admin/users', { token: staffToken })).status, 403);
  });

  it('khoá staff -> token cũ bị 401', async () => {
    const r = await call('PUT', `/api/admin/users/${staff._id}`, { token: adminToken, body: { active: false } });
    assert.equal(r.status, 200);
    assert.equal((await call('GET', '/api/admin/orders', { token: staffToken })).status, 401);
    await call('PUT', `/api/admin/users/${staff._id}`, { token: adminToken, body: { active: true } });
  });

  it('đổi mật khẩu staff -> token cũ 401, mật khẩu mới đăng nhập được', async () => {
    const token = await tokenOf('nv1', 'matkhau-123');
    assert.equal((await call('GET', '/api/admin/orders', { token })).status, 200);
    const r = await call('PUT', `/api/admin/users/${staff._id}`, { token: adminToken, body: { password: 'matkhau-moi-1' } });
    assert.equal(r.status, 200);
    assert.equal((await call('GET', '/api/admin/orders', { token })).status, 401);
    assert.equal((await login('nv1', 'matkhau-123')).status, 401);
    assert.equal((await login('nv1', 'matkhau-moi-1')).status, 200);
  });

  it('admin không tự xoá / tự hạ vai trò', async () => {
    const del = await call('DELETE', `/api/admin/users/${adminId}`, { token: adminToken });
    assert.equal(del.status, 400);
    const put = await call('PUT', `/api/admin/users/${adminId}`, { token: adminToken, body: { role: 'staff' } });
    assert.equal(put.status, 400);
  });

  it('staff có users.manage bị giới hạn', async () => {
    await User.create({
      username: 'quanly',
      role: 'staff',
      permissions: ['users.manage'],
      passwordHash: await hashPassword('matkhau-123'),
    });
    const token = await tokenOf('quanly', 'matkhau-123');
    const me = (await call('GET', '/api/auth/me', { token })).json;

    const createAdmin = await call('POST', '/api/admin/users', {
      token,
      body: { username: 'admin2', password: 'matkhau-123', role: 'admin' },
    });
    assert.equal(createAdmin.status, 403);
    assert.equal((await call('PUT', `/api/admin/users/${adminId}`, { token, body: { displayName: 'x' } })).status, 403);
    const self = await call('PUT', `/api/admin/users/${me._id}`, { token, body: { permissions: ['users.manage', 'orders.update'] } });
    assert.equal(self.status, 400);
    const createStaff = await call('POST', '/api/admin/users', { token, body: { username: 'nv2', password: 'matkhau-123' } });
    assert.equal(createStaff.status, 201);
  });

  it('kiểm tra dữ liệu đầu vào', async () => {
    const dup = await call('POST', '/api/admin/users', { token: adminToken, body: { username: 'NV1', password: 'matkhau-123' } });
    assert.equal(dup.status, 409);
    const perm = await call('POST', '/api/admin/users', {
      token: adminToken,
      body: { username: 'nv3', password: 'matkhau-123', permissions: ['foo.bar'] },
    });
    assert.equal(perm.status, 400);
    const pw = await call('POST', '/api/admin/users', { token: adminToken, body: { username: 'nv3', password: '1234567' } });
    assert.equal(pw.status, 400);
  });

  it('response không chứa passwordHash', async () => {
    const list = await call('GET', '/api/admin/users', { token: adminToken });
    assert.equal(list.status, 200);
    assert.ok(list.json.length >= 3);
    const created = await call('POST', '/api/admin/users', {
      token: adminToken,
      body: { username: 'nv4', password: 'matkhau-123', permissions: ['orders.view'] },
    });
    const updated = await call('PUT', `/api/admin/users/${created.json._id}`, { token: adminToken, body: { displayName: 'Bốn' } });
    for (const r of [list, created, updated]) {
      assert.ok(!r.text.includes('passwordHash'));
      assert.ok(!r.text.includes('tokenVersion'));
    }
  });
});
