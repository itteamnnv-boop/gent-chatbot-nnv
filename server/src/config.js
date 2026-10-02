import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Luôn đọc server/.env dù chạy lệnh từ thư mục nào
export const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(serverRoot, '.env'), quiet: true });

const env = process.env;

export const config = {
  env: env.NODE_ENV || 'development',
  port: Number(env.PORT || 4000),
  clientOrigin: env.CLIENT_ORIGIN || 'http://localhost:5173',
  mongoUri: process.argv.includes('--memory-db') ? 'memory' : env.MONGODB_URI || 'mongodb://127.0.0.1:27017/sales_agent',
  openai: {
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL || 'gpt-4.1-mini',
  },
  admin: {
    username: env.ADMIN_USERNAME || 'admin',
    password: env.ADMIN_PASSWORD || 'admin123',
  },
  jwtSecret: env.JWT_SECRET || 'dev-only-secret',
  meta: {
    verifyToken: env.META_VERIFY_TOKEN || '',
    appSecret: env.META_APP_SECRET || '',
    appId: env.META_APP_ID || '',
    oauthRedirectUri: env.META_OAUTH_REDIRECT_URI || '',
    pageAccessToken: env.META_PAGE_ACCESS_TOKEN || '',
    waPhoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
    waAccessToken: env.WHATSAPP_ACCESS_TOKEN || '',
    graphVersion: env.META_GRAPH_VERSION || 'v21.0',
  },
  agent: {
    historyLimit: 20, // số tin nhắn gần nhất đưa vào ngữ cảnh
    maxToolSteps: 6, // số vòng gọi tool tối đa mỗi lượt
  },
};

export function assertProductionConfig() {
  if (config.env !== 'production') return;
  const problems = [];
  if (config.jwtSecret === 'dev-only-secret') problems.push('JWT_SECRET');
  if (config.admin.password === 'admin123') problems.push('ADMIN_PASSWORD');
  if (!config.openai.apiKey) problems.push('OPENAI_API_KEY');
  if (problems.length) throw new Error(`Thiếu/không an toàn cấu hình production: ${problems.join(', ')}`);
}
