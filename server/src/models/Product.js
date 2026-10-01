import mongoose from 'mongoose';
import { normalize } from '../utils/text.js';

const productSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, default: '', trim: true },
    description: { type: String, default: '' },
    // Hướng dẫn sử dụng / thông tin kỹ thuật để AI tư vấn
    usage: { type: String, default: '' },
    price: { type: Number, required: true, min: 0 },
    salePrice: { type: Number, min: 0, default: null },
    unit: { type: String, default: 'sản phẩm' },
    stock: { type: Number, default: 0, min: 0 },
    images: [String],
    tags: [String],
    active: { type: Boolean, default: true },
    searchText: { type: String, select: false },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

productSchema.virtual('effectivePrice').get(function effectivePrice() {
  return this.salePrice != null && this.salePrice < this.price ? this.salePrice : this.price;
});

productSchema.pre('validate', function buildSearchText() {
  this.searchText = normalize([this.sku, this.name, this.category, (this.tags || []).join(' '), this.description].join(' '));
});

productSchema.index({ active: 1, category: 1 });

export const Product = mongoose.model('Product', productSchema);
