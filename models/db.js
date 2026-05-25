const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/dorm-share';

async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log(`[DB] MongoDB 已连接: ${MONGO_URI}`);
  } catch (err) {
    console.error(`[DB] MongoDB 连接失败: ${err.message}`);
    console.error('[DB] 请确保 MongoDB 服务已启动 (mongod)');
    process.exit(1);
  }
}

module.exports = { connectDB, mongoose };
