import {careDoors,checkCareAccess} from './care-access.js';
import {CARE_PROFILES,careCollisions} from './care-domain.js';
import {careToiletObstacle,validateCareToilet} from './care-toilet.js';

const opposite={top:'bottom',bottom:'top',left:'right',right:'left'};
const separation=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const doorKey=(roomId,index)=>JSON.stringify([roomId,`door:${index}`]);
const routeKey=(roomId,key)=>JSON.stringify([roomId,key]);
const m=value=>`${value.toFixed(2)} m`;

export function careNightRoute(whole, {profile='walker',bedId} = {}) {
 const preset=Object.hasOwn(CARE_PROFILES,profile)?CARE_PROFILES[profile]:CARE_PROFILES.walker;
 if(preset===CARE_PROFILES.walker)profile='walker';
 const rooms=whole.home.rooms;
 const beds=rooms.filter(room=>room.kind==='bedroom').flatMap(room=>room.items.filter(item=>item.type==='bed').map(item=>({id:item.id,roomId:room.id,name:`${room.name} · ${item.name}`})));
 const bed=beds.find(item=>item.id===bedId)||beds[0];
 const empty=(status,detail,issues=[])=>({status,detail,issues,beds,bedId:bed?.id,profile,points:[]});
 if(!bed)return empty('pending','先在睡房放一張床，就可以從床邊開始找路。');
 if(!rooms.some(room=>room.kind==='bathroom'))return empty('pending','請先在全屋平面圖標記浴室。');

 const roomMap=new Map(rooms.map(room=>[room.id,room]));
 const marked=rooms.some(room=>room.kind==='bathroom'&&room.toilet);
 const adj=new Map(),issues=new Map(),doors=[],starts=new Set();
 const goals=new Map();
 const issue=(room,text)=>issues.set(`${room.id}:${text}`,`${room.name}：${text}`);
 function add(from,to,room,path,door=null,{oneWay=false}={}) {
  const length=path.slice(1).reduce((sum,point,index)=>sum+separation(point,path[index]),0);
  const forward={to,room,path,door,length};
  const backward={...forward,to:from,path:[...path].reverse(),door:door?{...door,from:door.to,to:door.from}:null};
  if(!adj.has(from))adj.set(from,[]);
  if(!adj.has(to))adj.set(to,[]);
  adj.get(from).push(forward);
  if(!oneWay)adj.get(to).push(backward);
 }
 for(const room of rooms) {
  const world=([x,z])=>[x+room.x,z+room.z];
  const project={room:{width:room.width,depth:room.depth,planRoom:room},items:room.items,profile,doorWidth:preset.door};
  const openings=careDoors(project);
  const measured=whole.projects[room.id]?.doorConfirmed===true;
  openings.forEach((opening,index)=>doors.push({...opening,roomId:room.id,index,center:world(opening.center),measured}));
  if(Array.isArray(room.polygon)&&room.polygon.length>=3&&room.polygon.some(point=>!Array.isArray(point)||point.length!==2||!point.every(Number.isFinite))){issue(room,'牆線資料不完整，請核對平面圖。');continue;}
  if(Math.min(room.width,room.depth)<preset.corridor-.001){issue(room,`房間的短邊小於 ${m(preset.corridor)} 的通道目標。`);continue;}
  if(!openings.length){issue(room,'請標記門位。');continue;}
  if(room.toilet){
   try{validateCareToilet(room,room.toilet);}catch(error){issue(room,error.message);continue;}
   if(careCollisions([...room.items,careToiletObstacle(room.toilet)]).some(pair=>pair.includes('fixed-toilet'))){issue(room,'家具與固定座廁重疊，請調整擺位。');continue;}
  }
  const access=checkCareAccess(project,preset,{includePaths:true,transit:true});
  for(const failure of access.failures.slice(0,3))issue(room,failure.message);
  if(!access.connections.length)continue;
  for(const connection of access.connections) {
   if(connection.to.startsWith('bed:')){
    if(room.id!==bed.roomId||!['left','right'].some(side=>connection.to===`bed:${bed.id}:${side}`))continue;
    starts.add(routeKey(room.id,connection.to));
   }
   const endpoint=connection.to==='arrival'||connection.to.startsWith('toilet:');
   if(endpoint&&(room.kind!=='bathroom'||(marked&&connection.to==='arrival')))continue;
   const to=routeKey(room.id,connection.to);
   if(endpoint)goals.set(to,connection.to);
   add(routeKey(room.id,connection.from),to,room.id,connection.path.map(world),null,{oneWay:endpoint});
  }
 }

 // A crossing must occur at opposing openings in the same section of wall.
 // An opening recorded on only one side is kept as a measurement task.
 for(const [index,a] of doors.entries())for(const b of doors.slice(index+1)) {
  if(a.roomId===b.roomId || opposite[a.edge]!==b.edge)continue;
  const along=a.horizontal?0:1,normal=1-along;
  if(Math.abs(a.center[normal]-b.center[normal])>.031)continue;
  const low=Math.max(a.center[along]-a.width/2,b.center[along]-b.width/2);
  const high=Math.min(a.center[along]+a.width/2,b.center[along]+b.width/2);
  if(high-low<=.05)continue;
  const safeWidth=2*Math.min(...[a.center[along],b.center[along]].flatMap(center=>[center-low,high-center]));
  if(safeWidth<preset.door-.001){issue(roomMap.get(a.roomId),`與${roomMap.get(b.roomId).name}相接的門洞重疊淨寬不足。`);continue;}
  if(!adj.has(doorKey(a.roomId,a.index))||!adj.has(doorKey(b.roomId,b.index)))continue;
  const confirmed=a.measured&&b.measured&&[a,b].every(door=>['inward-start','inward-end','outward','sliding'].includes(door.swing));
  add(doorKey(a.roomId,a.index),doorKey(b.roomId,b.index),null,[a.center,b.center],{from:a.roomId,to:b.roomId,width:safeWidth,confirmed});
 }

 const costs=new Map([...starts].map(start=>[start,0])),previous=new Map(),unvisited=new Set(starts);
 let end;
 while(unvisited.size){
  const node=[...unvisited].reduce((best,key)=>costs.get(key)<costs.get(best)?key:best);
  unvisited.delete(node);
  if(goals.has(node)){end=node;break;}
  for(const edge of adj.get(node)||[]){
   const cost=costs.get(node)+edge.length;
   if(cost>= (costs.get(edge.to)??Infinity)-1e-9)continue;
   costs.set(edge.to,cost);previous.set(edge.to,{node,edge});unvisited.add(edge.to);
  }
 }
 if(!end)return empty('pending',marked?'暫未找到從床邊到座廁使用位置的連續路線。請核對門位及座廁淨空。':'暫未找到從床邊到浴室內的連續路線。請核對相連房間的兩側門位、門寬及家具位置。',[...issues.values()]);
 const steps=[];
 for(let node=end;!starts.has(node);){const step=previous.get(node);steps.unshift(step.edge);node=step.node;}
 const roomIds=[...new Set(steps.filter(step=>step.room).map(step=>step.room))];
 const crossings=steps.filter(step=>step.door).map(step=>step.door);
 const points=steps.flatMap(step=>step.path).filter((point,index,all)=>index===0||separation(point,all[index-1])>1e-6);
 const side=goals.get(end).split(':')[1];
 const destination=side?{front:'座廁前方',left:'座廁左側',right:'座廁右側'}[side]:'浴室內';
 const pending=['請實測門檻高差、防滑和夜間照明。',side?'請按使用者及輔具在現場試行，核對座高、扶手握位及照顧者站位。':'請標記座廁位置及轉移側，並核對浴室內的實際如廁空間。'];
 if(!whole.home.scaleConfirmed)pending.unshift('平面圖比例及尺寸有待確認。');
 if(roomIds.some(id=>roomMap.get(id).polygon?.length>=3))pending.unshift('請核對匯入的牆線及凹位。');
 if(crossings.some(door=>!door.confirmed))pending.unshift('請核對路線上各門的實測淨寬、門位與開門方向。');
 return {status:'route-found',detail:`${roomIds.map(id=>roomMap.get(id).name).join(' → ')}${side?` → ${destination}`:''} · 約 ${m(costs.get(end))}`,destination,issues:pending,beds,bedId:bed.id,profile,points,roomIds,crossings,doorWidth:Math.min(...crossings.map(door=>door.width)),corridorTarget:preset.corridor,distance:costs.get(end)};
}

export function careNightRouteOverlay(route, projectPoint, rooms=[]) {
 const fixtures=rooms.filter(room=>room.toilet).map(({x,z,toilet:t})=>{
  const [cx,cy]=projectPoint([x+t.x,z+t.z]),[x1]=projectPoint([x+t.x+t.w,z]),[,y1]=projectPoint([x,z+t.z+t.d]);
  const w=x1-cx,d=y1-projectPoint([x,z])[1];
  return `<g transform="translate(${cx} ${cy}) rotate(${t.rotation})"><rect x="${-w/2}" y="${-d/2}" width="${w}" height="${d}" rx="4" fill="#dce8dc" stroke="#172b26"/><title>固定座廁</title></g>`;
 }).join('');
 if(route.points.length<2)return fixtures;
 const points=route.points.map(projectPoint);
 const [start,end]=[points[0],points.at(-1)];
 const line=points.map(point=>point.map(value=>value.toFixed(2)).join(',')).join(' ');
 return `${fixtures}<g aria-label="床邊至${route.destination||'浴室內'}的夜間路線"><polyline points="${line}" fill="none" stroke="#172b26" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/><polyline points="${line}" fill="none" stroke="#86f4c3" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>${[start,end].map(([x,y],index)=>`<circle cx="${x}" cy="${y}" r="13" fill="#86f4c3" stroke="#172b26" stroke-width="3"/><text x="${x}" y="${y+5}" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="14" fill="#172b26">${index+1}</text>`).join('')}</g>`;
}
