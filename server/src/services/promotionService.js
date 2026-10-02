import { MetaPage } from '../models/MetaPage.js';
import { Product } from '../models/Product.js';
import { Promotion, PRODUCT_SCOPES, PROMO_SCOPES, PROMO_TYPES } from '../models/Promotion.js';

const PAGE_ID_RE = /^\d{1,32}$/;
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

// Chương trình có hiệu lực khi bật và đang trong khung thời gian [startAt, endAt)
export function isRunning(promo, now = new Date()) {
  return Boolean(promo.active) && (!promo.startAt || promo.startAt <= now) && (!promo.endAt || now < promo.endAt);
}

export function promotionState(doc, now = new Date()) {
  if (!doc.active) return 'off';
  if (doc.startAt && doc.startAt > now) return 'scheduled';
  if (doc.endAt && doc.endAt <= now) return 'ended';
  return 'running';
}

// Chương trình đang hiệu lực cho một Page. pageId rỗng thì chỉ lấy chương trình chung.
export async function activePromotionsFor(pageId, now = new Date()) {
  const docs = await Promotion.find({
    active: true,
    $and: [
      { $or: [{ startAt: null }, { startAt: { $lte: now } }] },
      { $or: [{ endAt: null }, { endAt: { $gt: now } }] },
      { $or: [{ scope: 'all' }, ...(pageId ? [{ scope: 'pages', pageIds: pageId }] : [])] },
    ],
  })
    .populate('productIds', 'name')
    .lean();

  const rank = (p) => (p.scope === 'pages' ? 0 : 1);
  const endTime = (p) => (p.endAt ? p.endAt.getTime() : Infinity);
  return docs
    .sort((a, b) => rank(a) - rank(b) || (endTime(a) === endTime(b) ? 0 : endTime(a) < endTime(b) ? -1 : 1) || String(a._id).localeCompare(String(b._id)))
    .map((d) => ({
      id: String(d._id),
      name: d.name,
      description: d.description,
      type: d.type,
      value: d.value,
      scope: d.scope,
      pageIds: d.pageIds,
      productScope: d.productScope,
      productIds: d.productIds.map((p) => String(p._id)),
      productNames: d.productIds.map((p) => p.name),
      startAt: d.startAt,
      endAt: d.endAt,
    }));
}

export function discountedPrice(base, promo) {
  if (promo.type === 'percent') return Math.max(0, Math.round((base * (100 - promo.value)) / 100));
  return Math.max(0, base - promo.value);
}

export function appliesToProduct(promo, productId) {
  return promo.productScope === 'all' || promo.productIds.includes(String(productId));
}

// Không cộng dồn: chọn chương trình cho giá cuối thấp nhất; hoà giá thì ưu tiên loại riêng của Page, rồi id nhỏ hơn
export function pickBestPromotion(product, promotions = []) {
  const listPrice = product.effectivePrice;
  let best = null;
  for (const promo of promotions) {
    if (!appliesToProduct(promo, product._id)) continue;
    const price = discountedPrice(listPrice, promo);
    if (price >= listPrice) continue;
    const better =
      !best ||
      price < best.price ||
      (price === best.price &&
        ((promo.scope === 'pages' && best.promo.scope !== 'pages') ||
          (promo.scope === best.promo.scope && String(promo.id) < String(best.promo.id))));
    if (better) best = { price, promo };
  }
  if (!best) return { price: listPrice, listPrice, promotion: null };
  return { price: best.price, listPrice, promotion: { id: best.promo.id, name: best.promo.name } };
}

export function promotionRow(doc, now = new Date()) {
  return {
    _id: doc._id,
    name: doc.name,
    description: doc.description,
    type: doc.type,
    value: doc.value,
    scope: doc.scope,
    pageIds: doc.pageIds,
    productScope: doc.productScope,
    productIds: doc.productIds.map(String),
    startAt: doc.startAt,
    endAt: doc.endAt,
    active: doc.active,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    state: promotionState(doc, now),
  };
}

const pickOr = (body, key, existing, fallback) => (body[key] !== undefined ? body[key] : (existing?.[key] ?? fallback));

function parseTime(value) {
  if (value === null || value === '') return { value: null };
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? { error: true } : { value };
  if (typeof value !== 'string') return { error: true };
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? { error: true } : { value: d };
}

export async function validatePromotionInput(body = {}, existing = null) {
  const rawName = pickOr(body, 'name', existing, '');
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  if (name.length < 1 || name.length > 120) return { error: 'Tên chương trình 1–120 ký tự' };

  const description = pickOr(body, 'description', existing, '');
  if (typeof description !== 'string' || description.length > 1000) return { error: 'Mô tả tối đa 1000 ký tự' };

  const type = pickOr(body, 'type', existing);
  if (!PROMO_TYPES.includes(type)) return { error: 'Loại giảm giá không hợp lệ' };

  const value = pickOr(body, 'value', existing);
  const validValue =
    typeof value === 'number' && Number.isFinite(value) && (type === 'percent' ? value > 0 && value <= 100 : Number.isInteger(value) && value > 0);
  if (!validValue) return { error: 'Mức giảm không hợp lệ' };

  const scope = pickOr(body, 'scope', existing, 'all');
  if (!PROMO_SCOPES.includes(scope)) return { error: 'Phải chọn ít nhất một Page hợp lệ' };
  let pageIds = [];
  if (scope === 'pages') {
    const raw = pickOr(body, 'pageIds', existing, []);
    const bad = 'Phải chọn ít nhất một Page hợp lệ';
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 100 || !raw.every((id) => typeof id === 'string' && PAGE_ID_RE.test(id))) return { error: bad };
    pageIds = [...new Set(raw)];
    const kept = new Set(existing?.pageIds ?? []);
    const toCheck = pageIds.filter((id) => !kept.has(id));
    if (toCheck.length && (await MetaPage.countDocuments({ pageId: { $in: toCheck } })) !== toCheck.length) return { error: bad };
  }

  const productScope = pickOr(body, 'productScope', existing, 'all');
  if (!PRODUCT_SCOPES.includes(productScope)) return { error: 'Phải chọn ít nhất một sản phẩm hợp lệ' };
  let productIds = [];
  if (productScope === 'products') {
    const raw = pickOr(body, 'productIds', existing, []);
    const bad = 'Phải chọn ít nhất một sản phẩm hợp lệ';
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 500 || !raw.every((id) => OBJECT_ID_RE.test(String(id)))) return { error: bad };
    productIds = [...new Set(raw.map((id) => String(id)))];
    if ((await Product.countDocuments({ _id: { $in: productIds } })) !== productIds.length) return { error: bad };
  }

  const start = parseTime(pickOr(body, 'startAt', existing, null));
  const end = parseTime(pickOr(body, 'endAt', existing, null));
  if (start.error || end.error) return { error: 'Thời gian không hợp lệ' };
  if (start.value && end.value && end.value <= start.value) return { error: 'Thời gian kết thúc phải sau thời gian bắt đầu' };

  const active = pickOr(body, 'active', existing, true);
  if (typeof active !== 'boolean') return { error: 'Trạng thái không hợp lệ' };

  return { data: { name, description, type, value, scope, pageIds, productScope, productIds, startAt: start.value, endAt: end.value, active } };
}
