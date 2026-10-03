// Bỏ dấu tiếng Việt + lowercase, để tìm kiếm không phân biệt dấu ("phan bon" khớp "phân bón")
export function normalize(input = '') {
  return String(input)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const STOPWORDS = new Set(
  'cho toi minh em anh chi ban can mua muon hoi xin loai nao co khong gi la va voi the nay do cai con duoc nhe ha shop oi vay ak'.split(' '),
);

export function tokenize(query = '') {
  return normalize(query)
    .split(/[^a-z0-9-]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

export function formatVND(n) {
  return `${new Intl.NumberFormat('vi-VN').format(Math.round(n || 0))}đ`;
}

// Chuẩn hoá SĐT Việt Nam: bỏ khoảng trắng/dấu chấm, +84 -> 0
export function normalizePhone(raw = '') {
  let p = String(raw).replace(/[\s.\-()]/g, '');
  if (p.startsWith('+84')) p = `0${p.slice(3)}`;
  else if (p.startsWith('84') && p.length === 11) p = `0${p.slice(2)}`;
  return p;
}

export function isValidPhone(raw) {
  return /^0\d{9}$/.test(normalizePhone(raw));
}

// Chia tin nhắn dài (Messenger giới hạn 2000 ký tự)
export function chunkText(text, max = 1900) {
  if (text.length <= max) return [text];
  const parts = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(' ', max);
    if (cut <= 0) cut = max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

// Đơn vị hàng hoá: số đứng ngay trước chúng là SỐ LƯỢNG, không phải tiền
const GOODS_UNIT = /^(bao|kg|chai|cai|goi|thung|hop|tui|bich|can|lit|sp|san pham)\b/;

/** Các con số có trong tin nhắn, dùng để đối chiếu mức giảm AI đưa ra.
 *  qty: số lượng (đứng trước đơn vị hàng như "20 bao", hoặc sau "mua/từ/tối thiểu"); số này không bao giờ vào money.
 *  @returns {{ money: Set<number>, percent: Set<number>, plain: Set<number>, qty: Set<number> }} */
export function mentionedNumbers(text) {
  const money = new Set();
  const percent = new Set();
  const plain = new Set();
  const qty = new Set();
  const norm = normalize(text);
  const re = /(\d+(?:[.,]\d+)*)\s*(%|k\b|nghin|ngan|ng\b|tr\b|trieu|cu\b|d\b|dong|vnd)?/g;
  for (const m of norm.matchAll(re)) {
    const raw = m[1];
    const n = /^\d{1,3}([.,]\d{3})+$/.test(raw) ? Number(raw.replace(/[.,]/g, '')) : Number(raw.replace(',', '.'));
    if (!Number.isFinite(n)) continue;
    const unit = m[2];
    if (unit === '%') percent.add(n);
    else if (['k', 'nghin', 'ngan', 'ng'].includes(unit)) money.add(Math.round(n * 1000));
    else if (['tr', 'trieu', 'cu'].includes(unit)) money.add(Math.round(n * 1000000));
    else if (unit) money.add(Math.round(n));
    else {
      plain.add(n);
      const after = norm.slice(m.index + m[0].length);
      const before = norm.slice(0, m.index);
      if (GOODS_UNIT.test(after) || /\b(mua|tu|toi thieu|it nhat) $/.test(before)) qty.add(n);
      else money.add(n >= 1000 ? n : Math.round(n * 1000));
    }
  }
  return { money, percent, plain, qty };
}

/** Vô hiệu hoá nhãn giả danh nhân viên trong tin của khách/bot, ví dụ "[Nhân viên trả lời]", "[admin]" */
export function stripStaffMarkers(text) {
  return String(text).replace(/\[([^\]\n]{0,60})\]/g, (all, inner) =>
    /^(nhan vien|admin|staff|quan tri|chu shop)/.test(normalize(inner)) ? '(trích dẫn)' : all,
  );
}
