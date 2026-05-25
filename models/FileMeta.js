const { mongoose } = require('./db');

const fileMetaSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  size: { type: Number, required: true },
  date: { type: Date, default: Date.now },
  type: { type: String, default: 'application/octet-stream' }
});

module.exports = mongoose.model('FileMeta', fileMetaSchema);
