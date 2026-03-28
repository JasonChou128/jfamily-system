import { db, today } from './config.js';
import { ref, set, get, push, update } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

export let currentUser = null;

// ── REMEMBER ME / STAY LOGGED IN ──
const SESSION_KEY = 'jfamily_session';
const REMEMBER_KEY = 'jfamily_remember';

export function loadSavedSession() {
  const session = localStorage.getItem(SESSION_KEY);
  if (session) {
    try { return JSON.parse(session); } catch { return null; }
  }
  return null;
}

function saveSession(user, stayLoggedIn) {
  if (stayLoggedIn) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  } else {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
  }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
}

export function loadRemembered() {
  const saved = localStorage.getItem(REMEMBER_KEY);
  if (saved) {
    try {
      const { email, pass } = JSON.parse(saved);
      document.getElementById('loginEmail').value = email || '';
      document.getElementById('loginPass').value = pass || '';
      document.getElementById('rememberMe').checked = true;
    } catch {}
  }
}

// ── LOGIN TAB ──
export function switchLoginTab(tab) {
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-register').classList.toggle('active', tab === 'register');
  document.getElementById('loginForm').style.display = tab === 'login' ? '' : 'none';
  document.getElementById('registerForm').style.display = tab === 'register' ? '' : 'none';
  document.getElementById('loginError').textContent = '';
  document.getElementById('loginSuccess').textContent = '';
}

// ── LOGIN ──
export async function doLogin(onSuccess) {
  const email = document.getElementById('loginEmail').value.trim().toLowerCase();
  const pass = document.getElementById('loginPass').value;
  const rememberMe = document.getElementById('rememberMe').checked;
  const stayLoggedIn = document.getElementById('stayLoggedIn').checked;

  if (!email || !pass) { setError('請輸入Email和密碼'); return; }

  try {
    const snap = await get(ref(db, 'users'));
    const allUsers = snap.val() || {};
    const entry = Object.entries(allUsers).find(([, u]) => u.email === email && u.pass === pass);
    if (!entry) { setError('Email或密碼錯誤'); return; }

    const [uid, userData] = entry;
    currentUser = { uid, email, ...userData };

    if (rememberMe) {
      localStorage.setItem(REMEMBER_KEY, JSON.stringify({ email, pass }));
    } else {
      localStorage.removeItem(REMEMBER_KEY);
    }

    saveSession(currentUser, stayLoggedIn);
    onSuccess(currentUser);
  } catch (e) { setError('登入失敗：' + e.message); }
}

// ── REGISTER ──
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
    const snap = await get(ref(db, 'users'));
    const allUsers = snap.val() || {};
    if (Object.values(allUsers).some(u => u.email === email)) { setError('此Email已被使用'); return; }
    await set(push(ref(db, 'users')), { name, email, pass, role: 'eng', createdAt: today() });
    setSuccess('帳戶建立成功！請登入');
    switchLoginTab('login');
    document.getElementById('loginEmail').value = email;
  } catch (e) { setError('註冊失敗：' + e.message); }
}

// ── LOGOUT ──
export function doLogout() {
  currentUser = null;
  clearSession();
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  document.getElementById('fab').style.display = 'none';
  document.getElementById('loginError').textContent = '';
}

// ── PROFILE MODAL ──
export function openProfile() {
  if (!currentUser) return;
  document.getElementById('profileName').value = currentUser.name || '';
  document.getElementById('profileEmail').value = currentUser.email || '';
  document.getElementById('profilePass').value = '';
  document.getElementById('profilePass2').value = '';
  document.getElementById('profileError').textContent = '';
  document.getElementById('profileSuccess').textContent = '';
  document.getElementById('profileModal').classList.add('open');
}

export async function saveProfile() {
  const name = document.getElementById('profileName').value.trim();
  const email = document.getElementById('profileEmail').value.trim().toLowerCase();
  const pass = document.getElementById('profilePass').value;
  const pass2 = document.getElementById('profilePass2').value;
  document.getElementById('profileError').textContent = '';

  if (!name || !email) { document.getElementById('profileError').textContent = '姓名和Email不能為空'; return; }
  if (pass && pass.length < 6) { document.getElementById('profileError').textContent = '密碼至少6個字元'; return; }
  if (pass && pass !== pass2) { document.getElementById('profileError').textContent = '兩次密碼不一致'; return; }

  try {
    const updates = { name, email };
    if (pass) updates.pass = pass;
    await update(ref(db, `users/${currentUser.uid}`), updates);
    currentUser = { ...currentUser, ...updates };
    saveSession(currentUser, !!localStorage.getItem(SESSION_KEY));
    document.getElementById('topUsername').textContent = name;
    document.getElementById('profileSuccess').textContent = '資料更新成功！';
  } catch (e) { document.getElementById('profileError').textContent = '更新失敗：' + e.message; }
}

// ── SEED ADMIN ──
export async function seedAdmin() {
  const snap = await get(ref(db, 'users'));
  const allUsers = snap.val() || {};
  if (!Object.values(allUsers).some(u => u.role === 'admin')) {
    await set(push(ref(db, 'users')), {
      name: 'Jason (Boss)', email: 'jason@jfamily.com',
      pass: 'boss123', role: 'admin', createdAt: today()
    });
  }
}

function setError(msg) { document.getElementById('loginError').textContent = msg; }
function setSuccess(msg) { document.getElementById('loginSuccess').textContent = msg; }
