export const formatVND = (n) => `${new Intl.NumberFormat('vi-VN').format(Math.round(n || 0))}đ`;

export const formatTime = (d) =>
  d ? new Date(d).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '';

export function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)} phút`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} ngày`;
  return `${Math.floor(s / (7 * 86400))} tuần`;
}

// Mốc thời gian giữa các cụm tin nhắn kiểu Messenger: "14:05" hôm nay, "T4 14:05" trong tuần, ngày/tháng nếu cũ hơn
export function separatorTime(d) {
  const date = new Date(d);
  const now = new Date();
  const hm = date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return hm;
  if (now - date < 6 * 86400000) return `${['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][date.getDay()]} ${hm}`;
  return `${date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })} ${hm}`;
}

const gapMinutes = (a, b) => (new Date(b.createdAt) - new Date(a.createdAt)) / 60000;

/**
 * Gom tin nhắn liên tiếp cùng phía thành cụm (bo góc, avatar ở tin cuối cụm như Messenger).
 * @param {(m) => 'me'|'them'|'system'} sideOf
 */
export function groupMessages(list, sideOf) {
  return list.map((m, i) => {
    const side = sideOf(m);
    const prev = list[i - 1];
    const next = list[i + 1];
    const showTime = !prev || gapMinutes(prev, m) >= 15;
    const joinPrev = prev && !showTime && sideOf(prev) === side && side !== 'system';
    const joinNext = next && gapMinutes(m, next) < 15 && sideOf(next) === side && side !== 'system';
    return { m, side, first: !joinPrev, last: !joinNext, showTime };
  });
}

export const CHANNEL_LABEL ={ web: 'Website', messenger: 'Messenger', instagram: 'Instagram', whatsapp: 'WhatsApp' };

export const STAGE_LABEL = {
  new: 'Mới',
  consulting: 'Đang tư vấn',
  cart: 'Có giỏ hàng',
  checkout: 'Chốt thông tin',
  ordered: 'Đã đặt hàng',
  handoff: 'Chờ nhân viên',
};

export const ORDER_STATUS_LABEL = {
  new: 'Mới',
  confirmed: 'Đã xác nhận',
  shipping: 'Đang giao',
  completed: 'Hoàn thành',
  cancelled: 'Đã huỷ',
};
