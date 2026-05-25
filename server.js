const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const multer = require('multer');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 3000;

app.use(express.json());

// 禁用缓存（防止手机浏览器缓存旧版文件导致乱码）
app.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// ── 数据目录 ────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

const CLIPBOARD_FILE = path.join(DATA_DIR, 'clipboard.json');
const EXPENSES_FILE = path.join(DATA_DIR, 'expenses.json');
const FILES_META_FILE = path.join(DATA_DIR, 'files.json');

// ── Multer 配置 ─────────────────────────────────────────
function fixFilename(name) {
  if (!name) return name;
  // 如果已经包含 CJK 字符，说明 multer 正确解析了 UTF-8 文件名 → 直接返回
  if (/[一-鿿㐀-䶿]/.test(name)) return name;
  // 尝试 latin1→utf8 恢复（部分浏览器只发 filename 不含 filename*=UTF-8''）
  try {
    const recovered = Buffer.from(name, 'latin1').toString('utf8');
    if (/[一-鿿㐀-䶿]/.test(recovered)) return recovered;
  } catch (_) {}
  return name;
}

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (_req, file, cb) => {
    cb(null, fixFilename(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

// 文件元数据
function getFilesMeta() { return readJSON(FILES_META_FILE, []); }
function saveFilesMeta(list) { writeJSON(FILES_META_FILE, list); }
function syncFilesMeta() {
  const meta = getFilesMeta();
  const onDisk = new Set(fs.readdirSync(UPLOADS_DIR));
  return meta.filter(f => onDisk.has(f.name));
}

// ── 文件闪传 API ─────────────────────────────────────────
app.get('/api/files', (_req, res) => {
  res.json(syncFilesMeta());
});

app.post('/api/files/upload', (req, res, next) => {
  req.setTimeout(0);
  next();
}, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: '文件超过 500MB 限制' });
      return res.status(500).json({ error: err.message });
    }
    next();
  });
}, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  const meta = syncFilesMeta();
  const idx = meta.findIndex(f => f.name === req.file.filename);
  const entry = {
    name: req.file.filename,
    size: req.file.size,
    date: new Date().toISOString(),
    type: req.file.mimetype
  };
  if (idx >= 0) meta[idx] = entry; else meta.unshift(entry);
  saveFilesMeta(meta);
  res.json(entry);
});

app.get('/api/files/download/:name', (req, res) => {
  const filePath = path.join(UPLOADS_DIR, req.params.name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'not found' });
  res.download(filePath);
});

app.delete('/api/files/:name', (req, res) => {
  const filePath = path.join(UPLOADS_DIR, req.params.name);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  const meta = syncFilesMeta();
  saveFilesMeta(meta);
  res.json({ ok: true });
});

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); }
  catch { return fallback; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

// ── 剪贴板 API ──────────────────────────────────────────
app.get('/api/clipboard', (_req, res) => {
  const data = readJSON(CLIPBOARD_FILE, { content: '', updatedAt: null });
  res.json(data);
});

app.post('/api/clipboard', (req, res) => {
  const { content } = req.body;
  if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
  const data = { content, updatedAt: new Date().toISOString() };
  writeJSON(CLIPBOARD_FILE, data);
  res.json(data);
});

// ── 记账 API ────────────────────────────────────────────
function getExpenses() {
  return readJSON(EXPENSES_FILE, []);
}
function saveExpenses(list) {
  writeJSON(EXPENSES_FILE, list);
}

app.get('/api/expenses', (_req, res) => {
  res.json(getExpenses());
});

app.post('/api/expenses', (req, res) => {
  const { amount, category, description, payer } = req.body;
  if (!amount || !payer) return res.status(400).json({ error: 'amount and payer required' });
  const expense = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    amount: parseFloat(amount),
    category: category || '其他',
    description: description || '',
    payer,
    date: new Date().toISOString()
  };
  const list = getExpenses();
  list.unshift(expense);
  saveExpenses(list);
  res.json(expense);
});

app.delete('/api/expenses/:id', (req, res) => {
  const list = getExpenses();
  const idx = list.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  list.splice(idx, 1);
  saveExpenses(list);
  res.json({ ok: true });
});

app.get('/api/balances', (_req, res) => {
  const list = getExpenses();
  const totals = {}; // { name: totalPaid }
  list.forEach(e => {
    totals[e.payer] = (totals[e.payer] || 0) + e.amount;
  });
  const totalAll = Object.values(totals).reduce((s, v) => s + v, 0);
  const names = Object.keys(totals);
  const perPerson = names.length > 0 ? totalAll / names.length : 0;

  const balances = names.map(name => ({
    name,
    paid: Math.round(totals[name] * 100) / 100,
    share: Math.round(perPerson * 100) / 100,
    balance: Math.round((totals[name] - perPerson) * 100) / 100
  }));

  // 结算方案
  const creditors = balances.filter(b => b.balance > 0).sort((a, b) => b.balance - a.balance);
  const debtors = balances.filter(b => b.balance < 0).sort((a, b) => a.balance - b.balance);
  const settlements = [];
  let ci = 0, di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const c = creditors[ci];
    const d = debtors[di];
    const amount = Math.min(c.balance, -d.balance);
    settlements.push({ from: d.name, to: c.name, amount: Math.round(amount * 100) / 100 });
    c.balance -= amount;
    d.balance += amount;
    if (c.balance < 0.01) ci++;
    if (d.balance > -0.01) di++;
  }

  res.json({ members: names, totalAll: Math.round(totalAll * 100) / 100, perPerson: Math.round(perPerson * 100) / 100, balances, settlements });
});

// ── 留言板 API ──────────────────────────────────────────
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
function getMessages() { return readJSON(MESSAGES_FILE, []); }
function saveMessages(list) { writeJSON(MESSAGES_FILE, list); }

app.get('/api/messages', (_req, res) => { res.json(getMessages()); });

app.post('/api/messages', (req, res) => {
  const { author, content } = req.body;
  if (!author || !content) return res.status(400).json({ error: 'author and content required' });
  const msg = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    author: author.trim(),
    content: content.trim(),
    date: new Date().toISOString()
  };
  const list = getMessages();
  list.unshift(msg);
  if (list.length > 200) list.length = 200;
  saveMessages(list);
  res.json(msg);
});

app.delete('/api/messages/:id', (req, res) => {
  const list = getMessages();
  const idx = list.findIndex(m => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  list.splice(idx, 1);
  saveMessages(list);
  res.json({ ok: true });
});

// ── Socket.io 实时通信 ──────────────────────────────────
io.on('connection', (socket) => {
  const ip = socket.handshake.address;
  console.log(`[WS] 设备接入: ${ip}`);

  // 剪贴板：推送更新
  socket.on('clipboard:push', ({ content }) => {
    if (typeof content !== 'string') return;
    const data = { content, updatedAt: new Date().toISOString() };
    writeJSON(CLIPBOARD_FILE, data);
    // 广播给所有其他设备
    socket.broadcast.emit('clipboard:update', data);
  });

  // 剪贴板：拉取当前内容
  socket.on('clipboard:pull', () => {
    const data = readJSON(CLIPBOARD_FILE, { content: '', updatedAt: null });
    socket.emit('clipboard:update', data);
  });

  // 留言板：发送消息
  socket.on('message:send', ({ author, content }) => {
    if (!author || !content) return;
    const msg = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      author: author.trim(),
      content: content.trim(),
      date: new Date().toISOString()
    };
    const list = getMessages();
    list.unshift(msg);
    if (list.length > 200) list.length = 200;
    saveMessages(list);
    // 广播给所有设备（含发送者自己）
    io.emit('message:new', msg);
    io.emit('message:count', list.length);
  });

  // 留言板：删除消息
  socket.on('message:delete', ({ id }) => {
    const list = getMessages();
    const idx = list.findIndex(m => m.id === id);
    if (idx === -1) return;
    list.splice(idx, 1);
    saveMessages(list);
    io.emit('message:removed', { id });
    io.emit('message:count', list.length);
  });

  // 留言板：拉取全部
  socket.on('messages:get', () => {
    socket.emit('messages:all', getMessages());
  });

  socket.on('disconnect', () => {
    console.log(`[WS] 设备断开: ${ip}`);
  });
});

// ── 服务器信息 ──────────────────────────────────────────
app.get('/api/server-info', (_req, res) => {
  res.json({ ips: getLocalIPs(), port: PORT });
});

// ── 启动 ────────────────────────────────────────────────
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const ip = iface.address;
        // 跳过 APIPA (169.254.x.x)、VMware、WSL 虚拟网卡
        if (ip.startsWith('169.254.')) continue;
        if (name.includes('VMware') || name.includes('vEthernet')) continue;
        ips.push({ name, ip });
      }
    }
  }
  // Wi-Fi / 以太网排在前面
  ips.sort((a, b) => {
    const priority = n => {
      if (n.includes('WLAN') || n.includes('Wi-Fi')) return 0;
      if (n.includes('以太')) return 1;
      return 2;
    };
    return priority(a.name) - priority(b.name);
  });
  return ips;
}

server.timeout = 0; // 大文件上传下载不限时
server.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIPs();
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  局域网共享剪贴板 & 寝室记账看板');
  console.log(`  本机访问: http://localhost:${PORT}`);
  ips.forEach(({ name, ip }) => {
    console.log(`  ${name}:  http://${ip}:${PORT}`);
  });
  if (ips.length === 0) {
    console.log('  ⚠ 未检测到局域网 IP，请检查网络连接');
  }
  console.log('  ⚠ 手机无法打开？请在 Windows 防火墙中允许 Node.js 通过 3000 端口');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});
