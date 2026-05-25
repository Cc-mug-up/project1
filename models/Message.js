const { mongoose } = require('./db');

const messageSchema = new mongoose.Schema({
  id:      { type: String, required: true, unique: true },
  author:  { type: String, required: true, ref: 'User' },  // 外键 → User.name
  content: { type: String, required: true, maxlength: 500 },
  date:    { type: Date, default: Date.now }
});

messageSchema.index({ date: -1 });

module.exports = mongoose.model('Message', messageSchema);
