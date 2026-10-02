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
