import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
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
import { hashPassword } from '../src/utils/password.js';

// Kiểm thử hành vi: chọn Page trong Chat thử. Không gọi OpenAI thật: mọi request HTTP hợp lệ đều bị tránh,
// phần agent dùng client giả theo kịch bản.

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
  tool_calls: [{ id: `pg_${(callSeq += 1)}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
});
const say = (content) => ({ role: 'assistant', content });
const toolResult = (client, i) => JSON.parse(client.requests[i].messages.at(-1).content);
const systemPrompt = (client) => client.requests[0].messages[0].content;
const CUSTOMER = { name: 'Lê Văn C', phone: '0987654321', address: '9 Lê Lợi, P. Bến Thành, Q.1, TP.HCM' };

describe('Tester: Chat thử chọn Page', () => {
  let admin;
  let staffPlay;
  let staffNoPlay;
  let seq = 0;
  const sid = (p = 'test') => `${p}-${(seq += 1)}-pgtester`;
  const promo = (extra = {}) => Promotion.create({ name: 'KM', type: 'percent', value: 10, scope: 'all', productScope: 'all', ...extra });
  const send = (channel, externalId, text, client, pageId) =>
    handleIncomingMessage({ channel, externalId, text, client, ...(pageId ? { pageId } : {}) });
  const priceOf = async (channel, pageId) => {
    const client = scriptedClient([toolCall('get_product_details', { product_id: 'URE-46' }), say('ok')]);
    await send(channel, sid(channel), 'giá urê', client, pageId);
    return { price: toolResult(client, 1).price, promotion: toolResult(client, 1).promotion, prompt: systemPrompt(client) };
  };

  before(async () => {
    await connectDB('memory');
    await seedDatabase();
    ({ server, io } = createApp());
    await new Promise((r) => server.listen(0, r));
    base = `http://127.0.0.1:${server.address().port}`;
    // Tuyệt đối không để request ra ngoài (OpenAI/Graph)
    globalThis.fetch = (url, opts) => (/^https?:\/\/127\.0\.0\.1/.test(String(url)) ? realFetch(url, opts) : Promise.reject(new Error(`Chặn request ra ngoài: ${url}`)));
    await MetaPage.create({ pageId: '111', name: 'Page Một', accessToken: 'SECRET-TOK-1', connectedAt: new Date(1000) });
    await MetaPage.create({ pageId: '222', name: 'Page Hai', accessToken: 'SECRET-TOK-2', status: 'invalid', lastError: 'LOI-NOI-BO', connectedAt: new Date(2000) });
    const passwordHash = await hashPassword('matkhau-123');
    await User.create({ username: 'pg-admin', role: 'admin', passwordHash });
    await User.create({ username: 'pg-play', role: 'staff', permissions: ['playground.use'], passwordHash });
    await User.create({ username: 'pg-noplay', role: 'staff', permissions: ['channels.view', 'promotions.view'], passwordHash });
    admin = await tokenOf('pg-admin');
    staffPlay = await tokenOf('pg-play');
    staffNoPlay = await tokenOf('pg-noplay');
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

  describe('GET /playground/pages', () => {
    it('đường chạy thuận lợi: người chỉ có playground.use thấy danh sách, mới kết nối xếp trước', async () => {
      const res = await call('GET', '/api/admin/playground/pages', { token: staffPlay });
      assert.equal(res.status, 200);
      assert.deepEqual(res.json.pages.map((p) => p.pageId), ['222', '111']);
      assert.deepEqual(res.json.pages[0], { pageId: '222', name: 'Page Hai', status: 'invalid', botEnabled: true });
    });
    it('không lộ token hay lastError', async () => {
      const res = await call('GET', '/api/admin/playground/pages', { token: admin });
      assert.equal(res.status, 200);
      assert.doesNotMatch(res.text, /SECRET-TOK|LOI-NOI-BO|accessToken|lastError/);
    });
    it('thất bại: không đăng nhập 401, thiếu quyền playground.use 403', async () => {
      assert.equal((await call('GET', '/api/admin/playground/pages')).status, 401);
      // có channels.view/promotions.view nhưng không có playground.use
      assert.equal((await call('GET', '/api/admin/playground/pages', { token: staffNoPlay })).status, 403);
    });
  });

  describe('POST /playground/message: kiểm Page (chỉ các nhánh bị từ chối)', () => {
    const post = (token, body) => call('POST', '/api/admin/playground/message', { token, body });
    it('pageId không hợp lệ đều trả 400 và không tạo phiên', async () => {
      const bad = ['999', 'abc', 111, ' ', '111 ', '1'.repeat(33), { $ne: '' }, ['111'], true, 0];
      for (const pageId of bad) {
        const sessionId = sid();
        const res = await post(admin, { sessionId, text: 'hi', pageId });
        assert.equal(res.status, 400, JSON.stringify(pageId));
        assert.equal(res.json.error, 'Page không hợp lệ hoặc đã ngắt kết nối', JSON.stringify(pageId));
        assert.equal(await Conversation.countDocuments({ channel: 'test', externalId: sessionId }), 0);
      }
    });
    it('dữ liệu sai cơ bản vẫn 400 "Dữ liệu không hợp lệ" kể cả khi có pageId', async () => {
      assert.equal((await post(admin, { sessionId: 'x', text: 'hi', pageId: '111' })).json.error, 'Dữ liệu không hợp lệ');
      assert.equal((await post(admin, { sessionId: sid(), text: '   ', pageId: '111' })).json.error, 'Dữ liệu không hợp lệ');
    });
    it('thiếu quyền playground.use: 403', async () => {
      assert.equal((await post(staffNoPlay, { sessionId: sid(), text: 'hi', pageId: '111' })).status, 403);
    });
    it('phiên cũ không gắn Page mà gửi kèm Page thì 409; phiên gắn Page mà gửi không Page cũng 409', async () => {
      const old = sid();
      await send('test', old, 'hi', scriptedClient([say('ok')]));
      assert.equal((await post(admin, { sessionId: old, text: 'hi', pageId: '111' })).status, 409);

      const bound = sid();
      await send('test', bound, 'hi', scriptedClient([say('ok')]), '111');
      for (const pageId of [undefined, null, '', '222']) {
        const res = await post(admin, { sessionId: bound, text: 'hi', ...(pageId === undefined ? {} : { pageId }) });
        assert.equal(res.status, 409, String(pageId));
        assert.match(res.json.error, /Page khác/);
      }
      // 409 không làm hỏng phiên: vẫn còn đúng 1 hội thoại, vẫn gắn Page 111
      const convs = await Conversation.find({ channel: 'test', externalId: bound });
      assert.equal(convs.length, 1);
      assert.equal(convs[0].pageId, '111');
    });
    it('Page invalid vẫn chọn được (không bị chặn ở bước kiểm Page)', async () => {
      // Phiên đã gắn 222 (invalid); gửi pageId 111 phải qua kiểm Page rồi mới 409, chứng tỏ 222/111 đều tồn tại
      const s = sid();
      await send('test', s, 'hi', scriptedClient([say('ok')]), '222');
      assert.equal((await Conversation.findOne({ externalId: s })).pageId, '222');
      const res = await post(admin, { sessionId: s, text: 'hi', pageId: '111' });
      assert.equal(res.status, 409);
    });
  });

  describe('Hành vi agent theo Page', () => {
    it('không chọn Page: chỉ khuyến mãi chung', async () => {
      await promo({ name: 'Chung', type: 'fixed', value: 10000 });
      await promo({ name: 'Riêng111', type: 'fixed', value: 99000, scope: 'pages', pageIds: ['111'] });
      const r = await priceOf('test');
      assert.equal(r.price, 640000);
      assert.equal(r.promotion, 'Chung');
      assert.doesNotMatch(r.prompt, /Riêng111/);
    });
    it('chọn Page: nhận cả chung lẫn riêng, riêng được ưu tiên nếu lợi hơn', async () => {
      await promo({ name: 'Chung', type: 'fixed', value: 10000 });
      await promo({ name: 'Riêng111', type: 'fixed', value: 99000, scope: 'pages', pageIds: ['111'] });
      const r = await priceOf('test', '111');
      assert.equal(r.price, 551000);
      assert.equal(r.promotion, 'Riêng111');
      assert.match(r.prompt, /Chung/);
      assert.match(r.prompt, /Riêng111/);
    });
    it('chọn Page khác (222): không nhận KM riêng của 111 nhưng vẫn nhận KM chung', async () => {
      await promo({ name: 'Chung', type: 'fixed', value: 10000 });
      await promo({ name: 'Riêng111', type: 'fixed', value: 99000, scope: 'pages', pageIds: ['111'] });
      const r = await priceOf('test', '222');
      assert.equal(r.price, 640000);
      assert.equal(r.promotion, 'Chung');
      assert.doesNotMatch(r.prompt, /Riêng111/);
    });
    it('chọn Page: pageId được lưu vào hội thoại test', async () => {
      const s = sid();
      await send('test', s, 'hi', scriptedClient([say('ok')]), '111');
      assert.equal((await Conversation.findOne({ channel: 'test', externalId: s })).pageId, '111');
    });
    it('web và instagram vẫn không nhận KM riêng dù mang pageId trùng', async () => {
      await promo({ name: 'Riêng111', type: 'fixed', value: 99000, scope: 'pages', pageIds: ['111'] });
      for (const [channel, pageId] of [['web', '111'], ['instagram', '111'], ['whatsapp', '111']]) {
        const r = await priceOf(channel, pageId);
        assert.equal(r.price, 650000, channel);
        assert.equal(r.promotion, undefined, channel);
        assert.doesNotMatch(r.prompt, /Riêng111/, channel);
      }
    });
    it('messenger vẫn nhận KM riêng như trước (không bị hồi quy)', async () => {
      await promo({ name: 'Riêng111', type: 'fixed', value: 99000, scope: 'pages', pageIds: ['111'] });
      const r = await priceOf('messenger', '111');
      assert.equal(r.price, 551000);
    });
    it('hai phiên Chat thử khác Page không ảnh hưởng nhau', async () => {
      await promo({ name: 'Riêng111', type: 'percent', value: 20, scope: 'pages', pageIds: ['111'] });
      const [a, b] = [await priceOf('test', '111'), await priceOf('test', '222')];
      assert.equal(a.price, 520000);
      assert.equal(b.price, 650000);
    });
  });

  describe('Đơn Chat thử vẫn là mô phỏng', () => {
    for (const pageId of ['111', undefined]) {
      it(`chốt đơn (${pageId ? `Page ${pageId}` : 'không chọn Page'}) không ghi Order, không trừ kho`, async () => {
        await promo({ name: 'Riêng 10%', scope: 'pages', pageIds: ['111'] });
        const orders = await Order.countDocuments();
        const stock = (await Product.findOne({ sku: 'NPK-16168' })).stock;
        const client = scriptedClient([
          toolCall('update_cart', { action: 'add', product_id: 'NPK-16168', quantity: 2 }),
          toolCall('save_customer_info', CUSTOMER),
          toolCall('create_order', { customer_confirmed: true }),
          say('xong'),
        ]);
        await send('test', sid(), 'mua', client, pageId);
        const result = toolResult(client, 3);
        assert.equal(result.test_mode, true);
        assert.equal(result.subtotal, pageId ? 2 * 359100 : 2 * 399000);
        assert.equal(await Order.countDocuments(), orders);
        assert.equal((await Product.findOne({ sku: 'NPK-16168' })).stock, stock);
      });
    }
  });
});
