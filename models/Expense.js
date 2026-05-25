const { mongoose } = require('./db');

const expenseSchema = new mongoose.Schema({
  id:    { type: String, required: true, unique: true },
  amount:{ type: Number, required: true, min: 0.01 },
  category:    { type: String, default: '其他' },
  description: { type: String, default: '' },
  payer:       { type: String, required: true, ref: 'User' },  // 外键 → User.name
  date:        { type: Date, default: Date.now }
});

expenseSchema.index({ date: -1 });
expenseSchema.index({ payer: 1 });

module.exports = mongoose.model('Expense', expenseSchema);
