import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { Product } from '../models/Product.js';
import { Knowledge } from '../models/Knowledge.js';
import { Order } from '../models/Order.js';
import { cartTotals, describeCart } from '../services/cart.js';
import { pickBestPromotion } from '../services/promotionService.js';
import { escapeRegex, isValidPhone, normalize, normalizePhone, tokenize } from '../utils/text.js';

// ---------- Định nghĩa tool cho OpenAI function calling ----------
const fn = (name, description, properties = {}, required = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } },
});

export const toolDefinitions = [
  fn(
    'search_products',
    'Tìm sản phẩm trong catalog theo nhu cầu/từ khoá. Trả về giá, tồn kho thật.',
    {
      query: { type: 'string', description: 'Từ khoá hoặc mô tả nhu cầu, vd "phân bón cho lúa"' },
      category: { type: 'string', description: 'Lọc theo danh mục (tuỳ chọn)' },
      max_price: { type: 'number', description: 'Giá tối đa (VND, tuỳ chọn)' },
    },
    ['query'],
  ),
  fn('get_product_details', 'Lấy chi tiết đầy đủ một sản phẩm (mô tả, hướng dẫn sử dụng, tồn kho).', {
    product_id: { type: 'string', description: 'product_id hoặc sku lấy từ search_products' },
  }, ['product_id']),
  fn('search_knowledge', 'Tra cứu kho kiến thức: chính sách giao hàng, đổi trả, thanh toán, FAQ, hướng dẫn kỹ thuật.', {
    query: { type: 'string' },
  }, ['query']),
  fn(
    'update_cart',
    'Thêm, đổi số lượng, xoá sản phẩm trong giỏ hàng hoặc xoá toàn bộ giỏ.',
    {
      action: { type: 'string', enum: ['add', 'set_quantity', 'remove', 'clear'] },
      product_id: { type: 'string', description: 'product_id hoặc sku (không cần khi action=clear)' },
      quantity: { type: 'integer', minimum: 1, description: 'Số lượng (add: cộng thêm; set_quantity: đặt lại)' },
    },
    ['action'],
  ),
  fn('view_cart', 'Xem giỏ hàng hiện tại và tổng tiền.'),
  fn('save_customer_info', 'Lưu thông tin nhận hàng khách vừa cung cấp. Chỉ truyền trường khách đã nói.', {
    name: { type: 'string' },
    phone: { type: 'string' },
    address: { type: 'string', description: 'Địa chỉ đầy đủ: số nhà, đường, phường/xã, quận/huyện, tỉnh/thành' },
    note: { type: 'string', description: 'Ghi chú giao hàng' },
  }),
  fn('create_order', 'Tạo đơn hàng từ giỏ hàng. Chỉ gọi khi khách đã XÁC NHẬN bản tóm tắt đơn.', {
    customer_confirmed: { type: 'boolean', description: 'true nếu khách đã xác nhận rõ ràng' },
  }, ['customer_confirmed']),
  fn('lookup_order', 'Tra cứu trạng thái đơn hàng của khách.', {
    order_code: { type: 'string', description: 'Mã đơn, vd DH2610011A2B (tuỳ chọn)' },
    phone: { type: 'string', description: 'SĐT đặt hàng, dùng để xác minh khi tra mã đơn' },
  }),
  fn('handoff_to_human', 'Chuyển hội thoại cho nhân viên thật.', {
    reason: { type: 'string', description: 'Lý do ngắn gọn' },
  }, ['reason']),
];

// ---------- Helpers ----------
const ORDER_STATUS_VI = { new: 'Mới tiếp nhận', confirmed: 'Đã xác nhận', shipping: 'Đang giao', completed: 'Đã giao', cancelled: 'Đã huỷ' };

function productSummary(p, promotions) {
  const r = pickBestPromotion(p, promotions);
  return {
    product_id: String(p._id),
    sku: p.sku,
    name: p.name,
    category: p.category,
    price: r.price,
    original_price: p.price > r.price ? p.price : undefined,
    promotion: r.promotion?.name,
    unit: p.unit,
    in_stock: p.stock > 0,
    stock: p.stock,
    short_description: p.description.length > 220 ? `${p.description.slice(0, 220)}…` : p.description,
  };
}

async function findProduct(idOrSku) {
  if (!idOrSku) return null;
  const s = String(idOrSku).trim();
  if (mongoose.isValidObjectId(s)) {
    const p = await Product.findById(s);
    if (p) return p;
  }
  return Product.findOne({ sku: new RegExp(`^${escapeRegex(s)}$`, 'i') });
}

// Tìm theo token (không dấu), chấm điểm: khớp tên > khớp nội dung
async function scoredSearch(Model, query, { filter = {}, nameField, limit }) {
  const tokens = tokenize(query);
  const q = { active: true, ...filter };
  if (tokens.length) q.searchText = { $regex: tokens.map(escapeRegex).join('|') };
  const docs = await Model.find(q).select('+searchText').limit(200);
  return docs
    .map((d) => {
      const name = normalize(d[nameField]);
      const score = tokens.reduce((s, t) => s + (name.includes(t) ? 3 : 0) + (d.searchText.includes(t) ? 1 : 0), 0);
      return { d, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.d);
}

function setStage(conversation, stage) {
  const order = ['new', 'consulting', 'cart', 'checkout', 'ordered'];
  if (conversation.stage === 'handoff') return;
  if (stage === 'ordered' || order.indexOf(stage) > order.indexOf(conversation.stage)) conversation.stage = stage;
}

function generateOrderCode(now = new Date()) {
  const ymd = now.toISOString().slice(2, 10).replace(/-/g, '');
  return `DH${ymd}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

// ---------- Handlers ----------
const handlers = {
  async search_products({ query, category, max_price: maxPrice }, ctx) {
    const filter = category ? { category: new RegExp(escapeRegex(category), 'i') } : {};
    let products = await scoredSearch(Product, query, { filter, nameField: 'name', limit: 20 });
    const promotions = ctx.promotions ?? [];
    if (maxPrice) products = products.filter((p) => pickBestPromotion(p, promotions).price <= maxPrice);
    products = products.slice(0, 5);
    setStage(ctx.conversation, 'consulting');
    await ctx.conversation.save();
    if (!products.length) return { count: 0, message: 'Không tìm thấy sản phẩm phù hợp. Hỏi lại khách hoặc gợi ý danh mục khác.' };
    return { count: products.length, products: products.map((p) => productSummary(p, promotions)) };
  },

  async get_product_details({ product_id: id }, ctx) {
    const p = await findProduct(id);
    if (!p || !p.active) return { error: 'Không tìm thấy sản phẩm' };
    return { ...productSummary(p, ctx.promotions ?? []),description: p.description, usage: p.usage, tags: p.tags };
  },

  async search_knowledge({ query }) {
    const docs = await scoredSearch(Knowledge, query, { nameField: 'title', limit: 3 });
    if (!docs.length) return { count: 0, message: 'Không có thông tin trong kho kiến thức.' };
    return { count: docs.length, results: docs.map((d) => ({ title: d.title, content: d.content })) };
  },

  async update_cart({ action, product_id: id, quantity }, ctx) {
    const { conversation, settings } = ctx;
    const qty = Math.max(1, Math.floor(quantity || 1));
    if (action === 'clear') {
      conversation.cart = [];
    } else {
      const p = await findProduct(id);
      if (!p || !p.active) return { error: 'Không tìm thấy sản phẩm, hãy dùng search_products để lấy product_id đúng.' };
      const idx = conversation.cart.findIndex((i) => String(i.product) === String(p._id));
      if (action === 'remove') {
        if (idx >= 0) conversation.cart.splice(idx, 1);
      } else {
        const newQty = action === 'add' && idx >= 0 ? conversation.cart[idx].quantity + qty : qty;
        if (newQty > p.stock) return { error: `Chỉ còn ${p.stock} ${p.unit} "${p.name}" trong kho.`, stock: p.stock };
        const r = pickBestPromotion(p, ctx.promotions ?? []);
        if (idx >= 0) {
          conversation.cart[idx].quantity = newQty;
          conversation.cart[idx].price = r.price;
          conversation.cart[idx].listPrice = r.listPrice;
          conversation.cart[idx].promotion = r.promotion;
        } else {
          conversation.cart.push({ product: p._id, sku: p.sku, name: p.name, unit: p.unit, price: r.price, listPrice: r.listPrice, promotion: r.promotion, quantity: newQty });
        }
      }
    }
    if (conversation.cart.length) setStage(conversation, 'cart');
    await conversation.save();
    return { ok: true, cart: describeCart(conversation.cart, settings) };
  },

  async view_cart(_args, ctx) {
    return describeCart(ctx.conversation.cart, ctx.settings);
  },

  async save_customer_info(args, ctx) {
    const { conversation, customer } = ctx;
    const errors = [];
    if (args.phone !== undefined) {
      if (isValidPhone(args.phone)) conversation.checkout.phone = normalizePhone(args.phone);
      else errors.push('Số điện thoại không hợp lệ (cần 10 số, bắt đầu bằng 0).');
    }
    if (args.name?.trim()) conversation.checkout.name = args.name.trim();
    if (args.address !== undefined) {
      if (args.address.trim().length >= 10) conversation.checkout.address = args.address.trim();
      else errors.push('Địa chỉ quá ngắn, cần đầy đủ số nhà/đường, phường/xã, quận/huyện, tỉnh/thành.');
    }
    if (args.note !== undefined) conversation.checkout.note = args.note.trim();
    setStage(conversation, 'checkout');
    await conversation.save();

    const c = conversation.checkout;
    if (c.name && !customer.name) customer.name = c.name;
    if (c.phone) customer.phone = c.phone;
    if (c.address) customer.address = c.address;
    await customer.save();

    const missing = ['name', 'phone', 'address'].filter((k) => !c[k]);
    return { ok: errors.length === 0, errors, saved: { name: c.name, phone: c.phone, address: c.address, note: c.note }, missing };
  },

  async create_order({ customer_confirmed: confirmed }, ctx) {
    const { conversation, customer, settings } = ctx;
    if (confirmed !== true) return { error: 'Khách chưa xác nhận. Hãy tóm tắt đơn và hỏi xác nhận trước.' };
    if (!conversation.cart.length) return { error: 'Giỏ hàng trống.' };
    const c = conversation.checkout;
    const missing = ['name', 'phone', 'address'].filter((k) => !c[k]);
    if (missing.length) return { error: 'Thiếu thông tin giao hàng', missing };

    // Tính lại giá theo khuyến mãi hiện hành; lệch giá so với giỏ thì cập nhật giỏ và để khách xác nhận lại
    const promotions = ctx.promotions ?? [];
    let priceChanged = false;
    for (const item of conversation.cart) {
      const p = await Product.findById(item.product);
      if (!p || !p.active) return { error: `Sản phẩm "${item.name}" không còn bán.` };
      const r = pickBestPromotion(p, promotions);
      if (r.price !== item.price) priceChanged = true;
      item.price = r.price;
      item.listPrice = r.listPrice;
      item.promotion = r.promotion;
    }
    if (priceChanged) {
      await conversation.save();
      return {
        error: 'Giá đã thay đổi do khuyến mãi thay đổi hoặc hết hạn. Báo khách giỏ hàng và tổng tiền mới, xin xác nhận lại rồi mới tạo đơn.',
        cart: describeCart(conversation.cart, settings),
      };
    }

    // Chat thử: mô phỏng tạo đơn, không ghi DB, không trừ kho
    if (conversation.channel === 'test') {
      const totals = cartTotals(conversation.cart, settings);
      const items = conversation.cart.map((i) => `${i.name} x${i.quantity}`);
      conversation.cart = [];
      setStage(conversation, 'ordered');
      await conversation.save();
      return {
        ok: true,
        test_mode: true,
        order_code: `TEST${Date.now().toString(36).toUpperCase()}`,
        items,
        subtotal: totals.subtotal,
        shipping_fee: totals.shippingFee,
        total: totals.total,
        shipping: { name: c.name, phone: c.phone, address: c.address },
      };
    }

    // Lấy giá mới nhất & trừ kho nguyên tử; lỗi giữa chừng thì hoàn kho
    const items = [];
    const reserved = [];
    try {
      for (const item of conversation.cart) {
        const p = await Product.findOneAndUpdate(
          { _id: item.product, active: true, stock: { $gte: item.quantity } },
          { $inc: { stock: -item.quantity } },
          { returnDocument: 'after' },
        );
        if (!p) throw new Error(`Sản phẩm "${item.name}" không đủ hàng.`);
        reserved.push(item);
        // Dùng đúng giá đã kiểm ở bước kiểm giá (item đã được đồng bộ), không tính lại
        items.push({ product: p._id, sku: p.sku, name: p.name, unit: p.unit, price: item.price, listPrice: item.listPrice, promotion: item.promotion, quantity: item.quantity, lineTotal: item.price * item.quantity });
      }
    } catch (err) {
      await Promise.all(reserved.map((i) => Product.updateOne({ _id: i.product }, { $inc: { stock: i.quantity } })));
      return { error: err.message };
    }

    const { subtotal, shippingFee, total } = cartTotals(items, settings);
    let order;
    for (let attempt = 0; !order; attempt += 1) {
      try {
        order = await Order.create({
          code: generateOrderCode(),
          conversation: conversation._id,
          customer: customer._id,
          channel: conversation.channel,
          pageId: conversation.channel === 'messenger' ? conversation.pageId || '' : '',
          items,
          subtotal,
          shippingFee,
          total,
          shipping: { name: c.name, phone: c.phone, address: c.address },
          note: c.note,
          statusHistory: [{ status: 'new', by: 'bot' }],
        });
      } catch (err) {
        if (err.code !== 11000 || attempt >= 4) {
          await Promise.all(reserved.map((i) => Product.updateOne({ _id: i.product }, { $inc: { stock: i.quantity } })));
          throw err;
        }
      }
    }

    conversation.cart = [];
    conversation.checkout.note = '';
    conversation.orders.push(order._id);
    setStage(conversation, 'ordered');
    await conversation.save();
    ctx.events.push({ type: 'order_created', order });

    return {
      ok: true,
      order_code: order.code,
      items: items.map((i) => `${i.name} x${i.quantity}`),
      subtotal,
      shipping_fee: shippingFee,
      total,
      shipping: order.shipping,
    };
  },

  async lookup_order({ order_code: code, phone }, ctx) {
    const fmt = (o) => ({
      order_code: o.code,
      status: ORDER_STATUS_VI[o.status],
      total: o.total,
      items: o.items.map((i) => `${i.name} x${i.quantity}`),
      created_at: o.createdAt.toISOString(),
    });
    if (code) {
      const o = await Order.findOne({ code: code.trim().toUpperCase() });
      // Chỉ trả đơn của chính khách này, hoặc khi SĐT khớp (tránh lộ thông tin người khác)
      const owns = o && (String(o.customer) === String(ctx.customer._id) || (phone && normalizePhone(phone) === o.shipping.phone));
      if (!owns) return { error: 'Không tìm thấy đơn khớp mã và số điện thoại.' };
      return fmt(o);
    }
    const orders = await Order.find({ customer: ctx.customer._id }).sort({ createdAt: -1 }).limit(3);
    if (!orders.length) return { error: 'Khách chưa có đơn nào trên kênh này. Hỏi mã đơn và SĐT đặt hàng.' };
    return { orders: orders.map(fmt) };
  },

  async handoff_to_human({ reason }, ctx) {
    ctx.conversation.mode = 'human';
    ctx.conversation.stage = 'handoff';
    ctx.conversation.handoffReason = reason || 'Bot chuyển';
    await ctx.conversation.save();
    ctx.events.push({ type: 'handoff', reason });
    return { ok: true, message: 'Đã chuyển nhân viên. Báo khách nhân viên sẽ phản hồi sớm, không hỏi thêm.' };
  },
};

export async function executeTool(name, args, ctx) {
  const handler = handlers[name];
  if (!handler) return { error: `Tool không tồn tại: ${name}` };
  try {
    return await handler(args ?? {}, ctx);
  } catch (err) {
    console.error(`[tool:${name}]`, err);
    return { error: 'Lỗi hệ thống khi xử lý, thử lại hoặc chuyển nhân viên.' };
  }
}
