import { db } from './config.js';
import { ref, remove, update, set, onValue } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { statusLabel } from './tickets.js';

// ── 台灣官方假日預設資料（依行政院人事行政總處公告）──
const TW_HOLIDAYS_PRESET = {
  2025: {
    '2025-01-01': '元旦',
    '2025-01-27': '除夕',
    '2025-01-28': '春節初一',
    '2025-01-29': '春節初二',
    '2025-01-30': '春節初三',
    '2025-01-31': '春節初四',
    '2025-02-01': '春節初五',
    '2025-02-28': '和平紀念日',
    '2025-04-03': '兒童節補假',
    '2025-04-04': '兒童節',
    '2025-04-05': '清明節',
    '2025-05-01': '勞動節',
    '2025-05-30': '端午節補假',
    '2025-05-31': '端午節',
    '2025-10-06': '中秋節',
    '2025-10-10': '國慶日',
  },
  2026: {
    '2026-01-01': '元旦',
    '2026-02-15': '除夕',
    '2026-02-16': '春節初一',
    '2026-02-17': '春節初二',
    '2026-02-18': '春節初三',
    '2026-02-19': '春節初四',
    '2026-02-20': '春節初五',
    '2026-02-28': '和平紀念日',
    '2026-04-03': '兒童節補假',
    '2026-04-04': '兒童節',
    '2026-05-01': '勞動節',
    '2026-06-19': '端午節',
    '2026-09-25': '中秋節補假',
    '2026-09-26': '中秋節',
    '2026-10-09': '國慶日補假',
    '2026-10-10': '國慶日',
  },
  2027: {
    '2027-01-01': '元旦',
    '2027-02-05': '除夕',
    '2027-02-06': '春節初一',
    '2027-02-07': '春節初二',
    '2027-02-08': '春節初三',
    '2027-02-09': '春節初四',
    '2027-02-28': '和平紀念日',
    '2027-04-02': '兒童節補假',
    '2027-04-03': '清明節',
    '2027-04-04': '兒童節',
    '2027-05-01': '勞動節',
    '2027-06-09': '端午節',
    '2027-10-04': '中秋節',
    '2027-10-10': '國慶日',
  }
};

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
let currentHolidayData = {};

export function initHolidayAdmin() {
  onValue(ref(db, 'holidays'), snap => {
    currentHolidayData = snap.val() || {};
    renderHolidayAdmin();
  });
}

export function renderHolidayAdmin() {
  const yearSel = document.getElementById('holiday-year-sel');
  if (!yearSel) return;
  const yr = parseInt(yearSel.value) || new Date().getFullYear();
  const holidays = currentHolidayData[yr] || {};
  const container = document.getElementById('holiday-list');
  if (!container) return;

  if (Object.keys(holidays).length === 0) {
    container.innerHTML = `<div style="font-size:13px;color:var(--text-muted);padding:12px 0">尚無假日資料，請點「一鍵載入官方假日」</div>`;
    return;
  }

  container.innerHTML = Object.entries(holidays)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, name]) => `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
        <span style="font-family:monospace;font-size:12px;color:var(--accent);min-width:90px">${date}</span>
        <span style="font-size:13px;flex:1">${name}</span>
        <button class="btn btn-danger btn-sm" onclick="window.deleteHoliday(${yr},'${date}')">刪除</button>
      </div>`).join('');
}

export async function loadPresetHolidays() {
  const yearSel = document.getElementById('holiday-year-sel');
  const yr = parseInt(yearSel.value);
  const preset = TW_HOLIDAYS_PRESET[yr];
  if (!preset) {
    alert(`${yr}年的預設假日資料尚未建立，請手動新增`);
    return;
  }
  if (!confirm(`確定載入${yr}年台灣官方假日？現有資料將被覆蓋。`)) return;

  const btn = document.getElementById('load-preset-btn');
  btn.textContent = '載入中...';
  btn.disabled = true;

  await set(ref(db, `holidays/${yr}`), preset);

  btn.textContent = `✓ ${yr}年假日已載入`;
  setTimeout(() => { btn.textContent = '一鍵載入官方假日'; btn.disabled = false; }, 2000);
}

export async function addManualHoliday() {
  const yearSel = document.getElementById('holiday-year-sel');
  const dateInput = document.getElementById('holiday-date-input');
  const nameInput = document.getElementById('holiday-name-input');
  const yr = parseInt(yearSel.value);
  const date = dateInput.value.trim();
  const name = nameInput.value.trim();
  if (!date || !name) { alert('請填寫日期和假日名稱'); return; }
  await set(ref(db, `holidays/${yr}/${date}`), name);
  dateInput.value = '';
  nameInput.value = '';
}

export async function deleteHoliday(year, date) {
  if (confirm(`確定刪除 ${date}？`)) {
    await remove(ref(db, `holidays/${year}/${date}`));
  }
}

// ── REPORT ──
export function generateReport(users, tickets, inventory, attendance, events) {
  const td = new Date().toISOString().slice(0, 10);

  const attSummary = Object.entries(users).map(([uid, u]) => {
    const rec = attendance[uid]?.[td];
    return `  ${u.name}(${u.email}): ${rec?.in ? `上班${rec.in}${rec.out ? ' 下班' + rec.out : '（上班中）'}` : '未打卡'}`;
  }).join('\n');

  const ticketSummary = Object.entries(tickets).map(([id, t]) =>
    `  ${id} [${statusLabel(t.status)}] ${t.title}\n     客戶:${t.client} 指派:${t.assign || '未指派'}`
  ).join('\n');

  const invSummary = Object.entries(inventory).map(([, i]) =>
    `  ${i.name}(${i.cat}): ${i.qty}/${i.max} ${i.qty < i.min ? '⚠️ 庫存不足' : ''}`
  ).join('\n');

  const allEvs = [];
  Object.entries(events).forEach(([date, evts]) => {
    if (typeof evts === 'object' && !evts.title) Object.values(evts).forEach(e => { if (e?.date >= td) allEvs.push(e); });
    else if (evts?.date >= td) allEvs.push(evts);
  });
  const upcoming = allEvs.sort((a, b) => (a.date || '').localeCompare(b.date || '')).slice(0, 5)
    .map(e => `  ${e.date} ${e.time || ''} ${e.title}`).join('\n');

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
