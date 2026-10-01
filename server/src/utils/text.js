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
