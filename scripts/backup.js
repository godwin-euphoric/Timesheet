/**
 * Timesheet Daily Backup
 * Fetches all Firestore data for the user and writes a fully-formatted Excel file.
 * Run via GitHub Actions — requires env vars:
 *   FIREBASE_SERVICE_ACCOUNT  (JSON string of service account key)
 *   FIREBASE_USER_UID         (your Firebase Auth UID)
 */

'use strict';

const admin   = require('firebase-admin');
const ExcelJS = require('exceljs');
const path    = require('path');
const fs      = require('fs');

// ── Firebase init ─────────────────────────────────────────────────────────────
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db  = admin.firestore();
const uid = process.env.FIREBASE_USER_UID;

if (!uid) { console.error('FIREBASE_USER_UID is not set'); process.exit(1); }

// ── Helpers (mirrors app.js) ──────────────────────────────────────────────────
function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }
function todayStr() { return new Date().toISOString().slice(0, 10); }
function formatMonth(m) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' });
}

const FITNESS_CAT  = 'Fitness';
const FITNESS_SUBS = ['fitGYM', 'fitMMA', 'fitOthers'];

// ── Firestore fetch ───────────────────────────────────────────────────────────
async function fetchAllData() {
  const [monthsSnap, userDoc] = await Promise.all([
    db.collection('users').doc(uid).collection('months').get(),
    db.collection('users').doc(uid).get()
  ]);
  const allData = {};
  monthsSnap.forEach(doc => { allData[doc.id] = doc.data(); });
  const userData = userDoc.exists ? userDoc.data() : {};
  if (!userData.fmLog)     userData.fmLog     = [];
  if (!userData.habits)    userData.habits     = [];
  if (!userData.habitLog)  userData.habitLog   = {};
  if (!userData.planners)  userData.planners   = [];
  return { allData, userData };
}

// ── Style constants ───────────────────────────────────────────────────────────
const BORDER     = { top:{style:'thin',color:{argb:'FFB0B0B0'}}, left:{style:'thin',color:{argb:'FFB0B0B0'}}, bottom:{style:'thin',color:{argb:'FFB0B0B0'}}, right:{style:'thin',color:{argb:'FFB0B0B0'}} };
const BLUE_FILL  = { type:'pattern', pattern:'solid', fgColor:{argb:'FF2E75B6'} };
const BLUE_FONT  = { bold:true, color:{argb:'FFFFFFFF'}, size:11 };
const LTBLUE     = { type:'pattern', pattern:'solid', fgColor:{argb:'FFDAE3F3'} };
const BOLD_FONT  = { bold:true, size:11 };
const GRAY_FILL  = { type:'pattern', pattern:'solid', fgColor:{argb:'FFF2F2F2'} };
const GREEN_FILL = { type:'pattern', pattern:'solid', fgColor:{argb:'FF548235'} };
const GREEN_FONT = { bold:true, color:{argb:'FFFFFFFF'}, size:11 };
const LGFILL     = { type:'pattern', pattern:'solid', fgColor:{argb:'FFE2EFDA'} };
const LGFONT     = { bold:true, size:11 };

function styleRow(row, n, fill, font) {
  row.height = 18;
  for (let c = 1; c <= n; c++) {
    const cell = row.getCell(c);
    if (fill) cell.fill = fill;
    if (font) cell.font = font;
    cell.border = BORDER;
    cell.alignment = { vertical:'middle' };
  }
}
function borderRow(row, n) {
  for (let c = 1; c <= n; c++) row.getCell(c).border = BORDER;
}
function sanitizeName(n) {
  return String(n||'').replace(/[:\\/*?\[\]]/g,' ').trim().slice(0,28)||'Sheet';
}

// ── Build Excel workbook ──────────────────────────────────────────────────────
async function buildWorkbook(allData, userData) {
  const wb   = new ExcelJS.Workbook();
  wb.creator = 'Timesheet Backup';
  wb.created = new Date();

  const today    = todayStr();
  const curMonth = today.slice(0, 7);
  const months   = Object.keys(allData).sort();

  // ── 1. Yearly Overview ──────────────────────────────────────────────────────
  {
    const yearMonths = months.filter(m => m <= curMonth);
    if (yearMonths.length) {
      const allCats = [...new Set(yearMonths.flatMap(m => (allData[m].categories||[]).map(c=>c.category)))];
      const ws = wb.addWorksheet('Yearly Overview');
      ws.getColumn(1).width=18; ws.getColumn(2).width=14;
      allCats.forEach((_,i)=>{ ws.getColumn(3+i).width=14; });
      ws.getColumn(3+allCats.length).width=12; ws.getColumn(4+allCats.length).width=10;
      ws.getColumn(5+allCats.length).width=12; ws.getColumn(6+allCats.length).width=12;
      ws.getColumn(7+allCats.length).width=36;

      const hRow = ws.addRow(['Month','Working Days',...allCats,'Total Done','Wasted','GYM Days','MMA Days','Comments']);
      styleRow(hRow, 2+allCats.length+5, BLUE_FILL, BLUE_FONT);

      yearMonths.forEach(month => {
        const mData = allData[month];
        const [y,mo] = month.split('-').map(Number);
        const leavesSet = new Set(mData.leaves||[]);
        const isCur = month===curMonth;
        const endDay = isCur ? new Date().getDate() : daysInMonth(y,mo);
        let wd=0;
        for(let d=1;d<=endDay;d++){const dt=new Date(y,mo-1,d);const ds=`${month}-${String(d).padStart(2,'0')}`;if(dt.getDay()!==0&&dt.getDay()!==6&&!leavesSet.has(ds))wd++;}
        const ents=mData.entries||{};
        let mDone=0;
        const catCells=allCats.map(cat=>{let done=0;Object.values(ents).forEach(dayE=>{done+=dayE[cat]||0;});done=Math.round(done*100)/100;mDone+=done;return done||'';});
        let mWasted=0;Object.values(mData.wastedEntries||{}).forEach(arr=>arr.forEach(e=>{mWasted+=e.hours||0;}));mWasted=Math.round(mWasted*100)/100;
        const mbd=mData.fitnessBreakdown||{};
        const mGym=Object.values(mbd).filter(d=>(d.fitGYM||0)>0).length;
        const mMma=Object.values(mbd).filter(d=>(d.fitMMA||0)>0).length;
        const row=ws.addRow([formatMonth(month),wd,...catCells,Math.round(mDone*100)/100||'',mWasted||'',mGym||'',mMma||'',mData.yearlyComment||'']);
        borderRow(row, 2+allCats.length+5);
      });
    }
  }

  // ── 2. One sheet per month (entries) ───────────────────────────────────────
  for (const month of months.filter(m => m <= curMonth)) {
    const data = allData[month];
    const cats = (data.categories||[]).map(c=>c.category);
    const [y,m] = month.split('-').map(Number);
    const total = daysInMonth(y,m);
    const ws = wb.addWorksheet(sanitizeName(`E - ${month} Entries`));
    ws.getColumn(1).width=14; ws.getColumn(2).width=8;
    cats.forEach((_,i)=>{ws.getColumn(3+i).width=12;});
    ws.getColumn(3+cats.length).width=10; ws.getColumn(4+cats.length).width=12; ws.getColumn(5+cats.length).width=10;

    const hRow = ws.addRow(['Date','Day',...cats,'Total','Status','Wasted']);
    styleRow(hRow, 2+cats.length+3, BLUE_FILL, BLUE_FONT);

    const dn=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const entries=data.entries||{};
    const leavesSet=new Set(data.leaves||[]);
    const wastedEntries=data.wastedEntries||{};
    for(let d=1;d<=total;d++){
      const dt=new Date(y,m-1,d);
      const dateStr=`${month}-${String(d).padStart(2,'0')}`;
      const dayEntries=entries[dateStr]||{};
      let dayTotal=0;
      const catVals=cats.map(cat=>{const h=dayEntries[cat]||0;dayTotal+=h;return h||'';});
      dayTotal=Math.round(dayTotal*100)/100;
      let status='';
      if(dateStr>today)status='Future';
      else if(leavesSet.has(dateStr))status='Leave';
      else if(dayTotal>0)status='Done';
      else if(dt.getDay()===0||dt.getDay()===6)status='Weekend';
      else status='No entry';
      const wHrs=Math.round((wastedEntries[dateStr]||[]).reduce((s,e)=>s+(e.hours||0),0)*100)/100;
      const row=ws.addRow([dateStr,dn[dt.getDay()],...catVals,dayTotal||'',status,wHrs||'']);
      borderRow(row, 2+cats.length+3);
      if(dt.getDay()===0||dt.getDay()===6) row.eachCell(cell=>{cell.fill=GRAY_FILL;});
    }
  }

  // ── 3. Journal ──────────────────────────────────────────────────────────────
  const fmEntries=(userData.fmLog||[]).slice().sort((a,b)=>a.date.localeCompare(b.date));
  if(fmEntries.length){
    const ws=wb.addWorksheet('E - Journal');
    ws.getColumn(1).width=14;ws.getColumn(2).width=20;ws.getColumn(3).width=42;ws.getColumn(4).width=42;
    const hRow=ws.addRow(['Date','Category','Title','Notes']);
    styleRow(hRow,4,BLUE_FILL,BLUE_FONT);
    fmEntries.forEach(e=>{const row=ws.addRow([e.date,e.type,e.name,e.notes||'']);borderRow(row,4);});
  }

  // ── 4. Habits ───────────────────────────────────────────────────────────────
  const habits=userData.habits||[];
  const habitLog=userData.habitLog||{};
  if(habits.length){
    const ws=wb.addWorksheet('E - Habits');
    ws.getColumn(1).width=30;
    const lhRow=ws.addRow(['Habit Name']);
    styleRow(lhRow,1,BLUE_FILL,BLUE_FONT);
    habits.forEach(h=>{const row=ws.addRow([h]);borderRow(row,1);});
    ws.addRow([]);
    const dates=Object.keys(habitLog).sort();
    if(dates.length){
      const ghRow=ws.addRow(['Date',...habits]);
      styleRow(ghRow,1+habits.length,BLUE_FILL,BLUE_FONT);
      habits.forEach((_,i)=>{ws.getColumn(2+i).width=20;});
      dates.forEach(d=>{
        const vals=habits.map(h=>(habitLog[d]||{})[h]?'Yes':'');
        const row=ws.addRow([d,...vals]);
        borderRow(row,1+habits.length);
      });
    }
  }

  // ── 5. Planners (one sheet per planner) ────────────────────────────────────
  (userData.planners||[]).forEach(pl=>{
    const ws=wb.addWorksheet(sanitizeName(`E - ${pl.name}`));
    let first=true;
    (pl.blocks||[]).forEach(block=>{
      const cols=block.cols||['Col1','Col2'];
      if(!first)ws.addRow([]);
      first=false;
      const bRow=ws.addRow([block.header]);
      bRow.height=20;
      const bc=bRow.getCell(1);bc.fill=GREEN_FILL;bc.font=GREEN_FONT;bc.border=BORDER;bc.alignment={vertical:'middle'};
      const cRow=ws.addRow(cols);
      styleRow(cRow,cols.length,LGFILL,LGFONT);
      (block.rows||[]).forEach(r=>{
        const row=ws.addRow(cols.map((_,ci)=>r['c'+ci]||''));
        borderRow(row,cols.length);
      });
    });
    const maxCols=Math.max(...(pl.blocks||[]).map(b=>(b.cols||[]).length),1);
    for(let c=1;c<=maxCols;c++)ws.getColumn(c).width=35;
  });

  return wb;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Fetching data from Firestore...');
  const { allData, userData } = await fetchAllData();

  // Check if this run matches the user's preferred backup hour (UTC)
  const preferredHour = userData.backupHour !== undefined ? userData.backupHour : 2;
  const currentHour   = new Date().getUTCHours();
  if (currentHour !== preferredHour) {
    console.log(`Skipping: current UTC hour ${currentHour} ≠ preferred hour ${preferredHour}`);
    await admin.app().delete();
    return;
  }
  console.log(`UTC hour ${currentHour} matches preference — proceeding with backup`);

  const monthCount = Object.keys(allData).length;
  console.log(`Found ${monthCount} months of data`);

  console.log('Building Excel workbook...');
  const wb = await buildWorkbook(allData, userData);

  const backupsDir = path.join(__dirname, '..', 'backups');
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

  const date     = todayStr();
  const filename = path.join(backupsDir, `Timesheet_${date}.xlsx`);
  await wb.xlsx.writeFile(filename);

  console.log(`✓ Backup saved: backups/Timesheet_${date}.xlsx`);
  await admin.app().delete();
}

main().catch(err => { console.error('Backup failed:', err); process.exit(1); });
