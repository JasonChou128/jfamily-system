import { db, today, nowTime } from './config.js';
import { ref, set } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

export function renderAttPunch(currentUser, attendance) {
  if (!currentUser) return;
  const rec = attendance[currentUser.uid]?.[today()];
  const btn = document.getElementById('punchBtn');
  const st = document.getElementById('punchStatus');
  if (!rec?.in) {
    btn.className = 'punch-btn in'; btn.textContent = '上班打卡'; st.textContent = '尚未打卡';
  } else if (!rec.out) {
    btn.className = 'punch-btn out'; btn.textContent = '下班打卡'; st.textContent = `上班時間：${rec.in}`;
  } else {
    btn.className = 'punch-btn done'; btn.textContent = '今日已完成'; st.textContent = `上班 ${rec.in} ／ 下班 ${rec.out}`;
  }
}

export function renderAttLog(currentUser, attendance) {
  if (!currentUser) return;
  const rows = Object.entries(attendance[currentUser.uid] || {}).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 20);
  document.getElementById('attendanceLog').innerHTML = rows.length === 0
    ? '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px">暫無紀錄</td></tr>'
    : rows.map(([date, rec]) => {
        let hours = '-';
        if (rec.in && rec.out) {
          const [h1, m1] = rec.in.split(':').map(Number);
          const [h2, m2] = rec.out.split(':').map(Number);
          hours = ((h2 * 60 + m2 - h1 * 60 - m1) / 60).toFixed(1) + 'h';
        }
        return `<tr>
          <td>${date}</td>
          <td style="font-family:monospace">${rec.in || '--:--'}</td>
          <td style="font-family:monospace">${rec.out || '--:--'}</td>
          <td>${hours}</td>
          <td><span class="badge ${rec.in ? 'present' : 'absent'}">${rec.in ? (rec.out ? '正常' : '上班中') : '缺勤'}</span></td>
        </tr>`;
      }).join('');
}

export async function doPunch(currentUser, attendance) {
  const uid = currentUser.uid;
  const td = today();
  const rec = (attendance[uid]?.[td]) || { in: null, out: null };
  if (!rec.in) rec.in = nowTime();
  else if (!rec.out) rec.out = nowTime();
  else return;
  await set(ref(db, `attendance/${uid}/${td}`), rec);
}
