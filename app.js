// ══════════════════════════════════════════════════════════════════════════
//  CONFIG
// ══════════════════════════════════════════════════════════════════════════

const firebaseConfig = {
  apiKey:            "AIzaSyAC_ExyTix922T7dBG1j_FAyTTzBgjKEDY",
  authDomain:        "timesheet-be682.firebaseapp.com",
  projectId:         "timesheet-be682",
  storageBucket:     "timesheet-be682.firebasestorage.app",
  messagingSenderId: "1004023329023",
  appId:             "1:1004023329023:web:a66721470a3c335a7edcca"
};

const EMAILJS_PUBLIC_KEY  = 'PASTE_YOUR_EMAILJS_PUBLIC_KEY';
const EMAILJS_SERVICE_ID  = 'PASTE_YOUR_SERVICE_ID';
const EMAILJS_TEMPLATE_ID = 'PASTE_YOUR_TEMPLATE_ID';

// ══════════════════════════════════════════════════════════════════════════
//  FIREBASE INIT
// ══════════════════════════════════════════════════════════════════════════

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();
emailjs.init(EMAILJS_PUBLIC_KEY);

// ══════════════════════════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════════════════════════

const state = {
  user:             null,
  mainMonth:        currentMonth(),
  mainDate:         todayStr(),
  monthlyMonth:     currentMonth(),
  yearlyYear:       new Date().getFullYear(),
  settingsMonth:    currentMonth(),
  settingsMetadata: [],
  fmCatMeta:        [],   // FM categories being edited in settings
  monthlyLeaves:       [],
  monthlyLeaveReasons: {},
  cache:            {},   // month → data
  allMonthsCache:   null,
  userDataCache:    null, // user-level doc (fmCategories, fmLog)
  lastAdjustment:   null,
  lastMonthlyEdit:  null,
  // Diet tab
  dietDate:         todayStr(),
  dietMonthCache:   {},
  dietSettings:     null,
  userRole:         null,
};

// ══════════════════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════════════════

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatMonth(m) {
  const [y, mon] = m.split('-').map(Number);
  return new Date(y, mon - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function formatMonthShort(m) {
  const [y, mon] = m.split('-').map(Number);
  return new Date(y, mon - 1, 1).toLocaleString('en-US', { month: 'short' });
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', weekday: 'short'
  });
}

function daysInMonth(year, mon) {
  return new Date(year, mon, 0).getDate();
}

function showToast(msg, ms = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), ms);
}

// ══════════════════════════════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════════════════════════════

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function signInWithGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  if (window.navigator.standalone === true) {
    // iOS home screen: open Safari, user signs in there, auto-reload on return
    localStorage.setItem('pwa_ios_signin_pending', '1');
    document.getElementById('btn-google').classList.add('hidden');
    document.getElementById('pwa-ios-guide').classList.remove('hidden');
    openInSafari();
    // After 8s show manual fallback in case visibilitychange doesn't fire
    setTimeout(() => document.getElementById('btn-ios-back').classList.remove('hidden'), 8000);
  } else {
    auth.signInWithPopup(provider).catch(e => {
      if (e.code !== 'auth/popup-closed-by-user') showToast('Sign-in failed: ' + e.message);
    });
  }
}

// iOS only: when user returns from Safari after signing in, reload to pick up auth
if (window.navigator.standalone === true) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && localStorage.getItem('pwa_ios_signin_pending')) {
      localStorage.removeItem('pwa_ios_signin_pending');
      window.location.reload();
    }
  });
}

function openInSafari() {
  const a = document.createElement('a');
  a.href = window.location.href.split('?')[0].split('#')[0];
  a.target = '_blank'; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

function reloadAfterSafariSignIn() {
  window.location.reload();
}

// Handle any leftover redirect result (edge cases)
auth.getRedirectResult().catch(e => {
  if (e.code && e.code !== 'auth/no-auth-event') showToast('Sign-in failed: ' + e.message);
});


function doSignOut() {
  auth.signOut();
}

auth.onAuthStateChanged(user => {
  state.user = user;
  state.cache = {};
  state.allMonthsCache = null;
  state.userDataCache  = null;
  state.dietMonthCache   = {};
  state.dietSettings     = null;
  state.userRole         = null;

  if (user) {
    document.getElementById('pwa-signin-overlay')?.classList.add('hidden');
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    const avatar = document.getElementById('user-avatar');
    if (user.photoURL) { avatar.src = user.photoURL; avatar.style.display = 'block'; }
    else avatar.style.display = 'none';
    const avatarM = document.getElementById('user-avatar-mobile');
    if (avatarM) { if (user.photoURL) { avatarM.src = user.photoURL; avatarM.style.display = 'block'; } }
    const nameM = document.getElementById('mobile-user-name');
    if (nameM) nameM.textContent = user.displayName || user.email || '';
    // iOS Safari (non-standalone): prompt to add to home screen after first sign-in
    if (isIOS() && !window.navigator.standalone && !sessionStorage.getItem('ios_ath_dismissed')) {
      document.getElementById('ios-ath-banner').classList.remove('hidden');
    }
    initApp();
  } else {
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
    // iOS standalone: if sign-in was pending but PWA was killed and restarted,
    // auth may not have propagated — show guide with manual fallback immediately
    if (window.navigator.standalone === true && localStorage.getItem('pwa_ios_signin_pending')) {
      document.getElementById('btn-google').classList.add('hidden');
      document.getElementById('pwa-ios-guide').classList.remove('hidden');
      document.getElementById('btn-ios-back').classList.remove('hidden');
    }
  }
});

// ══════════════════════════════════════════════════════════════════════════
//  FIRESTORE — MONTH DATA
// ══════════════════════════════════════════════════════════════════════════

function monthRef(month) {
  return db.collection('users').doc(state.user.uid).collection('months').doc(month);
}

async function getMonthData(month) {
  if (state.cache[month]) return state.cache[month];
  const doc = await monthRef(month).get();
  const data = doc.exists ? doc.data() : { categories: [], leaves: [], entries: {} };
  if (!data.entries)       data.entries       = {};
  if (!data.leaves)        data.leaves        = [];
  if (!data.categories)    data.categories    = [];
  if (!data.wastedEntries) data.wastedEntries = {};
  state.cache[month] = data;
  return data;
}

async function saveMonthData(month, data) {
  await monthRef(month).set(data);
  state.cache[month] = data;
  state.allMonthsCache = null;
}

async function getAllMonths() {
  if (state.allMonthsCache) return state.allMonthsCache;
  const snap = await db.collection('users').doc(state.user.uid).collection('months').get();
  const result = {};
  snap.forEach(doc => {
    const d = doc.data();
    if (!d.entries)       d.entries       = {};
    if (!d.leaves)        d.leaves        = [];
    if (!d.categories)    d.categories    = [];
    if (!d.wastedEntries) d.wastedEntries = {};
    result[doc.id] = d;
    state.cache[doc.id] = d;
  });
  state.allMonthsCache = result;
  return result;
}

// ══════════════════════════════════════════════════════════════════════════
//  FIRESTORE — USER DATA (FM categories + FM log)
// ══════════════════════════════════════════════════════════════════════════

function userRef() {
  return db.collection('users').doc(state.user.uid);
}

async function getUserData() {
  if (state.userDataCache) return state.userDataCache;
  const doc = await userRef().get();
  const data = doc.exists ? doc.data() : {};
  if (!data.fmCategories) data.fmCategories = [];
  if (!data.fmLog)        data.fmLog        = [];
  if (!data.habits)       data.habits       = [];
  if (!data.habitLog)     data.habitLog     = {};
  state.userDataCache = data;
  return data;
}

async function saveUserData(patch) {
  await userRef().set(patch, { merge: true });
  Object.assign(state.userDataCache || (state.userDataCache = {}), patch);
}

// ══════════════════════════════════════════════════════════════════════════
//  APP INIT & TABS
// ══════════════════════════════════════════════════════════════════════════

function initApp() {
  const month = currentMonth();
  document.getElementById('main-month').value     = month;
  document.getElementById('monthly-month').value  = month;
  document.getElementById('settings-month').value = month;
  document.getElementById('fm-date').value        = todayStr();
  initYearSelector();
  loadMainTab();
  checkUserAccess();
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    ({ main: loadMainTab, monthly: loadMonthlyTab, yearly: loadYearlyTab, habits: loadHabitsTab, log: loadLogTab, planner: loadPlannerTab, settings: loadSettingsTab, diet: loadDietTab, admin: loadAdminTab, health: loadHealthTab, dailyplan: loadDailyPlanTab })[btn.dataset.tab]?.();
  });
});

// ══════════════════════════════════════════════════════════════════════════
//  MAIN TAB
// ══════════════════════════════════════════════════════════════════════════

async function loadMainTab() {
  const data = await getMonthData(state.mainMonth);
  loadMainDateDropdown(data);
  loadMainCategories(data);
  loadWastedCategories();
  await loadMonthlySummary(data);
  renderWastedMonthSummary(data);  // also sets wasted chip
  await renderDayEntries();
  renderMainNotes(data);
  const ud = await getUserData();
  populateMainFmDropdown(ud.fmCategories || []);
  renderFmTablesMain(ud.fmCategories || [], ud.fmLog || []);
}

let mainNotesTimer = null;
function renderMainNotes(data) {
  const ta = document.getElementById('main-notes');
  if (!ta) return;
  ta.value = data.notes || '';
  ta.oninput = () => {
    clearTimeout(mainNotesTimer);
    const month = state.mainMonth;
    mainNotesTimer = setTimeout(async () => {
      const d = await getMonthData(month);
      const val = ta.value.trim();
      if (val) d.notes = val; else delete d.notes;
      await saveMonthData(month, d);
    }, 800);
  };
}

function loadWastedCategories() {
  const sel = document.getElementById('wasted-category');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Select --</option>' +
    WASTED_SUBS.map(w => `<option value="${w}">${w}</option>`).join('');
}

function loadMainDateDropdown(data) {
  const [year, mon] = state.mainMonth.split('-').map(Number);
  const total = daysInMonth(year, mon);
  const leavesSet = new Set(data.leaves);
  const dayNames  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const sel = document.getElementById('main-date');
  sel.innerHTML = '';

  for (let day = 1; day <= total; day++) {
    const dt = new Date(year, mon - 1, day);
    const ds = `${state.mainMonth}-${String(day).padStart(2, '0')}`;
    const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
    const isLeave   = leavesSet.has(ds);
    const opt = document.createElement('option');
    opt.value = ds;
    let label = `${String(day).padStart(2, '0')} ${formatMonthShort(state.mainMonth)} (${dayNames[dt.getDay()]})`;
    if (isWeekend)    label += '  [Weekend]';
    else if (isLeave) label += '  [Leave]';
    opt.textContent = label;
    if (isWeekend || isLeave) opt.style.color = '#aaa';
    if (ds === state.mainDate) opt.selected = true;
    sel.appendChild(opt);
  }

  if (!state.mainDate || !Array.from(sel.options).find(o => o.selected)) {
    const today = todayStr();
    const todayOpt = Array.from(sel.options).find(o => o.value === today);
    if (todayOpt) { todayOpt.selected = true; state.mainDate = today; }
    else { state.mainDate = sel.value; }
  }
}

function loadMainCategories(data) {
  const sel = document.getElementById('main-category');
  sel.innerHTML = '<option value="">-- Select --</option>';
  data.categories.forEach(c => {
    if (c.category === FITNESS_CAT) {
      // Replace Fitness with its 3 splits so they can be logged directly
      FITNESS_SUBS.forEach(sub => {
        const opt = document.createElement('option');
        opt.value = sub; opt.textContent = sub;
        sel.appendChild(opt);
      });
      return;
    }
    const opt = document.createElement('option');
    opt.value = c.category; opt.textContent = c.category;
    sel.appendChild(opt);
  });
  // Sleep is a separate metric, but loggable here too
  const sleepOpt = document.createElement('option');
  sleepOpt.value = '__SLEEP__'; sleepOpt.textContent = '😴 Sleep';
  sel.appendChild(sleepOpt);
}

// Sleep averages: total sleep ÷ elapsed days (month start / Jun 1 → today, inclusive)
async function renderSleepAverages(mainData) {
  const todayD = new Date();
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const tStr = ymd(todayD);

  // ── Monthly average (for the Main tab month) ──
  const month = state.mainMonth;
  const [my, mm] = month.split('-').map(Number);
  const monthSleep = mainData.sleep || {};
  let mSum = 0, mDays = 0;
  const monthEnd = daysInMonth(my, mm);
  for (let d = 1; d <= monthEnd; d++) {
    const ds = `${month}-${String(d).padStart(2,'0')}`;
    if (ds > tStr) break;            // up to and including today
    mDays++;
    mSum += monthSleep[ds] || 0;
  }
  // Colour the chip background based on the average
  const sleepBg = avg => avg >= 7 ? '#166534' : avg >= 6 ? '#854d0e' : '#7f1d1d';
  function paintChip(chipId, avg, show) {
    const chip = document.getElementById(chipId);
    if (!chip) return;
    if (show) {
      chip.style.background = sleepBg(avg);
      chip.style.color = '#fff';
      chip.style.borderColor = 'transparent';
    } else {
      chip.style.background = '';
      chip.style.color = '';
      chip.style.borderColor = '';
    }
  }

  const mAvg = mDays > 0 ? Math.round((mSum / mDays) * 100) / 100 : 0;
  const mEl = document.getElementById('sleep-avg-month');
  if (mEl) mEl.textContent = mDays > 0 ? `${mAvg} hrs` : '—';
  paintChip('sleep-avg-month-chip', mAvg, mDays > 0);

  // Sleep miss count: all days this month up to today with no sleep entry
  let missCount = 0;
  for (let d = 1; d <= monthEnd; d++) {
    const ds = `${month}-${String(d).padStart(2,'0')}`;
    if (ds > tStr) break;
    if (!(monthSleep[ds] > 0)) missCount++;
  }
  const badge = document.getElementById('sleep-miss-badge');
  if (badge) {
    if (missCount > 0) {
      badge.textContent = missCount;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  // ── Yearly average (Jun 1 → today across all months, inclusive) ──
  const allData = await getAllMonths();
  let ySum = 0;
  Object.entries(allData).forEach(([, d]) => {
    Object.entries(d.sleep || {}).forEach(([date, h]) => {
      if (date >= SLEEP_AVG_START && date <= tStr) ySum += h || 0;
    });
  });
  const start = new Date(SLEEP_AVG_START + 'T00:00:00');
  const todayMid = new Date(todayD.getFullYear(), todayD.getMonth(), todayD.getDate());
  const yDays = Math.floor((todayMid - start) / 86400000) + 1;
  const yAvg = yDays > 0 ? Math.round((ySum / yDays) * 100) / 100 : 0;
  const yEl = document.getElementById('sleep-avg-year');
  if (yEl) yEl.textContent = yDays > 0 ? `${yAvg} hrs` : '—';
  paintChip('sleep-avg-year-chip', yAvg, yDays > 0);
}

async function loadMonthlySummary(data) {
  if (!data) data = await getMonthData(state.mainMonth);
  const month = state.mainMonth;
  const [year, mon] = month.split('-').map(Number);
  const leavesSet = new Set(data.leaves);
  const entries   = data.entries;

  document.getElementById('entries-date-label').textContent = `Month Summary — ${formatMonth(month)}`;

  const todayDate = new Date();
  const endDay = (year === todayDate.getFullYear() && mon === todayDate.getMonth() + 1)
    ? todayDate.getDate() : daysInMonth(year, mon);
  let workingDays = 0;
  for (let d = 1; d <= endDay; d++) {
    const dt = new Date(year, mon - 1, d);
    const ds = `${month}-${String(d).padStart(2, '0')}`;
    if (dt.getDay() !== 0 && dt.getDay() !== 6 && !leavesSet.has(ds)) workingDays++;
  }
  document.getElementById('working-days-count').textContent = workingDays;

  // Sleep averages (per elapsed day, up to yesterday) — never let this block the summary
  try { await renderSleepAverages(data); } catch (e) { console.error('Sleep averages failed', e); }

  // Productive hours chip — sum only current categories (matches the table total)
  let totalProductive = 0;
  (data.categories || []).forEach(c => {
    Object.values(entries).forEach(dayE => { totalProductive += dayE[c.category] || 0; });
  });
  totalProductive = Math.round(totalProductive * 100) / 100;
  document.getElementById('productive-hours-chip').textContent = totalProductive + ' hrs';

  const tbody = document.getElementById('entries-tbody');
  tbody.innerHTML = '';

  if (!data.categories.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">No categories — add them in Settings first</td></tr>';
    return;
  }

  const adjustments  = data.adjustments || {};
  let totalCompleted = 0, totalTarget = 0, totalPending = 0;
  let fmssCompleted  = null;

  data.categories.forEach((c, ci) => {
    let completed = 0;
    Object.values(entries).forEach(dayE => { completed += dayE[c.category] || 0; });
    completed        = Math.round(completed * 100) / 100;
    if (/fm\s*-?\s*ss/i.test(c.category)) fmssCompleted = completed;
    const target     = Math.round(c.daily_target * workingDays * 100) / 100;
    const zeroTarget = (c.daily_target || 0) === 0;
    const adjustment = zeroTarget ? 0 : Math.round((adjustments[c.category] || 0) * 100) / 100;
    const pending    = zeroTarget ? 0 : Math.round((target - completed + adjustment) * 100) / 100;
    const onTrack    = pending <= 0;
    totalCompleted  += completed;
    totalTarget     += target;
    totalPending    += pending;

    const focused = (data.focusedCategories || []).includes(c.category);
    const tr = document.createElement('tr');
    tr.className = `cat-row${focused ? ' row-focused' : ''}`;
    tr.draggable = true;
    tr.ondragstart = (e) => catDragStart(e, ci);
    tr.ondragover  = (e) => catDragOver(e, ci);
    tr.ondrop      = (e) => catDrop(e, ci);
    tr.ondragend   = catDragEnd;
    tr.innerHTML = `
      <td class="cb-col"><input type="checkbox" class="row-focus-cb" ${focused ? 'checked' : ''} onchange="toggleRowFocus('${encodeURIComponent(c.category)}', this)"></td>
      <td><span class="drag-handle" title="Drag to reorder">⠿</span>${c.category}</td>
      <td class="cell-hrs">${completed}</td>
      <td>${target}</td>
      <td>${zeroTarget
        ? `<input type="number" class="inline-input sm" value="0" disabled style="width:60px;opacity:0.45">`
        : `<input type="number" class="inline-input sm adjust-input" data-cat="${c.category}" value="${adjustment || ''}" step="0.25" placeholder="0" style="width:60px">`}</td>
      <td class="${onTrack ? 'good' : 'bad'}">${pending}</td>
    `;
    tbody.appendChild(tr);
  });

  // Totals row
  totalCompleted = Math.round(totalCompleted * 100) / 100;
  totalTarget    = Math.round(totalTarget * 100) / 100;
  totalPending   = Math.round(totalPending * 100) / 100;
  const totalTr  = document.createElement('tr');
  totalTr.className = 'summary-totals';
  totalTr.innerHTML = `
    <td class="cb-col"></td>
    <td><strong>Total</strong></td>
    <td class="cell-hrs"><strong>${totalCompleted}</strong></td>
    <td><strong>${totalTarget}</strong></td>
    <td></td>
    <td class="${totalPending > 0 ? 'bad' : 'good'}"><strong>${totalPending}</strong></td>
  `;
  tbody.appendChild(totalTr);

  const fmssEl = document.getElementById('fmss-hours-chip');
  if (fmssEl) fmssEl.textContent = fmssCompleted !== null ? `${fmssCompleted} hrs` : '—';

  // AI pending chip (AI-Office + AI-Study), floored at 0

  // Movie & Story counts for the month (from FM log)
  const ud = await getUserData();
  let movieCount = 0, storyCount = 0;
  (ud.fmLog || []).forEach(e => {
    if (e.date && e.date.startsWith(month)) {
      if (/movie/i.test(e.type || '')) movieCount++;
      if (/story/i.test(e.type || '')) storyCount++;
    }
  });
  const movieEl = document.getElementById('movie-count-chip');
  const storyEl = document.getElementById('story-count-chip');
  if (movieEl) movieEl.textContent = movieCount;
  if (storyEl) storyEl.textContent = storyCount;

  // Stats row below table (wasted, working days, productive)
  const wastedEntries = data.wastedEntries || {};
  let wastedTotal = 0;
  Object.values(wastedEntries).forEach(arr => arr.forEach(e => { wastedTotal += e.hours || 0; }));
  wastedTotal = Math.round(wastedTotal * 100) / 100;

  const bd = data.fitnessBreakdown || {};
  const gymDays = Object.values(bd).filter(d => (d.fitGYM || 0) > 0).length;
  const mmaDays = Object.values(bd).filter(d => (d.fitMMA || 0) > 0).length;

  const wasteNote = data.wasteNote || '';
  const statsRow = document.getElementById('main-stats-row');
  if (statsRow) {
    statsRow.innerHTML = `
      <div class="mstat mstat-green">
        <span class="mstat-label">🏋️ GYM days</span>
        <span class="mstat-val">${gymDays}</span>
      </div>
      <div class="mstat mstat-green">
        <span class="mstat-label">🥋 MMA days</span>
        <span class="mstat-val">${mmaDays}</span>
      </div>
      <div class="mstat mstat-waste-note mstat-clickable" id="waste-note-card" title="Click to edit">
        <span class="mstat-label">⏱ Waste note</span>
        <span id="waste-note-display" class="${wasteNote ? 'waste-note-text' : 'waste-note-placeholder'}">${wasteNote || 'Click to add…'}</span>
      </div>
    `;
    document.getElementById('waste-note-card').addEventListener('click', async function() {
      if (this.querySelector('input')) return;
      const display = this.querySelector('#waste-note-display');
      const prev = display.classList.contains('waste-note-placeholder') ? '' : display.textContent;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = prev;
      input.placeholder = 'What did you waste time on?';
      input.className = 'waste-note-input';
      display.replaceWith(input);
      input.focus(); input.select();
      let done = false;
      async function saveNote() {
        if (done) return; done = true;
        const val = input.value.trim();
        const d = await getMonthData(month);
        if (val) d.wasteNote = val; else delete d.wasteNote;
        await saveMonthData(month, d);
        const span = document.createElement('span');
        span.id = 'waste-note-display';
        span.className = val ? 'waste-note-text' : 'waste-note-placeholder';
        span.textContent = val || 'Click to add…';
        input.replaceWith(span);
      }
      input.addEventListener('blur', saveNote);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { done = true; input.blur(); } });
    });
  }

  tbody.querySelectorAll('.adjust-input').forEach(input => {
    input.addEventListener('change', async () => {
      const cat  = input.dataset.cat;
      const prev = adjustments[cat] || 0;
      const val  = parseFloat(input.value) || 0;
      const d = await getMonthData(month);
      if (!d.adjustments) d.adjustments = {};
      if (val === 0) delete d.adjustments[cat];
      else d.adjustments[cat] = val;
      await saveMonthData(month, d);
      state.lastAdjustment = { month, cat, prev };
      document.getElementById('main-undo-btn').classList.remove('hidden');
      await loadMonthlySummary(d);
      renderWastedMonthSummary(d);
    });
  });
}

// Drag-reorder categories in the Main summary (like the habits tab), persisted per month
let dragSrcCatIdx = null;
function catDragStart(e, index) {
  dragSrcCatIdx = index;
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => e.currentTarget.classList.add('dragging'), 0);
}
function catDragOver(e, index) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('#entries-tbody .cat-row').forEach((r, i) => {
    r.classList.toggle('drag-over', i === index && i !== dragSrcCatIdx);
  });
}
function catDragEnd() {
  document.querySelectorAll('#entries-tbody .cat-row').forEach(r => r.classList.remove('dragging', 'drag-over'));
  dragSrcCatIdx = null;
}
async function catDrop(e, index) {
  e.preventDefault();
  if (dragSrcCatIdx === null || dragSrcCatIdx === index) return;
  const month = state.mainMonth;
  const d = await getMonthData(month);
  const cats = d.categories || [];
  const [moved] = cats.splice(dragSrcCatIdx, 1);
  cats.splice(index, 0, moved);
  d.categories = cats;
  await saveMonthData(month, d);
  await loadMonthlySummary(d);
}

// Persist which summary rows are highlighted (per month)
async function toggleRowFocus(encCat, cb) {
  const cat = decodeURIComponent(encCat);
  cb.closest('tr').classList.toggle('row-focused', cb.checked);
  const month = state.mainMonth;
  const d = await getMonthData(month);
  let list = d.focusedCategories || [];
  if (cb.checked) { if (!list.includes(cat)) list.push(cat); }
  else { list = list.filter(c => c !== cat); }
  d.focusedCategories = list;
  await saveMonthData(month, d);
}

async function undoMainAdjustment() {
  if (!state.lastAdjustment) return;
  const { month, cat, prev } = state.lastAdjustment;
  const d = await getMonthData(month);
  if (!d.adjustments) d.adjustments = {};
  if (prev === 0) delete d.adjustments[cat];
  else d.adjustments[cat] = prev;
  await saveMonthData(month, d);
  state.lastAdjustment = null;
  document.getElementById('main-undo-btn').classList.add('hidden');
  showToast('Adjustment undone');
  await loadMonthlySummary(d);
}

async function logEntry() {
  const date     = document.getElementById('main-date').value;
  const category = document.getElementById('main-category').value;
  const hoursVal = document.getElementById('main-hours').value;
  if (!date)                                            { showToast('Select a date');     return; }
  if (!category)                                        { showToast('Select a category'); return; }
  if (!hoursVal || isNaN(+hoursVal) || +hoursVal <= 0) { showToast('Enter valid hours'); return; }

  state.mainDate = date;
  const month = date.slice(0, 7);
  const data = await getMonthData(month);
  const hrs = parseFloat(hoursVal);
  const add = (prev) => Math.round(((prev || 0) + hrs) * 100) / 100;
  if (category === '__SLEEP__') {
    if (!data.sleep) data.sleep = {};
    data.sleep[date] = add(data.sleep[date]);
  } else if (FITNESS_SUBS.includes(category)) {
    if (!data.fitnessBreakdown) data.fitnessBreakdown = {};
    if (!data.fitnessBreakdown[date]) data.fitnessBreakdown[date] = {};
    data.fitnessBreakdown[date][category] = add(data.fitnessBreakdown[date][category]);
    syncFitnessTotal(data, date);
  } else {
    if (!data.entries[date]) data.entries[date] = {};
    data.entries[date][category] = add(data.entries[date][category]);
  }
  await saveMonthData(month, data);

  document.getElementById('main-hours').value = '';
  showToast('Entry saved');
  await loadMonthlySummary(data);
  await renderDayEntries();
}

async function deleteEntryFromLog(date, category) {
  if (!confirm(`Delete "${category}" for ${formatDate(date)}?`)) return;
  const month = date.slice(0, 7);
  const data = await getMonthData(month);
  if (data.entries[date]?.[category] !== undefined) {
    delete data.entries[date][category];
    if (!Object.keys(data.entries[date]).length) delete data.entries[date];
    if (category === FITNESS_CAT && data.fitnessBreakdown) delete data.fitnessBreakdown[date];
    await saveMonthData(month, data);
  }
  showToast('Entry deleted');
  await loadMonthlySummary(data);
  await renderDayEntries();
}

// ── Wasted Time ───────────────────────────────────────────────────────────

async function logWastedTime() {
  const date  = document.getElementById('main-date').value;
  const wcat  = document.getElementById('wasted-category').value;
  const hours = parseFloat(document.getElementById('wasted-hours').value);
  if (!date)                        { showToast('Select a date');     return; }
  if (!wcat)                        { showToast('Select a category'); return; }
  if (isNaN(hours) || hours <= 0)   { showToast('Enter valid hours'); return; }

  state.mainDate = date;
  const month = date.slice(0, 7);
  const data  = await getMonthData(month);
  if (!data.wastedBreakdown) data.wastedBreakdown = {};
  if (!data.wastedBreakdown[date]) data.wastedBreakdown[date] = {};
  data.wastedBreakdown[date][wcat] = Math.round(((data.wastedBreakdown[date][wcat] || 0) + hours) * 100) / 100;
  syncWastedTotal(data, date);
  await saveMonthData(month, data);

  document.getElementById('wasted-hours').value = '';
  showToast(`${wcat} logged`);
  renderWastedMonthSummary(data);
  await renderDayEntries();
}

function renderWastedMonthSummary(data) {
  if (!data) return;
  const wastedEntries = data.wastedEntries || {};
  let total = 0;
  Object.values(wastedEntries).forEach(arr => arr.forEach(e => { total += e.hours || 0; }));
  total = Math.round(total * 100) / 100;
  document.getElementById('wasted-hours-chip').textContent = total > 0 ? total + ' hrs' : '0 hrs';
  const el = document.getElementById('stat-wasted-val');
  if (el) el.textContent = total + ' hrs';
}

async function deleteWastedEntry(date, wcat) {
  const month = date.slice(0, 7);
  const data  = await getMonthData(month);
  if (data.wastedBreakdown && data.wastedBreakdown[date]) {
    delete data.wastedBreakdown[date][wcat];
    if (!Object.keys(data.wastedBreakdown[date]).length) delete data.wastedBreakdown[date];
  }
  syncWastedTotal(data, date);
  await saveMonthData(month, data);
  showToast('Entry deleted');
  renderWastedMonthSummary(data);
  await renderDayEntries();
}

document.getElementById('main-month').addEventListener('change', async function () {
  state.mainMonth = this.value; state.mainDate = null;
  state.lastAdjustment = null;
  document.getElementById('main-undo-btn').classList.add('hidden');
  await loadMainTab();
});
document.getElementById('main-date').addEventListener('change', async function () {
  state.mainDate = this.value;
  await renderDayEntries();
});

async function renderDayEntries() {
  const date  = state.mainDate;
  const label = document.getElementById('day-entries-label');
  const list  = document.getElementById('day-entries-list');
  label.textContent = date ? `Entries — ${formatDate(date)}` : "Today's Entries";

  if (!date) {
    list.innerHTML = '<span class="empty-inline">Select a date</span>';
    return;
  }

  const data       = await getMonthData(date.slice(0, 7));
  const dayEntries = (data.entries || {})[date] || {};
  const cats       = Object.keys(dayEntries);
  const wbd        = getWastedBreakdown(data, date);
  const wastedCats = WASTED_SUBS.filter(w => (wbd[w] || 0) > 0);
  const sleepHrs   = (data.sleep || {})[date] || 0;

  let html = cats.map(cat => `
    <div style="display:flex;align-items:center;justify-content:space-between;
                padding:8px 0;border-bottom:1px solid #F1F5F9">
      <span style="font-weight:500;font-size:13px">${cat}</span>
      <div style="display:flex;align-items:center;gap:12px">
        <span class="cell-hrs">${dayEntries[cat]} hrs</span>
        <button class="btn-danger" onclick="deleteEntryFromLog('${date}','${cat}')">✕</button>
      </div>
    </div>
  `).join('');

  if (wastedCats.length) {
    html += `<div style="padding:8px 0 2px;font-size:11px;font-weight:700;color:var(--red);text-transform:uppercase;letter-spacing:0.8px">Social Media &amp; Unwanted</div>`;
    html += wastedCats.map(w => `
      <div style="display:flex;align-items:center;justify-content:space-between;
                  padding:8px 0;border-bottom:1px solid #F1F5F9">
        <span style="font-size:13px;color:var(--muted)">${w}</span>
        <div style="display:flex;align-items:center;gap:12px">
          <span style="font-weight:700;color:var(--red)">${wbd[w]} hrs</span>
          <button class="btn-danger" onclick="deleteWastedEntry('${date}','${w}')">✕</button>
        </div>
      </div>
    `).join('');
  }

  if (sleepHrs > 0) {
    html += `
      <div style="display:flex;align-items:center;justify-content:space-between;
                  padding:8px 0;border-bottom:1px solid #F1F5F9">
        <span style="font-size:13px;color:#60a5fa">😴 Sleep</span>
        <div style="display:flex;align-items:center;gap:12px">
          <span style="font-weight:700;color:#60a5fa">${sleepHrs} hrs</span>
          <button class="btn-danger" onclick="deleteSleepEntry('${date}')">✕</button>
        </div>
      </div>`;
  }

  if (!cats.length && !wastedCats.length && sleepHrs <= 0) {
    list.innerHTML = '<span class="empty-inline">No entries for this date</span>';
    return;
  }

  list.innerHTML = html;
}

async function deleteSleepEntry(date) {
  const month = date.slice(0, 7);
  const data  = await getMonthData(month);
  if (data.sleep) { delete data.sleep[date]; }
  await saveMonthData(month, data);
  showToast('Sleep entry deleted');
  await loadMonthlySummary(data);
  await renderDayEntries();
}

// ══════════════════════════════════════════════════════════════════════════
//  MONTHLY TAB
// ══════════════════════════════════════════════════════════════════════════

async function loadMonthlyTab() {
  const data = await getMonthData(state.monthlyMonth);
  state.monthlyLeaves       = [...(data.leaves || [])];
  state.monthlyLeaveReasons = { ...(data.leaveReasons || {}) };
  renderLeaveTags();
  loadLeaveDropdown(data);
  await renderMonthlyTable(data);
}

function loadLeaveDropdown(data) {
  const [year, mon] = state.monthlyMonth.split('-').map(Number);
  const total = daysInMonth(year, mon);
  const leavesSet = new Set(data.leaves);
  const dayNames  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const sel = document.getElementById('leave-date-select');
  sel.innerHTML = '<option value="">-- Pick a date --</option>';
  for (let day = 1; day <= total; day++) {
    const dt = new Date(year, mon - 1, day);
    if (dt.getDay() === 0 || dt.getDay() === 6) continue;
    const ds = `${state.monthlyMonth}-${String(day).padStart(2, '0')}`;
    const opt = document.createElement('option');
    opt.value = ds;
    opt.textContent = `${String(day).padStart(2, '0')} ${formatMonthShort(state.monthlyMonth)} (${dayNames[dt.getDay()]})${leavesSet.has(ds) ? ' ✓' : ''}`;
    if (leavesSet.has(ds)) opt.style.color = '#16a34a';
    sel.appendChild(opt);
  }
}

function renderLeaveTags() {
  const container = document.getElementById('leave-tags');
  if (!state.monthlyLeaves.length) {
    container.innerHTML = '<span class="empty-inline">None</span>';
    return;
  }
  container.innerHTML = state.monthlyLeaves.map(d => {
    const reason = state.monthlyLeaveReasons[d];
    return `<div class="leave-tag">${formatDate(d)}${reason ? ' · ' + reason : ''}<button onclick="removeLeave('${d}')">✕</button></div>`;
  }).join('');
}

async function addLeave() {
  const sel    = document.getElementById('leave-date-select');
  const date   = sel.value;
  const reason = document.getElementById('leave-reason').value.trim();
  if (!date) return;
  if (!state.monthlyLeaves.includes(date)) {
    state.monthlyLeaves.push(date);
    state.monthlyLeaves.sort();
  }
  if (reason) state.monthlyLeaveReasons[date] = reason;
  else delete state.monthlyLeaveReasons[date];
  await persistLeaves();
  showToast('Leave marked');
  sel.value = '';
  document.getElementById('leave-reason').value = '';
}

async function removeLeave(date) {
  state.monthlyLeaves = state.monthlyLeaves.filter(d => d !== date);
  delete state.monthlyLeaveReasons[date];
  await persistLeaves();
  showToast('Leave removed');
}

async function persistLeaves() {
  const month = state.monthlyMonth;
  const data  = await getMonthData(month);
  data.leaves       = state.monthlyLeaves;
  data.leaveReasons = state.monthlyLeaveReasons;
  await saveMonthData(month, data);
  renderLeaveTags();
  loadLeaveDropdown(data);
  await renderMonthlyTable(data);
  if (state.mainMonth === month) {
    loadMainDateDropdown(data);
    await loadMonthlySummary(data);
  }
}

const FITNESS_CAT  = 'Fitness';
const FITNESS_SUBS = ['fitGYM', 'fitMMA', 'fitOthers'];

// Social Media & Unwanted categories (replaces the old single "Wasted" field)
const WASTED_SUBS = ['U_Random', 'Insta', 'FB', 'Unwanted'];

// Date tracking started — used as the start point for the yearly sleep average
const SLEEP_AVG_START = '2026-06-01';

// Get a day's wasted breakdown, with legacy fallback (old single total → Unwanted)
function getWastedBreakdown(data, date) {
  const bd = (data.wastedBreakdown || {})[date] || {};
  const hasBreakdown = WASTED_SUBS.some(s => (bd[s] || 0) > 0);
  if (!hasBreakdown) {
    const legacy = ((data.wastedEntries || {})[date] || []).reduce((s, e) => s + (e.hours || 0), 0);
    if (legacy > 0) return { Unwanted: Math.round(legacy * 100) / 100 };
  }
  return bd;
}

// Sum a day's wasted breakdown
function dayWastedTotal(data, date) {
  const bd = getWastedBreakdown(data, date);
  return Math.round(WASTED_SUBS.reduce((s, k) => s + (bd[k] || 0), 0) * 100) / 100;
}

// After editing wastedBreakdown[date][cat], keep wastedEntries[date] synced as the total
function syncWastedTotal(d, date) {
  const bd = (d.wastedBreakdown || {})[date] || {};
  const total = Math.round(WASTED_SUBS.reduce((s, k) => s + (bd[k] || 0), 0) * 100) / 100;
  if (!d.wastedEntries) d.wastedEntries = {};
  if (total > 0) d.wastedEntries[date] = [{ hours: total, note: '' }];
  else delete d.wastedEntries[date];
}

// After editing fitnessBreakdown[date][sub], keep entries[date].Fitness synced as the total
function syncFitnessTotal(d, date) {
  const bd = (d.fitnessBreakdown || {})[date] || {};
  const total = Math.round(FITNESS_SUBS.reduce((s, k) => s + (bd[k] || 0), 0) * 100) / 100;
  if (!d.entries[date]) d.entries[date] = {};
  if (total > 0) d.entries[date][FITNESS_CAT] = total;
  else { delete d.entries[date][FITNESS_CAT]; if (!Object.keys(d.entries[date]).length) delete d.entries[date]; }
}

// ── Mobile transposed monthly table (categories as rows, dates as columns) ──
function renderMonthlyTableMobile(data) {
  const month = state.monthlyMonth;
  const [year, mon] = month.split('-').map(Number);
  const totalDays = daysInMonth(year, mon);
  const today = todayStr();
  const categories = data.categories.map(c => c.category);
  const entries = data.entries || {};
  const breakdown = data.fitnessBreakdown || {};
  const leavesSet = new Set(data.leaves || []);
  const wastedEntries = data.wastedEntries || {};
  const dn = ['Su','Mo','Tu','We','Th','Fr','Sa'];

  const dates = [];
  for (let d = 1; d <= totalDays; d++) {
    const dt = new Date(year, mon - 1, d);
    const ds = `${month}-${String(d).padStart(2,'0')}`;
    dates.push({ d, ds, dt, we: dt.getDay()===0||dt.getDay()===6, isToday: ds===today, future: ds>today, leave: leavesSet.has(ds) });
  }

  // Header: Category col + one col per date
  const headCols = dates.map(di =>
    `<th class="mob-date-th${di.isToday?' col-today':di.we?' col-weekend':''}">${String(di.d).padStart(2,'0')}<br><span class="mob-day-nm">${dn[di.dt.getDay()]}</span></th>`
  ).join('');
  document.getElementById('monthly-thead').innerHTML = `<tr><th class="mob-cat-th">Category</th>${headCols}</tr>`;

  const oldTbody = document.getElementById('monthly-tbody');
  const newTbody = oldTbody.cloneNode(false);
  newTbody.id = 'monthly-tbody';
  oldTbody.parentNode.replaceChild(newTbody, oldTbody);
  const tbody = newTbody;

  function dataCell(di, hrs, extra='', extraCls='') {
    if (di.future) return `<td class="mob-data-cell${di.we?' mob-we':''}${extraCls?' '+extraCls:''}"></td>`;
    const v = hrs > 0 ? hrs : '';
    const hrsClass = hrs > 0 ? ' cell-hrs' : '';
    return `<td class="editable-cell mob-data-cell${di.we?' mob-we':''}${hrsClass}${extraCls?' '+extraCls:''}" ${extra}>${v}</td>`;
  }

  // Category rows
  categories.forEach(cat => {
    if (cat === FITNESS_CAT) {
      const fhTr = document.createElement('tr');
      fhTr.innerHTML = `<td class="mob-cat-th fitness-group" colspan="${dates.length+1}">Fitness</td>`;
      tbody.appendChild(fhTr);
      FITNESS_SUBS.forEach(sub => {
        const tr = document.createElement('tr');
        const cells = dates.map(di => {
          if (di.future) return `<td class="mob-data-cell fitness-sub-cell${di.we?' mob-we':''}"></td>`;
          const bd = breakdown[di.ds] || {};
          const hasBreakdown = FITNESS_SUBS.some(s => (bd[s]||0) > 0);
          let hrs = bd[sub] || 0;
          if (!hasBreakdown && sub === 'fitOthers') hrs = (entries[di.ds]||{})[FITNESS_CAT] || 0;
          const v = hrs > 0 ? hrs : '';
          return `<td class="editable-cell fitness-sub-cell mob-data-cell${di.we?' mob-we':''}${hrs>0?' cell-hrs':''}" data-date="${di.ds}" data-cat="${FITNESS_CAT}" data-sub="${sub}" data-hrs="${hrs}">${v}</td>`;
        }).join('');
        tr.innerHTML = `<td class="mob-cat-th fitness-sub">${sub}</td>${cells}`;
        tbody.appendChild(tr);
      });
      return;
    }
    const tr = document.createElement('tr');
    const cells = dates.map(di => {
      const hrs = (entries[di.ds]||{})[cat] || 0;
      return dataCell(di, hrs, `data-date="${di.ds}" data-cat="${cat}" data-hrs="${hrs}"`);
    }).join('');
    tr.innerHTML = `<td class="mob-cat-th">${cat}</td>${cells}`;
    tbody.appendChild(tr);
  });

  // Total row
  const totTr = document.createElement('tr');
  totTr.className = 'row-total';
  const totCells = dates.map(di => {
    const de = entries[di.ds] || {};
    const t = Math.round((categories.reduce((s,c) => s + (de[c]||0), 0)) * 100) / 100;
    return `<td class="mob-data-cell${t>0?' cell-hrs':''}">${t>0?t:''}</td>`;
  }).join('');
  totTr.innerHTML = `<td class="mob-cat-th">Total</td>${totCells}`;
  tbody.appendChild(totTr);

  // Status row (compact)
  const stTr = document.createElement('tr');
  const stCells = dates.map(di => {
    const de = entries[di.ds] || {};
    const t = categories.reduce((s,c) => s+(de[c]||0), 0);
    let txt='', cls='';
    if (di.future)     { txt=''; cls='neutral'; }
    else if (di.leave) { txt='L'; cls='good'; }
    else if (t > 0)    { txt='✓'; cls='good'; }
    else if (di.we)    { txt=''; cls='neutral'; }
    else               { txt='!'; cls='bad'; }
    return `<td class="mob-data-cell ${cls}" style="text-align:center">${txt}</td>`;
  }).join('');
  stTr.innerHTML = `<td class="mob-cat-th" style="color:var(--muted)">Status</td>${stCells}`;
  tbody.appendChild(stTr);

  // Sleep row
  const slTr = document.createElement('tr');
  const slCells = dates.map(di => {
    if (di.future) return `<td class="mob-data-cell${di.we?' mob-we':''}"></td>`;
    const sh = (data.sleep || {})[di.ds] || 0;
    return `<td class="editable-cell sleep-cell mob-data-cell${sh>0?' cell-sleep':''}" data-date="${di.ds}" data-sleep="1" data-hrs="${sh}">${sh>0?sh:''}</td>`;
  }).join('');
  slTr.innerHTML = `<td class="mob-cat-th" style="color:#60a5fa">Sleep (Yestr)</td>${slCells}`;
  tbody.appendChild(slTr);

  // Social Media & Unwanted — group header + 4 rows
  const wgTr = document.createElement('tr');
  wgTr.innerHTML = `<td class="mob-cat-th wasted-group" colspan="${dates.length+1}">Social Media &amp; Unwanted</td>`;
  tbody.appendChild(wgTr);
  WASTED_SUBS.forEach(wcat => {
    const tr = document.createElement('tr');
    const cells = dates.map(di => {
      if (di.future) return `<td class="mob-data-cell wasted-sub-cell${di.we?' mob-we':''}"></td>`;
      const bd = getWastedBreakdown(data, di.ds);
      const hrs = bd[wcat] || 0;
      return `<td class="editable-cell wasted-sub-cell mob-data-cell${hrs>0?' cell-wasted':''}" data-date="${di.ds}" data-wcat="${wcat}" data-hrs="${hrs}">${hrs>0?hrs:''}</td>`;
    }).join('');
    tr.innerHTML = `<td class="mob-cat-th wasted-sub">${wcat}</td>${cells}`;
    tbody.appendChild(tr);
  });

  attachMonthlyEditHandler(tbody);
}

async function renderMonthlyTable(data) {
  if (!data) data = await getMonthData(state.monthlyMonth);
  if (window.innerWidth <= 768) { renderMonthlyTableMobile(data); return; }
  const month = state.monthlyMonth;
  const [year, mon] = month.split('-').map(Number);
  const today      = todayStr();
  const leavesSet  = new Set(data.leaves);
  const categories = data.categories.map(c => c.category);
  const entries    = data.entries;
  const breakdown  = data.fitnessBreakdown || {};
  const total      = daysInMonth(year, mon);
  const dayNames   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hasFitness = categories.includes(FITNESS_CAT);

  // Two-row header: row1 has group header for Fitness (colspan=3), row2 has sub-names
  const headerRow1 = categories.map(c =>
    c === FITNESS_CAT
      ? `<th colspan="3" class="fitness-group">${c}</th>`
      : `<th rowspan="2">${c}</th>`
  ).join('');
  const headerRow2 = hasFitness
    ? FITNESS_SUBS.map(s => `<th class="fitness-sub">${s}</th>`).join('')
    : '';

  const wastedGroupTh = `<th colspan="${WASTED_SUBS.length}" class="wasted-group">Social Media &amp; Unwanted</th>`;
  const wastedSubThs  = WASTED_SUBS.map(s => `<th class="wasted-sub">${s}</th>`).join('');

  document.getElementById('monthly-thead').innerHTML = `
    <tr><th rowspan="2">Date</th><th rowspan="2">Day</th>${headerRow1}<th rowspan="2">Total</th><th rowspan="2">Status</th><th rowspan="2" style="color:#60a5fa">Sleep (Yestr)</th>${wastedGroupTh}</tr>
    <tr>${headerRow2}${wastedSubThs}</tr>
  `;

  const oldTbody = document.getElementById('monthly-tbody');
  const newTbody = oldTbody.cloneNode(false);
  newTbody.id = 'monthly-tbody';
  oldTbody.parentNode.replaceChild(newTbody, oldTbody);
  const tbody = newTbody;
  const colTotals = Object.fromEntries(categories.map(c => [c, 0]));
  const subTotals = Object.fromEntries(FITNESS_SUBS.map(s => [s, 0]));
  const wastedSubTotals = Object.fromEntries(WASTED_SUBS.map(s => [s, 0]));
  let grandTotal  = 0;
  let sleepColTotal = 0;

  for (let day = 1; day <= total; day++) {
    const dt      = new Date(year, mon - 1, day);
    const dateStr = `${month}-${String(day).padStart(2, '0')}`;
    const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
    const isLeave   = leavesSet.has(dateStr);
    const isToday   = dateStr === today;
    const isFuture  = dateStr > today;
    const dayEntries = entries[dateStr] || {};
    const dayBreak   = breakdown[dateStr] || {};
    let dayTotal = 0;

    const isEditable = !isFuture;
    const catCells = categories.map(cat => {
      if (cat === FITNESS_CAT) {
        // If no breakdown exists but a legacy Fitness total does, show it in fitOthers
        const hasBreakdown = FITNESS_SUBS.some(s => (dayBreak[s] || 0) > 0);
        const legacyTotal  = (!hasBreakdown && (dayEntries[FITNESS_CAT] || 0) > 0) ? dayEntries[FITNESS_CAT] : 0;
        return FITNESS_SUBS.map(sub => {
          let hrs = dayBreak[sub] || 0;
          if (legacyTotal > 0 && sub === 'fitOthers') hrs = legacyTotal;
          subTotals[sub] = Math.round((subTotals[sub] + hrs) * 100) / 100;
          const editAttrs = isEditable
            ? ` class="editable-cell fitness-sub-cell${hrs > 0 ? ' cell-hrs' : ''}" data-date="${dateStr}" data-cat="${FITNESS_CAT}" data-sub="${sub}" data-hrs="${hrs}"`
            : `class="fitness-sub-cell${hrs > 0 ? ' cell-hrs' : ''}"`;
          return `<td ${editAttrs}>${hrs > 0 ? hrs : ''}</td>`;
        }).join('');
      }
      const hrs = dayEntries[cat] || 0;
      colTotals[cat] = Math.round((colTotals[cat] + hrs) * 100) / 100;
      dayTotal       = Math.round((dayTotal + hrs) * 100) / 100;
      const editAttrs = isEditable
        ? ` class="editable-cell${hrs > 0 ? ' cell-hrs' : ''}" data-date="${dateStr}" data-cat="${cat}" data-hrs="${hrs}"`
        : (hrs > 0 ? ' class="cell-hrs"' : '');
      return `<td${editAttrs}>${hrs > 0 ? hrs : ''}</td>`;
    });

    // Add fitness total to dayTotal
    if (hasFitness) {
      const fitnessTotal = dayEntries[FITNESS_CAT] || 0;
      colTotals[FITNESS_CAT] = Math.round((colTotals[FITNESS_CAT] + fitnessTotal) * 100) / 100;
      dayTotal = Math.round((dayTotal + fitnessTotal) * 100) / 100;
    }
    grandTotal = Math.round((grandTotal + dayTotal) * 100) / 100;

    const rowClass    = isToday ? 'row-today' : isWeekend ? 'row-weekend' : isLeave ? 'row-leave' : '';
    const leaveReason = (data.leaveReasons || {})[dateStr] || '';
    const statusCell  = isFuture                   ? '<td class="neutral">—</td>'
      : isLeave                                    ? `<td class="good">Leave${leaveReason ? ' · ' + leaveReason : ''}</td>`
      : dayTotal > 0                               ? `<td class="good">${dayTotal} hrs</td>`
      : isWeekend                                  ? '<td class="neutral">Weekend</td>'
      :                                              '<td class="bad">No entry</td>';

    const sleepHrs = (data.sleep || {})[dateStr] || 0;
    sleepColTotal = Math.round((sleepColTotal + sleepHrs) * 100) / 100;
    const sleepCell = isFuture
      ? '<td></td>'
      : `<td class="editable-cell sleep-cell${sleepHrs > 0 ? ' cell-sleep' : ''}" data-date="${dateStr}" data-sleep="1" data-hrs="${sleepHrs}">${sleepHrs > 0 ? sleepHrs : ''}</td>`;

    const wbd = getWastedBreakdown(data, dateStr);
    const wastedCells = WASTED_SUBS.map(wcat => {
      const wh = wbd[wcat] || 0;
      wastedSubTotals[wcat] = Math.round((wastedSubTotals[wcat] + wh) * 100) / 100;
      return isFuture
        ? '<td class="wasted-sub-cell"></td>'
        : `<td class="editable-cell wasted-sub-cell${wh > 0 ? ' cell-wasted' : ''}" data-date="${dateStr}" data-wcat="${wcat}" data-hrs="${wh}">${wh > 0 ? wh : ''}</td>`;
    }).join('');

    const tr = document.createElement('tr');
    if (rowClass) tr.className = rowClass;
    tr.innerHTML = `
      <td>${String(day).padStart(2, '0')} ${formatMonthShort(month)}</td>
      <td>${dayNames[dt.getDay()]}</td>
      ${catCells.join('')}
      <td${dayTotal > 0 ? ' class="cell-hrs"' : ''}>${dayTotal > 0 ? dayTotal : ''}</td>
      ${statusCell}
      ${sleepCell}
      ${wastedCells}
    `;
    tbody.appendChild(tr);
  }

  const totalTr = document.createElement('tr');
  totalTr.className = 'row-total';
  const totalCells = categories.map(c =>
    c === FITNESS_CAT
      ? FITNESS_SUBS.map(s => `<td>${subTotals[s] > 0 ? subTotals[s] : ''}</td>`).join('')
      : `<td>${colTotals[c] > 0 ? colTotals[c] : ''}</td>`
  ).join('');
  const wastedTotalCells = WASTED_SUBS.map(s => `<td${wastedSubTotals[s] > 0 ? ' style="color:var(--red)"' : ''}>${wastedSubTotals[s] > 0 ? wastedSubTotals[s] : ''}</td>`).join('');
  const sleepTotCell = `<td${sleepColTotal > 0 ? ' style="color:#60a5fa"' : ''}>${sleepColTotal > 0 ? sleepColTotal : ''}</td>`;
  totalTr.innerHTML = `<td colspan="2">Total</td>${totalCells}<td>${grandTotal}</td><td></td>${sleepTotCell}${wastedTotalCells}`;
  tbody.appendChild(totalTr);

  if (hasFitness) {
    const bd = data.fitnessBreakdown || {};
    const gymDays = Object.values(bd).filter(d => (d.fitGYM || 0) > 0).length;
    const mmaDays = Object.values(bd).filter(d => (d.fitMMA || 0) > 0).length;
    const colSpan = 2 + (categories.length - 1) + 3 + 2 + 1 + WASTED_SUBS.length; // Date,Day + cats(fitness=3) + Total,Status,Sleep + wasted subs
    const fitTr = document.createElement('tr');
    fitTr.className = 'row-fitness-days';
    fitTr.innerHTML = `<td colspan="${colSpan}" style="text-align:center;padding:6px 12px;font-size:13px;color:#86efac;">
      <span style="margin-right:20px">🏋️ GYM: <strong>${gymDays}</strong> days</span>
      <span>🥋 MMA: <strong>${mmaDays}</strong> days</span>
    </td>`;
    tbody.appendChild(fitTr);
  }

  attachMonthlyEditHandler(tbody);
}

function attachMonthlyEditHandler(tbody) {
  tbody.addEventListener('click', async e => {
    const td = e.target.closest('td.editable-cell');
    if (!td || td.querySelector('input')) return;
    const dateStr  = td.dataset.date;
    const wcat     = td.dataset.wcat || null;
    const isSleep  = 'sleep' in td.dataset;
    const cat      = td.dataset.cat;
    const sub      = td.dataset.sub || null;
    const prevHrs  = parseFloat(td.dataset.hrs) || 0;

    const input = document.createElement('input');
    input.type = 'number'; input.min = '0'; input.max = '24'; input.step = '0.25';
    input.value = prevHrs || ''; input.placeholder = '0';
    input.className = 'cell-edit-input';
    td.textContent = ''; td.classList.remove('cell-hrs', 'cell-wasted', 'cell-sleep');
    td.appendChild(input);
    input.focus(); input.select();

    let committed = false;
    async function commitEdit() {
      if (committed) return;
      committed = true;
      const newHrs = parseFloat(input.value) || 0;
      const month  = dateStr.slice(0, 7);
      const d      = await getMonthData(month);
      if (newHrs !== prevHrs) {
        if (isSleep) {
          if (!d.sleep) d.sleep = {};
          if (newHrs > 0) d.sleep[dateStr] = newHrs;
          else delete d.sleep[dateStr];
          state.lastMonthlyEdit = { date: dateStr, isSleep: true, prev: prevHrs };
        } else if (wcat) {
          if (!d.wastedBreakdown) d.wastedBreakdown = {};
          if (!d.wastedBreakdown[dateStr]) d.wastedBreakdown[dateStr] = {};
          if (newHrs > 0) d.wastedBreakdown[dateStr][wcat] = newHrs;
          else delete d.wastedBreakdown[dateStr][wcat];
          if (!Object.keys(d.wastedBreakdown[dateStr]).length) delete d.wastedBreakdown[dateStr];
          syncWastedTotal(d, dateStr);
          state.lastMonthlyEdit = { date: dateStr, wcat, prev: prevHrs };
        } else if (sub) {
          if (!d.fitnessBreakdown) d.fitnessBreakdown = {};
          if (!d.fitnessBreakdown[dateStr]) d.fitnessBreakdown[dateStr] = {};
          if (newHrs > 0) d.fitnessBreakdown[dateStr][sub] = newHrs;
          else delete d.fitnessBreakdown[dateStr][sub];
          if (!Object.keys(d.fitnessBreakdown[dateStr]).length) delete d.fitnessBreakdown[dateStr];
          const subSum = FITNESS_SUBS.reduce((acc, s) => acc + ((d.fitnessBreakdown[dateStr] || {})[s] || 0), 0);
          const fitnessTotal = Math.round(subSum * 100) / 100;
          if (!d.entries[dateStr]) d.entries[dateStr] = {};
          if (fitnessTotal > 0) d.entries[dateStr][FITNESS_CAT] = fitnessTotal;
          else { delete d.entries[dateStr][FITNESS_CAT]; if (!Object.keys(d.entries[dateStr]).length) delete d.entries[dateStr]; }
          state.lastMonthlyEdit = { date: dateStr, cat: FITNESS_CAT, sub, prev: prevHrs };
        } else {
          if (newHrs > 0) {
            if (!d.entries[dateStr]) d.entries[dateStr] = {};
            d.entries[dateStr][cat] = newHrs;
          } else {
            if (d.entries[dateStr]) {
              delete d.entries[dateStr][cat];
              if (!Object.keys(d.entries[dateStr]).length) delete d.entries[dateStr];
            }
          }
          state.lastMonthlyEdit = { date: dateStr, cat, prev: prevHrs };
        }
        await saveMonthData(month, d);
        document.getElementById('monthly-undo-btn').classList.remove('hidden');
        if (state.mainMonth === month) await loadMonthlySummary(d);
      }
      await renderMonthlyTable(d);
    }
    input.addEventListener('blur', commitEdit);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  input.blur();
      if (e.key === 'Escape') { committed = true; renderMonthlyTable(); }
    });
  });
}

async function undoMonthlyEdit() {
  if (!state.lastMonthlyEdit) return;
  const { date, cat, sub, prev, wcat, isSleep } = state.lastMonthlyEdit;
  const month = date.slice(0, 7);
  const d = await getMonthData(month);
  if (isSleep) {
    if (!d.sleep) d.sleep = {};
    if (prev > 0) d.sleep[date] = prev;
    else delete d.sleep[date];
  } else if (wcat) {
    if (!d.wastedBreakdown) d.wastedBreakdown = {};
    if (!d.wastedBreakdown[date]) d.wastedBreakdown[date] = {};
    if (prev > 0) d.wastedBreakdown[date][wcat] = prev;
    else { delete d.wastedBreakdown[date][wcat]; if (!Object.keys(d.wastedBreakdown[date]).length) delete d.wastedBreakdown[date]; }
    syncWastedTotal(d, date);
  } else if (sub) {
    if (!d.fitnessBreakdown) d.fitnessBreakdown = {};
    if (!d.fitnessBreakdown[date]) d.fitnessBreakdown[date] = {};
    if (prev > 0) d.fitnessBreakdown[date][sub] = prev;
    else { delete d.fitnessBreakdown[date][sub]; if (!Object.keys(d.fitnessBreakdown[date]).length) delete d.fitnessBreakdown[date]; }
    const subSum = FITNESS_SUBS.reduce((acc, s) => acc + ((d.fitnessBreakdown[date] || {})[s] || 0), 0);
    const fitnessTotal = Math.round(subSum * 100) / 100;
    if (!d.entries[date]) d.entries[date] = {};
    if (fitnessTotal > 0) d.entries[date][FITNESS_CAT] = fitnessTotal;
    else { delete d.entries[date][FITNESS_CAT]; if (!Object.keys(d.entries[date]).length) delete d.entries[date]; }
  } else {
    if (prev > 0) {
      if (!d.entries[date]) d.entries[date] = {};
      d.entries[date][cat] = prev;
    } else {
      if (d.entries[date]) { delete d.entries[date][cat]; if (!Object.keys(d.entries[date]).length) delete d.entries[date]; }
    }
  }
  await saveMonthData(month, d);
  state.lastMonthlyEdit = null;
  document.getElementById('monthly-undo-btn').classList.add('hidden');
  showToast('Edit undone');
  if (state.mainMonth === month) await loadMonthlySummary(d);
  await renderMonthlyTable(d);
}

document.getElementById('monthly-month').addEventListener('change', async function () {
  state.monthlyMonth = this.value;
  state.lastMonthlyEdit = null;
  document.getElementById('monthly-undo-btn').classList.add('hidden');
  await loadMonthlyTab();
});

// ══════════════════════════════════════════════════════════════════════════
//  YEARLY TAB
// ══════════════════════════════════════════════════════════════════════════

function initYearSelector() {
  const sel = document.getElementById('yearly-year');
  const cur = new Date().getFullYear();
  for (let y = cur; y >= cur - 4; y--) {
    const opt = document.createElement('option');
    opt.value = y; opt.textContent = y;
    if (y === cur) opt.selected = true;
    sel.appendChild(opt);
  }
}

// ── Mobile transposed yearly table (metrics as rows, months as columns) ─────
function renderYearlyMobile(allData, months, allCats, today, thead, tbody) {
  // Pre-compute per-month stats
  const mStats = months.map(month => {
    const mData = allData[month];
    const [y, mo] = month.split('-').map(Number);
    const leavesSet = new Set(mData.leaves || []);
    const isCur = month === today.slice(0, 7);
    const endDay = isCur ? new Date().getDate() : daysInMonth(y, mo);
    let workingDays = 0;
    for (let d = 1; d <= endDay; d++) {
      const dt = new Date(y, mo - 1, d);
      const ds = `${month}-${String(d).padStart(2,'0')}`;
      if (dt.getDay() !== 0 && dt.getDay() !== 6 && !leavesSet.has(ds)) workingDays++;
    }
    const ents = mData.entries || {};
    const catDone = {};
    let mDone = 0;
    allCats.forEach(cat => {
      const ck = _catCanon(cat);
      let done = 0; Object.values(ents).forEach(dayE => { Object.entries(dayE).forEach(([k, v]) => { if (_catCanon(k) === ck) done += v || 0; }); }); done = Math.round(done * 100) / 100;
      catDone[cat] = done; mDone += done;
    });
    let mWasted = 0; Object.values(mData.wastedEntries || {}).forEach(arr => arr.forEach(e => { mWasted += e.hours || 0; })); mWasted = Math.round(mWasted * 100) / 100;
    const mbd = mData.fitnessBreakdown || {};
    const mGym = Object.values(mbd).filter(d => (d.fitGYM || 0) > 0).length;
    const mMma = Object.values(mbd).filter(d => (d.fitMMA || 0) > 0).length;
    const mSleepSum = Math.round(Object.values(mData.sleep || {}).reduce((s, h) => s + (h || 0), 0) * 100) / 100;
    const mSleepAvg = endDay > 0 ? Math.round((mSleepSum / endDay) * 100) / 100 : 0;
    return { month, workingDays, catDone, mDone: Math.round(mDone * 100) / 100, mWasted, mGym, mMma, mSleepAvg, comment: mData.yearlyComment || '' };
  });

  const shortMonth = m => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleString('en', {month:'short'}) + " '" + String(y).slice(2); };

  // Header: Metric | month cols
  const monthCols = months.map(m => `<th class="mob-yr-month-th">${shortMonth(m)}</th>`).join('');
  thead.innerHTML = `<tr><th class="mob-yr-metric-th">Metric</th>${monthCols}</tr>`;
  tbody.innerHTML = '';

  function addRow(label, values, cls = '', style = '') {
    const cells = values.map(v => `<td class="mob-yr-cell${cls?' '+cls:''}" style="text-align:center${style?';'+style:''}">${v !== '' && v !== 0 ? v : ''}</td>`).join('');
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="mob-yr-metric-th">${label}</td>${cells}`;
    tbody.appendChild(tr);
  }

  addRow('Working Days', mStats.map(m => m.workingDays));
  allCats.forEach(cat => addRow(cat, mStats.map(m => m.catDone[cat] || '')));
  addRow('Total Done', mStats.map(m => m.mDone || ''), 'good');
  addRow('Social + Unwanted', mStats.map(m => m.mWasted || ''), 'bad');
  addRow('🏋️ GYM', mStats.map(m => m.mGym || ''));
  addRow('🥋 MMA', mStats.map(m => m.mMma || ''));
  addRow('😴 Sleep Avg', mStats.map(m => m.mSleepAvg || ''));

  // Comments row — editable
  const commentCells = mStats.map(m => {
    const v = m.comment;
    return `<td class="yearly-comment-cell editable-cell mob-yr-cell mob-yr-comment" data-month="${m.month}" style="text-align:center;min-width:52px">${v ? `<span class="yearly-comment-text" style="font-size:11px">${v}</span>` : '<span style="color:var(--muted);font-size:12px">+</span>'}</td>`;
  }).join('');
  const commentTr = document.createElement('tr');
  commentTr.innerHTML = `<td class="mob-yr-metric-th" style="color:#94a3b8">Comments</td>${commentCells}`;
  tbody.appendChild(commentTr);

  tbody.addEventListener('click', async e => {
    const td = e.target.closest('td.yearly-comment-cell');
    if (!td || td.querySelector('input')) return;
    const month = td.dataset.month;
    const prev = td.querySelector('.yearly-comment-text')?.textContent || '';
    const input = document.createElement('input');
    input.type = 'text'; input.value = prev; input.placeholder = '+';
    input.style.cssText = 'width:100%;background:transparent;border:none;border-bottom:1px solid var(--primary);color:var(--text);font-size:12px;outline:none;text-align:center';
    td.textContent = ''; td.appendChild(input); input.focus(); input.select();
    let done = false;
    async function save() {
      if (done) return; done = true;
      const val = input.value.trim();
      const d = await getMonthData(month);
      if (val) d.yearlyComment = val; else delete d.yearlyComment;
      await saveMonthData(month, d);
      td.innerHTML = val ? `<span class="yearly-comment-text" style="font-size:11px">${val}</span>` : '<span style="color:var(--muted);font-size:12px">+</span>';
    }
    input.addEventListener('blur', save);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { done = true; input.blur(); } });
  });
}

async function loadYearlyTab() {
  const allData = await getAllMonths();
  const year    = state.yearlyYear;
  const today   = todayStr();
  const thead   = document.getElementById('yearly-thead');
  const tbody   = document.getElementById('yearly-tbody');

  const months = Object.keys(allData)
    .filter(m => m.startsWith(`${year}-`) && m <= today.slice(0, 7))
    .sort();

  if (!months.length) {
    thead.innerHTML = '';
    tbody.innerHTML = '<tr><td colspan="3" class="empty">No data for this year yet.</td></tr>';
  } else {
    const _catDisp = new Map();
    months.forEach(m => (allData[m].categories || []).forEach(c => {
      const k = _catCanon(c.category);
      if (k && !_catDisp.has(k)) _catDisp.set(k, _catClean(c.category));
    }));
    const allCats = [..._catDisp.values()];

    if (window.innerWidth <= 768) {
      renderYearlyMobile(allData, months, allCats, today, thead, tbody);
    } else {

    thead.innerHTML = `
      <tr>
        <th>Month</th><th>Working Days</th>
        ${allCats.map(c => `<th>${c}</th>`).join('')}
        <th style="color:#4ade80">Total Done</th>
        <th style="color:var(--red)">Social + Unwanted</th>
        <th style="color:#86efac">🏋️ GYM Days</th>
        <th style="color:#86efac">🥋 MMA Days</th>
        <th style="color:#60a5fa">😴 Sleep Avg</th>
        <th style="color:#94a3b8">Comments</th>
      </tr>
    `;
    tbody.innerHTML = '';

    const colTotals = Object.fromEntries(allCats.map(c => [c, { done: 0, target: 0 }]));
    let totalWD = 0, totalDone = 0, totalWasted = 0, totalGym = 0, totalMma = 0, totalSleep = 0;

    months.forEach(month => {
      const mData = allData[month];
      const [y, mon] = month.split('-').map(Number);
      const leavesSet = new Set(mData.leaves || []);
      const isCurMonth = month === today.slice(0, 7);
      const endDay = isCurMonth ? new Date().getDate() : daysInMonth(y, mon);
      let workingDays = 0;
      for (let d = 1; d <= endDay; d++) {
        const dt = new Date(y, mon - 1, d);
        const ds = `${month}-${String(d).padStart(2, '0')}`;
        if (dt.getDay() !== 0 && dt.getDay() !== 6 && !leavesSet.has(ds)) workingDays++;
      }

      const catMap = {};
      (mData.categories || []).forEach(c => { const k = _catCanon(c.category); if (catMap[k] === undefined) catMap[k] = c.daily_target || 0; });
      const entries = mData.entries || {};
      let mDone = 0;

      const cells = allCats.map(cat => {
        const ck = _catCanon(cat);
        const target = Math.round((catMap[ck] || 0) * workingDays * 100) / 100;
        let done = 0;
        Object.values(entries).forEach(dayE => { Object.entries(dayE).forEach(([k, v]) => { if (_catCanon(k) === ck) done += v || 0; }); });
        done = Math.round(done * 100) / 100;
        colTotals[cat].done   += done;
        colTotals[cat].target += target;
        mDone += done;
        const cls = target > 0 ? (done >= target ? 'good' : 'bad') : '';
        return `<td class="${cls}">${done > 0 ? done : ''}</td>`;
      });

      let mWasted = 0;
      Object.values(mData.wastedEntries || {}).forEach(arr => arr.forEach(e => { mWasted += e.hours || 0; }));
      mWasted = Math.round(mWasted * 100) / 100;

      const mbd = mData.fitnessBreakdown || {};
      const mGym = Object.values(mbd).filter(d => (d.fitGYM || 0) > 0).length;
      const mMma = Object.values(mbd).filter(d => (d.fitMMA || 0) > 0).length;
      const mSleepSum = Math.round(Object.values(mData.sleep || {}).reduce((s, h) => s + (h || 0), 0) * 100) / 100;
      const mSleepAvg = endDay > 0 ? Math.round((mSleepSum / endDay) * 100) / 100 : 0;
      const comment = mData.yearlyComment || '';

      totalWD     += workingDays;
      totalDone    = Math.round((totalDone + mDone) * 100) / 100;
      totalWasted  = Math.round((totalWasted + mWasted) * 100) / 100;
      totalGym    += mGym;
      totalMma    += mMma;
      totalSleep   = Math.round((totalSleep + mSleepSum) * 100) / 100;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${formatMonth(month)}</strong></td>
        <td>${workingDays}</td>
        ${cells.join('')}
        <td><strong>${Math.round(mDone * 100) / 100}</strong></td>
        <td${mWasted > 0 ? ' class="bad"' : ''}>${mWasted > 0 ? mWasted : ''}</td>
        <td style="color:#86efac">${mGym || ''}</td>
        <td style="color:#86efac">${mMma || ''}</td>
        <td style="color:#60a5fa">${mSleepAvg || ''}</td>
        <td class="yearly-comment-cell editable-cell" data-month="${month}" title="Click to edit">${comment ? `<span class="yearly-comment-text">${comment}</span>` : '<span class="yearly-comment-placeholder">Add comment…</span>'}</td>
      `;
      tbody.appendChild(tr);
    });

    // Year sleep average: total sleep ÷ days from tracking start → today (inclusive)
    const _sStart = new Date(SLEEP_AVG_START + 'T00:00:00');
    const _now = new Date();
    const _todayMid = new Date(_now.getFullYear(), _now.getMonth(), _now.getDate());
    const _yearDays = Math.floor((_todayMid - _sStart) / 86400000) + 1;
    const yearSleepAvg = _yearDays > 0 ? Math.round((totalSleep / _yearDays) * 100) / 100 : 0;

    const totalTr = document.createElement('tr');
    totalTr.className = 'row-total';
    totalTr.innerHTML = `
      <td>Total</td><td>${totalWD}</td>
      ${allCats.map(c => {
        const d   = colTotals[c];
        return `<td>${Math.round(d.done * 100) / 100 || ''}</td>`;
      }).join('')}
      <td class="good"><strong>${Math.round(totalDone * 100) / 100}</strong></td>
      <td${totalWasted > 0 ? ' class="bad"' : ''}>${totalWasted > 0 ? totalWasted : ''}</td>
      <td style="color:#86efac">${totalGym}</td>
      <td style="color:#86efac">${totalMma}</td>
      <td style="color:#60a5fa">${yearSleepAvg || ''}</td>
      <td></td>
    `;
    tbody.appendChild(totalTr);

    // Inline edit for comment cells
    tbody.addEventListener('click', async e => {
      const td = e.target.closest('td.yearly-comment-cell');
      if (!td || td.querySelector('input')) return;
      const month = td.dataset.month;
      const prev  = td.querySelector('.yearly-comment-text')?.textContent || '';
      const input = document.createElement('input');
      input.type = 'text'; input.value = prev; input.placeholder = 'Add comment…';
      input.style.cssText = 'width:100%;background:transparent;border:none;border-bottom:1px solid var(--primary);color:var(--text);font-size:13px;outline:none;padding:2px 0';
      td.textContent = ''; td.appendChild(input);
      input.focus(); input.select();
      let done = false;
      async function saveComment() {
        if (done) return; done = true;
        const val = input.value.trim();
        const d = await getMonthData(month);
        if (val) d.yearlyComment = val; else delete d.yearlyComment;
        await saveMonthData(month, d);
        td.innerHTML = val ? `<span class="yearly-comment-text">${val}</span>` : '<span class="yearly-comment-placeholder">Add comment…</span>';
      }
      input.addEventListener('blur', saveComment);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { done = true; input.blur(); loadYearlyTab(); } });
    });
  } // end desktop else

  } // end months.length else

  // FM count section
  await renderYearlyFmCount(year, today);
}

async function renderYearlyFmCount(year, today) {
  const userData = await getUserData();
  const cats     = userData.fmCategories || [];
  const fmLog    = userData.fmLog        || [];
  const thead    = document.getElementById('yearly-fm-thead');
  const tbody    = document.getElementById('yearly-fm-tbody');

  if (!cats.length || !fmLog.length) {
    thead.innerHTML = '';
    tbody.innerHTML = '<tr><td colspan="2" class="empty">No FM log data yet</td></tr>';
    return;
  }

  const yearEntries = fmLog.filter(e => e.date && e.date.startsWith(`${year}-`));
  if (!yearEntries.length) {
    thead.innerHTML = '';
    tbody.innerHTML = `<tr><td colspan="${cats.length + 2}" class="empty">No FM entries for ${year}</td></tr>`;
    return;
  }

  // Group by month
  const byMonth = {};
  yearEntries.forEach(e => {
    const m = e.date.slice(0, 7);
    if (!byMonth[m]) byMonth[m] = {};
    byMonth[m][e.type] = (byMonth[m][e.type] || 0) + 1;
  });

  const months = Object.keys(byMonth).filter(m => m <= (today || todayStr()).slice(0, 7)).sort();

  thead.innerHTML = `
    <tr>
      <th>Month</th>
      ${cats.map(c => `<th>${c}</th>`).join('')}
      <th>Total</th>
    </tr>
  `;
  tbody.innerHTML = '';

  const colTotals = Object.fromEntries(cats.map(c => [c, 0]));
  let grandTotal = 0;

  months.forEach(month => {
    const row = byMonth[month] || {};
    let mTotal = 0;
    const cells = cats.map(cat => {
      const count = row[cat] || 0;
      colTotals[cat] += count;
      mTotal += count;
      return `<td${count > 0 ? ' class="cell-count"' : ''}>${count > 0 ? count : ''}</td>`;
    });
    grandTotal += mTotal;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${formatMonth(month)}</strong></td>
      ${cells.join('')}
      <td><strong>${mTotal > 0 ? mTotal : ''}</strong></td>
    `;
    tbody.appendChild(tr);
  });

  const totalTr = document.createElement('tr');
  totalTr.className = 'row-total';
  totalTr.innerHTML = `
    <td>Total</td>
    ${cats.map(c => `<td>${colTotals[c] > 0 ? colTotals[c] : ''}</td>`).join('')}
    <td>${grandTotal}</td>
  `;
  tbody.appendChild(totalTr);
}

document.getElementById('yearly-year').addEventListener('change', async function () {
  state.yearlyYear = parseInt(this.value);
  await loadYearlyTab();
});

// ══════════════════════════════════════════════════════════════════════════
//  HABITS TAB
// ══════════════════════════════════════════════════════════════════════════

async function loadHabitsTab() {
  if (!state.habitsMonth) state.habitsMonth = currentMonth();
  document.getElementById('habits-month').value = state.habitsMonth;
  const userData = await getUserData();
  renderHabitsTable(userData.habits, userData.habitLog, state.habitsMonth);
}

async function onHabitsMonthChange(month) {
  state.habitsMonth = month;
  const userData = await getUserData();
  renderHabitsTable(userData.habits, userData.habitLog, month);
}

function renderHabitsTable(habits, habitLog, month) {
  if (!month) month = state.habitsMonth || currentMonth();
  const [year, mon] = month.split('-').map(Number);
  const totalDays = daysInMonth(year, mon);
  const today     = todayStr();
  const dayNames  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const table     = document.getElementById('habits-table');

  // All days of the month
  const days = [];
  for (let d = 1; d <= totalDays; d++) {
    days.push(`${month}-${String(d).padStart(2,'0')}`);
  }

  const headCells = days.map(d => {
    const dt  = new Date(d + 'T00:00:00');
    const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
    const lbl = `${String(dt.getDate()).padStart(2,'0')}<br><small>${dayNames[dt.getDay()]}</small>`;
    return `<th class="habit-day-col${d === today ? ' col-today' : ''}${isWeekend ? ' col-weekend' : ''}">${lbl}</th>`;
  }).join('');

  const thead = `
    <thead>
      <tr>
        <th class="habit-name-col">Habit</th>
        ${headCells}
      </tr>
    </thead>`;

  let bodyRows = '';
  habits.forEach((habit, i) => {
    const cells = days.map(d => {
      const st = (habitLog[d] || {})[habit]; // true=done, 'missed'=missed, else blank
      const stateCls = st === true ? 'hs-done' : st === 'missed' ? 'hs-missed' : 'hs-none';
      const mark     = st === true ? '✓' : st === 'missed' ? '✗' : '';
      const dt = new Date(d + 'T00:00:00');
      const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
      return `<td class="habit-check-cell${d === today ? ' cell-today' : ''}${isWeekend ? ' cell-weekend' : ''}">
        <button class="habit-tri ${stateCls}" onclick="cycleHabit(this,'${d}','${encodeURIComponent(habit)}')">${mark}</button>
      </td>`;
    }).join('');
    bodyRows += `
      <tr class="habit-row" draggable="true"
        ondragstart="habitDragStart(event,${i})"
        ondragover="habitDragOver(event,${i})"
        ondrop="habitDrop(event,${i})"
        ondragend="habitDragEnd(event)">
        <td class="habit-name-cell" onclick="startEditHabit(this, ${i})">
          <span class="drag-handle" title="Drag to reorder">⠿</span>
          <span class="habit-name-text" title="Click to edit">${habit}</span>
          <button class="btn-habit-del" onclick="event.stopPropagation();deleteHabit(${i})" title="Remove habit">✕</button>
        </td>
        ${cells}
      </tr>`;
  });

  bodyRows += `
    <tr class="habit-add-row">
      <td colspan="${days.length + 1}">
        <div class="habit-add-inline">
          <span class="habit-plus">+</span>
          <input type="text" id="new-habit-input" class="habit-add-input" placeholder="Type a habit and press Enter or click Add..."
            onkeydown="if(event.key==='Enter') addHabit()">
          <button class="btn-primary" style="height:34px;padding:0 16px;font-size:13px" onclick="addHabit()">Add</button>
        </div>
      </td>
    </tr>`;

  table.innerHTML = thead + `<tbody>${bodyRows}</tbody>`;
}

// Tri-state cycle: blank → done (✓) → missed (✗) → blank
async function cycleHabit(btn, date, encodedHabit) {
  const habit    = decodeURIComponent(encodedHabit);
  const userData = await getUserData();
  if (!userData.habitLog[date]) userData.habitLog[date] = {};
  const cur = userData.habitLog[date][habit];
  let next;
  if (cur === true)        next = 'missed';
  else if (cur === 'missed') next = null;
  else                     next = true;

  if (!next) delete userData.habitLog[date][habit];
  else       userData.habitLog[date][habit] = next;
  if (!Object.keys(userData.habitLog[date]).length) delete userData.habitLog[date];
  await saveUserData({ habitLog: userData.habitLog });

  btn.classList.remove('hs-done', 'hs-missed', 'hs-none');
  if (next === true)          { btn.classList.add('hs-done');   btn.textContent = '✓'; }
  else if (next === 'missed') { btn.classList.add('hs-missed'); btn.textContent = '✗'; }
  else                        { btn.classList.add('hs-none');   btn.textContent = ''; }
}

async function addHabit() {
  const input = document.getElementById('new-habit-input');
  const name  = input.value.trim();
  if (!name) return;
  const userData = await getUserData();
  if (userData.habits.includes(name)) { showToast('Already exists'); return; }
  userData.habits.push(name);
  await saveUserData({ habits: userData.habits });
  showToast(`"${name}" added`);
  renderHabitsTable(userData.habits, userData.habitLog, state.habitsMonth);
  document.getElementById('new-habit-input')?.focus();
}

async function deleteHabit(index) {
  if (!confirm('Remove this habit?')) return;
  const userData = await getUserData();
  userData.habits.splice(index, 1);
  await saveUserData({ habits: userData.habits });
  renderHabitsTable(userData.habits, userData.habitLog, state.habitsMonth);
}

function habitDragStart(e, index) {
  dragSrcHabitIdx = index;
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => e.currentTarget.classList.add('dragging'), 0);
}

function habitDragOver(e, index) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.habit-row').forEach((r, i) => {
    r.classList.toggle('drag-over', i === index && i !== dragSrcHabitIdx);
  });
}

function habitDragEnd(e) {
  document.querySelectorAll('.habit-row').forEach(r => r.classList.remove('dragging', 'drag-over'));
  dragSrcHabitIdx = null;
}

async function habitDrop(e, index) {
  e.preventDefault();
  if (dragSrcHabitIdx === null || dragSrcHabitIdx === index) return;
  const userData = await getUserData();
  const habits   = userData.habits;
  const [moved]  = habits.splice(dragSrcHabitIdx, 1);
  habits.splice(index, 0, moved);
  await saveUserData({ habits });
  renderHabitsTable(habits, userData.habitLog, state.habitsMonth);
}

function startEditHabit(td, index) {
  if (td.querySelector('input.habit-edit-input')) return;
  const span  = td.querySelector('.habit-name-text');
  const oldName = span.textContent;

  const input = document.createElement('input');
  input.type = 'text';
  input.value = oldName;
  input.className = 'habit-edit-input';
  span.replaceWith(input);
  input.focus(); input.select();

  let saved = false;
  async function commitRename() {
    if (saved) return;
    saved = true;
    const newName = input.value.trim();
    if (!newName || newName === oldName) {
      renderHabitsTable((await getUserData()).habits, (await getUserData()).habitLog, state.habitsMonth);
      return;
    }
    const userData = await getUserData();
    if (userData.habits.includes(newName)) {
      showToast('Habit name already exists'); saved = false;
      input.focus(); return;
    }
    userData.habits[index] = newName;
    // Rename in habitLog too
    Object.keys(userData.habitLog).forEach(date => {
      if (userData.habitLog[date][oldName] !== undefined) {
        userData.habitLog[date][newName] = userData.habitLog[date][oldName];
        delete userData.habitLog[date][oldName];
      }
    });
    await saveUserData({ habits: userData.habits, habitLog: userData.habitLog });
    showToast('Habit renamed');
    renderHabitsTable(userData.habits, userData.habitLog, state.habitsMonth);
  }

  input.addEventListener('blur', commitRename);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  input.blur();
    if (e.key === 'Escape') { saved = true; renderHabitsTable; input.blur(); }
  });
}

// ══════════════════════════════════════════════════════════════════════════
//  LOG TAB (FM Log)
// ══════════════════════════════════════════════════════════════════════════

async function loadLogTab() {
  const userData = await getUserData();
  populateFmTypeDropdown(userData.fmCategories || []);
  renderFmTables(userData.fmCategories || [], userData.fmLog || []);
}

function populateFmTypeDropdown(cats) {
  const sel = document.getElementById('fm-type');
  sel.innerHTML = '<option value="">-- Select --</option>';
  cats.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat; opt.textContent = cat;
    sel.appendChild(opt);
  });
}

function renderFmTables(cats, fmLog) {
  const container = document.getElementById('fm-tables-container');

  if (!cats.length) {
    container.innerHTML = `
      <div class="card">
        <span class="empty-inline">No FM categories yet — add them in Settings.</span>
      </div>`;
    return;
  }

  container.innerHTML = '';

  cats.forEach(cat => {
    const entries = fmLog
      .filter(e => e.type === cat)
      .sort((a, b) => b.date.localeCompare(a.date));

    const rows = entries.length
      ? entries.map(e => `
          <tr>
            <td>
              <div style="font-weight:500">${e.name}</div>
              ${e.notes ? `<div style="font-size:12px;color:var(--muted);margin-top:3px;line-height:1.5">${e.notes}</div>` : ''}
            </td>
            <td style="color:var(--muted);font-size:12px;white-space:nowrap">${formatDate(e.date)}</td>
            <td><button class="btn-danger" onclick="deleteFmEntry('${e.id}')">✕</button></td>
          </tr>`).join('')
      : `<tr><td colspan="3" class="empty">No ${cat} entries yet</td></tr>`;

    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-title" style="display:flex;align-items:center;justify-content:space-between">
        <span>${cat}</span>
        <span class="fm-count-badge">${entries.length}</span>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Title / Name</th><th>Date</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
    container.appendChild(card);
  });
}

async function addFmEntry() {
  const type  = document.getElementById('fm-type').value.trim();
  const name  = document.getElementById('fm-name').value.trim();
  const date  = document.getElementById('fm-date').value;
  const notes = document.getElementById('fm-notes').value.trim();
  if (!type) { showToast('Select a category'); return; }
  if (!name) { showToast('Enter a title');     return; }
  if (!date) { showToast('Select a date');     return; }

  const userData = await getUserData();
  const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type, name, date };
  if (notes) entry.notes = notes;
  const fmLog = [...(userData.fmLog || []), entry];
  await saveUserData({ fmLog });

  document.getElementById('fm-name').value  = '';
  document.getElementById('fm-notes').value = '';
  showToast(`${type} added`);
  renderFmTables(userData.fmCategories || [], fmLog);
}

async function deleteFmEntry(id) {
  const userData = await getUserData();
  const fmLog    = (userData.fmLog || []).filter(e => e.id !== id);
  await saveUserData({ fmLog });
  showToast('Entry deleted');
  renderFmTables(userData.fmCategories || [], fmLog);
  renderFmTablesMain(userData.fmCategories || [], fmLog);
}

function populateMainFmDropdown(cats) {
  const sel = document.getElementById('main-fm-type');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">-- Select --</option>' +
    cats.map(c => `<option value="${c}">${c}</option>`).join('');
  if (prev) sel.value = prev;
}

function renderFmTablesMain(cats, fmLog) {
  const container = document.getElementById('main-fm-tables-container');
  if (!container) return;
  if (!cats.length) { container.innerHTML = ''; return; }
  container.innerHTML = '';
  cats.forEach(cat => {
    const entries = fmLog
      .filter(e => e.type === cat)
      .sort((a, b) => b.date.localeCompare(a.date));
    const rows = entries.length
      ? entries.map(e => `
          <tr>
            <td>
              <div style="font-weight:500">${escHtml(e.name)}</div>
              ${e.notes ? `<div style="font-size:12px;color:var(--muted);margin-top:3px;line-height:1.5">${escHtml(e.notes)}</div>` : ''}
            </td>
            <td style="color:var(--muted);font-size:12px;white-space:nowrap">${formatDate(e.date)}</td>
            <td><button class="btn-danger" onclick="deleteFmEntry('${e.id}')">✕</button></td>
          </tr>`).join('')
      : `<tr><td colspan="3" class="empty">No ${escHtml(cat)} entries yet</td></tr>`;
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-title" style="display:flex;align-items:center;justify-content:space-between">
        <span>${escHtml(cat)}</span>
        <span class="fm-count-badge">${entries.length}</span>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Title / Name</th><th>Date</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    container.appendChild(card);
  });
}

async function addFmEntryFromMain() {
  const type = document.getElementById('main-fm-type').value.trim();
  const name = document.getElementById('main-fm-name').value.trim();
  const date = state.mainDate;
  if (!type) { showToast('Select a category'); return; }
  if (!name) { showToast('Enter a title');     return; }
  if (!date) { showToast('Select a date from the date picker above'); return; }
  const userData = await getUserData();
  const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type, name, date };
  const fmLog = [...(userData.fmLog || []), entry];
  await saveUserData({ fmLog });
  document.getElementById('main-fm-name').value = '';
  showToast('Entry added');
  renderFmTablesMain(userData.fmCategories || [], fmLog);
  renderFmTables(userData.fmCategories || [], fmLog);
  await loadMonthlySummary(await getMonthData(state.mainMonth));
}

// ══════════════════════════════════════════════════════════════════════════
//  SETTINGS TAB
// ══════════════════════════════════════════════════════════════════════════

async function loadSettingsTab() {
  applySettingsVisibility();
  const role = state.userRole;
  if (!role || role === 'both' || isAdmin()) {
    const data = await getMonthData(state.settingsMonth);
    state.settingsMetadata = data.categories.map(c => ({ ...c }));
    if (!state.settingsMetadata.length) {
      const allData    = await getAllMonths();
      const prevMonths = Object.keys(allData).filter(m => m < state.settingsMonth).sort().reverse();
      if (prevMonths.length && allData[prevMonths[0]].categories?.length) {
        state.settingsMetadata = allData[prevMonths[0]].categories.map(c => ({ ...c }));
        showToast("Showing previous month's targets — save to apply.");
      }
    }
    renderSettingsTable();
    await loadSettingsMonthTable();
    await loadFmCategorySettings();
    setSaveState('settings-save-btn', false);
  }
  await populateDietSettingsFields();
}

function applySettingsVisibility() {
  const role = state.userRole;
  const dietOnly = role === 'diet';
  const tsOnly   = role === 'timesheet';
  document.querySelectorAll('.settings-ts-only').forEach(el => {
    el.style.display = tsOnly || !role || role === 'both' || isAdmin() ? '' : 'none';
  });
  document.querySelectorAll('.settings-diet-only').forEach(el => {
    el.style.display = dietOnly || !role || role === 'both' || isAdmin() ? '' : 'none';
  });
}

// Toggle a save button between gray (clean) and blue (unsaved changes)
function setSaveState(btnId, dirty) {
  const btn = document.getElementById(btnId);
  if (btn) btn.classList.toggle('is-clean', !dirty);
}

function renderSettingsTable() {
  const tbody = document.getElementById('settings-tbody');
  const meta  = state.settingsMetadata;
  if (!meta.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty">No categories yet — add one below.</td></tr>';
    return;
  }
  tbody.innerHTML = meta.map((c, i) => `
    <tr>
      <td><input class="inline-input" type="text" value="${c.category}"
           oninput="state.settingsMetadata[${i}].category = this.value; setSaveState('settings-save-btn', true)"></td>
      <td><input class="inline-input sm" type="number" value="${c.daily_target}" step="0.25" min="0"
           oninput="state.settingsMetadata[${i}].daily_target = parseFloat(this.value)||0; setSaveState('settings-save-btn', true)"></td>
      <td><button class="btn-danger" onclick="removeSettingsCategory(${i})">✕</button></td>
    </tr>
  `).join('');
}

function addCategory() {
  const nameEl   = document.getElementById('new-category');
  const targetEl = document.getElementById('new-target');
  const name     = nameEl.value.trim();
  const target   = parseFloat(targetEl.value);
  if (!name)                                                { showToast('Enter a category name');   return; }
  if (isNaN(target) || target < 0)                         { showToast('Enter valid target hours'); return; }
  if (state.settingsMetadata.some(c => c.category===name)) { showToast('Category already exists'); return; }
  state.settingsMetadata.push({ category: name, daily_target: target });
  nameEl.value = ''; targetEl.value = '';
  renderSettingsTable();
  setSaveState('settings-save-btn', true);
}

function removeSettingsCategory(i) {
  state.settingsMetadata.splice(i, 1);
  renderSettingsTable();
  setSaveState('settings-save-btn', true);
}

async function saveSettings() {
  const month = state.settingsMonth;
  const data  = await getMonthData(month);
  data.categories = state.settingsMetadata.filter(c => c.category.trim());
  await saveMonthData(month, data);
  showToast('Settings saved');
  setSaveState('settings-save-btn', false);
  await loadSettingsMonthTable();
  if (state.mainMonth === month) await loadMainTab();
}

async function copyFromPrevMonth() {
  const [y, m] = state.settingsMonth.split('-').map(Number);
  const prev   = new Date(y, m - 2, 1);
  const prevMonth = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
  const data   = await getMonthData(prevMonth);
  if (!data.categories?.length) { showToast(`No data for ${formatMonth(prevMonth)}`); return; }
  state.settingsMetadata = data.categories.map(c => ({ ...c }));
  renderSettingsTable();
  setSaveState('settings-save-btn', true);
  showToast(`Copied from ${formatMonth(prevMonth)}`);
}

async function loadSettingsMonthTable() {
  const allData = await getAllMonths();
  const months  = Object.keys(allData).sort();
  const thead   = document.getElementById('settings-month-thead');
  const tbody   = document.getElementById('settings-month-tbody');

  if (!months.length) {
    thead.innerHTML = '';
    tbody.innerHTML = '<tr><td class="empty">Save settings for a month to see history here.</td></tr>';
    return;
  }

  const allCats  = [...new Set(months.flatMap(m => (allData[m].categories || []).map(c => c.category)))].sort();
  const curMonth = currentMonth();

  thead.innerHTML = `
    <tr>
      <th>Category</th>
      ${months.map(m => `<th${m === curMonth ? ' class="col-current"' : ''}>${formatMonthShort(m)} ${m.split('-')[0]}</th>`).join('')}
    </tr>
  `;

  tbody.innerHTML = '';
  allCats.forEach(cat => {
    const cells = months.map(m => {
      const catData = (allData[m].categories || []).find(c => c.category === cat);
      return `<td${m === curMonth ? ' class="col-current"' : ''}>${catData !== undefined ? catData.daily_target + ' hrs' : '<span class="neutral">—</span>'}</td>`;
    });
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><strong>${cat}</strong></td>${cells.join('')}`;
    tbody.appendChild(tr);
  });
}

document.getElementById('settings-month').addEventListener('change', async function () {
  state.settingsMonth = this.value;
  await loadSettingsTab();
});

// ── FM Category Settings ───────────────────────────────────────────────────

async function loadFmCategorySettings() {
  const userData  = await getUserData();
  state.fmCatMeta = [...(userData.fmCategories || [])];
  renderFmCategoryTable();
  setSaveState('fm-cat-save-btn', false);
}

function renderFmCategoryTable() {
  const tbody = document.getElementById('fm-cat-tbody');
  if (!state.fmCatMeta.length) {
    tbody.innerHTML = '<tr><td colspan="2" class="empty">No FM categories yet — add one below.</td></tr>';
    return;
  }
  tbody.innerHTML = state.fmCatMeta.map((cat, i) => `
    <tr>
      <td style="font-weight:500">${cat}</td>
      <td><button class="btn-danger" onclick="removeFmCategory(${i})">✕</button></td>
    </tr>
  `).join('');
}

function addFmCategory() {
  const input = document.getElementById('new-fm-cat');
  const name  = input.value.trim();
  if (!name)                           { showToast('Enter a category name'); return; }
  if (state.fmCatMeta.includes(name))  { showToast('Already exists');        return; }
  state.fmCatMeta.push(name);
  input.value = '';
  renderFmCategoryTable();
  setSaveState('fm-cat-save-btn', true);
}

function removeFmCategory(i) {
  state.fmCatMeta.splice(i, 1);
  renderFmCategoryTable();
  setSaveState('fm-cat-save-btn', true);
}

async function saveFmCategories() {
  await saveUserData({ fmCategories: [...state.fmCatMeta] });
  showToast('FM categories saved');
  setSaveState('fm-cat-save-btn', false);
}

// ── Data cleanup: find/remove entries under categories no longer in the list ──
async function scanOrphans() {
  const box = document.getElementById('orphan-results');
  box.innerHTML = '<span class="empty-inline">Scanning…</span>';
  const all = await getAllMonths();
  const orphans = [];
  Object.entries(all).forEach(([month, d]) => {
    const cats = new Set((d.categories || []).map(c => c.category));
    cats.add(FITNESS_CAT); // Fitness total is a valid synced key
    const sums = {};
    Object.values(d.entries || {}).forEach(dayE => {
      Object.entries(dayE).forEach(([k, v]) => {
        if (!cats.has(k)) sums[k] = Math.round(((sums[k] || 0) + (v || 0)) * 100) / 100;
      });
    });
    Object.entries(sums).forEach(([cat, hrs]) => orphans.push({ month, cat, hrs }));
  });

  if (!orphans.length) {
    box.innerHTML = '<span class="empty-inline" style="color:#4ade80">✓ No orphan entries found — everything is tidy.</span>';
    return;
  }
  orphans.sort((a, b) => a.month.localeCompare(b.month) || a.cat.localeCompare(b.cat));
  box.innerHTML = orphans.map(o => `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:13px"><strong>${formatMonth(o.month)}</strong> · ${o.cat} · <span style="color:var(--amber)">${o.hrs} hrs</span></span>
      <button class="btn-danger" onclick="deleteOrphan('${o.month}','${encodeURIComponent(o.cat)}')">Delete</button>
    </div>
  `).join('');
}

// Normalise category names + entry keys across ALL months, merging look-alike duplicates
// (collapses internal/edge spaces, unifies dash characters, ignores case) — globally consistent
const _catClean = s => (s || '').replace(/[​-‍﻿]/g, '').replace(/[‐-―−]/g, '-').replace(/\s+/g, ' ').trim();
const _catCanon = s => _catClean(s).toLowerCase();

async function normalizeCategories() {
  if (!confirm('Merge duplicate / look-alike category names (extra spaces, dash style, casing) across ALL months? Your daily backups keep the old data.')) return;
  const all = await getAllMonths();
  const months = Object.keys(all).sort();

  // Build ONE canonical display name per category (first occurrence across months wins)
  const display = new Map(); // canon -> display name
  months.forEach(m => (all[m].categories || []).forEach(c => {
    const k = _catCanon(c.category);
    if (k && !display.has(k)) display.set(k, _catClean(c.category));
  }));
  months.forEach(m => Object.values(all[m].entries || {}).forEach(day => Object.keys(day).forEach(k => {
    const ck = _catCanon(k);
    if (ck && !display.has(ck)) display.set(ck, _catClean(k));
  })));

  let changed = 0;
  for (const m of months) {
    const d = all[m];
    let touched = false;

    // 1. Category list — dedupe by canonical key, use the global display name
    if (Array.isArray(d.categories)) {
      const seen = new Set();
      const newCats = [];
      d.categories.forEach(c => {
        const k = _catCanon(c.category);
        if (!k || seen.has(k)) return;
        seen.add(k);
        newCats.push({ category: display.get(k), daily_target: c.daily_target });
      });
      if (JSON.stringify(newCats) !== JSON.stringify(d.categories)) { d.categories = newCats; touched = true; }
    }

    // 2. Entry keys — remap to canonical display name + merge hours
    if (d.entries) {
      Object.keys(d.entries).forEach(date => {
        const day = d.entries[date];
        const merged = {};
        let dayChanged = false;
        Object.entries(day).forEach(([k, v]) => {
          const name = display.get(_catCanon(k)) || _catClean(k);
          if (name !== k) dayChanged = true;
          merged[name] = Math.round(((merged[name] || 0) + (v || 0)) * 100) / 100;
        });
        if (dayChanged) { d.entries[date] = merged; touched = true; }
      });
    }

    if (touched) { await saveMonthData(m, d); changed++; }
  }
  showToast(changed ? `Cleaned ${changed} month(s)` : 'Nothing to clean');
  if (state.mainMonth) await loadMainTab();
  await scanOrphans();
}

async function deleteOrphan(month, encCat) {
  const cat = decodeURIComponent(encCat);
  if (!confirm(`Delete all "${cat}" entries in ${formatMonth(month)}? This cannot be undone.`)) return;
  const d = await getMonthData(month);
  Object.keys(d.entries || {}).forEach(date => {
    if (d.entries[date][cat] !== undefined) {
      delete d.entries[date][cat];
      if (!Object.keys(d.entries[date]).length) delete d.entries[date];
    }
  });
  await saveMonthData(month, d);
  showToast(`Removed "${cat}"`);
  if (month === state.mainMonth) await loadMonthlySummary(d);
  await scanOrphans();
}

// ══════════════════════════════════════════════════════════════════════════
//  EXCEL DOWNLOAD
// ══════════════════════════════════════════════════════════════════════════

async function downloadExcel() {
  showToast('Preparing Excel...');
  try {
    const [allData, userData] = await Promise.all([getAllMonths(), getUserData()]);
    const wb = new ExcelJS.Workbook();

    // ── Colours & borders ──────────────────────────────────────────────────
    const BORDER = { top:{style:'thin',color:{argb:'FFB0B0B0'}}, left:{style:'thin',color:{argb:'FFB0B0B0'}}, bottom:{style:'thin',color:{argb:'FFB0B0B0'}}, right:{style:'thin',color:{argb:'FFB0B0B0'}} };
    const BLUE_FILL  = { type:'pattern', pattern:'solid', fgColor:{argb:'FF2E75B6'} };
    const BLUE_FONT  = { bold:true, color:{argb:'FFFFFFFF'}, size:11 };
    const LTBLUE_FILL = { type:'pattern', pattern:'solid', fgColor:{argb:'FFDAE3F3'} };
    const BOLD_FONT  = { bold:true, size:11 };
    const GRAY_FILL  = { type:'pattern', pattern:'solid', fgColor:{argb:'FFF2F2F2'} };
    const GREEN_FILL = { type:'pattern', pattern:'solid', fgColor:{argb:'FF548235'} };
    const GREEN_FONT = { bold:true, color:{argb:'FFFFFFFF'}, size:11 };
    const LTGREEN_FILL = { type:'pattern', pattern:'solid', fgColor:{argb:'FFE2EFDA'} };
    const LTGREEN_FONT = { bold:true, size:11 };

    function styleRow(row, numCols, fill, font) {
      row.height = 18;
      for (let c = 1; c <= numCols; c++) {
        const cell = row.getCell(c);
        if (fill) cell.fill = fill;
        if (font) cell.font = font;
        cell.border = BORDER;
        cell.alignment = { vertical:'middle' };
      }
    }

    function borderRow(row, numCols) {
      for (let c = 1; c <= numCols; c++) row.getCell(c).border = BORDER;
    }

    function sanitizeName(n) {
      return String(n||'').replace(/[:\\/*?\[\]]/g,' ').trim().slice(0,28)||'Sheet';
    }

    // ── 1. Monthly Summary ─────────────────────────────────────────────────
    try {
      const month = state.mainMonth;
      const data = await getMonthData(month);
      const ws = wb.addWorksheet('Monthly Summary');
      ws.getColumn(1).width = 30; ws.getColumn(2).width = 16;
      ws.getColumn(3).width = 14; ws.getColumn(4).width = 14; ws.getColumn(5).width = 14;

      const hRow = ws.addRow(['Category','Completed (hrs)','Target (hrs)','Adjust (hrs)','Pending (hrs)']);
      styleRow(hRow, 5, BLUE_FILL, BLUE_FONT);

      const [y, m] = month.split('-').map(Number);
      const leavesSet = new Set(data.leaves || []);
      const todayDate = new Date();
      const endDay = (y === todayDate.getFullYear() && m === todayDate.getMonth()+1) ? todayDate.getDate() : daysInMonth(y,m);
      let workingDays = 0;
      for (let d=1; d<=endDay; d++) {
        const dt = new Date(y,m-1,d);
        const ds = `${month}-${String(d).padStart(2,'0')}`;
        if (dt.getDay()!==0 && dt.getDay()!==6 && !leavesSet.has(ds)) workingDays++;
      }
      const entries = data.entries || {};
      const adjustments = data.adjustments || {};
      let totalCompleted=0, totalTarget=0, totalPending=0;
      (data.categories||[]).forEach(c => {
        let completed=0;
        Object.values(entries).forEach(dayE => { completed += dayE[c.category]||0; });
        completed = Math.round(completed*100)/100;
        const target = Math.round(c.daily_target * workingDays * 100)/100;
        const adjustment = Math.round((adjustments[c.category]||0)*100)/100;
        const pending = Math.round((target - completed + adjustment)*100)/100;
        const row = ws.addRow([c.category, completed, target, adjustment||0, pending]);
        borderRow(row, 5);
        totalCompleted+=completed; totalTarget+=target; totalPending+=pending;
      });
      ws.addRow([]);
      const tRow = ws.addRow(['Totals', Math.round(totalCompleted*100)/100, Math.round(totalTarget*100)/100, '', Math.round(totalPending*100)/100]);
      styleRow(tRow, 5, LTBLUE_FILL, BOLD_FONT);

      const wastedEntries = data.wastedEntries||{};
      let wastedTotal=0; Object.values(wastedEntries).forEach(arr=>arr.forEach(e=>{wastedTotal+=e.hours||0;}));
      wastedTotal = Math.round(wastedTotal*100)/100;
      const productive = Math.round(Object.values(entries).flatMap(Object.values).reduce((a,b)=>a+b,0)*100)/100;
      const ebd = data.fitnessBreakdown || {};
      const gymDays = Object.values(ebd).filter(d => (d.fitGYM||0) > 0).length;
      const mmaDays = Object.values(ebd).filter(d => (d.fitMMA||0) > 0).length;
      const sleepTotal = Math.round(Object.values(data.sleep||{}).reduce((s,h)=>s+(h||0),0)*100)/100;
      ws.addRow([]);
      const wasteNoteExport = data.wasteNote || '';
      const notesExport = data.notes || '';
      [['Working days', workingDays],['Productive (hrs)', productive],['Social + Unwanted (hrs)', wastedTotal],['GYM days', gymDays],['MMA days', mmaDays],['Sleep (hrs)', sleepTotal],['Waste note', wasteNoteExport],['Notes', notesExport]].forEach(r => {
        const row = ws.addRow(r);
        row.getCell(1).font = BOLD_FONT;
        row.getCell(1).fill = GRAY_FILL;
        row.getCell(2).fill = GRAY_FILL;
        borderRow(row, 2);
      });
    } catch(e) { console.error('Monthly summary failed', e); }

    // ── 2. Monthly Entries ─────────────────────────────────────────────────
    try {
      const month = state.monthlyMonth;
      const data = await getMonthData(month);
      const cats = (data.categories||[]).map(c=>c.category);
      const [y,m] = month.split('-').map(Number);
      const total = daysInMonth(y,m);
      const ws = wb.addWorksheet('E - Monthly Entries');
      ws.getColumn(1).width = 14; ws.getColumn(2).width = 8;
      cats.forEach((_,i) => { ws.getColumn(3+i).width = 12; });
      ws.getColumn(3+cats.length).width = 10;
      ws.getColumn(4+cats.length).width = 12;

      const hRow = ws.addRow(['Date','Day',...cats,'Total','Status']);
      styleRow(hRow, 2+cats.length+2, BLUE_FILL, BLUE_FONT);

      const dayNames=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const entries = data.entries||{};
      const leavesSet = new Set(data.leaves||[]);
      const today = todayStr();
      for (let d=1; d<=total; d++) {
        const dt = new Date(y,m-1,d);
        const dateStr = `${month}-${String(d).padStart(2,'0')}`;
        const dayEntries = entries[dateStr]||{};
        let dayTotal=0;
        const catVals = cats.map(cat=>{ const hrs=dayEntries[cat]||0; dayTotal+=hrs; return hrs||''; });
        dayTotal = Math.round(dayTotal*100)/100;
        let status='';
        if (dateStr>today) status='Future';
        else if (leavesSet.has(dateStr)) status='Leave';
        else if (dayTotal>0) status='Done';
        else if (dt.getDay()===0||dt.getDay()===6) status='Weekend';
        else status='No entry';
        const row = ws.addRow([dateStr, dayNames[dt.getDay()], ...catVals, dayTotal||'', status]);
        borderRow(row, 2+cats.length+2);
        if (dt.getDay()===0||dt.getDay()===6) row.eachCell(cell=>{ cell.fill=GRAY_FILL; });
      }
    } catch(e) { console.error('Monthly entries failed', e); }

    // ── 3. Yearly ──────────────────────────────────────────────────────────
    try {
      const year = state.yearlyYear;
      const months = Object.keys(allData).filter(mo=>mo.startsWith(`${year}-`)).sort();
      if (months.length) {
        const allCats = [...new Set(months.flatMap(mo=>(allData[mo].categories||[]).map(c=>c.category)))];
        const ws = wb.addWorksheet(`Yearly ${year}`);
        ws.getColumn(1).width = 18; ws.getColumn(2).width = 14;
        allCats.forEach((_,i)=>{ ws.getColumn(3+i).width = 14; });
        ws.getColumn(3+allCats.length).width = 12;
        ws.getColumn(4+allCats.length).width = 10;
        ws.getColumn(5+allCats.length).width = 12;
        ws.getColumn(6+allCats.length).width = 12;
        ws.getColumn(7+allCats.length).width = 36;

        const hRow = ws.addRow(['Month','Working Days',...allCats,'Total Done','Social + Unwanted','GYM Days','MMA Days','Sleep','Comments']);
        styleRow(hRow, 2+allCats.length+6, BLUE_FILL, BLUE_FONT);
        const today = todayStr();
        months.forEach(month => {
          const mData = allData[month];
          const [y,mo] = month.split('-').map(Number);
          const leavesSet = new Set(mData.leaves||[]);
          const isCur = month===today.slice(0,7);
          const endDay = isCur ? new Date().getDate() : daysInMonth(y,mo);
          let workingDays=0;
          for (let d=1;d<=endDay;d++){const dt=new Date(y,mo-1,d);const ds=`${month}-${String(d).padStart(2,'0')}`;if(dt.getDay()!==0&&dt.getDay()!==6&&!leavesSet.has(ds))workingDays++;}
          const catMap = Object.fromEntries((mData.categories||[]).map(c=>[c.category,c.daily_target]));
          const ents = mData.entries||{};
          let mDone=0;
          const catCells = allCats.map(cat=>{
            let done=0; Object.values(ents).forEach(dayE=>{done+=dayE[cat]||0;}); done=Math.round(done*100)/100; mDone+=done;
            return done||'';
          });
          let mWasted=0; Object.values(mData.wastedEntries||{}).forEach(arr=>arr.forEach(e=>{mWasted+=e.hours||0;})); mWasted=Math.round(mWasted*100)/100;
          const mbd2 = mData.fitnessBreakdown||{};
          const mGym = Object.values(mbd2).filter(d=>(d.fitGYM||0)>0).length;
          const mMma = Object.values(mbd2).filter(d=>(d.fitMMA||0)>0).length;
          const mSleep = Math.round(Object.values(mData.sleep||{}).reduce((s,h)=>s+(h||0),0)*100)/100;
          const comment = mData.yearlyComment||'';
          const row = ws.addRow([formatMonth(month), workingDays, ...catCells, Math.round(mDone*100)/100||'', mWasted||'', mGym||'', mMma||'', mSleep||'', comment]);
          borderRow(row, 2+allCats.length+6);
        });
      }
    } catch(e) { console.error('Yearly failed', e); }

    // ── 4. Journal ─────────────────────────────────────────────────────────
    try {
      const fmEntries = (userData.fmLog||[]).slice().sort((a,b)=>a.date.localeCompare(b.date));
      if (fmEntries.length) {
        const ws = wb.addWorksheet('E - Journal');
        ws.getColumn(1).width=14; ws.getColumn(2).width=20; ws.getColumn(3).width=42; ws.getColumn(4).width=42;
        const hRow = ws.addRow(['Date','Category','Title','Notes']);
        styleRow(hRow, 4, BLUE_FILL, BLUE_FONT);
        fmEntries.forEach(e => {
          const row = ws.addRow([e.date, e.type, e.name, e.notes||'']);
          borderRow(row, 4);
        });
      }
    } catch(e) { console.error('Journal failed', e); }

    // ── 5. Categories ──────────────────────────────────────────────────────
    try {
      const month = state.mainMonth;
      const data = await getMonthData(month);
      const cats = data.categories || [];
      if (cats.length) {
        const ws = wb.addWorksheet('E - Categories');
        ws.getColumn(1).width = 30; ws.getColumn(2).width = 20;
        const hRow = ws.addRow(['Category', 'Daily Target (hrs)']);
        styleRow(hRow, 2, BLUE_FILL, BLUE_FONT);
        cats.forEach(c => { const row = ws.addRow([c.category, c.daily_target]); borderRow(row, 2); });
      }
    } catch(e) { console.error('Categories failed', e); }

    // ── 6. Leaves ──────────────────────────────────────────────────────────
    try {
      const month = state.mainMonth;
      const data = await getMonthData(month);
      const leaves = (data.leaves || []).slice().sort();
      if (leaves.length) {
        const ws = wb.addWorksheet('E - Leaves');
        ws.getColumn(1).width = 16;
        const hRow = ws.addRow(['Leave Date']);
        styleRow(hRow, 1, BLUE_FILL, BLUE_FONT);
        leaves.forEach(d => { const row = ws.addRow([d]); borderRow(row, 1); });
      }
    } catch(e) { console.error('Leaves failed', e); }

    // ── 7. Social Media & Unwanted (breakdown by category) ──────────────────
    try {
      const month = state.mainMonth;
      const data = await getMonthData(month);
      const dates = new Set([
        ...Object.keys(data.wastedBreakdown || {}),
        ...Object.keys(data.wastedEntries || {})
      ]);
      const rows = [];
      [...dates].sort().forEach(date => {
        const bd = getWastedBreakdown(data, date);
        const vals = WASTED_SUBS.map(w => bd[w] || '');
        if (WASTED_SUBS.some(w => (bd[w] || 0) > 0)) rows.push([date, ...vals]);
      });
      if (rows.length) {
        const ws = wb.addWorksheet('E - Wasted Time');
        ws.getColumn(1).width = 14;
        WASTED_SUBS.forEach((_, i) => { ws.getColumn(2 + i).width = 12; });
        const hRow = ws.addRow(['Date', ...WASTED_SUBS]);
        styleRow(hRow, 1 + WASTED_SUBS.length, BLUE_FILL, BLUE_FONT);
        rows.forEach(r => { const row = ws.addRow(r); borderRow(row, 1 + WASTED_SUBS.length); });
      }
    } catch(e) { console.error('Wasted Time failed', e); }

    // ── 7b. Sleep ───────────────────────────────────────────────────────────
    try {
      const month = state.mainMonth;
      const data = await getMonthData(month);
      const sleep = data.sleep || {};
      const dates = Object.keys(sleep).filter(d => (sleep[d] || 0) > 0).sort();
      if (dates.length) {
        const ws = wb.addWorksheet('E - Sleep');
        ws.getColumn(1).width = 14; ws.getColumn(2).width = 12;
        const hRow = ws.addRow(['Date', 'Hours']);
        styleRow(hRow, 2, BLUE_FILL, BLUE_FONT);
        dates.forEach(d => { const row = ws.addRow([d, sleep[d]]); borderRow(row, 2); });
      }
    } catch(e) { console.error('Sleep failed', e); }

    // ── 8. Adjustments ─────────────────────────────────────────────────────
    try {
      const month = state.mainMonth;
      const data = await getMonthData(month);
      const adjustments = data.adjustments || {};
      const entries = Object.entries(adjustments).filter(([,v]) => v !== 0);
      if (entries.length) {
        const ws = wb.addWorksheet('E - Adjustments');
        ws.getColumn(1).width = 30; ws.getColumn(2).width = 18;
        const hRow = ws.addRow(['Category', 'Adjustment (hrs)']);
        styleRow(hRow, 2, BLUE_FILL, BLUE_FONT);
        entries.forEach(([cat, val]) => { const row = ws.addRow([cat, val]); borderRow(row, 2); });
      }
    } catch(e) { console.error('Adjustments failed', e); }

    // ── 9. Habits ──────────────────────────────────────────────────────────
    try {
      const habits = userData.habits && userData.habits.length ? userData.habits : (state.habits || []);
      const habitLog = userData.habitLog || {};
      if (habits.length) {
        const ws = wb.addWorksheet('E - Habits');
        // Section 1: habit list
        const listHRow = ws.addRow(['Habit Name']);
        styleRow(listHRow, 1, BLUE_FILL, BLUE_FONT);
        ws.getColumn(1).width = 30;
        habits.forEach(h => { const row = ws.addRow([h]); borderRow(row, 1); });

        ws.addRow([]);

        // Section 2: log grid — rows = dates, cols = habits
        const dates = Object.keys(habitLog).sort();
        if (dates.length) {
          const gridHRow = ws.addRow(['Date', ...habits]);
          styleRow(gridHRow, 1 + habits.length, BLUE_FILL, BLUE_FONT);
          habits.forEach((_, i) => { ws.getColumn(2 + i).width = 20; });
          dates.forEach(d => {
            const vals = habits.map(h => { const s = (habitLog[d]||{})[h]; return s === true ? 'Yes' : s === 'missed' ? 'Missed' : ''; });
            const row = ws.addRow([d, ...vals]);
            borderRow(row, 1 + habits.length);
          });
        }
      }
    } catch(e) { console.error('Habits failed', e); }

    // ── 10. Planner — each planner tab = one sheet, blocks stacked ─────────
    try {
      const exportPlanners = (state.planners && state.planners.length) ? state.planners : (userData.planners || []);
      exportPlanners.forEach(pl => {
        const ws = wb.addWorksheet(sanitizeName(`E - ${pl.name}`));
        let firstBlock = true;
        (pl.blocks||[]).forEach(block => {
          const cols = block.cols||['Col1','Col2'];
          if (!firstBlock) ws.addRow([]); // blank row between blocks
          firstBlock = false;

          // Block header spanning full width
          const bRow = ws.addRow([block.header]);
          bRow.height = 20;
          const bCell = bRow.getCell(1);
          bCell.fill = GREEN_FILL; bCell.font = GREEN_FONT; bCell.border = BORDER;
          bCell.alignment = { vertical:'middle' };

          // Column headers
          const cRow = ws.addRow(cols);
          styleRow(cRow, cols.length, LTGREEN_FILL, LTGREEN_FONT);

          // Data rows
          (block.rows||[]).forEach(r => {
            const row = ws.addRow(cols.map((_,ci)=>r['c'+ci]||''));
            borderRow(row, cols.length);
          });
        });
        // Set column widths based on widest block
        const maxCols = Math.max(...(pl.blocks||[]).map(b=>(b.cols||[]).length), 1);
        for (let c=1; c<=maxCols; c++) ws.getColumn(c).width = 35;
      });
    } catch(e) { console.error('Planner failed', e); }

    // ── Download ────────────────────────────────────────────────────────────
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const _now = new Date();
    const _d = `${String(_now.getDate()).padStart(2,'0')}-${String(_now.getMonth()+1).padStart(2,'0')}-${_now.getFullYear()}`;
    const _t = `${_now.getHours()}-${String(_now.getMinutes()).padStart(2,'0')}`;
    a.download = `Timesheet_${_d}_${_t}.xlsx`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Excel downloaded');
  } catch(e) { console.error('Excel export failed', e); showToast('Excel export failed'); }
}

// ══════════════════════════════════════════════════════════════════════════
//  EXCEL IMPORT
// ══════════════════════════════════════════════════════════════════════════

let _importPending = null;

function closeImportModal() {
  document.getElementById('import-modal').style.display = 'none';
  document.getElementById('import-file-input').value = '';
  _importPending = null;
}

async function importExcel(input) {
  const file = input.files[0];
  if (!file) return;
  if (typeof XLSX === 'undefined') { showToast('Refresh the page and try again (library not loaded)'); return; }
  showToast('Reading file...');
  try {
    // Use FileReader for maximum browser compatibility
    const buf = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
    const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });

    // ── helpers ────────────────────────────────────────────────────────────
    function sv(v) { // safe string value from a raw cell value
      if (v === null || v === undefined) return '';
      if (v instanceof Date) {
        const d = v;
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      }
      return String(v).trim();
    }
    function nv(v) { return typeof v === 'number' ? v : (parseFloat(v) || 0); }

    // sheet_to_json with header:1 gives rows as plain value arrays
    function getRows(sheetName) {
      const ws = wb.Sheets[sheetName];
      if (!ws) return [];
      return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
    }

    // ── parse each E- sheet ────────────────────────────────────────────────
    const parsed = {};

    for (const name of wb.SheetNames) {
      const rows = getRows(name);
      if (rows.length < 2) continue;

      // E - Monthly Entries
      if (name === 'E - Monthly Entries') {
        const header = rows[0].map(sv);
        // categories sit between Date,Day and Total (find Total index)
        const totalIdx = header.indexOf('Total');
        const cats = totalIdx > 2 ? header.slice(2, totalIdx) : [];
        const entries = {};
        let month = null;
        for (let i = 1; i < rows.length; i++) {
          const dateStr = sv(rows[i][0]);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
          if (!month) month = dateStr.slice(0, 7);
          const dayData = {};
          cats.forEach((cat, ci) => { const hrs = nv(rows[i][2 + ci]); if (hrs) dayData[cat] = hrs; });
          if (Object.keys(dayData).length) entries[dateStr] = dayData;
        }
        if (month) parsed.monthlyEntries = { month, entries };
      }

      // E - Journal
      else if (name === 'E - Journal') {
        const fmLog = [];
        for (let i = 1; i < rows.length; i++) {
          const date = sv(rows[i][0]), type = sv(rows[i][1]), name2 = sv(rows[i][2]), notes = sv(rows[i][3]);
          if (date && name2) fmLog.push({ id: pId(), date, type, name: name2, notes });
        }
        if (fmLog.length) parsed.fmLog = fmLog;
      }

      // E - Categories
      else if (name === 'E - Categories') {
        const categories = [];
        for (let i = 1; i < rows.length; i++) {
          const category = sv(rows[i][0]);
          if (category) categories.push({ category, daily_target: nv(rows[i][1]) });
        }
        if (categories.length) parsed.categories = categories;
      }

      // E - Leaves
      else if (name === 'E - Leaves') {
        const leaves = [];
        for (let i = 1; i < rows.length; i++) {
          const d = sv(rows[i][0]);
          if (/^\d{4}-\d{2}-\d{2}$/.test(d)) leaves.push(d);
        }
        if (leaves.length) parsed.leaves = leaves;
      }

      // E - Wasted Time (Social Media & Unwanted breakdown)
      else if (name === 'E - Wasted Time') {
        const header = rows[0].map(sv);
        const isBreakdown = WASTED_SUBS.some(w => header.includes(w));
        const wastedBreakdown = {};
        const wastedEntries = {};
        for (let i = 1; i < rows.length; i++) {
          const date = sv(rows[i][0]);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
          if (isBreakdown) {
            const bd = {};
            let tot = 0;
            WASTED_SUBS.forEach((w, ci) => {
              const colIdx = header.indexOf(w);
              const h = colIdx >= 0 ? nv(rows[i][colIdx]) : 0;
              if (h) { bd[w] = h; tot += h; }
            });
            if (Object.keys(bd).length) {
              wastedBreakdown[date] = bd;
              wastedEntries[date] = [{ hours: Math.round(tot * 100) / 100, note: '' }];
            }
          } else {
            // legacy format: Date, Hours, Note
            const hours = nv(rows[i][1]), note = sv(rows[i][2]);
            if (hours) { wastedEntries[date] = [{ hours, note }]; }
          }
        }
        if (Object.keys(wastedBreakdown).length) parsed.wastedBreakdown = wastedBreakdown;
        if (Object.keys(wastedEntries).length) parsed.wastedEntries = wastedEntries;
      }

      // E - Sleep
      else if (name === 'E - Sleep') {
        const sleep = {};
        for (let i = 1; i < rows.length; i++) {
          const date = sv(rows[i][0]), hours = nv(rows[i][1]);
          if (/^\d{4}-\d{2}-\d{2}$/.test(date) && hours) sleep[date] = hours;
        }
        if (Object.keys(sleep).length) parsed.sleep = sleep;
      }

      // E - Adjustments
      else if (name === 'E - Adjustments') {
        const adjustments = {};
        for (let i = 1; i < rows.length; i++) {
          const cat = sv(rows[i][0]);
          if (cat) adjustments[cat] = nv(rows[i][1]);
        }
        if (Object.keys(adjustments).length) parsed.adjustments = adjustments;
      }

      // E - Habits
      else if (name === 'E - Habits') {
        const habits = [], habitLog = {};
        let inLog = false, logHabits = [];
        for (let i = 1; i < rows.length; i++) {
          const first = sv(rows[i][0]);
          const rowEmpty = rows[i].every(v => !sv(v));
          if (!inLog && rowEmpty) { inLog = true; continue; }
          if (!inLog) { if (first) habits.push(first); }
          else {
            if (!logHabits.length) { logHabits = rows[i].slice(1).map(sv).filter(Boolean); continue; }
            if (!first) continue;
            const dayLog = {};
            logHabits.forEach((h, hi) => {
              const v = sv(rows[i][1+hi]).toLowerCase();
              if (v === 'yes') dayLog[h] = true;
              else if (v === 'missed') dayLog[h] = 'missed';
            });
            if (Object.keys(dayLog).length) habitLog[first] = dayLog;
          }
        }
        if (habits.length) parsed.habits = { habits, habitLog };
      }

      // E - Planner sheets
      else if (name.startsWith('E - ')) {
        const plannerName = name.slice(4).trim();
        const blocks = [];
        let block = null, expectingCols = false;
        for (let i = 0; i < rows.length; i++) {
          const firstVal = sv(rows[i][0]);
          const rowVals = rows[i].map(sv);
          const nonEmpty = rowVals.filter(Boolean).length;
          if (!nonEmpty) { block = null; expectingCols = false; continue; }
          if (!block) { block = { header: firstVal, cols: [], rows: [] }; blocks.push(block); expectingCols = true; continue; }
          if (expectingCols) { block.cols = rowVals.filter(Boolean); expectingCols = false; continue; }
          const rowObj = {};
          block.cols.forEach((_, ci) => { rowObj[`c${ci}`] = sv(rows[i][ci]) || ''; });
          block.rows.push(rowObj);
        }
        if (blocks.length) { if (!parsed.planners) parsed.planners = []; parsed.planners.push({ id: pId(), name: plannerName, blocks }); }
      }
    }

    // ── detect month ───────────────────────────────────────────────────────
    const month = parsed.monthlyEntries?.month
      || parsed.leaves?.[0]?.slice(0, 7)
      || (parsed.wastedEntries && Object.keys(parsed.wastedEntries).sort()[0]?.slice(0, 7))
      || state.mainMonth;

    // ── build summary for confirmation modal ───────────────────────────────
    const lines = [];
    if (parsed.monthlyEntries) lines.push(`• Monthly entries for <b>${formatMonth(month)}</b> (${Object.keys(parsed.monthlyEntries.entries).length} days)`);
    if (parsed.categories)    lines.push(`• ${parsed.categories.length} categories`);
    if (parsed.leaves)        lines.push(`• ${parsed.leaves.length} leave days`);
    if (parsed.wastedEntries) lines.push(`• Wasted time entries`);
    if (parsed.sleep)         lines.push(`• Sleep for ${Object.keys(parsed.sleep).length} days`);
    if (parsed.adjustments)   lines.push(`• Adjustments for ${Object.keys(parsed.adjustments).length} categories`);
    if (parsed.fmLog)         lines.push(`• ${parsed.fmLog.length} journal entries`);
    if (parsed.habits)        lines.push(`• ${parsed.habits.habits.length} habits + log`);
    if (parsed.planners)      lines.push(`• ${parsed.planners.length} planner sheet(s)`);

    if (!lines.length) { showToast('Nothing to import found in file'); closeImportModal(); return; }

    document.getElementById('import-modal-body').innerHTML =
      `Found the following data to import:<br><br>${lines.join('<br>')}` +
      `<br><br><b style="color:#f0a040">This will overwrite existing data for the affected month/sections.</b>`;

    _importPending = { parsed, month };
    document.getElementById('import-modal').style.display = 'flex';
    document.getElementById('import-confirm-btn').onclick = confirmImport;

  } catch(e) {
    console.error('Import read failed', e);
    showToast(`Import failed: ${e.message || String(e)}`);
    closeImportModal();
  }
}

async function confirmImport() {
  if (!_importPending) return;
  const { parsed, month } = _importPending;
  closeImportModal();
  showToast('Importing...');
  try {
    // Load existing month doc to merge into
    const monthData = await getMonthData(month);

    if (parsed.categories)     monthData.categories      = parsed.categories;
    if (parsed.leaves)         monthData.leaves          = parsed.leaves;
    if (parsed.wastedEntries)  monthData.wastedEntries   = parsed.wastedEntries;
    if (parsed.wastedBreakdown) monthData.wastedBreakdown = parsed.wastedBreakdown;
    if (parsed.sleep)          monthData.sleep           = parsed.sleep;
    if (parsed.adjustments)    monthData.adjustments     = parsed.adjustments;
    if (parsed.monthlyEntries) monthData.entries         = parsed.monthlyEntries.entries;

    await saveMonthData(month, monthData);

    if (parsed.fmLog)   await saveUserData({ fmLog: parsed.fmLog });
    if (parsed.habits)  await saveUserData({ habits: parsed.habits.habits, habitLog: parsed.habits.habitLog });
    if (parsed.planners) {
      // Merge imported planners by name — replace matching, append new
      const existing = state.planners || [];
      parsed.planners.forEach(imp => {
        const idx = existing.findIndex(p => p.name === imp.name);
        if (idx >= 0) existing[idx] = imp; else existing.push(imp);
      });
      state.planners = existing;
      await saveUserData({ planners: state.planners });
    }

    // Invalidate caches so tabs reload fresh data
    state.userDataCache = null;

    showToast('Import complete — reload tabs to see changes');
  } catch(e) {
    console.error('Import save failed', e);
    showToast('Import failed — check console');
  }
}

// ══════════════════════════════════════════════════════════════════════════
//  EMAIL REPORT
// ══════════════════════════════════════════════════════════════════════════

async function emailReport() {
  const month = state.mainMonth;
  const data  = await getMonthData(month);
  const today = todayStr();
  const [year, mon] = month.split('-').map(Number);
  const leavesSet = new Set(data.leaves);
  const entries   = data.entries;

  const todayDate = new Date();
  const endDay = (year === todayDate.getFullYear() && mon === todayDate.getMonth() + 1)
    ? todayDate.getDate() : daysInMonth(year, mon);
  let workingDays = 0;
  for (let d = 1; d <= endDay; d++) {
    const dt = new Date(year, mon - 1, d);
    const ds = `${month}-${String(d).padStart(2, '0')}`;
    if (dt.getDay() !== 0 && dt.getDay() !== 6 && !leavesSet.has(ds)) workingDays++;
  }

  let rows = '';
  data.categories.forEach(c => {
    let done = 0;
    Object.values(entries).forEach(dayE => { done += dayE[c.category] || 0; });
    done = Math.round(done * 100) / 100;
    const target  = Math.round(c.daily_target * workingDays * 100) / 100;
    const pending = Math.max(0, Math.round((target - done) * 100) / 100);
    const status  = done >= target ? '✅' : '⚠️';
    rows += `<tr>
      <td style="padding:8px 14px;border-bottom:1px solid #f1f5f9">${c.category}</td>
      <td style="padding:8px 14px;border-bottom:1px solid #f1f5f9;text-align:center">${c.daily_target} hrs/day</td>
      <td style="padding:8px 14px;border-bottom:1px solid #f1f5f9;text-align:center">${done}</td>
      <td style="padding:8px 14px;border-bottom:1px solid #f1f5f9;text-align:center">${target}</td>
      <td style="padding:8px 14px;border-bottom:1px solid #f1f5f9;text-align:center">${pending}</td>
      <td style="padding:8px 14px;border-bottom:1px solid #f1f5f9;text-align:center">${status}</td>
    </tr>`;
  });

  const summaryHtml = `
    <div style="font-family:sans-serif;max-width:700px">
      <h2 style="color:#0F172A;margin-bottom:4px">Timesheet Report — ${formatMonth(month)}</h2>
      <p style="color:#64748B;margin-bottom:20px">Working days so far: <strong>${workingDays}</strong></p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="background:#F8FAFC">
            <th style="padding:10px 14px;text-align:left;border-bottom:2px solid #E2E8F0">Category</th>
            <th style="padding:10px 14px;text-align:center;border-bottom:2px solid #E2E8F0">Daily Target</th>
            <th style="padding:10px 14px;text-align:center;border-bottom:2px solid #E2E8F0">Completed</th>
            <th style="padding:10px 14px;text-align:center;border-bottom:2px solid #E2E8F0">Target So Far</th>
            <th style="padding:10px 14px;text-align:center;border-bottom:2px solid #E2E8F0">Pending</th>
            <th style="padding:10px 14px;text-align:center;border-bottom:2px solid #E2E8F0">Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  showToast('Sending email...');
  try {
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      to_email:     state.user.email,
      to_name:      state.user.displayName || 'there',
      month_label:  formatMonth(month),
      summary_html: summaryHtml,
    });
    showToast('Report sent to ' + state.user.email, 3500);
  } catch (e) {
    showToast('Email failed — check EmailJS config in app.js');
    console.error(e);
  }
}

// ══════════════════════════════════════════════════════════════════════════
//  STOPWATCH
// ══════════════════════════════════════════════════════════════════════════

let swInterval = null;
let swElapsed  = 0;   // ms

let dragSrcHabitIdx = null;
let swRunning  = false;
let swStarted  = 0;   // Date.now() when last started

function swTick() {
  const total = swElapsed + (Date.now() - swStarted);
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  document.getElementById('sw-display').textContent =
    `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function swToggle() {
  const btn = document.getElementById('sw-toggle');
  if (!swRunning) {
    swStarted  = Date.now();
    swInterval = setInterval(swTick, 500);
    swRunning  = true;
    btn.textContent = '⏸';
    btn.className   = 'sw-btn sw-stop';
  } else {
    clearInterval(swInterval);
    swElapsed += Date.now() - swStarted;
    swRunning  = false;
    btn.textContent = '▶';
    btn.className   = 'sw-btn sw-start';
  }
}

function swReset() {
  clearInterval(swInterval);
  swElapsed = 0; swRunning = false;
  const btn = document.getElementById('sw-toggle');
  btn.textContent = '▶';
  btn.className   = 'sw-btn sw-start';
  document.getElementById('sw-display').textContent = '00:00:00';
}

// ══════════════════════════════════════════════════════════════════════════
//  PLANNER TAB
// ══════════════════════════════════════════════════════════════════════════

state.activePlannerIdx = 0;
let plannerSaveTimer   = null;

function pId() { return 'p' + Math.random().toString(36).slice(2, 9); }

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function schedulePlannerSave() {
  clearTimeout(plannerSaveTimer);
  plannerSaveTimer = setTimeout(() => saveUserData({ planners: state.planners }), 800);
}

function mkRow(c0, c1) { return { c0: c0 || '', c1: c1 || '' }; }

function defaultWeekdayPlanner() {
  return {
    id: pId(), name: 'Weekday Planner',
    blocks: [
      {
        id: pId(), header: 'Morning till 10:30 am',
        cols: ['Activities', 'Notes'],
        rows: [mkRow(
          '• 7:15 am - Get up + Get ready + Kids dress Iron + GYM MMA Class till 9:30 / 9:45 (optional milk in teashop)\n• Return to Home + Food Protein with Pratheeba + newspaper or TV + Bath + RR + Todo Tracker Note / Regular works Note + decide where to go',
          'Monday: MMA Gym\nTuesday: MMA Gym\nWednesday: MMA Gym or Gym\nThursday: Walking + script / Cycling / kids school drop + walking\nFriday: MMA'
        )]
      },
      {
        id: pId(), header: '10:30 am to 2 pm',
        cols: ['Activities', 'Notes'],
        rows: [mkRow(
          'Start from home to Outside and start productivity. If more out works and return to home only u can stay at home\n\nGoals:\n• FM SS, FM other, AI studies / practice\n• Movie / Books / Stories\n• To do home works\n• To do out works\n• Dhana Break\n• Pratheeba Time\n• Meditation\n• Workshops',
          'Out Options:\n1. One day movie (Wednesday)\n2. Selaiyur Library\n3. Radha Nagar Library\n4. Phoenix mall\n5. New Coworking on Friday or Friends Meeting Place\n6. Big out options - Dhana Studio works / Marriages'
        )]
      },
      {
        id: pId(), header: '2 pm to 3 pm',
        cols: ['Activities', 'Notes'],
        rows: [mkRow('Lunch + Pratheeba and get ready to coworking space / go to hotel and have lunch and go to coworking zone', '')]
      },
      {
        id: pId(), header: '3 pm to 7:30 pm / 8 pm',
        cols: ['Activities', 'Notes'],
        rows: [mkRow(
          'Office works zone:\n1. Office works\n2. Study works\n3. Money Generation works\n4. Goals - FM / Script works\n5. Office friends and breaks\n6. Hari / Dhana break\n7. Spillover\n8. Unplanned: Next day / Long Pending\n9. Enter E (Allowed Items)\n\nNote: you can add minor out shoppings when going out and coming back.',
          ''
        )]
      },
      {
        id: pId(), header: '7:30 pm to 8:00 pm — Fruits Time with Family',
        cols: ['Activities', 'Notes'],
        rows: [mkRow('Fruits Time with Family', '')]
      },
      {
        id: pId(), header: '8 pm Slot',
        cols: ['Activities', 'Notes'],
        rows: [mkRow(
          '1. Dhanasekar / Ravi break\n1b. MMA / Dance class\n2. Family related shopping\n2b. Family outing\n3. Cycling / Walking + Phone calls\n4. Office pending works\n5. Spillover works\n6. Movie / Youtube (Allowed items)\n7. Home cleaning\n8. Unplanned Items: Next days works / long pending works\n10. Dinner with family or Alone',
          ''
        )]
      },
      {
        id: pId(), header: '10 pm',
        cols: ['Activities', 'Notes'],
        rows: [mkRow(
          '1. Kids games and speech\n2. Pratheeba time spend and speech\n3. Productivity: FM / AI\n4. Movies / Story Books\n5. Family phone Calls\n6. Urgent Spillover\n7. Tomorrow planner\n8. Whatsapp update 1, 2\n9. Sleep Early (12 to 12:30)',
          'RR: books, movies, Anantha Vikatan, Nanayam Vijayan / YouTube'
        )]
      }
    ]
  };
}

function defaultWeekendPlanner() {
  return {
    name: 'Weekend Planner',
    blocks: [
      {
        id: pId(), header: 'Monthly Checklist',
        checklistType: 'simple',
        checklistItems: [
          'Family Movie',
          'Besent Nagar',
          'Ramani akka Home',
          'Iyyapathangal',
          'Other Relative Home (Goodwin, Nirmal, Palavakkam)',
          'Friends Movie (Hari / Dhanasekar)',
        ],
        checklistState: {},
      }
    ]
  };
}

function defaultWeeklyChecklistBlock() {
  return {
    id: pId(), header: 'Weekly Checklist',
    checklistType: 'grid',
    checklistRows: ['Morning Movie'],
    checklistCols: ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
    checklistState: {},
  };
}

async function loadPlannerTab() {
  const ud = await getUserData();
  // Treat planners with old nested-array rows as missing (Firestore couldn't save them)
  const hasValidPlanners = ud.planners && ud.planners.length > 0 &&
    ud.planners[0].blocks && ud.planners[0].blocks.length > 0 &&
    ud.planners[0].blocks[0].rows && ud.planners[0].blocks[0].rows.length > 0 &&
    !Array.isArray(ud.planners[0].blocks[0].rows[0]);
  if (!hasValidPlanners) {
    state.planners = [defaultWeekdayPlanner(), defaultWeekendPlanner()];
    await saveUserData({ planners: state.planners });
  } else {
    state.planners = ud.planners;
    let changed = false;
    // Inject Weekly Checklist block into Weekday Planner if missing
    const weekday = state.planners.find(p => p.name === 'Weekday Planner');
    if (weekday && !weekday.blocks.some(b => b.checklistType === 'grid')) {
      weekday.blocks.push(defaultWeeklyChecklistBlock());
      changed = true;
    }
    // Inject Weekend Planner if missing
    if (!state.planners.find(p => p.name === 'Weekend Planner')) {
      state.planners.push(defaultWeekendPlanner());
      changed = true;
    }
    if (changed) await saveUserData({ planners: state.planners });
  }
  if (state.activePlannerIdx >= state.planners.length) state.activePlannerIdx = 0;
  renderPlannerTab();
}

let _plannerDragSrc = null;

function renderPlannerTab() {
  const planners = state.planners;
  const ai       = state.activePlannerIdx;

  // Sub-tabs (draggable)
  document.getElementById('planner-sub-tabs').innerHTML = planners.map((p, i) => `
    <button class="planner-sub-tab${i === ai ? ' active' : ''}" data-idx="${i}"
      draggable="true"
      ondragstart="plannerTabDragStart(event,${i})"
      ondragover="plannerTabDragOver(event,${i})"
      ondrop="plannerTabDrop(event,${i})"
      ondragend="plannerTabDragEnd(event)"
      onclick="switchPlanner(${i})">
      <span class="planner-tab-name" ondblclick="event.stopPropagation();startRenamePlanner(${i})" title="Double-click to rename">${escHtml(p.name)}</span>
      <span class="planner-tab-del" onclick="event.stopPropagation();deletePlanner(${i})" title="Delete">✕</span>
    </button>`).join('');

  const container = document.getElementById('planner-blocks-container');
  if (!planners.length) { container.innerHTML = ''; return; }

  const planner = planners[ai];
  container.innerHTML =
    `<div class="planner-top-bar">
       <button class="btn-secondary planner-add-block-btn" onclick="addPlannerBlock()">+ Add Block</button>
       <button class="btn-secondary planner-export-btn" onclick="exportPlannerToExcel()" title="Export to Excel">⬇ Excel</button>
     </div>` +
    planner.blocks.map((b, bi) => renderPlannerBlock(ai, bi, b)).join('');

  container.querySelectorAll('.planner-cell').forEach(ta => {
    autoResizeTa(ta);
    ta.addEventListener('input', () => autoResizeTa(ta));
  });
}

function renderPlannerBlock(pi, bi, block) {
  const total = state.planners[pi]?.blocks?.length || 0;

  // ── ⋯ menu items based on current mode ──
  let menuItems;
  if (block.checklistType) {
    menuItems = `
      <button onclick="ctxResetPlannerChecklist()">🔄 Reset Checklist</button>
      <button onclick="ctxRemovePlannerChecklist()">✕ Remove Checklist</button>`;
  } else if (block.imageData) {
    menuItems = `<button onclick="ctxTogglePlannerImage()">🗑 Remove Image</button>`;
  } else {
    menuItems = `
      <button onclick="ctxTogglePlannerImage()">🖼 Add Image</button>
      <button onclick="ctxSetPlannerChecklist('simple')">✅ Simple Checklist</button>
      <button onclick="ctxSetPlannerChecklist('grid')">📅 Grid Checklist</button>`;
  }

  // ── body based on mode ──
  let body;
  if (block.checklistType === 'simple') {
    const items = block.checklistItems || [];
    const st = block.checklistState || {};
    const rows = items.map(item => `
      <div class="pcl-row ${st[item] ? 'pcl-done' : ''}">
        <input type="checkbox" class="wc-check" ${st[item] ? 'checked' : ''}
          onchange="togglePlannerCheckItem(${pi},${bi},${JSON.stringify(item)},this.checked)">
        <span class="pcl-label">${escHtml(item)}</span>
        <button class="btn-planner-icon" onclick="removePlannerCheckItem(${pi},${bi},${JSON.stringify(item)})">✕</button>
      </div>`).join('');
    body = `<div class="pcl-simple">${rows}</div>
      <button class="btn-planner-add-row" onclick="addPlannerCheckItem(${pi},${bi})">+ Item</button>`;

  } else if (block.checklistType === 'grid') {
    const gridRows = block.checklistRows || [];
    const gridCols = block.checklistCols || ['Week 1', 'Week 2', 'Week 3', 'Week 4'];
    const st = block.checklistState || {};
    const ths = gridCols.map((col, ci) => `
      <th class="pcl-grid-col-th">
        <input class="pcl-col-input" value="${escHtml(col)}"
          onblur="updatePlannerGridColName(${pi},${bi},${ci},this.value)" onclick="this.select()">
        <button class="btn-planner-icon" title="Remove column" onclick="removePlannerGridCol(${pi},${bi},${ci})">✕</button>
      </th>`).join('');
    const trs = gridRows.map((row, ri) => {
      const cells = gridCols.map((col, ci) => {
        const checked = !!(st[ri] && st[ri][ci]);
        return `<td class="wc-cell"><input type="checkbox" class="wc-check" ${checked ? 'checked' : ''}
          onchange="togglePlannerGridCell(${pi},${bi},${ri},${ci},this.checked)"></td>`;
      }).join('');
      return `<tr>
        <td class="wc-act-col">
          <span class="wc-act-name">${escHtml(row)}</span>
          <button class="btn-planner-icon" onclick="removePlannerGridRow(${pi},${bi},${ri})">✕</button>
        </td>${cells}</tr>`;
    }).join('');
    body = `<div class="table-scroll">
      <table class="data-table weekly-checklist-table pcl-grid-table">
        <thead><tr>
          <th class="wc-act-col">Activity
            <button class="btn-planner-sm pcl-addcol-btn" onclick="addPlannerGridCol(${pi},${bi})">+ Col</button>
          </th>${ths}
        </tr></thead>
        <tbody>${trs}</tbody>
      </table></div>
      <button class="btn-planner-add-row" onclick="addPlannerGridRow(${pi},${bi})">+ Row</button>`;

  } else if (block.imageData) {
    body = `<div class="planner-block-image-wrap">
        <img src="${block.imageData}" class="planner-block-img" alt="block image">
        <input type="file" accept="image/*" id="planner-img-input-${pi}-${bi}" style="display:none" onchange="onPlannerImageChange(event,${pi},${bi})">
        <button class="btn-planner-sm planner-img-replace-btn" onclick="document.getElementById('planner-img-input-${pi}-${bi}').click()">Replace Image</button>
        <div class="planner-img-notes-wrap">
          <label class="planner-img-notes-label">Notes</label>
          <textarea class="planner-img-notes" rows="3" placeholder="Add notes here…"
            onblur="savePlannerImgNotes(${pi},${bi},this.value)">${escHtml(block.imageNotes || '')}</textarea>
        </div>
       </div>`;

  } else {
    // Default: table mode
    const cols = block.cols || ['Column 1', 'Column 2'];
    const rows = block.rows || [];
    const colThs = cols.map((col, ci) => `
      <th class="planner-col-th">
        <div class="planner-col-th-inner">
          <input class="planner-col-name" value="${escHtml(col)}"
            onblur="updatePlannerColName(${pi},${bi},${ci},this.value)" onclick="this.select()">
          ${cols.length > 1 ? `<button class="btn-planner-icon" title="Remove column" onclick="removePlannerColumn(${pi},${bi},${ci})">✕</button>` : ''}
        </div>
      </th>`).join('');
    const bodyRows = rows.map((row, ri) => {
      const cells = cols.map((_, ci) => `
        <td class="planner-cell-td">
          <textarea class="planner-cell" rows="1"
            onblur="updatePlannerCell(${pi},${bi},${ri},${ci},this.value)">${escHtml(row['c'+ci] || '')}</textarea>
        </td>`).join('');
      return `<tr>${cells}
        <td class="planner-row-del-td">
          <button class="btn-planner-icon" title="Remove row" onclick="removePlannerRow(${pi},${bi},${ri})">✕</button>
        </td></tr>`;
    }).join('');
    body = `<div class="table-scroll">
        <table class="planner-table">
          <thead><tr>${colThs}
            <th class="planner-row-del-td"></th>
          </tr></thead>
          <tbody>${bodyRows}</tbody>
        </table>
       </div>
       <button class="btn-planner-add-row" onclick="addPlannerRow(${pi},${bi})">+ Row</button>`;
  }

  return `
    <div class="planner-block card">
      <div class="planner-block-titlebar">
        <input class="planner-block-title" value="${escHtml(block.header)}"
          onblur="updatePlannerBlockHeader(${pi},${bi},this.value)">
        <div class="planner-block-actions">
          ${!block.checklistType && !block.imageData ? `<button class="btn-planner-addcol-title" onclick="addPlannerColumn(${pi},${bi})" title="Add column">+ Col</button>` : ''}
          ${bi > 0 ? `<button class="btn-planner-move" onclick="movePlannerBlockUp(${pi},${bi})" title="Move up">↑</button>` : ''}
          ${bi < total - 1 ? `<button class="btn-planner-move" onclick="movePlannerBlockDown(${pi},${bi})" title="Move down">↓</button>` : ''}
          <div class="planner-block-menu-wrap">
            <button class="btn-planner-more" onclick="togglePlannerBlockMenu(event,${pi},${bi})" title="More options">⋯</button>
            <div class="planner-block-dropdown hidden" id="pbm-${pi}-${bi}">
              ${menuItems}
              <button onclick="ctxDeletePlannerBlock()">🗑 Delete</button>
            </div>
          </div>
        </div>
      </div>
      ${body}
    </div>`;
}

function autoResizeTa(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

function switchPlanner(idx) {
  state.activePlannerIdx = idx;
  renderPlannerTab();
}

function plannerTabDragStart(e, i) {
  _plannerDragSrc = i;
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => document.querySelectorAll('.planner-sub-tab')[i]?.classList.add('dragging'), 0);
}

function plannerTabDragOver(e, i) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.planner-sub-tab').forEach((t, idx) => {
    t.classList.toggle('drag-over', idx === i && idx !== _plannerDragSrc);
  });
}

function plannerTabDragEnd() {
  document.querySelectorAll('.planner-sub-tab').forEach(t => t.classList.remove('dragging', 'drag-over'));
  _plannerDragSrc = null;
}

async function plannerTabDrop(e, i) {
  e.preventDefault();
  if (_plannerDragSrc === null || _plannerDragSrc === i) return;
  const [moved] = state.planners.splice(_plannerDragSrc, 1);
  state.planners.splice(i, 0, moved);
  state.activePlannerIdx = i;
  await saveUserData({ planners: state.planners });
  renderPlannerTab();
}

function startRenamePlanner(idx) {
  const nameEl = document.querySelector(`.planner-sub-tab[data-idx="${idx}"] .planner-tab-name`);
  if (!nameEl) return;
  const original = state.planners[idx].name;
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.value = original;
  inp.className = 'planner-tab-rename-input';
  inp.onclick = e => e.stopPropagation();
  nameEl.replaceWith(inp);
  inp.focus(); inp.select();
  let done = false;
  const commit = async () => {
    if (done) return; done = true;
    const name = inp.value.trim() || original;
    state.planners[idx].name = name;
    await saveUserData({ planners: state.planners });
    renderPlannerTab();
  };
  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter')  inp.blur();
    if (e.key === 'Escape') { inp.value = original; inp.blur(); }
  });
}

async function addPlanner() {
  const name = prompt('Planner name:');
  if (!name || !name.trim()) return;
  state.planners.push({ id: pId(), name: name.trim(), blocks: [] });
  state.activePlannerIdx = state.planners.length - 1;
  await saveUserData({ planners: state.planners });
  renderPlannerTab();
}

async function deletePlanner(idx) {
  if (!confirm(`Delete planner "${state.planners[idx].name}"?`)) return;
  state.planners.splice(idx, 1);
  if (state.activePlannerIdx >= state.planners.length) state.activePlannerIdx = Math.max(0, state.planners.length - 1);
  await saveUserData({ planners: state.planners });
  renderPlannerTab();
}

async function addPlannerBlock() {
  const pi = state.activePlannerIdx;
  state.planners[pi].blocks.unshift({ id: pId(), header: 'New Block', cols: ['Column 1', 'Column 2'], rows: [{ c0: '', c1: '' }] });
  await saveUserData({ planners: state.planners });
  renderPlannerTab();
}

async function movePlannerBlockUp(pi, bi) {
  if (bi === 0) return;
  const blocks = state.planners[pi].blocks;
  [blocks[bi - 1], blocks[bi]] = [blocks[bi], blocks[bi - 1]];
  await saveUserData({ planners: state.planners });
  renderPlannerTab();
}

async function movePlannerBlockDown(pi, bi) {
  const blocks = state.planners[pi].blocks;
  if (bi >= blocks.length - 1) return;
  [blocks[bi], blocks[bi + 1]] = [blocks[bi + 1], blocks[bi]];
  await saveUserData({ planners: state.planners });
  renderPlannerTab();
}

async function deletePlannerBlock(pi, bi) {
  if (!confirm('Delete this block?')) return;
  state.planners[pi].blocks.splice(bi, 1);
  await saveUserData({ planners: state.planners });
  renderPlannerTab();
}

// ── Block context menu ─────────────────────────────────────────────────────

let _ctxPi = null, _ctxBi = null;

function togglePlannerBlockMenu(e, pi, bi) {
  e.stopPropagation();
  const menuId = `pbm-${pi}-${bi}`;
  // Close any open dropdown
  document.querySelectorAll('.planner-block-dropdown').forEach(d => {
    if (d.id !== menuId) d.classList.add('hidden');
  });
  _ctxPi = pi; _ctxBi = bi;
  document.getElementById(menuId)?.classList.toggle('hidden');
}

function hidePlannerBlockMenu() {
  document.querySelectorAll('.planner-block-dropdown').forEach(d => d.classList.add('hidden'));
}

document.addEventListener('click', hidePlannerBlockMenu);
document.addEventListener('keydown', e => { if (e.key === 'Escape') hidePlannerBlockMenu(); });

async function ctxDuplicatePlannerBlock() {
  hidePlannerBlockMenu();
  if (_ctxPi === null || _ctxBi === null) return;
  const src = state.planners[_ctxPi].blocks[_ctxBi];
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = pId();
  copy.header = src.header + ' (Copy)';
  state.planners[_ctxPi].blocks.splice(_ctxBi + 1, 0, copy);
  await saveUserData({ planners: state.planners });
  renderPlannerTab();
}

async function ctxDeletePlannerBlock() {
  hidePlannerBlockMenu();
  if (_ctxPi === null || _ctxBi === null) return;
  if (!confirm('Delete this block?')) return;
  state.planners[_ctxPi].blocks.splice(_ctxBi, 1);
  await saveUserData({ planners: state.planners });
  renderPlannerTab();
}

// ── Checklist block ─────────────────────────────────────────────────────────
async function ctxSetPlannerChecklist(type) {
  hidePlannerBlockMenu();
  if (_ctxPi === null || _ctxBi === null) return;
  const block = state.planners[_ctxPi].blocks[_ctxBi];
  block.checklistType = type;
  if (type === 'simple') {
    if (!block.checklistItems) block.checklistItems = [];
    if (!block.checklistState) block.checklistState = {};
  } else {
    if (!block.checklistRows) block.checklistRows = [];
    if (!block.checklistCols) block.checklistCols = ['Week 1', 'Week 2', 'Week 3', 'Week 4'];
    if (!block.checklistState) block.checklistState = {};
  }
  await saveUserData({ planners: state.planners });
  renderPlannerTab();
}

async function ctxRemovePlannerChecklist() {
  hidePlannerBlockMenu();
  if (_ctxPi === null || _ctxBi === null) return;
  if (!confirm('Remove checklist and restore table mode?')) return;
  const block = state.planners[_ctxPi].blocks[_ctxBi];
  delete block.checklistType;
  delete block.checklistItems;
  delete block.checklistRows;
  delete block.checklistCols;
  delete block.checklistState;
  await saveUserData({ planners: state.planners });
  renderPlannerTab();
}

async function ctxResetPlannerChecklist() {
  hidePlannerBlockMenu();
  if (_ctxPi === null || _ctxBi === null) return;
  if (!confirm('Uncheck all items in this checklist?')) return;
  state.planners[_ctxPi].blocks[_ctxBi].checklistState = {};
  await saveUserData({ planners: state.planners });
  renderPlannerTab();
}

// Simple checklist
async function addPlannerCheckItem(pi, bi) {
  const name = prompt('Item name:');
  if (!name?.trim()) return;
  const block = state.planners[pi].blocks[bi];
  if (!block.checklistItems) block.checklistItems = [];
  if (block.checklistItems.includes(name.trim())) { showToast('Already exists'); return; }
  block.checklistItems.push(name.trim());
  await saveUserData({ planners: state.planners });
  renderPlannerTab();
}

async function removePlannerCheckItem(pi, bi, item) {
  const block = state.planners[pi].blocks[bi];
  block.checklistItems = (block.checklistItems || []).filter(i => i !== item);
  if (block.checklistState) delete block.checklistState[item];
  await saveUserData({ planners: state.planners });
  renderPlannerTab();
}

async function togglePlannerCheckItem(pi, bi, item, val) {
  const block = state.planners[pi].blocks[bi];
  if (!block.checklistState) block.checklistState = {};
  if (val) block.checklistState[item] = true;
  else delete block.checklistState[item];
  await saveUserData({ planners: state.planners });
}

// Grid checklist
async function addPlannerGridRow(pi, bi) {
  const name = prompt('Row / Activity name:');
  if (!name?.trim()) return;
  const block = state.planners[pi].blocks[bi];
  if (!block.checklistRows) block.checklistRows = [];
  block.checklistRows.push(name.trim());
  await saveUserData({ planners: state.planners });
  renderPlannerTab();
}

async function removePlannerGridRow(pi, bi, ri) {
  const block = state.planners[pi].blocks[bi];
  if (block.checklistState) delete block.checklistState[ri];
  // Re-index state after removal
  const newState = {};
  Object.entries(block.checklistState || {}).forEach(([k, v]) => {
    const idx = parseInt(k);
    if (idx < ri) newState[k] = v;
    else if (idx > ri) newState[idx - 1] = v;
  });
  block.checklistRows.splice(ri, 1);
  block.checklistState = newState;
  await saveUserData({ planners: state.planners });
  renderPlannerTab();
}

async function updatePlannerGridColName(pi, bi, ci, val) {
  if (!val.trim()) return;
  state.planners[pi].blocks[bi].checklistCols[ci] = val.trim();
  await saveUserData({ planners: state.planners });
}

async function addPlannerGridCol(pi, bi) {
  const name = prompt('Column name:');
  if (!name?.trim()) return;
  const block = state.planners[pi].blocks[bi];
  if (!block.checklistCols) block.checklistCols = [];
  block.checklistCols.push(name.trim());
  await saveUserData({ planners: state.planners });
  renderPlannerTab();
}

async function removePlannerGridCol(pi, bi, ci) {
  const block = state.planners[pi].blocks[bi];
  block.checklistCols.splice(ci, 1);
  // Re-index col state in each row
  const st = block.checklistState || {};
  Object.keys(st).forEach(ri => {
    const row = st[ri] || {};
    const newRow = {};
    Object.entries(row).forEach(([k, v]) => {
      const idx = parseInt(k);
      if (idx < ci) newRow[k] = v;
      else if (idx > ci) newRow[idx - 1] = v;
    });
    st[ri] = newRow;
  });
  block.checklistState = st;
  await saveUserData({ planners: state.planners });
  renderPlannerTab();
}

async function togglePlannerGridCell(pi, bi, ri, ci, val) {
  const block = state.planners[pi].blocks[bi];
  if (!block.checklistState) block.checklistState = {};
  if (!block.checklistState[ri]) block.checklistState[ri] = {};
  if (val) block.checklistState[ri][ci] = true;
  else delete block.checklistState[ri][ci];
  await saveUserData({ planners: state.planners });
}

async function ctxTogglePlannerImage() {
  hidePlannerBlockMenu();
  if (_ctxPi === null || _ctxBi === null) return;
  const block = state.planners[_ctxPi].blocks[_ctxBi];
  if (block.imageData) {
    if (!confirm('Remove image from this block?')) return;
    delete block.imageData;
    await saveUserData({ planners: state.planners });
    renderPlannerTab();
  } else {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = e => onPlannerImageChange(e, _ctxPi, _ctxBi);
    input.click();
  }
}

async function onPlannerImageChange(e, pi, bi) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async ev => {
    state.planners[pi].blocks[bi].imageData = ev.target.result;
    await saveUserData({ planners: state.planners });
    renderPlannerTab();
  };
  reader.readAsDataURL(file);
}

async function savePlannerImgNotes(pi, bi, val) {
  state.planners[pi].blocks[bi].imageNotes = val;
  await saveUserData({ planners: state.planners });
}

function exportPlannerToExcel() {
  const planner = state.planners[state.activePlannerIdx];
  if (!planner) return;
  const wsData = [];
  planner.blocks.forEach((block, bi) => {
    if (bi > 0) wsData.push([]);
    wsData.push([block.header || 'Block']);
    wsData.push(block.cols || []);
    (block.rows || []).forEach(row => {
      wsData.push((block.cols || []).map((_, ci) => row['c' + ci] || ''));
    });
  });
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, planner.name.slice(0, 31));
  XLSX.writeFile(wb, `${planner.name}.xlsx`);
}

async function addPlannerRow(pi, bi) {
  const block  = state.planners[pi].blocks[bi];
  const newRow = {};
  block.cols.forEach((_, i) => { newRow['c' + i] = ''; });
  block.rows.push(newRow);
  await saveUserData({ planners: state.planners });
  renderPlannerTab();
}

async function removePlannerRow(pi, bi, ri) {
  state.planners[pi].blocks[bi].rows.splice(ri, 1);
  await saveUserData({ planners: state.planners });
  renderPlannerTab();
}

async function addPlannerColumn(pi, bi) {
  const block  = state.planners[pi].blocks[bi];
  const newIdx = block.cols.length;
  block.cols.push('Column ' + (newIdx + 1));
  block.rows.forEach(row => { row['c' + newIdx] = ''; });
  await saveUserData({ planners: state.planners });
  renderPlannerTab();
}

async function removePlannerColumn(pi, bi, ci) {
  const block = state.planners[pi].blocks[bi];
  if (block.cols.length <= 1) return;
  block.cols.splice(ci, 1);
  block.rows.forEach(row => {
    for (let i = ci; i < block.cols.length; i++) row['c' + i] = row['c' + (i + 1)] || '';
    delete row['c' + block.cols.length];
  });
  await saveUserData({ planners: state.planners });
  renderPlannerTab();
}

function updatePlannerBlockHeader(pi, bi, value) {
  state.planners[pi].blocks[bi].header = value;
  schedulePlannerSave();
}

function updatePlannerColName(pi, bi, ci, value) {
  state.planners[pi].blocks[bi].cols[ci] = value;
  schedulePlannerSave();
}

function updatePlannerCell(pi, bi, ri, ci, value) {
  state.planners[pi].blocks[bi].rows[ri]['c' + ci] = value;
  schedulePlannerSave();
}

// ══════════════════════════════════════════════════════════════════════════
//  DIET TAB
// ══════════════════════════════════════════════════════════════════════════

const DIET_MODELS = ['gemini-2.0-flash-lite', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-2.5-flash'];
const DIET_CIRC  = 2 * Math.PI * 52; // ≈ 326.73

// ── Firestore ──────────────────────────────────────────────────────────────

function dietMonthRef(month) {
  return db.collection('users').doc(state.user.uid).collection('diet_months').doc(month);
}

async function getDietMonthData(month) {
  if (state.dietMonthCache[month]) return state.dietMonthCache[month];
  const doc  = await dietMonthRef(month).get();
  const data = doc.exists ? doc.data() : { days: {} };
  if (!data.days) data.days = {};
  state.dietMonthCache[month] = data;
  return data;
}

async function saveDietMonthData(month, data) {
  await dietMonthRef(month).set(data);
  state.dietMonthCache[month] = data;
  updateDietStats();  // fire-and-forget
}

// ── Settings ───────────────────────────────────────────────────────────────

async function loadDietSettings() {
  const ud = await getUserData();
  state.dietSettings = {
    geminiApiKey:  ud.dietGeminiKey     || '',
    calorieTarget: ud.dietCalorieTarget || 0,
  };
  return state.dietSettings;
}

async function saveDietSettings() {
  const key     = document.getElementById('diet-gemini-key').value.trim();
  const calGoal = parseInt(document.getElementById('diet-calorie-target').value, 10) || 0;
  if (!key) { showToast('Enter a Gemini API key'); return; }
  await saveUserData({ dietGeminiKey: key, dietCalorieTarget: calGoal });
  if (!state.dietSettings) state.dietSettings = {};
  Object.assign(state.dietSettings, { geminiApiKey: key, calorieTarget: calGoal });
  showToast('Diet settings saved');
}

function toggleGeminiKeyVisibility() {
  const inp = document.getElementById('diet-gemini-key');
  const btn = document.getElementById('diet-key-toggle');
  if (inp.type === 'password') { inp.type = 'text';     btn.textContent = 'Hide'; }
  else                         { inp.type = 'password'; btn.textContent = 'Show'; }
}

async function populateDietSettingsFields() {
  const ud   = await getUserData();
  const keyEl = document.getElementById('diet-gemini-key');
  const tgtEl = document.getElementById('diet-calorie-target');
  if (keyEl) keyEl.value = ud.dietGeminiKey     || '';
  if (tgtEl) tgtEl.value = ud.dietCalorieTarget || '';
}

// ── Gemini AI ──────────────────────────────────────────────────────────────

function dietSleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function callGemini(promptText) {
  const key = state.dietSettings?.geminiApiKey;
  if (!key) throw new Error('Gemini API key not configured in Diet Settings.');
  let lastErr;
  for (let mi = 0; mi < DIET_MODELS.length; mi++) {
    const model = DIET_MODELS[mi];
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: promptText }] }],
            generationConfig: { temperature: 0.15, maxOutputTokens: 8192 }
          })
        }
      );
      if (!res.ok) {
        const errTxt = await res.text();
        lastErr = new Error(`Gemini ${model} error ${res.status}: ${errTxt}`);
        if (mi < DIET_MODELS.length - 1) await dietSleep(800);
        continue;
      }
      const json = await res.json();
      return json.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } catch (e) {
      lastErr = e;
      if (mi < DIET_MODELS.length - 1) await dietSleep(1000);
    }
  }
  throw lastErr || new Error('All Gemini models failed.');
}

async function parseFoodWithAI(text) {
  const prompt = `You are a nutrition expert. Parse the food description below and return ONLY a JSON array.

Rules:
- Do NOT split compound food names (e.g. "paneer butter masala" stays as one item)
- Split ONLY at commas or "and"/"&" between clearly distinct foods
- Extract quantity from input (default 1 if not specified)
- CRITICAL: all _per_unit fields must be for EXACTLY 1 unit (1 piece, 1 bowl, 1 g, 1 ml, etc.)
- If unit is "g" or "ml": calories_per_unit = calories in 1 gram or 1 ml (e.g. rice = 1.3 kcal/g, so calories_per_unit=1.3)
- If unit is "piece/bowl/cup/serving": calories_per_unit = calories in that one item
- Example: "200g paneer butter masala" → quantity=200, unit="g", calories_per_unit=1.5 (NOT 300)
- Example: "2 chapathi" → quantity=2, unit="piece", calories_per_unit=90 (for 1 chapathi)
- Use realistic average values for Indian and common foods

Food input: "${text}"

Return ONLY valid JSON array, no markdown, no explanation:
[{"name":"<name>","quantity":<number>,"unit":"<piece|cup|bowl|slice|serving|g|ml>","calories_per_unit":<number>,"protein_g_per_unit":<number>,"carbs_g_per_unit":<number>,"fat_g_per_unit":<number>,"fibre_g_per_unit":<number>}]`;

  const raw = await callGemini(prompt);
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();

  // 1. Full parse
  try { return JSON.parse(cleaned); } catch {}

  // 2. Extract complete [...] block
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrMatch) { try { return JSON.parse(arrMatch[0]); } catch {} }

  // 3. Truncated response — extract every complete {...} object inside the array
  const objMatches = [...cleaned.matchAll(/\{[^{}]*\}/g)].map(m => {
    try { return JSON.parse(m[0]); } catch { return null; }
  }).filter(Boolean);
  if (objMatches.length) return objMatches;

  throw new Error('AI returned unparseable response: ' + cleaned.slice(0, 200));
}

// ── Error modal ────────────────────────────────────────────────────────────

let _dietLastError = null;

function showDietError(err, context) {
  _dietLastError = {
    message:     err.message || String(err),
    provider:    'Gemini',
    modelsTried: DIET_MODELS.join(', '),
    timestamp:   new Date().toISOString(),
    context:     context || '',
    stack:       err.stack || '',
  };
  document.getElementById('diet-error-body').textContent =
    `Error: ${_dietLastError.message}\n\n` +
    `Provider: ${_dietLastError.provider}\n` +
    `Models tried: ${_dietLastError.modelsTried}\n` +
    `Time: ${_dietLastError.timestamp}\n` +
    (_dietLastError.context ? `Context: ${_dietLastError.context}\n` : '') +
    (_dietLastError.stack ? `\nStack:\n${_dietLastError.stack}` : '');
  document.getElementById('diet-error-modal').classList.remove('hidden');
}

function closeDietErrorModal() {
  document.getElementById('diet-error-modal').classList.add('hidden');
}

async function copyDietError() {
  if (!_dietLastError) return;
  await navigator.clipboard.writeText(JSON.stringify(_dietLastError, null, 2));
  showToast('Error details copied');
}

// ── Calorie target ─────────────────────────────────────────────────────────

function getCalorieTarget() {
  const s = state.dietSettings;
  return (s?.calorieTarget > 0) ? s.calorieTarget : 2000;
}

// ── Diet tab load ──────────────────────────────────────────────────────────

async function loadDietTab() {
  await loadDietSettings();
  await populateDietSettingsFields();
  const { geminiApiKey } = state.dietSettings;
  const gate    = document.getElementById('diet-gate');
  const content = document.getElementById('diet-content');
  if (!geminiApiKey) {
    gate.classList.remove('hidden');
    content.classList.add('hidden');
    return;
  }
  gate.classList.add('hidden');
  content.classList.remove('hidden');
  await renderDietDay(state.dietDate);
  setTimeout(renderDietCharts, 80);
}

// ── Date label ─────────────────────────────────────────────────────────────

function formatDietDateLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt  = new Date(y, m - 1, d);
  const DAY = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  const MON = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return `${DAY[dt.getDay()]}, ${MON[m-1]} ${d}`;
}

// ── Day rendering ──────────────────────────────────────────────────────────

async function renderDietDay(dateStr) {
  const month  = dateStr.slice(0, 7);
  const mData  = await getDietMonthData(month);
  const foods  = (mData.days[dateStr] || {}).foods || [];
  const target = getCalorieTarget();
  document.getElementById('diet-date-label').textContent = formatDietDateLabel(dateStr);
  renderDietSummary(foods, target);
  renderFoodCards(foods, dateStr);
  document.getElementById('diet-food-save-row')?.classList.add('hidden');
  const wi = document.getElementById('diet-weight-input');
  if (wi) wi.value = (mData.days[dateStr]?.weight) || '';
  // Update success day count circle async (non-blocking)
  calcDietSuccessDays().then(count => {
    const el = document.getElementById('diet-day-count-num');
    if (el) el.textContent = count;
  });
}

async function saveDayWeight() {
  const kg = parseFloat(document.getElementById('diet-weight-input')?.value);
  if (!kg || kg <= 0) { showToast('Enter a valid weight'); return; }
  const month = state.dietDate.slice(0, 7);
  const mData = await getDietMonthData(month);
  if (!mData.days[state.dietDate]) mData.days[state.dietDate] = {};
  mData.days[state.dietDate].weight = kg;
  await saveDietMonthData(month, mData);
  renderDietCharts();
  showToast('Weight saved: ' + kg + ' kg');
}

function dietCalcTotals(foods) {
  let kcal = 0, protein = 0, carbs = 0, fat = 0, fibre = 0;
  for (const f of foods) {
    const q = f.quantity || 1;
    kcal    += (f.calories_per_unit  || 0) * q;
    protein += (f.protein_g_per_unit || 0) * q;
    carbs   += (f.carbs_g_per_unit   || 0) * q;
    fat     += (f.fat_g_per_unit     || 0) * q;
    fibre   += (f.fibre_g_per_unit   || 0) * q;
  }
  return {
    kcal:    Math.round(kcal),
    protein: Math.round(protein * 10) / 10,
    carbs:   Math.round(carbs   * 10) / 10,
    fat:     Math.round(fat     * 10) / 10,
    fibre:   Math.round(fibre   * 10) / 10,
  };
}

function renderDietSummary(foods, target) {
  const t   = dietCalcTotals(foods);
  const pct = target > 0 ? t.kcal / target : 0;

  // Ring fill & color
  const offset = DIET_CIRC * (1 - Math.min(pct, 1));
  const ringEl = document.getElementById('diet-ring-progress');
  ringEl.style.strokeDashoffset = offset;
  let ringColor = '#C8FF00';
  if      (pct >= 1)    ringColor = '#F87171';
  else if (pct >= 0.75) ringColor = '#F59E0B';
  ringEl.style.stroke = ringColor;

  // Card background tint
  const card = document.querySelector('.diet-summary-card');
  card.classList.remove('diet-bg-success', 'diet-bg-over');
  if (t.kcal > 0 && pct < 1) card.classList.add('diet-bg-success');
  else if (t.kcal > 0 && pct >= 1) card.classList.add('diet-bg-over');

  // Center text
  document.getElementById('diet-consumed-num').textContent = t.kcal;
  document.getElementById('diet-target-num').textContent   = target;

  // Macros
  document.getElementById('diet-protein').textContent = t.protein + 'g';
  document.getElementById('diet-carbs').textContent   = t.carbs   + 'g';
  document.getElementById('diet-fat').textContent     = t.fat     + 'g';
  document.getElementById('diet-fibre').textContent   = t.fibre   + 'g';

  renderDietWarning(pct, t.kcal, target);
}

function renderDietWarning(pct, kcal, target) {
  const banner = document.getElementById('diet-warning-banner');
  if (pct >= 1) {
    banner.className = 'diet-warning diet-warning-red';
    banner.textContent = `⚠️ You've hit your ${target} kcal daily target!`;
    if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
  } else if (pct >= 0.75) {
    banner.className = 'diet-warning diet-warning-yellow';
    banner.textContent = `ℹ️ You're at ${Math.round(pct * 100)}% of your daily target`;
  } else {
    banner.className = 'diet-warning hidden';
    return;
  }
}

// ── Food cards ─────────────────────────────────────────────────────────────

function renderFoodCards(foods, dateStr) {
  const list = document.getElementById('diet-food-list');
  if (!foods.length) {
    list.innerHTML = '<div class="diet-empty">Nothing logged yet — add your first meal</div>';
    return;
  }
  const ds = escHtml(dateStr);
  const rows = foods.map(f => {
    const q       = f.quantity || 1;
    const kcal    = Math.round((f.calories_per_unit  || 0) * q);
    const protein = Math.round((f.protein_g_per_unit || 0) * q * 10) / 10;
    const carbs   = Math.round((f.carbs_g_per_unit   || 0) * q * 10) / 10;
    const fat     = Math.round((f.fat_g_per_unit     || 0) * q * 10) / 10;
    return `<tr id="diet-card-${f.id}">
  <td class="col-name">${escHtml(f.name)}</td>
  <td class="col-time">${escHtml(f.logged_at || '')}</td>
  <td class="col-qty">
    <input class="diet-qty-input" type="number" value="${q}" min="0.5" step="0.5"
           oninput="markDietFoodDirty()">
    <span class="diet-qty-unit">${escHtml(f.unit || '')}</span>
  </td>
  <td class="col-kcal">${kcal}</td>
  <td class="col-num">${protein}g</td>
  <td class="col-num">${carbs}g</td>
  <td class="col-num">${fat}g</td>
  <td><button class="diet-food-del" onclick="deleteDietFood('${ds}','${f.id}')">×</button></td>
</tr>`;
  }).join('');
  const totals = foods.reduce((t, f) => {
    const q = f.quantity || 1;
    t.kcal    += Math.round((f.calories_per_unit  || 0) * q);
    t.protein += (f.protein_g_per_unit || 0) * q;
    t.carbs   += (f.carbs_g_per_unit   || 0) * q;
    t.fat     += (f.fat_g_per_unit     || 0) * q;
    return t;
  }, { kcal: 0, protein: 0, carbs: 0, fat: 0 });
  list.innerHTML = `<table class="diet-food-table">
  <thead><tr>
    <th>FOOD</th><th>TIME</th><th>QTY</th>
    <th>KCAL</th><th>P</th><th>C</th><th>F</th><th></th>
  </tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr class="diet-total-row">
    <td colspan="3"><span class="diet-total-label">TOTAL</span></td>
    <td class="col-kcal">${totals.kcal}</td>
    <td class="col-num">${Math.round(totals.protein * 10) / 10}g</td>
    <td class="col-num">${Math.round(totals.carbs * 10) / 10}g</td>
    <td class="col-num">${Math.round(totals.fat * 10) / 10}g</td>
    <td></td>
  </tr></tfoot>
</table>`;
}

// ── Log food ───────────────────────────────────────────────────────────────

async function logDietFood() {
  const inp  = document.getElementById('diet-food-input');
  const text = inp.value.trim();
  if (!text) return;

  const spinner = document.getElementById('diet-ai-spinner');
  const sendBtn = document.getElementById('diet-send-btn');
  inp.value         = '';
  spinner.classList.remove('hidden');
  sendBtn.disabled  = true;

  try {
    const items = await parseFoodWithAI(text);
    if (!items?.length) { showToast('AI could not parse that — try again'); return; }

    const now   = new Date();
    const tTime = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const month = state.dietDate.slice(0, 7);
    const mData = await getDietMonthData(month);
    if (!mData.days[state.dietDate]) mData.days[state.dietDate] = {};
    if (!mData.days[state.dietDate].foods) mData.days[state.dietDate].foods = [];

    for (const item of items) {
      mData.days[state.dietDate].foods.push({
        id:                pId(),
        name:              (item.name            || 'Unknown').trim(),
        quantity:          parseFloat(item.quantity)            || 1,
        unit:              (item.unit             || 'serving').trim(),
        calories_per_unit: parseFloat(item.calories_per_unit)  || 0,
        protein_g_per_unit:parseFloat(item.protein_g_per_unit) || 0,
        carbs_g_per_unit:  parseFloat(item.carbs_g_per_unit)   || 0,
        fat_g_per_unit:    parseFloat(item.fat_g_per_unit)     || 0,
        fibre_g_per_unit:  parseFloat(item.fibre_g_per_unit)   || 0,
        logged_at:         tTime,
      });
    }

    await saveDietMonthData(month, mData);
    await renderDietDay(state.dietDate);
    renderDietCharts();
    showToast('Logged: ' + items.map(i => i.name).join(', '));
  } catch (e) {
    showDietError(e, `Input: "${text}"`);
  } finally {
    spinner.classList.add('hidden');
    sendBtn.disabled = false;
  }
}

async function updateDietQuantity(dateStr, id, qty) {
  if (!qty || qty < 0.5) return;
  const month = dateStr.slice(0, 7);
  const mData = await getDietMonthData(month);
  const item  = (mData.days[dateStr]?.foods || []).find(f => f.id === id);
  if (!item) return;
  item.quantity = qty;
  await saveDietMonthData(month, mData);
  await renderDietDay(dateStr);
}

async function deleteDietFood(dateStr, id) {
  const month = dateStr.slice(0, 7);
  const mData = await getDietMonthData(month);
  const day   = mData.days[dateStr];
  if (!day) return;
  day.foods = (day.foods || []).filter(f => f.id !== id);
  await saveDietMonthData(month, mData);
  await renderDietDay(dateStr);
  renderDietCharts();
}

// ── Date navigation ────────────────────────────────────────────────────────

function dietPrevDay() {
  const [y, m, d] = state.dietDate.split('-').map(Number);
  const dt  = new Date(y, m - 1, d - 1);
  state.dietDate = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
  renderDietDay(state.dietDate);
}

function dietNextDay() {
  const [y, m, d] = state.dietDate.split('-').map(Number);
  const dt   = new Date(y, m - 1, d + 1);
  const next = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
  if (next > todayStr()) { showToast("Can't go to a future date"); return; }
  state.dietDate = next;
  renderDietDay(state.dietDate);
}

// ── Voice input ────────────────────────────────────────────────────────────

let _dietRecognition = null;
let _dietMicActive   = false;

function dietStartMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { showToast('Voice input not supported in this browser'); return; }
  if (_dietMicActive) { _dietRecognition?.stop(); return; }

  _dietRecognition = new SR();
  _dietRecognition.lang = 'en-IN';
  _dietRecognition.interimResults = false;
  _dietRecognition.maxAlternatives = 1;

  const micBtn = document.getElementById('diet-mic-btn');
  micBtn.classList.add('recording');
  _dietMicActive = true;

  _dietRecognition.onresult = e => {
    document.getElementById('diet-food-input').value = e.results[0][0].transcript;
  };
  _dietRecognition.onend   = () => { micBtn.classList.remove('recording'); _dietMicActive = false; };
  _dietRecognition.onerror = () => { micBtn.classList.remove('recording'); _dietMicActive = false; };
  _dietRecognition.start();
}

// ── Share ──────────────────────────────────────────────────────────────────

async function shareDietSummary() {
  const card = document.querySelector('.diet-summary-card');
  if (!card || typeof html2canvas === 'undefined') { showToast('Share unavailable'); return; }

  const hideEls = card.querySelectorAll('.diet-share-btn, .diet-success-badge');
  hideEls.forEach(el => el.style.visibility = 'hidden');

  showToast('Preparing image…');
  try {
    const cvs = await html2canvas(card, {
      backgroundColor: '#151F32',
      scale: 2,
      logging: false,
      useCORS: true,
      allowTaint: true,
    });

    hideEls.forEach(el => el.style.visibility = '');
    cvs.toBlob(async blob => {
      const file = new File([blob], `diet-${state.dietDate}.png`, { type: 'image/png' });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'Diet Summary' }); return; }
        catch (e) { if (e.name === 'AbortError') return; }
      }
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: `diet-${state.dietDate}.png` });
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    }, 'image/png');
  } catch (e) {
    hideEls.forEach(el => el.style.visibility = '');
    showToast('Image capture failed');
    console.error(e);
  }
}

// ── Bar charts ─────────────────────────────────────────────────────────────

async function renderDietCharts() {
  await renderWeightChart();
  await renderDietMonthlyChart();
  await renderDietYearlyChart();
}

async function renderDietMonthlyChart() {
  const canvas = document.getElementById('diet-monthly-chart');
  if (!canvas || !canvas.offsetParent) return;
  const month     = state.dietDate.slice(0, 7);
  const [y, m]    = month.split('-').map(Number);
  const daysInMon = new Date(y, m, 0).getDate();
  const mData     = await getDietMonthData(month);
  const days      = mData.days || {};

  const labels = [], values = [];
  for (let d = 1; d <= daysInMon; d++) {
    const ds = `${month}-${String(d).padStart(2,'0')}`;
    labels.push(d);
    values.push(dietCalcTotals((days[ds] || {}).foods || []).kcal);
  }

  document.getElementById('diet-monthly-chart-label').textContent = formatMonth(month);
  drawDietBarChart(canvas, labels, values, getCalorieTarget(), parseInt(state.dietDate.split('-')[2], 10));
}

async function renderDietYearlyChart() {
  const canvas = document.getElementById('diet-yearly-chart');
  if (!canvas || !canvas.offsetParent) return;
  const year    = parseInt(state.dietDate.slice(0, 4), 10);
  const now     = new Date();
  const curMon  = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const MON_S   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const labels = [], values = [];
  for (let m = 1; m <= 12; m++) {
    const month = `${year}-${String(m).padStart(2,'0')}`;
    if (month > curMon) break;
    const mData = await getDietMonthData(month);
    const days  = mData.days || {};
    let total   = 0;
    for (const ds of Object.keys(days)) total += dietCalcTotals((days[ds] || {}).foods || []).kcal;
    labels.push(MON_S[m-1]);
    values.push(total);
  }

  document.getElementById('diet-yearly-chart-label').textContent = year;
  drawDietLineChart(canvas, labels, values, 'kcal');
}

async function renderWeightChart() {
  const card = document.getElementById('diet-weight-chart-card');
  const canvas = document.getElementById('diet-weight-chart');
  if (!canvas) return;

  let y = 2026, m = 6;
  const today = todayStr();
  const [ey, em] = today.slice(0, 7).split('-').map(Number);
  const entries = [];

  while (y < ey || (y === ey && m <= em)) {
    const month = `${y}-${String(m).padStart(2, '0')}`;
    const mData = await getDietMonthData(month);
    for (const [ds, dd] of Object.entries(mData.days || {})) {
      if (dd.weight > 0) entries.push({ ds, w: dd.weight });
    }
    m++; if (m > 12) { y++; m = 1; }
  }
  entries.sort((a, b) => a.ds.localeCompare(b.ds));

  if (!entries.length) { if (card) card.style.display = 'none'; renderWeightEntries([]); return; }
  if (card) card.style.display = '';

  const labels  = entries.map(e => e.ds.slice(5));
  const weights = entries.map(e => e.w);
  document.getElementById('diet-weight-chart-label').textContent = entries[0].ds.slice(0, 7) + ' – ' + entries[entries.length - 1].ds.slice(0, 7);
  drawDietLineChart(canvas, labels, weights, 'kg', true);
  renderWeightEntries(entries);
}

function renderWeightEntries(entries) {
  const el = document.getElementById('diet-weight-entries-list');
  if (!el) return;
  if (!entries.length) { el.innerHTML = ''; return; }
  const reversed = [...entries].reverse();
  el.innerHTML = `<div class="weight-entries-list">${reversed.map(e => `
    <div class="weight-entry-row">
      <span class="weight-entry-date">${e.ds.slice(5)}</span>
      <input class="weight-entry-input" type="number" step="0.1" value="${e.w}"
        onblur="saveWeightEntryEdit('${e.ds}',this.value)"
        onkeydown="if(event.key==='Enter')this.blur()">
      <span class="weight-entry-unit">kg</span>
      <button class="weight-entry-del" onclick="deleteWeightEntry('${e.ds}')">✕</button>
    </div>`).join('')}</div>`;
}

async function saveWeightEntryEdit(ds, val) {
  const kg = parseFloat(val);
  if (!kg || kg <= 0) return;
  const month = ds.slice(0, 7);
  const mData = await getDietMonthData(month);
  if (!mData.days) mData.days = {};
  if (!mData.days[ds]) mData.days[ds] = {};
  mData.days[ds].weight = kg;
  await saveDietMonthData(month, mData);
  await renderWeightChart();
  showToast('Weight updated');
}

async function deleteWeightEntry(ds) {
  const month = ds.slice(0, 7);
  const mData = await getDietMonthData(month);
  if (mData.days?.[ds]) {
    delete mData.days[ds].weight;
    await saveDietMonthData(month, mData);
    const wi = document.getElementById('diet-weight-input');
    if (wi && state.dietDate === ds) wi.value = '';
    await renderWeightChart();
    showToast('Entry removed');
  }
}

function drawDietLineChart(canvas, labels, values, unit, showDotLabels = false) {
  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.parentElement?.clientWidth || 600;
  const H   = 180;
  canvas.width        = W * dpr;
  canvas.height       = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const PL = 46, PR = 14, PT = showDotLabels ? 26 : 16, PB = 28;
  const cW = W - PL - PR, cH = H - PT - PB;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.15 || 1;
  const lo  = min - pad, hi = max + pad;
  const n   = labels.length;

  const px = i => PL + (n === 1 ? cW / 2 : (cW * i / (n - 1)));
  const py = v => PT + cH - (cH * (v - lo) / (hi - lo));

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const gy = PT + cH * i / 4;
    ctx.beginPath(); ctx.moveTo(PL, gy); ctx.lineTo(W - PR, gy); ctx.stroke();
    const val = hi - (hi - lo) * i / 4;
    ctx.fillStyle = 'rgba(122,144,176,0.7)';
    ctx.font = '9px -apple-system,sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(val * 10) / 10, PL - 4, gy + 3);
  }

  // Line
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(200,255,0,0.8)';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  values.forEach((v, i) => { i === 0 ? ctx.moveTo(px(i), py(v)) : ctx.lineTo(px(i), py(v)); });
  ctx.stroke();

  // Fill under line
  ctx.beginPath();
  values.forEach((v, i) => { i === 0 ? ctx.moveTo(px(i), py(v)) : ctx.lineTo(px(i), py(v)); });
  ctx.lineTo(px(n - 1), PT + cH);
  ctx.lineTo(px(0), PT + cH);
  ctx.closePath();
  ctx.fillStyle = 'rgba(200,255,0,0.07)';
  ctx.fill();

  // Dots + labels
  const labelEvery = showDotLabels ? Math.ceil(n / 14) : Math.ceil(n / 12);
  values.forEach((v, i) => {
    const x = px(i), y = py(v);
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#C8FF00';
    ctx.fill();
    // Value label above dot
    if (showDotLabels && (n <= 14 || i % labelEvery === 0)) {
      ctx.fillStyle = '#C8FF00';
      ctx.font = `bold 9px -apple-system,sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(v % 1 === 0 ? v : parseFloat(v).toFixed(1), x, y - 7);
    }
    // x-axis date label
    if (n <= 12 || i % Math.ceil(n / 12) === 0) {
      ctx.fillStyle = 'rgba(122,144,176,0.7)';
      ctx.font = '9px -apple-system,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(labels[i], x, H - PB + 14);
    }
  });
}

function drawDietBarChart(canvas, labels, values, targetLine, highlightDay) {
  const dpr  = window.devicePixelRatio || 1;
  const W    = (canvas.parentElement?.clientWidth || 600);
  const H    = 200;
  canvas.width        = W * dpr;
  canvas.height       = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const PL = 46, PR = 14, PT = 16, PB = 28;
  const cW  = W - PL - PR;
  const cH  = H - PT - PB;
  const max = Math.max(...values, targetLine > 0 ? targetLine : 0, 1);
  const bW  = Math.max(4, Math.floor(cW / labels.length) - 4);

  // Grid lines + y-labels
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const gy = PT + cH - (cH * i / 4);
    ctx.beginPath(); ctx.moveTo(PL, gy); ctx.lineTo(W - PR, gy); ctx.stroke();
    const val = Math.round(max * i / 4);
    ctx.fillStyle = 'rgba(122,144,176,0.7)';
    ctx.font = '9px -apple-system,sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(val >= 1000 ? (Math.round(val/100)/10) + 'k' : val, PL - 4, gy + 3);
  }

  // Target dashed line
  if (targetLine > 0) {
    const ty = PT + cH - (cH * Math.min(targetLine, max) / max);
    ctx.strokeStyle = 'rgba(200,255,0,0.3)';
    ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(PL, ty); ctx.lineTo(W - PR, ty); ctx.stroke();
    ctx.setLineDash([]);
  }

  // Bars
  labels.forEach((label, i) => {
    const val    = values[i] || 0;
    const x      = PL + (cW * i / labels.length) + (cW / labels.length - bW) / 2;
    const barH   = val > 0 ? Math.max(2, cH * val / max) : 0;
    const by     = PT + cH - barH;
    const isHigh = i + 1 === highlightDay;

    let alpha = isHigh ? 1 : 0.65;
    let color;
    if (targetLine > 0 && val >= targetLine)        color = `rgba(248,113,113,${alpha})`;
    else if (targetLine > 0 && val >= targetLine*0.75) color = `rgba(245,158,11,${alpha})`;
    else                                             color = `rgba(200,255,0,${alpha})`;

    ctx.fillStyle = color;
    if (barH > 4) {
      const r = Math.min(3, bW/2);
      ctx.beginPath();
      ctx.moveTo(x + r, by);
      ctx.lineTo(x + bW - r, by);
      ctx.quadraticCurveTo(x + bW, by, x + bW, by + r);
      ctx.lineTo(x + bW, by + barH);
      ctx.lineTo(x, by + barH);
      ctx.lineTo(x, by + r);
      ctx.quadraticCurveTo(x, by, x + r, by);
      ctx.fill();
    } else if (barH > 0) {
      ctx.fillRect(x, by, bW, barH);
    }

    // X label
    ctx.fillStyle = isHigh ? '#C8FF00' : 'rgba(122,144,176,0.65)';
    ctx.font = '9px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + bW / 2, H - PB + 12);
  });
}

// ══════════════════════════════════════════════════════════════════════════
//  DIET — FOOD QTY SAVE
// ══════════════════════════════════════════════════════════════════════════

function markDietFoodDirty() {
  document.getElementById('diet-food-save-row')?.classList.remove('hidden');
}

async function saveFoodQtyChanges() {
  const dateStr = state.dietDate;
  const inputs  = document.querySelectorAll('#diet-food-list .diet-qty-input');
  if (!inputs.length) return;
  const month = dateStr.slice(0, 7);
  const mData = await getDietMonthData(month);
  const foods = mData.days[dateStr]?.foods || [];
  let changed = false;
  inputs.forEach(inp => {
    const row = inp.closest('tr');
    const id  = row?.id?.replace('diet-card-', '');
    if (!id) return;
    const item = foods.find(f => f.id === id);
    if (item) {
      const newQty = parseFloat(inp.value) || 0.5;
      if (Math.abs((item.quantity || 1) - newQty) > 0.001) { item.quantity = newQty; changed = true; }
    }
  });
  if (changed) {
    await saveDietMonthData(month, mData);
    await renderDietDay(dateStr);
    showToast('Saved');
  } else {
    document.getElementById('diet-food-save-row')?.classList.add('hidden');
  }
}

// ══════════════════════════════════════════════════════════════════════════
//  DIET — SUCCESS COUNT
// ══════════════════════════════════════════════════════════════════════════

async function calcDietSuccessDays() {
  const target = getCalorieTarget();
  let y = 2026, m = 6;
  const today = todayStr();
  const [ey, em] = today.slice(0, 7).split('-').map(Number);
  let count = 0;
  while (y < ey || (y === ey && m <= em)) {
    const month = `${y}-${String(m).padStart(2, '0')}`;
    const mData = await getDietMonthData(month);
    for (const [ds, day] of Object.entries(mData.days || {})) {
      if (ds > today) continue;
      const kcal = dietCalcTotals(day.foods || []).kcal;
      if (kcal > 0 && kcal <= target) count++;
    }
    m++; if (m > 12) { y++; m = 1; }
  }
  return count;
}

// ══════════════════════════════════════════════════════════════════════════
//  ACCESS CONTROL & ADMIN
// ══════════════════════════════════════════════════════════════════════════

const ADMIN_EMAIL = 'godwin.euphoric@gmail.com';

function isAdmin() {
  return state.user?.email === ADMIN_EMAIL;
}

async function checkUserAccess() {
  if (isAdmin()) {
    document.getElementById('tab-btn-admin')?.classList.remove('hidden');
    hideAccessGate();
    // Ensure admin appears in the users list and leaderboard
    db.collection('user_roles').doc(state.user.uid).set({
      uid: state.user.uid, email: state.user.email,
      displayName: state.user.displayName || '', role: 'admin',
    }, { merge: true }).catch(() => {});
    return 'admin';
  }
  try {
    const roleDoc = await db.collection('user_roles').doc(state.user.uid).get();
    if (roleDoc.exists) {
      const role = roleDoc.data().role;
      state.userRole = role;
      hideAccessGate();
      applyRoleVisibility(role);
      return role;
    }
    // No role — check if request exists
    const reqDoc = await db.collection('access_requests').doc(state.user.uid).get();
    showAccessGate(reqDoc.exists ? reqDoc.data().status : null);
  } catch (e) {
    // On permission error (rules not yet updated), allow access gracefully
    hideAccessGate();
    console.warn('checkUserAccess:', e.message);
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════════════
//  DAILY PLAN TAB
// ══════════════════════════════════════════════════════════════════════════

const DP_COLS = ['c630', 'c730', 'c830', 'morning', 'evening'];
const DP_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DP_DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
let dpData = {};           // dateStr → { c630, c730, c830, morning, evening }
let dpSaveTimer = null;
let dpDirty = new Set();   // dateStrs with unsaved changes
let dpTableBuilt = false;

function dpGetMonday(d) {
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  const m = new Date(d);
  m.setDate(d.getDate() + diff);
  m.setHours(0, 0, 0, 0);
  return m;
}

function dpDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function dpAllDates() {
  const today = new Date();
  const start = dpGetMonday(today);
  start.setDate(start.getDate() - 7); // one week back (last Monday)

  const end = new Date(today.getFullYear(), 11, 31); // Dec 31 this year

  const dates = [];
  const cur = new Date(start);
  while (cur <= end) {
    dates.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

async function loadDailyPlanTab() {
  // Load daily plan data
  const year = String(new Date().getFullYear());
  try {
    const doc = await db.collection('users').doc(state.user.uid)
                        .collection('dailyplan').doc(year).get();
    dpData = doc.exists ? (doc.data().rows || {}) : {};
  } catch(e) {
    dpData = {};
  }

  if (!dpTableBuilt) {
    dpBuildTable();
    dpTableBuilt = true;
  } else {
    dpRefreshInputs();
  }

  // Double RAF: ensures browser has finished layout before measuring
  requestAnimationFrame(() => requestAnimationFrame(() => {
    dpSetTableHeight();
    dpScrollToThisWeek();
  }));

  // Load weekly reference in parallel
  dpLoadWeeklyRef();
}

function dpBuildTable() {
  const tbody = document.getElementById('dp-tbody');
  tbody.innerHTML = '';
  const dates = dpAllDates();
  const todayStr_ = todayStr();

  dates.forEach((d, i) => {
    const ds = dpDateStr(d);
    const dow = d.getDay(); // 0=Sun
    const row = dpData[ds] || {};

    const tr = document.createElement('tr');
    tr.id = `dp-row-${ds}`;
    if (dow === 1 && i > 0) tr.classList.add('dp-week-start'); // Monday = new week
    if (ds === todayStr_)   tr.classList.add('dp-today');
    if (dow === 0)          tr.classList.add('dp-sunday');

    // Date cell
    const tdDate = document.createElement('td');
    tdDate.className = 'dp-date-cell';
    tdDate.textContent = `${String(d.getDate()).padStart(2,'0')} ${DP_MONTHS[d.getMonth()]}`;
    tr.appendChild(tdDate);

    // Day cell
    const tdDay = document.createElement('td');
    tdDay.className = 'dp-day-cell' + (dow === 6 ? ' dp-sat' : dow === 0 ? ' dp-sun' : '');
    tdDay.textContent = DP_DAYS[dow];
    tr.appendChild(tdDay);

    // Editable cells
    DP_COLS.forEach(col => {
      const td = document.createElement('td');
      td.className = 'dp-input-cell';
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'dp-input';
      inp.id = `dp-inp-${ds}-${col}`;
      inp.value = row[col] || '';
      inp.addEventListener('input', () => {
        if (!dpData[ds]) dpData[ds] = {};
        dpData[ds][col] = inp.value;
        dpDirty.add(ds);
        dpScheduleSave();
      });
      td.appendChild(inp);
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });
}

function dpRefreshInputs() {
  const dates = dpAllDates();
  dates.forEach(d => {
    const ds = dpDateStr(d);
    const row = dpData[ds] || {};
    DP_COLS.forEach(col => {
      const inp = document.getElementById(`dp-inp-${ds}-${col}`);
      if (inp && !dpDirty.has(ds)) inp.value = row[col] || '';
    });
  });
}

function dpSetTableHeight() {
  const wrap = document.getElementById('dp-table-wrap');
  const tbody = document.getElementById('dp-tbody');
  if (!wrap || !tbody) return;
  const allRows = Array.from(tbody.querySelectorAll('tr'));
  if (!allRows.length) return;
  const thead = wrap.querySelector('thead');
  const theadH = thead ? thead.offsetHeight : 38;
  // Measure exactly 7 rows (one week) for the visible height
  const rowsH = allRows.slice(0, 7).reduce((s, r) => s + r.offsetHeight, 0);
  wrap.style.height = (theadH + rowsH + 1) + 'px';
}

function dpScrollToThisWeek() {
  const monday = dpGetMonday(new Date());
  const mondayStr = dpDateStr(monday);
  const row = document.getElementById(`dp-row-${mondayStr}`);
  const wrap = document.getElementById('dp-table-wrap');
  if (!row || !wrap) return;
  const thead = wrap.querySelector('thead');
  const theadH = thead ? thead.offsetHeight : 0;
  wrap.scrollTop = row.offsetTop - theadH;
}

function dpScheduleSave() {
  const status = document.getElementById('dp-save-status');
  status.textContent = 'Saving…';
  status.className = 'dp-save-status saving';
  clearTimeout(dpSaveTimer);
  dpSaveTimer = setTimeout(dpFlushSave, 900);
}

async function dpFlushSave() {
  if (!dpDirty.size) return;
  const year = String(new Date().getFullYear());
  const updates = {};
  dpDirty.forEach(ds => { updates[ds] = dpData[ds] || {}; });
  dpDirty.clear();
  try {
    await db.collection('users').doc(state.user.uid)
            .collection('dailyplan').doc(year)
            .set({ rows: updates }, { merge: true });
    const status = document.getElementById('dp-save-status');
    status.textContent = 'Saved';
    status.className = 'dp-save-status saved';
    setTimeout(() => { status.textContent = ''; status.className = 'dp-save-status'; }, 1800);
  } catch(e) {
    showToast('Save failed: ' + e.message);
  }
}

// ── Weekly Reference ─────────────────────────────────────────────────────

const DP_REF_DAYS     = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const DP_REF_DAY_FULL = { Mon:'Monday', Tue:'Tuesday', Wed:'Wednesday', Thu:'Thursday', Fri:'Friday', Sat:'Saturday', Sun:'Sunday' };
const DP_REF_DEFAULTS = {
  Mon: { c630: '',            c730: 'MMA + GYM',                                       c830: '', morning: 'Library 1, Library 2, Phoenix Mall, Home Work + Outworks + Home, Others', evening: 'S&B' },
  Tue: { c630: 'Meditation',  c730: 'MMA / GYM',                                       c830: '', morning: 'Library 1, Library 2, Phoenix Mall, Home Work + Outworks + Home, Others', evening: 'S&B' },
  Wed: { c630: 'Meditation',  c730: 'Rest',                                             c830: '', morning: 'Movie',                                                                    evening: 'Home, MMA + GYM (Optional)' },
  Thu: { c630: '',            c730: 'MMA + GYM',                                       c830: '', morning: 'Library 1, Library 2, Phoenix Mall, Home Work + Outworks + Home, Others', evening: 'S&B' },
  Fri: { c630: '',            c730: 'MMA + GYM',                                       c830: '', morning: 'Other Working Space, Phoenix Mall, Home Work + Outworks + Home, Others',  evening: 'S&B, Other Working Space' },
  Sat: { c630: '',            c730: 'MMA Sparring / Cricket / Group Workout / Cycling', c830: '', morning: '',                                                                        evening: '' },
  Sun: { c630: '',            c730: 'Rest',                                             c830: 'Meditation', morning: '',                                                              evening: '' },
};

let dpRefData     = {};
let dpRefSaveTimer = null;
let dpRefBuilt    = false;

async function dpLoadWeeklyRef() {
  try {
    const doc = await db.collection('users').doc(state.user.uid)
                        .collection('weeklyref').doc('template').get();
    dpRefData = doc.exists ? (doc.data().rows || {}) : {};
  } catch(e) {
    dpRefData = {};
  }
  if (!dpRefBuilt) { dpBuildWeeklyRef(); dpRefBuilt = true; }
  else dpRefreshWeeklyRef();
}

function dpBuildWeeklyRef() {
  const tbody = document.getElementById('dp-ref-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  DP_REF_DAYS.forEach(day => {
    const saved = dpRefData[day] || {};
    const def   = DP_REF_DEFAULTS[day] || {};
    const dow   = DP_REF_DAYS.indexOf(day); // 0=Mon
    const tr = document.createElement('tr');
    tr.className = 'dp-ref-row dp-ref-row-' + day.toLowerCase();

    const tdDay = document.createElement('td');
    tdDay.className = 'dp-ref-day-cell' + (dow === 5 ? ' dp-ref-sat' : dow === 6 ? ' dp-ref-sun' : '');
    tdDay.textContent = DP_REF_DAY_FULL[day];
    tr.appendChild(tdDay);

    ['c630','c730','c830','morning','evening'].forEach(col => {
      const td = document.createElement('td');
      td.className = 'dp-ref-cell dp-ref-col-' + col;
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'dp-ref-input';
      inp.id = `dp-ref-${day}-${col}`;
      inp.value = saved[col] !== undefined ? saved[col] : (def[col] || '');
      inp.placeholder = col === 'morning' ? 'Locations…' : col === 'evening' ? 'Evening…' : 'Activity…';
      inp.addEventListener('input', () => {
        if (!dpRefData[day]) dpRefData[day] = {};
        dpRefData[day][col] = inp.value;
        dpScheduleRefSave();
      });
      td.appendChild(inp);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

function dpRefreshWeeklyRef() {
  DP_REF_DAYS.forEach(day => {
    const saved = dpRefData[day] || {};
    const def   = DP_REF_DEFAULTS[day] || {};
    ['c630','c730','c830','morning','evening'].forEach(col => {
      const inp = document.getElementById(`dp-ref-${day}-${col}`);
      if (inp) inp.value = saved[col] !== undefined ? saved[col] : (def[col] || '');
    });
  });
}

function dpScheduleRefSave() {
  const s = document.getElementById('dp-ref-status');
  if (s) { s.textContent = 'Saving…'; s.className = 'dp-ref-status saving'; }
  clearTimeout(dpRefSaveTimer);
  dpRefSaveTimer = setTimeout(dpFlushRefSave, 900);
}

async function dpFlushRefSave() {
  try {
    await db.collection('users').doc(state.user.uid)
            .collection('weeklyref').doc('template')
            .set({ rows: dpRefData }, { merge: true });
    const s = document.getElementById('dp-ref-status');
    if (s) { s.textContent = 'Saved'; s.className = 'dp-ref-status saved'; }
    setTimeout(() => { const s2 = document.getElementById('dp-ref-status'); if (s2) { s2.textContent = ''; s2.className = 'dp-ref-status'; } }, 1800);
  } catch(e) { showToast('Save failed: ' + e.message); }
}

function applyRoleVisibility(role) {
  const showFor = {
    timesheet: new Set(['main', 'monthly', 'yearly', 'habits', 'log', 'planner', 'settings', 'health', 'dailyplan']),
    diet:      new Set(['diet', 'settings', 'health']),
    both:      new Set(['main', 'diet', 'monthly', 'yearly', 'habits', 'log', 'planner', 'settings', 'health', 'dailyplan']),
  };
  const visible = showFor[role] || showFor.both;
  document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
    const t = btn.dataset.tab;
    if (t === 'admin') return;
    btn.style.display = visible.has(t) ? '' : 'none';
  });
  // If currently active tab is hidden, switch to first visible tab
  const activeBtn = document.querySelector('.tab-btn.active');
  if (activeBtn && activeBtn.style.display === 'none') {
    const first = document.querySelector('.tab-btn[data-tab]:not([style*="none"]):not(.hidden)');
    if (first) first.click();
  }
}

function showAccessGate(status) {
  const overlay = document.getElementById('access-gate-overlay');
  if (!overlay) return;
  const msg     = document.getElementById('access-gate-msg');
  const actions = document.getElementById('access-gate-actions');
  overlay.classList.remove('hidden');
  if (status === 'pending') {
    if (msg)     msg.textContent = 'Your access request is pending approval.';
    if (actions) actions.innerHTML = '<p style="color:#FCD34D;font-size:13px">⏳ Waiting for admin approval…</p>';
  } else if (status === 'rejected') {
    if (msg)     msg.textContent = 'Your access request was not approved.';
    if (actions) actions.innerHTML = '<p style="color:#F87171;font-size:13px">Contact the app admin for access.</p>';
  } else {
    if (msg)     msg.textContent = 'You need admin approval to use this app.';
    if (actions) actions.innerHTML = '<button class="btn-primary" onclick="requestAccess()">Request Access</button>';
  }
}

function hideAccessGate() {
  document.getElementById('access-gate-overlay')?.classList.add('hidden');
}

async function requestAccess() {
  const btn = document.querySelector('#access-gate-actions button');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  try {
    await db.collection('access_requests').doc(state.user.uid).set({
      uid:         state.user.uid,
      email:       state.user.email,
      displayName: state.user.displayName || '',
      photoURL:    state.user.photoURL    || '',
      requestedAt: firebase.firestore.FieldValue.serverTimestamp(),
      status:      'pending',
    });
    const msg     = document.getElementById('access-gate-msg');
    const actions = document.getElementById('access-gate-actions');
    if (msg)     msg.textContent = 'Request sent! Waiting for admin approval.';
    if (actions) actions.innerHTML = '<p style="color:#FCD34D;font-size:13px">⏳ Pending approval…</p>';
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Request Access'; }
    showToast('Failed: ' + e.message);
  }
}

// ── Admin tab ──────────────────────────────────────────────────────────────

async function loadAdminTab() {
  if (!isAdmin()) return;
  await updateDietStats();  // ensure admin's own stats are current
  await Promise.all([loadPendingRequests(), loadAllUsers(), loadDietLeaderboard()]);
}

async function loadPendingRequests() {
  const container = document.getElementById('admin-requests-list');
  if (!container) return;
  container.innerHTML = '<span class="empty-inline">Loading…</span>';
  try {
    const snap = await db.collection('access_requests').where('status', '==', 'pending').get();
    if (snap.empty) { container.innerHTML = '<span class="empty-inline">No pending requests</span>'; return; }
    const rows = snap.docs.map(doc => {
      const d  = doc.data();
      const ts = d.requestedAt?.toDate?.()?.toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) || '—';
      return `<tr>
        <td><img src="${escHtml(d.photoURL||'')}" class="admin-avatar" onerror="this.style.display='none'">${escHtml(d.displayName||'(no name)')}</td>
        <td>${escHtml(d.email)}</td>
        <td>${ts}</td>
        <td><select id="req-role-${d.uid}">
          <option value="timesheet">Timesheet only</option>
          <option value="diet">Diet only</option>
          <option value="both" selected>Both</option>
        </select></td>
        <td>
          <button class="btn-primary admin-btn" onclick="approveRequest('${d.uid}','${escHtml(d.email)}','${escHtml(d.displayName||'')}')">Approve</button>
          <button class="btn-secondary admin-btn" onclick="rejectRequest('${d.uid}')">Reject</button>
        </td>
      </tr>`;
    }).join('');
    container.innerHTML = `<div class="table-scroll"><table class="data-table admin-table">
      <thead><tr><th>Name</th><th>Email</th><th>Requested</th><th>Role</th><th>Action</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  } catch (e) {
    container.innerHTML = `<span class="empty-inline" style="color:var(--red)">Error: ${e.message}</span>`;
  }
}

async function approveRequest(uid, email, displayName) {
  const roleEl = document.getElementById(`req-role-${uid}`);
  const role   = roleEl?.value || 'both';
  try {
    const batch = db.batch();
    batch.set(db.collection('user_roles').doc(uid), { uid, email, displayName, role });
    batch.update(db.collection('access_requests').doc(uid), { status: 'approved' });
    await batch.commit();
    showToast(`✓ Approved ${email} (${role})`);
    await loadPendingRequests();
    await loadAllUsers();
  } catch (e) { showToast('Error: ' + e.message); }
}

async function rejectRequest(uid) {
  try {
    await db.collection('access_requests').doc(uid).update({ status: 'rejected' });
    showToast('Request rejected');
    await loadPendingRequests();
  } catch (e) { showToast('Error: ' + e.message); }
}

async function loadAllUsers() {
  const container = document.getElementById('admin-users-list');
  if (!container) return;
  container.innerHTML = '<span class="empty-inline">Loading…</span>';
  try {
    const snap = await db.collection('user_roles').get();
    if (snap.empty) { container.innerHTML = '<span class="empty-inline">No users yet</span>'; return; }
    const rows = snap.docs.map(doc => {
      const d       = doc.data();
      const isSelf  = d.uid === state.user?.uid;
      const roleCell = isSelf
        ? `<strong style="color:var(--lime)">Admin</strong>`
        : `<select id="user-role-${d.uid}">
            <option value="timesheet"${d.role==='timesheet'?' selected':''}>Timesheet only</option>
            <option value="diet"${d.role==='diet'?' selected':''}>Diet only</option>
            <option value="both"${d.role==='both'?' selected':''}>Both</option>
          </select>`;
      const actionCell = isSelf
        ? `<span style="font-size:12px;color:var(--muted)">—</span>`
        : `<button class="btn-secondary admin-btn" onclick="saveUserRoleAdmin('${d.uid}','${escHtml(d.email)}','${escHtml(d.displayName||'')}')">Save</button>
           <button class="admin-remove-btn" onclick="removeUser('${d.uid}','${escHtml(d.email)}')" title="Remove user">✕</button>`;
      return `<tr id="user-row-${d.uid}">
        <td>${escHtml(d.displayName || '—')}</td>
        <td>${escHtml(d.email)}</td>
        <td>${roleCell}</td>
        <td>${actionCell}</td>
      </tr>`;
    }).join('');
    container.innerHTML = `<div class="table-scroll"><table class="data-table admin-table">
      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Action</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  } catch (e) {
    container.innerHTML = `<span class="empty-inline" style="color:var(--red)">Error: ${e.message}</span>`;
  }
}

async function saveUserRoleAdmin(uid, email, displayName) {
  const roleEl = document.getElementById(`user-role-${uid}`);
  const role   = roleEl?.value || 'both';
  try {
    await db.collection('user_roles').doc(uid).set({ uid, email, displayName, role });
    showToast('Role saved');
  } catch (e) { showToast('Error: ' + e.message); }
}

async function removeUser(uid, email) {
  if (!confirm(`Remove ${email}?\nThey will lose access and need to request again.`)) return;
  try {
    const batch = db.batch();
    batch.delete(db.collection('user_roles').doc(uid));
    batch.delete(db.collection('diet_stats').doc(uid));
    // Reset request status so they can re-request
    const reqRef = db.collection('access_requests').doc(uid);
    const reqDoc = await reqRef.get();
    if (reqDoc.exists) batch.delete(reqRef);
    await batch.commit();
    showToast(`Removed ${email}`);
    document.getElementById(`user-row-${uid}`)?.remove();
    const tbody = document.querySelector('#admin-users-list tbody');
    if (tbody && !tbody.children.length) {
      document.getElementById('admin-users-list').innerHTML = '<span class="empty-inline">No users yet</span>';
    }
    await loadDietLeaderboard();
  } catch (e) { showToast('Error: ' + e.message); }
}

async function loadDietLeaderboard() {
  const container = document.getElementById('admin-leaderboard');
  if (!container) return;
  container.innerHTML = '<span class="empty-inline">Loading…</span>';
  try {
    const snap = await db.collection('diet_stats').get();
    if (snap.empty) { container.innerHTML = '<span class="empty-inline">No diet stats yet</span>'; return; }
    const admin = isAdmin();
    const stats = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.successDays || 0) - (a.successDays || 0));
    const rows  = stats.map((d, i) => `<tr>
      <td>${i + 1}</td>
      <td>${escHtml(d.displayName || '—')}</td>
      <td>${escHtml(d.email || '—')}</td>
      <td><strong style="color:var(--lime)">${d.successDays || 0}</strong></td>
      <td>${d.totalDays || 0}</td>
      ${admin ? `<td><button class="lb-remove-btn" onclick="removeDietLeaderboardEntry('${d.id}')">✕ Remove</button></td>` : ''}
    </tr>`).join('');
    container.innerHTML = `<div class="table-scroll"><table class="data-table admin-table">
      <thead><tr><th>#</th><th>Name</th><th>Email</th><th>🌟 Success Days</th><th>Total Days</th>${admin ? '<th></th>' : ''}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  } catch (e) {
    container.innerHTML = `<span class="empty-inline" style="color:var(--red)">Error: ${e.message}</span>`;
  }
}

async function removeDietLeaderboardEntry(uid) {
  if (!isAdmin()) return;
  if (!confirm('Remove this entry from the leaderboard?')) return;
  await db.collection('diet_stats').doc(uid).delete();
  showToast('Entry removed');
  await loadDietLeaderboard();
}

async function updateDietStats() {
  if (!state.user) return;
  try {
    const target = getCalorieTarget();
    let y = 2026, m = 6;
    const today = todayStr();
    const [ey, em] = today.slice(0, 7).split('-').map(Number);
    let successDays = 0, totalDays = 0;
    while (y < ey || (y === ey && m <= em)) {
      const month = `${y}-${String(m).padStart(2, '0')}`;
      const mData = await getDietMonthData(month);
      for (const [ds, day] of Object.entries(mData.days || {})) {
        if (ds > today) continue;
        const kcal = dietCalcTotals(day.foods || []).kcal;
        if (kcal > 0) { totalDays++; if (kcal <= target) successDays++; }
      }
      m++; if (m > 12) { y++; m = 1; }
    }
    await db.collection('diet_stats').doc(state.user.uid).set({
      uid: state.user.uid, email: state.user.email,
      displayName: state.user.displayName || '',
      successDays, totalDays,
      lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) { console.warn('updateDietStats:', e.message); }
}

// ══════════════════════════════════════════════════════════════════════════
//  HEALTH TAB
// ══════════════════════════════════════════════════════════════════════════

async function loadHealthTab() {
  document.getElementById('health-bp-date').value = todayStr();
  const ud = await getUserData();
  renderBpTable(ud.bpLog || []);
}

function renderBpTable(log) {
  const tbody = document.getElementById('health-bp-tbody');
  if (!log.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty">No entries yet</td></tr>';
    return;
  }
  const sorted = [...log].sort((a, b) => b.date.localeCompare(a.date));
  tbody.innerHTML = sorted.map(e => `
    <tr>
      <td>${formatDate(e.date)}</td>
      <td><strong>${escHtml(e.bp)}</strong></td>
      <td><button class="btn-danger" onclick="deleteBpEntry('${e.id}')">✕</button></td>
    </tr>`).join('');
}

async function addBpEntry() {
  const date = document.getElementById('health-bp-date').value;
  const bp   = document.getElementById('health-bp-value').value.trim();
  if (!date) { showToast('Select a date'); return; }
  if (!bp)   { showToast('Enter a BP reading'); return; }
  const ud = await getUserData();
  const bpLog = ud.bpLog || [];
  bpLog.push({ id: pId(), date, bp });
  await saveUserData({ bpLog });
  document.getElementById('health-bp-value').value = '';
  renderBpTable(bpLog);
  showToast('BP entry saved');
}

async function deleteBpEntry(id) {
  const ud    = await getUserData();
  const bpLog = (ud.bpLog || []).filter(e => e.id !== id);
  await saveUserData({ bpLog });
  renderBpTable(bpLog);
}

