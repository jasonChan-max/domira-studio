import {HOME_KINDS,validateHome} from './home-domain.js';
import {newCareProject,validateCareProject,careReview} from './care-domain.js';
import {ALL_CARE_PRODUCTS} from './care-catalog.js';
import {validateBrief} from './care-brief.js';
export const HK_SOURCE='https://www.censtatd.gov.hk/en/data/stat_report/product/B1120118/att/B11201182021XXXXB0100.pdf';
export function hkCareHome(){
 const w=6.4,d=6.40625,top=3.8,bottom=d-top;
 const room=(id,name,kind,width,depth,x,z)=>({id,name,kind,purpose:kind==='bedroom'?'bedroom':'living',width,depth,height:2.7,x,z,items:[],openings:[],confidence:'low',notes:'展示假設，非統計戶型或實測門位'});
 const home={format:'domira.home.v1',width:w,depth:d,height:2.7,source:'hk-elderly-demo',scaleConfirmed:false,rooms:[room('living','起居／用餐','living',3.6,top,-1.4,-d/2+top/2),room('bedroom','睡房','bedroom',2.8,top,1.8,-d/2+top/2),room('kitchen','廚房','kitchen',2.1,bottom,-2.15,d/2-bottom/2),room('hall','玄關／通道','hall',2.2,bottom,0,d/2-bottom/2),room('bathroom','浴室','bathroom',2.1,bottom,2.15,d/2-bottom/2)],warnings:['41㎡是2021年含65歲以上長者住戶居所面積中位數，不是平均值。','房間比例、2.7m層高及門位並非統計數據；不代表真實物業或全屋無障礙合規。'],summary:'以41㎡統計面積作展示基準，矩形房間淨面積相加41㎡；牆厚不額外計入。'};
 const door=(edge,offset,width)=>({kind:'door',edge,offset,width});
 home.rooms[0].openings=[door('bottom',2.65/3.6,.9/3.6),door('right',2.25/3.8,.9/3.8)];home.rooms[1].openings=[door('left',2.25/3.8,.9/3.8)];home.rooms[2].openings=[door('right',.45/bottom,.9/bottom)];home.rooms[3].openings=[door('top',.55/2.2,.9/2.2),door('left',.45/bottom,.9/bottom),door('right',.45/bottom,.9/bottom),door('bottom',.65/2.2,.9/2.2)];home.rooms[4].openings=[door('left',.45/bottom,.9/bottom)];
 return validateHome(home);
}
export function roomCareProject(home,room){
 const purpose=['bedroom','dining'].includes(room.kind)?room.kind:'living';
 return {...newCareProject({width:room.width,depth:room.depth,height:room.height,source:home.source==='hk-elderly-demo'?'demo':'manual-guided',units:'m',planRoom:{name:room.name,kind:room.kind,openings:room.openings||[],polygon:room.polygon}},room.name),purpose};
}

export const canPlanCareRoom=room=>[room.width,room.depth].every(value=>value>=2&&value<=15);

export function createManualCareHome(dimensions,entries){
 const {width,depth,height}=dimensions;
 const rooms=entries.map((entry,index)=>{
  const {name,kind,left,top,width:roomWidth,depth:roomDepth}=entry;
  if(!name?.trim()||!Object.hasOwn(HOME_KINDS,kind)||![left,top,roomWidth,roomDepth].every(Number.isFinite))throw Error(`請填妥第 ${index+1} 個房間。`);
  if(left<0||top<0||left+roomWidth>width+1e-8||top+roomDepth>depth+1e-8)throw Error(name+' 超出全屋範圍。');
  return {id:`manual-${index+1}`,name:name.trim(),kind,purpose:kind,width:roomWidth,depth:roomDepth,height,
   x:left+roomWidth/2-width/2,z:top+roomDepth/2-depth/2,items:[],openings:[]};
 });
 for(const [index,a] of rooms.entries())for(const b of rooms.slice(index+1)){
  if((a.width+b.width)/2-Math.abs(a.x-b.x)>1e-8&&(a.depth+b.depth)/2-Math.abs(a.z-b.z)>1e-8)throw Error(a.name+' 與 '+b.name+' 重疊。');
 }
 if(!rooms.some(canPlanCareRoom))throw Error('至少需要一間長寬均為 2–15 m 的可規劃房間。');
 return validateHome({format:'domira.home.v1',width,depth,height,source:'care-manual',scaleConfirmed:false,rooms});
}

export function careRoomAssignments(home,brief,overrides={}){
 const rooms=home.rooms.filter(canPlanCareRoom);
 const allocations={};
 for(const selection of brief.selections){
  const {productId}=selection,product=ALL_CARE_PRODUCTS.find(p=>p.productId===productId);
  const kinds=product?.type==='bed'||product?.careKind==='pillbox'?['bedroom']:
   ['stool','shower','folding','swivel','commode','toilet','rail','surface'].includes(product?.careKind)?['bathroom']:
   product?.type==='dining'?['dining','living']:['living','dining'];
  const chosen=rooms.find(room=>room.id===overrides?.[productId]);
  const recommended=kinds.map(kind=>rooms.find(room=>room.kind===kind)).find(Boolean);
  allocations[productId]=(chosen||recommended||rooms[0])?.id;
 }
 return allocations;
}
export function validateCareWhole(whole){if(!whole||whole.format!=='domira.care.home.v1')throw Error('全屋格式不正確');validateHome(whole.home);if(whole.brief)validateBrief(whole.brief);if(!whole.home.rooms.some(r=>r.id===whole.activeRoomId))throw Error('目前房間不存在');for(const r of whole.home.rooms){const p=whole.projects[r.id];if(p){validateCareProject(p);if(Math.abs(p.room.width-r.width)>.001||Math.abs(p.room.depth-r.depth)>.001)throw Error('房間尺寸不一致');}}return whole;}
export function wholeReview(whole){return whole.home.rooms.map(r=>({id:r.id,name:r.name,area:r.width*r.depth,review:whole.projects[r.id]?careReview(whole.projects[r.id]):null}));}
