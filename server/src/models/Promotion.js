import mongoose from 'mongoose';

export const PROMO_TYPES = ['percent', 'fixed'];
export const PROMO_SCOPES = ['all', 'pages'];
export const PRODUCT_SCOPES = ['all', 'products'];

const promotionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 1000 }, // AI đọc để giới thiệu cho khách
    type: { type: String, enum: PROMO_TYPES, required: true },
    value: { type: Number, required: true, min: 0 },
    scope: { type: String, enum: PROMO_SCOPES, default: 'all' },
    pageIds: { type: [String], default: [] },
    productScope: { type: String, enum: PRODUCT_SCOPES, default: 'all' },
    productIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
    active: { type: Boolean, default: true },
    createdBy: { type: String, default: '' },
  },
  { timestamps: true },
);

promotionSchema.index({ active: 1, scope: 1 });

export const Promotion = mongoose.model('Promotion', promotionSchema);
