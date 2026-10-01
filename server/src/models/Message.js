import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    // customer: khách | bot: AI agent | agent: nhân viên | system: sự kiện hệ thống
    role: { type: String, enum: ['customer', 'bot', 'agent', 'system'], required: true },
    text: { type: String, required: true },
    // mid của Meta để chống xử lý trùng khi webhook gửi lại
    externalId: { type: String },
    // Log các tool AI đã gọi trong lượt này (để admin debug)
    toolCalls: { type: [mongoose.Schema.Types.Mixed], default: undefined },
  },
  { timestamps: true },
);

messageSchema.index({ externalId: 1 }, { unique: true, partialFilterExpression: { externalId: { $type: 'string' } } });
messageSchema.index({ conversation: 1, createdAt: -1 });

export const Message = mongoose.model('Message', messageSchema);
