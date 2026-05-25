// ═══════════════════════════════════════════════════════
//  寝室智控中心 v1.2 — Dialog-based Frontend
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
//  共享剪贴板
// ═══════════════════════════════════════════════════════
const clipText = document.getElementById('clipboard-text');
const clipDot = document.getElementById('clip-dot');
const clipTime = document.getElementById('clip-time');
const clipBadge = document.getElementById('clip-badge');
let lastClipUpdated = null;

async function loadClipboard() {
  try {
    const res = await fetch('/api/clipboard');
    const data = await res.json();
    if (data.updatedAt && data.updatedAt !== lastClipUpdated) {
      clipText.value = data.content;
      lastClipUpdated = data.updatedAt;
      clipDot.className = 'dot live';
      clipTime.textContent = '已同步 · ' + new Date(data.updatedAt).toLocaleTimeString('zh-CN');
      clipBadge.textContent = 'SYNC'; clipBadge.style.color = 'var(--neon)';
    } else if (!data.updatedAt) {
      clipDot.className = 'dot'; clipTime.textContent = '暂无内容';
      clipBadge.textContent = 'IDLE'; clipBadge.style.color = 'var(--text-dim)';
    }
  } catch (_) { clipDot.className = 'dot'; clipTime.textContent = '连接中…'; }
}

document.getElementById('btn-push').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/clipboard', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: clipText.value })
    });
    const data = await res.json();
    lastClipUpdated = data.updatedAt;
    clipDot.className = 'dot live';
    clipTime.textContent = '已推送 · ' + new Date(data.updatedAt).toLocaleTimeString('zh-CN');
  } catch (_) { alert('推送失败'); }
});

document.getElementById('btn-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(clipText.value); }
  catch (_) { clipText.select(); document.execCommand('copy'); }
  clipTime.textContent = '已复制 ✓';
  setTimeout(() => { clipTime.textContent = '已同步 · ' + (lastClipUpdated ? new Date(lastClipUpdated).toLocaleTimeString('zh-CN') : ''); }, 2000);
});

setInterval(loadClipboard, 3000);
loadClipboard();

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
//  留言板
// ═══════════════════════════════════════════════════════
const msgForm = document.getElementById('msg-form');
const msgList = document.getElementById('msg-list');
const msgBadge = document.getElementById('msg-badge');
let lastMsgCount = 0;

async function loadMessages(showIndicator) {
  try {
    const res = await fetch('/api/messages');
    const list = await res.json();
    if (showIndicator && list.length !== lastMsgCount) {
      msgBadge.textContent = 'NEW'; msgBadge.style.color = 'var(--gold)';
      setTimeout(() => { msgBadge.textContent = 'LIVE'; msgBadge.style.color = 'var(--neon)'; }, 2000);
    }
    lastMsgCount = list.length;
    if (list.length === 0) {
      msgList.innerHTML = '<div class="empty-state">还没有留言，来说句话吧</div>';
    } else {
      msgList.innerHTML = list.map(m => `
        <div class="msg-item">
          <div class="msg-header">
            <span class="msg-author">${escHtml(m.author)}</span>
            <span class="msg-time">${fmtTime(m.date)}</span>
            <button class="msg-del" data-id="${m.id}">×</button>
          </div>
          <div class="msg-body">${escHtml(m.content)}</div>
        </div>`).join('');
      msgList.querySelectorAll('.msg-del').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('删除这条留言？')) return;
          await fetch('/api/messages/' + btn.dataset.id, { method: 'DELETE' });
          lastMsgCount--; loadMessages(false);
        });
      });
    }
  } catch (_) { msgList.innerHTML = '<div class="empty-state" style="color:var(--danger)">加载失败</div>'; }
}

msgForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = msgForm.querySelector('button[type="submit"]');
  const author = document.getElementById('msg-author').value.trim();
  const content = document.getElementById('msg-content').value.trim();
  if (!author || !content) return;
  btn.disabled = true; btn.textContent = '…';
  try {
    await fetch('/api/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author, content })
    });
    document.getElementById('msg-content').value = ''; loadMessages(false);
  } catch (_) { alert('发送失败'); }
  finally { btn.disabled = false; btn.textContent = '💬 发送'; }
});

setInterval(() => loadMessages(true), 4000);
loadMessages(false);

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
