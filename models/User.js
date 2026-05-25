const { mongoose } = require('./db');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true, maxlength: 20 },
  createdAt: { type: Date, default: Date.now }
});

// 记账和留言中引用的付款人/作者，自动写入用户表
userSchema.statics.ensureExists = async function(name) {
  if (!name) return null;
  return this.findOneAndUpdate(
    { name },
    { $setOnInsert: { name, createdAt: new Date() } },
    { upsert: true, returnDocument: 'after' }
  );
};

module.exports = mongoose.model('User', userSchema);
