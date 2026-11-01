// J Family v2.6 — 月度統計核心（網頁與 24 小時 PC 共用，兩邊檔案內容須一致；PC 版檔名 stats-core.mjs）
// monthStats(D) → { team, users }
// D: { m:'YYYY-MM', today:'YYYY-MM-DD', reports:{id:report}（該月）, users, holidays, workdays, closures, leaves, tracking, master, offices, rate, remindFrom }
// 加班估算：單日超過 6 小時扣 1 小時午休；工作日超過 8 小時、非工作日（含停班）全部列為加班。依日報工作時間，不含交通時間。
// v2.6.1 里程緩衝：settings.mileBuf = { from: 生效日, th: 門檻 km, s: 未滿門檻加 km, l: 門檻以上加 km }
// 每段單程依距離加緩衝，同一人同一天合計後無條件進位到整數；生效日前或未設定時維持原公里數（小數一位）
export const bufCfg = mb => { const b = mb || {}; const n = (v, d) => (v === undefined || v === null || v === '' || isNaN(Number(v))) ? d : Number(v); return { from: b.from || '', th: n(b.th, 5), s: n(b.s, 2), l: n(b.l, 5) }; };
export function claimKm(legs, date, cfg) {
  const ks = (legs || []).map(x => parseFloat(x) || 0), raw = Math.round(ks.reduce((a, b) => a + b, 0) * 10) / 10;
  if (!cfg || !cfg.from || !date || date < cfg.from) return { raw, claim: raw, buf: 0, on: false };
  const buf = ks.reduce((a, k) => a + (k > 0 ? (k < cfg.th ? cfg.s : cfg.l) : 0), 0);
  return { raw, claim: Math.ceil(raw + buf - 1e-9), buf, on: true };
}
const legsOf = r => (r && r.drive && r.route && r.route.legs ? Object.values(r.route.legs) : []);
export function dayClaim(reps, date, cfg) { return claimKm(reps.flatMap(legsOf), date, cfg); }

export function monthStats(D) {
  const { m, users = {}, master = {} } = D;
  const holidays = D.holidays || {}, workdays = D.workdays || {}, closures = D.closures || {}, leaves = D.leaves || {}, tracking = D.tracking || {};
  const offices = D.offices || { tf: { name: '頭份辦公室' }, tn: { name: '南部辦公室' } };
  const rate = Number(D.rate) || 8;
  const pad = n => String(n).padStart(2, '0');
  const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (s0, n) => { const d = new Date(s0 + 'T00:00:00'); d.setDate(d.getDate() + n); return dstr(d); };
  const mStart = m + '-01', mEnd = dstr(new Date(+m.slice(0, 4), +m.slice(5, 7), 0));
  const today = D.today, upto = mEnd < today ? mEnd : today;              // 統計截止日（含）
  const lastFill = addDays(today, -1) < mEnd ? addDays(today, -1) : mEnd; // 未填判斷到昨天
  const isHoliday = s0 => !!(holidays[s0.slice(0, 4)] && holidays[s0.slice(0, 4)][s0]);
  const isWorkday = s0 => { if (workdays[s0.slice(0, 4)] && workdays[s0.slice(0, 4)][s0]) return true; const g = new Date(s0 + 'T00:00:00').getDay(); return g !== 0 && g !== 6 && !isHoliday(s0); };
  const userOffice = uid => (users[uid] && users[uid].office) || 'tf';
  const closureFor = (uid, s0) => { const c = closures[s0]; return c && (c.scope === 'all' || c.scope === userOffice(uid) || c.scope === 'uid:' + uid) ? c : null; };
  const isWorkdayFor = (uid, s0) => isWorkday(s0) && !closureFor(uid, s0);
  const leaveOf = (uid, s0) => Object.values(leaves).find(l => l.uid === uid && l.from <= s0 && s0 <= l.to);
  const tierOf = u => { const t = Number(u.tier); return t >= 1 && t <= 4 ? t : (u.role === 'admin' ? 4 : 1); };
  const needsReport = u => (u.role === 'admin' || u.role === 'eng') && ((u.report !== undefined && u.report !== null) ? !!u.report : tierOf(u) !== 2);
  const nm = (coll, id) => (master[coll] && master[coll][id] && master[coll][id].name) || '（已刪除）';
  const isOffice = r => r && r.kind === 'office';
  const custName = r => isOffice(r) ? '內勤' : nm('customers', r.cust);
  const siteLabel = r => isOffice(r) ? '內勤／' + ((offices[r.office] || offices.tf || {}).name || '辦公室') : `${nm('customers', r.cust)}／${nm('sites', r.site)}`;
  const hoursOf = r => { if (!r.start || !r.end) return 0; const a = +r.start.slice(0, 2) * 60 + +r.start.slice(3), b = +r.end.slice(0, 2) * 60 + +r.end.slice(3) + (r.overnight ? 1440 : 0); return Math.max(0, (b - a) / 60); };
  const cfg = bufCfg(D.mileBuf);
  const r1 = n => Math.round(n * 10) / 10;
  const reps = Object.values(D.reports || {}).filter(r => r && r.date && r.date >= mStart && r.date <= upto);

  // ── 個人 ──
  const out = {};
  Object.entries(users).filter(([, u]) => needsReport(u)).forEach(([uid, u]) => {
    const byDay = {};
    reps.filter(r => r.uid === uid).forEach(r => {
      const o = byDay[r.date] = byDay[r.date] || { h: 0, ovn: false, field: false, cust: {} };
      o.h += hoursOf(r); if (r.overnight) o.ovn = true; if (!isOffice(r)) { o.field = true; o.cust[r.cust] = 1; }
    });
    const days = Object.keys(byDay).sort();
    let streak = 0, best = 0, prev = null, ot = 0, hours = 0;
    days.forEach(d => { streak = prev && addDays(prev, 1) === d ? streak + 1 : 1; best = Math.max(best, streak); prev = d;
      const h = byDay[d].h, w = h - (h > 6 ? 1 : 0); hours += w; ot += isWorkdayFor(uid, d) ? Math.max(0, w - 8) : w; });
    // 目前連續（到截止日為止）
    let cur = 0; for (let d = upto; byDay[d]; d = addDays(d, -1)) cur++;
    let st = mStart; if (D.remindFrom && D.remindFrom > st) st = D.remindFrom; if (u.createdAt && u.createdAt > st) st = u.createdAt;
    const unfilled = [], expect = [];
    for (let d = mStart; d <= mEnd; d = addDays(d, 1)) {
      if (!isWorkdayFor(uid, d) || leaveOf(uid, d)) continue;
      if (d >= st) expect.push(d);
      if (d >= st && d <= lastFill && !byDay[d]) unfilled.push(d);
    }
    const elapsed = expect.filter(d => d <= upto).length;
    out[uid] = {
      name: u.name || '', days: days.length, field: days.filter(d => byDay[d].field).length, hours: r1(hours), ot: r1(ot),
      long: days.filter(d => byDay[d].h > 12), streak: best, curStreak: cur, ovn: days.filter(d => byDay[d].ovn).length,
      hol: days.filter(d => !isWorkdayFor(uid, d)).length, cust: new Set(days.flatMap(d => Object.keys(byDay[d].cust))).size,
      unfilled, workdays: expect.length, elapsed, otProj: elapsed ? r1(ot / elapsed * expect.length) : 0,
      daily: Object.fromEntries(days.map(d => [d.slice(8), r1(byDay[d].h)])),
    };
  });

  // ── 團隊 ──
  const pdSet = new Set(reps.map(r => r.uid + '|' + r.date)), offSet = new Set(reps.filter(isOffice).map(r => r.uid + '|' + r.date));
  const dayGroups = {}; reps.filter(r => r.drive).forEach(r => { (dayGroups[r.uid + '|' + r.date] = dayGroups[r.uid + '|' + r.date] || []).push(r); });
  let km = 0, rawKm = 0; Object.entries(dayGroups).forEach(([k, rs]) => { const c = dayClaim(rs, k.split('|')[1], cfg); km += c.claim; rawKm += c.raw; });
  const exp = reps.reduce((a, r) => a + Object.values(r.exps || {}).reduce((b, x) => b + (parseFloat(x && x.amt) || 0), 0), 0);
  const cust = {}; reps.forEach(r => { const k = custName(r); (cust[k] = cust[k] || new Set()).add(r.uid + '|' + r.date); });
  const perSite = {};
  reps.filter(r => !isOffice(r) && r.site).forEach(r => {
    const k = siteLabel(r), o = perSite[k] = perSite[k] || { visits: 0, pd: new Set(), who: {}, hours: 0 };
    o.visits++; o.pd.add(r.uid + '|' + r.date); o.who[(users[r.uid] && users[r.uid].name) || '（未知成員）'] = 1; o.hours += hoursOf(r);
  });
  const trs = Object.values(tracking).filter(t => t && t.date);
  const openAt = t => t.date <= upto && (!t.closedAt || t.closedAt.slice(0, 10) > upto);
  const trk = { newN: 0, closedN: 0, openEnd: 0, overEnd: 0 };
  trs.forEach(t => {
    const k = t.kind === 'office' || !t.site ? null : `${nm('customers', t.cust)}／${nm('sites', t.site)}`;
    const isNew = t.date >= mStart && t.date <= upto, isCl = t.closedAt && t.closedAt.slice(0, 10) >= mStart && t.closedAt.slice(0, 10) <= upto;
    const op = openAt(t), ov = op && t.due && t.due < upto;
    if (isNew) trk.newN++; if (isCl) trk.closedN++; if (op) trk.openEnd++; if (ov) trk.overEnd++;
    if (k && (isNew || isCl || op)) { const o = perSite[k] = perSite[k] || { visits: 0, pd: new Set(), who: {}, hours: 0 };
      o.tNew = (o.tNew || 0) + (isNew ? 1 : 0); o.tCl = (o.tCl || 0) + (isCl ? 1 : 0); o.tOpen = (o.tOpen || 0) + (op ? 1 : 0); o.tOver = (o.tOver || 0) + (ov ? 1 : 0); }
  });
  const sites = {};
  Object.entries(perSite).forEach(([k, o]) => { sites[k.replace(/[.#$/\[\]]/g, '_')] = { label: k, visits: o.visits, pd: o.pd.size, who: Object.keys(o.who), hours: r1(o.hours), tNew: o.tNew || 0, tCl: o.tCl || 0, tOpen: o.tOpen || 0, tOver: o.tOver || 0 }; });
  const team = {
    m, upto, pd: pdSet.size, field: pdSet.size - offSet.size, office: offSet.size, visits: reps.filter(r => !isOffice(r)).length,
    siteN: Object.values(sites).filter(s => s.visits).length, km: r1(km), rawKm: r1(rawKm), fuel: Math.round(r1(km) * rate), exp: Math.round(exp),
    cust: Object.entries(cust).map(([name, s]) => ({ name, pd: s.size })).sort((a, b) => b.pd - a.pd),
    trk, sites, reporters: Object.keys(out).length, ot: r1(Object.values(out).reduce((a, x) => a + x.ot, 0)),
  };
  return { team, users: out };
}
