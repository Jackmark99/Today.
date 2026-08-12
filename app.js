import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/* ============================================================
   FIREBASE CONFIG — same project used by the previous version,
   so all schedule/roster data already entered carries over.
   ============================================================ */
const firebaseConfig = {
  apiKey: "AIzaSyB4TbEW1hsuJSDznTtAdTnjpkc5j16BR7U",
  authDomain: "planning-equipe-44750.firebaseapp.com",
  projectId: "planning-equipe-44750",
  storageBucket: "planning-equipe-44750.firebasestorage.app",
  messagingSenderId: "458088730695",
  appId: "1:458088730695:web:b4206e8b51902b055b2162"
};

let db = null, firebaseOk = false;
try{
  const fbApp = initializeApp(firebaseConfig);
  db = getFirestore(fbApp);
  firebaseOk = true;
}catch(e){ console.warn("Firebase init failed", e); }

/* ============ CONSTANTS ============ */
const jours = ["lu","ma","me","je","ve","sa","di"];
const joursLabelShort = {lu:"Lu",ma:"Ma",me:"Me",je:"Je",ve:"Ve",sa:"Sa",di:"Di"};
const joursLabelFull = {lu:"lundi",ma:"mardi",me:"mercredi",je:"jeudi",ve:"vendredi",sa:"samedi",di:"dimanche"};
const monthFr = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
const dayFullFr = ["dimanche","lundi","mardi","mercredi","jeudi","vendredi","samedi"];
const IDENTITY_KEY = "planning-identity";
const THEME_KEY = "planning-theme";

function fmtDate(d){ const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; }
function addDays(dateStr, n){ const d = new Date(dateStr+"T00:00:00"); d.setDate(d.getDate()+n); return fmtDate(d); }
function mondayOf(dateStr){ const d = new Date(dateStr+"T00:00:00"); const dow = d.getDay(); const diff = dow===0?-6:1-dow; d.setDate(d.getDate()+diff); return fmtDate(d); }

/* ============ DEFAULT SEED (matches the demo week shown in the mockup) ============ */
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
  {name:"MOMO", role:"salle"},
  {name:"QUENTIN", role:"cuisine"},
  {name:"LEA", role:"salle"},
  {name:"SAMI", role:"cuisine"},
];

/* ============ STATE ============ */
let scheduleData = buildDefaultSeed();
let roster = DEFAULT_ROSTER.slice();
let myName = null;
let selectedDate = fmtDate(new Date());
let weekWindowStart = mondayOf(selectedDate);
let teamFilterRole = "all";

function withTimeout(p, ms){ return Promise.race([p, new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')), ms))]); }

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
  }catch(e){ console.warn("live sync failed", e); }
}
function saveSchedule(){ if(!firebaseOk) return Promise.resolve(); return setDoc(doc(db,"planning","schedule"), {json: JSON.stringify(scheduleData)}).catch(e=>console.warn(e)); }
function saveRoster(){ if(!firebaseOk) return Promise.resolve(); return setDoc(doc(db,"planning","roster"), {list: roster}).catch(e=>console.warn(e)); }
function saveIdentity(name){ myName = name; try{ localStorage.setItem(IDENTITY_KEY, name); }catch(e){} }

function hamidIn(shift){ return shift && shift.x && myName && shift.x.includes(myName); }
function personOf(name){ return roster.find(p=>p.name===name) || {name, role:"salle"}; }
function colorVarFor(name){
  const idx = roster.findIndex(p=>p.name===name);
  const n = idx>=0 ? idx : 0;
  return `var(--p-${(n%6)+1})`;
}
function avatarStyle(name){
  if(name===myName) return `background:var(--me)`;
  return `background:${colorVarFor(name)}`;
}
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
  document.getElementById('meAvatar').style.background = 'var(--me)';
  document.getElementById('meLabel').textContent = myName;
  renderAll();
}
document.getElementById('meChip').addEventListener('click', ()=>{
  document.getElementById('mainStage').classList.add('is-hidden');
  document.getElementById('onboardingStage').classList.remove('is-hidden');
  pickedName = null;
  document.getElementById('obContinue').disabled = true;
  renderOnboarding();
});

/* ============ TABS ============ */
document.querySelectorAll('.tab').forEach(tab=>{
  tab.addEventListener('click', ()=>{
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('is-active'));
    tab.classList.add('is-active');
    const name = tab.dataset.tab;
    document.querySelectorAll('.view').forEach(v=> v.classList.toggle('is-hidden', v.dataset.view!==name));
    document.getElementById('scroll').scrollTop = 0;
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

  const noteWrap = document.getElementById('noteWrap');
  const note = (day && day.m && day.m.n) ? day.m.n : (day && day.s && day.s.n ? day.s.n : '');
  if(note){ noteWrap.style.display = 'flex'; document.getElementById('noteTxt').textContent = note; }
  else{ noteWrap.style.display = 'none'; }

  renderDayStrip();
}

function renderDayStrip(){
  const el = document.getElementById('dayStrip');
  el.innerHTML = '';
  const monday = mondayOf(selectedDate);
  const todayStr = fmtDate(new Date());
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

/* ============ SHARE ============ */
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
  }catch(e){ /* user cancelled share, ignore */ }
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
  for(let i=0;i<7;i++){
    const ds = addDays(monday, i);
    const day = scheduleData[ds];
    const d = new Date(ds+"T00:00:00");
    const isToday = ds===todayStr;
    const closedAll = day && day.m && day.m.c && (!day.s || day.s.c);
    const row = document.createElement('div');
    row.className = 'wrow' + (isToday?' today':'') + (closedAll?' rest':'');
    const cellHtml = (shift)=>{
      if(!shift) return '<span class="wdash">—</span>';
      if(shift.c) return '<span class="wdash">Fermé</span>';
      return shift.x.map(n=>`<span class="av${n===myName?' is-me':''}" style="${avatarStyle(n)}" title="${n}">${initial(n)}</span>`).join('');
    };
    row.innerHTML = `
      <div class="wday"><b>${joursLabelShort[jours[i]]}</b><span>${d.getDate()}</span></div>
      <div class="wcell">${cellHtml(day && day.m)}</div>
      <div class="wcell">${cellHtml(day && day.s)}</div>`;
    row.addEventListener('click', ()=>{
      document.getElementById('editDate').value = ds;
      document.getElementById('editDate').dispatchEvent(new Event('change'));
      document.getElementById('editCard').scrollIntoView({behavior:'smooth', block:'center'});
    });
    grid.appendChild(row);
  }
}
document.getElementById('wPrev').addEventListener('click', ()=>{ weekWindowStart = addDays(weekWindowStart, -7); renderWeek(); renderTeamIfActive(); });
document.getElementById('wNext').addEventListener('click', ()=>{ weekWindowStart = addDays(weekWindowStart, 7); renderWeek(); renderTeamIfActive(); });

document.getElementById('copyBtn').addEventListener('click', async ()=>{
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

/* ---- manual edit ---- */
document.getElementById('editDate').addEventListener('change', e=>{
  const ds = e.target.value;
  const day = scheduleData[ds];
  document.getElementById('editMidi').value = day && day.m ? (day.m.c ? 'fermé' : day.m.x.join(', ')) : '';
  document.getElementById('editSoir').value = day && day.s ? (day.s.c ? 'fermé' : day.s.x.join(', ')) : '';
  document.getElementById('editNote').value = (day && day.m && day.m.n) ? day.m.n : '';
});
function parseManualShift(text){
  const t = (text||'').trim();
  if(!t) return null;
  if(t.toLowerCase()==='fermé' || t.toLowerCase()==='ferme') return {c:true};
  return {x: t.split(',').map(s=>s.trim().toUpperCase()).filter(Boolean)};
}
document.getElementById('btnSaveManual').addEventListener('click', async ()=>{
  const ds = document.getElementById('editDate').value;
  if(!ds){ showToast('Choisis une date'); return; }
  const m = parseManualShift(document.getElementById('editMidi').value);
  const s = parseManualShift(document.getElementById('editSoir').value);
  const note = document.getElementById('editNote').value.trim();
  if(m && note) m.n = note;
  scheduleData[ds] = {m, s};
  await saveSchedule();
  showToast('Jour enregistré \u2705');
  renderWeek();
  if(ds===selectedDate) renderToday();
});

/* ============ TEAM VIEW ============ */
function renderTeamIfActive(){
  if(!document.querySelector('[data-view="team"]').classList.contains('is-hidden')) renderTeam();
}
function renderTeam(){
  renderEquity();
  renderPeople();
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
    const row = document.createElement('div');
    row.className = 'person';
    row.innerHTML = `
      <span class="av" style="${p.name===myName?'background:var(--me)':avatarStyle(p.name)}">${initial(p.name)}</span>
      <div class="person-txt"><b>${p.name}</b><span class="role-badge">${p.role==='cuisine'?'Cuisine':'Salle'}</span></div>
      ${p.name===myName ? '<span class="tagme">Toi</span>' : '<button class="icon-btn rm-person" aria-label="Retirer">✕</button>'}`;
    if(p.name!==myName){
      row.querySelector('.rm-person').addEventListener('click', async ()=>{
        if(roster.length<=1) return;
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

let teamNewRole = 'salle';
document.querySelectorAll('#teamRoleToggle .ob-role-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('#teamRoleToggle .ob-role-btn').forEach(b=>b.classList.remove('is-active'));
    btn.classList.add('is-active');
    teamNewRole = btn.dataset.role;
  });
});
document.getElementById('teamAddBtn').addEventListener('click', async ()=>{
  const input = document.getElementById('teamNewName');
  const v = input.value.trim().toUpperCase();
  if(!v || roster.find(p=>p.name===v)) return;
  roster.push({name:v, role:teamNewRole});
  await saveRoster();
  input.value = '';
  renderTeam();
  showToast(`${v} ajouté(e) à l'équipe`);
});

document.getElementById('btnCopyLink').addEventListener('click', async ()=>{
  try{
    await navigator.clipboard.writeText(window.location.href);
    showToast('Lien copié \u2705');
  }catch(e){ showToast(window.location.href); }
});

/* ============ RENDER ALL ============ */
function renderAll(){
  renderToday();
  if(!document.querySelector('[data-view="week"]').classList.contains('is-hidden')) renderWeek();
  if(!document.querySelector('[data-view="team"]').classList.contains('is-hidden')) renderTeam();
}

/* ============ PWA ============ */
(function setupPWA(){
  try{
    if("serviceWorker" in navigator){
      navigator.serviceWorker.register("sw.js").catch(()=>{});
    }
  }catch(e){}
})();

/* ============ INIT ============ */
(async function init(){
  initTheme();
  renderOnboarding();
  await loadAll();
  renderOnboarding();
  if(myName){ enterApp(); }
})();
