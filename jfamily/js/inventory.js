import { db } from './config.js';
import { ref, set, push, remove, update } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

let editingInvId = null;

export function renderInventory(currentUser, inventory) {
  if (!currentUser) return;
  const isAdmin = currentUser.role === 'admin';
  document.getElementById('invGrid').innerHTML = Object.entries(inventory).length === 0
    ? '<div class="empty-state" style="grid-column:1/-1"><div class="icon">📦</div>尚無物料</div>'
    : Object.entries(inventory).map(([id, i]) => {
        const pct = Math.min(100, Math.round(i.qty / i.max * 100));
        const low = i.qty < i.min;
        const barColor = low ? 'var(--accent2)' : i.qty < i.max * .5 ? 'var(--accent)' : 'var(--accent3)';
        return `<div class="inv-item">
          <div class="inv-item-name">${i.name}</div>
          <div class="inv-item-meta">${i.cat}</div>
          <div class="inv-bar-wrap"><div class="inv-bar" style="width:${pct}%;background:${barColor}"></div></div>
          <div class="inv-count">
            <span class="${low ? 'low' : 'ok'}">${low ? '⚠ 庫存不足' : '庫存正常'}</span>
            <span>${i.qty}/${i.max}</span>
          </div>
          ${isAdmin ? `<div class="inv-actions">
            <button class="inv-btn" onclick="window.adjustInv('${id}',-1)">－1</button>
            <button class="inv-btn" onclick="window.adjustInv('${id}',1)">＋1</button>
            <button class="inv-btn" onclick="window.editInv('${id}')">編輯</button>
            <button class="inv-btn del" onclick="window.deleteInv('${id}')">刪除</button>
          </div>` : ''}
        </div>`;
      }).join('');
}

export async function adjustInv(id, delta, inventory) {
  const i = inventory[id];
  if (i) await update(ref(db, `inventory/${id}`), { qty: Math.max(0, i.qty + delta) });
}

export function editInv(id, inventory) {
  editingInvId = id;
  const i = inventory[id];
  document.getElementById('invModalTitle').textContent = '編輯物料';
  document.getElementById('invSaveBtn').textContent = '儲存';
  document.getElementById('i-name').value = i.name;
  document.getElementById('i-cat').value = i.cat;
  document.getElementById('i-qty').value = i.qty;
  document.getElementById('i-min').value = i.min;
  document.getElementById('i-max').value = i.max;
  document.getElementById('invModal').classList.add('open');
}

export async function deleteInv(id) {
  if (confirm('確定刪除？')) await remove(ref(db, `inventory/${id}`));
}

export function openInvModal() {
  editingInvId = null;
  document.getElementById('invModalTitle').textContent = '新增物料';
  document.getElementById('invSaveBtn').textContent = '新增';
  document.getElementById('i-name').value = '';
  document.getElementById('i-qty').value = '0';
  document.getElementById('i-min').value = '5';
  document.getElementById('i-max').value = '50';
  document.getElementById('invModal').classList.add('open');
}

export async function saveInv() {
  const name = document.getElementById('i-name').value.trim();
  if (!name) return;
  const data = {
    name, cat: document.getElementById('i-cat').value,
    qty: parseInt(document.getElementById('i-qty').value) || 0,
    min: parseInt(document.getElementById('i-min').value) || 5,
    max: parseInt(document.getElementById('i-max').value) || 50,
  };
  if (editingInvId) await update(ref(db, `inventory/${editingInvId}`), data);
  else await set(push(ref(db, 'inventory')), data);
  document.getElementById('invModal').classList.remove('open');
}
