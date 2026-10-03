// J Family v1.6 第二階段 — 工作日報、主檔、油資報表
// 資料節點：master/{customers,sites,products}、reports/{YYYY-MM}/{id}、settings、exportLog
import { db, today } from './config.js';
import { ref, set, push, update, remove, onValue, get } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const DEFAULTS = {
  rate: 8,
  offices: {
    tf: { name: '頭份辦公室', xls: 'GBG頭份', addr: '351苗栗縣頭份市建國里大同路162號' },
    tn: { name: '南部辦公室', xls: 'GBG南部辦公室', addr: '741臺南市善化區蓮潭里陽光南一路1巷66號' },
  },
};
const EXCELJS_URL = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';

let me = null, users = {}, master = { customers: {}, sites: {}, products: {} }, settings = DEFAULTS;
let monthData = {}, unsubMonth = {};        // reports by month: { '2026-10': {id: report} }
let exportLog = {};
let editing = null;                          // { month, id }
let route = null, items = [''], exps = [];
let contactAuto = true;

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ym = d => d.slice(0, 7);
const isAdmin = () => me && me.role === 'admin';
const rate = () => Number(settings.rate) || DEFAULTS.rate;
const offices = () => ({ ...DEFAULTS.offices, ...(settings.offices || {}) });
const userOffice = uid => (users[uid] && users[uid].office) || (me && uid === me.uid && me.office) || 'tf';
const userName = uid => (users[uid] && users[uid].name) || '（未知成員）';
const userCname = uid => (users[uid] && (users[uid].cname || users[uid].name)) || '';
const nm = (coll, id) => (master[coll] && master[coll][id] && master[coll][id].name) || '（已刪除）';
const norm = s => String(s).toLowerCase().replace(/[\s\-_]/g, '');
const round1 = n => Math.round(n * 10) / 10;

function toast(m) {
  let t = $('drToast');
  if (!t) { t = document.createElement('div'); t.id = 'drToast'; t.className = 'dr-toast'; document.body.appendChild(t); }
  t.textContent = m; t.classList.add('on');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), 2000);
}

// ═════════════ 初始化 ═════════════
export function initDailyReport(currentUser) {
  me = currentUser;
  buildPanels();
  onValue(ref(db, 'master'), s => {
    const v = s.val() || {};
    master = { customers: v.customers || {}, sites: v.sites || {}, products: v.products || {} };
    refreshSelects(); renderMaster(); renderList(); renderFuel();
  });
  onValue(ref(db, 'settings'), s => { settings = { ...DEFAULTS, ...(s.val() || {}) }; if (route) renderRoute(); renderFuel(); });
  onValue(ref(db, 'exportLog'), s => { exportLog = s.val() || {}; renderFuel(); });
  watchMonth(ym(today()));
  resetForm();
}

export function setUsers(u) {
  users = u || {};
  if (me && users[me.uid]) me = { ...me, ...users[me.uid] };
  if (route && !editing && !route.stops.length && route.origin.type === 'office') { route.origin = { type: 'office', office: userOffice(me.uid) }; if ($('drDrive') && $('drDrive').checked) renderRoute(); }
  fillUserFilters(); renderMembers(); renderList(); renderFuel();
}

export function newReport() { resetForm(); $('drForm').scrollIntoView({ behavior: 'smooth', block: 'start' }); }

function watchMonth(m) {
  if (!m || unsubMonth[m]) return;
  unsubMonth[m] = onValue(ref(db, `reports/${m}`), s => {
    monthData[m] = s.val() || {};
    if (route) renderRoute();
    renderList(); renderFuel();
  });
}

// ═════════════ 畫面骨架 ═════════════
function buildPanels() {
  $('panel-report').innerHTML = `
  <div class="card" id="drForm">
    <div class="card-title"><span id="drFormTitle">📝 填寫工作日報</span></div>
    <div class="dr-grid">
      <div class="form-group"><label>日期 *</label><input type="date" id="drDate"></div>
      <div class="form-group"><label>人員</label><input id="drUser" disabled></div>
    </div>
    <div class="dr-sec">案件</div>
    <div class="dr-grid">
      <div class="form-group"><label>客戶 *</label><div class="dr-with-add"><select id="drCust"></select><button type="button" class="btn btn-ghost btn-sm" data-add="cust">新增</button></div></div>
      <div class="form-group"><label>案場 *</label><div class="dr-with-add"><select id="drSite"></select><button type="button" class="btn btn-ghost btn-sm" data-add="site">新增</button></div></div>
      <div class="form-group"><label>產品 *</label><div class="dr-with-add"><select id="drProd"></select><button type="button" class="btn btn-ghost btn-sm" data-add="prod">新增</button></div></div>
      <div class="form-group"><label>拜訪人員</label><input id="drContact" placeholder="客戶端聯絡人"></div>
    </div>
    <div class="dr-adder" id="drAdd-cust"><div class="form-group"><label>新客戶名稱</label><input id="drNew-cust"></div>
      <button type="button" class="btn btn-primary btn-sm" data-save="cust">加入客戶</button> <button type="button" class="btn btn-ghost btn-sm" data-cancel="cust">取消</button></div>
    <div class="dr-adder" id="drAdd-site"><div class="dr-grid"><div class="form-group"><label>新案場名稱</label><input id="drNew-site"></div>
      <div class="form-group"><label>地址（選填）</label><input id="drNew-siteAddr" placeholder="之後自動算距離用"></div></div>
      <button type="button" class="btn btn-primary btn-sm" data-save="site">加入案場</button> <button type="button" class="btn btn-ghost btn-sm" data-cancel="site">取消</button></div>
    <div class="dr-adder" id="drAdd-prod"><div class="form-group"><label>新產品名稱</label><input id="drNew-prod"></div>
      <button type="button" class="btn btn-primary btn-sm" data-save="prod">加入產品</button> <button type="button" class="btn btn-ghost btn-sm" data-cancel="prod">取消</button></div>

    <div class="dr-sec">工時</div>
    <div class="dr-grid">
      <div class="form-group"><label>開始 *</label><input type="time" id="drStart"></div>
      <div class="form-group"><label>結束 *</label><input type="time" id="drEnd"></div>
      <div class="form-group"><label>交通時間（小時）</label><input type="number" id="drTravel" min="0" step="0.5"></div>
    </div>
    <label class="dr-check"><input type="checkbox" id="drOvernight"> 結束於隔日</label>
    <div class="dr-hint" id="drHours"></div>

    <div class="dr-sec">油資</div>
    <label class="dr-check"><input type="checkbox" id="drDrive"> 自行開車（勾選後填寫路線，計算油資）</label>
    <div id="drRouteBox" hidden>
      <div class="dr-route" id="drRoute"></div>
      <div class="dr-adds">
        <button type="button" class="btn btn-ghost btn-sm" id="drAddSite">加入本案場</button>
        <button type="button" class="btn btn-ghost btn-sm" data-office="tf">加入頭份辦公室</button>
        <button type="button" class="btn btn-ghost btn-sm" data-office="tn">加入南部辦公室</button>
        <button type="button" class="btn btn-ghost btn-sm" id="drAddCustom">加入其他地點</button>
      </div>
      <div class="dr-total"><span>總里程 <b id="drKm">0</b> 公里 × <span id="drRate">8</span> 元</span><span class="dr-big">NT$ <span id="drFuel">0</span></span></div>
    </div>

    <div class="dr-sec">處理事項 *</div>
    <ol class="dr-items" id="drItems"></ol>
    <button type="button" class="btn btn-ghost btn-sm" id="drAddItem">新增一條</button>

    <div class="dr-sec">支出</div>
    <div id="drExps"></div>
    <button type="button" class="btn btn-ghost btn-sm" id="drAddExp">新增一筆支出</button>
    <div class="dr-hint">停車費、過路費等請在說明欄註明。油資由系統計算，不用填在這裡。</div>

    <div class="dr-err" id="drErr" role="alert"></div>
    <div class="modal-actions" style="justify-content:flex-start">
      <button type="button" class="btn btn-primary" id="drSubmit">送出日報</button>
      <button type="button" class="btn btn-ghost" id="drReset">清空重填</button>
    </div>
  </div>
  <div class="card">
    <div class="card-title"><span>📋 日報紀錄</span></div>
    <div class="dr-grid">
      <div class="form-group"><label>月份</label><input type="month" id="drListMonth"></div>
      <div class="form-group"><label>人員</label><select id="drListUser"></select></div>
    </div>
    <div id="drList"></div>
  </div>
  <div class="modal-overlay" id="drLineModal"><div class="modal">
    <div class="modal-title">日報已儲存</div>
    <p class="dr-hint" style="margin-bottom:10px">以下文字與群組格式相同，可直接複製貼到 LINE。</p>
    <pre class="dr-line" id="drLineText"></pre>
    <div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal('drLineModal')">關閉</button><button class="btn btn-primary" id="drCopy">複製文字</button></div>
  </div></div>`;

  $('panel-fuel').innerHTML = `
  <div class="card">
    <div class="card-title"><span>⛽ 油資報表</span><button class="btn btn-primary btn-sm" id="drXlsx">匯出 Excel</button></div>
    <div class="dr-grid">
      <div class="form-group"><label>月份</label><input type="month" id="drFuelMonth"></div>
      <div class="form-group"><label>人員</label><select id="drFuelUser"></select></div>
    </div>
    <div id="drFuelWarn"></div>
    <div id="drFuelOut"></div>
  </div>`;

  const adminHost = $('drAdminHost');
  if (adminHost) adminHost.innerHTML = `
  <div class="card">
    <div class="card-title"><span>🏢 客戶／案場／產品</span></div>
    <p class="dr-hint" style="margin-bottom:12px">所有人都可以在日報中新增；只有管理員可以停用。停用後下拉選單不再出現，但舊日報保留原名稱。</p>
    <div class="dr-master"><div><h4>客戶</h4><ul id="drMCust"></ul></div><div><h4>案場</h4><ul id="drMSite"></ul></div><div><h4>產品</h4><ul id="drMProd"></ul></div></div>
  </div>
  <div class="card">
    <div class="card-title"><span>👤 日報成員設定</span></div>
    <p class="dr-hint" style="margin-bottom:12px">中文姓名印在油資報表的申請人欄；所屬辦公室是路線起點的預設值。</p>
    <table class="data-table"><thead><tr><th>成員</th><th>中文姓名</th><th>所屬辦公室</th><th></th></tr></thead><tbody id="drMembers"></tbody></table>
  </div>`;

  bindForm();
  const m = ym(today());
  $('drListMonth').value = m; $('drFuelMonth').value = m;
  $('drListMonth').onchange = () => { watchMonth($('drListMonth').value); renderList(); };
  $('drListUser').onchange = renderList;
  $('drFuelMonth').onchange = () => { watchMonth($('drFuelMonth').value); renderFuel(); };
  $('drFuelUser').onchange = renderFuel;
  $('drXlsx').onclick = exportXlsx;
  fillUserFilters();
}

function fillUserFilters() {
  ['drListUser', 'drFuelUser'].forEach(id => {
    const sel = $(id); if (!sel || !me) return;
    const cur = sel.value;
    const list = isAdmin() ? Object.keys(users) : [me.uid];
    const all = id === 'drListUser' && isAdmin() ? '<option value="">全部人員</option>' : '';
    sel.innerHTML = all + list.filter(uid => users[uid] || uid === me.uid)
      .map(uid => `<option value="${uid}">${esc(uid === me.uid ? me.name : userName(uid))}</option>`).join('');
    if (cur !== undefined && [...sel.options].some(o => o.value === cur)) sel.value = cur;
    else sel.value = id === 'drListUser' && isAdmin() ? '' : me.uid;
  });
}

// ═════════════ 表單 ═════════════
function activeList(coll, filter, keepId) {
  return Object.entries(master[coll] || {})
    .filter(([id, x]) => (x.active !== false || id === keepId) && (!filter || filter(x)))
    .map(([id, x]) => ({ id, ...x }));
}
function fill(sel, list, val, ph) {
  sel.innerHTML = `<option value="">${ph}</option>` + list.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
  if (val && list.some(x => x.id === val)) sel.value = val;
}
function refreshSelects(keep = {}) {
  if (!$('drCust')) return;
  const cust = keep.cust ?? $('drCust').value, site = keep.site ?? $('drSite').value, prod = keep.prod ?? $('drProd').value;
  fill($('drCust'), activeList('customers', null, cust).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant')), cust, '請選擇客戶');
  const cid = $('drCust').value;
  fill($('drSite'), activeList('sites', s => s.cust === cid, site), site, cid ? '請選擇案場' : '請先選客戶');
  fill($('drProd'), activeList('products', null, prod).sort((a, b) => (b.uses || 0) - (a.uses || 0)), prod, '請選擇產品');
}

function bindForm() {
  $('drCust').onchange = () => { refreshSelects({ site: '' }); syncSiteStops(); autoContact(); };
  $('drSite').onchange = () => { syncSiteStops(); autoContact(); };
  $('drContact').oninput = function () { contactAuto = !this.value; };
  document.querySelectorAll('#panel-report [data-add]').forEach(b => b.onclick = () => {
    const k = b.dataset.add;
    if (k === 'site' && !$('drCust').value) { toast('請先選客戶'); return; }
    ['cust', 'site', 'prod'].forEach(x => $('drAdd-' + x).classList.toggle('on', x === k && !$('drAdd-' + x).classList.contains('on')));
    $('drNew-' + k).focus();
  });
  document.querySelectorAll('#panel-report [data-cancel]').forEach(b => b.onclick = () => $('drAdd-' + b.dataset.cancel).classList.remove('on'));
  document.querySelectorAll('#panel-report [data-save]').forEach(b => b.onclick = () => saveMaster(b.dataset.save));
  ['drStart', 'drEnd', 'drOvernight'].forEach(id => { $(id).addEventListener('input', showHours); $(id).addEventListener('change', showHours); });
  $('drDrive').onchange = function () { $('drRouteBox').hidden = !this.checked; if (this.checked) { if (!route.stops.length) syncSiteStops(); renderRoute(); } };
  $('drDate').onchange = () => { watchMonth(ym($('drDate').value)); if ($('drDrive').checked) renderRoute(); };
  $('drAddSite').onclick = () => { const sid = $('drSite').value; if (!sid) { toast('請先選案場'); return; } route.stops.push({ type: 'site', site: sid, auto: true }); route.legs.push(''); renderRoute(); };
  document.querySelectorAll('#panel-report [data-office]').forEach(b => b.onclick = () => { route.stops.push({ type: 'office', office: b.dataset.office }); route.legs.push(''); renderRoute(); });
  $('drAddCustom').onclick = () => { route.stops.push({ type: 'custom', name: '', addr: '' }); route.legs.push(''); renderRoute(); const ins = $('drRoute').querySelectorAll('[data-stop-name]'); if (ins.length) ins[ins.length - 1].focus(); };
  bindRoute();
  $('drItems').addEventListener('input', e => { if (e.target.dataset.item !== undefined) items[+e.target.dataset.item] = e.target.value; });
  $('drItems').addEventListener('click', e => { const b = e.target.closest('[data-item-del]'); if (b) { items.splice(+b.dataset.itemDel, 1); renderItems(); } });
  $('drItems').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset.item !== undefined) { e.preventDefault(); $('drAddItem').click(); } });
  $('drAddItem').onclick = () => { items.push(''); renderItems(); const l = $('drItems').querySelectorAll('input'); l[l.length - 1].focus(); };
  $('drExps').addEventListener('input', e => { const t = e.target; if (t.dataset.expAmt !== undefined) exps[+t.dataset.expAmt].amt = t.value; if (t.dataset.expNote !== undefined) exps[+t.dataset.expNote].note = t.value; });
  $('drExps').addEventListener('click', e => { const b = e.target.closest('[data-exp-del]'); if (b) { exps.splice(+b.dataset.expDel, 1); renderExps(); } });
  $('drAddExp').onclick = () => { exps.push({ amt: '', note: '' }); renderExps(); };
  $('drSubmit').onclick = submit;
  $('drReset').onclick = () => { if (confirm('確定清空目前填寫的內容？')) resetForm(); };
  $('drCopy').onclick = copyLine;
  $('drList').addEventListener('click', listClick);
}

async function saveMaster(k) {
  const name = $('drNew-' + k).value.trim();
  if (!name) { toast('請輸入名稱'); return; }
  const coll = { cust: 'customers', site: 'sites', prod: 'products' }[k];
  const cid = $('drCust').value;
  const pool = Object.values(master[coll]).filter(x => k !== 'site' || x.cust === cid);
  const n = norm(name);
  const sim = pool.filter(x => { const y = norm(x.name); return y === n || (n.length > 2 && (y.includes(n) || n.includes(y))); });
  if (sim.length && !confirm(`已有相似名稱：${sim.map(x => x.name).join('、')}\n確定仍要新增「${name}」？`)) return;
  const r = push(ref(db, `master/${coll}`));
  const rec = { name, active: true, createdBy: me.uid, createdAt: today() };
  if (k === 'site') { rec.cust = cid; rec.addr = $('drNew-siteAddr').value.trim(); }
  try {
    await set(r, rec);
    master[coll][r.key] = rec;
    refreshSelects({ [k]: r.key, ...(k === 'cust' ? { site: '' } : {}) });
    $('drNew-' + k).value = ''; if (k === 'site') $('drNew-siteAddr').value = '';
    $('drAdd-' + k).classList.remove('on');
    if (k === 'site') { syncSiteStops(); autoContact(); }
    toast(`已新增「${name}」`);
  } catch (e) { toast('新增失敗：' + (e.message || e)); }
}

function autoContact() {
  if (!contactAuto && $('drContact').value) return;
  const s = master.sites[$('drSite').value];
  $('drContact').value = (s && s.lastContact) || '';
  contactAuto = true;
}

function hours() {
  const s = $('drStart').value, e = $('drEnd').value; if (!s || !e) return null;
  const a = +s.slice(0, 2) * 60 + +s.slice(3), b = +e.slice(0, 2) * 60 + +e.slice(3) + ($('drOvernight').checked ? 1440 : 0);
  return (b - a) / 60;
}
function showHours() {
  const h = hours();
  $('drHours').textContent = h == null ? '' : h <= 0 ? '結束時間早於開始時間；若做到隔天，請勾選「結束於隔日」' : `工作時數 ${round1(h)} 小時`;
}

// ── 路線 ──
const newRoute = () => ({ origin: { type: 'office', office: userOffice(me.uid) }, stops: [], legs: [] });
function label(p, forXls) {
  if (!p) return '';
  const o = offices();
  if (p.type === 'office') { const x = o[p.office] || o.tf; return forXls ? x.xls : x.name; }
  if (p.type === 'site') return (master.sites[p.site] && master.sites[p.site].name) || '（案場）';
  return p.name || p.addr || '（未命名地點）';
}
function todaysSites() {
  const d = $('drDate').value, rs = monthData[ym(d)] || {}, out = [];
  Object.entries(rs).forEach(([id, r]) => {
    if (r.uid === me.uid && r.date === d && !(editing && editing.id === id) && !out.includes(r.site)) out.push(r.site);
  });
  return out;
}
function syncSiteStops() {
  if (!$('drDrive').checked) return;
  const sid = $('drSite').value;
  route.stops.forEach(st => { if (st.type === 'site' && st.auto) st.site = sid; });
  if (sid && !route.stops.some(st => st.type === 'site')) { route.stops.push({ type: 'site', site: sid, auto: true }); route.legs.push(''); }
  renderRoute();
}
function renderRoute() {
  if (!route || !$('drRoute')) return;
  const r = route, o = offices();
  const opts = Object.entries(o).map(([k, x]) => `<option value="office:${k}">${esc(x.name)}</option>`).join('') +
    todaysSites().map(s => `<option value="site:${s}">今日案場：${esc(label({ type: 'site', site: s }))}</option>`).join('') +
    '<option value="custom">其他地點</option>';
  const ov = r.origin.type === 'site' ? 'site:' + r.origin.site : r.origin.type === 'office' ? 'office:' + r.origin.office : 'custom';
  const addrLine = p => p.type === 'office' && o[p.office] ? `<div class="dr-hint">${esc(o[p.office].addr)}</div>` : '';
  const customIns = (p, key) => `<input data-${key}-name placeholder="地點簡稱（印在報表上），例如 GBG宜蘭利澤" value="${esc(p.name)}"><input data-${key}-addr placeholder="地址（選填）" value="${esc(p.addr)}">`;
  let h = `<div class="dr-stop dr-origin"><div class="dr-stop-h"><span>起點</span></div><select data-origin>${opts}</select>${addrLine(r.origin)}${r.origin.type === 'custom' ? customIns(r.origin, 'origin') : ''}</div>`;
  r.stops.forEach((st, i) => {
    h += `<div class="dr-leg">這段 <input type="number" min="0" step="0.1" inputmode="decimal" data-leg="${i}" value="${esc(r.legs[i])}"> 公里</div>`;
    h += `<div class="dr-stop"><div class="dr-stop-h"><span>目的地 ${i + 1}</span><span>
      <button type="button" class="btn btn-ghost btn-sm" data-up="${i}" ${i === 0 ? 'disabled' : ''}>上移</button>
      <button type="button" class="btn btn-ghost btn-sm" data-down="${i}" ${i === r.stops.length - 1 ? 'disabled' : ''}>下移</button>
      <button type="button" class="btn btn-danger btn-sm" data-del="${i}">移除</button></span></div>
      ${st.type === 'custom' ? `<input data-stop-name="${i}" placeholder="地點簡稱（印在報表上）" value="${esc(st.name)}"><input data-stop-addr="${i}" placeholder="地址（選填）" value="${esc(st.addr)}">` : `<div>${esc(label(st))}</div>${addrLine(st)}`}</div>`;
  });
  if (!r.stops.length) h += '<div class="dr-hint" style="margin-bottom:10px">尚未加入目的地，請用下方按鈕加入。</div>';
  $('drRoute').innerHTML = h;
  const sel = $('drRoute').querySelector('[data-origin]');
  if ([...sel.options].some(x => x.value === ov)) sel.value = ov; else { sel.value = 'office:' + userOffice(me.uid); route.origin = { type: 'office', office: userOffice(me.uid) }; }
  calcFuel();
}
function bindRoute() {
  const box = $('drRoute');
  box.addEventListener('change', e => {
    if (e.target.dataset.origin === undefined) return;
    const v = e.target.value;
    route.origin = v.startsWith('office:') ? { type: 'office', office: v.slice(7) } : v === 'custom' ? { type: 'custom', name: '', addr: '' } : { type: 'site', site: v.slice(5) };
    renderRoute();
  });
  box.addEventListener('input', e => {
    const d = e.target.dataset;
    if (d.leg !== undefined) { route.legs[+d.leg] = e.target.value; calcFuel(); }
    if (d.originName !== undefined) route.origin.name = e.target.value;
    if (d.originAddr !== undefined) route.origin.addr = e.target.value;
    if (d.stopName !== undefined) route.stops[+d.stopName].name = e.target.value;
    if (d.stopAddr !== undefined) route.stops[+d.stopAddr].addr = e.target.value;
  });
  box.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const s = route.stops, l = route.legs; let i;
    const sw = (a, c) => { [s[a], s[c]] = [s[c], s[a]]; l[a] = ''; l[c] = ''; };
    if (b.dataset.up !== undefined) { i = +b.dataset.up; sw(i, i - 1); if (i + 1 < l.length) l[i + 1] = ''; }
    else if (b.dataset.down !== undefined) { i = +b.dataset.down; sw(i, i + 1); if (i + 2 < l.length) l[i + 2] = ''; }
    else if (b.dataset.del !== undefined) { i = +b.dataset.del; s.splice(i, 1); l.splice(i, 1); if (i < l.length) l[i] = ''; }
    else return;
    renderRoute();
  });
}
const kmOf = r => (r && r.legs ? r.legs : []).reduce((a, b) => a + (parseFloat(b) || 0), 0);
function calcFuel() { const km = round1(kmOf(route)); $('drKm').textContent = km; $('drRate').textContent = rate(); $('drFuel').textContent = Math.round(km * rate()).toLocaleString(); }

function renderItems() {
  $('drItems').innerHTML = items.map((t, i) => `<li><input data-item="${i}" value="${esc(t)}">${items.length > 1 ? `<button type="button" class="btn btn-danger btn-sm" data-item-del="${i}">刪除</button>` : ''}</li>`).join('');
}
function renderExps() {
  $('drExps').innerHTML = exps.map((x, i) => `<div class="dr-exp"><input type="number" min="0" step="1" inputmode="numeric" placeholder="金額" data-exp-amt="${i}" value="${esc(x.amt)}"><input placeholder="說明，例如停車費" data-exp-note="${i}" value="${esc(x.note)}"><button type="button" class="btn btn-danger btn-sm" data-exp-del="${i}">刪除</button></div>`).join('');
}

function resetForm() {
  if (!me || !$('drDate')) return;
  editing = null;
  $('drDate').value = today(); $('drUser').value = me.name || me.email;
  $('drStart').value = '09:00'; $('drEnd').value = '18:00'; $('drTravel').value = '0';
  $('drOvernight').checked = false; $('drDrive').checked = false; $('drRouteBox').hidden = true;
  $('drContact').value = ''; contactAuto = true;
  route = newRoute(); items = ['']; exps = [];
  refreshSelects({ cust: '', site: '', prod: '' });
  $('drErr').textContent = ''; $('drSubmit').textContent = '送出日報'; $('drFormTitle').textContent = '📝 填寫工作日報';
  renderItems(); renderExps(); showHours();
}

function validate() {
  if (!$('drDate').value) return '請選日期';
  if (!$('drCust').value) return '請選客戶';
  if (!$('drSite').value) return '請選案場';
  if (!$('drProd').value) return '請選產品';
  const h = hours(); if (h == null) return '請填工作時間'; if (h <= 0) return '結束時間早於開始時間；若做到隔天，請勾選「結束於隔日」';
  if (!items.some(t => t.trim())) return '處理事項至少填一條';
  if ($('drDrive').checked) {
    if (route.origin.type === 'custom' && !String(route.origin.name || '').trim()) return '請填起點的地點簡稱';
    if (!route.stops.length) return '自行開車請至少加入一個目的地';
    for (let i = 0; i < route.stops.length; i++) {
      if (route.stops[i].type === 'custom' && !String(route.stops[i].name || '').trim()) return `目的地 ${i + 1} 請填地點簡稱`;
      const n = parseFloat(route.legs[i]); if (isNaN(n) || n < 0) return `第 ${i + 1} 段請填公里數`;
    }
  }
  for (let j = 0; j < exps.length; j++) { if (exps[j].amt === '' && exps[j].note === '') continue; if (isNaN(parseFloat(exps[j].amt))) return `支出第 ${j + 1} 筆請填金額`; }
  return '';
}

async function submit() {
  const m = validate(); $('drErr').textContent = m; if (m) return;
  const now = new Date().toISOString(), date = $('drDate').value, month = ym(date);
  const drive = $('drDrive').checked;
  const rec = {
    uid: editing ? editing.uid : me.uid, date,
    cust: $('drCust').value, site: $('drSite').value, prod: $('drProd').value, contact: $('drContact').value.trim(),
    start: $('drStart').value, end: $('drEnd').value, overnight: $('drOvernight').checked, travel: parseFloat($('drTravel').value) || 0,
    drive, route: drive ? JSON.parse(JSON.stringify(route)) : null,
    items: items.map(x => x.trim()).filter(Boolean),
    exps: exps.filter(x => x.amt !== '' || x.note !== '').map(x => ({ amt: parseFloat(x.amt) || 0, note: x.note.trim() })),
    updatedAt: now, updatedBy: me.uid,
  };
  if (drive) rec.route.legs = rec.route.legs.map(x => parseFloat(x) || 0);
  $('drSubmit').disabled = true;
  try {
    if (editing) {
      const old = (monthData[editing.month] || {})[editing.id] || {};
      rec.createdAt = old.createdAt || now;
      if (editing.month !== month) {
        await set(ref(db, `reports/${month}/${editing.id}`), rec);
        await remove(ref(db, `reports/${editing.month}/${editing.id}`));
      } else await set(ref(db, `reports/${month}/${editing.id}`), rec);
    } else {
      rec.createdAt = now;
      await set(push(ref(db, `reports/${month}`)), rec);
      const p = master.products[rec.prod];
      if (p) await update(ref(db, `master/products/${rec.prod}`), { uses: (p.uses || 0) + 1 });
    }
    if (rec.contact) await update(ref(db, `master/sites/${rec.site}`), { lastContact: rec.contact });
    watchMonth(month);
    $('drLineText').textContent = lineText(rec);
    $('drLineModal').classList.add('open');
    resetForm();
  } catch (e) { $('drErr').textContent = '儲存失敗：' + (e.message || e); }
  finally { $('drSubmit').disabled = false; }
}

function lineText(r) {
  const sum = (r.exps || []).reduce((a, x) => a + (parseFloat(x.amt) || 0), 0);
  const notes = (r.exps || []).filter(x => x.note).map(x => `${x.note} ${x.amt}`);
  return `日期：${r.date.replace(/-/g, '/')}\n人員：${userName(r.uid)}\n客戶：${nm('customers', r.cust)}\n案場：${nm('sites', r.site)}\n產品：${nm('products', r.prod)}\n` +
    `工作時間：${r.start}~${r.end}${r.overnight ? '（隔日）' : ''}\n交通時間：${r.travel || 0}h\n處理事項：\n` +
    (r.items || []).map((x, i) => `${i + 1}. ${x}`).join('\n') + `\n支出：${sum}${notes.length ? '（' + notes.join('、') + '）' : ''}`;
}
function copyLine() {
  const txt = $('drLineText').textContent;
  const done = () => toast('已複製');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, fb); else fb();
  function fb() { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch { toast('請手動選取文字複製'); } ta.remove(); }
}

function loadForEdit(month, id) {
  const r = (monthData[month] || {})[id]; if (!r) return;
  editing = { month, id, uid: r.uid };
  window.switchTab('report', document.querySelector('.nav-tab[data-tab="report"]'));
  $('drDate').value = r.date; $('drUser').value = userName(r.uid);
  refreshSelects({ cust: r.cust, site: r.site, prod: r.prod });
  $('drContact').value = r.contact || ''; contactAuto = !r.contact;
  $('drStart').value = r.start; $('drEnd').value = r.end; $('drOvernight').checked = !!r.overnight; $('drTravel').value = r.travel || 0;
  $('drDrive').checked = !!r.drive; $('drRouteBox').hidden = !r.drive;
  route = r.drive && r.route ? JSON.parse(JSON.stringify({ stops: [], legs: [], ...r.route })) : newRoute();
  route.legs = (route.legs || []).map(String);
  items = (r.items || []).slice(); if (!items.length) items = [''];
  exps = (r.exps || []).map(x => ({ amt: String(x.amt), note: x.note || '' }));
  renderItems(); renderExps(); showHours(); if (r.drive) renderRoute();
  $('drSubmit').textContent = '儲存修改'; $('drFormTitle').textContent = '✏️ 修改工作日報';
  $('drForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ═════════════ 日報紀錄 ═════════════
function renderList() {
  const out = $('drList'); if (!out || !me) return;
  const m = $('drListMonth').value, u = $('drListUser').value;
  if (!monthData[m]) { out.innerHTML = '<div class="empty-state"><div class="icon">⏳</div>載入中...</div>'; return; }
  const rs = Object.entries(monthData[m]).filter(([, r]) => isAdmin() ? (!u || r.uid === u) : r.uid === me.uid)
    .sort((a, b) => b[1].date.localeCompare(a[1].date) || (b[1].start || '').localeCompare(a[1].start || ''));
  if (!rs.length) { out.innerHTML = '<div class="empty-state"><div class="icon">📝</div>這個月份還沒有日報</div>'; return; }
  out.innerHTML = rs.map(([id, r]) => {
    const mine = r.uid === me.uid, km = r.drive ? round1(kmOf(r.route)) : 0;
    return `<div class="dr-card"><div class="dr-card-h"><b>${esc(r.date.replace(/-/g, '/'))}　${esc(nm('customers', r.cust))}／${esc(nm('sites', r.site))}</b><span class="dr-tag">${esc(userName(r.uid))}</span></div>
      <div class="dr-hint">${esc(nm('products', r.prod))}　${esc(r.start)}~${esc(r.end)}${r.overnight ? '（隔日）' : ''}${r.contact ? '　拜訪：' + esc(r.contact) : ''}${r.drive ? `　${km} km` : ''}</div>
      <ol class="dr-ol">${(r.items || []).map(x => `<li>${esc(x)}</li>`).join('')}</ol>
      <div class="dr-hint">最後修改：${esc(new Date(r.updatedAt).toLocaleString('zh-TW'))}（${esc(userName(r.updatedBy))}）</div>
      <div class="dr-actions">
        ${mine ? `<button class="btn btn-ghost btn-sm" data-edit="${m}|${id}">修改</button>` : ''}
        <button class="btn btn-ghost btn-sm" data-copy="${m}|${id}">複製 LINE 文字</button>
        ${mine ? `<button class="btn btn-danger btn-sm" data-rm="${m}|${id}">刪除</button>` : ''}
      </div></div>`;
  }).join('');
}
async function listClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  const [m, id] = (b.dataset.edit || b.dataset.copy || b.dataset.rm || '').split('|');
  if (b.dataset.edit) loadForEdit(m, id);
  if (b.dataset.copy) { $('drLineText').textContent = lineText(monthData[m][id]); $('drLineModal').classList.add('open'); }
  if (b.dataset.rm && confirm('確定刪除這筆日報？')) { try { await remove(ref(db, `reports/${m}/${id}`)); toast('已刪除'); } catch (er) { toast('刪除失敗：' + er.message); } }
}

// ═════════════ 油資報表 ═════════════
function dayRows(uid, m) {
  const rs = Object.values(monthData[m] || {}).filter(r => r.drive && r.uid === uid && r.route)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.start || '').localeCompare(b.start || ''));
  const by = {}, order = [];
  rs.forEach(r => { if (!by[r.date]) { by[r.date] = []; order.push(r.date); } by[r.date].push(r); });
  const uj = (a, s) => a.filter((x, i) => x && a.indexOf(x) === i).join(s);
  return order.map(d => {
    const cs = by[d]; let chain = [];
    cs.forEach(r => { const pts = [r.route.origin, ...(r.route.stops || [])].map(p => label(p, true)); if (chain.length && chain[chain.length - 1] === pts[0]) pts.shift(); chain = chain.concat(pts); });
    return {
      date: d, company: uj(cs.map(r => nm('sites', r.site)), '/'), contact: uj(cs.map(r => r.contact), '/'),
      reason: cs.map(r => (r.items || []).join('/')).join('；'), route: chain.join('--'),
      km: round1(cs.reduce((a, r) => a + kmOf(r.route), 0)), updatedAt: cs.reduce((a, r) => r.updatedAt > a ? r.updatedAt : a, ''),
    };
  });
}
function renderFuel() {
  const out = $('drFuelOut'); if (!out || !me) return;
  const m = $('drFuelMonth').value, uid = $('drFuelUser').value || me.uid;
  if (!monthData[m]) { out.innerHTML = '<div class="empty-state"><div class="icon">⏳</div>載入中...</div>'; return; }
  const rows = dayRows(uid, m), key = `${uid}_${m}`, exp = exportLog[key];
  const changed = exp ? rows.filter(r => r.updatedAt > exp).length : 0;
  $('drFuelWarn').innerHTML = changed ? `<div class="dr-warn">此報表已於 ${esc(new Date(exp).toLocaleString('zh-TW'))} 匯出過，之後有 ${changed} 天的日報被修改，已匯出的檔案數字可能不一致。</div>` : '';
  if (!rows.length) { out.innerHTML = `<div class="empty-state"><div class="icon">⛽</div>${esc(userName(uid))} 在 ${esc(m)} 沒有自行開車的日報</div>`; return; }
  const tot = round1(rows.reduce((a, r) => a + r.km, 0));
  out.innerHTML = `<div style="overflow-x:auto"><table class="data-table"><thead><tr><th>日期</th><th>拜訪公司</th><th>拜訪人員</th><th>起點/終點</th><th style="text-align:right">公里</th><th style="text-align:right">油資</th></tr></thead><tbody>` +
    rows.map(r => `<tr><td>${esc(r.date.slice(5).replace('-', '/'))}</td><td>${esc(r.company)}</td><td>${esc(r.contact)}</td><td>${esc(r.route)}</td><td style="text-align:right">${r.km}</td><td style="text-align:right">${Math.round(r.km * rate()).toLocaleString()}</td></tr>`).join('') +
    `<tr class="dr-sum"><td colspan="4">合計 ${rows.length} 天</td><td style="text-align:right">${tot}</td><td style="text-align:right">NT$ ${Math.round(tot * rate()).toLocaleString()}</td></tr></tbody></table></div>
    <div class="dr-hint" style="margin-top:8px">${exp ? '上次匯出：' + esc(new Date(exp).toLocaleString('zh-TW')) : '尚未匯出'}</div>`;
}

function loadExcelJS() {
  if (window.ExcelJS) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = EXCELJS_URL; s.onload = res; s.onerror = () => rej(new Error('Excel 元件載入失敗')); document.head.appendChild(s); });
}
async function exportXlsx() {
  const m = $('drFuelMonth').value, uid = $('drFuelUser').value || me.uid;
  const rows = dayRows(uid, m);
  if (!rows.length) { toast('這個月份沒有可匯出的資料'); return; }
  try { await loadExcelJS(); } catch (e) { toast(e.message); return; }
  const y = m.slice(0, 4), mo = +m.slice(5, 7), yyyymm = m.replace('-', ''), R = rate();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`${yyyymm}出差紀錄`, { pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } } });
  const F = '微软雅黑', thin = { style: 'thin' }, med = { style: 'medium' }, center = { horizontal: 'center', vertical: 'middle' };
  [13.375, 15.75, 14.5, 59.75, 45.625, 10.125, 8.25, 9.5, 8.25].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  for (let r = 1; r <= 4; r++) ws.getRow(r).height = 23.25;
  ws.getRow(5).height = 27;
  ws.mergeCells('A2:I4');
  Object.assign(ws.getCell('A2'), { value: `竑瑞科技 ${y}.${mo}月份出差記錄表`, font: { name: F, size: 22, bold: true }, alignment: center });
  const hr = ws.getRow(6); hr.height = 30;
  ['日期', '拜訪公司', '拜訪人員', '事由', '起點/終點', '行車公里數', '油費金額', '總額', '有無報告'].forEach((h, i) => {
    Object.assign(hr.getCell(i + 1), { value: h, font: { name: F, size: 10 }, alignment: center, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8EA9DB' } }, border: { top: med, bottom: thin, left: i === 0 ? med : thin, right: i === 8 ? med : thin } });
  });
  const n = Math.max(rows.length, 21), first = 7, last = first + n - 1;
  for (let k = 0; k < n; k++) {
    const row = ws.getRow(first + k), d = rows[k]; row.height = 30;
    const vals = d ? [new Date(Date.UTC(+d.date.slice(0, 4), +d.date.slice(5, 7) - 1, +d.date.slice(8, 10))), d.company, d.contact, d.reason, d.route, d.km, R, { formula: `F${first + k}*G${first + k}` }, 'NA'] : Array(9).fill(null);
    vals.forEach((v, i) => {
      const c = row.getCell(i + 1);
      Object.assign(c, { value: v, font: { name: F, size: 10 }, alignment: { horizontal: 'center', vertical: 'middle', wrapText: i === 3 || i === 4 }, border: { top: thin, bottom: thin, left: i === 0 ? med : thin, right: i === 8 ? med : thin } });
      if (i === 0) c.numFmt = 'm"月"d"日"';
    });
  }
  const tr = last + 1; ws.getRow(tr).height = 30;
  ws.mergeCells(`A${tr}:B${tr}`); ws.mergeCells(`C${tr}:I${tr}`);
  Object.assign(ws.getCell(`A${tr}`), { value: '總計', font: { name: F, size: 14 }, alignment: center });
  Object.assign(ws.getCell(`C${tr}`), { value: { formula: `SUM(H${first}:H${last})` }, font: { name: F, size: 14 }, alignment: center, numFmt: '"NT$"#,##0' });
  for (let ci = 1; ci <= 9; ci++) ws.getCell(tr, ci).border = { top: thin, bottom: med, left: ci === 1 ? med : thin, right: ci === 9 ? med : thin };
  const sr = tr + 1;
  [['A', '總經理：', 14, true], ['D', '部門主管：', 14, true], ['F', '申請人：', 12, false], ['G', userCname(uid), 12, false]].forEach(([c, v, sz, b]) => Object.assign(ws.getCell(c + sr), { value: v, font: { name: F, size: sz, bold: b }, alignment: { vertical: 'middle' } }));
  ['備註：', `1.每公里補助${R}元`, '2.每月31日前送到財務部'].forEach((t, i) => Object.assign(ws.getCell('A' + (sr + 1 + i)), { value: t, font: { name: F, size: 14 }, alignment: { vertical: 'middle' } }));
  for (let q = sr; q <= sr + 3; q++) ws.getRow(q).height = 26.25;
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${yyyymm}_出差油資_${userName(uid)}.xlsx`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  try { await set(ref(db, `exportLog/${uid}_${m}`), new Date().toISOString()); } catch {}
}

// ═════════════ 管理：主檔與成員 ═════════════
function renderMaster() {
  if (!$('drMCust') || !isAdmin()) return;
  const li = (coll, id, x, extra) => `<li class="${x.active === false ? 'off' : ''}"><span>${esc(x.name)}${extra ? `<span class="dr-hint">　${esc(extra)}</span>` : ''}${x.active === false ? '　<span class="dr-tag">已停用</span>' : ''}</span>
    <button class="btn btn-sm ${x.active === false ? 'btn-ghost' : 'btn-danger'}" data-toggle="${coll}|${id}">${x.active === false ? '啟用' : '停用'}</button></li>`;
  const sortN = o => Object.entries(o).sort((a, b) => a[1].name.localeCompare(b[1].name, 'zh-Hant'));
  $('drMCust').innerHTML = sortN(master.customers).map(([id, x]) => li('customers', id, x)).join('') || '<li class="dr-hint">尚無資料</li>';
  $('drMSite').innerHTML = sortN(master.sites).map(([id, x]) => li('sites', id, x, `${nm('customers', x.cust)}｜${x.addr || '未填地址'}`)).join('') || '<li class="dr-hint">尚無資料</li>';
  $('drMProd').innerHTML = sortN(master.products).map(([id, x]) => li('products', id, x)).join('') || '<li class="dr-hint">尚無資料</li>';
  if (!renderMaster.bound) {
    renderMaster.bound = true;
    $('drAdminHost').addEventListener('click', async e => {
      const b = e.target.closest('[data-toggle]'); if (!b || !isAdmin()) return;
      const [coll, id] = b.dataset.toggle.split('|'), x = master[coll][id];
      await update(ref(db, `master/${coll}/${id}`), { active: x.active === false });
    });
  }
}
function renderMembers() {
  const tb = $('drMembers'); if (!tb || !isAdmin()) return;
  const o = offices();
  tb.innerHTML = Object.entries(users).filter(([, u]) => u.role !== 'pending').map(([uid, u]) => `<tr>
    <td>${esc(u.name)}</td>
    <td><input class="dr-in" data-cname="${uid}" value="${esc(u.cname || '')}" placeholder="${esc(u.name)}"></td>
    <td><select class="dr-in" data-office-of="${uid}">${Object.entries(o).map(([k, x]) => `<option value="${k}" ${(u.office || 'tf') === k ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></td>
    <td><button class="btn btn-primary btn-sm" data-save-member="${uid}">儲存</button></td></tr>`).join('');
  if (!renderMembers.bound) {
    renderMembers.bound = true;
    tb.addEventListener('click', async e => {
      const b = e.target.closest('[data-save-member]'); if (!b) return;
      const uid = b.dataset.saveMember;
      const cname = tb.querySelector(`[data-cname="${uid}"]`).value.trim(), office = tb.querySelector(`[data-office-of="${uid}"]`).value;
      try { await update(ref(db, `users/${uid}`), { cname, office }); toast('已儲存'); } catch (er) { toast('儲存失敗：' + er.message); }
    });
  }
}
