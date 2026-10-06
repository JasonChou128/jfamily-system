// J Family 工作週報產生器（網頁與 24 小時 PC 共用，兩邊檔案內容須一致）
// buildWeekly(ExcelJS, D) → { wb, summary }
// D: { ws, today, all(reports), tracking, master, users, leaves, closures, holidays, workdays, srLog, offices }
export function buildWeekly(ExcelJS, D) {
  const { ws, all, tracking, master, users, srLog } = D;
  const leaves = D.leaves || {}, closures = D.closures || {}, holidays = D.holidays || {}, workdays = D.workdays || {};
  const offices = D.offices || { tf: { name: '頭份辦公室' }, tn: { name: '南部辦公室' } };
  const pad = n => String(n).padStart(2, '0');
  const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (s0, n) => { const d = new Date(s0 + 'T00:00:00'); d.setDate(d.getDate() + n); return dstr(d); };
  const today = () => D.today;
  const we = addDays(ws, 6);
  const WD = ['日', '一', '二', '三', '四', '五', '六'];
  const wdOf = s0 => WD[new Date(s0 + 'T00:00:00').getDay()];
  const md = d0 => `${+d0.slice(5, 7)}/${+d0.slice(8, 10)}`;
  const isHoliday = s0 => !!(holidays[s0.slice(0, 4)] && holidays[s0.slice(0, 4)][s0]);
  const isWorkday = s0 => { if (workdays[s0.slice(0, 4)] && workdays[s0.slice(0, 4)][s0]) return true; const g = new Date(s0 + 'T00:00:00').getDay(); return g !== 0 && g !== 6 && !isHoliday(s0); };
  const userName = uid => (users[uid] && users[uid].name) || '（未知成員）';
  const userOffice = uid => (users[uid] && users[uid].office) || 'tf';
  const leaveOf = (uid, s0) => Object.values(leaves).find(l => l.uid === uid && l.from <= s0 && s0 <= l.to);
  const closureFor = (uid, s0) => { const c = closures[s0]; return c && (c.scope === 'all' || c.scope === userOffice(uid) || c.scope === 'uid:' + uid) ? c : null; };
  const members = () => Object.entries(users).filter(([, u]) => u.role === 'admin' || u.role === 'eng');
  const nm = (coll, id) => (master[coll] && master[coll][id] && master[coll][id].name) || '（已刪除）';
  const isOfficeR = r => r && r.kind === 'office';
  const custName = r => isOfficeR(r) ? '內勤' : nm('customers', r.cust);
  const siteName = r => isOfficeR(r) ? ((offices[r.office] || offices.tf).name) : nm('sites', r.site);
  const notesOf = t => Object.values(t.notes || {}).sort((a, b) => a.date.localeCompare(b.date) || (a.at || '').localeCompare(b.at || ''));
  const arr = x => Array.isArray(x) ? x : Object.values(x || {});
  const reps = Object.entries(all).flatMap(([m, rs]) => Object.entries(rs || {}).map(([id, r]) => ({ ...r, items: arr(r.items), _key: `${m}|${id}` })));
  const wk = reps.filter(r => r.date >= ws && r.date <= we);
  const F = { name: '等線', size: 11 }, thin = { style: 'thin' }, box = { top: thin, bottom: thin, left: thin, right: thin };
  const solid = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  const HF = solid('FFDDEBF7'), RED = solid('FFFCE4D6'), YEL = solid('FFFFF2CC'), GRN = solid('FFE2EFDA'), OFF = solid('FFEDEDED'), LV = solid('FFDDEBF7'), NAVY = solid('FF1F3864');
  const PS = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 }, printTitlesRow: '1:1' };
  const header = (sh, labels) => { const r = sh.getRow(1); labels.forEach((h, i) => Object.assign(r.getCell(i + 1), { value: h, font: { ...F, bold: true }, fill: HF, border: box, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true } })); r.height = 22; };
  const cell = (c, v, o = {}) => { Object.assign(c, { value: v, font: { ...F, ...(o.font || {}) }, border: box, alignment: { vertical: o.v || 'middle', horizontal: o.h || 'left', wrapText: true } }); if (o.fill) c.fill = o.fill; if (o.fmt) c.numFmt = o.fmt; return c; };
  const lines = s0 => String(s0 || '').split('\n').length;
  const siteLabel = sid => { const s0 = master.sites[sid] || {}; return `${nm('customers', s0.cust)} ${s0.name || '（已刪除）'}`; };
  const dSince = (a, b) => Math.max(0, Math.floor((new Date(b) - new Date(a)) / 86400000));
  const wb = new ExcelJS.Workbook();

  // ── 1. 案場週況 ──
  const s1 = wb.addWorksheet('案場週況', { views: [{ state: 'frozen', ySplit: 1 }], pageSetup: PS });
  [8, 22, 12, 16, 46, 52, 14, 18].forEach((w, i) => { s1.getColumn(i + 1).width = w; });
  header(s1, ['燈號', '客戶名稱', '聯絡人', '本週到場', '本週處理摘要', '未結案事項與最新進度', 'Owner', 'DOC']);
  const openAt = t => t.date <= we && (!t.closedAt || t.closedAt.slice(0, 10) > we);
  const closedIn = t => t.closedAt && t.closedAt.slice(0, 10) >= ws && t.closedAt.slice(0, 10) <= we;
  const trs = Object.values(tracking).filter(t => t.kind !== 'office' && t.site);
  const sites = [...new Set([...wk.filter(r => !isOfficeR(r) && r.site).map(r => r.site), ...trs.filter(openAt).map(t => t.site)])];
  const rows = sites.map(sid => {
    const rs = wk.filter(r => !isOfficeR(r) && r.site === sid).sort((a, b) => a.date.localeCompare(b.date) || (a.start || '').localeCompare(b.start || ''));
    const op = trs.filter(t => t.site === sid && openAt(t)).sort((a, b) => a.date.localeCompare(b.date));
    const cl = trs.filter(t => t.site === sid && closedIn(t));
    const over = op.some(t => t.due && t.due < we);
    const light = over ? 'red' : op.length ? 'yellow' : 'green';
    const dates = [...new Set(rs.map(r => r.date))];
    const summary = dates.map(d => `${md(d)} ${[...new Set(rs.filter(r => r.date === d).flatMap(r => r.items || []))].join('、')}`).join('\n') || '—';
    const prog = [
      ...op.map(t => {
        const last = notesOf(t).filter(n => n.date <= we).pop();
        return `${t.due && t.due < we ? '【逾期】' : ''}${t.text}（${dSince(t.date, we)} 天）${last ? `\n　${md(last.date)} ${last.text}` : ''}`;
      }),
      ...cl.map(t => `本週結案：${t.text}`),
    ].join('\n') || '—';
    const owners = [...new Set((rs.length ? rs.map(r => r.uid) : op.map(t => t.uid)).map(userName))].join('\n');
    const docs = Object.entries(srLog).filter(([, x]) => x.site === sid && x.issue >= ws && x.issue <= we).map(([k]) => k).join('\n');
    const pd = new Set(rs.map(r => r.uid + '|' + r.date)).size;
    return { sid, light, maxDays: op.length ? dSince(op[0].date, we) : -1, vals: [siteLabel(sid), (master.sites[sid] || {}).lastContact || '—', rs.length ? `${rs.length} 次・${pd} 人天` : '本週未到場', summary, prog, owners || '—', docs] };
  }).sort((a, b) => ({ red: 0, yellow: 1, green: 2 }[a.light] - { red: 0, yellow: 1, green: 2 }[b.light]) || b.maxDays - a.maxDays);
  const LC = { red: 'FFC0392B', yellow: 'FFB7791F', green: 'FF1E7B4C' }, LF = { red: RED, yellow: YEL, green: GRN };
  rows.forEach((x, i) => {
    const r = s1.getRow(i + 2);
    cell(r.getCell(1), '●', { h: 'center', fill: LF[x.light], font: { size: 14, bold: true, color: { argb: LC[x.light] } } });
    x.vals.forEach((v, k) => cell(r.getCell(k + 2), v, { h: [0, 1, 2, 5, 6].includes(k) ? 'center' : 'left' }));
    r.height = Math.max(24, 16 * Math.max(lines(x.vals[3]), lines(x.vals[4]), lines(x.vals[5])) + 6);
  });
  let fr = rows.length + 3;
  if (!rows.length) cell(s1.getRow(2).getCell(2), '本週沒有案場動態');
  s1.getCell(`A${fr}`).value = '燈號說明'; s1.getCell(`A${fr}`).font = { ...F, size: 10, bold: true };
  s1.getCell(`B${fr}`).value = '紅：有逾期事項　黃：有未結案事項　綠：無未結案（含本週結案）'; s1.getCell(`B${fr}`).font = { ...F, size: 10 };
  s1.getCell(`B${fr + 1}`).value = `列入條件：本週有到場，或仍有未結案事項的案場。期間 ${ws.replace(/-/g, '/')}～${we.slice(5).replace('-', '/')}。`;
  s1.getCell(`B${fr + 1}`).font = { ...F, size: 10, color: { argb: 'FF666666' } };

  // ── 2. 行程（出勤表） ──
  const s2 = wb.addWorksheet('行程', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }], pageSetup: PS });
  const mem = members().sort((a, b) => (a[1].name || '').localeCompare(b[1].name || '', 'zh-Hant'));
  s2.getColumn(1).width = 14; mem.forEach((_, i) => { s2.getColumn(i + 2).width = 20; });
  header(s2, ['日期', ...mem.map(([, u]) => u.name)]);
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i), work = isWorkday(d), hol = isHoliday(d) ? holidays[d.slice(0, 4)][d] : '';
    const r = s2.getRow(i + 2); let mx = 1;
    cell(r.getCell(1), `${md(d)}（${wdOf(d)}）${hol ? '\n' + hol : ''}`, { h: 'center', font: { bold: true }, fill: work ? undefined : OFF });
    mem.forEach(([uid], k) => {
      const rs = wk.filter(x => x.uid === uid && x.date === d).sort((a, b) => (a.start || '').localeCompare(b.start || ''));
      const lv = leaveOf(uid, d), cl = closureFor(uid, d);
      let txt = '', fill, font;
      if (rs.length) { txt = rs.map(x => `${isOfficeR(x) ? '內勤' : siteLabel(x.site)}\n${x.start}~${x.end}${x.overnight ? '（隔日）' : ''}${!work ? '（加班）' : ''}`).join('\n'); fill = rs.every(isOfficeR) ? YEL : undefined; }
      else if (lv && work) { txt = `休假${lv.note ? '（' + lv.note + '）' : ''}`; fill = LV; }
      else if (cl && work) { txt = `公司停班（${cl.name}）`; fill = LV; }
      else if (!work) fill = OFF;
      else if (d < today()) { txt = '未填'; fill = RED; font = { bold: true, color: { argb: 'FFC0392B' } }; }
      cell(r.getCell(k + 2), txt, { h: 'center', fill, font });
      mx = Math.max(mx, lines(txt));
    });
    r.height = Math.max(34, 15 * mx + 6);
  }
  const lg = s2.getRow(11); cell(lg.getCell(1), '圖例', { font: { size: 10, bold: true } });
  [['外勤'], ['內勤', YEL], ['休假／停班', LV], ['未填', RED], ['週末／假日', OFF]].forEach(([t, f], k) => { if (k + 2 <= mem.length + 1 || k < 5) cell(lg.getCell(k + 2), t, { h: 'center', fill: f, font: { size: 10 } }); });

  // ── 3. 案場履歷（累積） ──
  const s3 = wb.addWorksheet('案場履歷', { pageSetup: { ...PS, orientation: 'portrait', printTitlesRow: undefined } });
  [12, 16, 58, 30].forEach((w, i) => { s3.getColumn(i + 1).width = w; });
  const hist = reps.filter(r => !isOfficeR(r) && r.site && r.date <= we);
  const histSites = [...new Set(hist.map(r => r.site))].map(sid => ({ sid, last: hist.filter(r => r.site === sid).reduce((a, r) => r.date > a ? r.date : a, '') })).sort((a, b) => b.last.localeCompare(a.last));
  let rr = 1;
  cell(s3.getCell(`A${rr}`), `累積所有曾有服務紀錄的案場，依最近到場日排序（截至 ${we.replace(/-/g, '/')}）`, { font: { size: 10, color: { argb: 'FF666666' } } }).border = {};
  rr = 3;
  histSites.forEach(({ sid }) => {
    const s0 = master.sites[sid] || {};
    s3.mergeCells(rr, 1, rr, 4);
    cell(s3.getCell(rr, 1), siteLabel(sid), { fill: NAVY, font: { size: 13, bold: true, color: { argb: 'FFFFFFFF' } } }); s3.getRow(rr).height = 24; rr++;
    [['地址', s0.addr || '—'], ['產品', s0.prod ? nm('products', s0.prod) : '—'], ['聯絡人', s0.lastContact || '—']].forEach(([k, v]) => {
      cell(s3.getCell(rr, 1), k, { fill: HF, font: { size: 10, bold: true } });
      s3.mergeCells(rr, 2, rr, 4); cell(s3.getCell(rr, 2), v, { font: { size: 10 } }); rr++;
    });
    ['日期', '人員', '處理事項', '待追蹤／文件'].forEach((h, i) => cell(s3.getCell(rr, i + 1), h, { h: 'center', fill: HF, font: { size: 10, bold: true } })); rr++;
    hist.filter(r => r.site === sid).sort((a, b) => b.date.localeCompare(a.date) || (b.start || '').localeCompare(a.start || '')).forEach(r => {
      const [m0, id0] = r._key.split('|');
      const tk = Object.values(tracking).filter(t => t.rid === id0).map(t => `${t.text}（${t.closedAt && t.closedAt.slice(0, 10) <= we ? '結案' : '未結案'}）`);
      const docs = Object.entries(srLog).filter(([, x]) => (x.reps || []).includes(r._key)).map(([k]) => k);
      const items = (r.items || []).map((x, i) => `${i + 1}. ${x}`).join('\n') || '—';
      const extra = [...tk, ...docs].join('\n');
      cell(s3.getCell(rr, 1), md(r.date), { h: 'center', v: 'top', font: { size: 10 } });
      cell(s3.getCell(rr, 2), userName(r.uid), { h: 'center', v: 'top', font: { size: 10 } });
      cell(s3.getCell(rr, 3), items, { v: 'top', font: { size: 10 } });
      cell(s3.getCell(rr, 4), extra, { v: 'top', font: { size: 10 } });
      s3.getRow(rr).height = Math.max(18, 15 * Math.max(lines(items), lines(extra)) + 4); rr++;
    });
    rr++;
  });
  if (!histSites.length) cell(s3.getCell('A3'), '尚無服務紀錄');

  const summary = { red: rows.filter(x => x.light === 'red').map(x => x.vals[0]), yellow: rows.filter(x => x.light === 'yellow').map(x => x.vals[0]), green: rows.filter(x => x.light === 'green').length, sites: rows.length, we, missing: [] };
  for (let i = 0; i < 7; i++) { const d = addDays(ws, i); if (!isWorkday(d) || d >= today()) continue; members().forEach(([uid, u]) => { if (!wk.some(x => x.uid === uid && x.date === d) && !leaveOf(uid, d) && !closureFor(uid, d)) summary.missing.push(`${u.name} ${md(d)}`); }); }
  return { wb, summary };
}
