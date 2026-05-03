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
    ({ main: loadMainTab, monthly: loadMonthlyTab, yearly: loadYearlyTab, habits: loadHabitsTab, log: loadLogTab, settings: loadSettingsTab })[btn.dataset.tab]?.();
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
    tbody.innerHTML = '<tr><td colspan="5" class="empty">No categories — add them in Settings first</td></tr>';
    return;
  }

  const adjustments = data.adjustments || {};

  data.categories.forEach(c => {
    let completed = 0;
    Object.values(entries).forEach(dayE => { completed += dayE[c.category] || 0; });
    completed        = Math.round(completed * 100) / 100;
    const target     = Math.round(c.daily_target * workingDays * 100) / 100;
    const adjustment = Math.round((adjustments[c.category] || 0) * 100) / 100;
    const pending    = Math.round((target - completed + adjustment) * 100) / 100;
    const onTrack    = pending <= 0;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${c.category}</td>
      <td class="cell-hrs">${completed}</td>
      <td>${target}</td>
      <td><input type="number" class="inline-input sm adjust-input" data-cat="${c.category}"
           value="${adjustment || ''}" step="0.25" placeholder="0" style="width:60px"></td>
      <td class="${onTrack ? 'good' : 'bad'}">${pending}</td>
    `;
    tbody.appendChild(tr);
  });

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
  const container = document.getElementById('wasted-month-summary');
  if (!data) { container.innerHTML = ''; return; }

  const wastedEntries = data.wastedEntries || {};
  let total = 0;
  Object.values(wastedEntries).forEach(arr => arr.forEach(e => { total += e.hours || 0; }));
  total = Math.round(total * 100) / 100;

  document.getElementById('wasted-hours-chip').textContent = total > 0 ? total + ' hrs' : '0 hrs';

  if (!total) { container.innerHTML = ''; return; }

  container.innerHTML = `
    <div class="wasted-month-row">
      <span class="wasted-label-text">Wasted this month</span>
      <span class="wasted-total">${total} hrs</span>
    </div>
  `;
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

async function renderMonthlyTable(data) {
  if (!data) data = await getMonthData(state.monthlyMonth);
  const month = state.monthlyMonth;
  const [year, mon] = month.split('-').map(Number);
  const today      = todayStr();
  const leavesSet  = new Set(data.leaves);
  const categories = data.categories.map(c => c.category);
  const entries    = data.entries;
  const total      = daysInMonth(year, mon);
  const dayNames   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  document.getElementById('monthly-thead').innerHTML = `
    <tr>
      <th>Date</th><th>Day</th>
      ${categories.map(c => `<th>${c}</th>`).join('')}
      <th>Total</th><th>Status</th>
    </tr>
  `;

  const oldTbody = document.getElementById('monthly-tbody');
  const newTbody = oldTbody.cloneNode(false);
  newTbody.id = 'monthly-tbody';
  oldTbody.parentNode.replaceChild(newTbody, oldTbody);
  const tbody = newTbody;
  const colTotals = Object.fromEntries(categories.map(c => [c, 0]));
  let grandTotal  = 0;

  for (let day = 1; day <= total; day++) {
    const dt      = new Date(year, mon - 1, day);
    const dateStr = `${month}-${String(day).padStart(2, '0')}`;
    const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
    const isLeave   = leavesSet.has(dateStr);
    const isToday   = dateStr === today;
    const isFuture  = dateStr > today;
    const dayEntries = entries[dateStr] || {};
    let dayTotal = 0;

    const isEditable = !isWeekend && !isFuture;
    const catCells = categories.map(cat => {
      const hrs = dayEntries[cat] || 0;
      colTotals[cat] = Math.round((colTotals[cat] + hrs) * 100) / 100;
      dayTotal       = Math.round((dayTotal + hrs) * 100) / 100;
      const editAttrs = isEditable
        ? ` class="editable-cell${hrs > 0 ? ' cell-hrs' : ''}" data-date="${dateStr}" data-cat="${cat}" data-hrs="${hrs}"`
        : (hrs > 0 ? ' class="cell-hrs"' : '');
      return `<td${editAttrs}>${hrs > 0 ? hrs : ''}</td>`;
    });
    grandTotal = Math.round((grandTotal + dayTotal) * 100) / 100;

    const rowClass    = isToday ? 'row-today' : isWeekend ? 'row-weekend' : isLeave ? 'row-leave' : '';
    const leaveReason = (data.leaveReasons || {})[dateStr] || '';
    const statusCell  = isWeekend  ? '<td class="neutral">Weekend</td>'
      : isLeave                    ? `<td class="good">Leave${leaveReason ? ' · ' + leaveReason : ''}</td>`
      : isFuture                   ? '<td class="neutral">—</td>'
      : dayTotal > 0               ? `<td class="good">${dayTotal} hrs</td>`
      :                              '<td class="bad">No entry</td>';

    const tr = document.createElement('tr');
    if (rowClass) tr.className = rowClass;
    tr.innerHTML = `
      <td>${String(day).padStart(2, '0')} ${formatMonthShort(month)}</td>
      <td>${dayNames[dt.getDay()]}</td>
      ${catCells.join('')}
      <td${dayTotal > 0 ? ' class="cell-hrs"' : ''}>${dayTotal > 0 ? dayTotal : ''}</td>
      ${statusCell}
    `;
    tbody.appendChild(tr);
  }

  const totalTr = document.createElement('tr');
  totalTr.className = 'row-total';
  totalTr.innerHTML = `
    <td colspan="2">Total</td>
    ${categories.map(c => `<td>${colTotals[c] > 0 ? colTotals[c] : ''}</td>`).join('')}
    <td>${grandTotal}</td><td></td>
  `;
  tbody.appendChild(totalTr);

  tbody.addEventListener('click', async e => {
    const td = e.target.closest('td.editable-cell');
    if (!td || td.querySelector('input')) return;
    const dateStr = td.dataset.date;
    const cat     = td.dataset.cat;
    const prevHrs = parseFloat(td.dataset.hrs) || 0;

    const input = document.createElement('input');
    input.type = 'number'; input.min = '0'; input.max = '24'; input.step = '0.25';
    input.value = prevHrs || ''; input.placeholder = '0';
    input.className = 'cell-edit-input';
    td.textContent = ''; td.classList.remove('cell-hrs');
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
        if (newHrs > 0) {
          if (!d.entries[dateStr]) d.entries[dateStr] = {};
          d.entries[dateStr][cat] = newHrs;
        } else {
          if (d.entries[dateStr]) {
            delete d.entries[dateStr][cat];
            if (!Object.keys(d.entries[dateStr]).length) delete d.entries[dateStr];
          }
        }
        await saveMonthData(month, d);
        state.lastMonthlyEdit = { date: dateStr, cat, prev: prevHrs };
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
  const { date, cat, prev } = state.lastMonthlyEdit;
  const month = date.slice(0, 7);
  const d = await getMonthData(month);
  if (prev > 0) {
    if (!d.entries[date]) d.entries[date] = {};
    d.entries[date][cat] = prev;
  } else {
    if (d.entries[date]) {
      delete d.entries[date][cat];
      if (!Object.keys(d.entries[date]).length) delete d.entries[date];
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
        ${allCats.map(c => `<th>${c}<br><small style="font-weight:500;color:#94a3b8">Done / Target</small></th>`).join('')}
        <th>Total Done</th>
        <th style="color:var(--red)">Wasted</th>
      </tr>
    `;
    tbody.innerHTML = '';

    const colTotals = Object.fromEntries(allCats.map(c => [c, { done: 0, target: 0 }]));
    let totalWD = 0, totalDone = 0, totalWasted = 0;

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
        return `<td class="${cls}">${done} / ${target}</td>`;
      });

      let mWasted = 0;
      Object.values(mData.wastedEntries || {}).forEach(arr => arr.forEach(e => { mWasted += e.hours || 0; }));
      mWasted = Math.round(mWasted * 100) / 100;

      totalWD     += workingDays;
      totalDone    = Math.round((totalDone + mDone) * 100) / 100;
      totalWasted  = Math.round((totalWasted + mWasted) * 100) / 100;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${formatMonth(month)}</strong></td>
        <td>${workingDays}</td>
        ${cells.join('')}
        <td><strong>${Math.round(mDone * 100) / 100}</strong></td>
        <td${mWasted > 0 ? ' class="bad"' : ''}>${mWasted > 0 ? mWasted : ''}</td>
      `;
      tbody.appendChild(tr);
    });

    const totalTr = document.createElement('tr');
    totalTr.className = 'row-total';
    totalTr.innerHTML = `
      <td>Total</td><td>${totalWD}</td>
      ${allCats.map(c => {
        const d   = colTotals[c];
        const cls = d.target > 0 ? (d.done >= d.target ? 'good' : 'bad') : '';
        return `<td class="${cls}">${Math.round(d.done * 100) / 100} / ${Math.round(d.target * 100) / 100}</td>`;
      }).join('')}
      <td>${Math.round(totalDone * 100) / 100}</td>
      <td${totalWasted > 0 ? ' class="bad"' : ''}>${totalWasted > 0 ? totalWasted : ''}</td>
    `;
    tbody.appendChild(totalTr);
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

function getNext5Days() {
  const days = [];
  const now  = new Date();
  for (let i = 0; i < 5; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    days.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
  }
  return days;
}

async function loadHabitsTab() {
  const userData = await getUserData();
  renderHabitsTable(userData.habits, userData.habitLog);
}

function renderHabitsTable(habits, habitLog) {
  const days     = getNext5Days();
  const today    = todayStr();
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const table    = document.getElementById('habits-table');

  const headCells = days.map(d => {
    const dt  = new Date(d + 'T00:00:00');
    const lbl = `${String(dt.getDate()).padStart(2,'0')}<br><small>${dayNames[dt.getDay()]}</small>`;
    return `<th class="habit-day-col${d === today ? ' col-today' : ''}">${lbl}</th>`;
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
      return `<td class="habit-check-cell${d === today ? ' cell-today' : ''}">
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

  // Add row
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
  renderHabitsTable(userData.habits, userData.habitLog);
  document.getElementById('new-habit-input')?.focus();
}

async function deleteHabit(index) {
  if (!confirm('Remove this habit?')) return;
  const userData = await getUserData();
  userData.habits.splice(index, 1);
  await saveUserData({ habits: userData.habits });
  renderHabitsTable(userData.habits, userData.habitLog);
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
  renderHabitsTable(habits, userData.habitLog);
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
      renderHabitsTable((await getUserData()).habits, (await getUserData()).habitLog);
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
    renderHabitsTable(userData.habits, userData.habitLog);
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
  const [allData, userData] = await Promise.all([getAllMonths(), getUserData()]);
  const wb = XLSX.utils.book_new();

  // Entries sheet
  const entryRows = [['Month', 'Date', 'Category', 'Hours']];
  Object.keys(allData).sort().forEach(month => {
    const entries = allData[month].entries || {};
    Object.keys(entries).sort().forEach(date => {
      Object.entries(entries[date]).forEach(([cat, hrs]) => {
        entryRows.push([month, date, cat, hrs]);
      });
    });
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(entryRows), 'Entries');

  // Settings sheet
  const metaRows = [['Month', 'Category', 'Daily Target (hrs)']];
  Object.keys(allData).sort().forEach(month => {
    (allData[month].categories || []).forEach(c => {
      metaRows.push([month, c.category, c.daily_target]);
    });
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(metaRows), 'Settings');

  // Leaves sheet
  const leaveRows = [['Month', 'Date']];
  Object.keys(allData).sort().forEach(month => {
    (allData[month].leaves || []).forEach(d => leaveRows.push([month, d]));
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(leaveRows), 'Leaves');

  // Wasted Time sheet
  const wastedRows = [['Month', 'Date', 'Hours', 'Note']];
  Object.keys(allData).sort().forEach(month => {
    const we = allData[month].wastedEntries || {};
    Object.keys(we).sort().forEach(date => {
      we[date].forEach(e => wastedRows.push([month, date, e.hours, e.note || '']));
    });
  });
  if (wastedRows.length > 1) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(wastedRows), 'Wasted Time');
  }

  // FM Log sheet
  const fmRows = [['Date', 'Category', 'Title', 'Notes']];
  (userData.fmLog || []).sort((a, b) => a.date.localeCompare(b.date)).forEach(e => {
    fmRows.push([e.date, e.type, e.name, e.notes || '']);
  });
  if (fmRows.length > 1) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(fmRows), 'FM Log');
  }

  XLSX.writeFile(wb, `Timesheet_${new Date().toISOString().slice(0, 10)}.xlsx`);
  showToast('Excel downloaded');
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
