import { db, today } from './config.js';
import { ref, set, push, remove, onValue, get } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const WORKER_URL = 'https://jfamily-api.z886086.workers.dev';
const MONTHS_TW = ['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];

export let calYear = new Date().getFullYear();
export let calMonth = new Date().getMonth();

// Holiday cache: { year: { 'YYYY-MM-DD': 'name' } }
let holidayCache = {};
// Manual overrides from Firebase
let manualHolidays = {};

function pad(n) { return String(n).padStart(2,'0'); }
function fmtD(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function getWeekNum(d) {
  const j = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const w = new Date(Date.UTC(j.getUTCFullYear(), 0, 1));
  return Math.ceil(((j - w) / 86400000 + w.getUTCDay() + 1) / 7);
}

// ── FETCH HOLIDAYS FROM GOOGLE VIA WORKER ──
export async function fetchHolidays(year) {
  if (holidayCache[year]) return holidayCache[year];
  try {
    const res = await fetch(`${WORKER_URL}/holidays?year=${year}`);
    const data = await res.json();
    if (data.holidays && Object.keys(data.holidays).length > 0) {
      holidayCache[year] = data.holidays;
      // Store in Firebase for offline access
      await set(ref(db, `holidays/${year}/google`), data.holidays);
      return data.holidays;
    }
  } catch (e) {
    console.warn('Google Calendar fetch failed, using Firebase cache:', e);
  }
  // Fallback: try Firebase cache
  try {
    const snap = await get(ref(db, `holidays/${year}/google`));
    if (snap.exists()) {
      holidayCache[year] = snap.val();
      return holidayCache[year];
    }
  } catch (e) { console.warn('Firebase holiday cache failed:', e); }
  return {};
}

// ── LISTEN TO MANUAL HOLIDAY OVERRIDES ──
export function listenManualHolidays() {
  onValue(ref(db, 'holidays_manual'), snap => {
    manualHolidays = snap.val() || {};
    renderCalendar(window._currentEvents || {});
  });
}

// ── MERGE HOLIDAYS: Google base + manual overrides ──
function getMergedHolidays(year) {
  const google = holidayCache[year] || {};
  const manual = manualHolidays[year] || {};
  return { ...google, ...manual };
}

// ── CHANGE MONTH ──
export function changeMonth(delta) {
  calMonth += delta;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  if (calMonth < 0) { calMonth = 11; calYear--; }
}

// ── RENDER CALENDAR ──
export async function renderCalendar(events) {
  window._currentEvents = events;

  // Fetch holidays if not cached
  if (!holidayCache[calYear]) {
    await fetchHolidays(calYear);
  }

  const holidays = getMergedHolidays(calYear);
  const todayStr = today();
  const mBtn = document.getElementById('mBtn');
  if (mBtn) mBtn.textContent = `${calYear} ${MONTHS_TW[calMonth]}`;

  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const totalDays = new Date(calYear, calMonth + 1, 0).getDate();
  const prevTotal = new Date(calYear, calMonth, 0).getDate();

  // Build weeks
  const weeks = [];
  let week = [];
  for (let i = 0; i < firstDay; i++) {
    week.push({ d: prevTotal - firstDay + i + 1, type: 'prev' });
  }
  for (let d = 1; d <= totalDays; d++) {
    week.push({ d, type: 'cur' });
    if (week.length === 7) { weeks.push(week); week = []; }
  }
  if (week.length > 0) {
    let nd = 1;
    while (week.length < 7) { week.push({ d: nd++, type: 'next' }); }
    weeks.push(week);
  }

  const dotC = { y: '#d4a820', r: '#e05252', g: '#27ae60', b: '#60a5fa' };

  let html = `<thead><tr>
    <th class="wk">週</th>
    <th class="sun">日</th><th>一</th><th>二</th><th>三</th><th>四</th><th>五</th>
    <th class="sat">六</th>
  </tr></thead><tbody>`;

  weeks.forEach(wk => {
    const firstCur = wk.find(c => c.type === 'cur');
    const wkDate = firstCur ? new Date(calYear, calMonth, firstCur.d) : new Date(calYear, calMonth, 1);
    html += `<tr><td class="wkcell">${getWeekNum(wkDate)}</td>`;

    wk.forEach((cell, idx) => {
      const isOther = cell.type !== 'cur';
      const dow = idx;
      const isWeekend = dow === 0 || dow === 6;
      const ds = isOther ? '' : `${calYear}-${pad(calMonth + 1)}-${pad(cell.d)}`;
      const holiday = isOther ? null : holidays[ds];
      const evs = isOther ? [] : (events[ds] || []);
      const isToday = !isOther && ds === todayStr;

      let cls = 'day';
      if (isOther) cls += ' other';
      if (isWeekend && !isOther) cls += ' wkend';
      if (holiday) cls += ' hday';
      if (isToday) cls += ' today';

      let inner = `<div class="dn">${cell.d}</div>`;
      if (holiday) inner += `<span class="hname">${holiday}</span>`;
      evs.slice(0, 2).forEach(e => { inner += `<span class="ep ${e.c || 'y'}">${e.title || e.t}</span>`; });
      if (evs.length > 2) inner += `<span class="more">+${evs.length - 2} 更多</span>`;

      if (!isOther && (evs.length > 0 || holiday)) {
        let rows = '';
        if (holiday) rows += `<div class="tip-row"><div class="tip-dot" style="background:#c0392b"></div>${holiday}</div>`;
        evs.forEach(e => {
          const c = e.color || '#d4a820';
          rows += `<div class="tip-row"><div class="tip-dot" style="background:${c}"></div>${e.title || e.t}<span class="tip-time">${e.time || ''}</span></div>`;
        });
        inner += `<div class="tip"><div class="tip-hd">${calYear}/${pad(calMonth+1)}/${pad(cell.d)}</div>${rows}</div>`;
      }

      html += `<td class="${cls}">${inner}</td>`;
    });
    html += `</tr>`;
  });

  html += `</tbody>`;
  const calTable = document.getElementById('calTable');
  if (calTable) calTable.innerHTML = html;

  renderEventList(events);
}

function renderEventList(events) {
  const sorted = Object.entries(events).sort((a, b) => a[0].localeCompare(b[0]));
  const colorMap = { '#e8c14a': 'y', '#c0392b': 'r', '#27ae60': 'g', '#3b82f6': 'b' };
  document.getElementById('eventList').innerHTML = sorted.length === 0
    ? '<div class="empty-state"><div class="icon">📅</div>尚無排程</div>'
    : sorted.map(([, evArr]) => evArr.map ? evArr : [evArr]).flat()
        .filter(Boolean)
        .sort((a,b) => (a.date||'').localeCompare(b.date||''))
        .map(e => `
          <div class="cal-event-item">
            <div class="cal-event-dot" style="background:${e.color || '#e8c14a'}"></div>
            <div style="flex:1">
              <div style="font-size:13px;font-weight:500">${e.title}</div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${e.date || ''} ${e.time || ''}${e.note ? ' · ' + e.note : ''}</div>
            </div>
            <button onclick="window.deleteEvent('${e.id}')" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:18px">×</button>
          </div>`).join('');
}

// ── PICKER ──
let pickerYr = calYear;
let pickerOpen = false;

export function togglePicker() {
  pickerYr = calYear;
  pickerOpen = !pickerOpen;
  document.getElementById('picker').style.display = pickerOpen ? 'block' : 'none';
  if (pickerOpen) renderPicker();
}

export function closePicker() {
  pickerOpen = false;
  document.getElementById('picker').style.display = 'none';
}

function renderPicker() {
  document.getElementById('pYr').textContent = pickerYr;
  document.getElementById('pMonths').innerHTML = MONTHS_TW.map((m, i) => {
    const isActive = i === calMonth && pickerYr === calYear;
    return `<div onclick="window.selectMonth(${i})" style="background:${isActive ? 'rgba(232,193,74,.15)' : 'var(--surface2)'};border:1px solid ${isActive ? 'var(--accent)' : 'var(--border)'};color:${isActive ? 'var(--accent)' : 'var(--text-muted)'};border-radius:6px;padding:7px 4px;text-align:center;cursor:pointer;font-size:12px;font-weight:${isActive ? '600' : '400'};transition:all .15s">${m}</div>`;
  }).join('');
}

export function changePickerYear(delta) {
  pickerYr += delta;
  renderPicker();
}

export function selectMonth(m) {
  calYear = pickerYr;
  calMonth = m;
  closePicker();
  renderCalendar(window._currentEvents || {});
}

export function goToday() {
  const now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth();
  renderCalendar(window._currentEvents || {});
}

// ── EVENTS CRUD ──
export function openEventModal() {
  document.getElementById('e-date').value = today();
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
    time: document.getElementById('e-time').value || '00:00',
    color: document.getElementById('e-type').value,
    note: document.getElementById('e-note').value.trim(),
  });
  document.getElementById('eventModal').classList.remove('open');
  document.getElementById('e-title').value = '';
  document.getElementById('e-note').value = '';
}

export async function deleteEvent(id) {
  // Find and remove event by id across all dates
  const snap = await get(ref(db, 'events'));
  const allEvents = snap.val() || {};
  for (const [date, evts] of Object.entries(allEvents)) {
    if (typeof evts === 'object') {
      for (const [key, ev] of Object.entries(evts)) {
        if (key === id || ev.id === id) {
          await remove(ref(db, `events/${date}/${key}`));
          return;
        }
      }
    }
  }
}

// ── MANUAL HOLIDAY MANAGEMENT (admin) ──
export async function saveManualHoliday(year, date, name) {
  await set(ref(db, `holidays_manual/${year}/${date}`), name);
}

export async function deleteManualHoliday(year, date) {
  await remove(ref(db, `holidays_manual/${year}/${date}`));
}

export async function refreshHolidays(year) {
  delete holidayCache[year];
  await fetchHolidays(year);
  renderCalendar(window._currentEvents || {});
}
