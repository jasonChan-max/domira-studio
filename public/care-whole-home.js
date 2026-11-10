import {openCareHomeBuilder} from './care-home-builder.js';
import {createCareChat} from './care-chat-ui.js';
import {hkCareHome,HK_SOURCE,roomCareProject,validateCareWhole,wholeReview,careRoomAssignments,canPlanCareRoom} from './care-home-domain.js';
import {homePlanSVG,homeItems} from './home-domain.js';
import {createHomeStudio} from './home-studio.js';
import {createRenderStudio} from './render-studio.js';
import {careGeometry} from './care-domain.js';
import {ALL_CARE_PRODUCTS} from './care-catalog.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createCareWholeHome({scene,getState,replaceState,refresh,modal,closeModal,setCleanup,notify,api,checkpoint,stopAR}){
 let busy=false,planning=false,epoch=0;const $=s=>document.querySelector(s);
 const clean=p=>{const {wholeHome,...rest}=p;return structuredClone(rest);};
 function saveRoom(){const p=getState(),w=p.wholeHome;if(!w)return;w.projects[w.activeRoomId]=clean(p);const r=w.home.rooms.find(r=>r.id===w.activeRoomId);r.items=p.items;}
 function install(home,name){epoch++;const p=getState(),projects={};for(const r of home.rooms)projects[r.id]=canPlanCareRoom(r)?{...roomCareProject(home,r),profile:p.profile,style:p.style}:null;const active=home.rooms.find(r=>r.kind==='living'&&projects[r.id])||home.rooms.find(r=>projects[r.id]);if(!active)throw Error('此戶型沒有長寬均為 2–15 m 的可規劃房間。');const w={format:'domira.care.home.v1',home,projects,activeRoomId:active.id,view:'whole',name};replaceState({...projects[active.id],wholeHome:w});refresh({room:true});}
 function openRoom(id){if(busy)return;saveRoom();const w=getState().wholeHome;if(!w?.projects[id])return notify('此房間超出可規劃尺寸，已保留建築模型。');epoch++;w.activeRoomId=id;w.view='room';replaceState({...structuredClone(w.projects[id]),wholeHome:w});refresh({room:true});}
 function sync(){if(busy)return;busy=true;try{let p=getState();if(!p.wholeHome){if(p.room.source==='demo'&&!p.brief){install(hkCareHome(),'香港長者家居展示');p=getState();}else{const home={format:'domira.home.v1',width:p.room.width,depth:p.room.depth,height:p.room.height,source:p.room.source,rooms:[{id:'existing',name:p.name,kind:'living',purpose:p.purpose,width:p.room.width,depth:p.room.depth,height:p.room.height,x:0,z:0,items:p.items,openings:[]}]};p.wholeHome={format:'domira.care.home.v1',home,projects:{existing:clean(p)},activeRoomId:'existing',view:'room',name:p.name};}}saveRoom();const w=p.wholeHome,rooms=w.home.rooms;$('#whole-room').innerHTML=rooms.map(r=>`<option value="${esc(r.id)}" ${w.projects[r.id]?'':'disabled'}>${esc(r.name)} · ${(r.width*r.depth).toFixed(2)}㎡</option>`).join('');$('#whole-room').value=w.activeRoomId;$('#whole-status').textContent=`${w.name||'全屋設計'} · ${rooms.length}個空間 · ${rooms.reduce((s,r)=>s+r.width*r.depth,0).toFixed(2)}㎡`;
 $('#whole-plan-preview').innerHTML=homePlanSVG(w.home);$('#whole-review').innerHTML=wholeReview(w).map(r=>`<button data-care-room="${esc(r.id)}"><strong>${esc(r.name)}</strong><span>${r.area.toFixed(2)}㎡ · ${w.projects[r.id]?.engine?(r.review?.ok?'幾何檢查通過':'需調整'):w.projects[r.id]?'待規劃':'僅建築模型'} · ${w.projects[r.id]?.items.length||0}件${w.projects[r.id]?.unplaced?.length?' · '+w.projects[r.id].unplaced.length+'件待擺放':''}</span></button>`).join('');document.querySelectorAll('[data-care-room]').forEach(b=>b.onclick=()=>openRoom(b.dataset.careRoom));
 if(w.view==='whole'&&scene){scene.showHome(w.home,openRoom);scene.update(homeItems({home:w.home},true));scene.setView('3d');scene.clearCirculation();}$('#whole-overview').setAttribute('aria-pressed',String(w.view==='whole'));}finally{busy=false;}}
 const importer=createHomeStudio({modal,setCleanup,notify,createHome:(name,home)=>{checkpoint();install(home,name);closeModal();notify('全屋已建立，請逐間核對尺寸及適老需要。');}});
 $('#whole-manual').onclick=()=>openCareHomeBuilder(modal,(name,home)=>{checkpoint();stopAR();install(home,name);closeModal();notify('已建立全屋。選擇產品後即可逐房規劃。');});
 $('#care-floorplan').onclick=()=>{epoch++;importer.open();};$('#whole-room').onchange=e=>openRoom(e.target.value);$('#whole-overview').onclick=()=>{saveRoom();getState().wholeHome.view='whole';refresh();};$('#hk-example').onclick=()=>{checkpoint();install(hkCareHome(),'香港長者家居展示');};
 async function generateAll(overrides){
  if(planning)return;
  saveRoom();
  const base=getState(),revision=base.updatedAt,snapshot=structuredClone(base.wholeHome),brief=snapshot.brief||base.brief;
  if(!brief){$('#needs-open').click();return;}
  const allocations=careRoomAssignments(snapshot.home,brief,overrides||snapshot.allocations);
  const token=++epoch,button=$('#whole-generate');
  planning=true;button.disabled=true;
  let planned=0,unplaced=0;
  try{
   const next=structuredClone(snapshot);next.brief=brief;next.allocations=allocations;
   for(const room of next.home.rooms){
    if(!canPlanCareRoom(room))continue;
    const selections=brief.selections.filter(selection=>allocations[selection.productId]===room.id);
    const previous=next.projects[room.id]||roomCareProject(next.home,room);
    const {brief:oldBrief,unplaced:oldUnplaced,engine:oldEngine,...savedRoom}=previous;
    const project={...savedRoom,items:[],fieldChecks:{},profile:base.profile,style:base.style};
    if(selections.length){
     button.textContent=`正在規劃 · ${room.name}`;
     project.brief={...brief,selections};
     const data=await api('care/layout',{project,purpose:project.purpose,style:project.style});
     if(token!==epoch||getState()!==base||base.updatedAt!==revision)return notify('房間或需求已變更，已保留目前設計。');
     project.items=data.items;project.engine=data.engine;project.unplaced=data.unplaced||[];
     if(!careGeometry(project).ok)throw Error(room.name+'的方案未通過幾何檢查，已保留原設計。');
     unplaced+=project.unplaced.length;planned++;
    }
    next.projects[room.id]=project;room.items=project.items;
   }
   validateCareWhole(next);
   checkpoint();replaceState({...next.projects[next.activeRoomId],wholeHome:{...next,view:'whole'}});
   refresh({room:true});notify(`全屋規劃完成 · ${planned} 間房 · ${unplaced} 件待擺放。`);
  }catch(error){notify(error.message);}
  finally{planning=false;button.disabled=false;button.textContent='分配產品並規劃全屋';}
 }
 $('#whole-generate').onclick=()=>{
  const state=getState(),whole=state.wholeHome,brief=whole.brief||state.brief;
  if(!brief)return $('#needs-open').click();
  const defaults=careRoomAssignments(whole.home,brief,whole.allocations);
  const rooms=whole.home.rooms.filter(canPlanCareRoom);
  modal('分配產品到各房間',`<form id="whole-allocation-form"><p>選擇每款產品的房間，再產生全屋擺位。完成後可逐房調整，也可按「復原」取回原有擺位。</p><div class="whole-allocation-list">${brief.selections.map(selection=>{
   const product=ALL_CARE_PRODUCTS.find(item=>item.productId===selection.productId);
   return `<label><span>${esc(product?.name||selection.productId)} × ${selection.quantity}</span><select name="${esc(selection.productId)}">${rooms.map(room=>`<option value="${esc(room.id)}" ${defaults[selection.productId]===room.id?'selected':''}>${esc(room.name)}</option>`).join('')}</select></label>`;
  }).join('')}</div><button class="primary">產生全屋擺位</button></form>`);
  $('#whole-allocation-form').onsubmit=event=>{event.preventDefault();const choices=Object.fromEntries(new FormData(event.currentTarget));closeModal();stopAR();generateAll(choices);};
 };
 function exportWhole(){saveRoom();const w=getState().wholeHome;validateCareWhole(w);const report=wholeReview(w);modal('帶走全屋規劃',`<p>包含逐房尺寸、產品、需要清單與檢查狀態。全屋門位、連通性及施工條件仍須核對。</p><button class="primary" id="whole-json">下載全屋JSON</button> <button class="secondary" id="whole-svg">下載全屋平面圖</button>`);const download=(content,type,name)=>{const a=document.createElement('a'),url=URL.createObjectURL(new Blob([content],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);};$('#whole-json').onclick=()=>download(JSON.stringify({...getState(),wholeHome:w,wholeReview:report},null,2),'application/json','Domira-Care-Whole-Home.json');$('#whole-svg').onclick=()=>download(homePlanSVG(w.home),'image/svg+xml','Domira-Care-Whole-Home.svg');}
 $('#whole-export').onclick=exportWhole;
 const renderer=createRenderStudio({scene,getState:()=>{const p=getState();return {schemaVersion:1,id:p.id,name:p.name,room:p.room,items:p.items,style:p.style,purpose:p.purpose,preferences:['flow'],mobility:p.profile==='wheelchair'?'wheelchair':'senior'};},modal,closeModal,notify,icons:()=>{}});$('#care-render').onclick=()=>{const w=getState().wholeHome;if(w?.view==='whole')openRoom(w.activeRoomId);if(!scene)return notify('此裝置未啟用3D');renderer.open();};
 const oldTransform=scene?.onTransform,oldSelect=scene?.onSelect;if(scene){scene.onTransform=(...args)=>{if(getState().wholeHome?.view==='whole')return notify('請先進入房間，再調整家具。');epoch++;oldTransform(...args);};scene.onSelect=id=>{const w=getState().wholeHome;if(w?.view==='whole'){const r=w.home.rooms.find(r=>r.items.some(i=>i.id===id));if(r)openRoom(r.id);return;}oldSelect(id);};}
 createCareChat({getState,notify,apply:items=>{
  stopAR();epoch++;checkpoint();const p=getState();
  p.items=items;p.fieldChecks={};if(p.wholeHome)p.wholeHome.view='room';
  refresh({room:true});
 }});
 $('#hk-source').href=HK_SOURCE;return {sync,openRoom,generateAll,stop:()=>{epoch++;importer.stop();}};
}
