import mongoose from 'mongoose';

// Cấu hình agent (một bản ghi duy nhất) — tương đương phần "set your tone,
// configure your knowledge, define when to hand off" của Meta Business Agent
const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'default', unique: true },
    botEnabled: { type: Boolean, default: true },
    botName: { type: String, default: 'Trợ lý bán hàng' },
    businessName: { type: String, default: 'Cửa hàng của tôi' },
    tone: { type: String, default: 'Thân thiện, lịch sự, xưng "em" và gọi khách là "anh/chị". Ngắn gọn, đi thẳng vào vấn đề.' },
    greeting: { type: String, default: 'Xin chào anh/chị! Em có thể giúp gì cho mình ạ?' },
    // Thông tin cơ bản
    businessInfo: { type: String, default: '' },
    hotline: { type: String, default: '' },
    address: { type: String, default: '' },
    openingHours: { type: String, default: '' },
    // Mua hàng và vận chuyển
    policies: { type: String, default: '' },
    // Thanh toán
    paymentInfo: { type: String, default: '' },
    // Thời điểm cập nhật từng mục ở trang "Thông tin của bạn"
    sectionUpdatedAt: {
      basic: Date,
      shipping: Date,
      payment: Date,
      priceList: Date,
    },
    customInstructions: { type: String, default: '' },
    shippingFee: { type: Number, default: 30000, min: 0 },
    freeShippingThreshold: { type: Number, default: 0, min: 0 }, // 0 = không miễn phí ship
    handoffKeywords: { type: [String], default: ['gặp nhân viên', 'gặp người thật', 'nói chuyện với người', 'tư vấn viên'] },
    handoffRules: {
      type: String,
      default: 'Khách khiếu nại, đòi hoàn tiền, phàn nàn về chất lượng; yêu cầu giá sỉ/số lượng lớn cần báo giá riêng; câu hỏi em không có thông tin để trả lời.',
    },
    handoffMessage: { type: String, default: 'Dạ em đã chuyển cuộc trò chuyện cho nhân viên, anh/chị vui lòng đợi trong giây lát ạ.' },
    model: { type: String, default: '' }, // trống = dùng OPENAI_MODEL
    temperature: { type: Number, default: 0.4, min: 0, max: 1.5 },
  },
  { timestamps: true },
);

settingsSchema.statics.get = async function getSettings() {
  return this.findOneAndUpdate({ key: 'default' }, { $setOnInsert: { key: 'default' } }, { upsert: true, returnDocument: 'after' });
};

export const Settings = mongoose.model('Settings', settingsSchema);
