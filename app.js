import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore, doc, collection, getDoc, getDocs, setDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

/* ============================================================
   FIREBASE CONFIG — same project as before.
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
const IDENTITY_KEY = "planning-member-id";
const THEME_KEY = "planning-theme";
const DEPT_KEY = "planning-dept";

function fmtDate(d){ const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; }
function addDays(dateStr, n){ const d = new Date(dateStr+"T00:00:00"); d.setDate(d.getDate()+n); return fmtDate(d); }
function mondayOf(dateStr){ const d = new Date(dateStr+"T00:00:00"); const dow = d.getDay(); const diff = dow===0?-6:1-dow; d.setDate(d.getDate()+diff); return fmtDate(d); }
function todayStr(){ return fmtDate(new Date()); }

/* ============ STATE ============ */
let members = {};        // memberId -> {name, active, createdAt, updatedAt}
let daysCache = {};       // dateStr -> {salle:{m,s}, cuisine:{m,s}}
let daySubs = {};         // dateStr -> unsubscribe fn
let adminUids = [];       // read-only, editable only via Firebase Console
let myMemberId = null;
let currentDept = 'salle';
let selectedDate = todayStr();
let weekWindowStart = mondayOf(selectedDate);
let sheetContext = null;  // {date, shiftKey, dept, draft:{m,s}}

function isAdmin(){ return !!(myUid && adminUids.includes(myUid)); }
function myName(){ const m = members[myMemberId]; return m ? m.name : null; }
function activeMembers(){ return Object.entries(members).filter(([id,m])=>m.active!==false).map(([id,m])=>({id,...m})); }
function memberName(id){ const m = members[id]; return m ? m.name : '?'; }
function withTimeout(p, ms){ return Promise.race([p, new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')), ms))]); }

/* ============ AUTH ============ */
function initAuth(){
  return new Promise((resolve)=>{
    if(!firebaseOk){ resolve(); return; }
    onAuthStateChanged(auth, user=>{ if(user){ myUid = user.uid; resolve(); } });
    signInAnonymously(auth).catch(e=>{ console.warn("anon auth failed", e); resolve(); });
    setTimeout(resolve, 4000);
  });
}

/* ============ MEMBERS ============ */
function subscribeMembers(){
  if(!firebaseOk) return;
  try{
    onSnapshot(collection(db,"members"), snap=>{
      const next = {};
      snap.forEach(d=> next[d.id] = d.data());
      members = next;
      if(document.getElementById('onboardingStage') && !document.getElementById('onboardingStage').classList.contains('is-hidden')){
        renderOnboarding();
      }
      if(document.getElementById('mainStage') && !document.getElementById('mainStage').classList.contains('is-hidden')){
        renderAll();
      }
    });
  }catch(e){ console.warn("members sub failed", e); }
}
async function addMember(name){
  const ref = doc(collection(db,"members"));
  const now = Date.now();
  await setDoc(ref, {name, active:true, createdAt:now, updatedAt:now});
  return ref.id;
}
async function renameMember(id, newName){
  const m = members[id]; if(!m) return;
  await setDoc(doc(db,"members",id), {...m, name:newName, updatedAt:Date.now()});
}
async function deactivateMember(id){
  const m = members[id]; if(!m) return;
  await setDoc(doc(db,"members",id), {...m, active:false, updatedAt:Date.now()});
}
async function markSelfManagerHint(id){
  const m = members[id]; if(!m || m.isManagerHint) return; // cosmetic only, never used for permission checks
  try{ await setDoc(doc(db,"members",id), {...m, isManagerHint:true, updatedAt:Date.now()}); }catch(e){}
}

/* ============ ADMINS ============ */
function subscribeAdmins(){
  if(!firebaseOk) return;
  try{
    onSnapshot(doc(db,"planning","admins"), snap=>{
      if(snap.exists() && Array.isArray(snap.data().uids)) adminUids = snap.data().uids;
      if(document.getElementById('mainStage') && !document.getElementById('mainStage').classList.contains('is-hidden')) renderAll();
    });
  }catch(e){ console.warn("admins sub failed", e); }
  // seed the doc once if missing, so the console has something to edit
  getDoc(doc(db,"planning","admins")).then(snap=>{
    if(!snap.exists()) setDoc(doc(db,"planning","admins"), {uids: []}).catch(()=>{});
  }).catch(()=>{});
}

/* ============ DAYS (per-day documents) ============ */
function subscribeDay(dateStr){
  if(!firebaseOk || daySubs[dateStr]) return;
  daySubs[dateStr] = onSnapshot(doc(db,"days",dateStr), snap=>{
    daysCache[dateStr] = snap.exists() ? snap.data() : {};
    if(document.getElementById('mainStage') && !document.getElementById('mainStage').classList.contains('is-hidden')) renderAll();
  }, e=> console.warn("day sub failed", dateStr, e));
}
function ensureDaysSubscribed(dateStrArray){
  dateStrArray.forEach(subscribeDay);
}
async function writeDay(dateStr, dayObj){
  if(!firebaseOk) return;
  await setDoc(doc(db,"days",dateStr), {...dayObj, updatedAt:Date.now(), updatedBy: myMemberId || null})
    .catch(e=>{ console.warn(e); showToast("Échec de l'enregistrement — vérifie ta connexion"); });
}
function getService(dateStr, dept, shiftKey){
  const day = daysCache[dateStr];
  if(!day || !day[dept]) return undefined; // not yet configured
  return day[dept][shiftKey]; // undefined | {closed:true} | {ids:[...]}
}

/* ============ IDENTITY / THEME / DEPT persistence ============ */
function saveIdentity(id){ myMemberId = id; try{ localStorage.setItem(IDENTITY_KEY, id); }catch(e){} }
function colorVarFor(id){
  const ids = Object.keys(members).sort();
  const idx = ids.indexOf(id);
  return `var(--p-${((idx<0?0:idx)%6)+1})`;
}
function avatarStyle(id){ return id===myMemberId ? `background:var(--me)` : `background:${colorVarFor(id)}`; }
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

/* ============ DEPARTMENT TOGGLE (global view) ============ */
function initDept(){
  try{ currentDept = localStorage.getItem(DEPT_KEY) || 'salle'; }catch(e){ currentDept='salle'; }
  document.querySelectorAll('.dept-btn').forEach(b=> b.classList.toggle('is-active', b.dataset.dept===currentDept));
}
document.querySelectorAll('.dept-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    currentDept = btn.dataset.dept;
    try{ localStorage.setItem(DEPT_KEY, currentDept); }catch(e){}
    document.querySelectorAll('.dept-btn').forEach(b=>b.classList.toggle('is-active', b===btn));
    renderAll();
  });
});

/* ============ ONBOARDING ============ */
let pickedMemberId = null;

function renderOnboarding(){
  const wrap = document.getElementById('obChips');
  const list = activeMembers();
  wrap.innerHTML = '';
  document.getElementById('obEmptyState').style.display = list.length===0 ? 'block' : 'none';
  list.forEach(p=>{
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'ob-chip' + (p.id===pickedMemberId ? ' is-picked' : '');
    chip.innerHTML = `<span class="av sm" style="background:${colorVarFor(p.id)}">${initial(p.name)}</span>${p.name}`;
    chip.addEventListener('click', ()=>{ pickedMemberId = p.id; renderOnboarding(); document.getElementById('obContinue').disabled = false; });
    wrap.appendChild(chip);
  });
  document.getElementById('obAdminAddZone').style.display = isAdmin() ? 'block' : 'none';
}
document.getElementById('obAddBtn').addEventListener('click', async ()=>{
  const input = document.getElementById('obNewName');
  const v = input.value.trim();
  if(!v) return;
  const id = await addMember(v);
  pickedMemberId = id; input.value = '';
  renderOnboarding();
  document.getElementById('obContinue').disabled = false;
});
document.getElementById('obContinue').addEventListener('click', ()=>{
  if(!pickedMemberId) return;
  saveIdentity(pickedMemberId);
  enterApp();
});

function enterApp(){
  document.getElementById('onboardingStage').classList.add('is-hidden');
  document.getElementById('mainStage').classList.remove('is-hidden');
  document.getElementById('meAvatar').textContent = initial(myName());
  document.getElementById('meLabel').textContent = myName();
  if(isAdmin()) markSelfManagerHint(myMemberId);
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
  pickedMemberId = null;
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
    goToTab(tab.dataset.tab);
    renderAll();
  });
});

/* ============ TODAY VIEW ============ */
function worksOn(dateStr, dept){
  const m = getService(dateStr, dept, 'm'), s = getService(dateStr, dept, 's');
  const inShift = (sh)=> sh && sh.ids && sh.ids.includes(myMemberId);
  return inShift(m) || inShift(s);
}

function renderToday(){
  const d = new Date(selectedDate+"T00:00:00");
  document.getElementById('heroDate').textContent = `${dayFullFr[d.getDay()]} ${d.getDate()} ${monthFr[d.getMonth()]}`;

  const m = getService(selectedDate, currentDept, 'm');
  const s = getService(selectedDate, currentDept, 's');
  const worksMidi = m && m.ids && m.ids.includes(myMemberId);
  const worksSoir = s && s.ids && s.ids.includes(myMemberId);
  const closedAll = (m && m.closed) && (s === undefined || (s && s.closed));

  const hero = document.getElementById('hero');
  const pill = document.getElementById('heroPill');
  const title = document.getElementById('heroTitle');
  const sub = document.getElementById('heroSub');
  hero.classList.remove('is-work','is-rest');

  if(worksMidi || worksSoir){
    hero.classList.add('is-work');
    pill.textContent = 'Travail';
    const both = worksMidi && worksSoir;
    title.textContent = both ? 'Double aujourd\u2019hui \uD83D\uDCAA' : (worksSoir ? 'Tu travailles ce soir' : 'Tu travailles ce midi');
    const withShift = worksSoir ? s : m;
    const others = withShift.ids.filter(id=>id!==myMemberId).map(memberName);
    sub.innerHTML = (worksSoir?'<b>Ce soir</b>':'<b>Ce midi</b>') + (others.length? ' · avec ' + others.join(' et ') : '');
  } else if(closedAll){
    pill.textContent = 'Fermé'; title.textContent = 'Fermé aujourd\u2019hui'; sub.textContent = '';
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
    const shift = getService(selectedDate, currentDept, k);
    const isMine = shift && shift.ids && shift.ids.includes(myMemberId);
    const slot = document.createElement('div');
    slot.className = 'slot' + (isMine ? ' mine' : '');
    let inner = `<div class="slot-head">${k==='m'?'☀️ Midi':'🌙 Soir'}</div>`;
    if(shift===undefined){ inner += '<span class="empty">Pas encore planifié</span>'; }
    else if(shift.closed){ inner += '<span class="empty closed">Fermé</span>'; }
    else if(!shift.ids || shift.ids.length===0){ inner += '<span class="empty">Personne pour l\u2019instant</span>'; }
    else{
      inner += '<div class="crew">' + shift.ids.map(id=>
        `<div class="crew-item${id===myMemberId?' me':''}"><span class="av sm" style="${avatarStyle(id)}">${initial(memberName(id))}</span>${memberName(id)}</div>`
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
  for(let i=0;i<14;i++){
    const ds = addDays(todayStr(), i);
    ensureDaysSubscribed([ds]);
    for(const k of ['m','s']){
      const shift = getService(ds, currentDept, k);
      if(shift && shift.ids && shift.ids.includes(myMemberId)){
        const d = new Date(ds+"T00:00:00");
        const isToday = ds===todayStr();
        const when = isToday ? (k==='m'?"aujourd'hui midi":"ce soir") : `${dayFullFr[d.getDay()]} ${d.getDate()} ${k==='m'?'midi':'soir'}`;
        const others = shift.ids.filter(id=>id!==myMemberId).map(memberName);
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
  const week = [];
  for(let i=0;i<7;i++) week.push(addDays(monday, i));
  ensureDaysSubscribed(week);
  week.forEach((ds,i)=>{
    const works = worksOn(ds, currentDept);
    const d = new Date(ds+"T00:00:00");
    const chip = document.createElement('div');
    chip.className = 'day' + (ds===selectedDate ? ' is-sel' : '');
    chip.innerHTML = `<span class="day-l">${joursLabelShort[jours[i]]}</span><span class="day-n">${d.getDate()}</span><span class="day-dot${works?'':' off'}"></span>`;
    chip.addEventListener('click', ()=>{ selectedDate = ds; renderToday(); });
    el.appendChild(chip);
  });
}

document.getElementById('shareBtn').addEventListener('click', async ()=>{
  const d = new Date(selectedDate+"T00:00:00");
  const dateLabel = `${dayFullFr[d.getDay()]} ${d.getDate()} ${monthFr[d.getMonth()]}`;
  const deptLabel = currentDept==='cuisine' ? 'Cuisine' : 'Salle';
  let text = `Planning — ${dateLabel} — ${deptLabel}\n`;
  ['m','s'].forEach(k=>{
    const shift = getService(selectedDate, currentDept, k);
    text += (k==='m' ? '\u2600\ufe0f Midi : ' : '\uD83C\uDF19 Soir : ');
    if(shift===undefined) text += 'pas encore planifié\n';
    else if(shift.closed) text += 'fermé\n';
    else if(!shift.ids || shift.ids.length===0) text += 'personne\n';
    else text += shift.ids.map(memberName).join(', ') + '\n';
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
  const todayMonday = mondayOf(todayStr());
  document.getElementById('wMeta').textContent = monday===todayMonday ? 'Cette semaine' : '';

  const week = [];
  for(let i=0;i<7;i++) week.push(addDays(monday,i));
  ensureDaysSubscribed(week);

  const grid = document.getElementById('wGrid');
  grid.innerHTML = '';
  const dayCardsEl = document.getElementById('dayCards');
  dayCardsEl.innerHTML = '';
  let myDaysCount = 0;

  week.forEach((ds,i)=>{
    const d = new Date(ds+"T00:00:00");
    const isToday = ds===todayStr();
    const m = getService(ds, currentDept, 'm'), s = getService(ds, currentDept, 's');
    const closedAll = (m && m.closed) && (s===undefined || (s && s.closed));
    if(worksOn(ds, currentDept)) myDaysCount++;

    // grid row
    const row = document.createElement('div');
    row.className = 'wrow' + (isToday?' today':'') + (closedAll?' rest':'');
    const cellHtml = (shift)=>{
      if(shift===undefined) return '<span class="wdash">—</span>';
      if(shift.closed) return '<span class="wdash closed">Fermé</span>';
      if(!shift.ids || shift.ids.length===0) return '<span class="wdash">—</span>';
      return shift.ids.map(id=>`<span class="av sm${id===myMemberId?' is-me':''}" style="${avatarStyle(id)}" title="${memberName(id)}">${initial(memberName(id))}</span>`).join('');
    };
    row.innerHTML = `
      <div class="wday"><b>${joursLabelShort[jours[i]]}</b><span>${d.getDate()}</span></div>
      <div class="wcell">${cellHtml(m)}</div>
      <div class="wcell">${cellHtml(s)}</div>`;
    if(isAdmin()){
      row.querySelector('.wcell:nth-child(2)').addEventListener('click', ()=> openSheet(ds, 'm'));
      row.querySelector('.wcell:nth-child(3)').addEventListener('click', ()=> openSheet(ds, 's'));
    }
    grid.appendChild(row);

    // daily card
    const card = document.createElement('div');
    card.className = 'dcard' + (closedAll?' rest':'');
    const rowHtml = (shift, label)=>{
      let names;
      if(shift===undefined) names = '<span class="dcard-empty">Pas encore planifié</span>';
      else if(shift.closed) names = '<span class="dcard-empty closed">Fermé</span>';
      else if(!shift.ids || shift.ids.length===0) names = '<span class="dcard-empty">Personne pour l\u2019instant</span>';
      else names = shift.ids.map(id=> id===myMemberId ? `<span class="me">${memberName(id)}</span>` : memberName(id)).join(' · ');
      return `<div class="dcard-row"><span class="lbl">${label}</span><span class="dcard-names">${names}</span></div>`;
    };
    card.innerHTML = `<div class="dcard-head"><b>${joursLabelUC[jours[i]]} ${d.getDate()}</b>${closedAll?'<span>fermé</span>':''}</div>`
      + rowHtml(m, '☀️ Midi') + rowHtml(s, '🌙 Soir');
    if(isAdmin()){ card.addEventListener('click', ()=> openSheet(ds, 'm')); }
    dayCardsEl.appendChild(card);
  });

  document.getElementById('joursPourToi').innerHTML = `<b>${myDaysCount}</b> jour${myDaysCount>1?'s':''} pour toi cette semaine`;
}
document.getElementById('wPrev').addEventListener('click', ()=>{ weekWindowStart = addDays(weekWindowStart, -7); renderWeek(); });
document.getElementById('wNext').addEventListener('click', ()=>{ weekWindowStart = addDays(weekWindowStart, 7); renderWeek(); });

document.getElementById('copyBtn').addEventListener('click', async ()=>{
  if(!isAdmin()){ showToast("Seuls les managers peuvent modifier le planning"); return; }
  const nextMonday = addDays(weekWindowStart, 7);
  const nextWeek = []; for(let i=0;i<7;i++) nextWeek.push(addDays(nextMonday,i));
  ensureDaysSubscribed(nextWeek);
  await new Promise(r=>setTimeout(r, 400)); // let the fresh subscriptions populate the cache

  let copied = 0;
  for(let i=0;i<7;i++){
    const src = addDays(weekWindowStart, i);
    const dst = nextWeek[i];
    const srcDay = daysCache[src] || {};
    const dstDay = daysCache[dst] ? JSON.parse(JSON.stringify(daysCache[dst])) : {};
    let changed = false;
    ['salle','cuisine'].forEach(dept=>{
      ['m','s'].forEach(k=>{
        const srcVal = srcDay[dept] && srcDay[dept][k];
        const dstVal = dstDay[dept] && dstDay[dept][k];
        if(srcVal !== undefined && dstVal === undefined){
          dstDay[dept] = dstDay[dept] || {};
          dstDay[dept][k] = srcVal;
          changed = true; copied++;
        }
      });
    });
    if(changed){ await writeDay(dst, dstDay); }
  }
  showToast(copied>0 ? `${copied} service(s) copié(s) vers la semaine suivante \u2705` : 'La semaine suivante était déjà complète');
  renderWeek();
});

/* ============ SHIFT EDIT SHEET ============ */
function openSheet(dateStr, initialShiftKey){
  if(!isAdmin()) return;
  const day = daysCache[dateStr] || {};
  sheetContext = {
    date: dateStr,
    dept: currentDept,
    shiftKey: initialShiftKey || 'm',
    draft: {
      m: day[currentDept] ? day[currentDept].m : undefined,
      s: day[currentDept] ? day[currentDept].s : undefined,
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
  const isClosed = document.querySelector('#sheetStateToggle .sheet-state-btn[data-state="closed"]').classList.contains('is-active-closed');
  if(isClosed){
    sheetContext.draft[sheetContext.shiftKey] = {closed:true};
  } else {
    const selected = Array.from(document.querySelectorAll('#sheetPeople .pickcircle.is-selected')).map(el=>el.dataset.id);
    const note = document.getElementById('sheetNote').value.trim();
    const val = {ids: selected};
    if(note) val.note = note;
    sheetContext.draft[sheetContext.shiftKey] = val;
  }
}

function renderSheetShift(){
  const { date, dept, shiftKey, draft } = sheetContext;
  const d = new Date(date+"T00:00:00");
  const deptLabel = dept==='cuisine' ? 'Cuisine' : 'Salle';
  document.getElementById('sheetTitle').textContent =
    `${dayFullFr[d.getDay()].charAt(0).toUpperCase()+dayFullFr[d.getDay()].slice(1)} ${d.getDate()} · ${shiftKey==='m'?'Midi':'Soir'} · ${deptLabel}`;

  const shift = draft[shiftKey];
  const isClosed = !!(shift && shift.closed);
  document.querySelectorAll('#sheetStateToggle .sheet-state-btn').forEach(b=>{
    const active = (b.dataset.state==='closed') === isClosed;
    b.classList.toggle('is-active-open', b.dataset.state==='open' && active);
    b.classList.toggle('is-active-closed', b.dataset.state==='closed' && active);
  });

  const peopleEl = document.getElementById('sheetPeople');
  const activeList = activeMembers();
  document.getElementById('sheetSub').style.display = isClosed ? 'none' : 'block';
  peopleEl.style.display = isClosed ? 'none' : 'flex';
  document.getElementById('sheetNote').style.display = isClosed ? 'none' : 'block';

  peopleEl.innerHTML = '';
  const selectedIds = (shift && shift.ids) ? shift.ids.slice() : [];
  activeList.forEach(p=>{
    const isSel = selectedIds.includes(p.id);
    const el = document.createElement('button');
    el.type = 'button';
    el.dataset.id = p.id;
    el.className = 'pickcircle' + (isSel ? ' is-selected' : '');
    el.innerHTML = `<span class="av lg" style="${p.id===myMemberId?'background:var(--me)':`background:${colorVarFor(p.id)}`}">${initial(p.name)}</span><span>${p.name}</span>`;
    el.addEventListener('click', ()=>{
      if(el.classList.contains('is-selected')){
        if(confirm(`Retirer ${p.name} de ce service ?`)){ el.classList.remove('is-selected'); }
      } else {
        el.classList.add('is-selected');
      }
    });
    peopleEl.appendChild(el);
  });

  document.getElementById('sheetNote').value = (shift && shift.note) ? shift.note : '';
}

document.querySelectorAll('#sheetShiftToggle .sheet-shift-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    if(!sheetContext || btn.dataset.shift===sheetContext.shiftKey) return;
    readSheetIntoDraft();
    sheetContext.shiftKey = btn.dataset.shift;
    document.querySelectorAll('#sheetShiftToggle .sheet-shift-btn').forEach(b=>b.classList.toggle('is-active', b===btn));
    renderSheetShift();
  });
});
document.querySelectorAll('#sheetStateToggle .sheet-state-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    if(!sheetContext) return;
    const closed = btn.dataset.state==='closed';
    sheetContext.draft[sheetContext.shiftKey] = closed ? {closed:true} : {ids:[]};
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
  const { date, dept, draft } = sheetContext;
  const day = daysCache[date] ? JSON.parse(JSON.stringify(daysCache[date])) : {};
  day[dept] = { m: draft.m, s: draft.s };

  await writeDay(date, day);
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
  activeMembers().forEach(p=> counts[p.id] = {midi:0, soir:0});
  for(let i=0;i<7;i++){
    const ds = addDays(monday, i);
    const m = getService(ds, currentDept, 'm'), s = getService(ds, currentDept, 's');
    if(m && m.ids) m.ids.forEach(id=>{ counts[id] = counts[id] || {midi:0,soir:0}; counts[id].midi++; });
    if(s && s.ids) s.ids.forEach(id=>{ counts[id] = counts[id] || {midi:0,soir:0}; counts[id].soir++; });
  }
  const maxTotal = Math.max(1, ...Object.values(counts).map(c=>c.midi+c.soir));
  activeMembers().forEach(p=>{
    const c = counts[p.id] || {midi:0, soir:0};
    const total = c.midi + c.soir;
    const card = document.createElement('div');
    card.className = 'eq' + (p.id===myMemberId ? ' is-me' : '');
    const midiPct = total ? (c.midi/maxTotal*100) : 0;
    const soirPct = total ? (c.soir/maxTotal*100) : 0;
    card.innerHTML = `
      <div class="eq-top">
        <span class="av sm" style="${avatarStyle(p.id)}">${initial(p.name)}</span>
        <span class="eq-name">${p.name}</span>
        <span class="eq-total">${total} service${total>1?'s':''}</span>
      </div>
      <div class="bar"><i class="midi" style="width:${midiPct}%"></i><i class="soir" style="width:${soirPct}%"></i></div>
      <div class="eq-legend"><span><b>${c.midi}</b> midis</span><span><b>${c.soir}</b> soirs</span></div>`;
    el.appendChild(card);
  });
}

let editingMemberId = null;
function renderPeople(){
  const el = document.getElementById('people');
  el.innerHTML = '';
  activeMembers().forEach(p=>{
    const row = document.createElement('div');
    row.className = 'person';
    row.innerHTML = `
      <span class="av" style="${p.id===myMemberId?'background:var(--me)':avatarStyle(p.id)}">${initial(p.name)}</span>
      <div class="person-txt"><b>${p.name} ${(p.isManagerHint && p.id!==myMemberId)?'<span class="manager-badge">Manager</span>':''}</b></div>
      ${p.id===myMemberId ? '<span class="tagme">Toi</span>' : ''}`;
    if(isAdmin()){
      row.addEventListener('click', ()=>{ editingMemberId = (editingMemberId===p.id ? null : p.id); renderMemberEdit(); });
    }
    el.appendChild(row);
  });
  renderMemberEdit();
}

function renderMemberEdit(){
  const zone = document.getElementById('memberEditZone');
  if(!editingMemberId || !isAdmin() || !members[editingMemberId]){ zone.innerHTML=''; return; }
  const p = members[editingMemberId];
  zone.innerHTML = `
    <div class="member-editrow">
      <label class="edit-label">Prénom</label>
      <input type="text" id="meName" class="ob-input" value="${p.name}">
      <button class="btn btn-solid" id="meSaveBtn" style="margin-top:8px;">Enregistrer</button>
      <button class="btn btn-ghost btn-danger" id="meDeactivateBtn" style="width:100%;margin-top:8px;">Désactiver ce membre</button>
    </div>`;
  zone.querySelector('#meSaveBtn').addEventListener('click', async ()=>{
    const v = zone.querySelector('#meName').value.trim();
    if(!v) return;
    await renameMember(editingMemberId, v);
    showToast('Prénom mis à jour \u2705');
    editingMemberId = null;
    renderTeam();
  });
  zone.querySelector('#meDeactivateBtn').addEventListener('click', async ()=>{
    if(!confirm(`Désactiver ${p.name} ? Il/elle n'apparaîtra plus dans les nouveaux services, mais l'historique reste intact.`)) return;
    await deactivateMember(editingMemberId);
    showToast(`${p.name} désactivé(e)`);
    editingMemberId = null;
    renderTeam();
  });
}

function renderAddMember(){
  const zone = document.getElementById('addMemberZone');
  if(!isAdmin()){ zone.innerHTML = ''; return; }
  zone.innerHTML = `
    <h2 class="sec-title">Ajouter un membre</h2>
    <input type="text" id="teamNewName" class="ob-input" placeholder="Prénom">
    <button class="btn btn-solid" id="teamAddBtn" style="width:100%;">Ajouter</button>`;
  zone.querySelector('#teamAddBtn').addEventListener('click', async ()=>{
    const input = zone.querySelector('#teamNewName');
    const v = input.value.trim();
    if(!v) return;
    await addMember(v);
    input.value = '';
    showToast(`${v} ajouté(e) à l'équipe`);
    renderTeam();
  });
}

document.getElementById('btnCopyLink').addEventListener('click', async ()=>{
  try{ await navigator.clipboard.writeText(window.location.href); showToast('Lien copié \u2705'); }
  catch(e){ showToast(window.location.href); }
});

/* ============ PROFILE VIEW ============ */
function renderProfile(){
  document.getElementById('pfAvatar').textContent = initial(myName());
  document.getElementById('pfName').textContent = myName();

  const adminZone = document.getElementById('pfAdminZone');
  if(isAdmin() && myUid){
    adminZone.innerHTML = `
      <h2 class="sec-title">Identifiant appareil</h2>
      <p class="hint tight">Déjà enregistré comme manager sur cet appareil.</p>
      <div class="device-id-box">${myUid}</div>`;
  } else if(myUid){
    adminZone.innerHTML = `
      <h2 class="sec-title">Activation manager</h2>
      <p class="hint tight">Si tu dois devenir manager, envoie cet identifiant à un manager actuel :</p>
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

/* ============ RENDER ALL ============ */
function renderAll(){
  const activeTab = document.querySelector('.tab.is-active');
  const name = activeTab ? activeTab.dataset.tab : 'today';
  if(name==='today') renderToday();
  if(name==='week') renderWeek();
  if(name==='team') renderTeam();
  if(!document.querySelector('[data-view="profile"]').classList.contains('is-hidden')) renderProfile();
}

/* ============ PWA ============ */
(function setupPWA(){
  try{ if("serviceWorker" in navigator){ navigator.serviceWorker.register("sw.js").catch(()=>{}); } }catch(e){}
})();

/* ============ INIT ============ */
(async function init(){
  initTheme();
  initDept();
  await initAuth();
  subscribeAdmins();
  subscribeMembers();
  await new Promise(r=>setTimeout(r, 600)); // let first members/admins snapshot arrive
  try{ myMemberId = localStorage.getItem(IDENTITY_KEY) || null; }catch(e){ myMemberId = null; }
  renderOnboarding();
  if(myMemberId && members[myMemberId]){ enterApp(); }
})();
