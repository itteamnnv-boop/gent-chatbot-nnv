import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { connectDB, disconnectDB } from '../src/db.js';
import { seedDatabase } from '../src/seedData.js';
import { handleIncomingMessage } from '../src/services/conversationService.js';
import { Conversation } from '../src/models/Conversation.js';
import { Order } from '../src/models/Order.js';
import { Product } from '../src/models/Product.js';

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

const SESSION = 'test-session-0001';
const send = (text, client) => handleIncomingMessage({ channel: 'web', externalId: SESSION, text, client });

describe('Luồng tư vấn → chốt đơn', () => {
  before(async () => {
    await connectDB('memory');
    await seedDatabase();
  });
  after(disconnectDB);

  it('tìm sản phẩm không dấu và trả kết quả thật cho model', async () => {
    const client = scriptedClient([toolCall('search_products', { query: 'phan bon cho lua' }), say('Dạ em gợi ý NPK 16-16-8 ạ.')]);
    const { replies } = await send('tôi cần phân bón cho lúa', client);

    assert.equal(replies[0].text, 'Dạ em gợi ý NPK 16-16-8 ạ.');
    const toolMsg = client.requests[1].messages.find((m) => m.role === 'tool');
    const result = JSON.parse(toolMsg.content);
    assert.ok(result.count > 0);
    assert.ok(result.products.some((p) => p.sku === 'NPK-16168' && p.price === 399000));
    // system prompt chứa catalog & giai đoạn
    assert.match(client.requests[0].messages[0].content, /Phân NPK/);
    assert.equal(client.requests[0].tools.length, 10);
  });

  it('thêm vào giỏ, chặn vượt tồn kho', async () => {
    const client = scriptedClient([
      toolCall('update_cart', { action: 'add', product_id: 'NPK-16168', quantity: 9999 }),
      toolCall('update_cart', { action: 'add', product_id: 'NPK-16168', quantity: 2 }),
      say('Dạ em đã thêm 2 bao vào giỏ.'),
    ]);
    await send('lấy 2 bao NPK 16-16-8', client);
    const conv = await Conversation.findOne({ externalId: SESSION });
    assert.equal(conv.cart.length, 1);
    assert.equal(conv.cart[0].quantity, 2);
    assert.equal(conv.stage, 'cart');
    const firstResult = JSON.parse(client.requests[1].messages.at(-1).content);
    assert.match(firstResult.error, /Chỉ còn 200/);
  });

  it('lưu thông tin giao hàng, chuẩn hoá SĐT, báo SĐT sai', async () => {
    const client = scriptedClient([
      toolCall('save_customer_info', { name: 'Nguyễn Văn A', phone: '12345', address: '12 Lê Lợi, P. Bến Thành, Q.1, TP.HCM' }),
      toolCall('save_customer_info', { phone: '+84 901 234 567' }),
      say('Dạ em tóm tắt đơn... anh xác nhận giúp em ạ?'),
    ]);
    await send('Nguyễn Văn A, 0901 234 567, 12 Lê Lợi, P. Bến Thành, Q.1, TP.HCM', client);
    const firstResult = JSON.parse(client.requests[1].messages.at(-1).content);
    assert.equal(firstResult.ok, false);
    const conv = await Conversation.findOne({ externalId: SESSION });
    assert.equal(conv.checkout.phone, '0901234567');
    assert.equal(conv.stage, 'checkout');
  });

  it('không tạo đơn khi chưa xác nhận; tạo đơn, trừ kho khi đã xác nhận', async () => {
    const client = scriptedClient([
      toolCall('create_order', { customer_confirmed: false }),
      toolCall('create_order', { customer_confirmed: true }),
      say('Dạ đơn của anh đã được tạo.'),
    ]);
    await send('ok chốt đơn', client);

    const orders = await Order.find();
    assert.equal(orders.length, 1);
    const order = orders[0];
    assert.match(order.code, /^DH\d{6}[0-9A-F]{4}$/);
    assert.equal(order.subtotal, 2 * 399000);
    assert.equal(order.shippingFee, 30000);
    assert.equal(order.total, 2 * 399000 + 30000);
    assert.equal(order.shipping.phone, '0901234567');

    const product = await Product.findOne({ sku: 'NPK-16168' });
    assert.equal(product.stock, 198);

    const conv = await Conversation.findOne({ externalId: SESSION });
    assert.equal(conv.cart.length, 0);
    assert.equal(conv.stage, 'ordered');
    assert.equal(conv.orders.length, 1);

    // gọi lại create_order với giỏ trống → lỗi, không tạo đơn trùng
    const again = scriptedClient([toolCall('create_order', { customer_confirmed: true }), say('Đơn đã tạo rồi ạ.')]);
    await send('chốt lại lần nữa', again);
    assert.equal(await Order.countDocuments(), 1);
  });

  it('tra cứu đơn: chỉ trả đơn của chính khách hoặc khi SĐT khớp', async () => {
    const order = await Order.findOne();
    const other = scriptedClient([toolCall('lookup_order', { order_code: order.code }), say('...')]);
    await handleIncomingMessage({ channel: 'web', externalId: 'someone-else-01', text: 'đơn của tôi', client: other });
    assert.ok(JSON.parse(other.requests[1].messages.at(-1).content).error);

    const withPhone = scriptedClient([toolCall('lookup_order', { order_code: order.code, phone: '0901.234.567' }), say('...')]);
    await handleIncomingMessage({ channel: 'web', externalId: 'someone-else-01', text: 'đơn ' + order.code, client: withPhone });
    assert.equal(JSON.parse(withPhone.requests[1].messages.at(-1).content).status, 'Mới tiếp nhận');
  });

  it('từ khoá handoff chuyển cho nhân viên, bot ngừng trả lời', async () => {
    const neverCalled = scriptedClient([]);
    const r1 = await send('cho tôi gặp nhân viên', neverCalled);
    assert.equal(r1.replies.length, 1);
    const conv = await Conversation.findOne({ externalId: SESSION });
    assert.equal(conv.mode, 'human');

    const r2 = await send('alo shop ơi', neverCalled);
    assert.equal(r2.replies.length, 0);
    assert.equal(neverCalled.requests.length, 0);
  });

  it('lỗi OpenAI → trả lời dự phòng và đánh dấu cần chú ý', async () => {
    const broken = { chat: { completions: { create: async () => { throw new Error('rate limit'); } } } };
    const { replies } = await handleIncomingMessage({ channel: 'web', externalId: 'broken-session-1', text: 'hello', client: broken });
    assert.match(replies[0].text, /bận/);
    const conv = await Conversation.findOne({ externalId: 'broken-session-1' });
    assert.equal(conv.needsAttention, true);
  });

  it('bỏ qua tin nhắn webhook trùng (cùng mid)', async () => {
    const client = scriptedClient([say('Chào anh')]);
    const msg = { channel: 'messenger', externalId: 'psid-1', text: 'hi', externalMessageId: 'm_1', client };
    await handleIncomingMessage(msg);
    const dup = await handleIncomingMessage(msg);
    assert.equal(dup.duplicate, true);
    assert.equal(client.requests.length, 1);
  });

  it('Chat thử (kênh test): mô phỏng chốt đơn, không tạo đơn thật, không trừ kho', async () => {
    const ordersBefore = await Order.countDocuments();
    const stockBefore = (await Product.findOne({ sku: 'URE-46' })).stock;
    const client = scriptedClient([
      toolCall('update_cart', { action: 'add', product_id: 'URE-46', quantity: 3 }),
      toolCall('save_customer_info', { name: 'Chủ shop', phone: '0912345678', address: '1 Đường Thử, Phường A, Quận B, TP.HCM' }),
      toolCall('create_order', { customer_confirmed: true }),
      say('Đơn thử đã tạo.'),
    ]);
    await handleIncomingMessage({ channel: 'test', externalId: 'playground-0001', text: 'mua 3 bao urê', client });

    const result = JSON.parse(client.requests[3].messages.at(-1).content);
    assert.equal(result.test_mode, true);
    assert.match(result.order_code, /^TEST/);
    assert.equal(await Order.countDocuments(), ordersBefore);
    assert.equal((await Product.findOne({ sku: 'URE-46' })).stock, stockBefore);
  });
});
