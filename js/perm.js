// J Family v2.5 — 權限分級
// 等級：1 工程師、2 助理、3 副管理、4 主管；附加權限：inv 庫存管理、report 要填日報
// 舊資料沒有 tier 時：role 'admin' 視為 4、'eng' 視為 1
export const TIERS = { 1: '工程師', 2: '助理', 3: '副管理', 4: '主管' };
export const tierOf = u => {
  if (!u || (u.role !== 'admin' && u.role !== 'eng')) return 0;
  const t = Number(u.tier);
  return t >= 1 && t <= 4 ? t : (u.role === 'admin' ? 4 : 1);
};
// 助理預設不填日報；其他等級預設要填。可個別勾選覆蓋
export const needsReport = u => tierOf(u) > 0 && (u.report !== undefined && u.report !== null ? !!u.report : tierOf(u) !== 2);
export const canViewAll = u => tierOf(u) >= 2;   // 看全員資料、匯出、日報管理（請假、停班）
export const canMaster = u => tierOf(u) >= 3;    // 客戶／案場／產品主檔
export const isBoss = u => tierOf(u) >= 4;       // 成員設定、系統設定、帳號、人力負荷
export const canInv = u => isBoss(u) || !!(u && u.inv);
