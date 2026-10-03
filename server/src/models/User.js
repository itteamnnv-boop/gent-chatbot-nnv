import mongoose from 'mongoose';
import { PERMISSION_KEYS, ROLES } from '../permissions.js';

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true, lowercase: true, match: /^[a-z0-9._-]{3,32}$/ },
    displayName: { type: String, default: '', trim: true, maxlength: 80 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: 'staff' },
    permissions: { type: [String], enum: PERMISSION_KEYS, default: [] },
    // Phạm vi Hộp thư/Đơn hàng của nhân viên: 'all' = mọi Page và kênh, 'pages' = chỉ Page được giao
    inboxScope: { type: String, enum: ['all', 'pages'], default: 'all' },
    pageIds: { type: [String], default: [] },
    // Chỉ có nghĩa khi inboxScope = 'pages': được xem cả hội thoại ngoài Fanpage
    inboxOther: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    // Tăng khi đổi mật khẩu để vô hiệu token cũ
    tokenVersion: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        delete ret.passwordHash;
        delete ret.tokenVersion;
        return ret;
      },
    },
  },
);

export const User = mongoose.model('User', userSchema);
