import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { connectDB, disconnectDB } from '../src/db.js';
import { Conversation } from '../src/models/Conversation.js';
import { MetaPage } from '../src/models/MetaPage.js';
import { Order } from '../src/models/Order.js';
import { Product } from '../src/models/Product.js';
import { Promotion } from '../src/models/Promotion.js';
import { User } from '../src/models/User.js';
import { seedDatabase } from '../src/seedData.js';
import { handleIncomingMessage } from '../src/services/conversationService.js';
import { activePromotionsFor, discountedPrice, pickBestPromotion, promotionState } from '../src/services/promotionService.js';
import { hashPassword } from '../src/utils/password.js';

let server;
let io;
let base;
const realFetch = globalThis.fetch;

// Graph giả: Messenger gửi tin xong trả 200, không gọi API thật
const fakeGraph = () => new Response('{}', { status: 200 });

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

// OpenAI client giả: trả lời theo kịch bản, ghi lại request để kiểm tra
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
let callSeq = 0;
const toolCall = (name, args) => ({
  role: 'assistant',
  content: null,
  tool_calls: [{ id: `call_${(callSeq += 1)}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
});
const say = (content) => ({ role: 'assistant', content });

const toolResult = (client, requestIndex) => JSON.parse(client.requests[requestIndex].messages.at(-1).content);
const systemPrompt = (client) => client.requests[0].messages[0].content;

const CUSTOMER = { name: 'Nguyễn Văn A', phone: '0901234567', address: '12 Lê Lợi, P. Bến Thành, Q.1, TP.HCM' };

describe('Khuyến mãi', () => {
  let admin;
  let staffNone;
  let staffView;
  let npk;
  let ure;
  let seq = 0;
  const newId = (prefix) => `${prefix}-${(seq += 1)}-promo-test`;

  const addPage = (pageId) => MetaPage.create({ pageId, name: `Page ${pageId}`, accessToken: 'TOK' });
  const promo = (extra = {}) =>
    Promotion.create({ name: 'KM', type: 'percent', value: 10, scope: 'all', productScope: 'all', ...extra });
  const send = (channel, externalId, text, client, pageId) => handleIncomingMessage({ channel, externalId, text, client, ...(pageId ? { pageId } : {}) });

  before(async () => {
    await connectDB('memory');
    await seedDatabase();
    ({ server, io } = createApp());
    await new Promise((resolve) => server.listen(0, resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    globalThis.fetch = (url, opts) => (String(url).startsWith('https://graph.facebook.com') ? fakeGraph() : realFetch(url, opts));
    await addPage('111');
    await addPage('222');
    const passwordHash = await hashPassword('matkhau-123');
    await User.create({ username: 'admin1', role: 'admin', passwordHash });
    await User.create({ username: 'nv-none', role: 'staff', permissions: ['orders.view'], passwordHash });
    await User.create({ username: 'nv-view', role: 'staff', permissions: ['promotions.view'], passwordHash });
    admin = await tokenOf('admin1');
    staffNone = await tokenOf('nv-none');
    staffView = await tokenOf('nv-view');
    npk = await Product.findOne({ sku: 'NPK-16168' });
    ure = await Product.findOne({ sku: 'URE-46' });
  });
  after(async () => {
    globalThis.fetch = realFetch;
    io.close();
    await disconnectDB();
  });
  beforeEach(() => Promotion.deleteMany({}));

  describe('hàm thuần', () => {
    it('discountedPrice', () => {
      assert.equal(discountedPrice(399000, { type: 'percent', value: 10 }), 359100);
      assert.equal(discountedPrice(399000, { type: 'fixed', value: 50000 }), 349000);
      assert.equal(discountedPrice(399000, { type: 'fixed', value: 500000 }), 0);
      assert.equal(discountedPrice(399000, { type: 'percent', value: 100 }), 0);
    });

    it('pickBestPromotion: không cộng dồn, chọn giá thấp nhất, hoà thì ưu tiên loại riêng', () => {
      const product = { _id: 'p1', effectivePrice: 399000 };
      const base = { description: '', pageIds: [], productScope: 'all', productIds: [], productNames: [] };
      const shared = { ...base, id: 'a', name: 'Chung', scope: 'all', type: 'percent', value: 10 };
      const own = { ...base, id: 'b', name: 'Riêng', scope: 'pages', type: 'fixed', value: 100000 };
      assert.deepEqual(pickBestPromotion(product, [shared, own]), { price: 299000, listPrice: 399000, promotion: { id: 'b', name: 'Riêng' } });

      const ownTie = { ...base, id: 'c', name: 'Riêng hoà', scope: 'pages', type: 'percent', value: 10 };
      assert.equal(pickBestPromotion(product, [shared, ownTie]).promotion.name, 'Riêng hoà');
      assert.equal(pickBestPromotion(product, [ownTie, shared]).promotion.name, 'Riêng hoà');

      const other = { ...shared, productScope: 'products', productIds: ['p2'] };
      assert.deepEqual(pickBestPromotion(product, [other]), { price: 399000, listPrice: 399000, promotion: null });
      assert.equal(pickBestPromotion({ _id: npk._id, effectivePrice: npk.effectivePrice }, []).listPrice, 399000);
    });

    it('promotionState đủ 4 trạng thái', () => {
      const now = new Date('2026-06-01T00:00:00Z');
      const day = 86400000;
      assert.equal(promotionState({ active: false }, now), 'off');
      assert.equal(promotionState({ active: true, startAt: new Date(now.getTime() + day) }, now), 'scheduled');
      assert.equal(promotionState({ active: true, endAt: now }, now), 'ended');
      assert.equal(promotionState({ active: true, startAt: new Date(now.getTime() - day), endAt: new Date(now.getTime() + day) }, now), 'running');
    });
  });

  it('activePromotionsFor lọc theo Page và thời gian', async () => {
    const now = new Date();
    const day = 86400000;
    await promo({ name: 'chung' });
    await promo({ name: 'p111', scope: 'pages', pageIds: ['111'] });
    await promo({ name: 'p222', scope: 'pages', pageIds: ['222'] });
    await promo({ name: 'tat', active: false });
    await promo({ name: 'chua-toi', startAt: new Date(now.getTime() + day) });
    await promo({ name: 'het-han', endAt: new Date(now.getTime() - day) });
    await promo({ name: 'dung-luc-het', endAt: now });

    const names = async (pageId) => (await activePromotionsFor(pageId, now)).map((p) => p.name);
    assert.deepEqual(await names('111'), ['p111', 'chung']);
    assert.deepEqual(await names('222'), ['p222', 'chung']);
    assert.deepEqual(await names(''), ['chung']);
  });

  describe('API', () => {
    const valid = { name: 'Giảm 10%', type: 'percent', value: 10 };

    it('phân quyền promotions.view / promotions.manage', async () => {
      assert.equal((await call('GET', '/api/admin/promotions', { token: staffNone })).status, 403);
      assert.equal((await call('GET', '/api/admin/promotions', { token: staffView })).status, 200);
      assert.equal((await call('POST', '/api/admin/promotions', { token: staffView, body: valid })).status, 403);
    });

    it('POST 400 với đúng thông báo cho từng lỗi', async () => {
      const post = async (extra) => (await call('POST', '/api/admin/promotions', { token: admin, body: { ...valid, ...extra } })).json.error;
      const noPage = 'Phải chọn ít nhất một Page hợp lệ';
      const noProduct = 'Phải chọn ít nhất một sản phẩm hợp lệ';
      assert.equal(await post({ value: 0 }), 'Mức giảm không hợp lệ');
      assert.equal(await post({ value: 101 }), 'Mức giảm không hợp lệ');
      assert.equal(await post({ type: 'fixed', value: 1.5 }), 'Mức giảm không hợp lệ');
      assert.equal(await post({ scope: 'pages', pageIds: [] }), noPage);
      assert.equal(await post({ scope: 'pages', pageIds: ['999'] }), noPage);
      assert.equal(await post({ productScope: 'products', productIds: ['abc'] }), noProduct);
      assert.equal(await post({ productScope: 'products', productIds: [String(new mongoose.Types.ObjectId())] }), noProduct);
      assert.equal(
        await post({ startAt: '2026-06-02T00:00:00Z', endAt: '2026-06-01T00:00:00Z' }),
        'Thời gian kết thúc phải sau thời gian bắt đầu',
      );
      assert.equal(await Promotion.countDocuments(), 0);
    });

    it('tạo, sửa, xoá; GET trả pages (không có token) và products', async () => {
      const created = await call('POST', '/api/admin/promotions', {
        token: admin,
        body: { ...valid, scope: 'pages', pageIds: ['111'], productScope: 'products', productIds: [String(npk._id)] },
      });
      assert.equal(created.status, 201);
      assert.equal(created.json.createdBy, 'admin1');
      assert.deepEqual(created.json.pageIds, ['111']);
      const id = created.json._id;

      const updated = await call('PUT', `/api/admin/promotions/${id}`, { token: admin, body: { value: 20, scope: 'all' } });
      assert.equal(updated.status, 200);
      assert.equal(updated.json.value, 20);
      assert.deepEqual(updated.json.pageIds, []);

      const list = await call('GET', '/api/admin/promotions', { token: admin });
      assert.equal(list.json.promotions.length, 1);
      assert.equal(list.json.promotions[0].state, 'running');
      assert.deepEqual(list.json.pages.map((p) => p.pageId).sort(), ['111', '222']);
      assert.ok(!list.text.includes('TOK'));
      assert.ok(list.json.products.some((p) => p.sku === 'NPK-16168' && p.effectivePrice === 399000));

      assert.equal((await call('DELETE', `/api/admin/promotions/${id}`, { token: admin })).status, 200);
      assert.equal((await call('DELETE', `/api/admin/promotions/${id}`, { token: admin })).status, 404);
    });

    it('Page bị ngắt kết nối: chương trình cũ vẫn sửa được và giữ pageId, tạo mới thì bị từ chối', async () => {
      const doc = await promo({ scope: 'pages', pageIds: ['111'] });
      await MetaPage.deleteOne({ pageId: '111' });
      try {
        const put = await call('PUT', `/api/admin/promotions/${doc._id}`, { token: admin, body: { name: 'Tên mới' } });
        assert.equal(put.status, 200);
        assert.deepEqual(put.json.pageIds, ['111']);
        const post = await call('POST', '/api/admin/promotions', { token: admin, body: { ...valid, scope: 'pages', pageIds: ['111'] } });
        assert.equal(post.status, 400);
      } finally {
        await addPage('111');
      }
    });

    it('GET /meta/pages có promotionCount đúng', async () => {
      await promo({ scope: 'pages', pageIds: ['111'] });
      await promo({ name: 'chung' });
      const res = await call('GET', '/api/admin/meta/pages', { token: admin });
      const count = (pageId) => res.json.pages.find((p) => p.pageId === pageId).promotionCount;
      assert.equal(count('111'), 1);
      assert.equal(count('222'), 0);
    });
  });

  describe('AI agent', () => {
    it('khuyến mãi riêng của Page 111 hiện trong kết quả tool và system prompt, Page 222 thì không', async () => {
      await promo({ name: 'Giảm 10% NPK', scope: 'pages', pageIds: ['111'], productScope: 'products', productIds: [npk._id] });

      const c1 = scriptedClient([toolCall('search_products', { query: 'phan bon cho lua' }), say('ok')]);
      await send('messenger', newId('psid'), 'phân bón cho lúa', c1, '111');
      const found = toolResult(c1, 1).products.find((p) => p.sku === 'NPK-16168');
      assert.equal(found.price, 359100);
      assert.equal(found.original_price, 420000);
      assert.equal(found.promotion, 'Giảm 10% NPK');
      assert.match(systemPrompt(c1), /# Khuyến mãi đang áp dụng/);
      assert.match(systemPrompt(c1), /Giảm 10% NPK/);

      const c2 = scriptedClient([toolCall('search_products', { query: 'phan bon cho lua' }), say('ok')]);
      await send('messenger', newId('psid'), 'phân bón cho lúa', c2, '222');
      const other = toolResult(c2, 1).products.find((p) => p.sku === 'NPK-16168');
      assert.equal(other.price, 399000);
      assert.equal(other.promotion, undefined);
      assert.doesNotMatch(systemPrompt(c2), /# Khuyến mãi đang áp dụng/);
    });

    async function buy(channel, externalId, pageId, quantity = 2) {
      const client = scriptedClient([
        toolCall('update_cart', { action: 'add', product_id: 'NPK-16168', quantity }),
        toolCall('save_customer_info', CUSTOMER),
        toolCall('create_order', { customer_confirmed: true }),
        say('xong'),
      ]);
      await send(channel, externalId, 'mua', client, pageId);
      return client;
    }

    it('chốt đơn lưu giá sau khuyến mãi, giá gốc, tên khuyến mãi và pageId', async () => {
      await promo({ name: 'Bớt 50k', type: 'fixed', value: 50000 });
      await buy('web', newId('web'), '');
      const web = await Order.findOne({ channel: 'web' }).sort({ createdAt: -1 });
      assert.equal(web.subtotal, 2 * 349000);
      assert.equal(web.items[0].listPrice, 399000);
      assert.equal(web.items[0].promotion.name, 'Bớt 50k');
      assert.equal(web.pageId, '');

      await promo({ name: 'Riêng 10%', scope: 'pages', pageIds: ['111'] });
      await buy('messenger', newId('psid'), '111');
      const fb = await Order.findOne({ channel: 'messenger' }).sort({ createdAt: -1 });
      assert.equal(fb.items[0].price, 349000);
      assert.equal(fb.items[0].promotion.name, 'Bớt 50k');
      assert.equal(fb.pageId, '111');
    });

    it('kênh instagram dù pageId trùng "111" vẫn không nhận KM riêng của Page, đơn có pageId rỗng', async () => {
      await promo({ name: 'Riêng 111', scope: 'pages', pageIds: ['111'] });

      const c1 = scriptedClient([toolCall('search_products', { query: 'phan bon cho lua' }), say('ok')]);
      await send('instagram', newId('igsid'), 'phân bón cho lúa', c1, '111');
      const found = toolResult(c1, 1).products.find((p) => p.sku === 'NPK-16168');
      assert.equal(found.price, 399000);
      assert.equal(found.promotion, undefined);
      assert.doesNotMatch(systemPrompt(c1), /# Khuyến mãi đang áp dụng/);

      await buy('instagram', newId('igsid'), '111');
      const order = await Order.findOne({ channel: 'instagram' }).sort({ createdAt: -1 });
      assert.equal(order.items[0].price, 399000);
      assert.equal(order.items[0].promotion, null);
      assert.equal(order.pageId, '');
    });

    for (const channel of ['web', 'test']) {
      it(`khuyến mãi đổi giữa lúc thêm giỏ và chốt đơn: không tạo đơn, cập nhật giá (kênh ${channel})`, async () => {
        await promo({ name: 'Sắp hết', type: 'fixed', value: 50000 });
        const externalId = newId(channel);
        const first = scriptedClient([
          toolCall('update_cart', { action: 'add', product_id: 'NPK-16168', quantity: 1 }),
          toolCall('save_customer_info', CUSTOMER),
          say('Anh xác nhận giúp em?'),
        ]);
        await send(channel, externalId, 'mua', first);
        let conv = await Conversation.findOne({ channel, externalId });
        assert.equal(conv.cart[0].price, 349000);

        await Promotion.updateMany({}, { active: false });
        const ordersBefore = await Order.countDocuments();
        const stockBefore = (await Product.findById(npk._id)).stock;
        const second = scriptedClient([toolCall('create_order', { customer_confirmed: true }), say('Giá đã đổi ạ')]);
        await send(channel, externalId, 'ok chốt', second);

        const result = toolResult(second, 1);
        assert.match(result.error, /Giá đã thay đổi/);
        assert.equal(result.test_mode, undefined);
        assert.equal(await Order.countDocuments(), ordersBefore);
        assert.equal((await Product.findById(npk._id)).stock, stockBefore);
        conv = await Conversation.findOne({ channel, externalId });
        assert.equal(conv.cart[0].price, 399000);
        assert.equal(conv.cart[0].promotion, null);
      });
    }

    it('kênh test / web (pageId rỗng) không bao giờ nhận khuyến mãi riêng của Page', async () => {
      await promo({ name: 'Riêng 111', scope: 'pages', pageIds: ['111'] });
      for (const channel of ['test', 'web']) {
        const client = scriptedClient([toolCall('get_product_details', { product_id: String(ure._id) }), say('ok')]);
        await send(channel, newId(channel), 'urê giá bao nhiêu', client);
        const result = toolResult(client, 1);
        assert.equal(result.price, 650000);
        assert.equal(result.promotion, undefined);
        assert.doesNotMatch(systemPrompt(client), /# Khuyến mãi đang áp dụng/);
      }
    });
  });
});
