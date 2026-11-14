export const CARE_LAYOUT_FEATURES=['routeDistance','crossings','movedRooms','furnitureTravel','bedTurn'];

export function careLayoutFeatures(base,{whole,route,changedRooms}){
 const previous=new Map(base.home.rooms.flatMap(room=>room.items.map(item=>[item.id,item])));
 let travel=0,bedTurn=0;
 for(const room of whole.home.rooms)for(const item of room.items){
  const old=previous.get(item.id);
  if(!old)continue;
  travel+=Math.hypot(item.x-old.x,item.z-old.z);
  if(item.type==='bed')bedTurn+=Math.abs(((item.rotation-old.rotation+540)%360)-180)/180;
 }
 return [route.distance,route.crossings.length,changedRooms.length,travel,bedTurn];
}
