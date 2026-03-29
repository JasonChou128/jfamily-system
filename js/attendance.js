import { db, today, nowTime } from './config.js';
import { ref, set, get, push, remove, update } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ── CONSTANTS ──
const WORK_START = '09:00';
const WORK_END = '18:00';
const LATE_TOLERANCE_MIN = 30; // 容忍30分鐘，09:30後才算遲到
const LEAVE_TYPES = ['事假', '年假', '公假', '補修'];

function timeToMin(t) {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
function minToTime(m) {
  return `${String(Math.floor(m / 60)).padStart(2,'0')}:${String(m % 60).padStart(2,'0')}`;
}

// ── ANOMALY DETECTION ──
function getAnomalies(rec) {
  const flags = [];
  if (!rec || rec.leave) return flags;
  if (rec.in) {
    if (timeToMin(rec.in) > timeToMin(WORK_START) + LATE_TOLERANCE_MIN)
      flags.push('遲到');
  }
  if (rec.out) {
    if (timeToMin(rec.out) < timeToMin(WORK_END))
      flags.push('早退');
  }
  return flags;
}

// ── OVERTIME CALCULATION ──
function calcOvertime(rec) {
  if (!rec?.out || rec.leave) return 0;
  const outMin = timeToMin(rec.out);
  const endMin = timeToMin(WORK_END);
  return outMin > endMin ? ((outMin - endMin) / 60).toFixed(1) : 0;
}

// ── WORK HOURS CALCULATION ──
function calcWorkHours(rec) {
  if (!rec?.in || !rec?.out) return null;
  if (rec.leave) return null;
  const diff = (timeToMin(rec.out) - timeToMin(rec.in)) / 60;
  return diff > 0 ? diff.toFixed(1) : null;
}

// ── STATUS LABEL ──
function getStatusBadge(rec) {
  if (!rec || (!rec.in && !rec.leave)) return '<span class="badge absent">缺勤</span>';
  if (rec.leave) return `<span class="badge leave">${rec.leaveType || '請假'}</span>`;
  const anomalies = getAnomalies(rec);
  if (!rec.out) return '<span class="badge present">上班中</span>';
  if (anomalies.length > 0) {
    return anomalies.map(a =>
      `<span class="badge ${a === '遲到' ? 'late' : 'early'}">${a}</span>`
    ).join(' ');
  }
  return '<span class="badge present">正常</span>';
}

// ── RENDER PUNCH AREA ──
export function renderAttPunch(currentUser, attendance, events) {
  if (!currentUser) return;
  const td = today();
  const rec = attendance[currentUser.uid]?.[td];
  const btn = document.getElementById('punchBtn');
  const st = document.getElementById('punchStatus');
  const fieldBtn = document.getElementById('fieldPunchBtn');
  if (!btn) return;

  // Check if on leave today
  if (rec?.leave) {
    btn.className = 'punch-btn done';
    btn.textContent = '今日請假';
    if (st) st.textContent = `${rec.leaveType || '請假'}`;
    if (fieldBtn) fieldBtn.style.display = 'none';
    return;
  }

  if (!rec?.in) {
    btn.className = 'punch-btn in'; btn.textContent = '上班打卡';
    if (st) st.textContent = '尚未打卡';
  } else if (!rec.out) {
    btn.className = 'punch-btn out'; btn.textContent = '下班打卡';
    const overtime = rec.in ? '' : '';
    if (st) st.textContent = `上班時間：${rec.in}`;
  } else {
    btn.className = 'punch-btn done'; btn.textContent = '今日已完成';
    const ot = calcOvertime(rec);
    const anomalies = getAnomalies(rec);
    let statusText = `上班 ${rec.in} ／ 下班 ${rec.out}`;
    if (ot > 0) statusText += `　加班 ${ot}h`;
    if (anomalies.length > 0) statusText += `　⚠ ${anomalies.join('、')}`;
    if (st) st.textContent = statusText;
    if (fieldBtn) fieldBtn.style.display = 'none';
  }

  // Show field work button if clocked in but not out
  if (rec?.in && !rec?.out && fieldBtn) fieldBtn.style.display = '';

  // Populate today's field work dropdown
  renderFieldEventSelect(events, td);
}

function renderFieldEventSelect(events, td) {
  const sel = document.getElementById('fieldEventSelect');
  if (!sel) return;
  const todayEvs = [];
  Object.entries(events || {}).forEach(([date, evts]) => {
    if (date !== td) return;
    if (typeof evts === 'object' && !evts.title) {
      Object.values(evts).forEach(e => { if (e?.title) todayEvs.push(e); });
    } else if (evts?.title) todayEvs.push(evts);
  });
  sel.innerHTML = '<option value="">－ 選擇今日行程</option>' +
    todayEvs.map(e => `<option value="${e.title}|${e.client||''}|${e.location||''}">${e.title}${e.client ? ' (' + e.client + ')' : ''}</option>`).join('');
}

// ── RENDER LOG TABLE ──
export function renderAttLog(currentUser, attendance) {
  if (!currentUser) return;
  const tbody = document.getElementById('attendanceLog');
  if (!tbody) return;
  const isAdmin = currentUser.role === 'admin';
  const uid = currentUser.uid;
  const rows = Object.entries(attendance[uid] || {}).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 30);

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:20px">暫無紀錄</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(([date, rec]) => {
    const hours = calcWorkHours(rec) || '-';
    const ot = rec?.leave ? '-' : (calcOvertime(rec) > 0 ? calcOvertime(rec) + 'h' : '-');
    const travel = rec?.travel ? rec.travel + 'h' : '-';
    const travelInfo = rec?.travelClient ? `${rec.travelClient}${rec.travelLocation ? ' · ' + rec.travelLocation : ''}` : '';
    const badge = getStatusBadge(rec);
    const editBtn = isAdmin ? `<button class="btn btn-ghost btn-sm" onclick="window.openEditAttendance('${uid}','${date}')">修正</button>` : '';
    return `<tr>
      <td>${date}</td>
      <td style="font-family:monospace">${rec?.in || '--:--'}</td>
      <td style="font-family:monospace">${rec?.out || '--:--'}</td>
      <td>${hours !== '-' ? hours + 'h' : '-'}</td>
      <td style="color:var(--accent)">${ot}</td>
      <td style="color:#60a5fa;font-size:12px">${travel}${travelInfo ? '<br><span style="color:var(--text-muted)">' + travelInfo + '</span>' : ''}</td>
      <td>${badge}</td>
      <td>${editBtn}</td>
    </tr>`;
  }).join('');
}

// ── PUNCH ──
export async function doPunch(currentUser, attendance) {
  const uid = currentUser.uid;
  const td = today();
  const rec = (attendance[uid]?.[td]) || { in: null, out: null };
  if (rec.leave) return; // Can't punch if on leave
  if (!rec.in) rec.in = nowTime();
  else if (!rec.out) rec.out = nowTime();
  else return;
  await set(ref(db, `attendance/${uid}/${td}`), rec);
}

// ── FIELD WORK PUNCH ──
export async function doFieldPunch(currentUser) {
  const uid = currentUser.uid;
  const td = today();
  const sel = document.getElementById('fieldEventSelect');
  const travelHours = document.getElementById('travelHours')?.value?.trim();
  const selectedEvent = sel?.value || '';

  let travelClient = '', travelLocation = '';
  if (selectedEvent) {
    const parts = selectedEvent.split('|');
    travelClient = parts[1] || '';
    travelLocation = parts[2] || '';
  } else {
    travelClient = document.getElementById('travelClient')?.value?.trim() || '';
    travelLocation = document.getElementById('travelLocation')?.value?.trim() || '';
  }

  const updates = {};
  if (travelHours) updates.travel = parseFloat(travelHours) || 0;
  if (travelClient) updates.travelClient = travelClient;
  if (travelLocation) updates.travelLocation = travelLocation;

  if (Object.keys(updates).length > 0) {
    const existing = (await get(ref(db, `attendance/${uid}/${td}`))).val() || {};
    await set(ref(db, `attendance/${uid}/${td}`), { ...existing, ...updates });
  }
  document.getElementById('fieldWorkPanel').style.display = 'none';
  document.getElementById('travelHours').value = '';
}

// ── LEAVE APPLICATION ──
export async function submitLeave(currentUser, events) {
  const leaveType = document.getElementById('leaveType')?.value;
  const leaveDate = document.getElementById('leaveDate')?.value;
  const leaveDateEnd = document.getElementById('leaveDateEnd')?.value || leaveDate;
  const leaveNote = document.getElementById('leaveNote')?.value?.trim() || '';
  if (!leaveDate || !leaveType) { alert('請填寫請假日期和假別'); return; }

  const uid = currentUser.uid;
  // Write attendance records for each leave day
  const start = new Date(leaveDate);
  const end = new Date(leaveDateEnd);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    await set(ref(db, `attendance/${uid}/${ds}`), {
      leave: true, leaveType, note: leaveNote, appliedAt: nowTime()
    });
  }

  // Auto add to calendar
  const calRef = push(ref(db, `events/${leaveDate}`));
  await set(calRef, {
    id: calRef.key,
    title: `${currentUser.name} ${leaveType}`,
    date: leaveDate,
    dateEnd: leaveDateEnd,
    color: '#8b5cf6',
    note: leaveNote,
    type: 'leave',
  });

  document.getElementById('leaveModal').classList.remove('open');
  document.getElementById('leaveDate').value = '';
  document.getElementById('leaveDateEnd').value = '';
  document.getElementById('leaveNote').value = '';
  alert(`${leaveType}申請成功，已同步至行事曆`);
}

// ── ADMIN: RENDER ALL USERS ATTENDANCE ──
export function renderAdminAttLog(users, attendance) {
  const tbody = document.getElementById('adminAttLog');
  if (!tbody) return;
  const td = today();
  tbody.innerHTML = Object.entries(users).map(([uid, u]) => {
    const rec = attendance[uid]?.[td];
    const badge = getStatusBadge(rec);
    const ot = rec ? calcOvertime(rec) : 0;
    return `<tr>
      <td>${u.role === 'admin' ? '👑' : '🔧'} ${u.name}</td>
      <td style="font-family:monospace">${rec?.in || '--:--'}</td>
      <td style="font-family:monospace">${rec?.out || '--:--'}</td>
      <td style="color:var(--accent)">${ot > 0 ? ot + 'h' : '-'}</td>
      <td>${badge}</td>
      <td><button class="btn btn-ghost btn-sm" onclick="window.openEditAttendance('${uid}','${td}')">修正</button></td>
    </tr>`;
  }).join('');
}

// ── ADMIN: EDIT ATTENDANCE RECORD ──
export function openEditAttendance(uid, date, attendance, users) {
  const rec = attendance[uid]?.[date] || {};
  const userName = users[uid]?.name || uid;
  document.getElementById('editAttUID').value = uid;
  document.getElementById('editAttDate').value = date;
  document.getElementById('editAttIn').value = rec.in || '';
  document.getElementById('editAttOut').value = rec.out || '';
  document.getElementById('editAttNote').value = rec.note || '';
  document.getElementById('editAttTitle').textContent = `修正打卡：${userName} ${date}`;
  document.getElementById('editAttModal').classList.add('open');
}

export async function saveEditAttendance(attendance) {
  const uid = document.getElementById('editAttUID').value;
  const date = document.getElementById('editAttDate').value;
  const inTime = document.getElementById('editAttIn').value;
  const outTime = document.getElementById('editAttOut').value;
  const note = document.getElementById('editAttNote').value.trim();
  const existing = attendance[uid]?.[date] || {};
  await set(ref(db, `attendance/${uid}/${date}`), {
    ...existing,
    in: inTime || null,
    out: outTime || null,
    note: note || existing.note || '',
    corrected: true,
  });
  document.getElementById('editAttModal').classList.remove('open');
}
