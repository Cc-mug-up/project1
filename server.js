const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const multer = require('multer');
const { Server } = require('socket.io');

// ── MongoDB ──────────────────────────────────────────────
const { connectDB } = require('./models/db');
const User = require('./models/User');
const Clipboard = require('./models/Clipboard');
const Expense = require('./models/Expense');
const Message = require('./models/Message');
const FileMeta = require('./models/FileMeta');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 3000;

app.use(express.json());

// 禁用缓存
app.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// ── 文件上传目录 ────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// ── Multer 配置 ─────────────────────────────────────────
function fixFilename(name) {
  if (!name) return name;
  if (/[一-鿿㐀-䶿]/.test(name)) return name;
  try {
    const recovered = Buffer.from(name, 'latin1').toString('utf8');
    if (/[一-鿿㐀-䶿]/.test(recovered)) return recovered;
  } catch (_) {}
  return name;
}

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (_req, file, cb) => cb(null, fixFilename(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

// ── 文件闪传 API（HTTP：元数据走 DB，文件本身存磁盘） ───
app.get('/api/files', async (_req, res) => {
  const list = await FileMeta.find().sort({ date: -1 });
  const onDisk = new Set(fs.readdirSync(UPLOADS_DIR));
  res.json(list.filter(f => onDisk.has(f.name)));
});

app.post('/api/files/upload', (req, res, next) => {
  req.setTimeout(0); next();
}, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: '文件超过 500MB 限制' });
      return res.status(500).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  const entry = await FileMeta.findOneAndUpdate(
    { name: req.file.filename },
    { name: req.file.filename, size: req.file.size, date: new Date(), type: req.file.mimetype },
    { upsert: true, returnDocument: 'after' }
  );
  res.json(entry);
});

app.get('/api/files/download/:name', (req, res) => {
  const filePath = path.join(UPLOADS_DIR, req.params.name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'not found' });
  res.download(filePath);
});

app.delete('/api/files/:name', async (req, res) => {
  const filePath = path.join(UPLOADS_DIR, req.params.name);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  await FileMeta.deleteOne({ name: req.params.name });
  res.json({ ok: true });
});

// ── 剪贴板 API（HTTP 兜底） ──────────────────────────────
app.get('/api/clipboard', async (_req, res) => {
  const data = await Clipboard.getContent();
  res.json(data);
});

app.post('/api/clipboard', async (req, res) => {
  const { content } = req.body;
  if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
  const data = await Clipboard.setContent(content);
  res.json(data);
});

// ── 记账 API ────────────────────────────────────────────
app.get('/api/expenses', async (_req, res) => {
  res.json(await Expense.find().sort({ date: -1 }));
});

app.post('/api/expenses', async (req, res) => {
  try {
    const { amount, category, description, payer } = req.body;
    if (!amount || !payer) return res.status(400).json({ error: 'amount and payer required' });
    await User.ensureExists(payer.trim());
    const expense = await Expense.create({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      amount: parseFloat(amount), category: category || '其他',
      description: description || '', payer: payer.trim(), date: new Date()
    });
    res.json(expense);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/expenses/:id', async (req, res) => {
  const doc = await Expense.findOneAndDelete({ id: req.params.id });
  if (!doc) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

app.get('/api/balances', async (_req, res) => {
  const list = await Expense.find();
  const totals = {};
  list.forEach(e => { totals[e.payer] = (totals[e.payer] || 0) + e.amount; });
  const names = Object.keys(totals);
  const totalAll = Object.values(totals).reduce((s, v) => s + v, 0);
  const perPerson = names.length > 0 ? totalAll / names.length : 0;

  const balances = names.map(name => ({
    name, paid: Math.round(totals[name] * 100) / 100,
    share: Math.round(perPerson * 100) / 100,
    balance: Math.round((totals[name] - perPerson) * 100) / 100
  }));

  const creditors = balances.filter(b => b.balance > 0).sort((a, b) => b.balance - a.balance);
  const debtors = balances.filter(b => b.balance < 0).sort((a, b) => a.balance - b.balance);
  const settlements = [];
  let ci = 0, di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const c = creditors[ci], d = debtors[di];
    const amount = Math.min(c.balance, -d.balance);
    settlements.push({ from: d.name, to: c.name, amount: Math.round(amount * 100) / 100 });
    c.balance -= amount; d.balance += amount;
    if (c.balance < 0.01) ci++;
    if (d.balance > -0.01) di++;
  }
  res.json({ members: names, totalAll: Math.round(totalAll * 100) / 100,
    perPerson: Math.round(perPerson * 100) / 100, balances, settlements });
});

// ── 留言板 API（HTTP 兜底） ──────────────────────────────
app.get('/api/messages', async (_req, res) => {
  res.json(await Message.find().sort({ date: -1 }).limit(200));
});

app.post('/api/messages', async (req, res) => {
  try {
    const { author, content } = req.body;
    if (!author || !content) return res.status(400).json({ error: 'author and content required' });
    await User.ensureExists(author.trim());
    const msg = await Message.create({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      author: author.trim(), content: content.trim(), date: new Date()
    });
    res.json(msg);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/messages/:id', async (req, res) => {
  const doc = await Message.findOneAndDelete({ id: req.params.id });
  if (!doc) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

// ── Socket.io 实时通信 ──────────────────────────────────
io.on('connection', (socket) => {
  const ip = socket.handshake.address;
  console.log(`[WS] 设备接入: ${ip}`);

  // 剪贴板推送
  socket.on('clipboard:push', async ({ content }) => {
    if (typeof content !== 'string') return;
    const data = await Clipboard.setContent(content);
    socket.broadcast.emit('clipboard:update', data);
  });

  // 剪贴板拉取
  socket.on('clipboard:pull', async () => {
    const data = await Clipboard.getContent();
    socket.emit('clipboard:update', data);
  });

  // 留言板发送
  socket.on('message:send', async ({ author, content }) => {
    if (!author || !content) return;
    await User.ensureExists(author.trim());
    const msg = await Message.create({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      author: author.trim(), content: content.trim(), date: new Date()
    });
    io.emit('message:new', msg);
    io.emit('message:count', await Message.countDocuments());
  });

  // 留言板删除
  socket.on('message:delete', async ({ id }) => {
    await Message.findOneAndDelete({ id });
    io.emit('message:removed', { id });
    io.emit('message:count', await Message.countDocuments());
  });

  // 留言板拉取全部
  socket.on('messages:get', async () => {
    socket.emit('messages:all', await Message.find().sort({ date: -1 }).limit(200));
  });

  // ── WebRTC 信令中继 ────────────────────────────────────
  socket.join('p2p-room');

  // 广播全量设备列表
  const pushPeerList = () => {
    io.in('p2p-room').fetchSockets().then(sockets => {
      sockets.forEach(s => {
        const peers = sockets.filter(o => o.id !== s.id).map(o => ({ id: o.id, ip: o.handshake.address }));
        io.to(s.id).emit('p2p:peers', peers);
      });
    });
  };
  pushPeerList();

  socket.on('p2p:signal', ({ to, type, data }) => {
    io.to(to).emit('p2p:signal', { from: socket.id, type, data });
  });
  socket.on('p2p:file-request', ({ to, fileInfo }) => {
    io.to(to).emit('p2p:file-request', { from: socket.id, fileInfo });
  });
  socket.on('p2p:file-response', ({ to, accepted }) => {
    io.to(to).emit('p2p:file-response', { from: socket.id, accepted });
  });

  socket.on('disconnect', () => {
    console.log(`[WS] 设备断开: ${ip}`);
    pushPeerList();
  });
});

// ── 服务器信息 ──────────────────────────────────────────
app.get('/api/server-info', (_req, res) => {
  res.json({ ips: getLocalIPs(), port: PORT });
});

function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        if (iface.address.startsWith('169.254.')) continue;
        if (name.includes('VMware') || name.includes('vEthernet')) continue;
        ips.push({ name, ip: iface.address });
      }
    }
  }
  ips.sort((a, b) => {
    const p = n => n.includes('WLAN') || n.includes('Wi-Fi') ? 0 : n.includes('以太') ? 1 : 2;
    return p(a.name) - p(b.name);
  });
  return ips;
}

// ── 启动 ────────────────────────────────────────────────
(async () => {
  await connectDB();

  server.timeout = 0;
  server.listen(PORT, '0.0.0.0', () => {
    const ips = getLocalIPs();
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  寝室智控中心 v2.0 — MongoDB 版');
    console.log(`  本机访问: http://localhost:${PORT}`);
    ips.forEach(({ name, ip }) => console.log(`  ${name}:  http://${ip}:${PORT}`));
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  });
})();
