import mongoose from 'mongoose';

// "test" = đoạn chat thử nghiệm của chủ shop trong trang quản trị
export const CHANNELS = ['web', 'messenger', 'instagram', 'whatsapp', 'test'];

const customerSchema = new mongoose.Schema(
  {
    channel: { type: String, enum: CHANNELS, required: true },
    // PSID (Messenger), IGSID (Instagram), số WhatsApp, hoặc sessionId (web)
    externalId: { type: String, required: true },
    name: { type: String, default: '' },
    phone: { type: String, default: '' },
    address: { type: String, default: '' },
  },
  { timestamps: true },
);

customerSchema.index({ channel: 1, externalId: 1 }, { unique: true });
customerSchema.index({ phone: 1 });

export const Customer = mongoose.model('Customer', customerSchema);
