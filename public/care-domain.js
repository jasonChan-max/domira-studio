import {CARE_FLOORING} from './care-flooring.js';
import {validateRoom,itemBounds,CATALOG} from './domain.js';
import {checkCareAccess,careDoors} from './care-access.js';
import {CARE_DATA} from './care-data.js';
import {validateBrief,remainingRequestedItems,requestedItems} from './care-brief.js';
import {CARE_PRODUCTS,ALL_CARE_PRODUCTS} from './care-catalog.js';

export const CARE_VERSION='domira.care.v1';
export const CARE_PROFILES={walker:{name:'步行／助行器',corridor:.9,door:.8,turning:1.5},wheelchair:{name:'輪椅／照顧協助',corridor:1.2,door:.85,turning:1.5}};
export const CARE_RULES_VERSION='care-route-v2';
export const CARE_KINDS=['cane','walker','wheelchair','stool','shower','folding','swivel','commode','toilet','rail','surface','care-bed','pillbox'];
export function careCollisions(items){
 const pairs=[],axes=i=>{const a=i.rotation*Math.PI/180;return [[Math.cos(a),Math.sin(a)],[-Math.sin(a),Math.cos(a)]];},dot=(a,b)=>a[0]*b[0]+a[1]*b[1];
 for(let n=0;n<items.length;n++)for(let m=n+1;m<items.length;m++){const a=items[n],b=items[m];if(a.role==='surface'||b.role==='surface')continue;const aa=axes(a),bb=axes(b),delta=[a.x-b.x,a.z-b.z];
  const separated=[...aa,...bb].some(axis=>{const radius=(i,ax)=>Math.abs(dot(axis,ax[0]))*i.w/2+Math.abs(dot(axis,ax[1]))*i.d/2;return Math.abs(dot(delta,axis))>=radius(a,aa)+radius(b,bb)-1e-8;});if(!separated)pairs.push([a.id,b.id]);
 }return pairs;
}
export const FIELD_CHECKS=[['floor','地面防滑、乾濕區與去水已現場核對'],['lighting','照明、眩光及床邊／夜間開關已核對'],['support','座高、扶手、承重與使用者試配已核對'],['threshold','門檻高差、開門與緊急救援方式已核對'],['installation','牆體錨固、電氣及必要的專業評估已核對']];
export function validateCareProject(p){
 if(!p||p.format!==CARE_VERSION)throw Error('請選擇 Domira Care v1 專案。');
 validateRoom(p.room);if(p.room.flooring&&!Object.hasOwn(CARE_FLOORING,p.room.flooring))throw Error('請選擇有效的地面材料。');if(p.brief)validateBrief(p.brief);if(p.units&&p.units!=='m'||p.room.units&&p.room.units!=='m')throw Error('專案必須使用公尺。');if(typeof p.name!=='string'||p.name.length>100||typeof p.id!=='string'||p.id.length>100||p.room.width>15||p.room.depth>15||p.room.width<2||p.room.depth<2||p.fieldChecks&&(!p.fieldChecks||typeof p.fieldChecks!=='object'||Array.isArray(p.fieldChecks)))throw Error('專案名稱、尺寸或核對記錄不正確。');if(!Object.hasOwn(CARE_PROFILES,p.profile)||!Array.isArray(p.items)||p.items.length>40)throw Error('專案的活動需求或家具數量不正確。');
 const requests=new Map(p.brief?requestedItems(p.brief).map(i=>[i.requestKey,i]):[]),usedRequests=new Set();const ids=new Set();for(const i of p.items){if(!i||typeof i.id!=='string'||!i.id.length||i.id.length>100||ids.has(i.id)||typeof i.name!=='string'||i.name.length>100||!Object.hasOwn(CATALOG,i.type)||!/^#[a-f0-9]{6}$/i.test(i.color)||!['x','z','w','d','h','rotation'].every(k=>Number.isFinite(i[k]))||[i.w,i.d,i.h].some(v=>v<.005||v>15)||Math.abs(i.x)>30||Math.abs(i.z)>30||Math.abs(i.rotation)>3600)throw Error('家具尺寸、座標或識別碼不正確。');
  if(i.requestKey){const expected=requests.get(i.requestKey);if(!expected||usedRequests.has(i.requestKey)||['productId','type','careKind','careModel','modelStyle','sourceRecordId','dimensionSource'].some(k=>(i[k]??null)!==(expected[k]??null))||['w','d','h'].some(k=>Math.abs(i[k]-expected[k])>1e-8))throw Error('所選產品的數量、模型或尺寸來源不一致，請重新確認需要。');usedRequests.add(i.requestKey);}else if(p.brief&&i.productId)throw Error('產品不在已確認需要中。');
  const model=CARE_PRODUCTS.find(p=>p.careModel===i.careModel),product=ALL_CARE_PRODUCTS.find(p=>p.productId===(i.productId||i.sourceRecordId));if(i.careModel&&!model||i.productId&&!product||model&&product&&model.careModel!==product.careModel||product&&i.careKind!==product.careKind||model&&i.careKind!==model.careKind||i.productId&&i.sourceRecordId&&i.productId!==i.sourceRecordId)throw Error('產品識別與3D模型不一致。');
  if(i.careKind&&!CARE_KINDS.includes(i.careKind))throw Error('未知的器具類別。');
  const surface=i.careKind==='surface'&&i.type==='rug'&&i.role==='surface'&&i.h<=.03&&(product?.role==='surface'||['AID-016','AID-017'].includes(i.sourceRecordId));
  if((i.role&&i.role!=='solid'&&!surface)||(i.type==='rug'&&!surface)||i.careKind==='surface'&&!surface)throw Error('僅目錄防滑薄層可使用地面薄層規則，厚度上限0.03m。');
  ids.add(i.id);}
 if(!Number.isFinite(p.doorWidth)||p.doorWidth<.3||p.doorWidth>3||p.doorWidth>p.room.width)throw Error('入口淨寬不正確。');
 return p;
}
export function careGeometry(project, options){
 validateCareProject(project);
 const {room,items}=project,profile=CARE_PROFILES[project.profile],failures=[];
 for(const item of items){
  const bounds=itemBounds(item);
  if(Math.abs(item.x)+bounds.w/2>room.width/2+.001||Math.abs(item.z)+bounds.d/2>room.depth/2+.001)failures.push({rule:'bounds',id:item.id,message:item.name+'超出房間邊界。'});
  if(item.h>room.height)failures.push({rule:'height',id:item.id,message:item.name+'高於房間層高。'});
 }
 for(const pair of careCollisions(items))failures.push({rule:'collision',message:'家具佔地重疊，請移動或減少家具。',pair});
 const access=failures.length?null:checkCareAccess(project,profile,options);
 if(access)failures.push(...access.failures);
 return {ok:!failures.length,failures,profile,access,scope:'房間邊界、家具碰撞、已標門口、床側空間與輪椅轉向位置',rulesVersion:CARE_RULES_VERSION};
}
export function careReview(p){const geometry=careGeometry(p,{includePaths:true}),pending=FIELD_CHECKS.filter(([id])=>p.fieldChecks?.[id]!==true).map(([id,label])=>({id,label}));for(const r of CARE_DATA.sheets[0].records)if(p.fieldChecks?.[r.id]!==true)pending.push({id:r.id,label:r.fields['指标项']+'：需現場核對原表參考及適用性'});if(!p.doorConfirmed&&careDoors(p).length)pending.unshift({id:'door-confirmation',label:'請核對圖上的門位及實測淨寬。'});pending.unshift(...(geometry.access?.pending||[]));if(p.room.source==='demo')pending.unshift({id:'measurement',label:'示範房間需以真實測量取代'});if(p.room.measurement?.geometry==='wall-aligned-bounding-rectangle')pending.unshift({id:'irregular-room',label:'RoomPlan包絡矩形內的不規則／凹位須另行核對'});if(p.items.some(i=>i.dimensionSource!=='user-confirmed'))pending.push({id:'furniture-dimensions',label:'所有家具示意尺寸需實物覆核'});const unplaced=remainingRequestedItems(p);if(unplaced.length)pending.push({id:'unplaced-products',label:unplaced.length+'件所選產品尚未放入空間'});return {...geometry,pending,status:!geometry.ok?'blocked':pending.length?'review-required':'checks-recorded',certified:false};}
export function newCareProject(room={width:6,depth:4.5,height:2.7,source:'demo'},name='我的樂齡空間'){return {format:CARE_VERSION,id:crypto.randomUUID(),name,room,profile:'wheelchair',purpose:'living',style:'warm',doorWidth:.9,doorConfirmed:false,items:[],fieldChecks:{},updatedAt:new Date().toISOString()};}
export const SAMPLE_ITEMS=[{type:'chair',name:'扶手座椅',w:.7,d:.72,h:.95,color:'#c7b29a'},{type:'cabinet',name:'可及收納櫃',w:1.2,d:.4,h:.8,color:'#a59176'},{type:'bed',name:'睡床',w:1.1,d:2,h:.65,color:'#d7cdbb'}];
export function placeCareItem(project,raw,index=project.items.length){
 validateCareProject(project);if(project.items.length>=40)return null;
 if(!raw||!['w','d','h'].every(k=>Number.isFinite(raw[k])&&raw[k]>0&&raw[k]<=8))return null;
 const item={...raw,id:raw.id||crypto.randomUUID(),name:String(raw.name||'候選家具').slice(0,100),color:/^#[a-f0-9]{6}$/i.test(raw.color)?raw.color:'#b5aaa0',dimensionSource:raw.dimensionSource||'concept',x:0,z:0,rotation:0};
 validateCareProject({...project,items:[...project.items,item]});
 if(['x','z','rotation'].every(k=>Number.isFinite(raw[k]))){const preferred={...item,x:raw.x,z:raw.z,rotation:raw.rotation};if(careGeometry({...project,items:[...project.items,preferred]}).ok)return preferred;}
 const room=project.room;
 const alongWall=(min,max)=>Array.from({length:Math.max(0,Math.ceil((max-min)/.2)+1)},(_,n)=>Math.min(max,min+n*.2));
 for(const rotation of (item.type==='bed'?[0,180,90,270]:[index%2?270:90,0,180,index%2?90:270])){
  const bounds=itemBounds({...item,rotation});
  const xLimit=room.width/2-bounds.w/2-.015,zLimit=room.depth/2-bounds.d/2-.015;
  if(xLimit<0||zLimit<0)continue;
  const candidates=[];
  for(const side of (index%2?[-1,1]:[1,-1])){
   for(const z of alongWall(-zLimit,zLimit))candidates.push([side*xLimit,z]);
   for(const x of alongWall(-xLimit,xLimit))candidates.push([x,side*zLimit]);
  }
  if(item.type==='bed'){
   const behind=(x,z)=>Math.sin(rotation*Math.PI/180)*x-Math.cos(rotation*Math.PI/180)*z;
   candidates.sort((a,b)=>behind(...b)-behind(...a));
  }
  for(const [x,z] of candidates){
   const attempt={...item,x,z,rotation};
   if(careGeometry({...project,items:[...project.items,attempt]}).ok)return attempt;
  }
 }

 return null;
}
export function safeCareLayout(project,proposal=[]){
 validateCareProject(project);
 const candidates=(proposal.length?proposal:SAMPLE_ITEMS).slice(0,40).sort((a,b)=>Number(b?.type==='bed')-Number(a?.type==='bed'));
 const plan=(order,usePreferred)=>{
  const p={...project,items:[]},skipped=[];
  for(const [index,raw] of order.entries()){
   const input=usePreferred?raw:{...raw,x:undefined,z:undefined,rotation:undefined};
   let found;
   try{found=placeCareItem(p,input,index);}catch{}
   if(found)p.items.push(found);else skipped.push(String(raw?.name||'無效候選家具'));
  }
  return {p,skipped};
 };
 const preferred=plan(candidates,true);
 let best=preferred;
 if(preferred.skipped.length&&candidates.length>1){
  const footprint=i=>i?.role==='surface'?0:(i?.w||0)*(i?.d||0);
  const largestFirst=[...candidates].sort((a,b)=>footprint(b)-footprint(a));
  for(const option of [plan(largestFirst,true),plan(largestFirst,false)]){
   if(option.p.items.length>best.p.items.length)best=option;
  }
 }
 return {items:best.p.items,skipped:best.skipped,review:careReview(best.p),description:'按門位、床側空間與活動需要檢查家具擺位。'};
}
export function careExport(p){validateCareProject(p);return {...p,unplaced:remainingRequestedItems(p),updatedAt:new Date().toISOString(),review:careReview(p),units:'m',coordinateSystem:'right-handed-y-up',origin:'floor-center',rotationConvention:'degrees; local front +z; clockwise plan rotation',doorLocation:careDoors(p).length?'plan-openings':'unknown'};}
