import { db } from './config.js';
import { ref, onValue } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { statusLabel } from './tickets.js';

export function renderDashboard(currentUser, tickets, inventory, attendance, users) {
  if (!currentUser) return;
  const _n = new Date(); const td = `${_n.getFullYear()}-${String(_n.getMonth()+1).padStart(2,'0')}-${String(_n.getDate()).padStart(2,'0')}`;
  let present = 0;
  Object.keys(users).forEach(uid => { if (attendance[uid]?.[td]?.in) present++; });

  document.getElementById('stat-present').textContent = present;
  const tArr = Object.values(tickets);
  document.getElementById('stat-tickets-open').textContent = tArr.filter(t => t.status === 'pending').length;
  document.getElementById('stat-tickets-progress').textContent = tArr.filter(t => t.status === 'progress').length;
  document.getElementById('stat-inv-ok').textContent = Object.values(inventory).filter(i => i.qty >= i.min).length;

  const recent = Object.entries(tickets).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 3);
  document.getElementById('dash-recent-tickets').innerHTML = recent.length === 0
    ? '<div class="empty-state"><div class="icon">🎫</div>暫無票單</div>'
    : recent.map(([id, t]) => `
      <div class="ticket-card ${t.priority}" onclick="window.openTicketDetail('${id}')">
        <div class="ticket-header">
          <span class="ticket-id">${id}</span>
          <span class="ticket-title">${t.title}</span>
          <span class="ticket-status status-${t.status}">${statusLabel(t.status)}</span>
        </div>
        <div class="ticket-meta"><span>${t.client}</span><span>${t.assign || '未指派'}</span></div>
      </div>`).join('');

  document.getElementById('dash-attendance').innerHTML = Object.entries(users).map(([uid, u]) => {
    const rec = attendance[uid]?.[td];
    return `<tr>
      <td>${u.role === 'admin' ? '👑' : '🔧'} ${u.name}</td>
      <td style="font-family:monospace">${rec?.in || '--:--'}</td>
      <td style="font-family:monospace">${rec?.out || '--:--'}</td>
      <td><span class="badge ${rec?.in ? 'present' : 'absent'}">${rec?.in ? (rec.out ? '已下班' : '上班中') : '未打卡'}</span></td>
    </tr>`;
  }).join('');
}
