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
// 公司「客戶服務日報表」Google 表單（預先填入連結）。表單欄位若被重建，需更新以下編號
const GFORM = {
  url: 'https://docs.google.com/forms/d/e/1FAIpQLSdJmwpN4YI_mFD7mMpTUxKzpPHIUhdboWw7qQUIN9UqT7RSNQ/viewform',
  date: 'entry.1692184938', who: 'entry.1138657570', scope: 'entry.2137328229', place: 'entry.1936715460',
  equip: 'entry.513482749', problem: 'entry.1241252801', work: 'entry.124862251',
  names: ['Jason', 'Roy', 'Evin', 'Ken', 'Kai', 'Rex'],   // 預設值；管理頁可維護（settings/gformNames）
};
const gformNames = () => (Array.isArray(settings.gformNames) && settings.gformNames.length ? settings.gformNames : GFORM.names);
// Google Routes API 金鑰：v1.7.2 起改存於資料庫 settings/gmapsKey，由管理頁設定，程式碼不再包含金鑰
const gmapsKey = () => String(settings.gmapsKey || '').trim();
const EXP_CATS = ['停車費', '住宿費', '運費', '餐費', '公共交通運輸費', '五金', '零件/耗材', '其他'];
const EXCELJS_URL = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';

let me = null, users = {}, master = { customers: {}, sites: {}, products: {} }, settings = DEFAULTS;
let monthData = {}, unsubMonth = {};        // reports by month: { '2026-10': {id: report} }
let exportLog = {};
let editing = null;                          // { month, id }
let route = null, items = [''], exps = [], meta = [{ st: 'done' }];
let tracking = {};
let contactAuto = true, prodAuto = true;

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
    refreshSelects(); renderMaster(); renderList(); renderFuel(); renderExpense(); renderTrack();
  });
  onValue(ref(db, 'settings'), s => { settings = { ...DEFAULTS, ...(s.val() || {}) }; if (route) renderRoute(); renderFuel(); renderMembers(); });
  onValue(ref(db, 'exportLog'), s => { exportLog = s.val() || {}; renderFuel(); });
  onValue(ref(db, 'tracking'), s => { tracking = s.val() || {}; renderTrack(); renderSiteOpen(); });
  watchMonth(ym(today()));
  resetForm();
}

export function setUsers(u) {
  users = u || {};
  if (me && users[me.uid]) me = { ...me, ...users[me.uid] };
  if (route && !editing && !route.stops.length && route.origin.type === 'office') { route.origin = { type: 'office', office: userOffice(me.uid) }; if ($('drDrive') && $('drDrive').checked) renderRoute(); }
  fillUserFilters(); renderMembers(); renderList(); renderFuel(); renderExpense(); renderTrack();
}

export function newReport() { resetForm(); $('drForm').scrollIntoView({ behavior: 'smooth', block: 'start' }); }

function watchMonth(m) {
  if (!m || unsubMonth[m]) return;
  unsubMonth[m] = onValue(ref(db, `reports/${m}`), s => {
    monthData[m] = s.val() || {};
    if (route) renderRoute();
    renderList(); renderFuel(); renderExpense();
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
      <div class="dr-auto"><button type="button" class="btn btn-primary btn-sm" id="drAutoKm">自動計算公里</button><span class="dr-hint" id="drAutoMsg">計算空白的路段；要重算某段，先清空該段公里數</span></div>
      <div class="dr-total"><span>總里程 <b id="drKm">0</b> 公里 × <span id="drRate">8</span> 元</span><span class="dr-big">NT$ <span id="drFuel">0</span></span></div>
    </div>

    <div class="dr-sec">處理事項 *</div>
    <div id="drSiteOpen"></div>
    <ol class="dr-items" id="drItems"></ol>
    <div class="dr-hint" style="margin-bottom:6px">每條預設為「完成」；沒處理完的請點一下改為「待追蹤」，可選填預計完成日。</div>
    <button type="button" class="btn btn-ghost btn-sm" id="drAddItem">新增一條</button>

    <div class="dr-sec">雜項支出</div>
    <div id="drExps"></div>
    <button type="button" class="btn btn-ghost btn-sm" id="drAddExp">新增一筆雜項支出</button>
    <div class="dr-hint">油資由系統依路線計算，不用填在雜項支出。</div>

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
    <div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal('drLineModal')">關閉</button><a class="btn btn-ghost" id="drGform" target="_blank" rel="noopener" style="text-decoration:none">填寫公司日報表</a><button class="btn btn-primary" id="drCopy">複製文字</button></div>
  </div></div>`;

  $('panel-track').innerHTML = `
  <div class="card">
    <div class="card-title"><span>📌 待追蹤事項</span></div>
    <div id="drTrackStat"></div>
    <div class="dr-grid">
      <div class="form-group"><label>狀態</label><select id="drTrackMode"><option value="open">未結案</option><option value="closed">已結案</option></select></div>
      <div class="form-group"><label>人員</label><select id="drTrackUser"></select></div>
    </div>
    <div id="drTrackOut"></div>
  </div>`;

  $('panel-fuel').innerHTML = `
  <div class="card">
    <div class="card-title"><span>⛽ 油資報表</span><button class="btn btn-primary btn-sm" id="drXlsx">匯出 Excel</button></div>
    <div class="dr-grid">
      <div class="form-group"><label>月份</label><input type="month" id="drFuelMonth"></div>
      <div class="form-group"><label>人員</label><select id="drFuelUser"></select></div>
    </div>
    <div id="drFuelWarn"></div>
    <div id="drFuelOut"></div>
  </div>
  <div class="card">
    <div class="card-title"><span>💰 雜項支出報表</span><button class="btn btn-primary btn-sm" id="drExpXlsx">匯出 Excel</button></div>
    <div class="dr-grid">
      <div class="form-group"><label>月份</label><input type="month" id="drExpMonth"></div>
      <div class="form-group"><label>人員</label><select id="drExpUser"></select></div>
    </div>
    <div id="drExpOut"></div>
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
    <p class="dr-hint" style="margin-bottom:12px">中文姓名印在油資報表的申請人欄；所屬辦公室是路線起點的預設值；公司日報表填表人是開啟公司 Google 表單時自動選取的名字。</p>
    <div class="dr-gnames">
      <div class="form-group" style="flex:1;margin:0"><label>Google 路線金鑰（自動計算公里用）　<span id="drGKeyState" style="text-transform:none;letter-spacing:0"></span></label><input class="dr-in" id="drGKey" type="password" autocomplete="off" placeholder="輸入新金鑰以設定或更換"></div>
      <button class="btn btn-primary btn-sm" id="drGKeySave">儲存金鑰</button>
      <button class="btn btn-danger btn-sm" id="drGKeyClear">清除</button>
    </div>
    <div class="dr-gnames">
      <div class="form-group" style="flex:1;margin:0"><label>公司日報表填表人名單（需與 Google 表單選項完全相同，以逗號分隔）</label><input class="dr-in" id="drGNames"></div>
      <button class="btn btn-primary btn-sm" id="drGNamesSave">儲存名單</button>
    </div>
    <table class="data-table"><thead><tr><th>成員</th><th>中文姓名</th><th>所屬辦公室</th><th>公司日報表填表人</th><th></th></tr></thead><tbody id="drMembers"></tbody></table>
  </div>`;

  bindForm();
  const m = ym(today());
  $('drListMonth').value = m; $('drFuelMonth').value = m; $('drExpMonth').value = m;
  $('drExpMonth').onchange = () => { watchMonth($('drExpMonth').value); renderExpense(); };
  $('drExpUser').onchange = renderExpense;
  $('drExpXlsx').onclick = exportExpense;
  $('drTrackMode').onchange = renderTrack; $('drTrackUser').onchange = renderTrack;
  const onTrackClick = e => { const c = e.target.closest('[data-close]'), o = e.target.closest('[data-reopen]'); if (c) setClosed(c.dataset.close, true); if (o) setClosed(o.dataset.reopen, false); };
  $('panel-track').addEventListener('click', onTrackClick);
  $('drSiteOpen').addEventListener('click', onTrackClick);
  $('drListMonth').onchange = () => { watchMonth($('drListMonth').value); renderList(); };
  $('drListUser').onchange = renderList;
  $('drFuelMonth').onchange = () => { watchMonth($('drFuelMonth').value); renderFuel(); };
  $('drFuelUser').onchange = renderFuel;
  $('drXlsx').onclick = exportXlsx;
  fillUserFilters();
}

function fillUserFilters() {
  ['drListUser', 'drFuelUser', 'drExpUser', 'drTrackUser'].forEach(id => {
    const sel = $(id); if (!sel || !me) return;
    const cur = sel.value;
    const list = isAdmin() ? Object.keys(users) : [me.uid];
    const all = (id === 'drListUser' || id === 'drExpUser' || id === 'drTrackUser') && isAdmin() ? '<option value="">全部人員</option>' : '';
    sel.innerHTML = all + list.filter(uid => users[uid] || uid === me.uid)
      .map(uid => `<option value="${uid}">${esc(uid === me.uid ? me.name : userName(uid))}</option>`).join('');
    if (cur !== undefined && [...sel.options].some(o => o.value === cur)) sel.value = cur;
    else sel.value = (id === 'drListUser' || id === 'drExpUser' || id === 'drTrackUser') && isAdmin() ? '' : me.uid;
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
  $('drCust').onchange = () => { refreshSelects({ site: '' }); syncSiteStops(); autoContact(); autoProd(); renderSiteOpen(); };
  $('drSite').onchange = () => { syncSiteStops(); autoContact(); autoProd(); renderSiteOpen(); };
  $('drProd').addEventListener('change', () => { prodAuto = !$('drProd').value; });
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
  $('drAutoKm').onclick = autoKm;
  $('drItems').addEventListener('input', e => { const d = e.target.dataset; if (d.item !== undefined) items[+d.item] = e.target.value; if (d.itemDue !== undefined) meta[+d.itemDue].due = e.target.value; });
  $('drItems').addEventListener('click', e => {
    const b = e.target.closest('[data-item-del]'); if (b) { items.splice(+b.dataset.itemDel, 1); meta.splice(+b.dataset.itemDel, 1); renderItems(); return; }
    const t = e.target.closest('[data-item-st]'); if (t) { const m2 = meta[+t.dataset.itemSt]; if (m2.closedAt) { toast('此事項已結案，請到「待追蹤」頁重新開啟'); return; } m2.st = m2.st === 'open' ? 'done' : 'open'; renderItems(); }
  });
  $('drItems').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset.item !== undefined) { e.preventDefault(); $('drAddItem').click(); } });
  $('drAddItem').onclick = () => { items.push(''); meta.push({ st: 'done' }); renderItems(); const l = $('drItems').querySelectorAll('input'); l[l.length - 1].focus(); };
  $('drExps').addEventListener('input', e => { const t = e.target; if (t.dataset.expAmt !== undefined) exps[+t.dataset.expAmt].amt = t.value; if (t.dataset.expNote !== undefined) exps[+t.dataset.expNote].note = t.value; if (t.dataset.expCat !== undefined) exps[+t.dataset.expCat].cat = t.value; });
  $('drExps').addEventListener('change', e => { const t = e.target; if (t.dataset.expCat !== undefined) exps[+t.dataset.expCat].cat = t.value; });
  $('drExps').addEventListener('click', e => { const b = e.target.closest('[data-exp-del]'); if (b) { exps.splice(+b.dataset.expDel, 1); renderExps(); } });
  $('drAddExp').onclick = () => { exps.push({ cat: '', amt: '', note: '' }); renderExps(); };
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

function autoProd() {
  if (!prodAuto && $('drProd').value) return;
  const s2 = master.sites[$('drSite').value], pid = s2 && s2.prod;
  if (pid && master.products[pid] && master.products[pid].active !== false) refreshSelects({ prod: pid });
  else if (prodAuto) refreshSelects({ prod: '' });
  prodAuto = true;
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
    const mn = (r.mins || [])[i];
    h += `<div class="dr-leg">這段 <input type="number" min="0" step="0.1" inputmode="decimal" data-leg="${i}" value="${esc(r.legs[i])}"> 公里${mn != null && r.legs[i] !== '' ? `<span class="dr-auto-tag">自動・約 ${mn} 分鐘</span>` : ''}</div>`;
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
    if (d.leg !== undefined) { route.legs[+d.leg] = e.target.value; (route.mins = route.mins || [])[+d.leg] = null; const t = e.target.parentElement.querySelector('.dr-auto-tag'); if (t) t.remove(); calcFuel(); }
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
    else if (b.dataset.del !== undefined) { i = +b.dataset.del; s.splice(i, 1); l.splice(i, 1); (route.mins = route.mins || []).splice(i, 1); if (i < l.length) l[i] = ''; }
    else return;
    route.mins = (route.mins || []).slice(0, l.length);
    l.forEach((v, k) => { if (v === '') route.mins[k] = null; });
    renderRoute();
  });
}
const kmOf = r => (r && r.legs ? r.legs : []).reduce((a, b) => a + (parseFloat(b) || 0), 0);
function calcFuel() { const km = round1(kmOf(route)); $('drKm').textContent = km; $('drRate').textContent = rate(); $('drFuel').textContent = Math.round(km * rate()).toLocaleString(); }

// ── 自動計算公里（Google Routes API，結果快取於 distCache，同一路段只查一次） ──
function addrOf(p) {
  if (!p) return '';
  if (p.type === 'office') { const o = offices()[p.office]; return o ? o.addr : ''; }
  if (p.type === 'site') { const x = master.sites[p.site]; return (x && x.addr) || ''; }
  return p.addr || '';
}
const BAD_ADDR = /國外|一帶|園區$/;
async function legKey(from, to) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${from}→${to}`));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function googleLeg(from, to) {
  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': gmapsKey(), 'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration' },
    body: JSON.stringify({ origin: { address: from }, destination: { address: to }, travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE', languageCode: 'zh-TW', regionCode: 'TW' }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j.error && j.error.message) || `HTTP ${res.status}`);
  const rt = j.routes && j.routes[0];
  if (!rt || rt.distanceMeters == null) throw new Error('Google 找不到這兩點之間的路線');
  return { km: round1(rt.distanceMeters / 1000), min: Math.round(parseInt(rt.duration || '0', 10) / 60) };
}
async function autoKm() {
  const msg = $('drAutoMsg'), btn = $('drAutoKm');
  if (!route.stops.length) { msg.textContent = '請先加入目的地'; return; }
  if (!gmapsKey()) { msg.textContent = '尚未設定 Google 金鑰（管理頁 → 日報成員設定），請先手動輸入公里數'; return; }
  const pts = [route.origin, ...route.stops];
  route.mins = route.mins || [];
  const todo = route.stops.map((_, i) => i).filter(i => route.legs[i] === '' || route.legs[i] == null);
  if (!todo.length) { msg.textContent = '每段都已有公里數；要重算請先清空該段'; return; }
  btn.disabled = true; msg.textContent = '計算中…';
  const fails = []; let hit = 0, call = 0;
  for (const i of todo) {
    const from = addrOf(pts[i]), to = addrOf(pts[i + 1]), nm2 = `${label(pts[i])} → ${label(pts[i + 1])}`;
    if (!from || !to) { fails.push(`${nm2}：缺少地址`); continue; }
    if (BAD_ADDR.test(from) || BAD_ADDR.test(to)) { fails.push(`${nm2}：地址不夠精確`); continue; }
    try {
      const key = await legKey(from, to);
      const c = (await get(ref(db, `distCache/${key}`))).val();
      let v = c;
      if (c) hit++;
      else { v = await googleLeg(from, to); call++; await set(ref(db, `distCache/${key}`), { from, to, km: v.km, min: v.min, at: new Date().toISOString() }); }
      route.legs[i] = String(v.km); route.mins[i] = v.min;
    } catch (e) { fails.push(`${nm2}：${e.message}`); }
  }
  btn.disabled = false;
  renderRoute();
  const allAuto = route.stops.every((_, i) => route.legs[i] !== '' && route.mins[i] != null);
  if (allAuto) { const h = route.mins.reduce((a, m) => a + (m || 0), 0) / 60; $('drTravel').value = Math.max(0.5, Math.round(h * 2) / 2); }
  msg.textContent = (fails.length ? '以下路段請手動輸入：' + fails.join('；') + '。' : '計算完成。') +
    `（沿用紀錄 ${hit} 段、查詢 Google ${call} 段${allAuto ? '，已帶入交通時間' : ''}）`;
}

function renderItems() {
  while (meta.length < items.length) meta.push({ st: 'done' });
  $('drItems').innerHTML = items.map((t, i) => {
    const m2 = meta[i], open = m2.st === 'open', closed = !!m2.closedAt;
    return `<li class="${open ? 'dr-open' : ''}"><input data-item="${i}" value="${esc(t)}">
      <button type="button" class="dr-chip ${open ? (closed ? 'closed' : 'open') : ''}" data-item-st="${i}">${open ? (closed ? '已結案' : '待追蹤') : '完成'}</button>
      ${items.length > 1 ? `<button type="button" class="btn btn-danger btn-sm" data-item-del="${i}">刪除</button>` : ''}
      ${open && !closed ? `<label class="dr-due">預計完成 <input type="date" data-item-due="${i}" value="${esc(m2.due || '')}"></label>` : ''}</li>`;
  }).join('');
}
function renderExps() {
  $('drExps').innerHTML = exps.map((x, i) => `<div class="dr-exp"><select data-exp-cat="${i}"><option value="">類別</option>${EXP_CATS.map(c => `<option ${x.cat === c ? 'selected' : ''}>${c}</option>`).join('')}</select><input type="number" min="0" step="1" inputmode="numeric" placeholder="金額" data-exp-amt="${i}" value="${esc(x.amt)}"><input placeholder="說明（選填）" data-exp-note="${i}" value="${esc(x.note)}"><button type="button" class="btn btn-danger btn-sm" data-exp-del="${i}">刪除</button></div>`).join('');
}

function resetForm() {
  if (!me || !$('drDate')) return;
  editing = null;
  $('drDate').value = today(); $('drUser').value = me.name || me.email;
  $('drStart').value = '09:00'; $('drEnd').value = '18:00'; $('drTravel').value = '0';
  $('drOvernight').checked = false; $('drDrive').checked = false; $('drRouteBox').hidden = true;
  $('drContact').value = ''; contactAuto = true; prodAuto = true;
  route = newRoute(); items = ['']; meta = [{ st: 'done' }]; exps = [];
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
  for (let j = 0; j < exps.length; j++) {
    const x = exps[j]; if (x.amt === '' && x.note === '' && !x.cat) continue;
    if (!x.cat) return `雜項支出第 ${j + 1} 筆請選類別`;
    if (isNaN(parseFloat(x.amt))) return `雜項支出第 ${j + 1} 筆請填金額`;
  }
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
    itemMeta: items.map((x, i) => [x.trim(), meta[i] || { st: 'done' }]).filter(([x]) => x).map(([, m2]) => {
      const o = { st: m2.st === 'open' ? 'open' : 'done' };
      if (o.st === 'open') { if (m2.due) o.due = m2.due; if (m2.closedAt) { o.closedAt = m2.closedAt; o.closedBy = m2.closedBy || ''; if (m2.closeNote) o.closeNote = m2.closeNote; } }
      return o;
    }),
    exps: exps.filter(x => x.amt !== '' || x.note !== '' || x.cat).map(x => ({ cat: x.cat, amt: parseFloat(x.amt) || 0, note: x.note.trim() })),
    updatedAt: now, updatedBy: me.uid,
  };
  if (drive) rec.route.legs = rec.route.legs.map(x => parseFloat(x) || 0);
  $('drSubmit').disabled = true;
  try {
    let rid;
    if (editing) {
      rid = editing.id;
      const old = (monthData[editing.month] || {})[editing.id] || {};
      rec.createdAt = old.createdAt || now;
      if (editing.month !== month) {
        await set(ref(db, `reports/${month}/${editing.id}`), rec);
        await remove(ref(db, `reports/${editing.month}/${editing.id}`));
      } else await set(ref(db, `reports/${month}/${editing.id}`), rec);
    } else {
      rec.createdAt = now;
      const nr = push(ref(db, `reports/${month}`)); rid = nr.key;
      await set(nr, rec);
      const p = master.products[rec.prod];
      if (p) await update(ref(db, `master/products/${rec.prod}`), { uses: (p.uses || 0) + 1 });
    }
    await syncTracking(rid, month, rec);
    if (rec.contact) await update(ref(db, `master/sites/${rec.site}`), { lastContact: rec.contact });
    const st = master.sites[rec.site];
    if (st && !st.prod && rec.prod) await update(ref(db, `master/sites/${rec.site}`), { prod: rec.prod });
    watchMonth(month);
    showLine(rec);
    resetForm();
  } catch (e) { $('drErr').textContent = '儲存失敗：' + (e.message || e); }
  finally { $('drSubmit').disabled = false; }
}

function lineText(r) {
  const sum = (r.exps || []).reduce((a, x) => a + (parseFloat(x.amt) || 0), 0);
  const notes = (r.exps || []).map(x => `${x.cat || x.note || '其他'}${x.cat && x.note ? '(' + x.note + ')' : ''} ${x.amt}`);
  return `日期：${r.date.replace(/-/g, '/')}\n人員：${userName(r.uid)}\n客戶：${nm('customers', r.cust)}\n案場：${nm('sites', r.site)}\n產品：${nm('products', r.prod)}\n` +
    `工作時間：${r.start}~${r.end}${r.overnight ? '（隔日）' : ''}\n交通時間：${r.travel || 0}h\n處理事項：\n` +
    (r.items || []).map((x, i) => `${i + 1}. ${x}`).join('\n') + `\n支出：${sum}${notes.length ? '（' + notes.join('、') + '）' : ''}`;
}
function scopeOf(prodName) {
  if (/FMX/i.test(prodName || '')) return '半導體';
  if (/海辰|中和|kWh/i.test(prodName || '')) return '能源';
  return '其他';
}
function gformUrl(r) {
  const prod = r.prod ? nm('products', r.prod) : '';
  const items = r.items || [];
  const q = new URLSearchParams({ usp: 'pp_url' });
  q.set(GFORM.date, r.date);
  const who = users[r.uid] && users[r.uid].formName;
  if (who) q.set(GFORM.who, who);
  q.set(GFORM.scope, scopeOf(prod));
  q.set(GFORM.place, `${nm('customers', r.cust)}_${nm('sites', r.site)}`);
  if (prod) q.set(GFORM.equip, prod);
  q.set(GFORM.problem, items.join('；'));
  q.set(GFORM.work, items.map((x, i) => `${i + 1}. ${x}`).join('\n'));
  return `${GFORM.url}?${q.toString()}`;
}
function showLine(r) {
  $('drLineText').textContent = lineText(r);
  const a = $('drGform');
  a.href = gformUrl(r);
  a.style.display = r.uid === me.uid ? '' : 'none';
  $('drLineModal').classList.add('open');
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
  $('drContact').value = r.contact || ''; contactAuto = !r.contact; prodAuto = false;
  $('drStart').value = r.start; $('drEnd').value = r.end; $('drOvernight').checked = !!r.overnight; $('drTravel').value = r.travel || 0;
  $('drDrive').checked = !!r.drive; $('drRouteBox').hidden = !r.drive;
  route = r.drive && r.route ? JSON.parse(JSON.stringify({ stops: [], legs: [], ...r.route })) : newRoute();
  route.legs = (route.legs || []).map(String);
  route.mins = route.stops.map((_, i) => { const v = (route.mins || {})[i]; return v == null ? null : v; });
  items = (r.items || []).slice(); if (!items.length) items = [''];
  meta = items.map((_, i) => ({ st: 'done', ...((r.itemMeta || [])[i] || {}) }));
  exps = (r.exps || []).map(x => ({ cat: x.cat || (x.note ? '其他' : ''), amt: String(x.amt), note: x.note || '' }));
  renderItems(); renderExps(); showHours(); if (r.drive) renderRoute();
  $('drSubmit').textContent = '儲存修改'; $('drFormTitle').textContent = '✏️ 修改工作日報';
  $('drForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ═════════════ 待追蹤事項 ═════════════
// tracking/{reportId_index}：{ uid, month, rid, idx, text, cust, site, date, due, closedAt, closedBy, closeNote }
async function clearTracking(rid) {
  const ups = {};
  Object.keys(tracking).forEach(k => { if (tracking[k].rid === rid) ups[k] = null; });
  if (Object.keys(ups).length) await update(ref(db, 'tracking'), ups);
}
async function syncTracking(rid, month, rec) {
  const ups = {};
  Object.keys(tracking).forEach(k => { if (tracking[k].rid === rid) ups[k] = null; });
  (rec.itemMeta || []).forEach((m2, i) => {
    if (m2.st !== 'open') return;
    const t = { uid: rec.uid, month, rid, idx: i, text: rec.items[i], cust: rec.cust, site: rec.site, date: rec.date, due: m2.due || '' };
    if (m2.closedAt) Object.assign(t, { closedAt: m2.closedAt, closedBy: m2.closedBy || '', closeNote: m2.closeNote || '' });
    ups[`${rid}_${i}`] = t;
  });
  if (Object.keys(ups).length) await update(ref(db, 'tracking'), ups);
}
const daysSince = d => Math.max(0, Math.floor((new Date(today()) - new Date(d)) / 86400000));
const canEdit = t => isAdmin() || t.uid === me.uid;
async function setClosed(key, close) {
  const t = tracking[key]; if (!t || !canEdit(t)) return;
  let note = '';
  if (close) { note = prompt(`結案：${t.text}\n可填寫結案說明（選填）`, ''); if (note === null) return; }
  const now = new Date().toISOString();
  const patch = close ? { closedAt: now, closedBy: me.uid, closeNote: note.trim() } : { closedAt: null, closedBy: null, closeNote: null };
  try {
    await update(ref(db, `tracking/${key}`), patch);
    await update(ref(db, `reports/${t.month}/${t.rid}/itemMeta/${t.idx}`), patch);
    toast(close ? '已結案' : '已重新開啟');
  } catch (e) { toast('更新失敗：' + e.message); }
}
function renderSiteOpen() {
  const box = $('drSiteOpen'); if (!box || !me) return;
  const sid = $('drSite').value;
  const list = Object.entries(tracking).filter(([, t]) => t.site === sid && !t.closedAt && canEdit(t) && !(editing && t.rid === editing.id));
  box.innerHTML = list.length ? `<div class="dr-siteopen"><b>此案場尚有 ${list.length} 件待追蹤</b>` + list.map(([k, t]) =>
    `<div class="dr-siteopen-row"><span>${esc(t.text)}<span class="dr-hint">　${esc(userName(t.uid))}・${esc(t.date.slice(5).replace('-', '/'))} 起・${daysSince(t.date)} 天</span></span><button type="button" class="btn btn-ghost btn-sm" data-close="${k}">結案</button></div>`).join('') + '</div>' : '';
}
function renderTrack() {
  const out = $('drTrackOut'); if (!out || !me) return;
  const u = isAdmin() ? $('drTrackUser').value : me.uid, mode = $('drTrackMode').value;
  let list = Object.entries(tracking).filter(([, t]) => (!u || t.uid === u) && (mode === 'open' ? !t.closedAt : !!t.closedAt));
  const openAll = Object.values(tracking).filter(t => !t.closedAt && (!u || t.uid === u));
  const overdue = openAll.filter(t => t.due && t.due < today()).length, aged = openAll.filter(t => daysSince(t.date) > 7).length;
  $('drTrackStat').innerHTML = `<div class="dr-stats"><div><b>${openAll.length}</b><span>未結案</span></div><div class="${aged ? 'warn' : ''}"><b>${aged}</b><span>超過 7 天</span></div><div class="${overdue ? 'warn' : ''}"><b>${overdue}</b><span>已逾預計完成日</span></div></div>`;
  if (!list.length) { out.innerHTML = `<div class="empty-state"><div class="icon">📌</div>${mode === 'open' ? '沒有未結案的待追蹤事項' : '沒有已結案的紀錄'}</div>`; return; }
  const groups = {};
  list.forEach(([k, t]) => { const g = `${nm('customers', t.cust)}／${nm('sites', t.site)}`; (groups[g] = groups[g] || []).push([k, t]); });
  const order = Object.keys(groups).sort((a, b) => Math.max(...groups[b].map(([, t]) => daysSince(t.date))) - Math.max(...groups[a].map(([, t]) => daysSince(t.date))));
  out.innerHTML = order.map(g => `<div class="dr-sec">${esc(g)}（${groups[g].length}）</div>` + groups[g]
    .sort((a, b) => a[1].date.localeCompare(b[1].date))
    .map(([k, t]) => {
      const d = daysSince(t.date), od = t.due && t.due < today() && !t.closedAt;
      return `<div class="dr-card ${od ? 'dr-overdue' : ''}"><div class="dr-card-h"><b>${esc(t.text)}</b><span class="dr-tag">${esc(userName(t.uid))}</span></div>
        <div class="dr-hint">${esc(t.date.replace(/-/g, '/'))} 起${t.closedAt ? `・${esc(new Date(t.closedAt).toLocaleDateString('zh-TW'))} 結案（${esc(userName(t.closedBy))}）` : `・已 ${d} 天`}${t.due ? `・預計完成 ${esc(t.due.replace(/-/g, '/'))}${od ? '（已逾期）' : ''}` : ''}</div>
        ${t.closeNote ? `<div class="dr-hint">結案說明：${esc(t.closeNote)}</div>` : ''}
        ${canEdit(t) ? `<div class="dr-actions">${t.closedAt ? `<button class="btn btn-ghost btn-sm" data-reopen="${k}">重新開啟</button>` : `<button class="btn btn-primary btn-sm" data-close="${k}">結案</button>`}</div>` : ''}</div>`;
    }).join('')).join('');
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
      <ol class="dr-ol">${(r.items || []).map((x, i) => { const m2 = (r.itemMeta || [])[i]; return `<li>${esc(x)}${m2 && m2.st === 'open' ? ` <span class="dr-chip ${m2.closedAt ? 'closed' : 'open'}">${m2.closedAt ? '已結案' : '待追蹤'}</span>` : ''}</li>`; }).join('')}</ol>
      <div class="dr-hint">最後修改：${esc(new Date(r.updatedAt).toLocaleString('zh-TW'))}（${esc(userName(r.updatedBy))}）</div>
      <div class="dr-actions">
        ${mine ? `<button class="btn btn-ghost btn-sm" data-edit="${m}|${id}">修改</button>` : ''}
        <button class="btn btn-ghost btn-sm" data-copy="${m}|${id}">LINE 文字／公司日報表</button>
        ${mine ? `<button class="btn btn-danger btn-sm" data-rm="${m}|${id}">刪除</button>` : ''}
      </div></div>`;
  }).join('');
}
async function listClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  const [m, id] = (b.dataset.edit || b.dataset.copy || b.dataset.rm || '').split('|');
  if (b.dataset.edit) loadForEdit(m, id);
  if (b.dataset.copy) showLine(monthData[m][id]);
  if (b.dataset.rm && confirm('確定刪除這筆日報？\n（此日報的待追蹤事項也會一併移除）')) { try { await clearTracking(id); await remove(ref(db, `reports/${m}/${id}`)); toast('已刪除'); } catch (er) { toast('刪除失敗：' + er.message); } }
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

// ═════════════ 雜項支出報表 ═════════════
const catOf = x => EXP_CATS.includes(x.cat) ? x.cat : '其他';
function expenseData(m, uidFilter) {
  const rs = Object.values(monthData[m] || {}).filter(r => !uidFilter || r.uid === uidFilter);
  const uids = [...new Set(rs.map(r => r.uid))].sort((a, b) => userName(a).localeCompare(userName(b), 'zh-Hant'));
  return uids.map(uid => {
    const lines = [];
    rs.filter(r => r.uid === uid).sort((a, b) => a.date.localeCompare(b.date) || (a.start || '').localeCompare(b.start || ''))
      .forEach(r => (r.exps || []).forEach(x => { if (parseFloat(x.amt)) lines.push({ date: r.date, cust: nm('customers', r.cust), site: nm('sites', r.site), cat: catOf(x), note: x.note || '', amt: parseFloat(x.amt) || 0 }); }));
    const byCat = Object.fromEntries(EXP_CATS.map(c => [c, 0]));
    lines.forEach(x => { byCat[x.cat] += x.amt; });
    return { uid, lines, byCat, expSum: lines.reduce((a, x) => a + x.amt, 0) };
  }).filter(p => p.lines.length);
}
function renderExpense() {
  const out = $('drExpOut'); if (!out || !me) return;
  const m = $('drExpMonth').value, u = isAdmin() ? $('drExpUser').value : me.uid;
  if (!monthData[m]) { out.innerHTML = '<div class="empty-state"><div class="icon">⏳</div>載入中...</div>'; return; }
  const ps = expenseData(m, u);
  if (!ps.length) { out.innerHTML = `<div class="empty-state"><div class="icon">💰</div>${esc(m)} 沒有雜項支出紀錄</div>`; return; }
  const n = v => v ? Math.round(v).toLocaleString() : '';
  const R = 'style="text-align:right"';
  const tot = c => ps.reduce((a, p) => a + p.byCat[c], 0), all = ps.reduce((a, p) => a + p.expSum, 0);
  let h = `<div style="overflow-x:auto"><table class="data-table"><thead><tr><th>人員</th>${EXP_CATS.map(c => `<th ${R}>${c}</th>`).join('')}<th ${R}>合計</th></tr></thead><tbody>` +
    ps.map(p => `<tr><td>${esc(userName(p.uid))}</td>${EXP_CATS.map(c => `<td ${R}>${n(p.byCat[c])}</td>`).join('')}<td ${R}>${n(p.expSum)}</td></tr>`).join('') +
    (ps.length > 1 ? `<tr class="dr-sum"><td>合計</td>${EXP_CATS.map(c => `<td ${R}>${n(tot(c))}</td>`).join('')}<td ${R}>NT$ ${n(all)}</td></tr>` : '') +
    `</tbody></table></div>`;
  ps.forEach(p => {
    h += `<div class="dr-sec">${esc(userName(p.uid))} 雜項支出明細</div><div style="overflow-x:auto"><table class="data-table"><thead><tr><th>日期</th><th>客戶／案場</th><th>類別</th><th>說明</th><th ${R}>金額</th></tr></thead><tbody>` +
      p.lines.map(x => `<tr><td>${esc(x.date.slice(5).replace('-', '/'))}</td><td>${esc(x.cust)}／${esc(x.site)}</td><td>${esc(x.cat)}</td><td>${esc(x.note)}</td><td ${R}>${n(x.amt)}</td></tr>`).join('') + '</tbody></table></div>';
  });
  out.innerHTML = h;
}
function sheetName(s, used) {
  let b = String(s).replace(/[\\\/\?\*\[\]:]/g, '_').slice(0, 31) || '人員', n = b, i = 2;
  while (used.has(n)) n = b.slice(0, 28) + '_' + (i++);
  used.add(n); return n;
}
async function exportExpense() {
  const m = $('drExpMonth').value, u = isAdmin() ? $('drExpUser').value : me.uid;
  const ps = expenseData(m, u);
  if (!ps.length) { toast('這個月份沒有可匯出的資料'); return; }
  try { await loadExcelJS(); } catch (e) { toast(e.message); return; }
  const y = m.slice(0, 4), mo = +m.slice(5, 7), yyyymm = m.replace('-', '');
  const F = '微软雅黑', thin = { style: 'thin' }, box = { top: thin, bottom: thin, left: thin, right: thin };
  const head = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } }, money = '#,##0;-#,##0;"-"';
  const wb = new ExcelJS.Workbook(), used = new Set(['雜項支出總表']);
  const title = (ws, text, cols) => { ws.mergeCells(1, 1, 1, cols); Object.assign(ws.getCell(1, 1), { value: text, font: { name: F, size: 16, bold: true }, alignment: { horizontal: 'center', vertical: 'middle' } }); ws.getRow(1).height = 32; };
  const header = (ws, row, labels) => { ws.getRow(row).height = 30; labels.forEach((h, i) => Object.assign(ws.getCell(row, i + 1), { value: h, font: { name: F, size: 10, bold: true, color: { argb: 'FFFFFFFF' } }, fill: head, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true }, border: box })); };
  const cell = (ws, r, c, v, fmt, align, bold) => { const x = ws.getCell(r, c); Object.assign(x, { value: v, font: { name: F, size: 10, bold: !!bold }, border: box, alignment: { vertical: 'middle', horizontal: align || 'left', wrapText: true } }); if (fmt) x.numFmt = fmt; return x; };
  const col = i => String.fromCharCode(65 + i);
  const names = {}; ps.forEach(p => { names[p.uid] = sheetName(userName(p.uid), used); });

  // 總表：人員 × 類別
  const sum = wb.addWorksheet('雜項支出總表');
  const nc = EXP_CATS.length + 2;
  title(sum, `竑瑞科技 ${y}.${mo}月份雜項支出總表`, nc);
  sum.getColumn(1).width = 16; EXP_CATS.forEach((c, i) => { sum.getColumn(i + 2).width = c.length > 4 ? 14 : 11; }); sum.getColumn(nc).width = 13;
  header(sum, 3, ['人員', ...EXP_CATS, '合計']);
  ps.forEach((p, i) => {
    const r = 4 + i, sn = names[p.uid].replace(/'/g, "''"), last = 3 + p.lines.length;
    cell(sum, r, 1, userName(p.uid));
    EXP_CATS.forEach((c, j) => cell(sum, r, j + 2, { formula: `SUMIF('${sn}'!D4:D${last},"${c}",'${sn}'!F4:F${last})` }, money, 'right'));
    cell(sum, r, nc, { formula: `SUM(B${r}:${col(nc - 2)}${r})` }, money, 'right', true);
  });
  const tr = 4 + ps.length;
  cell(sum, tr, 1, '合計', null, 'left', true);
  for (let c = 2; c <= nc; c++) cell(sum, tr, c, { formula: `SUM(${col(c - 1)}4:${col(c - 1)}${tr - 1})` }, money, 'right', true);
  Object.assign(sum.getCell(tr + 2, 1), { value: '不含油資（油資請見出差油資報表）；明細見各人員工作表。', font: { name: F, size: 9, color: { argb: 'FF666666' } } });

  // 各人明細
  ps.forEach(p => {
    const ws = wb.addWorksheet(names[p.uid]);
    title(ws, `${userName(p.uid)} ${y}.${mo}月份雜項支出明細`, 6);
    [12, 16, 18, 16, 30, 12].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    header(ws, 3, ['日期', '客戶', '案場', '類別', '說明', '金額']);
    p.lines.forEach((x, i) => {
      const r = 4 + i;
      cell(ws, r, 1, new Date(Date.UTC(+x.date.slice(0, 4), +x.date.slice(5, 7) - 1, +x.date.slice(8, 10))), 'm"月"d"日"', 'center');
      cell(ws, r, 2, x.cust); cell(ws, r, 3, x.site); cell(ws, r, 4, x.cat, null, 'center'); cell(ws, r, 5, x.note); cell(ws, r, 6, x.amt, money, 'right');
    });
    const r = 4 + p.lines.length;
    cell(ws, r, 5, '合計', null, 'right', true);
    cell(ws, r, 6, { formula: `SUM(F4:F${r - 1})` }, money, 'right', true);
  });

  const buf = await wb.xlsx.writeBuffer();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = `${yyyymm}_雜項支出_${u ? userName(u) : '全員'}.xlsx`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ═════════════ 管理：主檔與成員 ═════════════
function renderMaster() {
  if (!$('drMCust') || !isAdmin()) return;
  const li = (coll, id, x, extra) => `<li class="${x.active === false ? 'off' : ''}"><span>${esc(x.name)}${extra ? `<span class="dr-hint">　${esc(extra)}</span>` : ''}${x.active === false ? '　<span class="dr-tag">已停用</span>' : ''}</span>
    <span style="display:flex;gap:4px;flex-shrink:0">${coll === 'sites' ? `<button class="btn btn-sm btn-ghost" data-addr="${id}">地址</button>` : ''}<button class="btn btn-sm ${x.active === false ? 'btn-ghost' : 'btn-danger'}" data-toggle="${coll}|${id}">${x.active === false ? '啟用' : '停用'}</button></span></li>`;
  const sortN = o => Object.entries(o).sort((a, b) => a[1].name.localeCompare(b[1].name, 'zh-Hant'));
  $('drMCust').innerHTML = sortN(master.customers).map(([id, x]) => li('customers', id, x)).join('') || '<li class="dr-hint">尚無資料</li>';
  $('drMSite').innerHTML = sortN(master.sites).map(([id, x]) => li('sites', id, x, `${nm('customers', x.cust)}｜${x.addr || '未填地址'}`)).join('') || '<li class="dr-hint">尚無資料</li>';
  $('drMProd').innerHTML = sortN(master.products).map(([id, x]) => li('products', id, x)).join('') || '<li class="dr-hint">尚無資料</li>';
  if (!renderMaster.bound) {
    renderMaster.bound = true;
    $('drAdminHost').addEventListener('click', async e => {
      const ab = e.target.closest('[data-addr]');
      if (ab && isAdmin()) {
        const x = master.sites[ab.dataset.addr];
        const v = prompt(`「${x.name}」的地址（可填門牌地址或 Google Plus Code，例如 VPM3+V5 萬丹村 南投縣名間鄉）`, x.addr || '');
        if (v === null) return;
        try { await update(ref(db, `master/sites/${ab.dataset.addr}`), { addr: v.trim() }); toast('地址已更新'); } catch (er) { toast('更新失敗：' + er.message); }
        return;
      }
      const b = e.target.closest('[data-toggle]'); if (!b || !isAdmin()) return;
      const [coll, id] = b.dataset.toggle.split('|'), x = master[coll][id];
      await update(ref(db, `master/${coll}/${id}`), { active: x.active === false });
    });
  }
}
function renderMembers() {
  const tb = $('drMembers'); if (!tb || !isAdmin()) return;
  const gi = $('drGNames');
  if (gi && document.activeElement !== gi) gi.value = gformNames().join(', ');
  const gs = $('drGKeyState'), k = gmapsKey();
  if (gs) gs.textContent = k ? `已設定（${k.slice(0, 4)}••••••${k.slice(-4)}）` : '尚未設定';
  if (!renderMembers.gbound) {
    renderMembers.gbound = true;
    $('drGKeySave').onclick = async () => {
      const v = $('drGKey').value.trim();
      if (!v) { toast('請輸入金鑰'); return; }
      if (!/^AIza[\w-]{30,}$/.test(v)) { toast('金鑰格式不正確，應為 AIza 開頭'); return; }
      try { await set(ref(db, 'settings/gmapsKey'), v); $('drGKey').value = ''; toast('金鑰已儲存'); } catch (er) { toast('儲存失敗：' + er.message); }
    };
    $('drGKeyClear').onclick = async () => {
      if (!gmapsKey() || !confirm('確定清除 Google 金鑰？清除後自動計算公里將無法使用。')) return;
      try { await set(ref(db, 'settings/gmapsKey'), ''); toast('金鑰已清除'); } catch (er) { toast('清除失敗：' + er.message); }
    };
    $('drGNamesSave').onclick = async () => {
      const list = [...new Set($('drGNames').value.split(/[,，、\n]/).map(x => x.trim()).filter(Boolean))];
      if (!list.length) { toast('名單不能為空'); return; }
      try { await set(ref(db, 'settings/gformNames'), list); toast('名單已儲存'); } catch (er) { toast('儲存失敗：' + er.message); }
    };
  }
  const o = offices();
  tb.innerHTML = Object.entries(users).filter(([, u]) => u.role !== 'pending').map(([uid, u]) => `<tr>
    <td>${esc(u.name)}</td>
    <td><input class="dr-in" data-cname="${uid}" value="${esc(u.cname || '')}" placeholder="${esc(u.name)}"></td>
    <td><select class="dr-in" data-office-of="${uid}">${Object.entries(o).map(([k, x]) => `<option value="${k}" ${(u.office || 'tf') === k ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></td>
    <td><select class="dr-in" data-form-of="${uid}"><option value="">（不帶入）</option>${[...new Set([...gformNames(), ...(u.formName ? [u.formName] : [])])].map(n => `<option ${u.formName === n ? 'selected' : ''}>${n}</option>`).join('')}</select></td>
    <td><button class="btn btn-primary btn-sm" data-save-member="${uid}">儲存</button></td></tr>`).join('');
  if (!renderMembers.bound) {
    renderMembers.bound = true;
    tb.addEventListener('click', async e => {
      const b = e.target.closest('[data-save-member]'); if (!b) return;
      const uid = b.dataset.saveMember;
      const cname = tb.querySelector(`[data-cname="${uid}"]`).value.trim(), office = tb.querySelector(`[data-office-of="${uid}"]`).value;
      const formName = tb.querySelector(`[data-form-of="${uid}"]`).value;
      try { await update(ref(db, `users/${uid}`), { cname, office, formName }); toast('已儲存'); } catch (er) { toast('儲存失敗：' + er.message); }
    });
  }
}
