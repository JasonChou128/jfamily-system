import { db, today, nowTime } from './config.js';
import { ref, set, push, remove, update, get } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

let ticketFilter = 'all';
let currentTicketId = null;

export function statusLabel(s) {
  return { pending: '待處理', progress: '進行中', done: '已完成' }[s] || s;
}

// ── GENERATE TICKET NUMBER ──
async function generateTicketNum() {
  const snap = await get(ref(db, 'ticketCounter'));
  const counter = (snap.val() || 0) + 1;
  await set(ref(db, 'ticketCounter'), counter);
  return '#' + String(counter).padStart(6, '0');
}

// ── FILTER ──
export function filterTickets(f, el) {
  ticketFilter = f;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
}

// ── RENDER TICKET LIST ──
export function renderTickets(tickets) {
  let entries = Object.entries(tickets);
  if (ticketFilter !== 'all') entries = entries.filter(([, t]) => t.status === ticketFilter);
  entries.sort((a, b) => {
    // Sort by ticket number descending
    const na = parseInt((a[1].ticketNum || '#0').replace('#',''));
    const nb = parseInt((b[1].ticketNum || '#0').replace('#',''));
    return nb - na;
  });

  document.getElementById('ticketList').innerHTML = entries.length === 0
    ? '<div class="empty-state"><div class="icon">🎫</div>沒有符合的票單</div>'
    : entries.map(([id, t]) => {
        const dueBadge = t.dueDate
          ? `<span style="font-size:11px;color:${isDueWarning(t.dueDate) ? '#f59e0b' : '#6b6b8a'}">📅 ${t.dueDate}</span>`
          : '';
        const commentCount = t.comments ? Object.keys(t.comments).length : 0;
        return `
        <div class="ticket-card ${t.priority}" onclick="window.openTicketDetail('${id}')">
          <div class="ticket-header">
            <span class="ticket-id">${t.ticketNum || id}</span>
            <span class="ticket-title">${t.title}</span>
            <span class="ticket-status status-${t.status}">${statusLabel(t.status)}</span>
          </div>
          <div class="ticket-meta">
            <span><span class="priority-dot p-${t.priority}"></span>${{high:'高',medium:'中',low:'低'}[t.priority]}</span>
            <span>${t.client}</span>
            <span>${t.type}</span>
            <span>${t.assign || '未指派'}</span>
            ${dueBadge}
            ${commentCount > 0 ? `<span style="font-size:11px;color:#6b6b8a">💬 ${commentCount}</span>` : ''}
          </div>
        </div>`;
      }).join('');
}

function isDueWarning(dueDate) {
  const due = new Date(dueDate);
  const now = new Date();
  const diff = (due - now) / (1000 * 60 * 60 * 24);
  return diff <= 7 && diff >= 0;
}

// ── OPEN TICKET DETAIL ──
export function openTicketDetail(id, tickets, currentUser) {
  currentTicketId = id;
  const t = tickets[id];
  if (!t) return;
  const isAdmin = currentUser.role === 'admin';

  // Header
  document.getElementById('td-num').textContent = t.ticketNum || id;
  document.getElementById('td-title').textContent = t.title;

  // Badges
  const priorityLabel = {high:'🔴 高優先', medium:'🟡 中優先', low:'🔵 低優先'}[t.priority];
  const statusColor = {pending:'rgba(232,193,74,.15)', progress:'rgba(59,130,246,.15)', done:'rgba(39,174,96,.15)'}[t.status];
  const statusTextColor = {pending:'#e8c14a', progress:'#60a5fa', done:'#27ae60'}[t.status];
  const dueColor = t.dueDate && isDueWarning(t.dueDate) ? '#f59e0b' : '#6b6b8a';

  document.getElementById('td-badges').innerHTML = `
    <span class="badge b-priority-${t.priority}">${priorityLabel}</span>
    <span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${statusColor};color:${statusTextColor};border:1px solid ${statusTextColor}40">● ${statusLabel(t.status)}</span>
    ${t.dueDate ? `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:rgba(245,158,11,.12);color:${dueColor};border:1px solid rgba(245,158,11,.2)">📅 截止 ${t.dueDate}</span>` : ''}
  `;

  // Meta grid
  document.getElementById('td-meta').innerHTML = `
    <div class="td-meta-item"><span class="td-meta-label">客戶</span><span>${t.client}</span></div>
    <div class="td-meta-item"><span class="td-meta-label">設備</span><span>${t.type}</span></div>
    <div class="td-meta-item"><span class="td-meta-label">指派給</span><span>${t.assign || '未指派'}</span></div>
    <div class="td-meta-item"><span class="td-meta-label">建立者</span><span>${t.createdBy || '-'}</span></div>
    ${t.startDate ? `<div class="td-meta-item"><span class="td-meta-label">開始日期</span><span>${t.startDate}</span></div>` : ''}
    ${t.dueDate ? `<div class="td-meta-item"><span class="td-meta-label">截止日期</span><span style="color:${dueColor}">${t.dueDate}</span></div>` : ''}
    <div class="td-meta-item"><span class="td-meta-label">建立時間</span><span>${t.created || '-'}</span></div>
  `;

  // Action buttons
  const advBtn = t.status !== 'done'
    ? `<button class="act-btn act-primary" onclick="window.advanceTicket()">${t.status === 'pending' ? '✓ 標記進行中' : '✓ 標記完成'}</button>` : '';
  document.getElementById('td-actions').innerHTML = `
    ${advBtn}
    ${t.dueDate ? `<button class="act-btn act-cal" onclick="window.linkTicketToCalendar('${id}')">🗓 加入行事曆</button>` : ''}
    ${isAdmin ? `<button class="act-btn act-danger" onclick="window.deleteTicket()">刪除</button>` : ''}
  `;

  // Description
  document.getElementById('td-desc').textContent = t.desc || '（無描述）';

  // Comments
  renderComments(t.comments || {});

  // History
  renderHistory(t.history || {});

  document.getElementById('ticketDetailModal').classList.add('open');
}

function renderComments(comments) {
  const list = document.getElementById('td-comments-list');
  const entries = Object.entries(comments).sort((a, b) => a[1].time?.localeCompare(b[1].time));
  if (entries.length === 0) {
    list.innerHTML = '<div style="font-size:13px;color:var(--text-muted);padding:8px 0">尚無留言</div>';
    return;
  }
  list.innerHTML = entries.map(([, c]) => {
    const initials = (c.author || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2);
    return `
    <div style="display:flex;gap:10px;margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid #1a1a24">
      <div style="width:34px;height:34px;border-radius:8px;background:rgba(59,130,246,.15);color:#60a5fa;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0">${initials}</div>
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
          <span style="font-size:13px;font-weight:600">${c.author || '未知'}</span>
          <span style="font-size:11px;color:var(--text-muted)">${c.time || ''}</span>
        </div>
        <div style="font-size:13px;color:#c0c0d0;line-height:1.7">${c.text}</div>
      </div>
    </div>`;
  }).join('');
}

function renderHistory(history) {
  const list = document.getElementById('td-history-list');
  const entries = Object.entries(history).sort((a, b) => b[1].time?.localeCompare(a[1].time));
  if (entries.length === 0) {
    list.innerHTML = '<div style="font-size:12px;color:var(--text-muted)">尚無記錄</div>';
    return;
  }
  const dotColor = { create: '#27ae60', status: '#60a5fa', comment: '#e8c14a', assign: '#8b5cf6' };
  list.innerHTML = entries.map(([, h]) => `
    <div style="display:flex;gap:10px;align-items:flex-start;padding:7px 0;border-bottom:1px solid #111118">
      <div style="width:8px;height:8px;border-radius:50%;background:${dotColor[h.type] || '#6b6b8a'};margin-top:5px;flex-shrink:0"></div>
      <div style="font-size:12px;color:#6b6b8a;line-height:1.7">${h.time}&nbsp;&nbsp;<span style="color:#c0c0d0">${h.by}</span> ${h.action}</div>
    </div>`).join('');
}

// ── ADD COMMENT ──
export async function addComment(currentUser) {
  const text = document.getElementById('td-comment-input').value.trim();
  if (!text || !currentTicketId) return;
  const td = today(), nt = nowTime();
  const commentRef = push(ref(db, `tickets/${currentTicketId}/comments`));
  await set(commentRef, {
    author: currentUser.name || currentUser.email,
    uid: currentUser.uid,
    text,
    time: `${td} ${nt}`
  });
  // Add to history
  const histRef = push(ref(db, `tickets/${currentTicketId}/history`));
  await set(histRef, { type: 'comment', by: currentUser.name || currentUser.email, action: '新增留言', time: `${td} ${nt}` });

  document.getElementById('td-comment-input').value = '';
}

// ── ADVANCE TICKET ──
export async function advanceTicket(tickets, currentUser) {
  const t = tickets[currentTicketId];
  if (!t) return;
  const newStatus = t.status === 'pending' ? 'progress' : 'done';
  await update(ref(db, `tickets/${currentTicketId}`), { status: newStatus });
  // Add to history
  const histRef = push(ref(db, `tickets/${currentTicketId}/history`));
  const td = today(), nt = nowTime();
  await set(histRef, {
    type: 'status',
    by: currentUser.name || currentUser.email,
    action: `將狀態從「${statusLabel(t.status)}」改為「${statusLabel(newStatus)}」`,
    time: `${td} ${nt}`
  });
  document.getElementById('ticketDetailModal').classList.remove('open');
}

// ── DELETE TICKET ──
export async function deleteTicket() {
  if (!confirm('確定要刪除這張票單？')) return;
  await remove(ref(db, `tickets/${currentTicketId}`));
  document.getElementById('ticketDetailModal').classList.remove('open');
}

// ── LINK TO CALENDAR ──
export async function linkTicketToCalendar(id, tickets) {
  const t = tickets[id];
  if (!t?.dueDate) return;
  const calRef = push(ref(db, `events/${t.dueDate}`));
  await set(calRef, {
    id: calRef.key,
    title: `${t.ticketNum || ''} ${t.title}`,
    date: t.dueDate,
    dateEnd: t.dueDate,
    color: '#c0392b',
    client: t.client || '',
    note: `Ticket ${t.ticketNum || ''} 截止日`,
    type: 'ticket',
  });
  alert(`已加入行事曆：${t.dueDate}`);
}

// ── OPEN TICKET MODAL ──
export function openTicketModal(users) {
  updateAssignList(users);
  document.getElementById('t-dueDate').value = '';
  document.getElementById('t-startDate').value = today();
  document.getElementById('ticketModal').classList.add('open');
}

export function updateAssignList(users) {
  const sel = document.getElementById('t-assign');
  const cur = sel.value;
  sel.innerHTML = '<option value="">未指派</option>' +
    Object.entries(users).map(([, u]) => `<option value="${u.name}">${u.name}</option>`).join('');
  sel.value = cur;
}

// ── SAVE TICKET ──
export async function saveTicket(currentUser) {
  const title = document.getElementById('t-title').value.trim();
  if (!title) return;
  const ticketNum = await generateTicketNum();
  const td = today(), nt = nowTime();
  const histKey = push(ref(db, `tickets/${newRef.key}/history`)).key;
  await set(newRef, {
    ticketNum,
    title,
    client: document.getElementById('t-client').value,
    type: document.getElementById('t-type').value,
    priority: document.getElementById('t-priority').value,
    status: 'pending',
    assign: document.getElementById('t-assign').value,
    desc: document.getElementById('t-desc').value.trim(),
    startDate: document.getElementById('t-startDate').value || td,
    dueDate: document.getElementById('t-dueDate').value || '',
    created: td,
    createdBy: currentUser.name || currentUser.email,
    history: {
      [histKey]: {
        type: 'create',
        by: currentUser.name || currentUser.email,
        action: `建立 Ticket ${ticketNum}`,
        time: `${td} ${nt}`
      }
    }
  });
  document.getElementById('ticketModal').classList.remove('open');
  document.getElementById('t-title').value = '';
  document.getElementById('t-desc').value = '';
}
