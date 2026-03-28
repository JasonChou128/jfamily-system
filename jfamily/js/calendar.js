import { db, today, TW_HOLIDAYS } from './config.js';
import { ref, set, push, remove } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

export let calYear = new Date().getFullYear();
export let calMonth = new Date().getMonth();

export function changeMonth(delta) {
  calMonth += delta;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  if (calMonth < 0) { calMonth = 11; calYear--; }
}

export function renderCalendar(events) {
  const months = ['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];
  document.getElementById('calTitle').textContent = `${calYear} ${months[calMonth]}`;

  const first = new Date(calYear, calMonth, 1).getDay();
  const days = new Date(calYear, calMonth + 1, 0).getDate();
  const prevDays = new Date(calYear, calMonth, 0).getDate();
  const todayStr = today();
  const eventDates = new Set(Object.values(events).map(e => e.date));

  let html = ['日','一','二','三','四','五','六'].map(d => `<div class="cal-dow">${d}</div>`).join('');
  for (let i = 0; i < first; i++)
    html += `<div class="cal-day other-month"><span class="cal-day-num">${prevDays - first + i + 1}</span></div>`;

  for (let d = 1; d <= days; d++) {
    const ds = `${calYear}-${String(calMonth + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dow = new Date(calYear, calMonth, d).getDay();
    const holiday = TW_HOLIDAYS[ds];
    const isWeekend = dow === 0 || dow === 6;
    html += `<div class="cal-day ${ds === todayStr ? 'today' : ''} ${(isWeekend || holiday) ? 'holiday' : ''} ${holiday ? 'national-holiday' : ''} ${eventDates.has(ds) ? 'has-event' : ''}">
      <span class="cal-day-num">${d}</span>
      ${holiday ? `<span class="cal-day-label">${holiday}</span>` : ''}
    </div>`;
  }
  document.getElementById('calGrid').innerHTML = html;

  const sorted = Object.entries(events).sort((a, b) => a[1].date.localeCompare(b[1].date));
  document.getElementById('eventList').innerHTML = sorted.length === 0
    ? '<div class="empty-state"><div class="icon">📅</div>尚無排程</div>'
    : sorted.map(([id, e]) => `
      <div class="cal-event-item">
        <div class="cal-event-dot" style="background:${e.color}"></div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:500">${e.title}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${e.date} ${e.time}${e.note ? ' · ' + e.note : ''}</div>
        </div>
        <button onclick="window.deleteEvent('${id}')" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:18px">×</button>
      </div>`).join('');
}

export function openEventModal() {
  document.getElementById('e-date').value = today();
  document.getElementById('eventModal').classList.add('open');
}

export async function saveEvent() {
  const title = document.getElementById('e-title').value.trim();
  if (!title) return;
  await set(push(ref(db, 'events')), {
    title,
    date: document.getElementById('e-date').value,
    time: document.getElementById('e-time').value || '00:00',
    color: document.getElementById('e-type').value,
    note: document.getElementById('e-note').value.trim(),
  });
  document.getElementById('eventModal').classList.remove('open');
  document.getElementById('e-title').value = '';
  document.getElementById('e-note').value = '';
}

export async function deleteEvent(id) {
  await remove(ref(db, `events/${id}`));
}
