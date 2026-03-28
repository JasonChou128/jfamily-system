import { db, today } from './config.js';
import { ref, set, push, remove, get, onValue } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const MONTHS_TW = ['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];

export let calYear = new Date().getFullYear();
export let calMonth = new Date().getMonth();

let pickerYr = calYear;
let pickerOpen = false;
let cachedHolidays = {}; // { year: { 'YYYY-MM-DD': 'name' } }

function pad(n) { return String(n).padStart(2, '0'); }
function getWeekNum(d) {
  const j = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const w = new Date(Date.UTC(j.getUTCFullYear(), 0, 1));
  return Math.ceil(((j - w) / 86400000 + w.getUTCDay() + 1) / 7);
}

// ── LISTEN TO HOLIDAYS FROM FIREBASE ──
export function listenHolidays() {
  onValue(ref(db, 'holidays'), snap => {
    cachedHolidays = snap.val() || {};
    const cal = document.getElementById('calTable');
    if (cal) renderCalendar(window._calEvents || {});
  });
}

function getHolidaysForYear(year) {
  return cachedHolidays[year] || {};
}

// ── RENDER ──
export function renderCalendar(events) {
  window._calEvents = events;
  const mBtn = document.getElementById('mBtn');
  const calTable = document.getElementById('calTable');
  if (!mBtn || !calTable) return;

  mBtn.textContent = `${calYear} ${MONTHS_TW[calMonth]}`;

  const holidays = getHolidaysForYear(calYear);
  const todayStr = today();
  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const totalDays = new Date(calYear, calMonth + 1, 0).getDate();
  const prevTotal = new Date(calYear, calMonth, 0).getDate();

  // Build weeks array
  const weeks = [];
  let week = [];
  for (let i = 0; i < firstDay; i++) week.push({ d: prevTotal - firstDay + i + 1, type: 'prev' });
  for (let d = 1; d <= totalDays; d++) {
    week.push({ d, type: 'cur' });
    if (week.length === 7) { weeks.push(week); week = []; }
  }
  if (week.length > 0) {
    let nd = 1;
    while (week.length < 7) week.push({ d: nd++, type: 'next' });
    weeks.push(week);
  }

  const colorMap = { '#e8c14a': 'y', '#c0392b': 'r', '#27ae60': 'g', '#3b82f6': 'b' };
  const dotColors = { y: '#d4a820', r: '#e05252', g: '#27ae60', b: '#60a5fa' };

  let html = `<thead><tr>
    <th style="font-size:10px;color:var(--text-dim);font-weight:500;padding:5px 0;text-align:center;width:28px">週</th>
    <th style="font-size:10px;color:#7a3535;font-weight:500;padding:5px 0;text-align:center">日</th>
    <th style="font-size:10px;color:var(--text-muted);font-weight:500;padding:5px 0;text-align:center">一</th>
    <th style="font-size:10px;color:var(--text-muted);font-weight:500;padding:5px 0;text-align:center">二</th>
    <th style="font-size:10px;color:var(--text-muted);font-weight:500;padding:5px 0;text-align:center">三</th>
    <th style="font-size:10px;color:var(--text-muted);font-weight:500;padding:5px 0;text-align:center">四</th>
    <th style="font-size:10px;color:var(--text-muted);font-weight:500;padding:5px 0;text-align:center">五</th>
    <th style="font-size:10px;color:#7a3535;font-weight:500;padding:5px 0;text-align:center">六</th>
  </tr></thead><tbody>`;

  weeks.forEach(wk => {
    const firstCur = wk.find(c => c.type === 'cur');
    const wkDate = firstCur ? new Date(calYear, calMonth, firstCur.d) : new Date(calYear, calMonth, 1);
    html += `<tr><td style="text-align:center;font-size:9px;color:var(--text-dim);padding:2px;vertical-align:middle">${getWeekNum(wkDate)}</td>`;

    wk.forEach((cell, idx) => {
      const isOther = cell.type !== 'cur';
      const dow = idx;
      const isWeekend = dow === 0 || dow === 6;
      const ds = isOther ? '' : `${calYear}-${pad(calMonth + 1)}-${pad(cell.d)}`;
      const holiday = isOther ? null : holidays[ds];
      const dayEvents = isOther ? [] : (() => {
        const result = [];
        // New format: events[date][key] = event
        if (events[ds] && typeof events[ds] === 'object' && !events[ds].title) {
          Object.values(events[ds]).forEach(e => { if (e && e.title) result.push(e); });
        }
        // Old flat format: events[key] = { date, title, ... }
        Object.values(events).forEach(e => {
          if (e && typeof e === 'object' && e.title && (e.date === ds || e.start === ds)) {
            if (!result.find(r => r.title === e.title && r.date === ds)) result.push(e);
          }
        });
        return result;
      })();
      const isToday = !isOther && ds === todayStr;

      // Cell background
      const bg = holiday ? 'background:rgba(192,57,43,.08);outline:1px solid rgba(192,57,43,.18);' : '';
      const opacity = isOther ? 'opacity:.2;pointer-events:none;' : '';
      const numColor = isWeekend && !isOther ? 'color:#c0392b;' : '';

      // Day number style
      const numStyle = isToday
        ? 'background:var(--accent);color:#0a0a0f;width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;'
        : `font-size:12px;font-weight:500;line-height:1;${numColor}`;

      let inner = `<div style="${numStyle}">${cell.d}</div>`;
      if (holiday) inner += `<span style="font-size:9px;color:#c0705a;line-height:1.2;display:block;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%">${holiday}</span>`;

      dayEvents.slice(0, 2).forEach(e => {
        const c = colorMap[e.color] || 'y';
        const epBg = { y: 'rgba(232,193,74,.18)', r: 'rgba(192,57,43,.2)', g: 'rgba(39,174,96,.18)', b: 'rgba(59,130,246,.18)' }[c];
        const epColor = dotColors[c];
        inner += `<span style="font-size:9px;padding:2px 4px;border-radius:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.4;display:block;margin-bottom:1px;background:${epBg};color:${epColor}">${e.title || ''}</span>`;
      });
      if (dayEvents.length > 2) inner += `<span style="font-size:9px;color:var(--text-muted);display:block">+${dayEvents.length - 2}</span>`;

      // Tooltip
      let tooltip = '';
      if (!isOther && (dayEvents.length > 0 || holiday)) {
        let rows = '';
        if (holiday) rows += `<div style="color:var(--text-muted);line-height:1.8;display:flex;align-items:center;gap:5px"><div style="width:6px;height:6px;border-radius:50%;background:#c0392b;flex-shrink:0"></div>${holiday}</div>`;
        dayEvents.forEach(e => {
          const c = colorMap[e.color] || 'y';
          rows += `<div style="color:var(--text-muted);line-height:1.8;display:flex;align-items:center;gap:5px"><div style="width:6px;height:6px;border-radius:50%;background:${dotColors[c]};flex-shrink:0"></div>${e.title || ''}<span style="color:var(--accent);margin-left:auto;font-size:10px">${e.time || ''}</span></div>`;
        });
        tooltip = `<div style="position:absolute;left:calc(100% + 4px);top:0;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:9px 11px;font-size:11px;pointer-events:none;z-index:200;min-width:160px;display:none;white-space:nowrap" class="cal-tip">
          <div style="font-size:10px;font-weight:600;color:var(--accent);margin-bottom:5px;padding-bottom:4px;border-bottom:1px solid var(--border)">${calYear}/${pad(calMonth+1)}/${pad(cell.d)}</div>
          ${rows}
        </div>`;
      }

      html += `<td style="border-radius:6px;cursor:pointer;transition:background .15s;position:relative;padding:5px 6px;vertical-align:top;${bg}${opacity}" onmouseenter="this.querySelector('.cal-tip')&&(this.querySelector('.cal-tip').style.display='block')" onmouseleave="this.querySelector('.cal-tip')&&(this.querySelector('.cal-tip').style.display='none')">${inner}${tooltip}</td>`;
    });
    html += `</tr>`;
  });
  html += '</tbody>';
  calTable.innerHTML = html;

  renderEventList(events);
}

function renderEventList(events) {
  const el = document.getElementById('eventList');
  if (!el) return;
  const allEvs = [];
  const seen = new Set();

  Object.entries(events).forEach(([key, val]) => {
    if (val && typeof val === 'object') {
      if (val.title) {
        // Old flat format: { title, date, color... }
        const id = key;
        if (!seen.has(id)) { seen.add(id); allEvs.push({ ...val, _id: key, _date: val.date || key, _key: key }); }
      } else {
        // New nested format: { subkey: { title, date... } }
        Object.entries(val).forEach(([subkey, e]) => {
          if (e && e.title) {
            const id = `${key}/${subkey}`;
            if (!seen.has(id)) { seen.add(id); allEvs.push({ ...e, _date: key, _key: subkey }); }
          }
        });
      }
    }
  });

  allEvs.sort((a, b) => (a.date || a._date || '').localeCompare(b.date || b._date || ''));

  el.innerHTML = allEvs.length === 0
    ? '<div class="empty-state"><div class="icon">📅</div>尚無排程</div>'
    : allEvs.map(e => {
        const meta = [
          e.date || e._date,
          e.time ? (e.timeEnd ? `${e.time}－${e.timeEnd}` : e.time) : '',
          e.client || '',
          e.location || '',
          e.assign || '',
          e.equipment || '',
        ].filter(Boolean).join(' · ');
        return `
        <div class="cal-event-item">
          <div class="cal-event-dot" style="background:${e.color || '#e8c14a'}"></div>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:500">${e.title}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${meta}</div>
            ${e.note ? `<div style="font-size:11px;color:var(--text-dim);margin-top:2px">${e.note}</div>` : ''}
          </div>
          <button onclick="window.deleteEvent('${e._date}','${e._key}')" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:18px">×</button>
        </div>`;
      }).join('');
}

// ── NAVIGATION ──
export function changeMonth(delta) {
  calMonth += delta;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  if (calMonth < 0) { calMonth = 11; calYear--; }
}

export function togglePicker() {
  pickerYr = calYear;
  pickerOpen = !pickerOpen;
  const p = document.getElementById('picker');
  if (p) p.style.display = pickerOpen ? 'block' : 'none';
  if (pickerOpen) renderPicker();
}

export function closePicker() {
  pickerOpen = false;
  const p = document.getElementById('picker');
  if (p) p.style.display = 'none';
}

export function changePickerYear(delta) {
  pickerYr += delta;
  renderPicker();
}

function renderPicker() {
  const pYr = document.getElementById('pYr');
  const pMonths = document.getElementById('pMonths');
  if (!pYr || !pMonths) return;
  pYr.textContent = pickerYr;
  pMonths.innerHTML = MONTHS_TW.map((m, i) => {
    const isActive = i === calMonth && pickerYr === calYear;
    return `<div onclick="window.selectMonth(${i})" style="background:${isActive ? 'rgba(232,193,74,.15)' : 'var(--surface2)'};border:1px solid ${isActive ? 'var(--accent)' : 'var(--border)'};color:${isActive ? 'var(--accent)' : 'var(--text-muted)'};border-radius:6px;padding:7px 4px;text-align:center;cursor:pointer;font-size:12px;font-weight:${isActive ? '600' : '400'}">${m}</div>`;
  }).join('');
}

export function selectMonth(m) {
  calYear = pickerYr;
  calMonth = m;
  closePicker();
  renderCalendar(window._calEvents || {});
}

export function goToday() {
  const now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth();
  renderCalendar(window._calEvents || {});
}

// ── EVENTS CRUD ──
export function openEventModal(users) {
  const td = today();
  document.getElementById('e-date').value = td;
  document.getElementById('e-date-end').value = td;
  document.getElementById('e-time').value = '';
  document.getElementById('e-time-end').value = '';
  document.getElementById('e-title').value = '';
  document.getElementById('e-note').value = '';
  document.getElementById('e-location').value = '';
  // Populate assign dropdown
  const assignSel = document.getElementById('e-assign');
  const cur = assignSel.value;
  if (users) {
    assignSel.innerHTML = '<option value="">未指派</option>' +
      Object.entries(users).map(([, u]) => `<option value="${u.name}">${u.name}</option>`).join('');
  }
  assignSel.value = cur;
  document.getElementById('eventModal').classList.add('open');
}

export async function saveEvent() {
  const title = document.getElementById('e-title').value.trim();
  if (!title) return;
  const date = document.getElementById('e-date').value;
  const newRef = push(ref(db, `events/${date}`));
  await set(newRef, {
    id: newRef.key,
    title,
    date,
    dateEnd: document.getElementById('e-date-end').value || date,
    time: document.getElementById('e-time').value || '',
    timeEnd: document.getElementById('e-time-end').value || '',
    color: document.getElementById('e-type').value,
    client: document.getElementById('e-client').value || '',
    equipment: document.getElementById('e-equipment').value || '',
    assign: document.getElementById('e-assign').value || '',
    location: document.getElementById('e-location').value.trim() || '',
    reminder: document.getElementById('e-reminder').value || '',
    note: document.getElementById('e-note').value.trim(),
  });
  document.getElementById('eventModal').classList.remove('open');
  document.getElementById('e-title').value = '';
  document.getElementById('e-note').value = '';
}

export async function deleteEvent(date, key) {
  await remove(ref(db, `events/${date}/${key}`));
}
