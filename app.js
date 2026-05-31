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

function signInWithGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  auth.signInWithPopup(provider).catch(e => showToast('Sign-in failed: ' + e.message));
}

function doSignOut() {
  auth.signOut();
}

auth.onAuthStateChanged(user => {
  state.user = user;
  state.cache = {};
  state.allMonthsCache = null;
  state.userDataCache  = null;

  if (user) {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    const avatar = document.getElementById('user-avatar');
    if (user.photoURL) { avatar.src = user.photoURL; avatar.style.display = 'block'; }
    else avatar.style.display = 'none';
    const avatarM = document.getElementById('user-avatar-mobile');
    if (avatarM) { if (user.photoURL) { avatarM.src = user.photoURL; avatarM.style.display = 'block'; } }
    const nameM = document.getElementById('mobile-user-name');
    if (nameM) nameM.textContent = user.displayName || user.email || '';
    initApp();
  } else {
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
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
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    ({ main: loadMainTab, monthly: loadMonthlyTab, yearly: loadYearlyTab, habits: loadHabitsTab, log: loadLogTab, planner: loadPlannerTab, settings: loadSettingsTab })[btn.dataset.tab]?.();
  });
});

// ══════════════════════════════════════════════════════════════════════════
//  MAIN TAB
// ══════════════════════════════════════════════════════════════════════════

async function loadMainTab() {
  const data = await getMonthData(state.mainMonth);
  loadMainDateDropdown(data);
  loadMainCategories(data);
  await loadMonthlySummary(data);
  renderWastedMonthSummary(data);  // also sets wasted chip
  await renderDayEntries();
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
    const opt = document.createElement('option');
    opt.value = c.category; opt.textContent = c.category;
    sel.appendChild(opt);
  });
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

  // Productive hours chip
  let totalProductive = 0;
  Object.values(entries).forEach(dayE => Object.values(dayE).forEach(h => { totalProductive += h; }));
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

  data.categories.forEach(c => {
    let completed = 0;
    Object.values(entries).forEach(dayE => { completed += dayE[c.category] || 0; });
    completed        = Math.round(completed * 100) / 100;
    const target     = Math.round(c.daily_target * workingDays * 100) / 100;
    const adjustment = Math.round((adjustments[c.category] || 0) * 100) / 100;
    const pending    = Math.round((target - completed + adjustment) * 100) / 100;
    const onTrack    = pending <= 0;
    totalCompleted  += completed;
    totalTarget     += target;
    totalPending    += pending;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="cb-col"><input type="checkbox" class="row-focus-cb" onchange="this.closest('tr').classList.toggle('row-focused',this.checked)"></td>
      <td>${c.category}</td>
      <td class="cell-hrs">${completed}</td>
      <td>${target}</td>
      <td><input type="number" class="inline-input sm adjust-input" data-cat="${c.category}"
           value="${adjustment || ''}" step="0.25" placeholder="0" style="width:60px"></td>
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

  // Stats row below table (wasted, working days, productive)
  const wastedEntries = data.wastedEntries || {};
  let wastedTotal = 0;
  Object.values(wastedEntries).forEach(arr => arr.forEach(e => { wastedTotal += e.hours || 0; }));
  wastedTotal = Math.round(wastedTotal * 100) / 100;

  const bd = data.fitnessBreakdown || {};
  const gymDays = Object.values(bd).filter(d => (d.fitGYM || 0) > 0).length;
  const mmaDays = Object.values(bd).filter(d => (d.fitMMA || 0) > 0).length;

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
    `;
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
  if (!data.entries[date]) data.entries[date] = {};
  data.entries[date][category] = parseFloat(hoursVal);
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
    await saveMonthData(month, data);
  }
  showToast('Entry deleted');
  await loadMonthlySummary(data);
  await renderDayEntries();
}

// ── Wasted Time ───────────────────────────────────────────────────────────

async function logWastedTime() {
  const date  = document.getElementById('main-date').value;
  const hours = parseFloat(document.getElementById('wasted-hours').value);
  const note  = document.getElementById('wasted-note').value.trim();
  if (!date)                        { showToast('Select a date');         return; }
  if (isNaN(hours) || hours <= 0)   { showToast('Enter valid hours');     return; }

  const month = date.slice(0, 7);
  const data  = await getMonthData(month);
  if (!data.wastedEntries[date]) data.wastedEntries[date] = [];
  data.wastedEntries[date].push({ hours, note });
  await saveMonthData(month, data);

  document.getElementById('wasted-hours').value = '';
  document.getElementById('wasted-note').value  = '';
  showToast('Wasted time logged');
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

async function deleteWastedEntry(date, idx) {
  const month = date.slice(0, 7);
  const data  = await getMonthData(month);
  if (data.wastedEntries[date]) {
    data.wastedEntries[date].splice(idx, 1);
    if (!data.wastedEntries[date].length) delete data.wastedEntries[date];
    await saveMonthData(month, data);
  }
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
  const wastedDay  = (data.wastedEntries || {})[date] || [];

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

  if (wastedDay.length) {
    html += `<div style="padding:8px 0 2px;font-size:11px;font-weight:700;color:var(--red);text-transform:uppercase;letter-spacing:0.8px">Wasted</div>`;
    html += wastedDay.map((e, i) => `
      <div style="display:flex;align-items:center;justify-content:space-between;
                  padding:8px 0;border-bottom:1px solid #F1F5F9">
        <span style="font-size:13px;color:var(--muted)">${e.note || 'No note'}</span>
        <div style="display:flex;align-items:center;gap:12px">
          <span style="font-weight:700;color:var(--red)">${e.hours} hrs</span>
          <button class="btn-danger" onclick="deleteWastedEntry('${date}',${i})">✕</button>
        </div>
      </div>
    `).join('');
  }

  if (!cats.length && !wastedDay.length) {
    list.innerHTML = '<span class="empty-inline">No entries for this date</span>';
    return;
  }

  list.innerHTML = html;
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

async function renderMonthlyTable(data) {
  if (!data) data = await getMonthData(state.monthlyMonth);
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

  document.getElementById('monthly-thead').innerHTML = `
    <tr><th rowspan="2">Date</th><th rowspan="2">Day</th>${headerRow1}<th rowspan="2">Total</th><th rowspan="2">Status</th><th rowspan="2" style="color:var(--red)">Wasted</th></tr>
    <tr>${headerRow2}</tr>
  `;

  const oldTbody = document.getElementById('monthly-tbody');
  const newTbody = oldTbody.cloneNode(false);
  newTbody.id = 'monthly-tbody';
  oldTbody.parentNode.replaceChild(newTbody, oldTbody);
  const tbody = newTbody;
  const colTotals = Object.fromEntries(categories.map(c => [c, 0]));
  const subTotals = Object.fromEntries(FITNESS_SUBS.map(s => [s, 0]));
  let grandTotal  = 0;
  let wastedColTotal = 0;

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

    const wastedArr = (data.wastedEntries || {})[dateStr] || [];
    const wastedHrs = Math.round(wastedArr.reduce((s, e) => s + (e.hours || 0), 0) * 100) / 100;
    wastedColTotal  = Math.round((wastedColTotal + wastedHrs) * 100) / 100;
    const wastedCell = isFuture
      ? '<td></td>'
      : `<td class="editable-cell monthly-wasted-cell${wastedHrs > 0 ? ' cell-wasted' : ''}" data-date="${dateStr}" data-wasted="${wastedHrs}">${wastedHrs > 0 ? wastedHrs : ''}</td>`;

    const tr = document.createElement('tr');
    if (rowClass) tr.className = rowClass;
    tr.innerHTML = `
      <td>${String(day).padStart(2, '0')} ${formatMonthShort(month)}</td>
      <td>${dayNames[dt.getDay()]}</td>
      ${catCells.join('')}
      <td${dayTotal > 0 ? ' class="cell-hrs"' : ''}>${dayTotal > 0 ? dayTotal : ''}</td>
      ${statusCell}
      ${wastedCell}
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
  totalTr.innerHTML = `<td colspan="2">Total</td>${totalCells}<td>${grandTotal}</td><td></td><td${wastedColTotal > 0 ? ' style="color:var(--red)"' : ''}>${wastedColTotal > 0 ? wastedColTotal : ''}</td>`;
  tbody.appendChild(totalTr);

  if (hasFitness) {
    const bd = data.fitnessBreakdown || {};
    const gymDays = Object.values(bd).filter(d => (d.fitGYM || 0) > 0).length;
    const mmaDays = Object.values(bd).filter(d => (d.fitMMA || 0) > 0).length;
    const colSpan = 2 + (categories.length - 1) + 3 + 3; // +3 for Total, Status, Wasted
    const fitTr = document.createElement('tr');
    fitTr.className = 'row-fitness-days';
    fitTr.innerHTML = `<td colspan="${colSpan}" style="text-align:center;padding:6px 12px;font-size:13px;color:#86efac;">
      <span style="margin-right:20px">🏋️ GYM: <strong>${gymDays}</strong> days</span>
      <span>🥋 MMA: <strong>${mmaDays}</strong> days</span>
    </td>`;
    tbody.appendChild(fitTr);
  }

  tbody.addEventListener('click', async e => {
    const td = e.target.closest('td.editable-cell');
    if (!td || td.querySelector('input')) return;
    const dateStr  = td.dataset.date;
    const isWasted = 'wasted' in td.dataset;
    const cat      = td.dataset.cat;
    const sub      = td.dataset.sub || null;
    const prevHrs  = parseFloat(isWasted ? td.dataset.wasted : td.dataset.hrs) || 0;

    const input = document.createElement('input');
    input.type = 'number'; input.min = '0'; input.max = '24'; input.step = '0.25';
    input.value = prevHrs || ''; input.placeholder = '0';
    input.className = 'cell-edit-input';
    td.textContent = ''; td.classList.remove('cell-hrs', 'cell-wasted');
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
        if (isWasted) {
          if (!d.wastedEntries) d.wastedEntries = {};
          if (newHrs > 0) d.wastedEntries[dateStr] = [{ hours: newHrs, note: '' }];
          else delete d.wastedEntries[dateStr];
          state.lastMonthlyEdit = { date: dateStr, isWasted: true, prev: prevHrs };
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
  const { date, cat, sub, prev, isWasted } = state.lastMonthlyEdit;
  const month = date.slice(0, 7);
  const d = await getMonthData(month);
  if (isWasted) {
    if (!d.wastedEntries) d.wastedEntries = {};
    if (prev > 0) d.wastedEntries[date] = [{ hours: prev, note: '' }];
    else delete d.wastedEntries[date];
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
    const allCats = [...new Set(months.flatMap(m => (allData[m].categories || []).map(c => c.category)))];
    thead.innerHTML = `
      <tr>
        <th>Month</th><th>Working Days</th>
        ${allCats.map(c => `<th>${c}</th>`).join('')}
        <th style="color:#4ade80">Total Done</th>
        <th style="color:var(--red)">Wasted</th>
        <th style="color:#86efac">🏋️ GYM Days</th>
        <th style="color:#86efac">🥋 MMA Days</th>
        <th style="color:#94a3b8">Comments</th>
      </tr>
    `;
    tbody.innerHTML = '';

    const colTotals = Object.fromEntries(allCats.map(c => [c, { done: 0, target: 0 }]));
    let totalWD = 0, totalDone = 0, totalWasted = 0, totalGym = 0, totalMma = 0;

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

      const catMap  = Object.fromEntries((mData.categories || []).map(c => [c.category, c.daily_target]));
      const entries = mData.entries || {};
      let mDone = 0;

      const cells = allCats.map(cat => {
        const target = Math.round((catMap[cat] || 0) * workingDays * 100) / 100;
        let done = 0;
        Object.values(entries).forEach(dayE => { done += dayE[cat] || 0; });
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
      const comment = mData.yearlyComment || '';

      totalWD     += workingDays;
      totalDone    = Math.round((totalDone + mDone) * 100) / 100;
      totalWasted  = Math.round((totalWasted + mWasted) * 100) / 100;
      totalGym    += mGym;
      totalMma    += mMma;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${formatMonth(month)}</strong></td>
        <td>${workingDays}</td>
        ${cells.join('')}
        <td><strong>${Math.round(mDone * 100) / 100}</strong></td>
        <td${mWasted > 0 ? ' class="bad"' : ''}>${mWasted > 0 ? mWasted : ''}</td>
        <td style="color:#86efac">${mGym || ''}</td>
        <td style="color:#86efac">${mMma || ''}</td>
        <td class="yearly-comment-cell editable-cell" data-month="${month}" title="Click to edit">${comment ? `<span class="yearly-comment-text">${comment}</span>` : '<span class="yearly-comment-placeholder">Add comment…</span>'}</td>
      `;
      tbody.appendChild(tr);
    });

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
  }

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
      const checked = (habitLog[d] || {})[habit] ? 'checked' : '';
      const dt = new Date(d + 'T00:00:00');
      const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
      return `<td class="habit-check-cell${d === today ? ' cell-today' : ''}${isWeekend ? ' cell-weekend' : ''}">
        <input type="checkbox" class="habit-cb" ${checked}
          onchange="toggleHabit('${d}','${encodeURIComponent(habit)}',this.checked)">
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

async function toggleHabit(date, encodedHabit, checked) {
  const habit    = decodeURIComponent(encodedHabit);
  const userData = await getUserData();
  if (!userData.habitLog[date]) userData.habitLog[date] = {};
  if (checked) userData.habitLog[date][habit] = true;
  else         delete userData.habitLog[date][habit];
  if (!Object.keys(userData.habitLog[date]).length) delete userData.habitLog[date];
  await saveUserData({ habitLog: userData.habitLog });
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
}

// ══════════════════════════════════════════════════════════════════════════
//  SETTINGS TAB
// ══════════════════════════════════════════════════════════════════════════

async function loadSettingsTab() {
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
           oninput="state.settingsMetadata[${i}].category = this.value"></td>
      <td><input class="inline-input sm" type="number" value="${c.daily_target}" step="0.25" min="0"
           oninput="state.settingsMetadata[${i}].daily_target = parseFloat(this.value)||0"></td>
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
}

function removeSettingsCategory(i) {
  state.settingsMetadata.splice(i, 1);
  renderSettingsTable();
}

async function saveSettings() {
  const month = state.settingsMonth;
  const data  = await getMonthData(month);
  data.categories = state.settingsMetadata.filter(c => c.category.trim());
  await saveMonthData(month, data);
  showToast('Settings saved');
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
}

function removeFmCategory(i) {
  state.fmCatMeta.splice(i, 1);
  renderFmCategoryTable();
}

async function saveFmCategories() {
  await saveUserData({ fmCategories: [...state.fmCatMeta] });
  showToast('FM categories saved');
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
      ws.addRow([]);
      [['Working days', workingDays],['Productive (hrs)', productive],['Wasted (hrs)', wastedTotal],['GYM days', gymDays],['MMA days', mmaDays]].forEach(r => {
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

        const hRow = ws.addRow(['Month','Working Days',...allCats,'Total Done','Wasted','GYM Days','MMA Days','Comments']);
        styleRow(hRow, 2+allCats.length+5, BLUE_FILL, BLUE_FONT);
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
          const comment = mData.yearlyComment||'';
          const row = ws.addRow([formatMonth(month), workingDays, ...catCells, Math.round(mDone*100)/100||'', mWasted||'', mGym||'', mMma||'', comment]);
          borderRow(row, 2+allCats.length+5);
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

    // ── 7. Wasted Time ─────────────────────────────────────────────────────
    try {
      const month = state.mainMonth;
      const data = await getMonthData(month);
      const wastedEntries = data.wastedEntries || {};
      const rows = [];
      Object.entries(wastedEntries).sort(([a],[b])=>a.localeCompare(b)).forEach(([date, arr]) => {
        arr.forEach(e => rows.push([date, e.hours, e.note || '']));
      });
      if (rows.length) {
        const ws = wb.addWorksheet('E - Wasted Time');
        ws.getColumn(1).width = 14; ws.getColumn(2).width = 14; ws.getColumn(3).width = 40;
        const hRow = ws.addRow(['Date', 'Hours', 'Note']);
        styleRow(hRow, 3, BLUE_FILL, BLUE_FONT);
        rows.forEach(r => { const row = ws.addRow(r); borderRow(row, 3); });
      }
    } catch(e) { console.error('Wasted Time failed', e); }

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
            const vals = habits.map(h => (habitLog[d]||{})[h] ? 'Yes' : '');
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

      // E - Wasted Time
      else if (name === 'E - Wasted Time') {
        const wastedEntries = {};
        for (let i = 1; i < rows.length; i++) {
          const date = sv(rows[i][0]), hours = nv(rows[i][1]), note = sv(rows[i][2]);
          if (date && hours) {
            if (!wastedEntries[date]) wastedEntries[date] = [];
            wastedEntries[date].push({ hours, note });
          }
        }
        if (Object.keys(wastedEntries).length) parsed.wastedEntries = wastedEntries;
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
            logHabits.forEach((h, hi) => { if (sv(rows[i][1+hi]).toLowerCase() === 'yes') dayLog[h] = true; });
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

    if (parsed.categories)    monthData.categories    = parsed.categories;
    if (parsed.leaves)        monthData.leaves        = parsed.leaves;
    if (parsed.wastedEntries) monthData.wastedEntries = parsed.wastedEntries;
    if (parsed.adjustments)   monthData.adjustments   = parsed.adjustments;
    if (parsed.monthlyEntries) monthData.entries      = parsed.monthlyEntries.entries;

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

async function loadPlannerTab() {
  const ud = await getUserData();
  // Treat planners with old nested-array rows as missing (Firestore couldn't save them)
  const hasValidPlanners = ud.planners && ud.planners.length > 0 &&
    ud.planners[0].blocks && ud.planners[0].blocks.length > 0 &&
    ud.planners[0].blocks[0].rows && ud.planners[0].blocks[0].rows.length > 0 &&
    !Array.isArray(ud.planners[0].blocks[0].rows[0]);
  if (!hasValidPlanners) {
    state.planners = [defaultWeekdayPlanner()];
    await saveUserData({ planners: state.planners });
  } else {
    state.planners = ud.planners;
  }
  if (state.activePlannerIdx >= state.planners.length) state.activePlannerIdx = 0;
  renderPlannerTab();
}

function renderPlannerTab() {
  const planners = state.planners;
  const ai       = state.activePlannerIdx;

  // Sub-tabs
  document.getElementById('planner-sub-tabs').innerHTML = planners.map((p, i) => `
    <button class="planner-sub-tab${i === ai ? ' active' : ''}" onclick="switchPlanner(${i})">
      ${escHtml(p.name)}
      <span class="planner-tab-del" onclick="event.stopPropagation();deletePlanner(${i})" title="Delete planner">✕</span>
    </button>`).join('');

  const container = document.getElementById('planner-blocks-container');
  if (!planners.length) { container.innerHTML = ''; return; }

  const planner = planners[ai];
  container.innerHTML = planner.blocks.map((b, bi) => renderPlannerBlock(ai, bi, b)).join('') +
    `<button class="btn-secondary planner-add-block-btn" onclick="addPlannerBlock()">+ Add Block</button>`;

  container.querySelectorAll('.planner-cell').forEach(ta => {
    autoResizeTa(ta);
    ta.addEventListener('input', () => autoResizeTa(ta));
  });
}

function renderPlannerBlock(pi, bi, block) {
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
    return `<tr>
      ${cells}
      <td class="planner-row-del-td">
        <button class="btn-planner-icon" title="Remove row" onclick="removePlannerRow(${pi},${bi},${ri})">✕</button>
      </td>
    </tr>`;
  }).join('');

  return `
    <div class="planner-block card">
      <div class="planner-block-titlebar">
        <input class="planner-block-title" value="${escHtml(block.header)}"
          onblur="updatePlannerBlockHeader(${pi},${bi},this.value)">
        <button class="btn-planner-del-block" onclick="deletePlannerBlock(${pi},${bi})" title="Delete block">🗑</button>
      </div>
      <div class="table-scroll">
        <table class="planner-table">
          <thead><tr>
            ${colThs}
            <th class="planner-addcol-th">
              <button class="btn-planner-sm" onclick="addPlannerColumn(${pi},${bi})">+ Col</button>
            </th>
          </tr></thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
      <button class="btn-planner-add-row" onclick="addPlannerRow(${pi},${bi})">+ Row</button>
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
  state.planners[pi].blocks.push({ id: pId(), header: 'New Block', cols: ['Column 1', 'Column 2'], rows: [{ c0: '', c1: '' }] });
  await saveUserData({ planners: state.planners });
  renderPlannerTab();
}

async function deletePlannerBlock(pi, bi) {
  if (!confirm('Delete this block?')) return;
  state.planners[pi].blocks.splice(bi, 1);
  await saveUserData({ planners: state.planners });
  renderPlannerTab();
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
