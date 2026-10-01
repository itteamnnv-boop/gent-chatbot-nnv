import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { connectDB, disconnectDB } from '../src/db.js';
import { Product } from '../src/models/Product.js';
import { seedDatabase } from '../src/seedData.js';
import { chunkDocument, importPriceList, parseNumber } from '../src/services/infoImport.js';

describe('Nhập bảng giá & tài liệu', () => {
  before(async () => {
    await connectDB('memory');
    await seedDatabase();
  });
  after(disconnectDB);

  it('đọc số tiền nhiều định dạng', () => {
    assert.equal(parseNumber('420.000đ'), 420000);
    assert.equal(parseNumber('1,050,000'), 1050000);
    assert.equal(parseNumber(399000), 399000);
    assert.equal(parseNumber('liên hệ'), null);
  });

  it('cập nhật theo SKU, tạo mới, báo lỗi từng dòng', async () => {
    const r = await importPriceList([
      { sku: 'NPK-16168', price: '450.000đ' }, // cập nhật giá, giữ nguyên tên
      { sku: 'MOI-01', name: 'Sản phẩm mới', price: '100000', stock: '5', unit: 'gói' },
      { sku: 'MOI-02', name: 'Thiếu giá' },
      { sku: '', name: 'Không có SKU', price: 1 },
      { sku: 'URE-46', price: 'liên hệ' },
    ]);
    assert.equal(r.updated, 1);
    assert.equal(r.created, 1);
    assert.equal(r.errorCount, 3);

    const npk = await Product.findOne({ sku: 'NPK-16168' });
    assert.equal(npk.price, 450000);
    assert.equal(npk.name, 'Phân NPK 16-16-8+TE');
    const created = await Product.findOne({ sku: 'MOI-01' }).select('+searchText');
    assert.equal(created.stock, 5);
    assert.match(created.searchText, /san pham moi/);
  });

  it('chia tài liệu theo đoạn, giới hạn độ dài', () => {
    const text = `# Chính sách bảo hành\nBảo hành 12 tháng.\n\n${'Đoạn dài. '.repeat(300)}\n\nLiên hệ hotline.`;
    const chunks = chunkDocument('chinh-sach.md', text, 1200);
    assert.ok(chunks.length >= 3);
    assert.equal(chunks[0].title, 'Chính sách bảo hành');
    assert.ok(chunks.every((c) => c.content.length <= 1200));
    assert.deepEqual(chunks[0].tags, ['chinh-sach.md']);
  });
});
