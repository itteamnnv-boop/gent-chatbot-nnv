import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Kiểm thử hành vi của api() ở client (điều kiện tự đăng xuất khi 401) bằng cách giả lập
// fetch / localStorage / window; không sửa code client, không thêm thư viện.
const apiUrl = pathToFileURL(path.resolve(import.meta.dirname, '../../client/src/api.js')).href;
const { api } = await import(apiUrl);

let store;
let redirects;
const saved = {};

function stubFetch(status, body = {}) {
  globalThis.fetch = async () => ({ status, ok: status >= 200 && status < 300, json: async () => body });
}

describe('client api(): tự đăng xuất khi 401', () => {
  beforeEach(() => {
    for (const k of ['fetch', 'localStorage', 'window']) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    store = new Map([['admin_token', 'tok']]);
    redirects = [];
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { assign: (url) => redirects.push(url) } },
    });
  });
  afterEach(() => {
    for (const k of ['fetch', 'localStorage', 'window']) {
      if (saved[k]) Object.defineProperty(globalThis, k, saved[k]);
      else delete globalThis[k];
    }
  });

  it('401 ở /auth/me: xoá token và chuyển về /admin/login', async () => {
    stubFetch(401, { error: 'het han' });
    await assert.rejects(api('/auth/me'), /het han/);
    assert.equal(store.has('admin_token'), false);
    assert.deepEqual(redirects, ['/admin/login']);
  });

  it('401 ở path /admin...: xoá token và chuyển về /admin/login', async () => {
    stubFetch(401, { error: 'x' });
    await assert.rejects(api('/admin/orders'));
    assert.equal(store.has('admin_token'), false);
    assert.deepEqual(redirects, ['/admin/login']);
  });

  it('lỗi khác 401 ở /auth/me (500, 403): KHÔNG đăng xuất (bắt đúng lỗi thiếu ngoặc cũ)', async () => {
    for (const status of [403, 500]) {
      stubFetch(status, { error: 'loi' });
      await assert.rejects(api('/auth/me'), /loi/);
      assert.equal(store.get('admin_token'), 'tok');
      assert.deepEqual(redirects, []);
    }
  });

  it('401 ở path không phải /admin hay /auth/me (vd /auth/login): không đăng xuất', async () => {
    stubFetch(401, { error: 'Sai tên đăng nhập hoặc mật khẩu' });
    await assert.rejects(api('/auth/login', { method: 'POST', body: {} }), /Sai tên/);
    assert.equal(store.get('admin_token'), 'tok');
    assert.deepEqual(redirects, []);
  });

  it('200 ở /auth/me: trả dữ liệu, giữ token', async () => {
    stubFetch(200, { username: 'a' });
    assert.deepEqual(await api('/auth/me'), { username: 'a' });
    assert.equal(store.get('admin_token'), 'tok');
  });
});
