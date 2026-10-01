import mongoose from 'mongoose';
import { normalize } from '../utils/text.js';

// Kho kiến thức (FAQ, chính sách, hướng dẫn) để agent tra cứu thay vì "bịa"
const knowledgeSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    content: { type: String, required: true },
    tags: [String],
    active: { type: Boolean, default: true },
    // "manual" = nhập tay; "file:<tên tệp>" = trích từ tài liệu tải lên (mục Nguồn)
    source: { type: String, default: 'manual', index: true },
    searchText: { type: String, select: false },
  },
  { timestamps: true },
);

knowledgeSchema.pre('validate', function buildSearchText() {
  this.searchText = normalize([this.title, (this.tags || []).join(' '), this.content].join(' '));
});

export const Knowledge = mongoose.model('Knowledge', knowledgeSchema);
