import { db } from './config.js';
import { ref, remove, update, set, onValue } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { statusLabel } from './tickets.js';
import { TIERS, tierOf, needsReport, isBoss } from './perm.js';

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

// ── USER MANAGEMENT（v2.5：權限四級＋附加權限） ──
const escA = s0 => String(s0 ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function renderUserList(currentUser, users) {
  if (!currentUser || !isBoss(currentUser)) return;
  const self = uid => uid === currentUser.uid;
  document.getElementById('userList').innerHTML = Object.entries(users).sort((a, b) => (a[1].role === 'pending' ? 0 : 1) - (b[1].role === 'pending' ? 0 : 1) || tierOf(b[1]) - tierOf(a[1]) || String(a[1].name).localeCompare(String(b[1].name))).map(([uid, u]) => {
    const t = tierOf(u), pend = u.role === 'pending';
    return `
    <tr>
      <td>
        <span id="name-display-${uid}">${escA(u.name)}</span>
        <input id="name-input-${uid}" value="${escA(u.name)}" style="display:none;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:4px 8px;color:var(--text);font-size:13px;width:120px">
      </td>
      <td style="font-size:12px;color:var(--text-muted)">${escA(u.email)}</td>
      <td>${pend ? '<span class="role-badge pending">待核准</span>' : `<select class="dr-in" id="tier-${uid}" ${self(uid) ? 'disabled title="不能變更自己的等級"' : ''}>${Object.entries(TIERS).map(([k, v]) => `<option value="${k}" ${+k === t ? 'selected' : ''}>${k} ${v}</option>`).join('')}</select>`}</td>
      <td style="text-align:center">${pend ? '' : `<input type="checkbox" id="rep-${uid}" ${needsReport(u) ? 'checked' : ''}>`}</td>
      <td style="text-align:center">${pend ? '' : `<input type="checkbox" id="inv-${uid}" ${u.inv ? 'checked' : ''}>`}</td>
      <td><div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <button id="edit-btn-${uid}" class="btn btn-ghost btn-sm" onclick="window.toggleEditUser('${uid}')">改名</button>
        <button id="save-btn-${uid}" class="btn btn-primary btn-sm" style="display:none" onclick="window.saveUserEdit('${uid}')">儲存姓名</button>
        ${pend
          ? `<button class="btn btn-primary btn-sm" onclick="window.toggleAdmin('${uid}','eng')">核准</button>`
          : `<button class="btn btn-primary btn-sm" onclick="window.saveTier('${uid}')">儲存權限</button>`}
        ${!self(uid) ? `<button class="btn btn-danger btn-sm" onclick="window.deleteUser('${uid}')">刪除</button>` : ''}
      </div></td>
    </tr>`;
  }).join('');
}

// 儲存等級與附加權限：4 級對應 role 'admin'，其餘為 'eng'（安全規則依 role 與 tier 判斷）
export async function saveTier(uid, currentUser, users) {
  if (!isBoss(currentUser)) return;
  const u = users[uid]; if (!u) return;
  const tier = uid === currentUser.uid ? tierOf(u) : +document.getElementById('tier-' + uid).value;
  const report = document.getElementById('rep-' + uid).checked, inv = document.getElementById('inv-' + uid).checked;
  if (uid !== currentUser.uid && tierOf(u) === 4 && tier < 4 && !confirm(`確定將「${u.name}」由主管降為 ${tier} ${TIERS[tier]}？`)) { renderUserList(currentUser, users); return; }
  try {
    await update(ref(db, `users/${uid}`), { tier, role: tier === 4 ? 'admin' : 'eng', report, inv });
    alert(`已儲存：${u.name}　${tier} ${TIERS[tier]}${report ? '' : '・不填日報'}${inv ? '・庫存管理' : ''}`);
  } catch (e) { alert('儲存失敗：' + e.message); }
}

export function toggleEditUser(uid) {
  const isEditing = document.getElementById('name-input-' + uid).style.display !== 'none';
  ['name'].forEach(f => {
    document.getElementById(`${f}-display-${uid}`).style.display = isEditing ? '' : 'none';
    document.getElementById(`${f}-input-${uid}`).style.display = isEditing ? 'none' : '';
  });
  document.getElementById('edit-btn-' + uid).style.display = isEditing ? '' : 'none';
  document.getElementById('save-btn-' + uid).style.display = isEditing ? 'none' : '';
}

export async function saveUserEdit(uid) {
  const name = document.getElementById('name-input-' + uid).value.trim();
  if (!name) { alert('姓名不能為空'); return; }
  // v1.6：Email 為登入帳號，改由 Firebase 主控台管理，此處只改姓名
  await update(ref(db, `users/${uid}`), { name });
  toggleEditUser(uid);
}

export async function toggleAdmin(uid, role) {
  // v2.5：只用於核准新帳號（預設 1 工程師、要填日報）
  await update(ref(db, `users/${uid}`), role === 'eng' ? { role, tier: 1, report: true } : { role });
}

export async function deleteUser(uid) {
  // v1.6：此處只刪除系統資料；登入帳號需另至 Firebase 主控台 Authentication 刪除
  if (confirm('確定刪除此帳號？\n（登入帳號請另至 Firebase 主控台刪除）')) await remove(ref(db, `users/${uid}`));
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
  const n = new Date();
  const td = `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;

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
