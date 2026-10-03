import { formatVND } from '../utils/text.js';

/** Tiền giảm theo ưu đãi của nhân viên trên giỏ/dòng đơn hiện tại (đã trừ khuyến mãi hệ thống).
 *  @returns {{ amount: number, applied: boolean, reason?: string }} */
export function staffDiscountAmount(cart, sd) {
  if (!sd) return { amount: 0, applied: false };
  const lines = sd.productId ? cart.filter((i) => String(i.product) === String(sd.productId)) : cart;
  if (!lines.length) return { amount: 0, applied: false, reason: 'Giỏ chưa có sản phẩm được ưu đãi' };
  const qty = lines.reduce((s, i) => s + i.quantity, 0);
  const base = lines.reduce((s, i) => s + i.price * i.quantity, 0);
  if (qty < (sd.minQuantity || 0)) {
    return { amount: 0, applied: false, reason: `Cần mua tối thiểu ${sd.minQuantity} sản phẩm được ưu đãi (hiện có ${qty})` };
  }
  let amount = 0;
  if (sd.kind === 'amount') amount = sd.perUnit ? sd.value * qty : sd.value;
  else if (sd.kind === 'percent') amount = Math.round((base * sd.value) / 100);
  else if (sd.kind === 'unit_price') {
    amount = lines.reduce((s, i) => s + Math.max(0, i.price - sd.value) * i.quantity, 0);
    if (amount === 0) return { amount: 0, applied: false, reason: 'Giá hiện tại đã thấp hơn hoặc bằng giá nhân viên báo' };
  }
  amount = Math.min(amount, base);
  return { amount, applied: amount > 0 };
}

export function describeStaffDiscount(sd) {
  let text;
  if (sd.kind === 'amount') text = `giảm ${formatVND(sd.value)}${sd.perUnit ? '/sản phẩm' : ' trên tổng'}`;
  else if (sd.kind === 'percent') text = `giảm ${sd.value}%`;
  else text = `giá ${formatVND(sd.value)}/sản phẩm`;
  if (sd.productName) text += ` cho ${sd.productName}`;
  if (sd.minQuantity > 0) text += `, từ ${sd.minQuantity} sản phẩm`;
  return text;
}

export function cartTotals(cart, settings, sd = null) {
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discount = staffDiscountAmount(cart, sd).amount;
  // Ngưỡng miễn ship tính trên tiền sau khi giảm
  const freeShip = settings.freeShippingThreshold > 0 && subtotal - discount >= settings.freeShippingThreshold;
  const shippingFee = cart.length === 0 || freeShip ? 0 : settings.shippingFee;
  return { subtotal, discount, shippingFee, total: subtotal - discount + shippingFee };
}

// Dạng gọn để trả về cho model trong tool result
export function describeCart(cart, settings, sd = null) {
  const { subtotal, discount, shippingFee, total } = cartTotals(cart, settings, sd);
  const sdInfo = sd ? staffDiscountAmount(cart, sd) : null;
  return {
    items: cart.map((i) => ({
      product_id: String(i.product),
      sku: i.sku,
      name: i.name,
      unit: i.unit,
      price: i.price,
      original_price: i.listPrice > i.price ? i.listPrice : undefined,
      promotion: i.promotion?.name,
      quantity: i.quantity,
      line_total: i.price * i.quantity,
    })),
    subtotal,
    discount,
    shipping_fee: shippingFee,
    total,
    ...(sd
      ? { staff_discount: { staff: sd.staffName, description: describeStaffDiscount(sd), applied: sdInfo.applied, amount: sdInfo.amount, reason: sdInfo.reason } }
      : {}),
    display: cart.length
      ? `${cart.map((i) => `${i.name} x${i.quantity}${i.promotion ? ` (KM: ${i.promotion.name})` : ''} = ${formatVND(i.price * i.quantity)}`).join('; ')} | Tạm tính ${formatVND(subtotal)}${discount > 0 ? `, giảm theo nhân viên -${formatVND(discount)}` : ''}, ship ${formatVND(shippingFee)}, tổng ${formatVND(total)}`
      : 'Giỏ hàng trống',
  };
}
