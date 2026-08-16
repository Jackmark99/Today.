import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

/* ============================================================
   FIREBASE CONFIG — same project as before, data carries over.
   ============================================================ */
const firebaseConfig = {
  apiKey: "AIzaSyB4TbEW1hsuJSDznTtAdTnjpkc5j16BR7U",
  authDomain: "planning-equipe-44750.firebaseapp.com",
  projectId: "planning-equipe-44750",
  storageBucket: "planning-equipe-44750.firebasestorage.app",
  messagingSenderId: "458088730695",
  appId: "1:458088730695:web:b4206e8b51902b055b2162"
};

let db = null, auth = null, firebaseOk = false, myUid = null;
try{
  const fbApp = initializeApp(firebaseConfig);
  db = getFirestore(fbApp);
  auth = getAuth(fbApp);
  firebaseOk = true;
}catch(e){ console.warn("Firebase init failed", e); }

/* ============ CONSTANTS ============ */
const jours = ["lu","ma","me","je","ve","sa","di"];
const joursLabelShort = {lu:"Lu",ma:"Ma",me:"Me",je:"Je",ve:"Ve",sa:"Sa",di:"Di"};
const joursLabelUC = {lu:"LUN",ma:"MAR",me:"MER",je:"JEU",ve:"VEN",sa:"SAM",di:"DIM"};
const monthFr = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
const dayFullFr = ["dimanche","lundi","mardi","mercredi","jeudi","vendredi","samedi"];
const IDENTITY_KEY = "planning-identity";
const THEME_KEY = "planning-theme";

function fmtDate(d){ const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; }
function addDays(dateStr, n){ const d = new Date(dateStr+"T00:00:00"); d.setDate(d.getDate()+n); return fmtDate(d); }
function mondayOf(dateStr){ const d = new Date(dateStr+"T00:00:00"); const dow = d.getDay(); const diff = dow===0?-6:1-dow; d.setDate(d.getDate()+diff); return fmtDate(d); }

/* ============ DEFAULT SEED ============ */
function buildDefaultSeed(){
  const W = (wl, d) => ({wl, d});
  const weeks = [
    W("10/08", {
      lu:{m:{x:["MOMO","QUENTIN"]}, s:{x:["HAMID","MOMO","QUENTIN"]}},
      ma:{m:{x:["MOMO","QUENTIN"]}, s:{x:["HAMID","MOMO","QUENTIN"]}},
      me:{m:{x:["LEA","SAMI"]}, s:{x:["MOMO","SAMI"], n:"Menu du jour"}},
      je:{m:{x:["MOMO","QUENTIN"]}, s:{x:["HAMID","MOMO","QUENTIN"]}},
      ve:{m:{x:["MOMO","QUENTIN"]}, s:{x:["HAMID","MOMO","QUENTIN"]}},
      sa:{m:{x:["MOMO","HAMID"]}, s:{x:["HAMID","MOMO","QUENTIN"]}},
      di:{m:{x:["LEA","QUENTIN"]}, s:null},
    }),
  ];
  const out = {};
  weeks.forEach(w=>{
    const [dd,mm] = w.wl.split("/").map(Number);
    const monday = new Date(2026, mm-1, dd);
    jours.forEach((j,i)=>{ const d=new Date(monday); d.setDate(monday.getDate()+i); out[fmtDate(d)] = w.d[j]; });
  });
  return out;
}
const DEFAULT_ROSTER = [
  {name:"HAMID", role:"salle"},
  {name:"MARLA", role:"salle"},
  {name:"MOMO", role:"cuisine"},
  {name:"UGO", role:"cuisine"},
  {name:"QUENTIN", role:"cuisine"},
  {name:"LEA", role:"salle"},
  {name:"SAMI", role:"cuisine"},
];
const DEFAULT_ADMIN_NAMES = ["HAMID","MARLA","MOMO","UGO"];

/* ============ STATE ============ */
let scheduleData = buildDefaultSeed();
let roster = DEFAULT_ROSTER.slice();
let adminUids = []; // read-only from Firestore, only editable via Firebase Console
let myName = null;
let selectedDate = fmtDate(new Date());
let weekWindowStart = mondayOf(selectedDate);
let teamFilterRole = "all";
let sheetContext = null; // {date, shiftKey}

function isAdmin(){ return myUid && adminUids.includes(myUid); }

function withTimeout(p, ms){ return Promise.race([p, new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')), ms))]); }

/* ============ AUTH ============ */
function initAuth(){
  return new Promise((resolve)=>{
    if(!firebaseOk){ resolve(); return; }
    onAuthStateChanged(auth, user=>{
      if(user){ myUid = user.uid; resolve(); }
    });
    signInAnonymously(auth).catch(e=>{ console.warn("anon auth failed", e); resolve(); });
    setTimeout(resolve, 4000); // never block the UI forever
  });
}

/* ============ LOAD / SAVE ============ */
async function loadAll(){
  try{ myName = localStorage.getItem(IDENTITY_KEY) || null; }catch(e){ myName = null; }
  if(!firebaseOk) return;

  try{
    const snap = await withTimeout(getDoc(doc(db, "planning", "schedule")), 5000);
    if(snap.exists() && snap.data() && snap.data().json){
      const parsed = JSON.parse(snap.data().json);
      if(parsed && Object.keys(parsed).length>0) scheduleData = parsed;
    } else { saveSchedule(); }
  }catch(e){ console.warn("schedule load failed", e); }

  try{
    const snap = await withTimeout(getDoc(doc(db, "planning", "roster")), 5000);
    if(snap.exists() && snap.data() && snap.data().list && snap.data().list.length>0){
      roster = snap.data().list.map(m => typeof m === "string" ? {name:m, role:"salle"} : m);
    } else { saveRoster(); }
  }catch(e){ console.warn("roster load failed", e); }

  try{
    const snap = await withTimeout(getDoc(doc(db, "planning", "admins")), 5000);
    if(snap.exists() && snap.data() && Array.isArray(snap.data().uids)){
      adminUids = snap.data().uids;
    } else {
      // First run: seed the admins doc (editable later only via Firebase Console per the security rules)
      setDoc(doc(db,"planning","admins"), {uids: []}).catch(()=>{});
    }
  }catch(e){ console.warn("admins load failed", e); }

  try{
    onSnapshot(doc(db, "planning", "schedule"), snap=>{
      if(snap.exists() && snap.data() && snap.data().json){
        scheduleData = JSON.parse(snap.data().json);
        if(!document.getElementById('mainStage').classList.contains('is-hidden')) renderAll();
      }
    });
    onSnapshot(doc(db, "planning", "roster"), snap=>{
      if(snap.exists() && snap.data() && snap.data().list){
        roster = snap.data().list.map(m => typeof m === "string" ? {name:m, role:"salle"} : m);
        if(!document.getElementById('mainStage').classList.contains('is-hidden')) renderAll();
      }
    });
    onSnapshot(doc(db, "planning", "admins"), snap=>{
      if(snap.exists() && snap.data() && Array.isArray(snap.data().uids)){
        adminUids = snap.data().uids;
        if(!document.getElementById('mainStage').classList.contains('is-hidden')) renderAll();
      }
    });
  }catch(e){ console.warn("live sync failed", e); }
}
function saveSchedule(){ if(!firebaseOk) return Promise.resolve(); return setDoc(doc(db,"planning","schedule"), {json: JSON.stringify(scheduleData)}).catch(e=>{ console.warn(e); showToast("Échec de l'enregistrement — vérifie ta connexion"); }); }
function saveRoster(){ if(!firebaseOk) return Promise.resolve(); return setDoc(doc(db,"planning","roster"), {list: roster}).catch(e=>{ console.warn(e); showToast("Échec de l'enregistrement — vérifie ta connexion"); }); }
function saveIdentity(name){ myName = name; try{ localStorage.setItem(IDENTITY_KEY, name); }catch(e){} }

function hamidIn(shift){ return shift && shift.x && myName && shift.x.includes(myName); }
function colorVarFor(name){
  const idx = roster.findIndex(p=>p.name===name);
  const n = idx>=0 ? idx : 0;
  return `var(--p-${(n%6)+1})`;
}
function avatarStyle(name){ return name===myName ? `background:var(--me)` : `background:${colorVarFor(name)}`; }
function initial(name){ return (name||"?").trim().charAt(0).toUpperCase(); }

/* ============ TOAST ============ */
let toastTimer = null;
function showToast(msg){
  const t = document.getElementById('toast');
  document.getElementById('toastMsg').textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove('show'), 2600);
}

/* ============ THEME ============ */
function initTheme(){
  let theme = 'light';
  try{ theme = localStorage.getItem(THEME_KEY) || 'light'; }catch(e){}
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeIcon(theme);
}
function updateThemeIcon(theme){
  const btn = document.querySelector('[data-theme-toggle]');
  btn.innerHTML = theme==='dark'
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 14.5A8.5 8.5 0 119.5 4a7 7 0 0010.5 10.5z"/></svg>';
}
document.querySelector('[data-theme-toggle]').addEventListener('click', ()=>{
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur==='dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try{ localStorage.setItem(THEME_KEY, next); }catch(e){}
  updateThemeIcon(next);
});

/* ============ ONBOARDING ============ */
let pickedName = null, pickedRole = 'salle';

function renderOnboarding(){
  const wrap = document.getElementById('obChips');
  wrap.innerHTML = '';
  roster.forEach(p=>{
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'ob-chip' + (p.name===pickedName ? ' is-picked' : '');
    chip.innerHTML = `<span class="av sm" style="background:${colorVarFor(p.name)}">${initial(p.name)}</span>${p.name}`;
    chip.addEventListener('click', ()=>{ pickedName = p.name; renderOnboarding(); document.getElementById('obContinue').disabled = false; });
    wrap.appendChild(chip);
  });
}
document.querySelectorAll('#obRoleToggle .ob-role-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('#obRoleToggle .ob-role-btn').forEach(b=>b.classList.remove('is-active'));
    btn.classList.add('is-active');
    pickedRole = btn.dataset.role;
  });
});
document.getElementById('obAddBtn').addEventListener('click', ()=>{
  const input = document.getElementById('obNewName');
  const v = input.value.trim().toUpperCase();
  if(!v) return;
  if(!roster.find(p=>p.name===v)){ roster.push({name:v, role:pickedRole}); saveRoster(); }
  pickedName = v; input.value = '';
  renderOnboarding();
  document.getElementById('obContinue').disabled = false;
});
document.getElementById('obContinue').addEventListener('click', ()=>{
  if(!pickedName) return;
  saveIdentity(pickedName);
  enterApp();
});

function enterApp(){
  document.getElementById('onboardingStage').classList.add('is-hidden');
  document.getElementById('mainStage').classList.remove('is-hidden');
  document.getElementById('meAvatar').textContent = initial(myName);
  document.getElementById('meLabel').textContent = myName;
  goToTab('today');
  renderAll();
}
document.getElementById('meChip').addEventListener('click', ()=>{
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('is-active'));
  document.querySelectorAll('.view').forEach(v=> v.classList.toggle('is-hidden', v.dataset.view!=='profile'));
  document.getElementById('scroll').scrollTop = 0;
  renderProfile();
});
document.getElementById('pfSwitchBtn').addEventListener('click', ()=>{
  document.getElementById('mainStage').classList.add('is-hidden');
  document.getElementById('onboardingStage').classList.remove('is-hidden');
  pickedName = null;
  document.getElementById('obContinue').disabled = true;
  renderOnboarding();
});

/* ============ TABS ============ */
function goToTab(name){
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('is-active', t.dataset.tab===name));
  document.querySelectorAll('.view').forEach(v=> v.classList.toggle('is-hidden', v.dataset.view!==name));
  document.getElementById('scroll').scrollTop = 0;
}
document.querySelectorAll('.tab').forEach(tab=>{
  tab.addEventListener('click', ()=>{
    const name = tab.dataset.tab;
    goToTab(name);
    if(name==='week') renderWeek();
    if(name==='team') renderTeam();
  });
});

/* ============ TODAY VIEW ============ */
function renderToday(){
  const d = new Date(selectedDate+"T00:00:00");
  document.getElementById('heroDate').textContent = `${dayFullFr[d.getDay()]} ${d.getDate()} ${monthFr[d.getMonth()]}`;

  const day = scheduleData[selectedDate];
  const worksMidi = hamidIn(day && day.m), worksSoir = hamidIn(day && day.s);
  const closedAll = day && day.m && day.m.c && (!day.s || day.s.c);
  const hero = document.getElementById('hero');
  const pill = document.getElementById('heroPill');
  const title = document.getElementById('heroTitle');
  const sub = document.getElementById('heroSub');

  hero.classList.remove('is-work','is-rest');
  if(!day){
    pill.textContent = '—'; title.textContent = 'Pas de données'; sub.textContent = '';
  } else if(worksMidi || worksSoir){
    hero.classList.add('is-work');
    pill.textContent = 'Travail';
    const both = worksMidi && worksSoir;
    title.textContent = both ? 'Double aujourd\u2019hui \uD83D\uDCAA' : (worksSoir ? 'Tu travailles ce soir' : 'Tu travailles ce midi');
    const withShift = worksSoir ? day.s : day.m;
    const others = withShift.x.filter(n=>n!==myName);
    sub.innerHTML = (worksSoir?'<b>Ce soir</b>':'<b>Ce midi</b>') + (others.length? ' · avec ' + others.join(' et ') : '');
  } else if(closedAll){
    pill.textContent = 'Fermé'; title.textContent = 'Restaurant fermé'; sub.textContent = '';
  } else {
    hero.classList.add('is-rest');
    pill.textContent = 'Repos';
    title.textContent = 'Journée off \u2728';
    sub.textContent = 'Profite bien.';
  }

  renderNextService();

  const split = document.getElementById('todaySplit');
  split.innerHTML = '';
  ['m','s'].forEach(k=>{
    const shift = day ? day[k] : null;
    const isMine = shift && shift.x && shift.x.includes(myName);
    const slot = document.createElement('div');
    slot.className = 'slot' + (isMine ? ' mine' : '');
    let inner = `<div class="slot-head">${k==='m'?'☀️ Midi':'🌙 Soir'}</div>`;
    if(!shift){ inner += '<span class="empty">Personne</span>'; }
    else if(shift.c){ inner += '<span class="empty">Fermé</span>'; }
    else{
      inner += '<div class="crew">' + shift.x.map(n=>
        `<div class="crew-item${n===myName?' me':''}"><span class="av sm" style="${avatarStyle(n)}">${initial(n)}</span>${n}</div>`
      ).join('') + '</div>';
    }
    slot.innerHTML = inner;
    split.appendChild(slot);
  });

  renderDayStrip();
}

function renderNextService(){
  const wrap = document.getElementById('nextWrap');
  const txt = document.getElementById('nextTxt');
  // find the next upcoming shift (today or later) that includes myName
  for(let i=0;i<14;i++){
    const ds = addDays(fmtDate(new Date()), i);
    const day = scheduleData[ds];
    if(!day) continue;
    for(const k of ['m','s']){
      const shift = day[k];
      if(shift && shift.x && shift.x.includes(myName)){
        const d = new Date(ds+"T00:00:00");
        const isToday = ds===fmtDate(new Date());
        const when = isToday ? (k==='m'?"aujourd'hui midi":"ce soir") : `${dayFullFr[d.getDay()]} ${d.getDate()} ${k==='m'?'midi':'soir'}`;
        const others = shift.x.filter(n=>n!==myName);
        wrap.style.display = 'flex';
        txt.innerHTML = `<b>Prochain service</b>${k==='m'?'☀️':'🌙'} ${when.charAt(0).toUpperCase()+when.slice(1)}` + (others.length?` avec ${others.join(' et ')}`:'');
        return;
      }
    }
  }
  wrap.style.display = 'none';
}

function renderDayStrip(){
  const el = document.getElementById('dayStrip');
  el.innerHTML = '';
  const monday = mondayOf(selectedDate);
  for(let i=0;i<7;i++){
    const ds = addDays(monday, i);
    const day = scheduleData[ds];
    const works = day && (hamidIn(day.m) || hamidIn(day.s));
    const d = new Date(ds+"T00:00:00");
    const chip = document.createElement('div');
    chip.className = 'day' + (ds===selectedDate ? ' is-sel' : '');
    chip.innerHTML = `<span class="day-l">${joursLabelShort[jours[i]]}</span><span class="day-n">${d.getDate()}</span><span class="day-dot${works?'':' off'}"></span>`;
    chip.addEventListener('click', ()=>{ selectedDate = ds; renderToday(); });
    el.appendChild(chip);
  }
}

document.getElementById('shareBtn').addEventListener('click', async ()=>{
  const day = scheduleData[selectedDate];
  const d = new Date(selectedDate+"T00:00:00");
  const dateLabel = `${dayFullFr[d.getDay()]} ${d.getDate()} ${monthFr[d.getMonth()]}`;
  let text = `Planning — ${dateLabel}\n`;
  ['m','s'].forEach(k=>{
    const shift = day ? day[k] : null;
    text += (k==='m' ? '\u2600\ufe0f Midi : ' : '\uD83C\uDF19 Soir : ');
    if(!shift) text += 'personne\n';
    else if(shift.c) text += 'fermé\n';
    else text += shift.x.join(', ') + '\n';
  });
  try{
    if(navigator.share){ await navigator.share({title:'Planning', text}); }
    else{ await navigator.clipboard.writeText(text); showToast('Copié — colle-le où tu veux'); }
  }catch(e){}
});

/* ============ WEEK VIEW ============ */
function renderWeek(){
  const monday = weekWindowStart;
  const sunday = addDays(monday, 6);
  const fmtShort = ds=>{ const d=new Date(ds+"T00:00:00"); return `${d.getDate()} ${monthFr[d.getMonth()].slice(0,3)}`; };
  document.getElementById('wLabel').textContent = `${fmtShort(monday)} — ${fmtShort(sunday)}`;
  const todayMonday = mondayOf(fmtDate(new Date()));
  document.getElementById('wMeta').textContent = monday===todayMonday ? 'Cette semaine' : '';

  const grid = document.getElementById('wGrid');
  grid.innerHTML = '';
  const todayStr = fmtDate(new Date());
  let myDaysCount = 0;

  const dayCardsEl = document.getElementById('dayCards');
  dayCardsEl.innerHTML = '';

  for(let i=0;i<7;i++){
    const ds = addDays(monday, i);
    const day = scheduleData[ds];
    const d = new Date(ds+"T00:00:00");
    const isToday = ds===todayStr;
    const closedAll = day && day.m && day.m.c && (!day.s || day.s.c);
    if(day && (hamidIn(day.m) || hamidIn(day.s))) myDaysCount++;

    // --- grid row ---
    const row = document.createElement('div');
    row.className = 'wrow' + (isToday?' today':'') + (closedAll?' rest':'');
    const cellHtml = (shift)=>{
      if(!shift) return '<span class="wdash">—</span>';
      if(shift.c) return '<span class="wdash">Fermé</span>';
      return shift.x.map(n=>`<span class="av sm${n===myName?' is-me':''}" style="${avatarStyle(n)}" title="${n}">${initial(n)}</span>`).join('');
    };
    row.innerHTML = `
      <div class="wday"><b>${joursLabelShort[jours[i]]}</b><span>${d.getDate()}</span></div>
      <div class="wcell">${cellHtml(day && day.m)}</div>
      <div class="wcell">${cellHtml(day && day.s)}</div>`;
    if(isAdmin()){
      row.querySelector('.wcell:nth-child(2)').addEventListener('click', ()=> openSheet(ds, 'm'));
      row.querySelector('.wcell:nth-child(3)').addEventListener('click', ()=> openSheet(ds, 's'));
    }
    grid.appendChild(row);

    // --- daily card ---
    const card = document.createElement('div');
    card.className = 'dcard' + (closedAll?' rest':'');
    const rowHtml = (shift, label)=>{
      let names;
      if(!shift) names = '<span class="dcard-empty">Personne</span>';
      else if(shift.c) names = '<span class="dcard-empty">Fermé</span>';
      else names = shift.x.map(n=> n===myName ? `<span class="me">${n}</span>` : n).join(' · ');
      return `<div class="dcard-row"><span class="lbl">${label}</span><span class="dcard-names">${names}</span></div>`;
    };
    card.innerHTML = `<div class="dcard-head"><b>${joursLabelUC[jours[i]]} ${d.getDate()}</b>${closedAll?'<span>fermé</span>':''}</div>`
      + rowHtml(day && day.m, '☀️ Midi') + rowHtml(day && day.s, '🌙 Soir');
    if(isAdmin()){
      card.addEventListener('click', ()=> openSheet(ds, 'm'));
    }
    dayCardsEl.appendChild(card);
  }

  document.getElementById('joursPourToi').innerHTML = `<b>${myDaysCount}</b> jour${myDaysCount>1?'s':''} pour toi cette semaine`;
}
document.getElementById('wPrev').addEventListener('click', ()=>{ weekWindowStart = addDays(weekWindowStart, -7); renderWeek(); });
document.getElementById('wNext').addEventListener('click', ()=>{ weekWindowStart = addDays(weekWindowStart, 7); renderWeek(); });

document.getElementById('copyBtn').addEventListener('click', async ()=>{
  if(!isAdmin()){ showToast("Seuls les managers peuvent modifier le planning"); return; }
  const nextMonday = addDays(weekWindowStart, 7);
  for(let i=0;i<7;i++){
    const src = addDays(weekWindowStart, i);
    const dst = addDays(nextMonday, i);
    if(scheduleData[src]) scheduleData[dst] = JSON.parse(JSON.stringify(scheduleData[src]));
  }
  await saveSchedule();
  showToast('Semaine copiée vers la suivante \u2705');
  renderWeek();
});

/* ============ SHIFT EDIT SHEET ============ */
function openSheet(dateStr, initialShiftKey){
  if(!isAdmin()) return;
  const day = scheduleData[dateStr] || {m:null, s:null};
  sheetContext = {
    date: dateStr,
    shiftKey: initialShiftKey || 'm',
    draft: {
      m: day.m ? {x:(day.m.x||[]).slice(), n: day.m.n || ''} : null,
      s: day.s ? {x:(day.s.x||[]).slice(), n: day.s.n || ''} : null,
    }
  };
  document.querySelectorAll('#sheetShiftToggle .sheet-shift-btn').forEach(b=>
    b.classList.toggle('is-active', b.dataset.shift===sheetContext.shiftKey));
  renderSheetShift();
  document.getElementById('sheetBackdrop').classList.add('show');
  document.getElementById('sheet').classList.add('show');
}

function readSheetIntoDraft(){
  if(!sheetContext) return;
  const selected = Array.from(document.querySelectorAll('#sheetPeople .pickcircle.is-selected'))
    .map(el => el.querySelector('span:last-child').textContent);
  const note = document.getElementById('sheetNote').value.trim();
  sheetContext.draft[sheetContext.shiftKey] = selected.length ? {x: selected, n: note} : null;
}

function renderSheetShift(){
  const { date, shiftKey, draft } = sheetContext;
  const d = new Date(date+"T00:00:00");
  document.getElementById('sheetTitle').textContent =
    `${dayFullFr[d.getDay()].charAt(0).toUpperCase()+dayFullFr[d.getDay()].slice(1)} ${d.getDate()} · ${shiftKey==='m'?'Midi':'Soir'}`;

  const shift = draft[shiftKey];
  const selectedNames = shift ? shift.x.slice() : [];

  const peopleEl = document.getElementById('sheetPeople');
  peopleEl.innerHTML = '';
  roster.forEach(p=>{
    const isSel = selectedNames.includes(p.name);
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'pickcircle' + (isSel ? ' is-selected' : '');
    el.innerHTML = `<span class="av lg" style="${p.name===myName?'background:var(--me)':`background:${colorVarFor(p.name)}`}">${initial(p.name)}</span><span>${p.name}</span>`;
    el.addEventListener('click', ()=>{
      if(el.classList.contains('is-selected')){
        if(confirm(`Retirer ${p.name} de ce service ?`)){ el.classList.remove('is-selected'); }
      } else {
        el.classList.add('is-selected');
      }
    });
    peopleEl.appendChild(el);
  });

  document.getElementById('sheetNote').value = shift ? (shift.n || '') : '';
}

document.querySelectorAll('#sheetShiftToggle .sheet-shift-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    if(!sheetContext || btn.dataset.shift===sheetContext.shiftKey) return;
    readSheetIntoDraft(); // keep whatever was being edited on the shift we're leaving
    sheetContext.shiftKey = btn.dataset.shift;
    document.querySelectorAll('#sheetShiftToggle .sheet-shift-btn').forEach(b=>b.classList.toggle('is-active', b===btn));
    renderSheetShift();
  });
});

function closeSheet(){
  document.getElementById('sheetBackdrop').classList.remove('show');
  document.getElementById('sheet').classList.remove('show');
  sheetContext = null;
}
document.getElementById('sheetBackdrop').addEventListener('click', closeSheet);

document.getElementById('sheetDoneBtn').addEventListener('click', async ()=>{
  if(!sheetContext || !isAdmin()) { closeSheet(); return; }
  readSheetIntoDraft();
  const { date, draft } = sheetContext;
  scheduleData[date] = { m: draft.m, s: draft.s };

  await saveSchedule();
  showToast('Service mis à jour \u2705');
  closeSheet();
  renderWeek();
  if(date===selectedDate) renderToday();
});

/* ============ TEAM VIEW ============ */
function renderTeam(){
  renderEquity();
  renderPeople();
  renderAddMember();
}

function renderEquity(){
  const monday = weekWindowStart;
  const el = document.getElementById('equity');
  el.innerHTML = '';
  const counts = {};
  roster.forEach(p=> counts[p.name] = {midi:0, soir:0});
  for(let i=0;i<7;i++){
    const ds = addDays(monday, i);
    const day = scheduleData[ds];
    if(!day) continue;
    ['m','s'].forEach(k=>{
      const shift = day[k];
      if(shift && shift.x){
        shift.x.forEach(n=>{
          if(!counts[n]) counts[n] = {midi:0, soir:0};
          if(k==='m') counts[n].midi++; else counts[n].soir++;
        });
      }
    });
  }
  const maxTotal = Math.max(1, ...Object.values(counts).map(c=>c.midi+c.soir));
  roster.forEach(p=>{
    const c = counts[p.name] || {midi:0, soir:0};
    const total = c.midi + c.soir;
    const card = document.createElement('div');
    card.className = 'eq' + (p.name===myName ? ' is-me' : '');
    const midiPct = total ? (c.midi/maxTotal*100) : 0;
    const soirPct = total ? (c.soir/maxTotal*100) : 0;
    card.innerHTML = `
      <div class="eq-top">
        <span class="av sm" style="${avatarStyle(p.name)}">${initial(p.name)}</span>
        <span class="eq-name">${p.name}</span>
        <span class="eq-total">${total} service${total>1?'s':''}</span>
      </div>
      <div class="bar"><i class="midi" style="width:${midiPct}%"></i><i class="soir" style="width:${soirPct}%"></i></div>
      <div class="eq-legend"><span><b>${c.midi}</b> midis</span><span><b>${c.soir}</b> soirs</span></div>`;
    el.appendChild(card);
  });
}

function renderPeople(){
  const el = document.getElementById('people');
  el.innerHTML = '';
  const filtered = roster.filter(p=> teamFilterRole==='all' || p.role===teamFilterRole);
  filtered.forEach(p=>{
    const admin = DEFAULT_ADMIN_NAMES.includes(p.name);
    const showBadge = p.name===myName ? '' : (admin?'<span class="manager-badge">Manager</span>':'<span class="member-badge">Membre</span>');
    const row = document.createElement('div');
    row.className = 'person';
    row.innerHTML = `
      <span class="av" style="${p.name===myName?'background:var(--me)':avatarStyle(p.name)}">${initial(p.name)}</span>
      <div class="person-txt"><b>${p.name} ${showBadge}</b><span>${p.role==='cuisine'?'Cuisine':'Salle'}</span></div>
      ${(p.name!==myName && isAdmin()) ? '<button class="icon-btn rm-person" aria-label="Retirer">✕</button>' : ''}`;
    if(p.name!==myName && isAdmin()){
      row.querySelector('.rm-person').addEventListener('click', async ()=>{
        if(roster.length<=1) return;
        if(!confirm(`Retirer ${p.name} de l'équipe ?`)) return;
        roster = roster.filter(x=>x.name!==p.name);
        await saveRoster();
        renderTeam();
      });
    }
    el.appendChild(row);
  });
}

document.querySelectorAll('#teamFilter .tf-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('#teamFilter .tf-btn').forEach(b=>b.classList.remove('is-active'));
    btn.classList.add('is-active');
    teamFilterRole = btn.dataset.role;
    renderPeople();
  });
});

function renderAddMember(){
  const zone = document.getElementById('addMemberZone');
  if(!isAdmin()){ zone.innerHTML = ''; return; }
  zone.innerHTML = `
    <h2 class="sec-title">Ajouter un membre</h2>
    <input type="text" id="teamNewName" class="ob-input" placeholder="Prénom">
    <div class="ob-roletoggle" id="teamRoleToggle">
      <button type="button" class="ob-role-btn is-active" data-role="salle">Salle</button>
      <button type="button" class="ob-role-btn" data-role="cuisine">Cuisine</button>
    </div>
    <button class="btn btn-solid" id="teamAddBtn" style="width:100%;">Ajouter</button>`;
  let teamNewRole = 'salle';
  zone.querySelectorAll('#teamRoleToggle .ob-role-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      zone.querySelectorAll('#teamRoleToggle .ob-role-btn').forEach(b=>b.classList.remove('is-active'));
      btn.classList.add('is-active');
      teamNewRole = btn.dataset.role;
    });
  });
  zone.querySelector('#teamAddBtn').addEventListener('click', async ()=>{
    const input = zone.querySelector('#teamNewName');
    const v = input.value.trim().toUpperCase();
    if(!v || roster.find(p=>p.name===v)) return;
    roster.push({name:v, role:teamNewRole});
    await saveRoster();
    input.value = '';
    renderTeam();
    showToast(`${v} ajouté(e) à l'équipe`);
  });
}

document.getElementById('btnCopyLink').addEventListener('click', async ()=>{
  try{ await navigator.clipboard.writeText(window.location.href); showToast('Lien copié \u2705'); }
  catch(e){ showToast(window.location.href); }
});

/* ============ PROFILE VIEW ============ */
function renderProfile(){
  document.getElementById('pfAvatar').textContent = initial(myName);
  document.getElementById('pfName').textContent = myName;
  const me = roster.find(p=>p.name===myName);
  document.getElementById('pfRoleLabel').textContent = (me && me.role==='cuisine') ? 'Cuisine' : 'Salle';
  document.getElementById('pfNewName').value = '';

  const adminZone = document.getElementById('pfAdminZone');
  if(isAdmin() && myUid){
    adminZone.innerHTML = `
      <h2 class="sec-title">Identifiant appareil</h2>
      <p class="hint tight">Déjà enregistré comme manager sur cet appareil.</p>
      <div class="device-id-box">${myUid}</div>`;
  } else if(DEFAULT_ADMIN_NAMES.includes(myName) && myUid){
    adminZone.innerHTML = `
      <h2 class="sec-title">Activation manager</h2>
      <p class="hint tight">Envoie cet identifiant à la personne qui configure l'appli, pour activer tes droits manager sur cet appareil :</p>
      <div class="device-id-box">${myUid}</div>
      <button class="btn btn-ghost" id="copyUidBtn" style="width:100%;margin-top:8px;">Copier l'identifiant</button>`;
    adminZone.querySelector('#copyUidBtn').addEventListener('click', async ()=>{
      try{ await navigator.clipboard.writeText(myUid); showToast('Identifiant copié'); }
      catch(e){ showToast(myUid); }
    });
  } else {
    adminZone.innerHTML = '';
  }
}

document.getElementById('pfRenameBtn').addEventListener('click', async ()=>{
  const newName = document.getElementById('pfNewName').value.trim().toUpperCase();
  if(!newName || newName===myName) return;
  if(roster.find(p=>p.name===newName)){ showToast('Ce prénom existe déjà dans l\u2019équipe'); return; }

  const oldName = myName;
  // Update roster entry
  const entry = roster.find(p=>p.name===oldName);
  if(entry) entry.name = newName;
  await saveRoster();

  // Propagate through every schedule entry, past and future
  Object.keys(scheduleData).forEach(ds=>{
    const day = scheduleData[ds];
    ['m','s'].forEach(k=>{
      if(day && day[k] && day[k].x){
        day[k].x = day[k].x.map(n=> n===oldName ? newName : n);
      }
    });
  });
  await saveSchedule();

  saveIdentity(newName);
  document.getElementById('meLabel').textContent = newName;
  document.getElementById('meAvatar').textContent = initial(newName);
  showToast('Prénom mis à jour partout \u2705');
  renderProfile();
  renderAll();
});

/* ============ RENDER ALL ============ */
function renderAll(){
  renderToday();
  if(!document.querySelector('[data-view="week"]').classList.contains('is-hidden')) renderWeek();
  if(!document.querySelector('[data-view="team"]').classList.contains('is-hidden')) renderTeam();
  if(!document.querySelector('[data-view="profile"]').classList.contains('is-hidden')) renderProfile();
}

/* ============ PWA ============ */
(function setupPWA(){
  try{ if("serviceWorker" in navigator){ navigator.serviceWorker.register("sw.js").catch(()=>{}); } }catch(e){}
})();

/* ============ INIT ============ */
(async function init(){
  initTheme();
  renderOnboarding();
  await initAuth();
  await loadAll();
  renderOnboarding();
  if(myName){ enterApp(); }
})();
