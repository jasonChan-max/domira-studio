import {CATALOG,itemBounds,clampItem,clearanceMetrics} from './domain.js';
export const HOME_KINDS={living:'客廳',bedroom:'睡房',dining:'飯廳',work:'書房',kitchen:'廚房',bathroom:'浴室',hall:'走廊',balcony:'露台',other:'其他空間'};
export const HOME_COLORS={living:'#b7bca3',bedroom:'#a7b7bb',dining:'#c4b494',work:'#a9bba5',kitchen:'#c5baa6',bathroom:'#9dbab8',hall:'#b9b4a7',balcony:'#a4b99a',other:'#b3a8bb'};
const finiteHome=n=>Number.isFinite(n),roundHome=n=>Math.round(n*1000)/1000;
export function readPlanDimensions(raw) {
 const sideNames=['top','bottom','left','right'];
 const dimensions=Object.fromEntries(sideNames.map(side=>{
  const values=raw?.unit==='mm'?raw[side]:null;
  const valid=Array.isArray(values)&&values.length>0&&values.length<=12&&
   values.every(value=>Number.isFinite(value)&&value>=50&&value<=40000);
  return [side,valid?values.slice():null];
 }));
 const total=side=>{
  const value=dimensions[side]?.reduce((sum,n)=>sum+n,0)/1000;
  return value>=2&&value<=40?value:null;
 };
 const conflicts=[];
 const axis=(name,a,b)=>{
  const first=total(a),second=total(b);
  if(first&&second&&Math.abs(first-second)>Math.max(.1,Math.max(first,second)*.05)){
   conflicts.push(name);
   return null;
  }
  return first??second;
 };
 const width=axis('width','top','bottom'),depth=axis('depth','left','right');
 return {dimensions:{unit:'mm',...dimensions},width,depth,conflicts};
}
export function validatePlanAnalysis(raw){if(!raw||!Array.isArray(raw.rooms)||raw.rooms.length<1||raw.rooms.length>12)throw new Error('圖紙需辨識出 1–12 個空間；請裁切為單層平面圖。');
 const rawMax=Math.max(0,...raw.rooms.flatMap(r=>r&&r.rect?[Number(r.rect.x)+Number(r.rect.w),Number(r.rect.y)+Number(r.rect.h)]:[0]).filter(Number.isFinite));
 if(rawMax>1500){const k=1000/rawMax;raw={...raw,rooms:raw.rooms.map(r=>r&&r.rect?{...r,rect:{x:r.rect.x*k,y:r.rect.y*k,w:r.rect.w*k,h:r.rect.h*k},polygon:Array.isArray(r.polygon)?r.polygon.map(p=>[p[0]*k,p[1]*k]):r.polygon}:r)};}const ids=new Set();const rooms=raw.rooms.map((r,index)=>{const b=r.rect;if(!b||!['x','y','w','h'].every(k=>finiteHome(b[k]))||b.x<-.5||b.y<-.5||b.w<15||b.h<15||b.x+b.w>1002||b.y+b.h>1002)throw new Error('AI 房間位置格式不完整，請換一張清晰圖紙重試。');const id='space-'+index;ids.add(id);const openings=(Array.isArray(r.openings)?r.openings:[]).slice(0,12).filter(o=>['top','right','bottom','left'].includes(o.edge)&&['door','window'].includes(o.kind)&&finiteHome(o.offset)&&finiteHome(o.width)&&o.offset>=0&&o.width>=.03&&o.offset+o.width<=1.001).map(o=>({kind:o.kind,edge:o.edge,offset:roundHome(o.offset),width:roundHome(o.width)}));return {id,name:String(r.name||'空間 '+(index+1)).slice(0,40),kind:HOME_KINDS[r.kind]?r.kind:'other',rect:{x:Math.max(0,b.x),y:Math.max(0,b.y),w:Math.min(b.w,1000-b.x),h:Math.min(b.h,1000-b.y)},confidence:['high','medium','low'].includes(r.confidence)?r.confidence:'low',openings,polygon:(Array.isArray(r.polygon)?r.polygon:[]).slice(0,12).filter(p=>Array.isArray(p)&&p.length===2&&finiteHome(p[0])&&finiteHome(p[1])).map(p=>[Math.max(0,Math.min(1000,p[0])),Math.max(0,Math.min(1000,p[1]))]),adjacent:(Array.isArray(r.adjacent)?r.adjacent:[]).slice(0,10).filter(x=>x&&typeof x.to==='string'&&['top','right','bottom','left'].includes(x.edge)).map(x=>({to:String(x.to).slice(0,40),edge:x.edge,wall:x.wall!==false})),notes:String(r.notes||'').slice(0,160),area_sqm:finiteHome(r.area_sqm)&&r.area_sqm>=.5&&r.area_sqm<=200?roundHome(r.area_sqm):null,furniture:(Array.isArray(r.furniture)?r.furniture:[]).slice(0,30).filter(f=>f&&['sofa','bed','table','chair','cabinet','wardrobe','stove','sink','fridge','toilet','shower','tv','desk','other'].includes(f.kind)&&f.bbox&&['x','y','w','h'].every(k=>finiteHome(f.bbox[k]))).map(f=>({name:String(f.name||'').slice(0,30),kind:f.kind,bbox:{x:f.bbox.x,y:f.bbox.y,w:f.bbox.w,h:f.bbox.h},confidence:['high','medium','low'].includes(f.confidence)?f.confidence:'low'}))};});const left=Math.min(...rooms.map(r=>r.rect.x)),top=Math.min(...rooms.map(r=>r.rect.y)),right=Math.max(...rooms.map(r=>r.rect.x+r.rect.w)),bottom=Math.max(...rooms.map(r=>r.rect.y+r.rect.h));const span=Math.max(right-left,bottom-top)||1,unit=1000/span,frameW=(right-left)*unit,frameH=(bottom-top)*unit;for(const r of rooms){r.rect={x:Math.max(0,(r.rect.x-left)*unit+(1000-frameW)/2),y:Math.max(0,(r.rect.y-top)*unit+(1000-frameH)/2),w:r.rect.w*unit,h:r.rect.h*unit};}const dimensioned=raw.scale?.basis==='dimensioned',dim=key=>dimensioned&&finiteHome(raw.scale?.[key])&&raw.scale[key]>=2&&raw.scale[key]<=40?raw.scale[key]:null,read=readPlanDimensions(raw.dimensions),dg=Object.values(read.dimensions).some(Array.isArray)?read.dimensions:null,
 scale={width:read.width??(read.conflicts.includes('width')?null:dim('width')),depth:read.depth??(read.conflicts.includes('depth')?null:dim('depth')),basis:'unknown'};
 if(scale.width||scale.depth)scale.basis='dimensioned';const relationWarnings=(()=>{
  const out=[];
  if(rooms.length<2)return out;
  const xs=rooms.flatMap(r=>[r.rect.x,r.rect.x+r.rect.w]),ys=rooms.flatMap(r=>[r.rect.y,r.rect.y+r.rect.h]);
  const span=Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys),1),tol=span*.06;
  const near=(a,b)=>{const dx=Math.max(a.rect.x-(b.rect.x+b.rect.w),b.rect.x-(a.rect.x+a.rect.w),0),dz=Math.max(a.rect.y-(b.rect.y+b.rect.h),b.rect.y-(a.rect.y+a.rect.h),0);return Math.hypot(dx,dz)<=tol;};
  for(const room of rooms){
    for(const link of room.adjacent||[]){
      const target=rooms.find(r=>r.name===link.to)||rooms.find(r=>r.name.startsWith(link.to.slice(0,3)));
      if(!target){out.push('「'+room.name+'」說跟「'+link.to+'」共牆，但沒有這間房。');continue;}
      if(!near(room,target))out.push('「'+room.name+'」與「'+link.to+'」的矩形沒有相接（相差超過 '+Math.round(tol/10)/100+' m），AI 描述的相鄰關係與矩形不一致，需以關係為準重解。');
    }
  }
  return out.slice(0,6);
})();
const mergeWarnings=[...mergeSameNameRooms(rooms),...mergeOpenPlanRooms(rooms)];
 return {format:'domira.floorplan-analysis.v1',rooms,scale,dimensions:dg,dimensionConflicts:read.conflicts,frame:{w:right-left,h:bottom-top},summary:String(raw.summary||'請逐間核對 AI 辨識結果。').slice(0,500),warnings:[...(Array.isArray(raw.warnings)?raw.warnings:[]),...mergeWarnings,...relationWarnings].slice(0,8).map(s=>String(s).slice(0,200)),model:'deepseek-flash',engine:'remote-vision'};}
function resolveOverlaps(home){const rooms=home.rooms,hw=home.width/2,hd=home.depth/2,start=new Map(rooms.map(r=>[r.id,{x:r.x,z:r.z}]));for(let iter=0;iter<200;iter++){let worst=0;for(let i=0;i<rooms.length;i++)for(let j=i+1;j<rooms.length;j++){const a=rooms[i],b=rooms[j],ox=(a.width+b.width)/2-Math.abs(a.x-b.x),oz=(a.depth+b.depth)/2-Math.abs(a.z-b.z);if(ox<=.001||oz<=.001)continue;const s0=start.get(a.id),s1=start.get(b.id);if(s0&&(Math.abs(a.x-s0.x)>1||Math.abs(a.z-s0.z)>1))continue;if(s1&&(Math.abs(b.x-s1.x)>1||Math.abs(b.z-s1.z)>1))continue;if(Math.min(ox,oz)>.5)continue;worst=Math.max(worst,Math.min(ox,oz));const push=.6;if(ox<=oz){const s=(ox/2+.005)*push*(a.x>=b.x?1:-1);a.x+=s;b.x-=s;}else{const s=(oz/2+.005)*push*(a.z>=b.z?1:-1);a.z+=s;b.z-=s;}}for(const r of rooms){r.x=Math.min(hw-r.width/2,Math.max(-hw+r.width/2,r.x));r.z=Math.min(hd-r.depth/2,Math.max(-hd+r.depth/2,r.z));}if(worst<.01)break;}for(const r of rooms){r.x=roundHome(r.x);r.z=roundHome(r.z);}return home;}
export function homeFromAnalysis(analysis,width,depth,height=2.7,strict=true,options={}){const a=validatePlanAnalysis(analysis);const fu=1000/Math.max(a.frame?.w||1000,a.frame?.h||1000),FW=(a.frame?.w||1000)*fu,FH=(a.frame?.h||1000)*fu,OX=(1000-FW)/2,OY=(1000-FH)/2;const rooms=a.rooms.map(r=>({id:r.id,name:r.name,kind:r.kind,purpose:['bedroom','dining','work'].includes(r.kind)?r.kind:'living',x:roundHome(((r.rect.x+r.rect.w/2-OX)/FW-.5)*width),z:roundHome(((r.rect.y+r.rect.h/2-OY)/FH-.5)*depth),width:roundHome(r.rect.w/FW*width),depth:roundHome(r.rect.h/FH*depth),height:Number(height),confidence:r.confidence,notes:r.notes,openings:r.openings,adjacent:r.adjacent||[],area_sqm:r.area_sqm,polygon:(Array.isArray(r.polygon)&&r.polygon.length>=3?r.polygon.map(pt=>[roundHome((pt[0]-(r.rect.x+r.rect.w/2))/FW*width),roundHome((pt[1]-(r.rect.y+r.rect.h/2))/FH*depth)]):[]),items:[]}));const home={format:'domira.home.v1',width:Number(width),depth:Number(depth),height:Number(height),source:'ai-floorplan',model:analysis.model||'deepseek-flash',scaleConfirmed:true,summary:a.summary,warnings:[...(a.warnings||[])],rooms};const stages=options.stages||['overlap','area','separate'];
 const onStage=st=>stages.includes(st);
 const autofilled=autofillDoors(rooms);
 let corrected=0;if(options.correctArea!==false){if(onStage('overlap'))resolveOverlaps(home);if(onStage('dimsnap'))snapToDimensionLines(home,a.dimensions);if(onStage('sharedsnap'))snapSharedWalls(home);if(onStage('overlap'))resolveOverlaps(home);const byId=onStage('area')?new Map(a.rooms.map(r=>[r.id,r])):new Map(),areaSkipped=[];for(const room of rooms){const target=byId.get(room.id)?.area_sqm;if(!target||target<=0)continue;const rectArea=room.width*room.depth,err=Math.abs(rectArea-target)/target;if(err<=.08)continue;if(err>.25){areaSkipped.push(room.name);continue;}const ratio=Math.min(1.35,Math.max(.55,Math.sqrt(target/rectArea)));room.width=roundHome(room.width*ratio);room.depth=roundHome(room.depth*ratio);corrected++;}if(autofilled.length)home.warnings.push('以下房間原本沒有門，已依相鄰關係自動補上一道（位置在該牆 40% 處，可用門編輯器調整）：'+autofilled.join('、')+'。');
  if(areaSkipped.length)home.warnings.push('以下房間的矩形面積與圖上標註差超過 25%，已保留矩形尺寸（rect 可能含牆體或走道，硬縮會破壞相鄰關係），請人工核對：'+areaSkipped.join('、')+'。');
  if(corrected){if(onStage('overlap'))resolveOverlaps(home);if(onStage('sharedsnap'))snapSharedWalls(home);if(onStage('overlap'))resolveOverlaps(home);home.warnings.push('已用圖上標註面積校正 '+corrected+' 間房的尺寸（面積優先於 rect 比例，個別牆線可能偏移）；因標註面積是淨面積、牆體未計入，嚴格重疊檢查已跳過。');}}if(onStage('topology'))solveTopology(rooms,home);
 if(onStage('grid'))solveGrid(rooms,home);
 if(onStage('slices'))solveSlices(rooms,home);
 const shrunkRooms=onStage('separate')?forceSeparate(home):[];if(shrunkRooms.length)home.warnings.push('以下房間與其他房間重疊，已自動縮小以保證可以生成：'+shrunkRooms.join('、')+'。請對照原圖核對尺寸。');return strict&&!corrected?validateHome(home):home;}
export function validateHome(home){if(!home||home.format!=='domira.home.v1'||!['width','depth','height'].every(k=>finiteHome(home[k])&&home[k]>=(k==='height'?2:2)&&home[k]<=(k==='height'?6:40))||!Array.isArray(home.rooms)||!home.rooms.length||home.rooms.length>12)throw new Error('全屋長寬需為 2–40m、層高 2–6m，並包含 1–12 個空間。');const ids=new Set(),itemIds=new Set();let count=0;for(const r of home.rooms){if(typeof r.id!=='string'||ids.has(r.id))throw new Error('房間識別碼重複。');ids.add(r.id);if(!['x','z','width','depth','height'].every(k=>finiteHome(r[k]))||r.width<.6||r.depth<.6||r.width>20||r.depth>20||r.height<2||r.height>6||Math.abs(r.x)+r.width/2>home.width/2+.03||Math.abs(r.z)+r.depth/2>home.depth/2+.03)throw new Error((r.name||'房間')+' 的尺寸或位置超出全屋範圍；單間長寬需為 0.6–20m。');r.name=String(r.name||'未命名空間').slice(0,40);r.kind=HOME_KINDS[r.kind]?r.kind:'other';r.purpose=['living','reading','social','bedroom','work','dining'].includes(r.purpose)?r.purpose:'living';r.openings=(r.openings||[]).filter(o=>['top','right','bottom','left'].includes(o.edge)&&['door','window'].includes(o.kind)&&finiteHome(o.offset)&&finiteHome(o.width)&&o.offset>=0&&o.width>=.03&&o.offset+o.width<=1.001).slice(0,12);if(!Array.isArray(r.items)||r.items.length>50)throw new Error('單間家具不得超過 50 件。');for(const i of r.items){if(!CATALOG[i.type]||typeof i.id!=='string'||itemIds.has(i.id)||!['x','z','rotation','w','d','h'].every(k=>finiteHome(i[k]))||!['w','d','h'].every(k=>i[k]>0&&i[k]<15))throw new Error('全屋家具格式不正確或識別碼重複。');const b=itemBounds(i);if(Math.abs(i.x)+b.w/2>r.width/2+.05||Math.abs(i.z)+b.d/2>r.depth/2+.05)throw new Error('家具超出所屬房間。');itemIds.add(i.id);count++;}}if(count>120)throw new Error('全屋最多保留 120 件家具。');for(let i=0;i<home.rooms.length;i++)for(let j=i+1;j<home.rooms.length;j++){const a=home.rooms[i],b=home.rooms[j],x=(a.width+b.width)/2-Math.abs(a.x-b.x),z=(a.depth+b.depth)/2-Math.abs(a.z-b.z);if(x>.04&&z>.04)throw new Error(a.name+' 與 '+b.name+' 重疊，請核對房間座標及尺寸。');}return home;}
export function homeRoomData(room){return {width:room.width,depth:room.depth,height:room.height,source:'floorplan-room',units:'m',coordinateSystem:'right-handed-y-up',planRoom:{name:room.name,kind:room.kind,openings:room.openings}};}
export function syncHomeProject(project){if(!project.home)return;const active=project.home.rooms.find(r=>r.id===project.activeRoomId);if(!active)throw new Error('找不到目前房間。');active.items=project.items;active.style=project.style;active.purpose=project.purpose;active.furnitureAdvice=project.furnitureAdvice||null;active.layoutDescription=project.layoutDescription||null;active.engine=project.engine||'local-rules';}
export function homeItems(project,world=false){if(!project.home)return project.items;return project.home.rooms.flatMap(r=>(r.id===project.activeRoomId?project.items:r.items).map(i=>({...i,...(world?{x:i.x+r.x,z:i.z+r.z}:{}),roomId:r.id,roomName:r.name})));}
export function planWalls(home){const lines=new Map();for(const room of home.rooms){const x=room.x-room.width/2,z=room.z-room.depth/2;for(const edge of ['top','bottom','left','right']){if((room.adjacent||[]).some(a=>a.edge===edge&&a.wall===false))continue;const axis=['top','bottom'].includes(edge)?'x':'z',coordinate=axis==='x'?z+(edge==='bottom'?room.depth:0):x+(edge==='right'?room.width:0),start=axis==='x'?x:z,length=axis==='x'?room.width:room.depth,key=axis+':'+Math.round(coordinate*100),openings=room.openings.filter(o=>o.edge===edge).map(o=>({start:start+o.offset*length,end:start+(o.offset+o.width)*length,kind:o.kind}));if(!lines.has(key))lines.set(key,{axis,coordinate,edges:[]});lines.get(key).edges.push({start,end:start+length,height:room.height,openings});}}
 const segments=[];for(const {axis,coordinate,edges} of lines.values()){const cuts=[...new Set(edges.flatMap(e=>[e.start,e.end,...e.openings.flatMap(o=>[o.start,o.end])]).map(n=>Math.round(n*1000)/1000))].sort((a,b)=>a-b);for(let i=1;i<cuts.length;i++){const start=cuts[i-1],end=cuts[i],middle=(start+end)/2,cover=edges.filter(e=>middle>=e.start-.001&&middle<=e.end+.001);if(!cover.length||end-start<.015)continue;const openings=cover.flatMap(e=>e.openings).filter(o=>middle>=o.start&&middle<=o.end),kind=openings.some(o=>o.kind==='door')?'door':openings.length?'window':'wall';segments.push({axis,x:axis==='x'?middle:coordinate,z:axis==='z'?middle:coordinate,length:end-start,height:Math.max(...cover.map(e=>e.height)),kind});}}return mergeNearbyWalls(segments);}
export function homePlanSVG(home){const width=900,scale=780/Math.max(home.width,home.depth),w=home.width*scale,h=home.depth*scale,ox=(width-w)/2,oy=65;const safe=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${h+140}" viewBox="0 0 900 ${h+140}" role="img" aria-label="全屋平面圖"><rect width="100%" height="100%" fill="#10171b"/><text x="50" y="32" fill="#d1e4d7" font-size="17" font-family="sans-serif">DOMIRA / ${home.rooms.length} 個空間 · ${home.width.toFixed(2)} × ${home.depth.toFixed(2)} m</text>${home.rooms.map(r=>`<rect x="${ox+(r.x-r.width/2+home.width/2)*scale}" y="${oy+(r.z-r.depth/2+home.depth/2)*scale}" width="${r.width*scale}" height="${r.depth*scale}" fill="${HOME_COLORS[r.kind]||HOME_COLORS.other}" opacity=".24"/>`).join('')}${planWalls(home).map(s=>{const x=ox+(s.x+home.width/2)*scale,y=oy+(s.z+home.depth/2)*scale,half=s.length*scale/2;return `<line x1="${s.axis==='x'?x-half:x}" x2="${s.axis==='x'?x+half:x}" y1="${s.axis==='z'?y-half:y}" y2="${s.axis==='z'?y+half:y}" stroke="${s.kind==='door'?'#d2b77f':s.kind==='window'?'#7eafbf':'#d5ddd4'}" stroke-width="${s.kind==='wall'?3:2}" ${s.kind==='door'?'stroke-dasharray="4 5"':''}/>`;}).join('')}${home.rooms.flatMap(r=>(r.items||[]).map(i=>{const color=/^#[0-9a-f]{6}$/i.test(i.color||'')?i.color:'#8fa68f';return `<g transform="translate(${ox+(r.x+i.x+home.width/2)*scale} ${oy+(r.z+i.z+home.depth/2)*scale}) rotate(${i.rotation})"><rect x="${-i.w*scale/2}" y="${-i.d*scale/2}" width="${i.w*scale}" height="${i.d*scale}" rx="3" fill="${color}" fill-opacity="${i.type==='rug'?.2:.7}" stroke="#d0e1d8" stroke-opacity=".4"/><title>${safe(i.name||i.type)}</title></g>`;})).join('')}${home.rooms.map(r=>`<text x="${ox+(r.x+home.width/2)*scale}" y="${oy+(r.z+home.depth/2)*scale-4}" text-anchor="middle" fill="#fff" stroke="#10171b" stroke-width="3" paint-order="stroke" font-size="${Math.min(30,Math.round(r.width*scale/Math.max(2,[...r.name].length)),Math.round(r.depth*scale/3))}" font-weight="700" font-family="sans-serif">${safe(r.name)}<tspan x="${ox+(r.x+home.width/2)*scale}" dy="25" font-size="${Math.min(21,Math.round(r.width*scale/8),Math.round(r.depth*scale/4))}" fill="#e4eee7">${r.width.toFixed(2)} × ${r.depth.toFixed(2)} m</tspan></text>`).join('')}<text x="50" y="${h+115}" fill="#a7bbae" font-size="11" font-family="sans-serif">${home.source==='care-manual'?'手動配置':'AI 矩形近似'} · 金色虛線為門洞 / 藍線為窗 · 需實測核對，非施工圖</text></svg>`;}

// ── 房間相鄰圖：方向 3 的前置 ──────────────────────────────────────────
// 為什麼必須先做這個：openings 只記錄「哪面牆有門」，不知道門通往哪一間房。
// 所以「床 → 門 → 走廊 → 廁所」這種跨房路線，之前根本無從檢查，只能檢查單一門寬。
// 判定規則：兩間房共享一段邊界（重疊 > 0.3 m），且門正好落在共享段上，才算相通。
export function buildRoomGraph(home){
 const rooms=(home&&home.rooms)||[],tol=.03;
 const L=r=>r.x-r.width/2,R=r=>r.x+r.width/2,T=r=>r.z-r.depth/2,B=r=>r.z+r.depth/2;
 // 門的世界座標區間：edge 起點 + offset×邊長。寬度換算成公尺（offset/width 都是 0–1 的比例）。
 const doorsOn=(room,edge,lo,hi)=>{
  const horizontal=['top','bottom'].includes(edge),len=horizontal?room.width:room.depth,start=horizontal?L(room):T(room);
  return (room.openings||[]).filter(o=>o.edge===edge&&o.kind==='door').map(o=>{
   const a=start+o.offset*len,b=a+o.width*len;
   return {width:Math.round(o.width*len*100)/100,from:a,to:b};
  }).filter(d=>Math.min(d.to,hi)-Math.max(d.from,lo)>.05);
 };
 const edges=[];
 for(let i=0;i<rooms.length;i++)for(let j=i+1;j<rooms.length;j++){
  const a=rooms[i],b=rooms[j],pairs=[];
  if(Math.abs(B(a)-T(b))<=tol)pairs.push(['bottom','top']);
  if(Math.abs(T(a)-B(b))<=tol)pairs.push(['top','bottom']);
  if(Math.abs(R(a)-L(b))<=tol)pairs.push(['right','left']);
  if(Math.abs(L(a)-R(b))<=tol)pairs.push(['left','right']);
  for(const [edgeA,edgeB] of pairs){
   const axis=['top','bottom'].includes(edgeA)?'x':'z';
   const lo=axis==='x'?Math.max(L(a),L(b)):Math.max(T(a),T(b));
   const hi=axis==='x'?Math.min(R(a),R(b)):Math.min(B(a),B(b));
   if(hi-lo<=.3)continue;
   const found=[...doorsOn(a,edgeA,lo,hi),...doorsOn(b,edgeB,lo,hi)];
   // 同一道門會在共享牆兩側各記一次；起點相同、寬度相近的視為同一扇。
   const unique=found.filter((d,k)=>found.findIndex(e=>Math.abs(e.from-d.from)<.06&&Math.abs(e.width-d.width)<.06)===k);
   if(!unique.length)continue;
   const door=unique.reduce((m,d)=>d.width<m.width?d:m);
   edges.push({a:a.id,b:b.id,shared:{axis,lo:Math.round(lo*100)/100,hi:Math.round(hi*100)/100,length:Math.round((hi-lo)*100)/100},door:{width:door.width,from:Math.round(door.from*100)/100,to:Math.round(door.to*100)/100},doors:unique.map(d=>({width:d.width,from:Math.round(d.from*100)/100,to:Math.round(d.to*100)/100}))});
  }
 }
 return {nodes:rooms.map(r=>({id:r.id,name:r.name,kind:r.kind})),edges};
}

// 夜間動線：睡房 →（有門相連的房間）→ 浴室。只回答「走得通嗎、門夠寬嗎、每間房淨寬夠不夠」，
// 不假裝知道床邊到門的實際步距——那需要家具與門的連線距離，現在只有房間矩形。
export function nightRoute(home,{mobility='standard'}={}){
 const rooms=(home&&home.rooms)||[],byId=new Map(rooms.map(r=>[r.id,r]));
 const start=rooms.find(r=>r.kind==='bedroom'),goals=rooms.filter(r=>r.kind==='bathroom');
 if(!start)return {ok:false,status:'unavailable',detail:'全屋沒有睡房，夜間路線沒有起點。'};
 if(!goals.length)return {ok:false,status:'unavailable',detail:'全屋沒有浴室，夜間路線沒有終點。'};
 const graph=buildRoomGraph(home),adj=new Map();
 for(const e of graph.edges){if(!adj.has(e.a))adj.set(e.a,[]);if(!adj.has(e.b))adj.set(e.b,[]);adj.get(e.a).push(e);adj.get(e.b).push(e);}
 // BFS：無權圖，房間數最多 12，不需要 Dijkstra。
 const prev=new Map(),queue=[start.id],seen=new Set([start.id]),goalIds=new Set(goals.map(g=>g.id));
 let target=null;
 while(queue.length&&!target){
  const id=queue.shift();
  for(const e of adj.get(id)||[]){
   const next=e.a===id?e.b:e.a;
   if(seen.has(next))continue;
   seen.add(next);prev.set(next,{from:id,edge:e});
   if(goalIds.has(next)){target=next;break;}
   queue.push(next);
  }
 }
 if(!target)return {ok:false,status:'warn',detail:'睡房與浴室之間找不到有門相連的路徑——平面圖上兩間房沒有共享一段帶門的牆，可能中間隔著沒標門的空間。'};
 const path=[];
 for(let cur=target;cur;cur=(prev.get(cur)||{}).from)path.unshift(cur);
 const doorMin=mobility==='wheelchair'?.85:.8,runNeed=mobility==='wheelchair'?1.05:.6;
 const roomInfo=path.map(id=>{
  const r=byId.get(id),m=clearanceMetrics(r.items||[],r);
  return {id,name:r.name,kind:r.kind,run:m.run,square:m.square,need:runNeed,status:m.run>=runNeed?'pass':'warn'};
 });
 const doorInfo=[];
 for(let i=1;i<path.length;i++){
  const e=(prev.get(path[i])||{}).edge,w=e?e.door.width:0;
  doorInfo.push({from:byId.get(path[i-1]).name,to:byId.get(path[i]).name,width:w,min:doorMin,status:w>=doorMin?'pass':'warn'});
 }
 const startRoom=byId.get(path[0]);
 const nightKit={hasWardrobe:!!(startRoom.items||[]).find(i=>i.type==='wardrobe'),detail:startRoom.items&&startRoom.items.find(i=>i.type==='wardrobe')?'睡房有衣櫃，取衣不必離開房間。':'睡房沒有衣櫃，夜間取衣要走到別的房間。'};
 const bad=roomInfo.filter(r=>r.status==='warn').length+doorInfo.filter(d=>d.status==='warn').length;
 return {ok:true,status:bad?'warn':'pass',rooms:roomInfo,doors:doorInfo,path:path.map(id=>byId.get(id).name),mobility,doorMin,runNeed,nightKit,detail:`${path.map(id=>byId.get(id).name).join(' → ')}（${path.length-1} 道門，最窄 ${Math.min(...doorInfo.map(d=>d.width)).toFixed(2)} m）`};
}


// 同名切塊合併：AI 依「非矩形就切塊」的規則，會把 L 形客廳切成兩塊並給同樣的名字。
// 這裡把「同名且互相接觸」的切塊用外框合併回一間；兩個同名但不相鄰的房間（例如兩個衛生間）不會被併。
// 合併後門窗的相對座標失效，所以清空 openings 並在 notes 說明——寧可留白，也不給錯的門位。
function mergeSameNameRooms(rooms){
 const warnings=[];
 if(!Array.isArray(rooms)||rooms.length<2)return warnings;
 const xs=rooms.flatMap(r=>[r.rect.x,r.rect.x+r.rect.w]),ys=rooms.flatMap(r=>[r.rect.y,r.rect.y+r.rect.h]);
 const span=Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys),1),tol=Math.max(12,span*.02);
 const near=(a,b)=>Math.hypot(Math.max(a.rect.x-(b.rect.x+b.rect.w),b.rect.x-(a.rect.x+a.rect.w),0),Math.max(a.rect.y-(b.rect.y+b.rect.h),b.rect.y-(a.rect.y+a.rect.h),0))<=tol;
 const overlap=(a,b)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
 const groups=new Map();
 for(const r of rooms){const k=r.name;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}
 const out=[];
 for(const [name,group] of groups){
  if(group.length<2){out.push(...group);continue;}
  const clusters=[];
  for(const r of group){const hit=clusters.find(c=>c.some(o=>near(r,o)));if(hit)hit.push(r);else clusters.push([r]);}
  for(const c of clusters){
   if(c.length<2){out.push(...c);continue;}
   const box={x:Math.min(...c.map(r=>r.rect.x)),y:Math.min(...c.map(r=>r.rect.y))};
   box.w=Math.max(...c.map(r=>r.rect.x+r.rect.w))-box.x;box.h=Math.max(...c.map(r=>r.rect.y+r.rect.h))-box.y;
   const clash=rooms.filter(r=>!c.includes(r)).some(r=>overlap(box,r.rect)>box.w*box.h*.05);
   if(clash){out.push(...c);continue;}
   const area=c.reduce((s,r)=>s+(Number.isFinite(r.area_sqm)?r.area_sqm:0),0);
   out.push({...c[0],rect:box,area_sqm:area>0?Math.round(area*100)/100:null,confidence:c.some(r=>r.confidence!=='high')?'medium':c[0].confidence,openings:keepOuterOpenings(c,box),adjacent:c.flatMap(r=>r.adjacent||[]),notes:`圖上「${name}」被切成 ${c.length} 塊，已用外框合併；合併後門窗位置失效，請重新核對。`});
   warnings.push(`「${name}」在圖上被切成 ${c.length} 塊，已用外框合併成一間，門窗需重新核對。`);
  }
 }
 if(out.length!==rooms.length){rooms.length=0;rooms.push(...out);}
 return warnings;
}


// 共享牆吸附：AI 給的每間房 rect 是粗略近似，相鄰房間的邊界常差一點點（0.1–0.8 m），
// 看起來就是「框貼不上去、房間之間有裂縫」。這裡把相鄰且縫很小的兩間對齊，
// 只移動較小的那一間（避免主要空間被推走），移動不改寬深所以面積不失真。
// 之後再由 resolveOverlaps 保證不重疊；吸完仍留著的縫通常是真實牆體或走道，不強行消除。
function snapSharedWalls(home,tol=1.4){
 const rooms=home.rooms,hw=home.width/2,hd=home.depth/2;
 for(let iter=0;iter<8;iter++){
  let moved=false;
  for(let i=0;i<rooms.length;i++)for(let j=i+1;j<rooms.length;j++){
   const a=rooms[i],b=rooms[j];
   const ax0=a.x-a.width/2,ax1=a.x+a.width/2,az0=a.z-a.depth/2,az1=a.z+a.depth/2;
   const bx0=b.x-b.width/2,bx1=b.x+b.width/2,bz0=b.z-b.depth/2,bz1=b.z+b.depth/2;
   const oy=Math.min(az1,bz1)-Math.max(az0,bz0),ox=Math.min(ax1,bx1)-Math.max(ax0,bx0);
   // 左右相鄰（z 有重疊）：a 在左、b 在右
   if(oy>Math.min(a.depth,b.depth)*.25){
    const gap=bx0-ax1;
    if(gap>.01&&gap<tol){if(a.width<=b.width)a.x+=gap;else b.x-=gap;moved=true;}
    const gap2=ax0-bx1;
    if(gap2>.01&&gap2<tol){if(a.width<=b.width)a.x-=gap2;else b.x+=gap2;moved=true;}
   }
   // 上下相鄰（x 有重疊）：a 在上、b 在下
   if(ox>Math.min(a.width,b.width)*.25){
    const gap=bz0-az1;
    if(gap>.01&&gap<tol){if(a.depth<=b.depth)a.z+=gap;else b.z-=gap;moved=true;}
    const gap2=az0-bz1;
    if(gap2>.01&&gap2<tol){if(a.depth<=b.depth)a.z-=gap2;else b.z+=gap2;moved=true;}
   }
  }
  if(!moved)break;
 }
 for(const r of rooms){r.x=Math.min(hw-r.width/2,Math.max(-hw+r.width/2,r.x));r.z=Math.min(hd-r.depth/2,Math.max(-hd+r.depth/2,r.z));r.x=roundHome(r.x);r.z=roundHome(r.z);}
 return home;
}


// 尺寸線吸附：圖上的尺寸鏈是唯一「量出來」的資料。把 top/bottom 的尺寸段累加得到 x 牆線，
// left/right 累加得到 z 牆線，再把每間房的四條邊吸到最近的牆線（差 < tol 才吸）。
// 相鄰房間會吸到同一條線，所以自然貼合、不重疊——比事後推開+吸縫可靠。
// 只動邊界落在牆線附近的房間；差太遠的（通常是 AI 估錯）保持原樣，交給後面的推開處理。
export function snapToDimensionLines(home,dimensions,tol=.55){
 if(!dimensions||!Array.isArray(home?.rooms))return 0;
 const unit=dimensions.unit==='mm'?.001:1;
 const cum=arr=>{if(!Array.isArray(arr)||arr.length<1||arr.length>12)return null;const out=[0];let sum=0;for(const v of arr){const m=v*unit;if(!Number.isFinite(m)||m<.2||m>20)return null;sum+=m;out.push(sum);}return out;};
 const sides=[cum(dimensions.bottom),cum(dimensions.top),cum(dimensions.left),cum(dimensions.right)];
 const xs=[...(sides[0]||[]),...(sides[1]||[])],zs=[...(sides[2]||[]),...(sides[3]||[])];
 if(xs.length<2||zs.length<2)return 0;
 const maxX=Math.max(...xs),maxZ=Math.max(...zs);
 if(!(maxX>0)||!(maxZ>0))return 0;
 const candX=xs.map(v=>roundHome((v/maxX-.5)*home.width)).sort((a,b)=>a-b);
 const candZ=zs.map(v=>roundHome((v/maxZ-.5)*home.depth)).sort((a,b)=>a-b);
 const nearest=(cands,v)=>{let best=null,bestD=tol;for(const c of cands){const d=Math.abs(c-v);if(d<bestD){bestD=d;best=c;}}return best;};
 let snapped=0;
 for(const room of home.rooms){
  const x0=roundHome(room.x-room.width/2),x1=roundHome(room.x+room.width/2);
  const z0=roundHome(room.z-room.depth/2),z1=roundHome(room.z+room.depth/2);
  const nx0=nearest(candX,x0),nx1=nearest(candX,x1),nz0=nearest(candZ,z0),nz1=nearest(candZ,z1);
  let changed=false;
  if(nx0!=null&&nx1!=null&&nx1-nx0>=.4){room.x=roundHome((nx0+nx1)/2);room.width=roundHome(nx1-nx0);changed=true;}
  else if(nx0!=null&&nx1==null){room.x=roundHome(nx0+room.width/2);changed=true;}
  else if(nx1!=null&&nx0==null){room.x=roundHome(nx1-room.width/2);changed=true;}
  if(nz0!=null&&nz1!=null&&nz1-nz0>=.4){room.z=roundHome((nz0+nz1)/2);room.depth=roundHome(nz1-nz0);changed=true;}
  else if(nz0!=null&&nz1==null){room.z=roundHome(nz0+room.depth/2);changed=true;}
  else if(nz1!=null&&nz0==null){room.z=roundHome(nz1-room.depth/2);changed=true;}
  if(changed)snapped++;
 }
 return snapped;
}


// 開放式客廳：AI 有時把「起居室」和「客廳」回成兩個不同名字的房間（kind 都是 living），
// 同名合併抓不到，它們就變成兩塊互相重疊的框。這裡把「kind=living 且互相接觸」的房間
// 併回一間、面積相加。只在 living 上做——餐廳與睡房是各自獨立的空間，不能按 kind 併。
function mergeOpenPlanRooms(rooms){
 const warnings=[];
 if(!Array.isArray(rooms)||rooms.length<2)return warnings;
 const group=rooms.filter(r=>r.kind==='living');
 if(group.length<2)return warnings;
 const xs=rooms.flatMap(r=>[r.rect.x,r.rect.x+r.rect.w]),ys=rooms.flatMap(r=>[r.rect.y,r.rect.y+r.rect.h]);
 const span=Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys),1),tol=Math.max(12,span*.04);
 const near=(a,b)=>Math.hypot(Math.max(a.rect.x-(b.rect.x+b.rect.w),b.rect.x-(a.rect.x+a.rect.w),0),Math.max(a.rect.y-(b.rect.y+b.rect.h),b.rect.y-(a.rect.y+a.rect.h),0))<=tol;
 const clusters=[];
 for(const r of group){const hit=clusters.find(c=>c.some(o=>near(r,o)));if(hit)hit.push(r);else clusters.push([r]);}
 const out=rooms.filter(r=>r.kind!=='living');
 for(const c of clusters){
  if(c.length<2){out.push(c[0]);continue;}
  const box={x:Math.min(...c.map(r=>r.rect.x)),y:Math.min(...c.map(r=>r.rect.y))};
  box.w=Math.max(...c.map(r=>r.rect.x+r.rect.w))-box.x;box.h=Math.max(...c.map(r=>r.rect.y+r.rect.h))-box.y;
  const overlapRect=(a,b)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
  const clash=rooms.filter(r=>!c.includes(r)).some(r=>overlapRect(box,r.rect)>box.w*box.h*.05);
  if(clash){out.push(...c);continue;}
  const area=c.reduce((n,r)=>n+(Number.isFinite(r.area_sqm)?r.area_sqm:0),0);
  out.push({...c[0],name:'客廳/起居室',rect:box,area_sqm:area>0?Math.round(area*100)/100:null,confidence:'medium',openings:keepOuterOpenings(c,box),notes:`圖上 ${c.map(r=>r.name).join('、')} 之間沒有隔牆，已合併為同一開放空間；合併後門窗位置失效，請重新核對。`});
  warnings.push(`「${c.map(r=>r.name).join('、')}」之間沒有隔牆，已合併為同一開放空間（面積相加）。`);
 }
 if(out.length!==rooms.length){rooms.length=0;rooms.push(...out);}
 return warnings;
}


// 合併相近的平行牆線：房間 rect 之間有縫時，同一道牆會被算成兩條（縫兩側各一條），
// 3D 看起來就是「沒牆的地方多了一道牆」。把同軸、座標差 <0.6 m、區間重疊的牆線併成一條
// （座標取平均、長度取聯集）。只合併 kind='wall'——門洞與窗要保留原位，不能併。
export function mergeNearbyWalls(segments,tol=.8){
 if(!Array.isArray(segments))return segments;
 const walls=segments.filter(s=>s.kind==='wall'),others=segments.filter(s=>s.kind!=='wall');
 const out=[];
 for(const s of walls){
  const coord=s.axis==='x'?'z':'x',along=s.axis==='x'?'x':'z';
  let hit=null;
  for(const m of out){
   if(m.axis!==s.axis)continue;
   if(Math.abs(m[coord]-s[coord])>tol+1e-6)continue;
   const ms=m[along]-m.length/2,me=m[along]+m.length/2;
   const ss=s[along]-s.length/2,se=s[along]+s.length/2;
   if(Math.min(me,se)-Math.max(ms,ss)<=.01)continue;
   hit=m;break;
  }
  if(hit){
   const coord2=hit.axis==='x'?'z':'x',along2=hit.axis==='x'?'x':'z';
   const ms=hit[along2]-hit.length/2,me=hit[along2]+hit.length/2;
   const ss=s[along2]-s.length/2,se=s[along2]+s.length/2;
   const start=Math.min(ms,ss),end=Math.max(me,se);
   hit[along2]=start+(end-start)/2;hit.length=end-start;
   hit[coord2]=Math.round(((hit[coord2]+s[coord2])/2)*1000)/1000;
   hit.height=Math.max(hit.height,s.height);
  } else out.push({...s});
 }
 return [...out,...others];
}


// 最後的兜底：resolveOverlaps 推不開的重疊（房間被全屋邊界卡住時常發生），
// 就沿重疊較小的軸縮小較小的那一間；縮到 0.6 m 下限仍重疊就把它往遠離對方的方向移開。
// 取捨是「寧可面積偏小，也不要讓使用者為了重疊手動改資料才能生成」——縮過的房間會寫進 warnings。
function forceSeparate(home){
 const rooms=home.rooms,hw=home.width/2,hd=home.depth/2,shrunk=new Set();const orig=new Map(rooms.map(r=>[r.id,{w:r.width,d:r.depth}]));
 for(let iter=0;iter<400;iter++){
  let clean=true;
  for(let i=0;i<rooms.length;i++)for(let j=i+1;j<rooms.length;j++){
   const a=rooms[i],b=rooms[j];
   const ox=(a.width+b.width)/2-Math.abs(a.x-b.x),oz=(a.depth+b.depth)/2-Math.abs(a.z-b.z);
   if(ox<=.02||oz<=.02)continue;
   clean=false;
   const alongX=ox<=oz;
   const small=alongX?(a.width<=b.width?a:b):(a.depth<=b.depth?a:b);
   const other=small===a?b:a;
   const overlap=alongX?ox:oz;
   const minSide=1.4;
   if(alongX){
    const next=small.width-overlap-.01;
    const floor=Math.min(minSide,(orig.get(small.id)?.w||small.width)*.95);
    if(next>=floor){small.width=roundHome(next);shrunk.add(small.name);}
    else{const dir=small.x>=other.x?1:-1;small.x=roundHome(small.x+dir*(overlap/2+.005));}
   }else{
    const next=small.depth-overlap-.01;
    const floor=Math.min(minSide,(orig.get(small.id)?.d||small.depth)*.95);
    if(next>=floor){small.depth=roundHome(next);shrunk.add(small.name);}
    else{const dir=small.z>=other.z?1:-1;small.z=roundHome(small.z+dir*(overlap/2+.005));}
   }
  }
  for(const r of rooms){r.x=Math.min(hw-r.width/2,Math.max(-hw+r.width/2,r.x));r.z=Math.min(hd-r.depth/2,Math.max(-hd+r.depth/2,r.z));}
  if(clean)break;
 }
 return [...shrunk];
}


// 合併房間時，把各塊的門窗映射到新矩形，但只保留落在外邊界上的：
// 內部邊界（原本兩塊之間的牆）上的門要丟掉，那道牆已經不存在了。
function keepOuterOpenings(pieces,box){
 const out=[];
 for(const piece of pieces){
  const r=piece.rect;
  const outer={top:Math.abs(r.y-box.y)<1,bottom:Math.abs(r.y+r.h-(box.y+box.h))<1,left:Math.abs(r.x-box.x)<1,right:Math.abs(r.x+r.w-(box.x+box.w))<1};
  for(const o of piece.openings||[]){
   if(!outer[o.edge])continue;
   const horizontal=['top','bottom'].includes(o.edge),len=horizontal?r.w:r.h,start=horizontal?r.x:r.y;
   const abs0=start+o.offset*len,abs1=abs0+o.width*len;
   const newLen=horizontal?box.w:box.h,newStart=horizontal?box.x:box.y;
   const offset=(abs0-newStart)/newLen,width=(abs1-abs0)/newLen;
   if(offset<-.001||offset+width>1.001)continue;
   out.push({kind:o.kind,edge:o.edge,offset:roundHome(Math.max(0,offset)),width:roundHome(Math.min(width,1-Math.max(0,offset)))});
  }
 }
 return out;
}


// 拓撲求解：用「誰跟誰共牆」＋「標註面積」重建佈局，不再相信 rect 的絕對位置。
// 兩步：① 保留長寬比、用標註面積重算每間尺寸；② 迭代把共牆的兩間邊界拉到剛好相接。
// 共牆關係來自 prompt 的 adjacent（第一步），面積來自圖上印刷的數字——兩者都比 rect 可靠。
// 這是確定性的幾何計算：同樣的輸入一定得到同樣的輸出。
export function solveTopology(rooms,home){
 if(!Array.isArray(rooms)||rooms.length<2)return {links:0,moved:0};
 const byName=new Map(rooms.map(r=>[r.name,r]));
 // ① 面積 → 尺寸（保留原本的長寬比）
 for(const r of rooms){
  const target=Number.isFinite(r.area_sqm)&&r.area_sqm>0.5?r.area_sqm:r.width*r.depth;
  const cur=r.width*r.depth;
  if(!(cur>0.05)||!(target>0.5))continue;
  const k=Math.sqrt(target/cur);
  r.width=roundHome(Math.min(r.width*k,home.width));
  r.depth=roundHome(Math.min(r.depth*k,home.depth));
 }
 // ② 共牆對齊：把兩間的共享邊界拉到剛好相接（各移一半）
 const links=[];
 for(const r of rooms)for(const a of r.adjacent||[]){
  const t=byName.get(a.to)||rooms.find(x=>x.name.startsWith(String(a.to).slice(0,3)));
  if(t&&t!==r)links.push([r,t,a.edge]);
 }
 const hw=home.width/2,hd=home.depth/2;
 let moved=0;
 for(let iter=0;iter<80&&links.length;iter++){
  let any=false;
  for(const [a,b,edge] of links){
   if(edge==='right'||edge==='left'){
    const dir=edge==='right'?1:-1,gap=(b.x-a.x)*dir-(a.width+b.width)/2;
    if(Math.abs(gap)>0.04){const shift=gap/2*dir;a.x=roundHome(a.x+shift);b.x=roundHome(b.x-shift);any=true;moved++;}
   }else{
    const dir=edge==='bottom'?1:-1,gap=(b.z-a.z)*dir-(a.depth+b.depth)/2;
    if(Math.abs(gap)>0.04){const shift=gap/2*dir;a.z=roundHome(a.z+shift);b.z=roundHome(b.z-shift);any=true;moved++;}
   }
  }
  for(const r of rooms){r.x=Math.min(hw-r.width/2,Math.max(-hw+r.width/2,r.x));r.z=Math.min(hd-r.depth/2,Math.max(-hd+r.depth/2,r.z));}
  if(!any)break;
 }
 return {links:links.length,moved};
}


// 行列切分求解器（v2）：放棄 rect 的絕對位置，只用它提供的「分欄」與「排序」資訊。
// ① 按左邊界把房間分成若干欄（left 相近 <1.5 m 視為同一欄）；
// ② 每欄寬 = 該欄房間寬度的最小值；欄內按 z 排序，高度 = 標註面積 / 欄寬（面積優先）；
// ③ 總寬縮放到全屋寬、每欄高度縮放到全屋深，房間依序貼合堆疊。
// 結果保證：欄內上下貼合、欄間左右貼合、無重疊，面積與圖上標註一致（縮放後略差）。
export function solveGrid(rooms,home){
 if(!Array.isArray(rooms)||rooms.length<2)return {cols:0};
 const H=Math.max(2,home.depth),W=Math.max(2,home.width);
 const sorted=[...rooms].sort((a,b)=>(a.x-a.width/2)-(b.x-b.width/2));
 const cols=[];
 for(const r of sorted){
  const left=r.x-r.width/2,last=cols[cols.length-1];
  if(last&&Math.abs(left-last.left)<1.5)last.rooms.push(r);
  else cols.push({left,rooms:[r]});
 }
 let totalW=0;
 for(const c of cols){
  const colArea=c.rooms.reduce((sum,r)=>sum+(Number.isFinite(r.area_sqm)&&r.area_sqm>0.5?r.area_sqm:r.width*r.depth),0);
  c.width=Math.max(1,colArea/H);
  totalW+=c.width;
  c.rooms.sort((a,b)=>a.z-b.z);
  let used=0;
  for(const r of c.rooms){
   const target=Number.isFinite(r.area_sqm)&&r.area_sqm>0.5?r.area_sqm:r.width*r.depth;
   r.depth=Math.max(0.8,target/c.width);
   used+=r.depth;
  }
  c.used=used;
 }
 // 面積優先：不把房間放大去填滿整屋（標註面積總和通常小於整屋外框，差額是牆體與未標註空間），
 // 只在總寬超出時才縮；不足時整體居中、兩側留白。
 const sx=totalW>0?Math.min(1,W/totalW):1;
 let x=-totalW*sx/2;
 for(const c of cols){
  c.width=roundHome(c.width*sx);
  const k=c.used>0?H/c.used:1;
  let z=-H/2;
  for(const r of c.rooms){
   r.width=c.width;
   r.depth=roundHome(Math.max(0.5,r.depth*k));
   r.x=roundHome(x+c.width/2);
   r.z=roundHome(z+r.depth/2);
   z+=r.depth;
  }
  x+=c.width;
 }
 return {cols:cols.length};
}


// 切分樹求解器：從矩形的邊界推導「先往哪切、再往哪切」，用面積決定每刀的位置。
// 與 solveGrid 的差別：solveGrid 只切一層欄（欄內一律上下堆疊，所以佈局被壓成直條）；
// 這裡是遞歸切分，欄裡還能再橫切，能保住原圖的錯落結構。
// 每一刀的位置由兩側房間的「標註面積和」比例決定，所以面積準；切完剛好填滿，所以貼合、無重疊。
export function solveSlices(rooms,home){
 if(!Array.isArray(rooms)||rooms.length<1)return {cuts:0};
 // 找出能把房間分成兩組、且兩組之間沒有交集的切線（回傳切線座標與分界）
 function bestCut(list){
  let best=null;
  for(const axis of ['x','z']){
   const half=axis==='x'?'width':'depth';
   const center=axis==='x'?'x':'z';
   const sorted=[...list].sort((a,b)=>(a[center]-a[half]/2)-(b[center]-b[half]/2));
   for(let i=0;i<sorted.length-1;i++){
    const leftEnd=sorted[i][center]+sorted[i][half]/2;
    const rightStart=sorted[i+1][center]-sorted[i+1][half]/2;
    const gap=rightStart-leftEnd;
    if(gap>-.05&&(!best||gap>best.gap))best={axis,gap,index:i,leftEnd,rightStart,sorted};
   }
  }
  return best;
 }
 let cuts=0;
 function cut(list,bounds){
  if(list.length<=1){
   const r=list[0];
   if(!r)return;
   r.x=roundHome(bounds.x+bounds.w/2);
   r.z=roundHome(bounds.z+bounds.d/2);
   r.width=roundHome(bounds.w);
   r.depth=roundHome(bounds.d);
   return;
  }
  const c=bestCut(list);
  if(!c){ // 沒有乾淨的切線：按面積硬切成兩半
   const sorted=[...list].sort((a,b)=>(a.x-a.width/2)-(b.x-b.width/2));
   const mid=Math.ceil(sorted.length/2);
   cut(sorted.slice(0,mid),{...bounds,w:bounds.w/2});
   cut(sorted.slice(mid),{...bounds,x:bounds.x+bounds.w/2,w:bounds.w/2});
   cuts++;
   return;
  }
  const groupA=c.sorted.slice(0,c.index+1),groupB=c.sorted.slice(c.index+1);
  const areaOf=g=>g.reduce((sum,r)=>sum+(Number.isFinite(r.area_sqm)&&r.area_sqm>0.5?r.area_sqm:r.width*r.depth),0);
  const aA=areaOf(groupA),aB=areaOf(groupB),total=aA+aB;
  const ratio=total>0?aA/total:.5;
  if(c.axis==='x'){
   const wA=bounds.w*ratio;
   cut(groupA,{...bounds,w:wA});
   cut(groupB,{...bounds,x:bounds.x+wA,w:bounds.w-wA});
  }else{
   const dA=bounds.d*ratio;
   cut(groupA,{...bounds,d:dA});
   cut(groupB,{...bounds,z:bounds.z+dA,d:bounds.d-dA});
  }
  cuts++;
 }
 // 有效區域 = 面積等於「標註面積總和」、長寬比同整屋的矩形。
 // 整屋外框（含牆體與未標註空間）通常比標註總和大 30% 以上，直接填滿會讓每間放大同樣比例。
 const totalArea=rooms.reduce((sum,r)=>sum+(Number.isFinite(r.area_sqm)&&r.area_sqm>0.5?r.area_sqm:r.width*r.depth),0)||home.width*home.depth;
 const aspect=home.width/home.depth;
 const effW=Math.min(home.width,Math.sqrt(totalArea*aspect)),effD=Math.min(home.depth,effW>0?totalArea/effW:home.depth);
 cut(rooms,{x:-effW/2,z:-effD/2,w:effW,d:effD});
 return {cuts};
}


// 多邊形面積（鞋帶公式）。頂點順序不影響結果，取絕對值。
export function polygonArea(points){
 if(!Array.isArray(points)||points.length<3)return 0;
 let sum=0;
 for(let i=0;i<points.length;i++){
  const a=points[i],b=points[(i+1)%points.length];
  sum+=a[0]*b[1]-b[0]*a[1];
 }
 return Math.abs(sum)/2;
}


// 自動補門：AI 常常漏掉門。對「一道門都沒有」的房間，挑一個 wall:true 的相鄰房間，
// 在共享牆的 40% 位置補一道門。位置是猜的，但總比 3D 裡整間沒門好；使用者可用門編輯器改。
function autofillDoors(rooms){
 const filled=[];
 for(const r of rooms){
  if(!Array.isArray(r.openings))r.openings=[];
  if(r.openings.some(o=>o.kind==='door'))continue;
  const link=(r.adjacent||[]).find(a=>a.wall!==false&&['top','right','bottom','left'].includes(a.edge));
  if(!link)continue;
  r.openings.push({kind:'door',edge:link.edge,offset:.4,width:.2});
  filled.push(r.name);
 }
 return filled;
}
