import { db } from './config.js';
import { ref, remove, update, onValue } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { statusLabel } from './tickets.js';
import { saveManualHoliday, deleteManualHoliday, refreshHolidays } from './calendar.js';

// ── USER MANAGEMENT ──
export function renderUserList(currentUser, users) {
  if (!currentUser || currentUser.role !== 'admin') return;
  document.getElementById('userList').innerHTML = Object.entries(users).map(([uid, u]) => `
    <tr>
      <td>
        <span id="name-display-${uid}">${u.name}</span>
        <input id="name-input-${uid}" value="${u.name}" style="display:none;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:4px 8px;color:var(--text);font-size:13px;width:120px">
      </td>
      <td style="font-size:12px;color:var(--text-muted)">
        <span id="email-display-${uid}">${u.email}</span>
        <input id="email-input-${uid}" value="${u.email}" style="display:none;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:4px 8px;color:var(--text);font-size:13px;width:160px">
      </td>
      <td><span class="role-badge ${u.role}">${u.role === 'admin' ? '管理者' : '工程師'}</span></td>
      <td style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <button id="edit-btn-${uid}" class="btn btn-ghost btn-sm" onclick="window.toggleEditUser('${uid}')">編輯</button>
        <button id="save-btn-${uid}" class="btn btn-primary btn-sm" style="display:none" onclick="window.saveUserEdit('${uid}')">儲存</button>
        <button class="btn btn-ghost btn-sm" onclick="window.toggleAdmin('${uid}','${u.role === 'admin' ? 'eng' : 'admin'}')">${u.role === 'admin' ? '降為工程師' : '升為管理者'}</button>
        ${u.email !== currentUser.email ? `<button class="btn btn-danger btn-sm" onclick="window.deleteUser('${uid}')">刪除</button>` : ''}
      </td>
    </tr>`).join('');
}

export function toggleEditUser(uid) {
  const isEditing = document.getElementById('name-input-' + uid).style.display !== 'none';
  ['name', 'email'].forEach(f => {
    document.getElementById(`${f}-display-${uid}`).style.display = isEditing ? '' : 'none';
    document.getElementById(`${f}-input-${uid}`).style.display = isEditing ? 'none' : '';
  });
  document.getElementById('edit-btn-' + uid).style.display = isEditing ? '' : 'none';
  document.getElementById('save-btn-' + uid).style.display = isEditing ? 'none' : '';
}

export async function saveUserEdit(uid) {
  const name = document.getElementById('name-input-' + uid).value.trim();
  const email = document.getElementById('email-input-' + uid).value.trim().toLowerCase();
  if (!name || !email) { alert('姓名和Email不能為空'); return; }
  await update(ref(db, `users/${uid}`), { name, email });
  toggleEditUser(uid);
}

export async function toggleAdmin(uid, role) {
  await update(ref(db, `users/${uid}`), { role });
}

export async function deleteUser(uid) {
  if (confirm('確定刪除此帳號？')) await remove(ref(db, `users/${uid}`));
}

// ── HOLIDAY MANAGEMENT ──
let manualHolidayData = {};

export function initHolidayAdmin() {
  onValue(ref(db, 'holidays_manual'), snap => {
    manualHolidayData = snap.val() || {};
    renderHolidayAdmin();
  });
}

export function renderHolidayAdmin() {
  const yearSel = document.getElementById('holiday-year-sel');
  if (!yearSel) return;
  const yr = parseInt(yearSel.value) || new Date().getFullYear();
  const manuals = manualHolidayData[yr] || {};
  const container = document.getElementById('holiday-manual-list');
  if (!container) return;

  if (Object.keys(manuals).length === 0) {
    container.innerHTML = '<div style="font-size:13px;color:var(--text-muted);padding:8px 0">無手動補充假日</div>';
    return;
  }

  container.innerHTML = Object.entries(manuals)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, name]) => `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
        <span style="font-family:monospace;font-size:12px;color:var(--accent)">${date}</span>
        <span style="font-size:13px;flex:1">${name}</span>
        <button class="btn btn-danger btn-sm" onclick="window.deleteHoliday(${yr},'${date}')">刪除</button>
      </div>`).join('');
}

export async function addManualHoliday() {
  const yearSel = document.getElementById('holiday-year-sel');
  const dateInput = document.getElementById('holiday-date-input');
  const nameInput = document.getElementById('holiday-name-input');
  const yr = parseInt(yearSel.value);
  const date = dateInput.value.trim();
  const name = nameInput.value.trim();

  if (!date || !name) { alert('請填寫日期和假日名稱'); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { alert('日期格式請用 YYYY-MM-DD'); return; }

  await saveManualHoliday(yr, date, name);
  dateInput.value = '';
  nameInput.value = '';
}

export async function deleteHoliday(year, date) {
  if (confirm(`確定刪除 ${date} 的假日？`)) {
    await deleteManualHoliday(year, date);
  }
}

export async function doRefreshHolidays() {
  const yr = parseInt(document.getElementById('holiday-year-sel').value);
  const btn = document.getElementById('refresh-holiday-btn');
  btn.textContent = '更新中...';
  btn.disabled = true;
  await refreshHolidays(yr);
  btn.textContent = '✓ 更新完成';
  setTimeout(() => { btn.textContent = '從 Google 重新抓取'; btn.disabled = false; }, 2000);
}

// ── REPORT ──
export function generateReport(users, tickets, inventory, attendance, events) {
  const td = new Date().toISOString().slice(0, 10);

  const attSummary = Object.entries(users).map(([uid, u]) => {
    const rec = attendance[uid]?.[td];
    return `  ${u.name}(${u.email}): ${rec?.in
      ? `上班${rec.in}${rec.out ? ' 下班' + rec.out : '（上班中）'}`
      : '未打卡'}`;
  }).join('\n');

  const ticketSummary = Object.entries(tickets).map(([id, t]) =>
    `  ${id} [${statusLabel(t.status)}] ${t.title}\n     客戶:${t.client} 指派:${t.assign || '未指派'}`
  ).join('\n');

  const invSummary = Object.entries(inventory).map(([, i]) =>
    `  ${i.name}(${i.cat}): ${i.qty}/${i.max} ${i.qty < i.min ? '⚠️ 庫存不足' : ''}`
  ).join('\n');

  const allEvents = Object.values(events).flat().filter(Boolean);
  const upcoming = allEvents
    .filter(e => e.date >= td)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .slice(0, 5)
    .map(e => `  ${e.date} ${e.time || ''} ${e.title}`)
    .join('\n');

  return `售後服務管理系統 · 每日報表
日期：${td}
產出時間：${new Date().toLocaleTimeString('zh-TW')}
${'='.repeat(42)}

【今日出勤狀況】
${attSummary || '  無資料'}

【Issue Tickets】
${ticketSummary || '  無資料'}

【物料庫存】
${invSummary || '  無資料'}

【近期排程】
${upcoming || '  無排程'}
${'='.repeat(42)}`;
}
