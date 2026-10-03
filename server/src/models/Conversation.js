import mongoose from 'mongoose';
import { CHANNELS } from './Customer.js';

export const STAGES = ['new', 'consulting', 'cart', 'checkout', 'ordered', 'handoff'];

const cartItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    sku: String,
    name: String,
    unit: String,
    price: Number,
    listPrice: Number,
    promotion: { type: new mongoose.Schema({ id: mongoose.Schema.Types.ObjectId, name: String }, { _id: false }), default: null },
    quantity: { type: Number, min: 1, required: true },
  },
  { _id: false },
);

// Ưu đãi riêng do nhân viên hứa trong hội thoại, AI áp qua apply_staff_discount
export const staffDiscountSchema = new mongoose.Schema(
  {
    messageId: { type: mongoose.Schema.Types.ObjectId, required: true },
    staffName: { type: String, default: '' },
    kind: { type: String, enum: ['amount', 'percent', 'unit_price'], required: true },
    value: { type: Number, required: true },
    perUnit: { type: Boolean, default: false },
    productId: { type: mongoose.Schema.Types.ObjectId, default: null },
    productName: { type: String, default: '' },
    minQuantity: { type: Number, default: 0 },
    note: { type: String, default: '' },
    appliedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const conversationSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    channel: { type: String, enum: CHANNELS, required: true },
    externalId: { type: String, required: true },
    // Page nhận tin (Messenger/Instagram) hoặc Page đang giả lập (Chat thử)
    pageId: { type: String, default: '' },
    // "Thread control" giống Meta: bot đang giữ hội thoại hay nhân viên đã tiếp quản
    mode: { type: String, enum: ['bot', 'human'], default: 'bot' },
    stage: { type: String, enum: STAGES, default: 'new' },
    handoffReason: { type: String, default: '' },
    needsAttention: { type: Boolean, default: false },
    cart: { type: [cartItemSchema], default: [] },
    staffDiscount: { type: staffDiscountSchema, default: null },
    checkout: {
      name: { type: String, default: '' },
      phone: { type: String, default: '' },
      address: { type: String, default: '' },
      note: { type: String, default: '' },
    },
    orders: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Order' }],
    unreadCount: { type: Number, default: 0 },
    lastMessageAt: { type: Date, default: Date.now },
    lastMessagePreview: { type: String, default: '' },
  },
  { timestamps: true },
);

conversationSchema.index({ channel: 1, externalId: 1 }, { unique: true });
conversationSchema.index({ lastMessageAt: -1 });

export const Conversation = mongoose.model('Conversation', conversationSchema);
