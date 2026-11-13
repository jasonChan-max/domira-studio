import {createCareProjects} from './care-projects.js';
let careProjects;
import {CARE_FLOORING,flooringAdvice} from './care-flooring.js';
import {previewCareReplacement,replacementProducts} from './care-replacement.js';
import {careDoors} from './care-access.js';
import {careCommand} from './care-commands.js';
import {createCareWholeHome} from './care-whole-home.js';
import {roomCareProject,validateCareWhole} from './care-home-domain.js';
let wholeStudio=null;
import {StudioScene} from './scene.js';
import * as THREE from './vendor/three.module.js';
import {createScanStudio} from './scan-studio.js';
import {detectXR,xrErrorMessage} from './xr-support.js';
import {sanitizeScanRoom} from './scan-domain.js';
import {CARE_DATA} from './care-data.js';
import {newCareProject,validateCareProject,careGeometry,careReview,safeCareLayout,careExport,placeCareItem,CARE_PROFILES,FIELD_CHECKS,SAMPLE_ITEMS} from './care-domain.js';
import {createCareOnboarding} from './care-onboarding.js';
import {productFitsProfile,ALL_CARE_PRODUCTS} from './care-catalog.js';
import {requestedItems,remainingRequestedItems,validateBrief} from './care-brief.js';
import {fillProductPreviews,openProductPreview} from './care-model-preview.js';
import {API_BASE} from './api-config.js';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],esc=s=>String(s??'未提供').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let pendingScanDraft=null,state=newCareProject(),scene,selected=null,history=[],cleanup=null,camera=null,tab=1,sequence=0,dragBefore=null,lastWarn=0,arCleanup=()=>{};
try{const saved=JSON.parse(localStorage.getItem('domira-care-project'));if(saved){validateCareProject(saved);if(saved.room.measurement)saved.room=sanitizeScanRoom(saved.room);state=saved;}}catch{}

function notify(message){$('#toast').textContent=message;$('#toast').classList.add('on');clearTimeout(notify.timer);notify.timer=setTimeout(()=>$('#toast').classList.remove('on'),4500);}
function closeModal(){const fn=cleanup;cleanup=null;fn?.();$('#modal').close();}
$('#modal').addEventListener('close',()=>{pendingScanDraft=null;const fn=cleanup;cleanup=null;fn?.();});
function modal(title,html,overline='DOMIRA CARE'){cleanup?.();cleanup=null;$('#modal-title').textContent=title;$('#modal-body').innerHTML=html;$('#modal-overline').textContent=overline;if(!$('#modal').open)$('#modal').showModal();}
$('#modal-close').onclick=closeModal;
function invalidateGeneration(){sequence++;$('#generate').disabled=false;$('#generate').textContent='按已選產品重新規劃 ↗';}
function checkpoint(){onboarding.clearDraft();invalidateGeneration();history.push(structuredClone(state));if(history.length>30)history.shift();}
function persist(){state.updatedAt=new Date().toISOString();careProjects?.autosave();try{localStorage.setItem('domira-care-project',JSON.stringify(careExport(state)));$('#save-state').textContent='已保存於此裝置';}catch{$('#save-state').textContent='儲存空間不足 · 請匯出備份';}}
function stage(step){const active=step==='scan'?'layout':step;$$('[data-step]').forEach(e=>e.classList.toggle('active',e.dataset.step===active));}
async function api(path,body){const r=await fetch(API_BASE+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error||'服務暫時無法使用');return d;}
function select(id){selected=id;scene?.highlight(id);const i=state.items.find(x=>x.id===id);$('#selection').hidden=!i;if(i){$('#selected-name').textContent=i.name;$('#replace-item').hidden=!!i.locked||!replacementProducts(i,state.profile).length;$('#remove-item').textContent=i.requestKey?'暫不擺放':'移除';for(const k of ['x','z','rotation'])$('#item-'+k).value=Number(i[k].toFixed(3));}$('#xr-item').value=id||'';}
function transform(id,delta,done){const index=state.items.findIndex(i=>i.id===id);if(index<0)return;if(delta){const candidate={...state.items[index],...delta};if('w'in delta||'d'in delta){if(Date.now()-lastWarn>2500){notify('家具尺寸已鎖定；請移除後按實物尺寸重新加入。');lastWarn=Date.now();}return;}const items=state.items.map((i,n)=>n===index?candidate:i),result=careGeometry({...state,items});if(!result.ok){if(Date.now()-lastWarn>2200){notify(result.failures[0].message+' 已保留有效位置。');lastWarn=Date.now();}scene?.update(state.items);}else{if(!dragBefore){invalidateGeneration();dragBefore=structuredClone(state);}state.items=items;state.fieldChecks={};scene?.update(items);select(id);if(!done)scene?.clearCirculation();}}if(done&&dragBefore){history.push(dragBefore);if(history.length>30)history.shift();dragBefore=null;review();wholeStudio?.refreshNightRoute();persist();}}
function review(){ $$('[data-check]').forEach(e=>e.checked=state.fieldChecks?.[e.dataset.check]===true);const r=careReview(state);drawAccess(r.access);$('#review').innerHTML=`<strong class="${r.ok?'':'blocked'}">${r.ok?'✓ 已檢查目前擺位':'需要調整配置'}</strong><p class="note">通道目標 ${r.profile.corridor.toFixed(2)} m · 門洞目標 ${r.profile.door} m${r.access?.turningPoint?` · 可轉向 Ø${r.profile.turning} m`:``}</p><ul>${r.failures.slice(0,3).map(f=>'<li class="blocked">'+esc(f.message)+'</li>').join('')}${r.pending.slice(0,3).map(p=>'<li>'+esc(p.label)+'</li>').join('')}</ul><p class="note">${r.pending.length}項待核對 · 幾何結果不等於全屋法定合規。</p><a href="#field-review">查看現場核對項目 ↓</a>`;$('#export-open').disabled=!r.ok;$('#export-open').textContent=r.ok?(r.pending.length?'匯出設計草案 ↗':'匯出設計與核對記錄 ↗'):'請先修正幾何問題';}
function drawAccess(access){
 if(!scene)return;
 scene.clearCirculation();
 if(!access?.paths.length||state.wholeHome?.view==='whole')return;
 // Reuse the renderer's route overlay without showing a corridor that wasn't checked.
 const path=access.paths[0];
 scene.showCirculation(path);
 if(access.turningPoint){
  const radius=CARE_PROFILES[state.profile].turning/2;
  const circle=new THREE.Mesh(new THREE.RingGeometry(radius-.012,radius,72),new THREE.MeshBasicMaterial({color:'#338a61',side:THREE.DoubleSide}));
  circle.rotation.x=-Math.PI/2;
  circle.position.set(access.turningPoint[0],.036,access.turningPoint[1]);
  scene.circulationGroup.add(circle);
 }
}
function update({room=false}={}){
 state.unplaced=remainingRequestedItems(state);
 if(scene){
  if(room){
   const displayRoom=state.room.source!=='demo'&&!state.room.measurement&&!state.room.planRoom?{...state.room,measurement:{method:'manual-rectangle'}}:state.room;
   scene.room(displayRoom.planRoom?{...displayRoom,source:'floorplan-room'}:displayRoom);
  }
  scene.update(state.items);
 }

 $('#project-name').textContent=state.name;$('#room-size').textContent=`${state.room.width.toFixed(2)} × ${state.room.depth.toFixed(2)}m · ${(state.room.width*state.room.depth).toFixed(1)}m²`;
 $('#capture-source').textContent=({demo:'示範房間 · 請先測量你的空間','webxr-measured':'WebXR三點測量 · 矩形參數模型','roomplan-imported':'RoomPlan匯入 · 請核對不規則區域','manual-guided':'實測尺寸 · 參數化房間','camera-guided':'攝像頭參考＋實測尺寸','measured-adjusted':'已人工修正測量尺寸','remote-reconstruction':'重建服務結果'})[state.room.source]||'匯入的房間';
 for(const k of ['width','depth','height'])$('#room-'+k).value=state.room[k];$('#profile').value=state.profile;$('#purpose').value=state.purpose||'living';$('#style').value=state.style||'warm';$('#door-width').value=state.doorWidth;$('#door-confirmed').checked=!!state.doorConfirmed;$('#door-confirmed').disabled=!careDoors(state).length;$('#door-width').disabled=careDoors(state).length>0;$('#door-position-open').textContent=careDoors(state).length?'查看或修改門位':'標記房間的門';$('#care-flooring').value=state.room.flooring||'';$('#care-flooring-advice').textContent=flooringAdvice(state.room.flooring,state.room.planRoom?.kind,state.profile);
 $('#xr-item').innerHTML='<option value="">選擇家具</option>'+state.items.map(i=>`<option value="${esc(i.id)}">${esc(i.name)}</option>`).join('');select(selected);review();renderChecks();renderBriefSummary();wholeStudio?.sync();renderLibrary();persist();}
function renderBriefSummary(){const rows=state.brief?.selections||[];$('#brief-summary').innerHTML=rows.length?`<strong>你的需要 · ${rows.reduce((n,r)=>n+r.quantity,0)}件</strong><p>${rows.map(r=>esc(ALL_CARE_PRODUCTS.find(p=>p.productId===r.productId)?.name)+' × '+r.quantity).join('、')}</p><button id="brief-edit" class="secondary">修改產品與偏好</button>`:'<p>先選擇需要的器具、家具與偏好，再開始規劃。</p><button id="brief-edit" class="secondary">開始選擇 →</button>';$('#brief-edit').onclick=()=>onboarding.open();const remaining=state.unplaced||[];$('#unplaced-items').innerHTML=remaining.length?'<p class="catalog-warning">仍有'+remaining.length+'件未能放入目前空間，已保留在需要清單：'+remaining.map(i=>esc(i.name)).join('、')+'。可移動或移除家具，再重新規劃。</p>':'';}
function renderChecks(){state.fieldChecks=state.fieldChecks||{};$('#field-checks').innerHTML=[...FIELD_CHECKS,...CARE_DATA.sheets[0].records.map(r=>[r.id,r.fields['指标项']+'（'+r.fields['推荐/法定值']+'）'])].map(([id,label])=>`<label class="check"><input type="checkbox" data-check="${id}" ${state.fieldChecks?.[id]?'checked':''}>${esc(label)}</label>`).join('');$$('[data-check]').forEach(e=>e.onchange=()=>{state.fieldChecks[e.dataset.check]=e.checked;review();persist();});}
try{scene=new StudioScene($('#scene'),select,transform);scene.scene.traverse(o=>{if(o.isDirectionalLight&&o.shadow)o.shadow.mapSize.set(1024,1024);});const render=scene.animate.bind(scene);let lastFrame=0;scene.animate=(t,f)=>{if(!f&&!scene.down&&t-lastFrame<100)return;lastFrame=t;render(t,f);};scene.syncStretchHandles=()=>{if(scene.stretchGroup)scene.stretchGroup.visible=false;};}catch{$('#render-error').hidden=false;}
const scanner=createScanStudio({scene,getCapabilities:()=>({reconstruction:false}),modal,closeModal,setCleanup:fn=>cleanup=fn,notify,createProject:(name,room)=>{const old=pendingScanDraft||state;if(old.doorWidth>room.width)throw Error('所選入口淨寬大於新房間寬度，請先核對需要設定。');checkpoint();stopAR();state={...newCareProject(room,name),brief:old.brief,profile:old.profile,purpose:old.purpose,style:old.style,doorWidth:old.doorWidth};pendingScanDraft=null;closeModal();update({room:true});if(state.brief)generate();else onboarding.open();},stage,api,icons:()=>{}});
const onboarding=createCareOnboarding({getProject:()=>state.wholeHome?.brief?{...state,brief:state.wholeHome.brief}:state,onConfirm:(draft,scan)=>{if(draft.whole&&state.wholeHome){pendingScanDraft=null;checkpoint();stopAR();state={...state,profile:draft.profile,style:draft.style,wholeHome:{...state.wholeHome,brief:draft.brief,view:'whole'}};update({room:true});queueMicrotask(()=>$('#whole-generate').click());return;}if(state.wholeHome&&['width','depth','height'].some(k=>draft.room[k]!==state.room[k]))throw Error('全屋尺寸請在平面圖匯入時修改，避免房間重疊。');if(scan){pendingScanDraft=draft;stopAR();scanner.open();return;}pendingScanDraft=null;checkpoint();stopAR();const unchanged=['width','depth','height'].every(k=>draft.room[k]===state.room[k]);const room=unchanged&&draft.measured&&state.room.source!=='demo'?state.room:{width:draft.room.width,depth:draft.room.depth,height:draft.room.height,units:'m',source:draft.measured?'manual-guided':'demo'};state={...state,room,profile:draft.profile,purpose:draft.purpose,style:draft.style,doorWidth:draft.doorWidth,doorConfirmed:false,brief:draft.brief,...(state.wholeHome?{wholeHome:{...state.wholeHome,brief:draft.brief,view:'room'}}:{}),items:[],unplaced:[],fieldChecks:{}};update({room:true});if(scan)scanner.open();else generate();}});
$('#needs-open').onclick=()=>{stopAR();onboarding.open();};
$('#scan-open').onclick=()=>{stopAR();if(!(state.brief||state.wholeHome?.brief)&&!pendingScanDraft)onboarding.open();else scanner.open();};
async function generate(){if(!state.brief&&!state.wholeHome?.brief){onboarding.open();return;}if(state.wholeHome)return wholeStudio.generateAll();const token=++sequence,b=$('#generate');b.disabled=true;b.textContent='正在規劃…';stage('layout');try{const result=await api('care/layout',{project:state,style:$('#style').value,purpose:$('#purpose').value});if(token!==sequence)return;const candidate={...state,items:result.items,unplaced:result.unplaced||[]};if(!careGeometry(candidate).ok)throw Error('方案未通過檢查，原設計已保留。');checkpoint();state=candidate;state.fieldChecks={};state.engine=result.engine;$('#engine-note').textContent=result.notice+(result.skipped.length?'；未加入：'+result.skipped.join('、'):'');update();stage('edit');notify(result.items.length?'新方案已生成，可拖動家具調整。':'空間較小，未能放入候選家具；請選較小的實物尺寸。');}catch(e){notify(e.message);}finally{if(token===sequence){b.disabled=false;b.textContent='生成適老佈局 ↗';}}}
$('#generate').onclick=()=>{stopAR();generate();};
for(const id of ['purpose','style'])$('#'+id).onchange=()=>{checkpoint();state[id]=$('#'+id).value;state.fieldChecks={};renderChecks();review();persist();};
$('#apply-room').onclick=()=>{try{const room={width:Number($('#room-width').value),depth:Number($('#room-depth').value),height:Number($('#room-height').value),source:'manual-guided',units:'m'};if(state.wholeHome&&['width','depth','height'].some(k=>room[k]!==state.room[k]))throw Error('全屋房間尺寸請透過平面圖匯入核對修改。');const candidate={...state,room:{...state.room,...room},doorWidth:Number($('#door-width').value)};validateCareProject(candidate);const result=careGeometry(candidate);if(!result.ok&&state.items.length){notify('新尺寸不容納原家具，已清空配置；可重新生成。');candidate.items=[];}checkpoint();state={...candidate,fieldChecks:{},doorConfirmed:false};invalidateGeneration();update({room:true});}catch(e){notify(e.message);}};
$('#profile').onchange=()=>{checkpoint();state.profile=$('#profile').value;state.fieldChecks={};if(state.items.length)state.items=safeCareLayout(state,state.items).items;update();};
$('#door-width').onchange=()=>{const n=Number($('#door-width').value);if(!Number.isFinite(n)||n<.3||n>3||n>state.room.width){ $('#door-width').value=state.doorWidth;return notify('入口淨寬需為0.3-3m且不大於房間寬度。');}checkpoint();state.doorWidth=n;state.doorConfirmed=false;state.fieldChecks={};update();};$('#door-confirmed').onchange=()=>{state.doorConfirmed=$('#door-confirmed').checked;update();};
function setFlooring(material){
 if(material&&!Object.hasOwn(CARE_FLOORING,material))return;
 checkpoint();stopAR();state.room={...state.room,flooring:material||undefined};
 if(state.fieldChecks)delete state.fieldChecks.floor;if(state.wholeHome)state.wholeHome.view='room';
 update({room:true});notify(material?`已換成${CARE_FLOORING[material].name}。按「復原」可換回。`:'已恢復原有地面。');
}
$('#care-flooring').onchange=event=>setFlooring(event.target.value);
function showDoorEditor(index){
 const existing=Array.isArray(state.room.planRoom?.openings)?state.room.planRoom.openings:[];
 const doors=careDoors(state);
 const door=doors[index];
 const wallLabel={top:'上方',right:'右方',bottom:'下方',left:'左方'};
 const original=door?existing.findIndex(item=>item?.kind==='door'&&item.edge===door.edge&&item.offset===door.offset):-1;
 const list=`<div class="care-door-list">${doors.map((entry,n)=>`<button type="button" data-care-door="${n}" ${n===index?'aria-current="true"':''}>門 ${n+1} · ${wallLabel[entry.edge]}牆 · ${entry.width.toFixed(2)} m</button>`).join('')}<button type="button" id="care-add-door" ${existing.length>=12?'disabled':''}>＋ 新增一道門</button></div>`;
 modal(`標記${state.name}的門`,`${list}<form id="care-door-form"><p>按全屋平面圖的方向量度門洞。若門連接兩個房間，請在兩邊記錄同一個門洞。</p><label>哪一面牆？<select id="care-door-edge"><option value="top">上方</option><option value="right">右方</option><option value="bottom">下方</option><option value="left">左方</option></select></label><label>門洞中心距牆邊起點（m）<input id="care-door-center" type="number" min=".15" step="any" required></label><p class="note">上下兩面從左端量。左右兩面從上端量。</p><label>門洞淨寬（m）<input id="care-door-net" type="number" min=".3" max="3" step="any" required></label><label>門向哪邊開？<select id="care-door-swing"><option value="">待核對</option><option value="inward-start">向內開，鉸鏈在起點一側</option><option value="inward-end">向內開，鉸鏈在另一側</option><option value="outward">向外開</option><option value="sliding">趟門</option></select></label><p id="care-door-error" role="alert"></p><button class="primary">儲存門位</button>${door?'<button type="button" id="care-remove-door">移除這道門</button>':''}</form>`);
 for(const button of $$('[data-care-door]'))button.onclick=()=>showDoorEditor(Number(button.dataset.careDoor));
 $('#care-add-door').onclick=()=>showDoorEditor(-1);
 $('#care-door-edge').value=door?.edge||'bottom';
 $('#care-door-center').value=door?Number((door.center[door.horizontal?0:1]+(door.horizontal?state.room.width:state.room.depth)/2).toFixed(3)):state.room.width/2;
 $('#care-door-net').value=door?Number(door.width.toFixed(3)):state.doorWidth;
 $('#care-door-swing').value=door?.swing||'';
 function saveOpenings(openings){
  checkpoint();stopAR();
  state.room={...state.room,planRoom:{name:state.name,kind:state.purpose,...state.room.planRoom,openings}};
  state.doorConfirmed=false;
  if(state.wholeHome)state.wholeHome.view='room';
  closeModal();update({room:true});notify('已更新門位及夜間路線。');
 }
 if(door)$('#care-remove-door').onclick=()=>saveOpenings(existing.filter((_,n)=>n!==original));
 $('#care-door-form').onsubmit=event=>{
  event.preventDefault();
  const edge=$('#care-door-edge').value, center=Number($('#care-door-center').value), width=Number($('#care-door-net').value);
  const wall=['top','bottom'].includes(edge)?state.room.width:state.room.depth;
  const from=center-width/2;
  if(from<0||center+width/2>wall){$('#care-door-error').textContent='門洞超出牆的長度，請再核對。';return;}
  const opening={kind:'door',edge,offset:from/wall,width:width/wall,swing:$('#care-door-swing').value||undefined};
  if(original<0&&existing.length>=12){$('#care-door-error').textContent='這間房最多記錄十二個門窗。請先修正現有門窗。';return;}
  if(existing.some((item,n)=>n!==original&&item?.kind==='door'&&item.edge===edge&&Math.min(item.offset+item.width,opening.offset+opening.width)-Math.max(item.offset,opening.offset)>.001)){
   $('#care-door-error').textContent='與這面牆上已有的門重疊，請修改原本的門位。';return;
  }
  saveOpenings(original<0?[...existing,opening]:existing.map((item,n)=>n===original?opening:item));
 };
}
$('#door-position-open').onclick=()=>showDoorEditor(0);
for(const k of ['x','z','rotation'])$('#item-'+k).onchange=()=>{const value=Number($('#item-'+k).value);if(!Number.isFinite(value))return;transform(selected,{[k]:value},true);select(selected);};
function rotate(){const i=state.items.find(i=>i.id===selected);if(i)transform(i.id,{rotation:(i.rotation+15)%360},true);else notify('請先選取一件家具。');}
function openReplacement(){
 const item=state.items.find(entry=>entry.id===selected);
 if(!item)return;
 const base=state;
 const options=replacementProducts(item,state.profile).map(product=>{
  try{return previewCareReplacement(state,item.id,product.productId);}
  catch(error){return {product,reason:error.message};}
 });
 modal('想換成哪一款？',`<p>目前是${esc(item.name)}。比較新尺寸及位置，確認後才會更換。</p><div class="export-options">${options.map((option,index)=>{
  const product=option.item||option.product;
  const detail=option.item?`新位置 X ${product.x.toFixed(2)} m、Z ${product.z.toFixed(2)} m、${product.rotation}°${option.access?.transfers.some(t=>t.id===item.id)?' · 已找到可用的床側空間':''}`:option.reason;
  return `<button data-replacement="${index}" ${option.item?'':'disabled'}>${esc(product.name)} · ${product.w} × ${product.d} × ${product.h} m<small>${esc(detail)}${option.item?' · 按此套用':''}</small></button>`;
 }).join('')}</div>`);
 $$('[data-replacement]').forEach(button=>button.onclick=()=>{
  if(state!==base)return notify('專案已切換，請重新選擇家具。');
  const option=options[Number(button.dataset.replacement)];
  if(!option.project)return;
  checkpoint();state=option.project;closeModal();update({room:true});select(option.item.id);
  notify(`已換成${option.item.name}。按「復原」可換回。`);
 });
}
$('#replace-item').onclick=openReplacement;
$('#rotate-selected').onclick=rotate;$('#xr-rotate').onclick=rotate;$('#xr-item').onchange=()=>select($('#xr-item').value);
$('#remove-item').onclick=()=>{checkpoint();state.items=state.items.filter(i=>i.id!==selected);state.fieldChecks={};select(null);update();};
function undo(){if(!history.length)return false;stopAR();state=history.pop();invalidateGeneration();selected=null;update({room:true});return true;}
$('#undo').onclick=undo;
$('#view-reset').onclick=()=>scene?.reset();$$('[data-view]').forEach(b=>b.onclick=()=>{stopAR();scene?.setView(b.dataset.view);$$('[data-view]').forEach(e=>e.setAttribute('aria-pressed',String(e===b)));});
function stopAR(){arCleanup();arCleanup=()=>{};scene?.xrSession?.end().catch(()=>{});camera?.getTracks().forEach(t=>t.stop());camera=null;$('#camera-video').srcObject=null;$('#camera-video').hidden=true;$('#ar-controls').hidden=true;$('#viewport').classList.remove('xr');scene?.setView('3d');$$('[data-view]').forEach(e=>e.setAttribute('aria-pressed',String(e.dataset.view==='3d')));}
$('#ar-end').onclick=stopAR;
$('#ar-open').onclick=async()=>{if(!scene)return notify('此裝置未啟用3D。');const support=await detectXR();modal('把配置，放進真實空間。',`<p>${esc(support.reason)}</p><div class="modal-notice">WebXR支援1:1尺度定位、家具拖動和旋轉。攝像頭疊加僅供手動對齊，沒有空間追蹤。普通相機不能自動產生精確3D測量。</div><p id="ar-error" class="error-text" role="alert"></p><div class="modal-actions">${support.camera?'<button class="secondary" id="camera-start">攝像頭疊加預覽</button>':''}${support.supported?'<button class="primary" id="xr-start">啟動真實尺度 AR</button>':''}</div>`);
 if($('#camera-start'))$('#camera-start').onclick=async()=>{const button=$('#camera-start');button.disabled=true;try{const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});if(!$('#modal').open){stream.getTracks().forEach(t=>t.stop());return;}camera=stream;$('#camera-video').srcObject=stream;$('#camera-video').hidden=false;scene.setView('ar');$('#ar-controls').hidden=false;$('#xr-status').textContent='攝像頭疊加 · 手動對齊，無空間追蹤';closeModal();}catch(e){$('#ar-error').textContent=xrErrorMessage(e);button.disabled=false;}};
 if($('#xr-start'))$('#xr-start').onclick=async()=>{closeModal();$('#viewport').classList.add('xr');$('#ar-controls').hidden=false;try{await scene.startXR($('#viewport'),message=>{if(message==='end'){arCleanup();arCleanup=()=>{};$('#viewport').classList.remove('xr');$('#ar-controls').hidden=true;}else $('#xr-status').textContent=message;});const controller=scene.xrController,ray=new THREE.Raycaster(),plane=new THREE.Plane(),hit=new THREE.Vector3();let dragging=false,moved=false,grab=null;const ground=()=>{plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0,1,0),scene.root.getWorldPosition(new THREE.Vector3()));ray.setFromXRController(controller);if(!ray.ray.intersectPlane(plane,hit))return null;return scene.root.worldToLocal(hit.clone());};const start=()=>{moved=false;const item=state.items.find(i=>i.id===selected),p=ground();dragging=!!item&&scene.placed&&!!p;grab=dragging?{id:item.id,dx:item.x-p.x,dz:item.z-p.z,x:item.x,z:item.z}:null;},end=()=>{if(dragging)transform(grab.id,null,true);dragging=false;};scene.xrSelectOverride=()=>moved;controller.addEventListener('selectstart',start);controller.addEventListener('selectend',end);const original=scene.animate.bind(scene);scene.animate=(time,frame)=>{original(time,frame);if(dragging&&frame&&scene.xrSpace&&frame.getViewerPose(scene.xrSpace)){const p=ground();if(p){const x=p.x+grab.dx,z=p.z+grab.dz;if(Math.hypot(x-grab.x,z-grab.z)>.01)moved=true;if(moved)transform(grab.id,{x,z},false);}}};arCleanup=()=>{controller.removeEventListener('selectstart',start);controller.removeEventListener('selectend',end);scene.xrSelectOverride=null;scene.animate=original;end();};}catch(e){stopAR();notify(xrErrorMessage(e));}};
};
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopAR();});window.addEventListener('pagehide',()=>{wholeStudio?.stop();stopAR();scanner.stop();});
function linkify(value){const text=String(value??'未提供');let html='',cursor=0;for(const match of text.matchAll(/https?:\/\/[^\s<>"']+/g)){html+=esc(text.slice(cursor,match.index))+`<a href="${esc(match[0])}" target="_blank" rel="noopener noreferrer">${esc(match[0])} ↗</a>`;cursor=match.index+match[0].length;}return html+esc(text.slice(cursor));}
const names=['規範與動線','輔助器具','分區改造方案','採購渠道與資助'];
function renderData(){const s=CARE_DATA.sheets[tab],query=$('#catalog-search').value.trim().toLowerCase(),rows=s.records.filter(r=>Object.values(r.fields).join(' ').toLowerCase().includes(query));$('#data-count').textContent=`顯示${rows.length} / ${s.records.length}條 · 共${CARE_DATA.total}條原表記錄 · 2026-11-04匯入；原文「法定／推薦」須按適用條件另核。`;
 $('#data-cards').innerHTML=rows.map(r=>`<article class="data-card"><small>${esc(r.id)} · ${esc(r.source_sheet)} 第${r.source_row}行</small><h3>${esc(Object.values(r.fields)[1]||Object.values(r.fields)[0])}</h3><dl>${Object.entries(r.fields).map(([k,v])=>`<dt>${esc(k)}</dt><dd>${linkify(v)}</dd>`).join('')}</dl>${tab===1?`<button class="secondary" data-add="${esc(r.id)}">填入實物尺寸並加入 ↗</button>`:''}</article>`).join('')||'<p>沒有符合搜尋的記錄。</p>';$$('[data-add]').forEach(e=>e.onclick=()=>addProduct(e.dataset.add));}
$('#data-tabs').innerHTML=names.map((n,i)=>`<button data-tab="${i}" class="${i===tab?'active':''}">${n} ${CARE_DATA.sheets[i].records.length}</button>`).join('');$$('[data-tab]').forEach(b=>b.onclick=()=>{tab=Number(b.dataset.tab);$$('[data-tab]').forEach(e=>e.classList.toggle('active',e===b));renderData();});$('#catalog-search').oninput=renderData;
function addProduct(id){onboarding.open(id);}
let libraryProfile;
function renderLibrary(){if(libraryProfile===state.profile)return;libraryProfile=state.profile;const root=$('#product-models');root.innerHTML=ALL_CARE_PRODUCTS.filter(p=>productFitsProfile(p,state.profile)).map(p=>`<article class="needs-product"><div class="product-art"><img data-product-image="${p.productId}" alt="${esc(p.name)}3D模型" hidden><span>3D MODEL</span><button class="model-inspect" data-model-view="${p.productId}" aria-label="查看${esc(p.name)}模型">⤢</button></div><h3>${esc(p.name)}</h3><p class="product-envelope">${p.w} × ${p.d} × ${p.h} m · 概念尺寸</p><button class="secondary" data-model-add="${p.productId}">加入空間 ＋</button></article>`).join('');root.querySelectorAll('[data-model-view]').forEach(b=>b.onclick=()=>openProductPreview(ALL_CARE_PRODUCTS.find(p=>p.productId===b.dataset.modelView),{onChoose:p=>onboarding.open(p.productId)}));root.querySelectorAll('[data-model-add]').forEach(b=>b.onclick=()=>{if(state.wholeHome){onboarding.open(b.dataset.modelAdd);return;}if(!state.brief){onboarding.open(b.dataset.modelAdd);return;}try{const p=ALL_CARE_PRODUCTS.find(p=>p.productId===b.dataset.modelAdd),pending=remainingRequestedItems(state).find(i=>i.productId===p.productId),next=structuredClone(state.brief);let raw=pending;if(!raw){const chosen=next.selections.find(s=>s.productId===p.productId);if(chosen)chosen.quantity++;else next.selections.push({productId:p.productId,quantity:1,w:p.w,d:p.d,h:p.h,dimensionSource:'concept'});validateBrief(next);raw=requestedItems(next).filter(i=>i.productId===p.productId).at(-1);}const item=placeCareItem({...state,brief:next},{...raw,id:crypto.randomUUID()});checkpoint();state.brief=next;if(item)state.items.push(item);state.fieldChecks={};update();if(item){select(item.id);$('#viewport').scrollIntoView({behavior:'smooth',block:'center'});notify('產品已加入需要清單和空間，可拖動及旋轉。');}else notify('已保留在需要清單；目前找不到符合房間及活動需要的擺位。');}catch(e){notify(e.message);}});new IntersectionObserver((entries,observer)=>{if(entries.some(e=>e.isIntersecting)){fillProductPreviews(ALL_CARE_PRODUCTS,root);observer.disconnect();}},{rootMargin:'250px'}).observe(root);}
function download(content,type,ext){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download='Domira-Care-'+state.id.slice(0,8)+'.'+ext;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);}
function svg(){const scale=90,w=state.room.width,d=state.room.depth,p=careExport(state);return `<svg xmlns="http://www.w3.org/2000/svg" width="${w*scale+80}" height="${d*scale+160}" viewBox="0 0 ${w*scale+80} ${d*scale+160}"><rect width="100%" height="100%" fill="#f8f8ef"/><text x="30" y="30" font-size="17">DOMIRA CARE / ${esc(state.name)}</text><text x="30" y="52" font-size="11">${w} × ${d}m / ${esc(p.review.status)} / 非施工或法定認證</text><g transform="translate(40,80)"><rect width="${w*scale}" height="${d*scale}" fill="${CARE_FLOORING[state.room.flooring]?.color||'#e7e8da'}" stroke="#3d5a39"/>${(p.review.access?.paths||[]).map(path=>`<polyline points="${path.map(([x,z])=>`${(x+w/2)*scale},${(z+d/2)*scale}`).join(' ')}" fill="none" stroke="#528458" stroke-width="3"/>`).join('')}${state.items.map(i=>`<g transform="translate(${(i.x+w/2)*scale},${(i.z+d/2)*scale}) rotate(${i.rotation})"><rect x="${-i.w*scale/2}" y="${-i.d*scale/2}" width="${i.w*scale}" height="${i.d*scale}" fill="${i.color}" stroke="#445841"/><text y="3" text-anchor="middle" font-size="9">${esc(i.name)}</text></g>`).join('')}</g><text x="40" y="${d*scale+110}" font-size="10">${p.review.pending.length}項現場核對待完成。尺寸以實測為準。</text></svg>`;}
function exportDesign(){const r=careReview(state);if(!r.ok)return notify('請先修正幾何問題再匯出。');stage('export');modal('帶走你的設計。',`<p>目前版本含${state.items.length}件家具。${r.pending.length}項現場核對待完成，匯出會保留此狀態及尺寸來源。</p><div class="export-options">${[['json','可編輯專案與檢查記錄','可重新匯入，保存測量資料及來源'],['svg','尺寸平面圖','保留家具位置、朝向及通道示意'],['obj','3D模型','公尺單位，包含已套用的家具變換'],['png','目前3D視角','不包含攝像頭影像']].map(([ext,title,desc])=>`<button data-export="${ext}">${title} · ${ext.toUpperCase()} ↗<small>${desc}</small></button>`).join('')}</div>`);$$('[data-export]').forEach(b=>b.onclick=()=>{const ext=b.dataset.export;if(ext==='json')download(JSON.stringify(careExport(state),null,2),'application/json','json');if(ext==='svg')download(svg(),'image/svg+xml','svg');if(ext==='obj'){if(!scene)return notify('此裝置沒有可匯出的3D模型。');download(scene.obj(),'text/plain','obj');}if(ext==='png'){if(!scene||scene.xrSession)return notify('請先結束AR並啟用3D。');const a=document.createElement('a');a.href=scene.snapshot();a.download='Domira-Care.png';a.click();}});}
$('#export-open').onclick=exportDesign;
$('#import-project').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>2000000)throw Error('專案檔需小於2MB。');const p=JSON.parse(await file.text());validateCareProject(p);if(p.wholeHome)validateCareWhole(p.wholeHome);if(p.room.measurement)p.room=sanitizeScanRoom(p.room);if(!careGeometry(p).ok)throw Error('匯入配置未通過幾何檢查，原設計已保留。');stopAR();checkpoint();state={...p,fieldChecks:{},doorConfirmed:false};invalidateGeneration();selected=null;update({room:true});notify('已匯入；現場核對狀態需要重新確認。');}catch(err){notify(err.message);}finally{e.target.value='';}};
$$('[data-step]').forEach(e=>e.onclick=()=>{const name=e.dataset.step;stage(name);if(name==='needs')$('#needs-open').click();if(name==='scan')$('#scan-open').click();if(name==='layout')$('#room-width').focus();if(name==='edit')$('#viewport').scrollIntoView({behavior:'smooth',block:'center'});if(name==='export')exportDesign();});
try{const s=JSON.parse(sessionStorage.getItem('domira-care-session'));if(s?.expiresAt>Date.now())$('#account-link').textContent='我的帳戶';}catch{}
function proposeChatAction(text,base){
 const command=careCommand(text,base);
 if(!command)return null;
 if(command.error)return {reply:command.error};
 const whole=base.wholeHome;
 const action=(reply,details,label,run)=>({reply,details,label,run});
 if(command.type==='night-route'){
  const detail=$('#care-night-detail').textContent;
  return action(detail,['在全屋平面圖查看路線及待核對位置'],'查看路線',()=>$('#care-night-heading').scrollIntoView({block:'center'}));
 }
 if(command.type==='floor')return action('先看看這次會改哪些房間的地面。',command.changes.map(change=>{
  const kind=whole?.home.rooms.find(room=>room.id===change.roomId)?.kind||base.purpose;
  return `${change.name} · ${CARE_FLOORING[change.material].name}。${flooringAdvice(change.material,kind,base.profile)}`;
 }).concat(command.save!==undefined?[`另外儲存「${command.save||'手動儲存'}」`]:[]),'套用地面',async()=>{
  checkpoint();stopAR();
  for(const change of command.changes){
   const p=change.roomId&&whole?.activeRoomId!==change.roomId?whole.projects[change.roomId]:base;
   if(p){p.room={...p.room,flooring:change.material};if(p.fieldChecks)delete p.fieldChecks.floor;}
   const room=whole?.home.rooms.find(room=>room.id===change.roomId);
   if(room)room.flooring=change.material;
  }
  update({room:true});
  if(command.save!==undefined){
   try{await careProjects.saveVersion(command.save);return `地面已更新，並在這部裝置儲存「${command.save||'手動儲存'}」。`;}
   catch{return '地面已更新。專案版本未能儲存，你可以重試或匯出備份。';}
  }
  return '地面已更新。想換回去，可以講「復原」。';
 });
 if(command.type==='save')return action('可以把目前擺法存成一個版本。',[command.label||'手動儲存'],'儲存版本',async()=>{
  await careProjects.saveVersion(command.label);return `已在這部裝置儲存「${command.label||'手動儲存'}」。你可以在「我的專案」打開。`;
 });
 if(command.type==='undo'){
  if(!history.length)return {reply:'目前沒有可以復原的修改。以前存的版本可以在「我的專案」打開。'};
  return action('可以回到剛才的擺法。',['復原上一次設計修改'],'確認復原',()=>undo()?'已復原上一次修改。':'目前沒有可以復原的修改。');
 }
 if(command.type==='export')return action('可以帶走目前的設計。',[command.whole?'全屋方案':'目前房間'],'選擇下載格式',()=>{
  $(command.whole?'#whole-export':'#export-open').click();
 });
 if(command.type==='plan'){
  const brief=whole?.brief||base.brief;
  if(!brief)return action('先選想要的家具和輔具，選好就可以規劃。',['選擇器具與偏好'],'開始選擇',()=>$('#needs-open').click());
  return action('可以用已選的家具和輔具規劃全屋。',[whole.name||base.name,'重新計算各房間的擺位'],'開始規劃',()=>{stopAR();return wholeStudio.generateAll();});
 }
 if(command.type!=='bed')return null;
 const id=command.roomId||whole?.activeRoomId;
 const room=whole?.home.rooms.find(entry=>entry.id===id);
 const source=id&&id!==whole?.activeRoomId?whole.projects[id]:base;
 if(!source)return {reply:'這間房的尺寸未能用來擺床。請先核對平面圖。'};
 const target=id&&whole?{...source,room:{...source.room,planRoom:source.room.planRoom||roomCareProject(whole.home,room).room.planRoom},wholeHome:{...whole,activeRoomId:id,view:'room'}}:source;
 const beds=target.items.filter(item=>item.type==='bed'&&!item.locked);
 const bed=beds.find(item=>item.id===selected&&source===base)||(beds.length===1?beds[0]:null);
 if(!bed)return {reply:beds.length?'這間房有多張床。請先點選想換的那張床。':'這間房暫時沒有可換的床。可以在「選擇器具與偏好」加入睡床或護理床。'};
 if(!command.product)return {reply:'想換普通睡床，還是電動護理床？例如可以講「睡房換護理床」。'};
 if(bed.productId===command.product)return {reply:`這間房已經用了${bed.name}。`};
 try{
  const option=previewCareReplacement(target,bed.id,command.product,{transferSide:command.transferSide});
  if(!option.item)return {reply:option.reason};
  const {item,project,access}=option;
  const transfer=access?.transfers.find(entry=>entry.id===item.id);
  const dimensions=`${room?.name||base.name} · ${item.name} · ${item.w} × ${item.d} × ${item.h} m${item.dimensionSource==='concept'?'（示意尺寸）':''}`;
  const side=transfer?`以床尾望向床頭計，${transfer.side==='right'?'右':'左'}側留有上落床的位置。`:'';
  return action('已找到可試的床位。確認後才會換床。',[dimensions,`新位置 X ${item.x.toFixed(2)} m、Z ${item.z.toFixed(2)} m，朝向 ${item.rotation}°。`,side].filter(Boolean),'確認換床',()=>{
   checkpoint();stopAR();state=project;update({room:true});select(item.id);
   return `已換成${item.name}。想換回去，可以講「復原」。`;
  });
 }catch(error){return {reply:error.message};}
}
careProjects=createCareProjects({getState:()=>state,loadState:project=>{validateCareProject(project);if(project.wholeHome)validateCareWhole(project.wholeHome);stopAR();checkpoint();state=project;selected=null;update({room:true});},modal,closeModal,notify});
wholeStudio=createCareWholeHome({scene,getState:()=>state,replaceState:p=>state=p,refresh:update,modal,closeModal,setCleanup:fn=>cleanup=fn,notify,api,checkpoint,stopAR,propose:proposeChatAction});
update({room:true});renderData();stage(state.brief?'edit':'needs');if(!(state.brief||state.wholeHome?.brief)||new URLSearchParams(location.search).get('start')==='needs')onboarding.open();else if(new URLSearchParams(location.search).get('start')==='scan')$('#scan-open').click();
