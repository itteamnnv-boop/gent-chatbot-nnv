import { assertProductionConfig, config } from './config.js';
import { connectDB } from './db.js';
import { createApp } from './app.js';
import { Product } from './models/Product.js';
import { seedDatabase } from './seedData.js';

assertProductionConfig();

const uri = await connectDB(config.mongoUri);
console.log(`MongoDB đã kết nối${config.mongoUri === 'memory' ? ' (in-memory)' : ''}`);

// Chế độ in-memory: tự nạp dữ liệu mẫu để demo ngay
if (config.mongoUri === 'memory' && (await Product.estimatedDocumentCount()) === 0) {
  await seedDatabase();
  console.log('Đã nạp dữ liệu mẫu');
}

if (!config.openai.apiKey) console.warn('⚠ OPENAI_API_KEY chưa cấu hình — bot sẽ trả lời "hệ thống đang bận"');

const { server } = createApp();
server.listen(config.port, () => {
  console.log(`Server chạy tại http://localhost:${config.port} (db: ${uri.replace(/\/\/[^@]*@/, '//***@')})`);
});
