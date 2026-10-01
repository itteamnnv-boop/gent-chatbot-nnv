import path from 'node:path';
import mongoose from 'mongoose';
import { serverRoot } from './config.js';

let memoryServer = null;

export async function connectDB(uri) {
  if (uri === 'memory') {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    // Cố định thư mục cache binary mongod, tránh tải lại khi chạy từ thư mục khác
    memoryServer = await MongoMemoryServer.create({
      binary: { downloadDir: path.join(serverRoot, 'node_modules/.cache/mongodb-memory-server') },
    });
    uri = memoryServer.getUri('sales_agent');
  }
  await mongoose.connect(uri);
  return uri;
}

export async function disconnectDB() {
  await mongoose.disconnect();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}
