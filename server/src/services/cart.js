import { formatVND } from '../utils/text.js';

export function cartTotals(cart, settings) {
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const freeShip = settings.freeShippingThreshold > 0 && subtotal >= settings.freeShippingThreshold;
  const shippingFee = cart.length === 0 || freeShip ? 0 : settings.shippingFee;
  return { subtotal, shippingFee, total: subtotal + shippingFee };
}

// Dạng gọn để trả về cho model trong tool result
export function describeCart(cart, settings) {
  const { subtotal, shippingFee, total } = cartTotals(cart, settings);
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
    shipping_fee: shippingFee,
    total,
    display: cart.length
      ? `${cart.map((i) => `${i.name} x${i.quantity}${i.promotion ? ` (KM: ${i.promotion.name})` : ''} = ${formatVND(i.price * i.quantity)}`).join('; ')} | Tạm tính ${formatVND(subtotal)}, ship ${formatVND(shippingFee)}, tổng ${formatVND(total)}`
      : 'Giỏ hàng trống',
  };
}
