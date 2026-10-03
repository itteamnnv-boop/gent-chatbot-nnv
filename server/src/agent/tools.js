import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { Product } from '../models/Product.js';
import { Knowledge } from '../models/Knowledge.js';
import { Order } from '../models/Order.js';
import { cartTotals, describeCart, describeStaffDiscount, staffDiscountAmount } from '../services/cart.js';
import { pickBestPromotion } from '../services/promotionService.js';
import { escapeRegex, isValidPhone, mentionedNumbers, normalize, normalizePhone, tokenize } from '../utils/text.js';

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
  fn(
    'apply_staff_discount',
    'Áp hoặc bỏ ưu đãi riêng mà NHÂN VIÊN đã hứa với khách. Chỉ dùng tin trong mục "Chỉ dẫn của nhân viên"; số liệu phải đúng như trong tin.',
    {
      action: { type: 'string', enum: ['set', 'remove'] },
      message_id: { type: 'string', description: 'Mã tin nhân viên trong mục Chỉ dẫn của nhân viên' },
      kind: { type: 'string', enum: ['amount', 'percent', 'unit_price'], description: 'amount: giảm số tiền; percent: giảm %; unit_price: giá bán riêng mỗi sản phẩm' },
      value: { type: 'number', description: 'Số tiền VND hoặc số % đúng như nhân viên viết' },
      per_unit: { type: 'boolean', description: 'Chỉ với amount: true = giảm trên mỗi sản phẩm; không rõ thì false' },
      product_id: { type: 'string', description: 'product_id hoặc sku nếu ưu đãi chỉ cho một sản phẩm (bắt buộc với unit_price)' },
      min_quantity: { type: 'integer', minimum: 1, description: 'Số lượng tối thiểu nhân viên đặt ra, vd "mua 5 bao" = 5' },
      note: { type: 'string', description: 'Tóm tắt ngắn ưu đãi' },
    },
    ['action'],
  ),
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
    return { ok: true, cart: describeCart(conversation.cart, settings, conversation.staffDiscount) };
  },

  async view_cart(_args, ctx) {
    return describeCart(ctx.conversation.cart, ctx.settings, ctx.conversation.staffDiscount);
  },

  async apply_staff_discount(args, ctx) {
    const { conversation, settings } = ctx;
    if (args.action === 'remove') {
      const had = Boolean(conversation.staffDiscount);
      conversation.staffDiscount = null;
      await conversation.save();
      if (had) ctx.events.push({ type: 'staff_discount', text: 'AI bỏ ưu đãi của nhân viên theo chỉ dẫn mới' });
      return { ok: true, cart: describeCart(conversation.cart, settings, null) };
    }
    if (args.action !== 'set') return { error: 'action phải là set hoặc remove.' };

    // Thẩm quyền chỉ đến từ tin nhân viên do server dựng, không tin message_id tuỳ ý
    const msg = (ctx.staffInstructions ?? []).find((m) => m.id === String(args.message_id));
    if (!msg) return { error: 'Chỉ được áp ưu đãi từ tin nhắn có trong mục Chỉ dẫn của nhân viên.' };
    const { kind, value } = args;
    if (!['amount', 'percent', 'unit_price'].includes(kind)) return { error: 'Mức ưu đãi không hợp lệ.' };
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return { error: 'Mức ưu đãi không hợp lệ.' };
    if (kind === 'percent' ? value > 100 : !Number.isInteger(value)) return { error: 'Mức ưu đãi không hợp lệ.' };

    // Con số AI đưa ra phải có trong chính tin nhân viên
    const nums = mentionedNumbers(msg.text);
    // Tin có điều kiện số lượng ("mua 5 bao") thì min_quantity bắt buộc và phải khớp
    if (nums.qty.size > 0 && !nums.qty.has(args.min_quantity)) {
      return { error: `Số lượng không khớp: tin nhân viên có điều kiện số lượng (${[...nums.qty].join(' hoặc ')}). Phải truyền min_quantity đúng con số đó (vd min_quantity=${[...nums.qty][0]}) rồi gọi lại.` };
    }
    const matched = (kind === 'percent' ? nums.percent.has(value) : nums.money.has(value)) && (!args.min_quantity || nums.plain.has(args.min_quantity));
    if (!matched) return { error: 'Số liệu không khớp với tin nhắn của nhân viên. Không tự đặt mức ưu đãi; nếu không chắc, hãy chuyển nhân viên.' };

    if (kind === 'unit_price' && !args.product_id) return { error: 'Giá riêng phải gắn với một sản phẩm (product_id).' };
    let p = null;
    if (args.product_id) {
      p = await findProduct(args.product_id);
      if (!p || !p.active) return { error: 'Không tìm thấy sản phẩm, hãy dùng search_products để lấy product_id đúng.' };
    }

    conversation.staffDiscount = {
      messageId: msg.id,
      staffName: msg.author,
      kind,
      value,
      perUnit: kind === 'amount' && args.per_unit === true,
      productId: p?._id ?? null,
      productName: p?.name ?? '',
      minQuantity: args.min_quantity || 0,
      note: String(args.note ?? '').slice(0, 200),
    };
    await conversation.save();
    ctx.events.push({ type: 'staff_discount', text: `AI áp ưu đãi theo chỉ dẫn của nhân viên ${msg.author || ''}: ${describeStaffDiscount(conversation.staffDiscount)}` });
    return { ok: true, cart: describeCart(conversation.cart, settings, conversation.staffDiscount) };
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
    // Ưu đãi nhân viên chỉ còn hiệu lực khi tin gốc vẫn nằm trong mục chỉ dẫn (chưa bị đơn mới hơn làm cũ)
    if (conversation.staffDiscount && !(ctx.staffInstructions ?? []).some((m) => m.id === String(conversation.staffDiscount.messageId))) {
      conversation.staffDiscount = null;
      await conversation.save();
      return {
        error: 'Ưu đãi của nhân viên không còn hiệu lực. Báo khách tổng tiền mới, xin xác nhận lại rồi mới tạo đơn.',
        cart: describeCart(conversation.cart, settings, null),
      };
    }
    if (priceChanged) {
      await conversation.save();
      return {
        error: 'Giá đã thay đổi do khuyến mãi thay đổi hoặc hết hạn. Báo khách giỏ hàng và tổng tiền mới, xin xác nhận lại rồi mới tạo đơn.',
        cart: describeCart(conversation.cart, settings, conversation.staffDiscount),
      };
    }
    const sd = conversation.staffDiscount;
    if (sd) {
      const check = staffDiscountAmount(conversation.cart, sd);
      if (!check.applied) {
        return {
          error: `Ưu đãi của nhân viên chưa đủ điều kiện (${check.reason}). Báo khách, rồi điều chỉnh giỏ hoặc gọi apply_staff_discount action=remove trước khi tạo đơn.`,
          cart: describeCart(conversation.cart, settings, sd),
        };
      }
    }

    // Chat thử: mô phỏng tạo đơn, không ghi DB, không trừ kho
    if (conversation.channel === 'test') {
      const totals = cartTotals(conversation.cart, settings, sd);
      const items = conversation.cart.map((i) => `${i.name} x${i.quantity}`);
      conversation.cart = [];
      conversation.staffDiscount = null;
      setStage(conversation, 'ordered');
      await conversation.save();
      return {
        ok: true,
        test_mode: true,
        order_code: `TEST${Date.now().toString(36).toUpperCase()}`,
        items,
        subtotal: totals.subtotal,
        discount: totals.discount,
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

    const { subtotal, discount, shippingFee, total } = cartTotals(items, settings, sd);
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
          discount,
          staffDiscount: sd ? { ...(sd.toObject?.() ?? sd) } : null,
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
    conversation.staffDiscount = null;
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
      discount,
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
