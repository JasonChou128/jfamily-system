// J Family v1.6 — 登入改用 Firebase Authentication
// 變更：密碼不再存放於資料庫；角色一律由伺服器讀取；新註冊帳號需管理員核准
import { db, auth, today } from './config.js';
import { ref, set, get, update } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import {
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged,
  setPersistence, browserLocalPersistence, browserSessionPersistence,
  EmailAuthProvider, reauthenticateWithCredential, updatePassword
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

export let currentUser = null;

// 只記住 Email，不再記住密碼
const REMEMBER_KEY = 'jfamily_remember_email';

export function loadRemembered() {
  try {
    // 清除舊版以明文存放的帳密與登入狀態
    localStorage.removeItem('jfamily_remember');
    localStorage.removeItem('jfamily_session');
    sessionStorage.removeItem('jfamily_session');
    const email = localStorage.getItem(REMEMBER_KEY);
    if (email) {
      document.getElementById('loginEmail').value = email;
      document.getElementById('rememberMe').checked = true;
    }
  } catch {}
}

// ── 登入狀態監聽 ──
export function watchAuth(onIn, onOut) {
  onAuthStateChanged(auth, async fbUser => {
    if (!fbUser) { currentUser = null; onOut(); return; }
    try {
      const snap = await get(ref(db, `users/${fbUser.uid}`));
      const data = snap.val();
      if (!data || data.role === 'pending') {
        await signOut(auth);
        setSuccess('');
        setError('帳號尚待管理員核准，核准後即可登入');
        return;
      }
      currentUser = { uid: fbUser.uid, ...data, email: fbUser.email };
      onIn(currentUser);
    } catch (e) {
      await signOut(auth);
      setError('讀取帳號資料失敗：' + msg(e));
    }
  });
}

// ── LOGIN TAB ──
export function switchLoginTab(tab) {
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-register').classList.toggle('active', tab === 'register');
  document.getElementById('loginForm').style.display = tab === 'login' ? '' : 'none';
  document.getElementById('registerForm').style.display = tab === 'register' ? '' : 'none';
  setError(''); setSuccess('');
}

// ── LOGIN ──
export async function doLogin() {
  const email = document.getElementById('loginEmail').value.trim().toLowerCase();
  const pass = document.getElementById('loginPass').value;
  const rememberMe = document.getElementById('rememberMe').checked;
  const stayLoggedIn = document.getElementById('stayLoggedIn').checked;
  setError('');
  if (!email || !pass) { setError('請輸入Email和密碼'); return; }
  try {
    await setPersistence(auth, stayLoggedIn ? browserLocalPersistence : browserSessionPersistence);
    if (rememberMe) localStorage.setItem(REMEMBER_KEY, email);
    else localStorage.removeItem(REMEMBER_KEY);
    await signInWithEmailAndPassword(auth, email, pass);
    document.getElementById('loginPass').value = '';
    // 後續由 watchAuth 接手
  } catch (e) { setError(msg(e)); }
}

// ── REGISTER（建立後待管理員核准）──
export async function doRegister() {
  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim().toLowerCase();
  const pass = document.getElementById('regPass').value;
  const pass2 = document.getElementById('regPass2').value;
  setError(''); setSuccess('');
  if (!name || !email || !pass) { setError('請填寫所有欄位'); return; }
  if (pass.length < 6) { setError('密碼至少6個字元'); return; }
  if (pass !== pass2) { setError('兩次密碼不一致'); return; }
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await set(ref(db, `users/${cred.user.uid}`), { name, email, role: 'pending', createdAt: today() });
    await signOut(auth);
    switchLoginTab('login');
    document.getElementById('loginEmail').value = email;
    setSuccess('帳戶已建立，待管理員核准後即可登入');
  } catch (e) { setError('註冊失敗：' + msg(e)); }
}

// ── LOGOUT ──
export async function doLogout() {
  try { await signOut(auth); } catch {}
  // 重新載入以停止所有資料監聽
  location.reload();
}

// ── PROFILE MODAL ──
export function openProfile(user) {
  if (!user) return;
  document.getElementById('profileName').value = user.name || '';
  document.getElementById('profileEmail').value = user.email || '';
  ['profileCurPass', 'profilePass', 'profilePass2'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('profileError').textContent = '';
  document.getElementById('profileSuccess').textContent = '';
  document.getElementById('profileModal').classList.add('open');
}

export async function saveProfile(user, onSuccess) {
  const name = document.getElementById('profileName').value.trim();
  const cur = document.getElementById('profileCurPass').value;
  const pass = document.getElementById('profilePass').value;
  const pass2 = document.getElementById('profilePass2').value;
  const err = t => { document.getElementById('profileError').textContent = t; };
  err('');
  if (!name) { err('姓名不能為空'); return; }
  if (pass && pass.length < 6) { err('密碼至少6個字元'); return; }
  if (pass && pass !== pass2) { err('兩次密碼不一致'); return; }
  if (pass && !cur) { err('修改密碼需輸入目前密碼'); return; }
  try {
    if (pass) {
      const cred = EmailAuthProvider.credential(auth.currentUser.email, cur);
      await reauthenticateWithCredential(auth.currentUser, cred);
      await updatePassword(auth.currentUser, pass);
    }
    await update(ref(db, `users/${user.uid}`), { name });
    const updated = { ...user, name };
    document.getElementById('topUsername').textContent = name;
    document.getElementById('profileSuccess').textContent = pass ? '資料與密碼已更新' : '資料更新成功！';
    if (onSuccess) onSuccess(updated);
  } catch (e) { err('更新失敗：' + msg(e)); }
}

// ── 錯誤訊息中文化 ──
function msg(e) {
  const map = {
    'auth/invalid-credential': 'Email或密碼錯誤',
    'auth/wrong-password': 'Email或密碼錯誤',
    'auth/user-not-found': 'Email或密碼錯誤',
    'auth/invalid-email': 'Email格式不正確',
    'auth/email-already-in-use': '此Email已被使用',
    'auth/weak-password': '密碼至少6個字元',
    'auth/too-many-requests': '嘗試次數過多，請稍後再試',
    'auth/network-request-failed': '網路連線失敗',
    'auth/requires-recent-login': '請重新登入後再修改密碼',
  };
  return map[e && e.code] || (e && e.message) || '未知錯誤';
}

function setError(m) { const el = document.getElementById('loginError'); if (el) el.textContent = m; }
function setSuccess(m) { const el = document.getElementById('loginSuccess'); if (el) el.textContent = m; }
