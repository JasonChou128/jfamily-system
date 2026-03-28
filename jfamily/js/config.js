import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCpl7kS9SJ3T14YtFReL0woTnie2Bsc_uc",
  authDomain: "jfamily-system.firebaseapp.com",
  databaseURL: "https://jfamily-system-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "jfamily-system",
  storageBucket: "jfamily-system.firebasestorage.app",
  messagingSenderId: "740658940101",
  appId: "1:740658940101:web:f42d6915a88c29ad6848ac"
};

const fbApp = initializeApp(firebaseConfig);
export const db = getDatabase(fbApp);

export const TW_HOLIDAYS = {
  '2026-01-01':'元旦','2026-01-02':'補假',
  '2026-01-28':'除夕','2026-01-29':'初一','2026-01-30':'初二','2026-01-31':'初三',
  '2026-02-01':'初四','2026-02-02':'初五',
  '2026-02-28':'228',
  '2026-04-03':'兒童節補','2026-04-04':'兒童節',
  '2026-05-01':'勞動節',
  '2026-06-19':'端午節',
  '2026-09-26':'中秋節',
  '2026-10-09':'國慶補','2026-10-10':'國慶日',
};

export const today = () => new Date().toISOString().slice(0, 10);
export const nowTime = () => {
  const n = new Date();
  return n.getHours().toString().padStart(2,'0') + ':' + n.getMinutes().toString().padStart(2,'0');
};
