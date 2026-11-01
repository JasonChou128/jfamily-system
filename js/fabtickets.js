// J Family v2.5 — FMX Issue Ticket（Fabmatics Redmine）
// 資料由 24 小時 PC 每天同步 4 次寫入 fabTickets：{ meta:{at,syncedAt,n,open}, items:{id:{...}} }
// 欄位：site 案場（J Family 名稱）、au 開單人、ps 曾留言者、s 標題、st 狀態、c 已結案、a 負責人、pr 優先、due 到期、u 更新、cr 建立、co 結案、
//       l 最新留言 {by,at,t}、ball 'gbg' 等 GBG 回覆／'fab' 等原廠回覆
// 本頁只讀；要回覆或修改請點連結到 Redmine 用自己的帳號登入操作
import { db } from './config.js';
import { ref, onValue } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

export const REDMINE = 'https://redmine.fabmatics.com/issues/';
const STALE_H = 12;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const todayStr = () => { const n = new Date(); return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`; };
const dayDiff = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
export const fmtTime = iso => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const overdueDays = it => (!it.c && it.due && it.due < todayStr()) ? dayDiff(it.due, todayStr()) : 0;
export const linkOf = it => REDMINE + (Number(it.id) || '');
export const staleHours = meta => meta && meta.at ? Math.floor((Date.now() - new Date(meta.at)) / 3600000) : null;

let fab = { meta: {}, items: {} }, listeners = [];
export const fabData = () => fab;
export function onFab(fn) { listeners.push(fn); fn(fab); }
export function startFab() {
  onValue(ref(db, 'fabTickets'), s => { const v = s.val() || {}; fab = { meta: v.meta || {}, items: v.items || {} }; listeners.forEach(f => f(fab)); renderFabPanel(); },
    () => { const el = document.getElementById('fabHead'); if (el) el.innerHTML = '<div class="dr-hint">無法讀取FMX Issue Ticket（需更新資料庫安全規則）</div>'; });
}

// 依案場統計（總覽、週報共用邏輯）
export function fabSiteStats(items) {
  const by = {};
  Object.values(items || {}).forEach(it => {
    const k = it.site || it.p || '其他', o = by[k] = by[k] || { site: k, open: 0, gbg: 0, fab: 0, over: 0 };
    if (it.c) return;
    o.open++; if (it.ball === 'gbg') o.gbg++; else o.fab++; if (overdueDays(it)) o.over++;
  });
  return Object.values(by).filter(o => o.open).sort((a, b) => b.open - a.open);
}

// v2.6「與我相關」：負責人、開單人或曾留言者是自己（J Family 姓名第一個字 = Redmine「姓, 名」的名）
const givenOf = n => (String(n || '').split(',')[1] || '').replace(/\(gbg\)/i, '').trim().split(/\s+/)[0].toLowerCase();
export function isMine(it, me) {
  const first = String((me && me.name) || '').trim().split(/\s+/)[0].toLowerCase();
  if (!first) return false;
  return [it.a, it.au, ...(Array.isArray(it.ps) ? it.ps : Object.values(it.ps || {}))].some(n => givenOf(n) === first);
}

export function ballDot(it) {
  return it.c ? '<span class="fb-dot done" title="已結案"></span>'
    : it.ball === 'gbg' ? '<span class="fb-dot gbg" title="等 GBG 回覆"></span>' : '<span class="fb-dot wait-fab" title="等原廠回覆"></span>';
}

const F = { site: '', st: '', a: '', gbg: false, closed: false };
function sortItems(list) {
  const w = it => it.c ? 0 : overdueDays(it) ? 3 : it.ball === 'gbg' ? 2 : 1;
  return list.sort((a, b) => w(b) - w(a) || (b.c ? (b.co || '').localeCompare(a.co || '') : 0) || overdueDays(b) - overdueDays(a) || (a.due || '9999').localeCompare(b.due || '9999') || (b.u || '').localeCompare(a.u || ''));
}
function card(it) {
  const od = overdueDays(it), pr = String(it.pr || '').toLowerCase();
  return `<div class="fb-card ${it.c ? 'closed' : ''}">
    <div class="fb-top">${ballDot(it)}<a class="fb-id" href="${linkOf(it)}" target="_blank" rel="noopener noreferrer">#${esc(it.id)}</a><span class="fb-site">${esc(it.site || it.p)}</span>
      <span class="fb-st">${esc(it.st)}</span>${pr === 'very high' || pr === 'high' || pr === 'urgent' || pr === 'immediate' ? `<span class="fb-pr">${esc(it.pr)}</span>` : ''}</div>
    <a class="fb-title" href="${linkOf(it)}" target="_blank" rel="noopener noreferrer">${esc(String(it.s || '').trim())}</a>
    <div class="fb-meta"><span>負責：${esc(it.a || '未指派')}</span><span>到期：${esc(it.due ? it.due.slice(5).replace('-', '/') : '未定')}${od ? ` <span class="fb-over">逾期 ${od} 天</span>` : ''}</span>${it.c ? `<span>結案：${esc(fmtTime(it.co))}</span>` : ''}</div>
    ${it.l ? `<div class="fb-last"><div class="fb-last-h"><b>${esc(it.l.by)}</b><span>${esc(fmtTime(it.l.at))}</span></div><div>${esc(it.l.t)}</div></div>` : ''}
  </div>`;
}

export function renderFabPanel() {
  const head = document.getElementById('fabHead'), out = document.getElementById('fabList'); if (!head || !out) return;
  const all = Object.values(fab.items || {}), open = all.filter(x => !x.c);
  const gbg = open.filter(x => x.ball === 'gbg').length, over = open.filter(overdueDays).length, sh = staleHours(fab.meta);
  head.innerHTML = `<div class="dr-stats fb-stats"><div><b>${open.length}</b><span>開啟中</span></div><div class="${gbg ? 'gbg' : ''}"><b>${gbg}</b><span>🔵 等 GBG 回覆</span></div><div><b>${open.length - gbg}</b><span>🔴 等原廠回覆</span></div><div class="${over ? 'warn' : ''}"><b>${over}</b><span>已逾期</span></div></div>
    <div class="fb-sync ${sh === null || sh >= STALE_H ? 'stale' : ''}">${sh === null ? '尚未同步' : `上次同步：${esc(fmtTime(fab.meta.at))}${sh >= STALE_H ? `（已超過 ${sh} 小時，請確認 24 小時 PC 的 Chrome 仍登入 Redmine）` : ''}`}</div>`;
  const opts = (id, vals, label) => { const el = document.getElementById(id); if (!el) return; const cur = el.value; el.innerHTML = `<option value="">${label}</option>` + vals.map(v => `<option>${esc(v)}</option>`).join(''); el.value = vals.includes(cur) ? cur : ''; };
  const uniq = f => [...new Set(all.map(f).filter(Boolean))].sort();
  opts('fabFSite', uniq(x => x.site || x.p), '全部案場'); opts('fabFSt', uniq(x => x.st), '全部狀態'); opts('fabFA', uniq(x => x.a), '全部負責人');
  const list = sortItems(all.filter(x => (F.closed || !x.c) && (!F.site || (x.site || x.p) === F.site) && (!F.st || x.st === F.st) && (!F.a || x.a === F.a) && (!F.gbg || (!x.c && x.ball === 'gbg'))));
  out.innerHTML = list.length ? list.map(card).join('') : `<div class="empty-state"><div class="icon">🎫</div>${all.length ? '沒有符合條件的工單' : '尚無FMX Issue Ticket資料'}</div>`;
}

export function bindFabPanel() {
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onchange = () => { fn(el); renderFabPanel(); }; };
  on('fabFSite', el => { F.site = el.value; }); on('fabFSt', el => { F.st = el.value; }); on('fabFA', el => { F.a = el.value; });
  on('fabFGbg', el => { F.gbg = el.checked; }); on('fabFClosed', el => { F.closed = el.checked; });
}
