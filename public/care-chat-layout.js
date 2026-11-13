import {careGeometry,validateCareProject} from './care-domain.js';

export function chatScene(project){
 const {id,name,profile,doorWidth,doorConfirmed,style,purpose,brief}=project;
 const {width,depth,height,source,planRoom}=project.room;
 return {format:project.format,id,name,profile,doorWidth,doorConfirmed,style,purpose,brief,
  room:{width,depth,height,source,planRoom},
  items:project.items.map(({id,name,type,x,z,w,d,h,rotation,color,role,careKind,careModel,productId,sourceRecordId,dimensionSource,requestKey,locked,transferSide})=>
   ({id,name,type,x,z,w,d,h,rotation,color,role,careKind,careModel,productId,sourceRecordId,dimensionSource,requestKey,locked,transferSide}))};
}

export function validateChatMoves(project,moves){
 validateCareProject(project);
 if(!Array.isArray(moves)||moves.length>12)throw Error('擺位提案格式不正確。');
 const patches=new Map();
 for(const move of moves){
  const item=project.items.find(i=>i.id===move?.id);
  if(!item||item.locked||item.careKind==='rail'||item.careKind==='folding'||patches.has(move.id)||
   Object.keys(move).some(key=>!['id','x','z','rotation'].includes(key))||
   !['x','z','rotation'].every(key=>Number.isFinite(move[key])&&Math.abs(move[key])<=(key==='rotation'?360:15)))throw Error('只能移動場景中可調整的家具。');
  const rotation=((move.rotation%360)+360)%360;
  if(Math.hypot(item.x-move.x,item.z-move.z)>.001||Math.abs(((item.rotation%360)+360)%360-rotation)>.1){
   patches.set(move.id,{id:move.id,x:move.x,z:move.z,rotation});
  }else throw Error('提案沒有實際變更。');
 }
 const items=project.items.map(item=>patches.has(item.id)?{...item,...patches.get(item.id)}:item);
 if(patches.size){const check=careGeometry({...project,items});if(!check.ok)throw Error(check.failures[0].message);}
 return {items,moves:[...patches.values()]};
}
