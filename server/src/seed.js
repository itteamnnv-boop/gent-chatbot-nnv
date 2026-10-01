// Nạp dữ liệu mẫu vào MONGODB_URI. Dùng --reset để xoá sản phẩm/kiến thức cũ trước.
import { config } from './config.js';
import { connectDB, disconnectDB } from './db.js';
import { seedDatabase } from './seedData.js';

await connectDB(config.mongoUri);
await seedDatabase({ reset: process.argv.includes('--reset') });
console.log('Đã nạp dữ liệu mẫu');
await disconnectDB();
