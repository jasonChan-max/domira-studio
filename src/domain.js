export const CATALOG={sofa:{name:'雲朵雙人沙發',en:'Cloud sofa',w:2.3,d:.94,h:.78,color:'#bcb5a4',category:'沙發'},chair:{name:'弧形休閒椅',en:'Arc lounge chair',w:.82,d:.85,h:.8,color:'#9b7859',category:'座椅'},table:{name:'原木圓角茶几',en:'Pebble coffee table',w:1.25,d:.7,h:.38,color:'#69513a',category:'桌几'},plant:{name:'琴葉榕',en:'Fiddle-leaf fig',w:.64,d:.64,h:1.65,color:'#55705b',category:'植栽'},lamp:{name:'弧光落地燈',en:'Halo floor lamp',w:.5,d:.5,h:1.8,color:'#d2c4a0',category:'燈具'},wardrobe:{name:'雙門衣櫃',en:'Wardrobe',w:1.6,d:.6,h:2,color:'#b9a888',category:'收納'},rug:{name:'羊毛編織地毯',en:'Woven wool rug',w:3.3,d:2.5,h:.015,color:'#c7c2b3',category:'地毯'}};
export function validateRoom(room){const plan=room?.source==='floorplan-room',whole=room?.source==='floorplan-home',min=plan?.6:2,max=plan?20:whole?40:15;if(!room||!['width','depth','height'].every(k=>Number.isFinite(room[k])&&room[k]>=(k==='height'?2:min)&&room[k]<=(k==='height'?6:max)))throw new Error(plan?'圖紙房間長寬需為 0.6–20 公尺，層高 2–6 公尺。':'房間長寬需為 2–15 公尺，層高需為 2–6 公尺。');return room;}
Object.assign(CATALOG,{
 bed:{name:'低台雙人床',en:'Platform bed',w:1.6,d:2.1,h:.85,color:'#b4a38a',category:'睡床'},
 desk:{name:'橡木書桌',en:'Writing desk',w:1.2,d:.6,h:.75,color:'#b3946a',category:'書桌'},
 cabinet:{name:'木紋收納櫃',en:'Sideboard',w:1.2,d:.4,h:.8,color:'#a58b68',category:'收納櫃'},
 bookshelf:{name:'開放書架',en:'Bookcase',w:.8,d:.3,h:1.8,color:'#ac956f',category:'書架'},
 dining:{name:'四人餐桌',en:'Dining table',w:1.4,d:.8,h:.75,color:'#b49c73',category:'餐桌'},
 stool:{name:'圓木凳',en:'Stool',w:.42,d:.42,h:.45,color:'#a38c66',category:'凳子'}
});
export const MODEL_STYLES={sofa:['cloud','timber','channel','armless'],chair:['arc','cantilever','lounge'],table:['oval','rect','pedestal'],lamp:['arc','tripod','column'],rug:['woven','plush','border'],plant:['fig','olive','palm'],bed:['platform','upholstered','canopy'],desk:['writing','trestle','executive'],cabinet:['low','fluted','tall'],bookshelf:['open','ladder','grid'],dining:['rect','round','extendable'],stool:['round','saddle','upholstered','tubular']};
export function itemBounds(item){const a=item.rotation*Math.PI/180,c=Math.abs(Math.cos(a)),s=Math.abs(Math.sin(a));return {w:item.w*c+item.d*s,d:item.w*s+item.d*c};}
export function clampItem(item,room){const b=itemBounds(item),clampAxis=(v,lo,hi)=>lo>hi?0:Math.max(lo,Math.min(hi,v));return {...item,x:clampAxis(item.x,-room.width/2+b.w/2,room.width/2-b.w/2),z:clampAxis(item.z,-room.depth/2+b.d/2,room.depth/2-b.d/2)};}
export const ITEM_SIZE_LIMITS={min:.2,max:6};
export function clampItemSize(item){const c=(v,lo,hi)=>Math.max(lo,Math.min(hi,Number.isFinite(+v)?+v:lo));return {...item,w:c(item.w,ITEM_SIZE_LIMITS.min,ITEM_SIZE_LIMITS.max),d:c(item.d,ITEM_SIZE_LIMITS.min,ITEM_SIZE_LIMITS.max),h:c(item.h,.005,ITEM_SIZE_LIMITS.max)};}
// 拉伸：把地面交點換算成家具局部軸向的半徑，回傳要套用的尺寸增量。
// 中心固定（兩側對稱擴張）；拖過中心不會翻面，因為取絕對值。
export function stretchPatch(item,point,axis){const a=-item.rotation*Math.PI/180,cos=Math.cos(a),sin=Math.sin(a),dx=point.x-item.x,dz=point.z-item.z,lx=dx*cos-dz*sin,lz=dx*sin+dz*cos,size=Math.max(ITEM_SIZE_LIMITS.min,Math.abs(axis==='w'?lx:lz)*2);return axis==='w'?{w:size}:{d:size};}
export function collisions(items){const out=[];for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){const a=items[i],b=items[j];if(a.type==='rug'||b.type==='rug')continue;const aa=itemBounds(a),bb=itemBounds(b);if(Math.abs(a.x-b.x)<(aa.w+bb.w)/2-.04&&Math.abs(a.z-b.z)<(aa.d+bb.d)/2-.04)out.push([a.id,b.id]);}return out;}

// Persisted rotations match furniture.js / SVG / AR: 0=+Z, 90=-X, 180=-Z, 270=+X.
// Apply only to newly generated layouts, never to a user's manual transforms.
export function furnitureFront(rotation){const a=rotation*Math.PI/180;return {x:-Math.sin(a),z:Math.cos(a)};}
export function rotationToward(item,target){return orientationAngle(Math.atan2(-(target.x-item.x),target.z-item.z)*180/Math.PI);}
const orientationAngle=a=>((a%360)+360)%360;
const orientationDifference=(a,b)=>Math.abs(((a-b+540)%360)-180);
const orientationRoles=new Set(['sofa','chair','bed','desk','cabinet','bookshelf']);
const orientationWallRoles=new Set(['bed','desk','cabinet','bookshelf']);
export function layoutOpenings(room){return (Array.isArray(room?.planRoom?.openings)?room.planRoom.openings:[]).slice(0,12).filter(o=>o&&['top','right','bottom','left'].includes(o.edge)&&['door','window'].includes(o.kind)&&Number.isFinite(o.offset)&&Number.isFinite(o.width)&&o.offset>=0&&o.width>=.03&&o.offset+o.width<=1.001).map(o=>({kind:o.kind,edge:o.edge,offset:o.offset,width:o.width}));}
function orientationZones(room){return layoutOpenings(room).map(o=>{const horizontal=['top','bottom'].includes(o.edge),length=horizontal?room.width:room.depth,along=(o.offset+o.width/2-.5)*length,reach=o.kind==='door'?.8:.25;return {...o,id:'opening-'+o.edge+'-'+o.offset,type:'opening',x:horizontal?along:(o.edge==='left'?-1:1)*(room.width/2-reach/2),z:horizontal?(o.edge==='top'?-1:1)*(room.depth/2-reach/2):along,w:horizontal?o.width*length+.12:reach,d:horizontal?reach:o.width*length+.12,rotation:0};});}
function orientationOverlap(a,b){const aa=itemBounds(a),bb=itemBounds(b);return Math.abs(a.x-b.x)<(aa.w+bb.w)/2-.015&&Math.abs(a.z-b.z)<(aa.d+bb.d)/2-.015;}
function orientationWallOptions(room){return [{rotation:0,axis:'z',value:-room.depth/2,sign:1},{rotation:90,axis:'x',value:room.width/2,sign:-1},{rotation:180,axis:'z',value:room.depth/2,sign:-1},{rotation:270,axis:'x',value:-room.width/2,sign:1}];}
function orientationFrontDistance(item,room){const f=furnitureFront(item.rotation),start={x:item.x+f.x*item.d/2,z:item.z+f.z*item.d/2};const distances=[];if(Math.abs(f.x)>.0001)distances.push(((f.x>0?room.width/2:-room.width/2)-start.x)/f.x);if(Math.abs(f.z)>.0001)distances.push(((f.z>0?room.depth/2:-room.depth/2)-start.z)/f.z);return Math.min(...distances);}
function orientationFrontZone(item){const f=furnitureFront(item.rotation),reach=item.type==='bed'?.55:.45;return {id:item.id+'-access',type:'access',x:item.x+f.x*(item.d/2+reach/2),z:item.z+f.z*(item.d/2+reach/2),w:Math.min(item.w,.65),d:reach,rotation:item.rotation};}
function orientationTarget(item,items,purpose){
 const nearest=types=>items.filter(i=>i.id!==item.id&&types.includes(i.type)).sort((a,b)=>Math.hypot(a.x-item.x,a.z-item.z)-Math.hypot(b.x-item.x,b.z-item.z))[0];
 if(item.type==='sofa')return nearest(['table'])||nearest(['sofa','chair'])||{x:0,z:0,type:'center'};
 if(item.type==='chair'){
  const desk=nearest(['desk']),dining=nearest(['dining']),table=nearest(['table']);
  if(purpose==='work'&&desk)return desk;
  if(purpose==='dining'&&dining)return dining;
  if(desk&&Math.hypot(desk.x-item.x,desk.z-item.z)<1.8&&(!table||Math.hypot(desk.x-item.x,desk.z-item.z)<Math.hypot(table.x-item.x,table.z-item.z)))return desk;
  return table||dining||desk||nearest(['sofa','chair'])||{x:0,z:0,type:'center'};
 }
 return null;
}
function orientationCandidateValid(item,others,room,zones){
 const b=itemBounds(item);
 if(b.w>room.width-.01||b.d>room.depth-.01||Math.abs(item.x)+b.w/2>room.width/2+.001||Math.abs(item.z)+b.d/2>room.depth/2+.001)return false;
 if(item.type!=='rug'&&others.some(o=>o.type!=='rug'&&orientationOverlap(item,o)))return false;
 if(item.type!=='rug'&&zones.some(o=>(o.kind==='door'||item.h>1.2)&&orientationOverlap(item,o)))return false;
 return !orientationRoles.has(item.type)||orientationFrontDistance(item,room)>=.48;
}
function orientationCandidateScore(item,base,items,room,purpose){
 const movement=Math.hypot(item.x-base.x,item.z-base.z);let score=movement*3+orientationDifference(item.rotation,base.rotation)*.002;
 const target=orientationTarget(item,items,purpose);
 if(target&&Math.hypot(target.x-item.x,target.z-item.z)>.1){
  const error=orientationDifference(item.rotation,rotationToward(item,target));score+=Math.pow(Math.max(0,error-12)/35,2)*10;
 }
 if(orientationWallRoles.has(item.type)){
  const wall=orientationWallOptions(room).find(w=>w.rotation===item.rotation);
  if(!wall)return Infinity;
  const gap=Math.abs(item[wall.axis]-wall.value)-item.d/2;
  score+=Math.abs(gap-.06)*(item.type==='bed'?13:9);
 }
 if(orientationRoles.has(item.type)){
  const access=orientationFrontZone(item);
  score+=items.filter(o=>o.id!==item.id&&o.type!=='rug'&&orientationOverlap(access,o)).length*12;
 }
 // Keep lamps/greenery out of other furniture's usable front strip when feasible.
 if(!['rug','table','dining'].includes(item.type))for(const other of items){if(other.id!==item.id&&orientationRoles.has(other.type)&&orientationOverlap(item,orientationFrontZone(other)))score+=6;}
 return score;
}
export function refineLayoutOrientation(input,room,{purpose='living',strict=true}={}){
 const items=input.map(i=>({...i,rotation:orientationAngle(i.rotation)})),original=input.map(i=>({...i})),zones=orientationZones(room);
 const priority={bed:0,desk:1,cabinet:2,bookshelf:3,dining:4,table:5,sofa:6,chair:7,lamp:8,plant:9,rug:10,stool:11};
 const ordered=items.map((_,i)=>i).sort((a,b)=>(priority[items[a].type]??12)-(priority[items[b].type]??12)||String(items[a].id).localeCompare(String(items[b].id)));
 for(let pass=0;pass<2;pass++)for(const index of ordered){
  const base=original[index],current=items[index],others=items.filter(i=>i.id!==current.id),target=orientationTarget(current,items,purpose);
  let angles=orientationWallRoles.has(current.type)?[0,90,180,270]:[current.rotation];
  if(['sofa','chair'].includes(current.type)){
   const desired=target?rotationToward(current,target):current.rotation;
   angles=[desired,desired-15,desired+15,current.rotation,0,90,180,270];
  }
  let best=null,bestScore=Infinity;const seen=new Set();
  const evaluate=candidate=>{
   const b=itemBounds(candidate);if(b.w>room.width-.01||b.d>room.depth-.01)return;
   candidate={...candidate,x:Math.max(-room.width/2+b.w/2+.005,Math.min(room.width/2-b.w/2-.005,candidate.x)),z:Math.max(-room.depth/2+b.d/2+.005,Math.min(room.depth/2-b.d/2-.005,candidate.z))};
   const key=[candidate.rotation,candidate.x.toFixed(3),candidate.z.toFixed(3)].join(':');if(seen.has(key))return;seen.add(key);
   if(!orientationCandidateValid(candidate,others,room,zones))return;
   const focus=orientationTarget(candidate,items,purpose);
   if(focus&&Math.hypot(focus.x-candidate.x,focus.z-candidate.z)>.1&&orientationDifference(candidate.rotation,rotationToward(candidate,focus))>65)return;
   if(candidate.type==='chair'&&focus?.type==='desk'){
    const front=furnitureFront(focus.rotation),side=(candidate.x-focus.x)*front.x+(candidate.z-focus.z)*front.z;
    if(side<focus.d/2+.1)return;
   }
   const score=orientationCandidateScore(candidate,base,items,room,purpose);
   if(score<bestScore-.00001){best=candidate;bestScore=score;}
  };
  for(const angle of [...new Set(angles.map(orientationAngle))]){
   const candidate={...current,rotation:angle};evaluate(candidate);
   // Small local translations accommodate the changed footprint, not just a new yaw.
   for(const amount of [.2,.45,.8])for(const [dx,dz] of [[amount,0],[-amount,0],[0,amount],[0,-amount]])evaluate({...candidate,x:current.x+dx,z:current.z+dz});
   if(orientationWallRoles.has(current.type)){
    const wall=orientationWallOptions(room).find(w=>w.rotation===angle),axis=wall.axis,along=axis==='x'?'z':'x';
    const anchored={...candidate,[axis]:wall.value+wall.sign*(candidate.d/2+.06)};
    for(const offset of [0,.35,-.35,.7,-.7,1.4,-1.4])evaluate({...anchored,[along]:current[along]+offset});
   }
  }
  if(current.type==='chair'&&target&&['desk','dining'].includes(target.type)){
   const directions=target.type==='desk'?[target.rotation]:[0,90,180,270];
   for(const direction of directions){
    const f=furnitureFront(direction),targetExtent=Math.abs(f.x)*itemBounds(target).w/2+Math.abs(f.z)*itemBounds(target).d/2;
    for(const extra of [.15,.35,.6]){
     const distance=targetExtent+current.d/2+extra,position={x:target.x+f.x*distance,z:target.z+f.z*distance};
     for(const lateral of [0,-.35,.35]){const c={...current,x:position.x+f.z*lateral,z:position.z-f.x*lateral};c.rotation=rotationToward(c,target);evaluate(c);}
    }
   }
  }
  if(best)items[index]=best;
  else if(strict)throw new Error('家具朝向或門前空間無法安全安排，原設計已保留；請減少家具後重試。');
 }
 const hints=items.filter(i=>orientationRoles.has(i.type)).map(item=>{
  const target=orientationTarget(item,items,purpose),targetName={table:'茶几',dining:'餐桌',desk:'書桌',sofa:'沙發',chair:'交流座位',center:'室內活動區'}[target?.type];
  const error=target?orientationDifference(item.rotation,rotationToward(item,target)):0;
  const wall=orientationWallRoles.has(item.type)?orientationWallOptions(room).find(w=>w.rotation===item.rotation):null;
  const backGap=wall?Math.abs(item[wall.axis]-wall.value)-item.d/2:0;
  const needsReview=(target&&error>40)||orientationFrontDistance(item,room)<.48||backGap>.35;
  return {itemId:item.id,rotation:Math.round(item.rotation*10)/10,reason:needsReview?'空間較緊，請再核對家具朝向、靠牆位置與前方使用空間。':item.type==='bed'?'床頭朝向牆面，床尾保留使用空間。':orientationWallRoles.has(item.type)?'背面朝向牆側，正面朝室內，保留取用空間。':`正面朝向${targetName||'室內活動區'}，避免座位背對使用區。`,needsReview:!!needsReview};
 });
 const adjusted=items.filter((item,i)=>orientationDifference(item.rotation,original[i].rotation)>1||Math.hypot(item.x-original[i].x,item.z-original[i].z)>.02).length;
 if(strict&&(collisions(items).length||items.some(i=>!orientationCandidateValid(i,items.filter(o=>o.id!==i.id),room,zones))))throw new Error('調整朝向後空間不足，原設計已保留；請減少家具後重試。');
 return {items,adjusted,hints,openingCount:layoutOpenings(room).length,warnings:hints.filter(h=>h.needsReview).map(h=>h.reason)};
}

function wallSegment(room,item){const b=itemBounds(item),eps=.15;if(item.z-b.d/2<=-room.depth/2+eps)return {edge:'top',along:item.x};if(item.z+b.d/2>=room.depth/2-eps)return {edge:'bottom',along:item.x};if(item.x-b.w/2<=-room.width/2+eps)return {edge:'left',along:item.z};if(item.x+b.w/2>=room.width/2-eps)return {edge:'right',along:item.z};return null;}
function wallFree(room,edge,along){const wallLen=['top','bottom'].includes(edge)?room.width:room.depth,cuts=layoutOpenings(room).filter(o=>o.edge===edge).map(o=>{const a=(o.offset-.5)*wallLen,b=a+o.width*wallLen;return a<b?[a,b]:[b,a];}).sort((p,q)=>p[0]-q[0]);let lo=-wallLen/2,hi=wallLen/2;for(const [a,b] of cuts){if(along>=a&&along<=b)return 0;if(along>b)lo=Math.max(lo,b);else hi=Math.min(hi,a);}return Math.max(0,hi-lo);}
// 貼合模式（塞凹位）：把超出房間邊界、或超出所靠牆段可用長度的家具，沿超出方向縮到剛好，標 desired。
// 只縮不放。拉大只是換一組數字，縮小才對應「這面牆被門切掉之後只剩多少」的真實約束。
export function fitItemsToRoom(items,room,{margin=.05,minRatio=.55}={}){const limitW=Math.max(.2,room.width-margin*2),limitD=Math.max(.2,room.depth-margin*2);return items.map(item=>{let w=item.w,d=item.d;const b0=itemBounds({...item,w,d}),alongX=Math.abs(Math.cos(item.rotation*Math.PI/180))>=Math.abs(Math.sin(item.rotation*Math.PI/180));if(b0.w>limitW){const s=limitW/b0.w;if(alongX)w*=s;else d*=s;}if(b0.d>limitD){const s=limitD/b0.d;if(alongX)d*=s;else w*=s;}const probe={...item,w,d},wall=wallSegment(room,probe);if(wall){const free=wallFree(room,wall.edge,wall.along),alongW=['top','bottom'].includes(wall.edge),cur=alongW?itemBounds(probe).w:itemBounds(probe).d;if(free>=.4&&cur>free){const s=free/cur;if(alongW)w*=s;else d*=s;}}const ratio=Math.min(w/item.w,d/item.d),extreme=ratio<minRatio,shrunk=ratio<.999;if(!shrunk)return clampItem({...item},room);return clampItem({...item,w,d,desired:true,fitNote:extreme?`已縮至極限（約 ${Math.round(ratio*100)}%），實際需定制`:`已縮至貼合空間（目錄尺寸 ${item.w.toFixed(2)}×${item.d.toFixed(2)} m）`},room);});}
export function generateLayout(room,style='warm',variant=0,options={}){validateRoom(room);const w=room.width/2,d=room.depth/2,prefs=options.preferences||['daylight','flow','green'];let specs=[['rug',0,.05,0],['sofa',0,-d+.68,0],['table',0,-d+2,0],['chair',w-.7,.15,variant%2?0:-25],['plant',-w+.5,-d+.5,0],['lamp',w-.5,-d+.5,0]];
 if(!prefs.includes('flow'))specs[2][2]-=.25;
 if(options.purpose==='reading'){specs[1]=['chair',-.75,-d+.8,20];specs[3]=['chair',.75,-d+.8,-20];specs[2][2]=-d+2.05;}
 if(options.purpose==='social'){specs[3][1]=-w+.7;specs[3][2]=.55;specs[3][3]=25;}
 if(options.purpose==='bedroom'){specs=[['rug',0,.05,0],['bed',-w+.78,-d+1.05,0],['wardrobe',0,d-.35,0],['lamp',w-.32,-d+.32,0]];}
 if(options.purpose==='work'){specs=[['rug',0,.05,0],['desk',0,-d+.4,0],['chair',0,-d+1.15,180],['plant',-w+.5,d-.5,0],['lamp',w-.45,d-.45,0]];}
 if(options.purpose==='dining'){specs=[['rug',0,.05,0],['table',0,0,0],['chair',-w+.75,-.55,90],['chair',w-.75,-.55,270],['lamp',w-.4,-d+.35,0]];}
 const chairSpec=specs.find(s=>s[0]==='chair');
 if(!prefs.includes('daylight')&&chairSpec)chairSpec[3]=0;
 const items=[];for(let i=0;i<specs.length;i++){const [type,x,z,rotation]=specs[i];if(type==='plant'&&!prefs.includes('green'))continue;if(type!=='rug'&&(CATALOG[type].w>room.width||CATALOG[type].d>room.depth)&&!options.fitted)continue;let item=clampItem({id:'item-'+i,type,...CATALOG[type],x,z,rotation},room);if(type==='rug'){item.w=Math.min(item.w,room.width-.4);item.d=Math.min(item.d,room.depth-.4);item=clampItem(item,room);}if(collisions([...items,item]).length){const b=itemBounds(item);const candidates=[];const nx=Math.ceil((room.width-b.w-.06)/.12),nz=Math.ceil((room.depth-b.d-.06)/.12);for(let ix=0;ix<=nx;ix++)for(let iz=0;iz<=nz;iz++)candidates.push({...item,x:-w+b.w/2+.03+(room.width-b.w-.06)*ix/nx,z:-d+b.d/2+.03+(room.depth-b.d-.06)*iz/nz});candidates.sort((a,b)=>Math.hypot(a.x-x,a.z-z)-Math.hypot(b.x-x,b.z-z));const fit=candidates.find(c=>!collisions([...items,c]).length);if(!fit)continue;item=fit;}items.push(item);}
 if(style==='minimal'){for(const item of items){if(item.type==='sofa')item.color='#d2cfc6';if(item.type==='chair')item.color='#7b8583';}}if(style==='modern'){for(const item of items){if(item.type==='sofa')item.color='#788880';if(item.type==='rug')item.color='#a8afa7';}}
 const oriented=refineLayoutOrientation(items,room,{purpose:options.purpose,strict:false});
 const finalItems=options.fitted?fitItemsToRoom(oriented.items,room):oriented.items;
 return {items:finalItems,orientation:{adjusted:oriented.adjusted,hints:oriented.hints,openingCount:oriented.openingCount},engine:'local-rules',description:options.purpose==='reading'?'雙椅形成安靜的閱讀角落，茶几與照明保持觸手可及。':'以房間尺寸安排靠牆座位、中央交流區與角落照明，保留開放的前側動線。'};}
