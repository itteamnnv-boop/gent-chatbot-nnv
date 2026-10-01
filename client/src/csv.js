// Đọc bảng giá CSV/TSV (Excel: File > Save As > CSV UTF-8). Tự nhận dấu phân cách , ; hoặc tab.
export function parseCSV(input) {
  const text = input.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/)[0] || '';
  const delim = [',', ';', '\t'].reduce((best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best), ',');

  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const strip = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Tên cột chấp nhận được (không dấu, chữ thường)
const ALIASES = {
  sku: ['sku', 'ma', 'ma sp', 'ma san pham', 'ma hang', 'code'],
  name: ['name', 'ten', 'ten sp', 'ten san pham', 'ten hang', 'san pham'],
  price: ['price', 'gia', 'gia ban', 'don gia', 'gia goc', 'gia niem yet'],
  salePrice: ['saleprice', 'sale price', 'gia km', 'gia khuyen mai', 'gia giam', 'gia uu dai'],
  unit: ['unit', 'don vi', 'dvt', 'don vi tinh', 'quy cach'],
  stock: ['stock', 'ton kho', 'ton', 'so luong', 'sl'],
  category: ['category', 'danh muc', 'loai', 'nhom', 'nhom hang'],
  description: ['description', 'mo ta', 'ghi chu', 'mo ta san pham'],
};
export const FIELD_LABEL = {
  sku: 'Mã SKU', name: 'Tên', price: 'Giá', salePrice: 'Giá KM', unit: 'Đơn vị', stock: 'Tồn kho', category: 'Danh mục', description: 'Mô tả',
};

/** Dòng đầu là tiêu đề → map sang trường sản phẩm. */
export function rowsToProducts(rows) {
  const [header = [], ...body] = rows;
  const mapping = header.map((h) => {
    const key = strip(h);
    const exact = Object.keys(ALIASES).find((f) => ALIASES[f].includes(key));
    if (exact) return exact;
    return key.split(' ').includes('sku') ? 'sku' : null; // "Mã SKU", "SKU code"...
  });
  const items = body.map((r) => Object.fromEntries(mapping.map((f, i) => [f, r[i]?.trim()]).filter(([f]) => f)));
  return {
    columns: mapping.filter(Boolean),
    unknown: header.filter((_, i) => !mapping[i]),
    items,
  };
}

export const PRICE_LIST_TEMPLATE =
  'Mã SKU,Tên sản phẩm,Giá bán,Giá khuyến mãi,Đơn vị,Tồn kho,Danh mục,Mô tả\n' +
  'NPK-16168,Phân NPK 16-16-8+TE,420000,399000,bao 25kg,200,Phân NPK,Bón thúc cho lúa và rau màu\n';
