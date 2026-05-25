const { mongoose } = require('./db');

const clipboardSchema = new mongoose.Schema({
  _id: { type: String, default: 'singleton' },   // 永远只有一条文档
  content: { type: String, default: '' },
  updatedAt: { type: Date, default: null }
});

// 读取剪贴板（单例模式）
clipboardSchema.statics.getContent = async function() {
  return this.findById('singleton') || { content: '', updatedAt: null };
};

// 写入剪贴板
clipboardSchema.statics.setContent = async function(content) {
  return this.findOneAndUpdate(
    { _id: 'singleton' },
    { content, updatedAt: new Date() },
    { upsert: true, returnDocument: 'after' }
  );
};

module.exports = mongoose.model('Clipboard', clipboardSchema);
