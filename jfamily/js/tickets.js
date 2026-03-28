import { db, today } from './config.js';
import { ref, set, push, remove, update } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

let ticketFilter = 'all';
let editingTicketId = null;

export function statusLabel(s) {
  return { pending: '待處理', progress: '進行中', done: '已完成' }[s] || s;
}

export function filterTickets(f, el) {
  ticketFilter = f;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
}

export function renderTickets(tickets) {
  let entries = Object.entries(tickets);
  if (ticketFilter !== 'all') entries = entries.filter(([, t]) => t.status === ticketFilter);
  entries.sort((a, b) => b[0].localeCompare(a[0]));
  document.getElementById('ticketList').innerHTML = entries.length === 0
    ? '<div class="empty-state"><div class="icon">🎫</div>沒有符合的票單</div>'
    : entries.map(([id, t]) => `
      <div class="ticket-card ${t.priority}" onclick="window.openTicketDetail('${id}')">
        <div class="ticket-header">
          <span class="ticket-id">${id}</span>
          <span class="ticket-title">${t.title}</span>
          <span class="ticket-status status-${t.status}">${statusLabel(t.status)}</span>
        </div>
        <div class="ticket-meta">
          <span><span class="priority-dot p-${t.priority}"></span>${{high:'高',medium:'中',low:'低'}[t.priority]}</span>
          <span>${t.client}</span><span>${t.type}</span>
          <span>${t.assign || '未指派'}</span><span>${t.created}</span>
        </div>
      </div>`).join('');
}

export function openTicketDetail(id, tickets, currentUser) {
  editingTicketId = id;
  const t = tickets[id];
  if (!t) return;
  const isAdmin = currentUser.role === 'admin';
  document.getElementById('td-title').textContent = id + ' · ' + t.title;
  const row = (l, v) => `<tr><td style="padding:6px 0;color:var(--text-muted);width:80px">${l}</td><td style="padding:6px 0">${v}</td></tr>`;
  document.getElementById('td-content').innerHTML = `
    <table style="width:100%;font-size:13px;border-collapse:collapse">
      ${row('客戶', t.client)}${row('設備', t.type)}
      ${row('優先', {high:'🔴 高',medium:'🟡 中',low:'🔵 低'}[t.priority])}
      ${row('指派', t.assign || '未指派')}${row('狀態', statusLabel(t.status))}${row('建立', t.created)}
    </table>
    <div style="margin-top:14px;padding:12px;background:var(--surface2);border-radius:8px;font-size:13px;line-height:1.7">${t.desc || '（無描述）'}</div>`;
  const btn = document.getElementById('td-progress-btn');
  btn.style.display = t.status === 'done' ? 'none' : '';
  btn.textContent = t.status === 'pending' ? '標記進行中' : '標記完成';
  document.getElementById('td-delete-btn').style.display = isAdmin ? '' : 'none';
  document.getElementById('ticketDetailModal').classList.add('open');
}

export async function advanceTicket(tickets) {
  const t = tickets[editingTicketId];
  if (!t) return;
  await update(ref(db, `tickets/${editingTicketId}`), { status: t.status === 'pending' ? 'progress' : 'done' });
  document.getElementById('ticketDetailModal').classList.remove('open');
}

export async function deleteTicket() {
  if (!confirm('確定要刪除這張票單？')) return;
  await remove(ref(db, `tickets/${editingTicketId}`));
  document.getElementById('ticketDetailModal').classList.remove('open');
}

export function openTicketModal(users) {
  updateAssignList(users);
  document.getElementById('ticketModal').classList.add('open');
}

export function updateAssignList(users) {
  const sel = document.getElementById('t-assign');
  const cur = sel.value;
  sel.innerHTML = '<option value="">未指派</option>' +
    Object.entries(users).map(([, u]) => `<option value="${u.name}">${u.name}</option>`).join('');
  sel.value = cur;
}

export async function saveTicket(currentUser) {
  const title = document.getElementById('t-title').value.trim();
  if (!title) return;
  await set(push(ref(db, 'tickets')), {
    title,
    client: document.getElementById('t-client').value,
    type: document.getElementById('t-type').value,
    priority: document.getElementById('t-priority').value,
    status: 'pending',
    assign: document.getElementById('t-assign').value,
    desc: document.getElementById('t-desc').value.trim(),
    created: today(),
    createdBy: currentUser.email,
  });
  document.getElementById('ticketModal').classList.remove('open');
  document.getElementById('t-title').value = '';
  document.getElementById('t-desc').value = '';
}
