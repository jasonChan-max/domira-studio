import {careNightRoute} from './care-night-route.js';
import {remainingRequestedItems,requestedItems} from './care-brief.js';
import {careGeometry,safeCareLayout} from './care-domain.js';

const VARIANTS=[1,2,3];
const MAX_CHECKS=16;

function applyLayouts(whole,layouts){
 const projects={...whole.projects};
 const rooms=whole.home.rooms.map(room=>{
  const project=layouts.get(room.id);
  if(!project)return room;
  projects[room.id]=project;
  return {...room,items:project.items};
 });
 return {...whole,projects,home:{...whole.home,rooms}};
}

export async function planCareNightAccess(whole,{profile,yieldFrame=()=>Promise.resolve()}={}){
 const routeProfile=whole.nightProfile||profile;
 const options={profile:routeProfile,bedId:whole.nightBedId};
 const original=careNightRoute(whole,options);
 let best={whole,route:original,changedRooms:[],checks:0};
 if(!original.bedId||!whole.home.rooms.some(room=>room.kind==='bathroom'))return best;

 const goals=whole.brief?.preferences||[];
 const shorten=goals.includes('night-light')||whole.brief?.daily?.needs?.includes('balance');
 if(original.status==='route-found'&&!shorten)return best;

 const bedRoom=original.beds.find(bed=>bed.id===original.bedId)?.roomId;
 const rooms=whole.home.rooms.filter(room=>{
  const project=whole.projects[room.id];
  return project?.brief&&room.items.length&&!room.items.some(item=>item.locked)&&room.openings?.some(opening=>opening.kind==='door');
 }).sort((a,b)=>Number(b.id===bedRoom)-Number(a.id===bedRoom));
 let checks=0;
 const seen=new Set();
 const fingerprint=items=>JSON.stringify(items.map(({requestKey,x,z,rotation})=>[requestKey,x,z,rotation]));
 async function consider(layouts){
  if(!layouts.size||checks>=MAX_CHECKS)return;
  const key=JSON.stringify([...layouts].map(([id,p])=>[id,fingerprint(p.items)]));
  if(seen.has(key))return;
  seen.add(key);checks++;
  await yieldFrame();
  const candidate=applyLayouts(whole,layouts);
  const route=careNightRoute(candidate,options);
  if(route.status!=='route-found')return;
  const improvement=best.route.status!=='route-found'||(shorten&&route.distance<best.route.distance-.10&&route.doorWidth>=best.route.doorWidth-.001);
  if(improvement)best={whole:candidate,route,changedRooms:[...layouts.keys()]};
 }

 for(const variant of VARIANTS){
  if(checks>=MAX_CHECKS)break;
  const alternatives=new Map();
  for(const room of rooms){
   await yieldFrame();
   const project=whole.projects[room.id];
   const current=new Map(project.items.map(item=>[item.requestKey,item]));
   if(current.has(undefined))continue;
   const requested=requestedItems(project.brief).filter(item=>current.has(item.requestKey)).map(item=>{
    const {id,transferSide}=current.get(item.requestKey);
    return {...item,id,transferSide};
   });
   const {items}=safeCareLayout(project,requested,{variant});
   if(items.length!==project.items.length||fingerprint(items)===fingerprint(project.items))continue;
   const candidate={...project,items};
   if(!careGeometry(candidate).ok)continue;
   candidate.unplaced=remainingRequestedItems(candidate);
   alternatives.set(room.id,candidate);
   await consider(new Map([[room.id,candidate]]));
   if(checks>=MAX_CHECKS)break;
  }
  await consider(alternatives);
  if(best.changedRooms.length&&original.status!=='route-found'&&!shorten)break;
 }
 return {...best,checks};
}
