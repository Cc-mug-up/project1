// ═══════════════════════════════════════════════════════
//  寝室智控中心 v1.3 — Dialog-based Frontend with Socket.io
// ═══════════════════════════════════════════════════════

// ── Helpers ────────────────────────────────────────────
function escHtml(s) {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}
function fmtDate(iso) {
  const d = new Date(iso);
  return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function fmtTime(iso) {
  const d = new Date(iso); const now = new Date(); const diff = now - d;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff/60000) + '分钟前';
  if (diff < 86400000) return Math.floor(diff/3600000) + '小时前';
  return fmtDate(iso);
}
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes/1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes/1048576).toFixed(1) + ' MB';
  return (bytes/1073741824).toFixed(2) + ' GB';
}

// ── Socket.io 实时连接 ──────────────────────────────────
const socket = io({ transports: ['websocket', 'polling'] });
socket.on('connect', () => console.log('[WS] 已连接:', socket.id));
socket.on('disconnect', () => console.log('[WS] 断开'));

// ── Dialog 导航 ────────────────────────────────────────
function openDialog(name) {
  const el = document.getElementById('dialog-' + name);
  if (!el) return;
  el.classList.add('open');
  // 触发对应功能的数据加载
  if (name === 'clipboard') loadClipboard();
  if (name === 'billing') { loadExpenses(); loadBalances(); }
  if (name === 'messages') loadMessages(false);
  if (name === 'files') loadFiles();
}
function closeDialog(name) {
  const el = document.getElementById('dialog-' + name);
  if (el) el.classList.remove('open');
}

// Dashboard 卡片点击
document.querySelectorAll('.dash-card').forEach(card => {
  card.addEventListener('click', () => {
    const name = card.dataset.dialog;
    if (name) openDialog(name);
  });
});

// Dialog 返回按钮
document.querySelectorAll('.dialog-back').forEach(btn => {
  btn.addEventListener('click', () => {
    const name = btn.dataset.close;
    if (name) closeDialog(name);
  });
});

// 点击遮罩关闭
document.querySelectorAll('.dialog-overlay').forEach(overlay => {
  overlay.addEventListener('click', function(e) {
    if (e.target === this) {
      this.classList.remove('open');
    }
  });
});

// ESC 关闭当前 dialog
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.dialog-overlay.open').forEach(d => d.classList.remove('open'));
  }
});

// ── Banner: IP & QR ────────────────────────────────────
(async function initBanner() {
  try {
    const res = await fetch('/api/server-info');
    const { ips, port } = await res.json();
    const ip = ips.length > 0 ? ips[0].ip : null;
    const url = ip ? `http://${ip}:${port}` : location.origin;
    document.getElementById('banner-ip').textContent = '🔗 ' + url;

    const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;
    document.getElementById('qr-img').src = qrSrc;
    document.getElementById('qr-url-text').textContent = url;

    const overlay = document.getElementById('qr-overlay');
    document.getElementById('banner-qr-btn').addEventListener('click', () => { overlay.style.display = 'flex'; });
    document.getElementById('qr-close').addEventListener('click', () => { overlay.style.display = 'none'; });
    overlay.addEventListener('click', function(e) { if (e.target === this) this.style.display = 'none'; });
  } catch (_) {
    document.getElementById('banner-ip').textContent = '⚠ 网络异常';
  }
})();

// ═══════════════════════════════════════════════════════
//  共享剪贴板（Socket.io 实时同步）
// ═══════════════════════════════════════════════════════
const clipText = document.getElementById('clipboard-text');
const clipDot = document.getElementById('clip-dot');
const clipTime = document.getElementById('clip-time');
const clipBadge = document.getElementById('clip-badge');
let lastClipUpdated = null;

function showClipSync(data) {
  if (!data.updatedAt) {
    clipDot.className = 'dot'; clipTime.textContent = '暂无内容';
    clipBadge.textContent = 'IDLE'; clipBadge.style.color = 'var(--text-dim)';
    return;
  }
  if (data.updatedAt === lastClipUpdated) return;
  clipText.value = data.content;
  lastClipUpdated = data.updatedAt;
  clipDot.className = 'dot live';
  clipTime.textContent = '已同步 · ' + new Date(data.updatedAt).toLocaleTimeString('zh-CN');
  clipBadge.textContent = 'SYNC'; clipBadge.style.color = 'var(--neon)';
}

// 收到剪贴板更新（来自其他设备）
socket.on('clipboard:update', showClipSync);

// 打开对话框时拉取最新
const origOpenClip = () => socket.emit('clipboard:pull');
document.querySelector('.dash-card[data-dialog="clipboard"]').addEventListener('click', origOpenClip);

// 推送按钮
document.getElementById('btn-push').addEventListener('click', () => {
  const content = clipText.value;
  socket.emit('clipboard:push', { content });
  lastClipUpdated = new Date().toISOString();
  clipDot.className = 'dot live';
  clipTime.textContent = '已推送 · ' + new Date().toLocaleTimeString('zh-CN');
  clipBadge.textContent = 'SYNC'; clipBadge.style.color = 'var(--neon)';
});

// 复制按钮
document.getElementById('btn-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(clipText.value); }
  catch (_) { clipText.select(); document.execCommand('copy'); }
  clipTime.textContent = '已复制 ✓';
});

// ── 自动剪贴板：Ctrl+C 自动推送 + 手机端 Toast ────────
const clipToast = document.getElementById('clip-toast');
let clipToastTimer;

// 收到其他设备推送 → 弹出 toast
const origShowClipSync = showClipSync;
showClipSync = function(data) {
  origShowClipSync(data);
  if (data.updatedAt && data.content) {
    clipToast.classList.add('show');
    clearTimeout(clipToastTimer);
    clipToastTimer = setTimeout(() => clipToast.classList.remove('show'), 5000);
  }
};
// 点击 toast → 复制到系统剪贴板
clipToast.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(clipText.value); }
  catch (_) { clipText.select(); document.execCommand('copy'); }
  clipToast.querySelector('.clip-toast-msg').textContent = '✅ 已复制到剪贴板！';
  setTimeout(() => {
    clipToast.querySelector('.clip-toast-msg').textContent = '📋 收到新内容 · 点击粘贴到手机';
  }, 2000);
  clipToast.classList.remove('show');
});

// 监听用户在页面上的 Ctrl+C / 右键复制 → 自动推送
document.addEventListener('copy', () => {
  const sel = window.getSelection()?.toString()?.trim();
  if (sel && sel.length > 0 && sel.length < 50000) {
    clipText.value = sel;
    socket.emit('clipboard:push', { content: sel });
    lastClipUpdated = new Date().toISOString();
    clipDot.className = 'dot live';
    clipTime.textContent = '自动推送 · ' + new Date().toLocaleTimeString('zh-CN');
  }
});

// ═══════════════════════════════════════════════════════
//  AA 记账
// ═══════════════════════════════════════════════════════
const expenseForm = document.getElementById('expense-form');
const expenseList = document.getElementById('expense-list');
const balanceSummary = document.getElementById('balance-summary');
const settlementList = document.getElementById('settlement-list');
const memberList = document.getElementById('member-list');

async function loadExpenses() {
  try {
    const res = await fetch('/api/expenses');
    const list = await res.json();
    if (list.length === 0) {
      expenseList.innerHTML = '<div class="empty-state">还没有账单，记一笔吧</div>';
    } else {
      expenseList.innerHTML = list.map(e => `
        <div class="list-item">
          <div class="info"><div class="top">
            <span class="desc">${escHtml(e.description) || '无备注'}</span>
            <span class="tag">${escHtml(e.category)}</span>
          </div>
          <div class="meta">${escHtml(e.payer)} · ${fmtDate(e.date)}</div></div>
          <span class="amount gold">¥${e.amount.toFixed(2)}</span>
          <button class="list-del" data-id="${e.id}">×</button>
        </div>`).join('');
      expenseList.querySelectorAll('.list-del').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('删除这条账单？')) return;
          await fetch('/api/expenses/' + btn.dataset.id, { method: 'DELETE' });
          loadExpenses(); loadBalances();
        });
      });
    }
    updateMemberDatalist(list);
  } catch (_) { expenseList.innerHTML = '<div class="empty-state" style="color:var(--danger)">加载失败</div>'; }
}

async function loadBalances() {
  try {
    const res = await fetch('/api/balances');
    const data = await res.json();
    if (data.members.length === 0) { balanceSummary.innerHTML = ''; settlementList.innerHTML = ''; return; }
    balanceSummary.innerHTML = data.balances.map(b => `
      <div class="balance-chip">
        <div class="name">${escHtml(b.name)}</div>
        <div class="paid">已付 ¥${b.paid.toFixed(2)}</div>
        <div class="net ${b.balance>=0?'pos':'neg'}">
          ${b.balance>=0 ? '应收 ¥'+b.balance.toFixed(2) : '应付 ¥'+Math.abs(b.balance).toFixed(2)}</div>
      </div>`).join('');
    settlementList.innerHTML = data.settlements.length > 0
      ? '<div class="settlement-hint">💡 结算方案</div>' + data.settlements.map(s =>
          `<div class="settlement-item">${escHtml(s.from)} → ${escHtml(s.to)} <b style="color:var(--gold)">¥${s.amount.toFixed(2)}</b></div>`).join('')
      : (data.totalAll > 0 ? '<div style="font-size:.75rem;color:var(--gold);margin-bottom:6px">✓ 已结清</div>' : '');
  } catch (_) { balanceSummary.innerHTML = ''; }
}

function updateMemberDatalist(list) {
  memberList.innerHTML = [...new Set(list.map(e => e.payer))].map(n => `<option value="${escHtml(n)}">`).join('');
}

expenseForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = expenseForm.querySelector('button[type="submit"]');
  btn.disabled = true; btn.textContent = '…';
  try {
    await fetch('/api/expenses', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: document.getElementById('exp-amount').value,
        category: document.getElementById('exp-category').value,
        description: document.getElementById('exp-desc').value,
        payer: document.getElementById('exp-payer').value.trim()
      })
    });
    expenseForm.reset(); loadExpenses(); loadBalances();
  } catch (_) { alert('添加失败'); }
  finally { btn.disabled = false; btn.textContent = '✓ 记一笔'; }
});

loadExpenses(); loadBalances();

// ═══════════════════════════════════════════════════════
//  留言板（Socket.io 毫秒级实时同步）
// ═══════════════════════════════════════════════════════
const msgForm = document.getElementById('msg-form');
const msgList = document.getElementById('msg-list');
const msgBadge = document.getElementById('msg-badge');
let msgCount = 0;

function renderMsgItem(m) {
  return `<div class="msg-item" data-msg-id="${m.id}">
    <div class="msg-header">
      <span class="msg-author">${escHtml(m.author)}</span>
      <span class="msg-time">${fmtTime(m.date)}</span>
      <button class="msg-del" data-id="${m.id}">×</button>
    </div>
    <div class="msg-body">${escHtml(m.content)}</div>
  </div>`;
}

function bindMsgDel(container) {
  container.querySelectorAll('.msg-del').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('删除这条留言？')) return;
      socket.emit('message:delete', { id: btn.dataset.id });
    });
  });
}

// 初始加载全部消息
socket.on('messages:all', (list) => {
  msgCount = list.length;
  if (list.length === 0) {
    msgList.innerHTML = '<div class="empty-state">还没有留言，来说句话吧</div>';
  } else {
    msgList.innerHTML = list.map(renderMsgItem).join('');
    bindMsgDel(msgList);
  }
});

// 新消息到达（其他设备发来的，或自己发的广播回来）
socket.on('message:new', (m) => {
  msgCount++;
  msgBadge.textContent = 'NEW'; msgBadge.style.color = 'var(--gold)';
  setTimeout(() => { msgBadge.textContent = 'LIVE'; msgBadge.style.color = 'var(--neon)'; }, 2000);
  // 移除空状态
  const empty = msgList.querySelector('.empty-state');
  if (empty) empty.remove();
  // 插入到最前面
  msgList.insertAdjacentHTML('afterbegin', renderMsgItem(m));
  bindMsgDel(msgList);
  // 保持最多 200 条
  const items = msgList.querySelectorAll('.msg-item');
  for (let i = 200; i < items.length; i++) items[i].remove();
});

// 消息被删除
socket.on('message:removed', ({ id }) => {
  msgCount = Math.max(0, msgCount - 1);
  const el = msgList.querySelector(`[data-msg-id="${id}"]`);
  if (el) el.remove();
  if (!msgList.querySelector('.msg-item')) {
    msgList.innerHTML = '<div class="empty-state">还没有留言，来说句话吧</div>';
  }
});

// 消息数量更新
socket.on('message:count', (count) => { msgCount = count; });

// 打开对话框时拉取最新
document.querySelector('.dash-card[data-dialog="messages"]').addEventListener('click', () => {
  socket.emit('messages:get');
});

// 发送消息
msgForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const btn = msgForm.querySelector('button[type="submit"]');
  const author = document.getElementById('msg-author').value.trim();
  const content = document.getElementById('msg-content').value.trim();
  if (!author || !content) return;
  btn.disabled = true; btn.textContent = '…';
  socket.emit('message:send', { author, content });
  document.getElementById('msg-content').value = '';
  btn.disabled = false; btn.textContent = '💬 发送';
});

// ═══════════════════════════════════════════════════════
//  文件闪传
// ═══════════════════════════════════════════════════════
const fileZone = document.getElementById('file-zone');
const fileInput = document.getElementById('file-input');
const fileProgress = document.getElementById('file-progress');
const fileProgressBar = document.getElementById('file-progress-bar');
const upName = document.getElementById('up-name');
const upPct = document.getElementById('up-pct');
const dlProgress = document.getElementById('file-dl-progress');
const dlName = document.getElementById('dl-name');
const dlPct = document.getElementById('dl-pct');
const dlBar = document.getElementById('dl-bar');
const fileList = document.getElementById('file-list');
const fileBadge = document.getElementById('file-badge');
let lastFileCount = 0;

fileZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => { if (fileInput.files.length) uploadFiles(fileInput.files); });
fileZone.addEventListener('dragover', (e) => { e.preventDefault(); fileZone.classList.add('dragover'); });
fileZone.addEventListener('dragleave', () => { fileZone.classList.remove('dragover'); });
fileZone.addEventListener('drop', (e) => {
  e.preventDefault(); fileZone.classList.remove('dragover');
  if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
});

function uploadFiles(files) {
  fileProgress.style.display = 'block'; fileProgressBar.style.width = '0%';
  fileBadge.textContent = 'UPLD'; fileBadge.style.color = 'var(--gold)';
  let idx = 0, uploadedSize = 0, totalSize = 0, startTime = Date.now();
  for (const f of files) totalSize += f.size;

  const uploadNext = () => {
    if (idx >= files.length) {
      upPct.textContent = '100% · 完成 ✓'; fileProgressBar.style.width = '100%';
      fileBadge.textContent = 'LAN'; fileBadge.style.color = 'var(--neon)'; fileInput.value = '';
      setTimeout(() => { fileProgress.style.display = 'none'; }, 1000);
      loadFiles(); return;
    }
    const file = files[idx];
    upName.textContent = (files.length > 1 ? '('+(idx+1)+'/'+files.length+') ' : '') + file.name;
    upPct.textContent = '0%'; fileProgressBar.style.width = '0%'; startTime = Date.now();

    const fd = new FormData(); fd.append('file', file);
    const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/files/upload');
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.round(e.loaded/e.total*100);
      fileProgressBar.style.width = pct + '%';
      const speed = (Date.now()-startTime) > 0 ? e.loaded/((Date.now()-startTime)/1000) : 0;
      upPct.textContent = pct + '% · ' + formatSize(speed) + '/s';
    };
    xhr.onload = () => { if (xhr.status===200) uploadedSize += file.size; idx++; uploadNext(); };
    xhr.onerror = () => { idx++; uploadNext(); };
    xhr.send(fd);
  };
  uploadNext();
}

function downloadFile(filename) {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', '/api/files/download/' + encodeURIComponent(filename));
  xhr.responseType = 'blob';
  dlProgress.style.display = 'block'; dlName.textContent = filename;
  dlPct.textContent = '0%'; dlBar.style.width = '0%';
  fileBadge.textContent = 'DL'; fileBadge.style.color = 'var(--gold)';
  const startTime = Date.now();

  xhr.onprogress = (e) => {
    if (!e.lengthComputable) return;
    const pct = Math.round(e.loaded/e.total*100);
    dlBar.style.width = pct + '%';
    const speed = (Date.now()-startTime) > 0 ? e.loaded/((Date.now()-startTime)/1000) : 0;
    dlPct.textContent = pct + '% · ' + formatSize(speed) + '/s';
  };
  xhr.onload = () => {
    if (xhr.status===200) {
      dlPct.textContent = '100% · 完成 ✓'; dlBar.style.width = '100%';
      const url = URL.createObjectURL(xhr.response);
      const a = document.createElement('a'); a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } else { dlName.textContent = '下载失败'; }
    setTimeout(() => { dlProgress.style.display = 'none'; fileBadge.textContent = 'LAN'; fileBadge.style.color = 'var(--neon)'; }, 1500);
  };
  xhr.onerror = () => {
    dlName.textContent = '网络错误';
    setTimeout(() => { dlProgress.style.display = 'none'; fileBadge.textContent = 'LAN'; fileBadge.style.color = 'var(--neon)'; }, 2000);
  };
  xhr.send();
}

async function loadFiles() {
  try {
    const res = await fetch('/api/files');
    const list = await res.json();
    if (list.length !== lastFileCount) {
      fileBadge.textContent = list.length + ' files';
      setTimeout(() => { fileBadge.textContent = 'LAN'; }, 2000);
    }
    lastFileCount = list.length;
    if (list.length === 0) {
      fileList.innerHTML = '<div class="empty-state">暂无共享文件</div>';
    } else {
      fileList.innerHTML = list.map(f => {
        const ico = (/image/.test(f.type)?'🖼':/video/.test(f.type)?'🎬':/audio/.test(f.type)?'🎵':/pdf/.test(f.type)?'📄':/zip|rar|7z|tar|gz/.test(f.type)?'📦':'📎');
        return `<div class="file-item"><span class="file-icon">${ico}</span>
          <div class="file-info"><div class="fname" title="${escHtml(f.name)}">${escHtml(f.name)}</div>
          <div class="fmeta">${formatSize(f.size)} · ${fmtDate(f.date)}</div></div>
          <div class="file-actions">
            <button class="btn btn-sm btn-dl" data-name="${escHtml(f.name)}">⬇</button>
            <button class="btn btn-sm list-del" data-name="${escHtml(f.name)}">×</button>
          </div></div>`;
      }).join('');
      fileList.querySelectorAll('.btn-dl').forEach(btn => {
        btn.addEventListener('click', () => downloadFile(btn.dataset.name));
      });
      fileList.querySelectorAll('.list-del').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('删除文件 "' + btn.dataset.name + '" ？')) return;
          await fetch('/api/files/' + encodeURIComponent(btn.dataset.name), { method: 'DELETE' });
          lastFileCount--; loadFiles();
        });
      });
    }
  } catch (_) { fileList.innerHTML = '<div class="empty-state" style="color:var(--danger)">加载失败</div>'; }
}

setInterval(loadFiles, 5000);
loadFiles();

// ═══════════════════════════════════════════════════════
//  WebRTC P2P 直传（千兆局域网满速）
// ═══════════════════════════════════════════════════════
const p2pPeersEl = document.getElementById('p2p-peers');
const p2pCountEl = document.getElementById('p2p-peer-count');
const p2pZone = document.getElementById('p2p-zone');
const p2pInput = document.getElementById('p2p-input');
const p2pTransferList = document.getElementById('p2p-transfer-list');

const peerConns = {};       // socketId → RTCPeerConnection
const peerChannels = {};    // socketId → RTCDataChannel
let selectedPeer = null;

const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// ── Peer 发现 ─────────────────────────────────────────
socket.on('p2p:peers', (peers) => {
  p2pCountEl.textContent = peers.length > 0 ? `${peers.length} 台设备在线` : '暂无其他设备';
  p2pPeersEl.innerHTML = peers.map(p =>
    `<span class="p2p-peer" data-peer="${p.id}">🖥 ${p.id.slice(0,6)}</span>`
  ).join('');
  // 点击选择目标设备
  p2pPeersEl.querySelectorAll('.p2p-peer').forEach(el => {
    el.addEventListener('click', () => {
      p2pPeersEl.querySelectorAll('.p2p-peer').forEach(e => e.classList.remove('selected'));
      el.classList.add('selected');
      selectedPeer = el.dataset.peer;
    });
  });
});
socket.on('p2p:peer-joined', () => {});
socket.on('p2p:peer-left', ({ id }) => {
  if (selectedPeer === id) { selectedPeer = null; }
  if (peerConns[id]) { peerConns[id].close(); delete peerConns[id]; }
  if (peerChannels[id]) delete peerChannels[id];
});

// ── 选择文件 + 目标 → 发起 P2P 传输 ──────────────────
p2pZone.addEventListener('click', () => p2pInput.click());
p2pZone.addEventListener('dragover', (e) => { e.preventDefault(); p2pZone.classList.add('dragover'); });
p2pZone.addEventListener('dragleave', () => p2pZone.classList.remove('dragover'));
p2pZone.addEventListener('drop', (e) => {
  e.preventDefault(); p2pZone.classList.remove('dragover');
  if (e.dataTransfer.files.length) sendP2PFile(e.dataTransfer.files[0]);
});
p2pInput.addEventListener('change', () => {
  if (p2pInput.files.length) sendP2PFile(p2pInput.files[0]);
});

function sendP2PFile(file) {
  if (!selectedPeer) { alert('请先选择一个目标设备'); return; }
  const peerId = selectedPeer;

  // 显示传输项
  const itemId = 'p2p-' + Date.now();
  p2pTransferList.insertAdjacentHTML('afterbegin', `
    <div class="p2p-transfer-item" id="${itemId}">
      <div class="p2p-name">⚡ ${escHtml(file.name)} → ${peerId.slice(0,6)}</div>
      <div class="p2p-meta">
        <span>${formatSize(file.size)} · 等待连接…</span>
        <span class="p2p-status">连接中</span>
      </div>
      <div class="dl-bar-wrap"><div class="dl-bar" style="width:0%;background:var(--gold)"></div></div>
    </div>`);

  const pc = new RTCPeerConnection(rtcConfig);
  peerConns[peerId] = pc;
  const channel = pc.createDataChannel('file', { ordered: true });
  peerChannels[peerId] = channel;
  channel.binaryType = 'arraybuffer';

  let offset = 0;
  const CHUNK = 16384; // 16KB chunks
  const startTime = Date.now();

  channel.onopen = () => {
    const meta = JSON.stringify({ name: file.name, size: file.size, type: file.type });
    channel.send(meta);
    readNext();
  };

  function readNext() {
    if (offset >= file.size) { channel.close(); return; }
    const slice = file.slice(offset, offset + CHUNK);
    const reader = new FileReader();
    reader.onload = () => { channel.send(reader.result); offset += CHUNK; readNext(); };
    reader.onerror = () => console.error('read error');
    reader.readAsArrayBuffer(slice);
    // 更新进度
    const pct = Math.round(offset / file.size * 100);
    const speed = (Date.now() - startTime) > 0 ? offset / ((Date.now() - startTime) / 1000) : 0;
    const bar = document.querySelector(`#${itemId} .dl-bar`);
    const statusEl = document.querySelector(`#${itemId} .p2p-status`);
    const metaEl = document.querySelector(`#${itemId} .p2p-meta span`);
    if (bar) bar.style.width = pct + '%';
    if (statusEl) statusEl.textContent = pct + '%';
    if (metaEl) metaEl.textContent = formatSize(file.size) + ' · ' + formatSize(speed) + '/s';
  }

  channel.onclose = () => {
    const statusEl = document.querySelector(`#${itemId} .p2p-status`);
    if (statusEl) statusEl.textContent = '完成 ✓';
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit('p2p:signal', { to: peerId, type: 'ice', data: e.candidate });
  };
  pc.createOffer().then(offer => pc.setLocalDescription(offer)).then(() => {
    socket.emit('p2p:signal', { to: peerId, type: 'offer', data: pc.localDescription });
  });

  p2pInput.value = '';
}

// ── 接收端：处理 WebRTC 连接 ──────────────────────────
socket.on('p2p:signal', async ({ from, type, data }) => {
  if (type === 'offer') {
    const pc = new RTCPeerConnection(rtcConfig);
    peerConns[from] = pc;
    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('p2p:signal', { to: from, type: 'ice', data: e.candidate });
    };

    let receivedMeta = null, receivedChunks = [], receivedSize = 0;
    const startTime = Date.now();

    pc.ondatachannel = (e) => {
      const channel = e.channel;
      channel.binaryType = 'arraybuffer';
      peerChannels[from] = channel;

      const itemId = 'p2p-recv-' + Date.now();
      p2pTransferList.insertAdjacentHTML('afterbegin', `
        <div class="p2p-transfer-item" id="${itemId}">
          <div class="p2p-name">⬇ 接收中…</div>
          <div class="p2p-meta">
            <span>等待数据…</span>
            <span class="p2p-status">0%</span>
          </div>
          <div class="dl-bar-wrap"><div class="dl-bar" style="width:0%;background:var(--neon)"></div></div>
        </div>`);

      channel.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          receivedMeta = JSON.parse(ev.data);
          document.querySelector(`#${itemId} .p2p-name`).textContent = '⬇ ' + receivedMeta.name;
          return;
        }
        receivedChunks.push(ev.data);
        receivedSize += ev.data.byteLength;
        if (receivedMeta) {
          const pct = Math.round(receivedSize / receivedMeta.size * 100);
          const speed = (Date.now() - startTime) > 0 ? receivedSize / ((Date.now() - startTime) / 1000) : 0;
          const bar = document.querySelector(`#${itemId} .dl-bar`);
          const statusEl = document.querySelector(`#${itemId} .p2p-status`);
          const metaEl = document.querySelector(`#${itemId} .p2p-meta span`);
          if (bar) bar.style.width = pct + '%';
          if (statusEl) statusEl.textContent = pct + '%';
          if (metaEl) metaEl.textContent = formatSize(receivedMeta.size) + ' · ' + formatSize(speed) + '/s';
        }
      };

      channel.onclose = () => {
        if (receivedMeta) {
          const blob = new Blob(receivedChunks, { type: receivedMeta.type || 'application/octet-stream' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = receivedMeta.name;
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          URL.revokeObjectURL(url);
          const statusEl = document.querySelector(`#${itemId} .p2p-status`);
          if (statusEl) statusEl.textContent = '完成 ✓';
        }
      };
    };

    await pc.setRemoteDescription(new RTCSessionDescription(data));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('p2p:signal', { to: from, type: 'answer', data: pc.localDescription });
  }

  if (type === 'answer') {
    const pc = peerConns[from];
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(data));
  }

  if (type === 'ice') {
    const pc = peerConns[from];
    if (pc) await pc.addIceCandidate(new RTCIceCandidate(data));
  }
});
