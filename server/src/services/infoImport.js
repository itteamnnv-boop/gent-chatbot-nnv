import { Product } from '../models/Product.js';

// "420.000đ", "1,050,000", "399000" -> số nguyên VND; không có chữ số -> null
export function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  const digits = String(value ?? '').replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

const TEXT_FIELDS = ['name', 'unit', 'category', 'description'];
const NUMBER_FIELDS = ['price', 'salePrice', 'stock'];

/**
 * Nhập bảng giá: cập nhật sản phẩm có SKU sẵn, tạo mới nếu chưa có (cần tên + giá).
 * Chỉ ghi các cột có giá trị, cột trống giữ nguyên dữ liệu cũ.
 */
export async function importPriceList(rows) {
  let created = 0;
  let updated = 0;
  const errors = [];

  for (const [i, raw] of rows.entries()) {
    const line = i + 2; // dòng 1 của file là tiêu đề
    const sku = String(raw?.sku ?? '').trim();
    if (!sku) {
      errors.push(`Dòng ${line}: thiếu mã SKU`);
      continue;
    }
    const data = {};
    for (const k of TEXT_FIELDS) {
      const v = raw[k] == null ? '' : String(raw[k]).trim();
      if (v) data[k] = v;
    }
    let bad = null;
    for (const k of NUMBER_FIELDS) {
      if (raw[k] == null || String(raw[k]).trim() === '') continue;
      const n = parseNumber(raw[k]);
      if (n == null) bad = `cột ${k} không phải số`;
      else data[k] = n;
    }
    if (bad) {
      errors.push(`Dòng ${line} (${sku}): ${bad}`);
      continue;
    }

    try {
      const product = await Product.findOne({ sku });
      if (product) {
        product.set(data);
        await product.save();
        updated += 1;
      } else if (!data.name || data.price == null) {
        errors.push(`Dòng ${line} (${sku}): sản phẩm mới cần có tên và giá`);
      } else {
        await Product.create({ sku, ...data });
        created += 1;
      }
    } catch (err) {
      errors.push(`Dòng ${line} (${sku}): ${err.message}`);
    }
  }
  return { created, updated, errorCount: errors.length, errors: errors.slice(0, 50) };
}

/**
 * Chia tài liệu thành các đoạn ~1200 ký tự (theo đoạn văn) để AI tra cứu bằng search_knowledge.
 * @returns {Array<{title, content, tags}>}
 */
export function chunkDocument(fileName, text, max = 1200) {
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p) => (p.length <= max ? [p] : p.match(new RegExp(`[\\s\\S]{1,${max}}`, 'g'))));

  const chunks = [];
  let current = '';
  for (const p of paragraphs) {
    if (current && current.length + p.length + 2 > max) {
      chunks.push(current);
      current = '';
    }
    current = current ? `${current}\n\n${p}` : p;
  }
  if (current) chunks.push(current);

  return chunks.slice(0, 300).map((content, i) => {
    const firstLine = content.split('\n')[0].replace(/^#+\s*/, '').trim();
    const title = firstLine.length >= 4 && firstLine.length <= 100 ? firstLine : `${fileName} (phần ${i + 1})`;
    return { title, content, tags: [fileName] };
  });
}
