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
    quantity: { type: Number, min: 1, required: true },
  },
  { _id: false },
);

const conversationSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    channel: { type: String, enum: CHANNELS, required: true },
    externalId: { type: String, required: true },
    // "Thread control" giống Meta: bot đang giữ hội thoại hay nhân viên đã tiếp quản
    mode: { type: String, enum: ['bot', 'human'], default: 'bot' },
    stage: { type: String, enum: STAGES, default: 'new' },
    handoffReason: { type: String, default: '' },
    needsAttention: { type: Boolean, default: false },
    cart: { type: [cartItemSchema], default: [] },
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
