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
import { PERMISSIONS } from '../src/permissions.js';
import { seedDatabase } from '../src/seedData.js';
import { handleIncomingMessage } from '../src/services/conversationService.js';
import {
  activePromotionsFor,
  discountedPrice,
  isRunning,
  pickBestPromotion,
  promotionState,
  validatePromotionInput,
} from '../src/services/promotionService.js';
import { hashPassword } from '../src/utils/password.js';

let server;
let io;
let base;
const realFetch = globalThis.fetch;
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
  tool_calls: [{ id: `tcall_${(callSeq += 1)}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
});
const say = (content) => ({ role: 'assistant', content });
const toolResult = (client, i) => JSON.parse(client.requests[i].messages.at(-1).content);
const systemPrompt = (client) => client.requests[0].messages[0].content;
const CUSTOMER = { name: 'Trần Thị B', phone: '0912345678', address: '5 Nguyễn Huệ, P. Bến Nghé, Q.1, TP.HCM' };

const DAY = 86400000;
const shared = { description: '', pageIds: [], productScope: 'all', productIds: [], productNames: [] };
const P = (id, extra) => ({ ...shared, id, name: id, scope: 'all', type: 'percent', value: 10, ...extra });

describe('Tester: khuyến mãi', () => {
  let admin;
  let staffView;
  let staffManageOnly;
  let npk;
  let ure;
  let seq = 0;
  const nid = (p) => `${p}-${(seq += 1)}-tester`;
  const addPage = (pageId) => MetaPage.create({ pageId, name: `Page ${pageId}`, accessToken: 'TOK' });
  const promo = (extra = {}) => Promotion.create({ name: 'KM', type: 'percent', value: 10, scope: 'all', productScope: 'all', ...extra });
  const send = (channel, externalId, text, client, pageId) =>
    handleIncomingMessage({ channel, externalId, text, client, ...(pageId ? { pageId } : {}) });

  before(async () => {
    await connectDB('memory');
    await seedDatabase();
    ({ server, io } = createApp());
    await new Promise((r) => server.listen(0, r));
    base = `http://127.0.0.1:${server.address().port}`;
    globalThis.fetch = (url, opts) => (String(url).startsWith('https://graph.facebook.com') ? fakeGraph() : realFetch(url, opts));
    await addPage('111');
    await addPage('222');
    const passwordHash = await hashPassword('matkhau-123');
    await User.create({ username: 'admin-t', role: 'admin', passwordHash });
    await User.create({ username: 'staff-view', role: 'staff', permissions: ['promotions.view'], passwordHash });
    await User.create({ username: 'staff-manage', role: 'staff', permissions: ['promotions.manage'], passwordHash });
    admin = await tokenOf('admin-t');
    staffView = await tokenOf('staff-view');
    staffManageOnly = await tokenOf('staff-manage');
    npk = await Product.findOne({ sku: 'NPK-16168' });
    ure = await Product.findOne({ sku: 'URE-46' });
  });
  after(async () => {
    globalThis.fetch = realFetch;
    io.close();
    await disconnectDB();
  });
  beforeEach(async () => {
    await Promotion.deleteMany({});
    await Product.updateMany({}, { active: true });
  });

  // ---------------- (1) Tính giá ----------------
  describe('tính giá', () => {
    it('percent làm tròn về số nguyên gần nhất', () => {
      assert.equal(discountedPrice(10001, { type: 'percent', value: 50 }), 5001); // 5000.5 -> 5001
      assert.equal(discountedPrice(399000, { type: 'percent', value: 33 }), 267330);
      assert.equal(discountedPrice(1001, { type: 'percent', value: 12.5 }), 876); // 875.875
      assert.ok(Number.isInteger(discountedPrice(12345, { type: 'percent', value: 7.7 })));
    });
    it('không bao giờ âm', () => {
      assert.equal(discountedPrice(1000, { type: 'fixed', value: 1000 }), 0);
      assert.equal(discountedPrice(1000, { type: 'fixed', value: 999999 }), 0);
      assert.equal(discountedPrice(0, { type: 'fixed', value: 5 }), 0);
      assert.ok(discountedPrice(1000, { type: 'percent', value: 100 }) >= 0);
    });
    it('nền là effectivePrice (salePrice) chứ không phải price gốc', () => {
      assert.equal(npk.price, 420000);
      const r = pickBestPromotion(npk, [P('a', { type: 'percent', value: 10 })]);
      assert.equal(r.listPrice, 399000);
      assert.equal(r.price, 359100);
      assert.notEqual(r.price, 378000);
      const r2 = pickBestPromotion(ure, [P('a', { type: 'fixed', value: 50000 })]);
      assert.equal(r2.listPrice, 650000);
      assert.equal(r2.price, 600000);
    });
    it('không cộng dồn: hai chương trình 10% vẫn chỉ giảm 10%', () => {
      const r = pickBestPromotion(npk, [P('a', { scope: 'pages' }), P('b')]);
      assert.equal(r.price, 359100);
    });
    it('chọn giá thấp nhất bất kể thứ tự', () => {
      const a = P('a', { type: 'percent', value: 10 });
      const b = P('b', { type: 'fixed', value: 100000, scope: 'pages' });
      const c = P('c', { type: 'percent', value: 5 });
      for (const list of [[a, b, c], [c, b, a], [b, a, c]]) assert.equal(pickBestPromotion(npk, list).promotion.id, 'b');
      // loại chung rẻ hơn loại riêng thì thắng
      const cheapShared = P('s', { type: 'fixed', value: 200000 });
      const ownSmall = P('o', { type: 'fixed', value: 10000, scope: 'pages' });
      assert.equal(pickBestPromotion(npk, [ownSmall, cheapShared]).promotion.id, 's');
    });
    it('hoà giá thì ưu tiên loại riêng của Page, cùng loại thì id nhỏ', () => {
      const own = P('z-own', { scope: 'pages', type: 'fixed', value: 39900 }); // 399000-39900 = 359100
      const gen = P('a-gen', { scope: 'all', type: 'percent', value: 10 }); // 359100
      assert.equal(pickBestPromotion(npk, [gen, own]).promotion.id, 'z-own');
      assert.equal(pickBestPromotion(npk, [own, gen]).promotion.id, 'z-own');
      const g1 = P('1', { type: 'percent', value: 10 });
      const g2 = P('2', { type: 'fixed', value: 39900 });
      assert.equal(pickBestPromotion(npk, [g2, g1]).promotion.id, '1');
    });
    it('không gắn khuyến mãi khi không giảm được giá', () => {
      const tiny = { _id: 'x', effectivePrice: 1 };
      assert.deepEqual(pickBestPromotion(tiny, [P('a', { type: 'percent', value: 10 })]), { price: 1, listPrice: 1, promotion: null });
      assert.equal(pickBestPromotion(npk, []).promotion, null);
      assert.equal(pickBestPromotion(npk).promotion, null);
    });
    it('chương trình theo danh sách sản phẩm chỉ áp đúng sản phẩm', () => {
      const only = P('a', { productScope: 'products', productIds: [String(npk._id)] });
      assert.equal(pickBestPromotion(npk, [only]).promotion.id, 'a');
      assert.equal(pickBestPromotion(ure, [only]).promotion, null);
      assert.equal(pickBestPromotion(ure, [only]).price, 650000);
    });
  });

  // ---------------- (2) Phạm vi Page ----------------
  describe('phạm vi Page / kênh', () => {
    it('scope pages với nhiều Page; mảng rỗng KHÔNG thành chương trình chung', async () => {
      await promo({ name: 'multi', scope: 'pages', pageIds: ['111', '222'] });
      await promo({ name: 'rong', scope: 'pages', pageIds: [] });
      const names = async (pid) => (await activePromotionsFor(pid)).map((p) => p.name).sort();
      assert.deepEqual(await names('111'), ['multi']);
      assert.deepEqual(await names('222'), ['multi']);
      assert.deepEqual(await names('333'), []);
      assert.deepEqual(await names(''), []);
      assert.deepEqual(await names(undefined), []);
    });
    it('sắp xếp: riêng trước chung; endAt gần trước; null cuối', async () => {
      const now = new Date();
      await promo({ name: 'chung-null' });
      await promo({ name: 'chung-gan', endAt: new Date(now.getTime() + DAY) });
      await promo({ name: 'rieng', scope: 'pages', pageIds: ['111'] });
      assert.deepEqual((await activePromotionsFor('111', now)).map((p) => p.name), ['rieng', 'chung-gan', 'chung-null']);
    });
    it('web, whatsapp, test, instagram chỉ nhận khuyến mãi chung, Page 111 nhận cả riêng', async () => {
      await promo({ name: 'Chung', type: 'fixed', value: 10000 });
      await promo({ name: 'Riêng111', type: 'fixed', value: 99000, scope: 'pages', pageIds: ['111'] });
      const priceVia = async (channel, pageId) => {
        const client = scriptedClient([toolCall('get_product_details', { product_id: 'URE-46' }), say('ok')]);
        await send(channel, nid(channel), 'giá urê', client, pageId);
        return { price: toolResult(client, 1).price, promo: toolResult(client, 1).promotion, prompt: systemPrompt(client) };
      };
      for (const [channel, pageId] of [['web'], ['whatsapp'], ['test'], ['instagram', '17841400000000000']]) {
        const r = await priceVia(channel, pageId);
        assert.equal(r.price, 640000, channel);
        assert.equal(r.promo, 'Chung', channel);
        assert.doesNotMatch(r.prompt, /Riêng111/, channel);
      }
      const fb = await priceVia('messenger', '111');
      assert.equal(fb.price, 551000);
      assert.equal(fb.promo, 'Riêng111');
      assert.match(fb.prompt, /Riêng111/);
      const fb2 = await priceVia('messenger', '222');
      assert.equal(fb2.price, 640000);
      assert.doesNotMatch(fb2.prompt, /Riêng111/);
    });
    it('max_price lọc theo giá sau khuyến mãi', async () => {
      await promo({ name: 'Rẻ', type: 'fixed', value: 100000, productScope: 'products', productIds: [ure._id] });
      const client = scriptedClient([toolCall('search_products', { query: 'ure', max_price: 560000 }), say('ok')]);
      await send('web', nid('w'), 'urê dưới 560k', client);
      const r = toolResult(client, 1);
      const u = r.products?.find((p) => p.sku === 'URE-46');
      assert.ok(u, 'URE-46 (650k - 100k = 550k) phải qua bộ lọc max_price 560k');
      assert.equal(u.price, 550000);
      const client2 = scriptedClient([toolCall('search_products', { query: 'ure', max_price: 560000 }), say('ok')]);
      await Promotion.deleteMany({});
      await send('web', nid('w'), 'urê dưới 560k', client2);
      assert.ok(!(toolResult(client2, 1).products ?? []).some((p) => p.sku === 'URE-46'));
    });
  });

  // ---------------- (3) Thời hạn ----------------
  describe('thời hạn', () => {
    it('biên startAt / endAt trong activePromotionsFor', async () => {
      const now = new Date('2026-10-02T03:00:00.000Z');
      await promo({ name: 'start=now', startAt: now });
      await promo({ name: 'start=now+1ms', startAt: new Date(now.getTime() + 1) });
      await promo({ name: 'end=now', endAt: now });
      await promo({ name: 'end=now+1ms', endAt: new Date(now.getTime() + 1) });
      await promo({ name: 'end=now-1ms', endAt: new Date(now.getTime() - 1) });
      await promo({ name: 'off', active: false });
      await promo({ name: 'cua-so', startAt: new Date(now.getTime() - DAY), endAt: new Date(now.getTime() + DAY) });
      const names = (await activePromotionsFor('', now)).map((p) => p.name).sort();
      assert.deepEqual(names, ['cua-so', 'end=now+1ms', 'start=now'].sort());
    });
    it('isRunning và promotionState nhất quán ở biên', () => {
      const now = new Date('2026-10-02T03:00:00.000Z');
      const mk = (o) => ({ active: true, startAt: null, endAt: null, ...o });
      assert.equal(isRunning(mk({ endAt: now }), now), false);
      assert.equal(promotionState(mk({ endAt: now }), now), 'ended');
      assert.equal(isRunning(mk({ startAt: now }), now), true);
      assert.equal(promotionState(mk({ startAt: now }), now), 'running');
      assert.equal(isRunning(mk({ endAt: new Date(now.getTime() + 1) }), now), true);
      assert.equal(isRunning(mk({ active: false }), now), false);
      assert.equal(promotionState(mk({ active: false, endAt: new Date(now.getTime() - DAY) }), now), 'off');
      assert.equal(promotionState(mk({ startAt: new Date(now.getTime() + 1) }), now), 'scheduled');
      assert.equal(promotionState(mk({}), now), 'running');
    });
    it('chương trình hết hạn không ảnh hưởng giá của hội thoại mới', async () => {
      await promo({ name: 'Hết', type: 'fixed', value: 50000, endAt: new Date(Date.now() - 1000) });
      await promo({ name: 'Chưa', type: 'fixed', value: 50000, startAt: new Date(Date.now() + DAY) });
      const client = scriptedClient([toolCall('get_product_details', { product_id: 'URE-46' }), say('ok')]);
      await send('web', nid('w'), 'giá urê', client);
      assert.equal(toolResult(client, 1).price, 650000);
      assert.doesNotMatch(systemPrompt(client), /# Khuyến mãi đang áp dụng/);
    });
  });

  // ---------------- (4) create_order ----------------
  describe('create_order', () => {
    async function prepare(channel, externalId, pageId, lines) {
      const steps = lines.map(([sku, quantity]) => toolCall('update_cart', { action: 'add', product_id: sku, quantity }));
      steps.push(toolCall('save_customer_info', CUSTOMER), say('Anh xác nhận giúp em?'));
      await send(channel, externalId, 'mua', scriptedClient(steps), pageId);
    }
    const confirm = async (channel, externalId, pageId) => {
      const c = scriptedClient([toolCall('create_order', { customer_confirmed: true }), say('xong')]);
      await send(channel, externalId, 'ok chốt', c, pageId);
      return toolResult(c, 1);
    };

    it('tổng tiền = Σ đơn giá sau KM × số lượng, lưu listPrice/promotion/pageId', async () => {
      await promo({ name: 'NPK -10%', productScope: 'products', productIds: [npk._id], scope: 'pages', pageIds: ['111'] });
      const id = nid('psid');
      await prepare('messenger', id, '111', [['NPK-16168', 3], ['URE-46', 2]]);
      const res = await confirm('messenger', id, '111');
      assert.equal(res.ok, true);
      const order = await Order.findOne({ code: res.order_code });
      assert.equal(order.pageId, '111');
      const npkLine = order.items.find((i) => i.sku === 'NPK-16168');
      const ureLine = order.items.find((i) => i.sku === 'URE-46');
      assert.equal(npkLine.price, 359100);
      assert.equal(npkLine.listPrice, 399000);
      assert.equal(String(npkLine.promotion.name), 'NPK -10%');
      assert.ok(npkLine.promotion.id);
      assert.equal(npkLine.lineTotal, 3 * 359100);
      assert.equal(ureLine.price, 650000);
      assert.equal(ureLine.listPrice, 650000);
      assert.ok(!ureLine.promotion);
      assert.equal(order.subtotal, 3 * 359100 + 2 * 650000);
      assert.equal(order.total, order.subtotal + order.shippingFee);
      assert.equal(res.subtotal, order.subtotal);
      assert.equal(res.total, order.total);
    });

    it('đơn không có khuyến mãi vẫn lưu listPrice = giá, promotion rỗng', async () => {
      const id = nid('web');
      await prepare('web', id, '', [['URE-46', 1]]);
      const res = await confirm('web', id);
      assert.equal(res.ok, true);
      const o = await Order.findOne({ code: res.order_code });
      assert.equal(o.items[0].listPrice, 650000);
      assert.ok(!o.items[0].promotion);
      assert.equal(o.pageId, '');
    });

    it('trừ kho đúng một lần khi chốt thành công', async () => {
      await promo({ type: 'fixed', value: 50000 });
      const before = (await Product.findById(ure._id)).stock;
      const id = nid('web');
      await prepare('web', id, '', [['URE-46', 2]]);
      assert.equal((await Product.findById(ure._id)).stock, before); // thêm giỏ chưa trừ kho
      await confirm('web', id);
      assert.equal((await Product.findById(ure._id)).stock, before - 2);
    });

    it('nhánh trừ kho dùng giá đã kiểm: giá/KM đổi sau bước kiểm giá (lúc trừ kho) không làm đổi giá trên đơn', async () => {
      await promo({ name: 'URE -50k', type: 'fixed', value: 50000, productScope: 'products', productIds: [ure._id] });
      const id = nid('web');
      await prepare('web', id, '', [['URE-46', 2]]);
      const origFn = Product.findOneAndUpdate;
      // giả lập: ngay sau khi trừ kho, tài liệu trả về có giá niêm yết khác (admin vừa sửa giá giữa hai bước)
      Product.findOneAndUpdate = async function (...args) {
        const doc = await origFn.apply(this, args);
        if (doc) doc.price = 1000000;
        return doc;
      };
      let res;
      try {
        res = await confirm('web', id);
      } finally {
        Product.findOneAndUpdate = origFn;
      }
      assert.equal(res.ok, true);
      const o = await Order.findOne({ code: res.order_code });
      assert.equal(o.items[0].price, 600000); // 650000 - 50000, đúng giá khách đã xác nhận
      assert.equal(o.items[0].listPrice, 650000);
      assert.equal(String(o.items[0].promotion.name), 'URE -50k');
      assert.equal(o.items[0].lineTotal, 1200000);
      assert.equal(o.subtotal, 1200000);
      assert.equal(res.subtotal, 1200000);
    });

    for (const channel of ['web', 'messenger', 'test']) {
      it(`đổi KM giữa chừng (tắt) không tạo đơn, không trừ kho; xác nhận lại thì chốt giá mới (kênh ${channel})`, async () => {
        const pageId = channel === 'messenger' ? '111' : '';
        const km = await promo({ name: 'Sắp đổi', type: 'fixed', value: 50000 });
        const id = nid(channel);
        await prepare(channel, id, pageId, [['URE-46', 2]]);
        await Promotion.updateOne({ _id: km._id }, { value: 100000 }); // đổi mức giảm
        const stock = (await Product.findById(ure._id)).stock;
        const orders = await Order.countDocuments();

        const r1 = await confirm(channel, id, pageId);
        assert.match(r1.error, /Giá đã thay đổi/);
        assert.equal(r1.ok, undefined);
        assert.equal(r1.test_mode, undefined);
        assert.equal(r1.cart.items[0].price, 550000);
        assert.equal(r1.cart.subtotal, 2 * 550000);
        assert.equal(await Order.countDocuments(), orders);
        assert.equal((await Product.findById(ure._id)).stock, stock);
        const conv = await Conversation.findOne({ channel, externalId: id });
        assert.equal(conv.cart[0].price, 550000);

        const r2 = await confirm(channel, id, pageId); // lượt xác nhận lại
        assert.equal(r2.ok, true);
        assert.equal(r2.subtotal, 2 * 550000);
        if (channel === 'test') {
          assert.equal(r2.test_mode, true);
          assert.equal(await Order.countDocuments(), orders);
        } else {
          assert.equal(await Order.countDocuments(), orders + 1);
          assert.equal((await Product.findById(ure._id)).stock, stock - 2);
        }
      });
    }

    it('KM hết hạn theo endAt giữa chừng cũng chặn đơn', async () => {
      const km = await promo({ name: 'Hết giờ', type: 'fixed', value: 50000, endAt: new Date(Date.now() + 3600000) });
      const id = nid('web');
      await prepare('web', id, '', [['URE-46', 1]]);
      await Promotion.updateOne({ _id: km._id }, { endAt: new Date(Date.now() - 1) });
      const orders = await Order.countDocuments();
      const r = await confirm('web', id);
      assert.match(r.error, /Giá đã thay đổi/);
      assert.equal(await Order.countDocuments(), orders);
    });

    it('KM mới xuất hiện giữa chừng (giá rẻ hơn) cũng buộc khách xác nhận lại', async () => {
      const id = nid('web');
      await prepare('web', id, '', [['URE-46', 1]]);
      await promo({ type: 'fixed', value: 50000 });
      const r = await confirm('web', id);
      assert.match(r.error, /Giá đã thay đổi/);
      assert.equal(r.cart.items[0].price, 600000);
    });

    it('dòng giỏ cũ không có listPrice/promotion: giá khớp thì chốt bình thường', async () => {
      const id = nid('web');
      await prepare('web', id, '', [['URE-46', 1]]);
      await Conversation.collection.updateOne(
        { channel: 'web', externalId: id },
        { $unset: { 'cart.0.listPrice': '', 'cart.0.promotion': '' } },
      );
      const raw = await Conversation.collection.findOne({ channel: 'web', externalId: id });
      assert.equal(raw.cart[0].listPrice, undefined);
      const r = await confirm('web', id);
      assert.equal(r.ok, true, JSON.stringify(r));
      const o = await Order.findOne({ code: r.order_code });
      assert.equal(o.items[0].listPrice, 650000);
      assert.equal(o.subtotal, 650000);
    });

    it('dòng giỏ cũ không có listPrice và giá cũ lệch giá hiện tại thì báo đổi giá', async () => {
      const id = nid('web');
      await prepare('web', id, '', [['URE-46', 1]]);
      await Conversation.collection.updateOne(
        { channel: 'web', externalId: id },
        { $set: { 'cart.0.price': 600000 }, $unset: { 'cart.0.listPrice': '', 'cart.0.promotion': '' } },
      );
      const orders = await Order.countDocuments();
      const r = await confirm('web', id);
      assert.match(r.error, /Giá đã thay đổi/);
      assert.equal(r.cart.items[0].price, 650000);
      assert.equal(await Order.countDocuments(), orders);
    });

    it('describeCart hiện original_price và (KM: ...) khi có khuyến mãi, không có thì bỏ', async () => {
      await promo({ name: 'Hiển thị', type: 'fixed', value: 50000 });
      const client = scriptedClient([toolCall('update_cart', { action: 'add', product_id: 'URE-46', quantity: 1 }), say('ok')]);
      await send('web', nid('w'), 'mua', client);
      const cart = toolResult(client, 1).cart;
      assert.equal(cart.items[0].original_price, 650000);
      assert.equal(cart.items[0].promotion, 'Hiển thị');
      assert.match(cart.display, /\(KM: Hiển thị\)/);
      await Promotion.deleteMany({});
      const c2 = scriptedClient([toolCall('update_cart', { action: 'add', product_id: 'URE-46', quantity: 1 }), say('ok')]);
      await send('web', nid('w'), 'mua', c2);
      const cart2 = toolResult(c2, 1).cart;
      assert.equal(cart2.items[0].original_price, undefined);
      assert.doesNotMatch(cart2.display, /KM:/);
    });

    it('thất bại: sản phẩm bị tắt giữa chừng thì không tạo đơn, không trừ kho', async () => {
      const id = nid('web');
      await prepare('web', id, '', [['URE-46', 1]]);
      await Product.updateOne({ _id: ure._id }, { active: false });
      const stock = (await Product.findById(ure._id)).stock;
      const orders = await Order.countDocuments();
      const r = await confirm('web', id);
      assert.match(r.error, /không còn bán/);
      assert.equal(await Order.countDocuments(), orders);
      assert.equal((await Product.findById(ure._id)).stock, stock);
    });

    it('thất bại: khách chưa xác nhận hoặc giỏ trống thì không tạo đơn', async () => {
      await promo({ type: 'fixed', value: 50000 });
      const id = nid('web');
      await prepare('web', id, '', [['URE-46', 1]]);
      const orders = await Order.countDocuments();
      const c = scriptedClient([toolCall('create_order', { customer_confirmed: false }), say('ok')]);
      await send('web', id, 'chờ', c);
      assert.ok(toolResult(c, 1).error);
      assert.equal(await Order.countDocuments(), orders);
    });
  });

  // ---------------- (5) validatePromotionInput + API ----------------
  describe('validatePromotionInput (hàm)', () => {
    const ok = { name: 'A', type: 'percent', value: 10 };
    it('POST: các thông báo lỗi chính xác', async () => {
      const err = async (extra, existing = null) => (await validatePromotionInput({ ...ok, ...extra }, existing)).error;
      assert.equal(await err({ name: '   ' }), 'Tên chương trình 1–120 ký tự');
      assert.equal(await err({ name: 'x'.repeat(121) }), 'Tên chương trình 1–120 ký tự');
      assert.equal(await err({ name: 123 }), 'Tên chương trình 1–120 ký tự');
      assert.equal(await err({ description: 'x'.repeat(1001) }), 'Mô tả tối đa 1000 ký tự');
      assert.equal(await err({ description: 5 }), 'Mô tả tối đa 1000 ký tự');
      assert.equal(await err({ type: 'bogo' }), 'Loại giảm giá không hợp lệ');
      assert.equal(await err({ value: '10' }), 'Mức giảm không hợp lệ');
      assert.equal(await err({ value: null }), 'Mức giảm không hợp lệ');
      assert.equal(await err({ value: NaN }), 'Mức giảm không hợp lệ');
      assert.equal(await err({ value: Infinity }), 'Mức giảm không hợp lệ');
      assert.equal(await err({ value: -5 }), 'Mức giảm không hợp lệ');
      assert.equal(await err({ type: 'fixed', value: 0 }), 'Mức giảm không hợp lệ');
      assert.equal(await err({ scope: 'bogus' }), 'Phải chọn ít nhất một Page hợp lệ');
      assert.equal(await err({ scope: 'pages', pageIds: ['abc'] }), 'Phải chọn ít nhất một Page hợp lệ');
      assert.equal(await err({ scope: 'pages', pageIds: 111 }), 'Phải chọn ít nhất một Page hợp lệ');
      assert.equal(await err({ scope: 'pages', pageIds: [111] }), 'Phải chọn ít nhất một Page hợp lệ');
      assert.equal(await err({ scope: 'pages', pageIds: ['111', '999'] }), 'Phải chọn ít nhất một Page hợp lệ');
      assert.equal(await err({ productScope: 'bogus' }), 'Phải chọn ít nhất một sản phẩm hợp lệ');
      assert.equal(await err({ productScope: 'products', productIds: [] }), 'Phải chọn ít nhất một sản phẩm hợp lệ');
      assert.equal(await err({ startAt: 'khong-phai-ngay' }), 'Thời gian không hợp lệ');
      assert.equal(await err({ endAt: 12345 }), 'Thời gian không hợp lệ');
      assert.equal(await err({ startAt: '2026-06-01T00:00:00Z', endAt: '2026-06-01T00:00:00Z' }), 'Thời gian kết thúc phải sau thời gian bắt đầu');
      assert.equal(await err({ active: 'yes' }), 'Trạng thái không hợp lệ');
      assert.equal(await err({ active: 1 }), 'Trạng thái không hợp lệ');
    });
    it('POST hợp lệ: chuẩn hoá dữ liệu', async () => {
      const { data, error } = await validatePromotionInput({
        name: '  Tên  ', type: 'percent', value: 100, scope: 'pages', pageIds: ['111', '111', '222'],
        productScope: 'all', productIds: [String(npk._id)], startAt: '', endAt: null, extra: 'bo-qua',
      });
      assert.equal(error, undefined);
      assert.equal(data.name, 'Tên');
      assert.deepEqual(data.pageIds, ['111', '222']);
      assert.deepEqual(data.productIds, []);
      assert.equal(data.startAt, null);
      assert.equal(data.endAt, null);
      assert.equal(data.active, true);
      assert.equal(data.extra, undefined);
      const all = await validatePromotionInput({ ...ok, scope: 'all', pageIds: ['111'] });
      assert.deepEqual(all.data.pageIds, []);
    });
    it('PUT gộp với bản ghi cũ', async () => {
      const old = await promo({ name: 'Cũ', type: 'percent', value: 12.5, scope: 'all' });
      // đổi type sang fixed trong khi value cũ 12.5 không nguyên -> lỗi
      assert.equal((await validatePromotionInput({ type: 'fixed' }, old)).error, 'Mức giảm không hợp lệ');
      // chỉ sửa value vượt 100 trên percent cũ
      assert.equal((await validatePromotionInput({ value: 150 }, old)).error, 'Mức giảm không hợp lệ');
      // đổi sang fixed kèm value hợp lệ
      assert.equal((await validatePromotionInput({ type: 'fixed', value: 5000 }, old)).data.type, 'fixed');
      // chuyển sang pages mà chưa có pageIds -> lỗi, không thành chung
      assert.equal((await validatePromotionInput({ scope: 'pages' }, old)).error, 'Phải chọn ít nhất một Page hợp lệ');
      // chỉ gửi name: các trường khác giữ nguyên
      const keep = (await validatePromotionInput({ name: 'Mới' }, old)).data;
      assert.equal(keep.value, 12.5);
      assert.equal(keep.type, 'percent');
      assert.equal(keep.scope, 'all');
    });
    it('PUT: endAt so với startAt cũ; startAt cũ so với endAt mới', async () => {
      const old = await promo({ startAt: new Date('2026-06-10T00:00:00Z'), endAt: new Date('2026-06-20T00:00:00Z') });
      assert.equal((await validatePromotionInput({ endAt: '2026-06-09T00:00:00Z' }, old)).error, 'Thời gian kết thúc phải sau thời gian bắt đầu');
      assert.equal((await validatePromotionInput({ startAt: '2026-06-21T00:00:00Z' }, old)).error, 'Thời gian kết thúc phải sau thời gian bắt đầu');
      assert.equal((await validatePromotionInput({ endAt: null }, old)).data.endAt, null);
      assert.ok((await validatePromotionInput({ startAt: '2026-06-01T00:00:00Z' }, old)).data);
    });
    it('PUT: Page đã ngắt kết nối được giữ, Page mới không tồn tại bị từ chối', async () => {
      const old = await promo({ scope: 'pages', pageIds: ['777'] }); // 777 không có trong MetaPage
      const kept = await validatePromotionInput({ name: 'Đổi tên' }, old);
      assert.deepEqual(kept.data.pageIds, ['777']);
      const added = await validatePromotionInput({ pageIds: ['777', '222'] }, old);
      assert.deepEqual(added.data.pageIds, ['777', '222']);
      assert.equal((await validatePromotionInput({ pageIds: ['777', '888'] }, old)).error, 'Phải chọn ít nhất một Page hợp lệ');
      assert.equal((await validatePromotionInput({ pageIds: ['888'] }, old)).error, 'Phải chọn ít nhất một Page hợp lệ');
      assert.equal((await validatePromotionInput({ ...{ name: 'N', type: 'percent', value: 5 }, scope: 'pages', pageIds: ['777'] })).error, 'Phải chọn ít nhất một Page hợp lệ');
    });
    it('PUT: productScope đổi về all thì xoá productIds', async () => {
      const old = await promo({ productScope: 'products', productIds: [npk._id] });
      const d = (await validatePromotionInput({ productScope: 'all' }, old)).data;
      assert.deepEqual(d.productIds, []);
      const keep = (await validatePromotionInput({ name: 'x' }, old)).data;
      assert.deepEqual(keep.productIds, [String(npk._id)]);
    });
  });

  // ---------------- (6) Quyền ----------------
  describe('quyền', () => {
    const valid = { name: 'Q', type: 'percent', value: 10 };
    it('permissions.js có 2 quyền mới', () => {
      const keys = PERMISSIONS.map((p) => p.key);
      assert.ok(keys.includes('promotions.view'));
      assert.ok(keys.includes('promotions.manage'));
      assert.equal(keys.length, 17);
    });
    it('không token: 401 cho cả 4 route', async () => {
      const id = String(new mongoose.Types.ObjectId());
      assert.equal((await call('GET', '/api/admin/promotions')).status, 401);
      assert.equal((await call('POST', '/api/admin/promotions', { body: valid })).status, 401);
      assert.equal((await call('PUT', `/api/admin/promotions/${id}`, { body: valid })).status, 401);
      assert.equal((await call('DELETE', `/api/admin/promotions/${id}`)).status, 401);
    });
    it('token rác: 401', async () => {
      assert.equal((await call('GET', '/api/admin/promotions', { token: 'rac.rac.rac' })).status, 401);
    });
    it('chỉ có view: GET 200, POST/PUT/DELETE 403 và không đổi dữ liệu', async () => {
      const doc = await promo({ name: 'Giữ' });
      assert.equal((await call('GET', '/api/admin/promotions', { token: staffView })).status, 200);
      assert.equal((await call('POST', '/api/admin/promotions', { token: staffView, body: valid })).status, 403);
      assert.equal((await call('PUT', `/api/admin/promotions/${doc._id}`, { token: staffView, body: { name: 'Sửa' } })).status, 403);
      assert.equal((await call('DELETE', `/api/admin/promotions/${doc._id}`, { token: staffView })).status, 403);
      assert.equal((await Promotion.findById(doc._id)).name, 'Giữ');
      assert.equal(await Promotion.countDocuments(), 1);
    });
    it('chỉ có manage (không view): GET 403, POST 201', async () => {
      assert.equal((await call('GET', '/api/admin/promotions', { token: staffManageOnly })).status, 403);
      assert.equal((await call('POST', '/api/admin/promotions', { token: staffManageOnly, body: valid })).status, 201);
    });
    it('GET /meta/pages cần channels.view, không lộ token', async () => {
      assert.equal((await call('GET', '/api/admin/meta/pages', { token: staffView })).status, 403);
      const r = await call('GET', '/api/admin/meta/pages', { token: admin });
      assert.equal(r.status, 200);
      assert.ok(!r.text.includes('TOK'));
    });
  });

  describe('API CRUD', () => {
    const valid = { name: 'API', type: 'percent', value: 10 };
    it('id sai định dạng hoặc không tồn tại: 404; PUT không tồn tại không tạo mới', async () => {
      assert.equal((await call('PUT', '/api/admin/promotions/khong-hop-le', { token: admin, body: valid })).status, 404);
      assert.equal((await call('DELETE', '/api/admin/promotions/khong-hop-le', { token: admin })).status, 404);
      const id = new mongoose.Types.ObjectId();
      assert.equal((await call('PUT', `/api/admin/promotions/${id}`, { token: admin, body: valid })).status, 404);
      assert.equal(await Promotion.countDocuments(), 0);
    });
    it('PUT lỗi validate: 400, bản ghi không đổi', async () => {
      const doc = await promo({ name: 'Nguyên vẹn', value: 10 });
      const r = await call('PUT', `/api/admin/promotions/${doc._id}`, { token: admin, body: { value: 101 } });
      assert.equal(r.status, 400);
      assert.equal(r.json.error, 'Mức giảm không hợp lệ');
      assert.equal((await Promotion.findById(doc._id)).value, 10);
    });
    it('POST không cho ghi đè createdBy; bật/tắt active qua PUT; state phản ánh', async () => {
      const c = await call('POST', '/api/admin/promotions', { token: admin, body: { ...valid, createdBy: 'hacker' } });
      assert.equal(c.status, 201);
      assert.equal(c.json.createdBy, 'admin-t');
      const off = await call('PUT', `/api/admin/promotions/${c.json._id}`, { token: admin, body: { active: false } });
      assert.equal(off.json.state, 'off');
      const sched = await call('PUT', `/api/admin/promotions/${c.json._id}`, {
        token: admin, body: { active: true, startAt: new Date(Date.now() + DAY).toISOString() },
      });
      assert.equal(sched.json.state, 'scheduled');
    });
    it('Page đã ngắt: PUT giữ pageIds; sau khi nối lại thì chương trình hoạt động lại', async () => {
      const doc = await promo({ scope: 'pages', pageIds: ['222'], name: 'Riêng 222' });
      await MetaPage.deleteOne({ pageId: '222' });
      try {
        // ngắt kết nối nhưng chưa ai nhắn từ 222 -> vẫn lọc đúng theo pageId
        assert.equal((await activePromotionsFor('222')).length, 1);
        const put = await call('PUT', `/api/admin/promotions/${doc._id}`, { token: admin, body: { value: 15 } });
        assert.equal(put.status, 200);
        assert.deepEqual(put.json.pageIds, ['222']);
        const list = await call('GET', '/api/admin/promotions', { token: admin });
        assert.ok(!list.json.pages.some((p) => p.pageId === '222'));
        assert.equal(list.json.promotions[0].pageIds[0], '222');
        const mp = await call('GET', '/api/admin/meta/pages', { token: admin });
        assert.ok(!mp.json.pages.some((p) => p.pageId === '222'));
        const post = await call('POST', '/api/admin/promotions', { token: admin, body: { ...valid, scope: 'pages', pageIds: ['222'] } });
        assert.equal(post.status, 400);
      } finally {
        await addPage('222');
      }
      const mp2 = await call('GET', '/api/admin/meta/pages', { token: admin });
      assert.equal(mp2.json.pages.find((p) => p.pageId === '222').promotionCount, 1);
    });
    it('promotionCount: chỉ đếm chương trình bật và chưa hết hạn (gồm sắp chạy), không đếm tắt/hết hạn/chung', async () => {
      await promo({ scope: 'pages', pageIds: ['111'] });
      await promo({ scope: 'pages', pageIds: ['111'], startAt: new Date(Date.now() + DAY) });
      await promo({ scope: 'pages', pageIds: ['111'], active: false });
      await promo({ scope: 'pages', pageIds: ['111'], endAt: new Date(Date.now() - DAY) });
      await promo({ scope: 'pages', pageIds: ['111', '222'] });
      await promo({ scope: 'all' });
      const r = await call('GET', '/api/admin/meta/pages', { token: admin });
      const count = (id) => r.json.pages.find((p) => p.pageId === id).promotionCount;
      assert.equal(count('111'), 3);
      assert.equal(count('222'), 1);
    });
  });

  // ---------------- (7) Prompt ----------------
  describe('prompt', () => {
    it('có quy tắc không tự trừ thêm khuyến mãi và quy tắc báo giá đổi', async () => {
      const client = scriptedClient([say('xin chào')]);
      await send('web', nid('w'), 'hi', client);
      const p = systemPrompt(client);
      assert.match(p, /không tự trừ thêm/);
      assert.match(p, /create_order báo giá đã thay đổi/);
      assert.match(p, /Không hứa giảm giá/);
    });
    it('giá trong giỏ chỉ trừ khuyến mãi một lần dù đọc qua nhiều tool', async () => {
      await promo({ name: 'Một lần', type: 'percent', value: 10 });
      const client = scriptedClient([
        toolCall('search_products', { query: 'ure' }),
        toolCall('update_cart', { action: 'add', product_id: 'URE-46', quantity: 1 }),
        toolCall('view_cart', {}),
        say('ok'),
      ]);
      await send('web', nid('w'), 'mua urê', client);
      const found = toolResult(client, 1).products.find((p) => p.sku === 'URE-46');
      assert.equal(found.price, 585000);
      assert.equal(toolResult(client, 2).cart.items[0].price, 585000);
      assert.equal(toolResult(client, 3).items[0].price, 585000);
      assert.equal(toolResult(client, 3).subtotal, 585000);
    });
    it('mục khuyến mãi: định dạng percent/fixed, không thời hạn, tối đa 20 dòng, cắt 10 tên sản phẩm', async () => {
      await promo({ name: 'PCT', type: 'percent', value: 10, description: 'Mô tả-xyz' });
      await promo({ name: 'FIX', type: 'fixed', value: 50000, endAt: new Date(Date.now() + DAY) });
      let client = scriptedClient([say('hi')]);
      await send('web', nid('w'), 'hi', client);
      let p = systemPrompt(client);
      assert.match(p, /- PCT: giảm 10%; áp dụng: tất cả sản phẩm; không thời hạn\. Mô tả-xyz/);
      assert.match(p, /- FIX: giảm .*50.*\/sản phẩm; áp dụng: tất cả sản phẩm; đến /);

      await Promotion.deleteMany({});
      for (let i = 0; i < 25; i += 1) await promo({ name: `KM-so-${String(i).padStart(2, '0')}` });
      client = scriptedClient([say('hi')]);
      await send('web', nid('w'), 'hi', client);
      p = systemPrompt(client);
      const section = p.split('# Khuyến mãi đang áp dụng cho khách này')[1].split('\n# ')[0];
      assert.equal(section.split('\n').filter((l) => l.startsWith('- KM-so-')).length, 20);

      await Promotion.deleteMany({});
      const many = [];
      for (let i = 0; i < 12; i += 1) {
        many.push(await Product.create({ sku: `T-${i}`, name: `SanPhamTest${i}`, category: 'x', price: 1000, stock: 5, unit: 'cái', description: 'd' }));
      }
      await promo({ name: 'NHIEU', productScope: 'products', productIds: many.map((m) => m._id) });
      client = scriptedClient([say('hi')]);
      await send('web', nid('w'), 'hi', client);
      const line = systemPrompt(client).split('\n').find((l) => l.startsWith('- NHIEU'));
      assert.ok(line.includes('…'));
      assert.equal((line.match(/SanPhamTest\d+/g) ?? []).length, 10);
      await Product.deleteMany({ sku: /^T-\d+$/ });
    });
  });
});
