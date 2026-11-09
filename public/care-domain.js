import {validateRoom,itemBounds,CATALOG} from './domain.js';
import {pointClearance} from './circulation-domain.js';
import {CARE_DATA} from './care-data.js';
import {validateBrief,remainingRequestedItems,requestedItems} from './care-brief.js';
import {CARE_PRODUCTS,ALL_CARE_PRODUCTS} from './care-catalog.js';

export const CARE_VERSION='domira.care.v1';
export const CARE_PROFILES={walker:{name:'步行／助行器',corridor:.9,door:.8,turning:1.5},wheelchair:{name:'輪椅／照顧協助',corridor:1.2,door:.85,turning:1.5}};
export const CARE_RULES_VERSION='care-2026-11-04';
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
 validateRoom(p.room);if(p.brief)validateBrief(p.brief);if(p.units&&p.units!=='m'||p.room.units&&p.room.units!=='m')throw Error('專案必須使用公尺。');if(typeof p.name!=='string'||p.name.length>100||typeof p.id!=='string'||p.id.length>100||p.room.width>15||p.room.depth>15||p.room.width<2||p.room.depth<2||p.fieldChecks&&(!p.fieldChecks||typeof p.fieldChecks!=='object'||Array.isArray(p.fieldChecks)))throw Error('專案名稱、尺寸或核對記錄不正確。');if(!Object.hasOwn(CARE_PROFILES,p.profile)||!Array.isArray(p.items)||p.items.length>40)throw Error('專案的活動需求或家具數量不正確。');
 const requests=new Map(p.brief?requestedItems(p.brief).map(i=>[i.requestKey,i]):[]),usedRequests=new Set();const ids=new Set();for(const i of p.items){if(!i||typeof i.id!=='string'||!i.id.length||i.id.length>100||ids.has(i.id)||typeof i.name!=='string'||i.name.length>100||!Object.hasOwn(CATALOG,i.type)||!/^#[a-f0-9]{6}$/i.test(i.color)||!['x','z','w','d','h','rotation'].every(k=>Number.isFinite(i[k]))||[i.w,i.d,i.h].some(v=>v<.005||v>15)||Math.abs(i.x)>30||Math.abs(i.z)>30||Math.abs(i.rotation)>3600)throw Error('家具尺寸、座標或識別碼不正確。');
  if(i.requestKey){const expected=requests.get(i.requestKey);if(!expected||usedRequests.has(i.requestKey)||['productId','type','careKind','careModel','sourceRecordId','dimensionSource'].some(k=>(i[k]??null)!==(expected[k]??null))||['w','d','h'].some(k=>Math.abs(i[k]-expected[k])>1e-8))throw Error('所選產品的數量、模型或尺寸來源不一致，請重新確認需要。');usedRequests.add(i.requestKey);}else if(p.brief&&i.productId)throw Error('產品不在已確認需要中。');
  const model=CARE_PRODUCTS.find(p=>p.careModel===i.careModel),product=ALL_CARE_PRODUCTS.find(p=>p.productId===(i.productId||i.sourceRecordId));if(i.careModel&&!model||i.productId&&!product||model&&product&&model.productId!==product.productId||product&&i.careKind!==product.careKind||model&&i.careKind!==model.careKind||i.productId&&i.sourceRecordId&&i.productId!==i.sourceRecordId)throw Error('產品識別與3D模型不一致。');
  if(i.careKind&&!CARE_KINDS.includes(i.careKind))throw Error('未知的器具類別。');
  const surface=i.careKind==='surface'&&i.type==='rug'&&i.role==='surface'&&i.h<=.03&&['AID-016','AID-017'].includes(i.sourceRecordId);
  if((i.role&&i.role!=='solid'&&!surface)||(i.type==='rug'&&!surface)||i.careKind==='surface'&&!surface)throw Error('僅原表防滑薄墊可使用地面薄層規則，厚度上限0.03m。');
  ids.add(i.id);}
 if(!Number.isFinite(p.doorWidth)||p.doorWidth<.3||p.doorWidth>3||p.doorWidth>p.room.width)throw Error('入口淨寬不正確。');
 return p;
}
// 把房間的門統一成局部座標清單。
// p.doors 是從整屋帶進來的（edge＋offset＋width，與 home 的 openings 同格式），
// 支援起居室這種「一個通玄關、一個通睡房」的多門情況；
// 沒有 p.doors 就退回舊行為：單一入口放在下方中央（doorWidth）。
export function doorList(p){
 const W=p.room.width,D=p.room.depth,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 if(Array.isArray(p.doors)&&p.doors.length){
  return p.doors.map(d=>{
   const w=clamp(Number(d.width)||.9,.3,3),off=clamp(Number(d.offset)||0,0,1);
   if(d.edge==='bottom'||d.edge==='top'){
    const z=d.edge==='bottom'?D/2:-D/2,x0=-W/2+off*W;
    return {edge:d.edge,axis:'x',z,x0,x1:x0+w,w};
   }
   const x=d.edge==='right'?W/2:-W/2,z0=-D/2+off*D;
   return {edge:d.edge||'left',axis:'z',x,z0,z1:z0+w,w};
  });
 }
 const w=clamp(Number(p.doorWidth)||.9,.3,3),x0=-W/2+(1-w/W)/2*W;
 return [{edge:'bottom',axis:'x',z:D/2,x0,x1:x0+w,w}];
}
export function careGeometry(p){
 validateCareProject(p);const {room,items}=p,profile=CARE_PROFILES[p.profile],failures=[];
 if(room.width<profile.turning||room.depth<profile.turning)failures.push({rule:'turning',message:'房間未能容納中央1.5m迴轉區。'});
 if(!Array.isArray(p.doors)||!p.doors.length){
  if(p.doorWidth<profile.door)failures.push({rule:'door',message:`入口淨寬${p.doorWidth.toFixed(2)}m，低於本方案${profile.door}m目標。`});
 }else{
  for(const d of doorList(p))if(d.w<profile.door)failures.push({rule:'door',edge:d.edge,message:`${d.edge}牆的門淨寬${d.w.toFixed(2)}m，低於本方案${profile.door}m目標。`});
 }
 for(const i of items){const b=itemBounds(i);if(Math.abs(i.x)+b.w/2>room.width/2+.001||Math.abs(i.z)+b.d/2>room.depth/2+.001)failures.push({rule:'bounds',id:i.id,message:i.name+'超出房間邊界。'});
  if(i.h>room.height)failures.push({rule:'height',id:i.id,message:i.name+'高於房間層高。'});
  // Central strip and circular turning zone are explicit conservative design reservations.
  if(i.role!=='surface'&&Math.abs(i.x)-b.w/2<profile.corridor/2-.001)failures.push({rule:'corridor',id:i.id,message:i.name+'佔用中央連續通道。'});
  if(i.role!=='surface'&&pointClearance([0,0],i)<profile.turning/2-.001)failures.push({rule:'turning',id:i.id,message:i.name+'佔用中央1.5m迴轉區。'});
 }
	// 門扇開合區：每一道門各自算。門向房內開 90°，半徑取門寬——門板長度等於
	// 門洞淨寬，掃過的就是以鉸鏈為心的四分之一圓。鉸鏈可能在門洞任一側，
	// 兩種都算（保守取聯集）。同一件家具擋到多道門只報一次。
	{
		const blocking = new Map();
		for (const d of doorList(p)) {
			const hinges = d.axis === 'x' ? [[d.x0, d.z], [d.x1, d.z]] : [[d.x, d.z0], [d.x, d.z1]];
			for (const [hx, hz] of hinges) for (const i of items) {
				if (i.role === 'surface') continue;
				if (!blocking.has(i.id) && pointClearance([hx, hz], i) < d.w - .001) blocking.set(i.id, d.w);
			}
		}
		for (const [id, w] of blocking) {
			const i = items.find(x => x.id === id);
			failures.push({ rule: 'door-swing', id, message: i.name + '位於門扇開合範圍內（門寬' + w.toFixed(2) + 'm、向房內開90°），開門時會撞到。' });
		}
	}
 for(const pair of careCollisions(items))failures.push({rule:'collision',message:'家具占地重疊，請移動或減少家具。',pair});
 return {ok:!failures.length,failures,profile,scope:'矩形包絡／中央通道與迴轉區／門扇開合區／邊界及家具碰撞；非全屋法定認證',rulesVersion:CARE_RULES_VERSION};
}
export function careReview(p){const geometry=careGeometry(p),pending=FIELD_CHECKS.filter(([id])=>p.fieldChecks?.[id]!==true).map(([id,label])=>({id,label}));for(const r of CARE_DATA.sheets[0].records)if(p.fieldChecks?.[r.id]!==true)pending.push({id:r.id,label:r.fields['指标项']+'：需現場核對原表參考及適用性'});if(!p.doorConfirmed)pending.unshift({id:'door-confirmation',label:'確認畫面下方中央入口的位置及實測淨寬'});if(p.room.source==='demo')pending.unshift({id:'measurement',label:'示範房間需以真實測量取代'});if(p.room.measurement?.geometry==='wall-aligned-bounding-rectangle')pending.unshift({id:'irregular-room',label:'RoomPlan包絡矩形內的不規則／凹位須另行核對'});if(p.items.some(i=>i.dimensionSource!=='user-confirmed'))pending.push({id:'furniture-dimensions',label:'所有家具示意尺寸需實物覆核'});const unplaced=remainingRequestedItems(p);if(unplaced.length)pending.push({id:'unplaced-products',label:unplaced.length+'件所選產品尚未放入空間'});return {...geometry,pending,status:!geometry.ok?'blocked':pending.length?'review-required':'checks-recorded',certified:false};}
export function newCareProject(room={width:6,depth:4.5,height:2.7,source:'demo'},name='我的樂齡空間'){return {format:CARE_VERSION,id:crypto.randomUUID(),name,room,profile:'wheelchair',purpose:'living',style:'warm',doorWidth:.9,doorConfirmed:false,items:[],fieldChecks:{},updatedAt:new Date().toISOString()};}
export const SAMPLE_ITEMS=[{type:'chair',name:'扶手座椅',w:.7,d:.72,h:.95,color:'#c7b29a'},{type:'cabinet',name:'可及收納櫃',w:1.2,d:.4,h:.8,color:'#a59176'},{type:'bed',name:'睡床',w:1.1,d:2,h:.65,color:'#d7cdbb'}];
export function placeCareItem(project,raw,index=project.items.length){
 validateCareProject(project);if(project.items.length>=40)return null;
 if(!raw||!['w','d','h'].every(k=>Number.isFinite(raw[k])&&raw[k]>0&&raw[k]<=8))return null;
 const item={...raw,id:raw.id||crypto.randomUUID(),name:String(raw.name||'候選家具').slice(0,100),color:/^#[a-f0-9]{6}$/i.test(raw.color)?raw.color:'#b5aaa0',dimensionSource:raw.dimensionSource||'concept',x:0,z:0,rotation:0};
 validateCareProject({...project,items:[...project.items,item]});
 if(['x','z','rotation'].every(k=>Number.isFinite(raw[k]))){const preferred={...item,x:raw.x,z:raw.z,rotation:raw.rotation};if(careGeometry({...project,items:[...project.items,preferred]}).ok)return preferred;}
 for(const side of (index%2?[-1,1]:[1,-1])){for(const rotation of [side===1?90:270,0,180,side===1?270:90]){const b=itemBounds({...item,rotation});const x=side*(project.room.width/2-b.w/2-.03);for(let z=-project.room.depth/2+b.d/2+.03;z<=project.room.depth/2-b.d/2;z+=.2){const attempt={...item,x,z,rotation};if(careGeometry({...project,items:[...project.items,attempt]}).ok)return attempt;}}}
 return null;
}
export function safeCareLayout(project,proposal=[]){
 validateCareProject(project);const p={...project,items:[]},skipped=[];
 const candidates=proposal.length?proposal:SAMPLE_ITEMS;
 for(const [index,raw] of candidates.slice(0,40).entries()){
  let found;try{found=placeCareItem(p,raw,index);}catch{}
  if(found)p.items.push(found);else skipped.push(String(raw?.name||'無效候選家具'));
 }
 return {items:p.items,skipped,review:careReview(p),description:'沿牆配置，保留中央連續通道與1.5m迴轉區；超出空間的家具不加入。'};
}
export function careExport(p){validateCareProject(p);return {...p,unplaced:remainingRequestedItems(p),updatedAt:new Date().toISOString(),review:careReview(p),units:'m',coordinateSystem:'right-handed-y-up',origin:'floor-center',rotationConvention:'degrees; local front +z; clockwise plan rotation',doorLocation:(Array.isArray(p.doors)&&p.doors.length)?'imported-from-floorplan-verify-on-site':'bottom-center-confirm-on-site'};}
