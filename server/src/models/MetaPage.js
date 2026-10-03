import mongoose from 'mongoose';

export const PAGE_STATUSES = ['active', 'invalid'];

const metaPageSchema = new mongoose.Schema(
  {
    pageId: { type: String, required: true, unique: true, match: /^\d{1,32}$/ },
    name: { type: String, default: '' },
    accessToken: { type: String, required: true, select: false },
    tasks: { type: [String], default: [] },
    status: { type: String, enum: PAGE_STATUSES, default: 'active' },
    lastError: { type: String, default: '' },
    // Bật/tắt trả lời tự động của bot cho riêng Page này (công tắc tổng ở Settings.botEnabled)
    botEnabled: { type: Boolean, default: true },
    connectedBy: { type: String, default: '' },
    connectedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        delete ret.accessToken;
        return ret;
      },
    },
  },
);

export const MetaPage = mongoose.model('MetaPage', metaPageSchema);
