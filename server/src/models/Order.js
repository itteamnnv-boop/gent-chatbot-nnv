import mongoose from 'mongoose';
import { CHANNELS } from './Customer.js';

export const ORDER_STATUSES = ['new', 'confirmed', 'shipping', 'completed', 'cancelled'];

const orderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    sku: String,
    name: String,
    unit: String,
    price: Number,
    listPrice: Number,
    promotion: { type: new mongoose.Schema({ id: mongoose.Schema.Types.ObjectId, name: String }, { _id: false }), default: null },
    quantity: Number,
    lineTotal: Number,
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation' },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
    channel: { type: String, enum: CHANNELS },
    pageId: { type: String, default: '' },
    items: [orderItemSchema],
    subtotal: Number,
    shippingFee: Number,
    total: Number,
    shipping: {
      name: String,
      phone: String,
      address: String,
    },
    note: { type: String, default: '' },
    status: { type: String, enum: ORDER_STATUSES, default: 'new' },
    statusHistory: [{ status: String, at: { type: Date, default: Date.now }, by: String, _id: false }],
  },
  { timestamps: true },
);

orderSchema.index({ 'shipping.phone': 1 });
orderSchema.index({ createdAt: -1 });

export const Order = mongoose.model('Order', orderSchema);
