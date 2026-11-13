const DATABASE = 'domira-care-projects';
const TABLE = 'projects';
const VERSION_LIMIT = 30;

function openDatabase() {
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open(DATABASE,1);
  request.onupgradeneeded=()=>request.result.createObjectStore(TABLE,{keyPath:'id'});
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error);
  request.onblocked=()=>reject(Error('請關閉其他正在更新的樂齡設計分頁。'));
 });
}

export function createCareProjects({getState,loadState,modal,closeModal,notify}) {
 const $=id=>document.getElementById(id);
 let database;
 let pending;
 let timer;
 let writing=Promise.resolve();
 const stateCopy=()=>structuredClone(getState());
 const selectedProject=state=>state.wholeHome||state;
 const nameOf=state=>selectedProject(state).name;
 const idOf=state=>{
  const id=selectedProject(state).projectId;
  return typeof id==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)?id:undefined;
 };
 const ensureId=state=>idOf(state)||(selectedProject(state).projectId=crypto.randomUUID());
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const date=value=>new Date(value).toLocaleString('zh-HK');
 async function transaction(mode, run) {
  database ||= await openDatabase();
  return new Promise((resolve,reject)=>{
   const tx=database.transaction(TABLE,mode);
   let result;
   tx.oncomplete=()=>resolve(result);
   tx.onerror=tx.onabort=()=>reject(tx.error||Error('專案未能儲存。'));
   run(tx.objectStore(TABLE),value=>{result=value;});
  });
 }
 const readAll=()=>transaction('readonly',(store,done)=>{const request=store.getAll();request.onsuccess=()=>done(request.result);});
 const read=id=>transaction('readonly',(store,done)=>{const request=store.get(id);request.onsuccess=()=>done(request.result);});
 const modify=(id,change)=>transaction('readwrite',(store,done)=>{
  const request=store.get(id);
  request.onsuccess=()=>{if(request.result){const record=change(request.result);store.put(record);done(record);}};
 });
 function save(snapshot,label) {
  const id=idOf(snapshot)||ensureId(snapshot);
  const timestamp=new Date().toISOString();
  return transaction('readwrite',(store,done)=>{
   const request=store.get(id);
   request.onsuccess=()=>{
    const previous=request.result;
    const versions=previous?.versions||[];
    if(label)versions.unshift({id:crypto.randomUUID(),label,date:timestamp,state:snapshot});
    const record={id,name:nameOf(snapshot),state:snapshot,date:timestamp,archived:previous?.archived||false,versions:versions.slice(0,VERSION_LIMIT)};
    store.put(record);done(record);
   };
  });
 }
 function flush() {
  clearTimeout(timer);
  const snapshot=pending;
  pending=null;
  if(snapshot)writing=writing.catch(()=>{}).then(()=>save(snapshot));
  return writing;
 }
 function autosave() {
  ensureId(getState());
  const next=stateCopy();
  if(pending&&idOf(pending)!==idOf(next))flush().catch(()=>{});
  pending=next;
  clearTimeout(timer);
  timer=setTimeout(()=>flush().catch(()=>{$('save-state').textContent='專案庫暫未儲存。可先匯出備份。';}),300);
 }
 async function saveVersion(label) {
  const snapshot=stateCopy();
  await flush();
  return save(snapshot,label.trim().slice(0,60)||'手動儲存');
 }
 async function open() {
  try {
   ensureId(getState());await flush();
   const records=(await readAll()).sort((a,b)=>b.date.localeCompare(a.date));
   modal('我的專案',`<p>草稿與版本儲存在這部裝置。</p><form id="care-version-save"><label>儲存目前版本<input id="care-version-name" maxlength="60" placeholder="例如：換床後"></label><button class="primary">儲存版本</button></form><div class="care-project-list">${records.map(record=>`<article><h3>${esc(record.name)}${record.archived?' · 已封存':''}</h3><p>${esc(date(record.date))} · ${record.versions.length} 個版本</p><div class="chat-actions"><button class="primary" data-project-open="${esc(record.id)}">打開</button><button data-project-rename="${esc(record.id)}">改名</button><button data-project-copy="${esc(record.id)}">複製</button><button data-project-archive="${esc(record.id)}">${record.archived?'取消封存':'封存'}</button><button data-project-versions="${esc(record.id)}">看舊版本</button></div></article>`).join('')||'<p>目前還沒有已保存的專案。</p>'}</div>`);
   $('care-version-save').onsubmit=async event=>{
    event.preventDefault();
    try {await saveVersion($('care-version-name').value);notify('版本已儲存。');await open();}catch(error){notify(error.message);}
   };
   for(const button of document.querySelectorAll('.care-project-list button'))button.onclick=async()=>{
    const [action,id]=Object.entries(button.dataset)[0];
    try {
     await flush();
     const record=await read(id);
     if(!record)throw Error('找不到這個專案。');
     if(action==='projectOpen'){loadState(structuredClone(record.state));closeModal();return;}
     if(action==='projectRename'){
      modal('專案叫甚麼名字？',`<form id="care-rename-form"><label>專案名稱<input id="care-rename-name" required maxlength="40" value="${esc(record.name)}"></label><button class="primary">儲存名稱</button></form>`);
      $('care-rename-form').onsubmit=async event=>{
       event.preventDefault();
       try {
        const name=$('care-rename-name').value.trim();if(!name)return;
        await flush();
        await modify(id,latest=>{selectedProject(latest.state).name=name;return {...latest,name};});
        if(idOf(getState())===id){const current=stateCopy();selectedProject(current).name=name;loadState(current);}
        await open();
       }catch(error){notify(error.message);}
      };return;
     }
     if(action==='projectCopy'){
      const copy=structuredClone(record.state),owner=selectedProject(copy);
      owner.projectId=crypto.randomUUID();owner.name=`${record.name.slice(0,34)}（副本）`;
      copy.id=crypto.randomUUID();
      if(copy.wholeHome)for(const project of Object.values(copy.wholeHome.projects))if(project)project.id=crypto.randomUUID();
      await save(copy,'複製時的版本');
     }
     if(action==='projectArchive')await modify(id,latest=>({...latest,archived:!latest.archived}));
     if(action==='projectVersions'){
      modal('過往版本',`<div class="export-options">${record.versions.map(version=>`<button data-restore-version="${version.id}">${esc(version.label)}<small>${esc(date(version.date))}</small></button>`).join('')||'<p>可先在「我的專案」儲存一個版本。</p>'}</div><button id="care-projects-back" class="secondary">返回我的專案</button>`);
      $('care-projects-back').onclick=open;
      for(const choice of document.querySelectorAll('[data-restore-version]'))choice.onclick=async()=>{
       try {
        const version=record.versions.find(entry=>entry.id===choice.dataset.restoreVersion);
        const current=idOf(getState())===id?stateCopy():record.state;
        await save(current,'回復前的版本');
        const restored=structuredClone(version.state);
        selectedProject(restored).name=record.name;
        loadState(restored);closeModal();notify('已打開舊版本，回復前的設計也已保留。');
       }catch(error){notify(error.message);}
      };return;
     }
     await open();
    }catch(error){notify(error.message);}
   };
  } catch(error) {notify(error.message||'暫時未能打開專案庫。');}
 }
 $('care-projects-open').onclick=open;
 window.addEventListener('pagehide',()=>flush().catch(()=>{}));
 return {autosave,open,saveVersion};
}
