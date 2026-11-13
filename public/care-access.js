import {layoutOpenings} from './domain.js';
import {pointClearance, segmentClearance} from './circulation-domain.js';

const TOLERANCE = .001;
const WALLS = {
 top: {inward: [0, 1], horizontal: true},
 bottom: {inward: [0, -1], horizontal: true},
 left: {inward: [1, 0], horizontal: false},
 right: {inward: [-1, 0], horizontal: false}
};

export function careDoors(project) {
 const {room} = project;
 const openings = layoutOpenings(room).filter(opening => opening.kind === 'door');
 const supplied = Array.isArray(room.planRoom?.openings) ? room.planRoom.openings : [];
 return openings.map(opening => {
  const wall = WALLS[opening.edge];
  const along = wall.horizontal ? room.width : room.depth;
  const normal = wall.horizontal ? room.depth : room.width;
  const offset = (opening.offset + opening.width / 2 - .5) * along;
  const center = wall.horizontal ? [offset, -wall.inward[1] * normal / 2] : [-wall.inward[0] * normal / 2, offset];
  const original = supplied.find(door => door?.kind === 'door' && door.edge === opening.edge && Math.abs(door.offset - opening.offset) < .001);
  return {...opening, width: opening.width * along, center, ...wall, swing: original?.swing};
 });
}

function blocksKnownSwing(door, item) {
 if (!['inward-start', 'inward-end'].includes(door.swing)) return false;
 // The swept envelope of a hinged leaf, sampled at intervals of at most 5°.
 // Inflate each sampled leaf by the maximum distance to the next sample.
 const sign = door.swing === 'inward-start' ? 1 : -1;
 const tangent = door.horizontal ? [sign, 0] : [0, sign];
 const hinge = door.center.map((coordinate, axis) => coordinate - tangent[axis] * door.width / 2);
 const sweepPadding = door.width * Math.sin(Math.PI / 72) + .015;
 for (let step = 0; step <= 18; step++) {
  const angle = step * Math.PI / 36;
  const tip = hinge.map((coordinate, axis) => coordinate + door.width * (tangent[axis] * Math.cos(angle) + door.inward[axis] * Math.sin(angle)));
  if (segmentClearance(hinge, tip, item) < sweepPadding) return true;
 }
 return false;
}

function outlineGeometry(room) {
 const polygon=room.planRoom?.polygon;
 if(!Array.isArray(polygon)||polygon.length<3||polygon.some(point=>!Array.isArray(point)||point.length!==2||!point.every(Number.isFinite)))return null;
 const walls=polygon.map(([x,z],index)=>{
  const [nextX,nextZ]=polygon[(index+1)%polygon.length];
  return {x:(x+nextX)/2,z:(z+nextZ)/2,w:Math.hypot(nextX-x,nextZ-z),d:0,rotation:Math.atan2(nextZ-z,nextX-x)*180/Math.PI};
 }).filter(wall=>wall.w>1e-6);
 function inside([x,z]){
  let contained=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
   const [ax,az]=polygon[i],[bx,bz]=polygon[j];
   if((az>z)!==(bz>z)&&x<(bx-ax)*(z-az)/(bz-az)+ax)contained=!contained;
  }
  return contained;
 }
 function entranceWall(door){
  const axis=door.horizontal?0:1;
  const ends=[-1,1].map(sign=>door.center.map((coordinate,k)=>coordinate+(k===axis?sign*door.width/2:0)));
  return walls.find(wall=>ends.every(point=>pointClearance(point,wall)<=.015));
 }
 return {inside,entranceWall,wallClearance:(a,b,ignored)=>walls.reduce((gap,wall)=>wall===ignored?gap:Math.min(gap,segmentClearance(a,b,wall)),Infinity)};
}

function bedAccessAreas(bed, room, obstacles, width, outline) {
 const angle = bed.rotation * Math.PI / 180;
 const world = (x, z) => [bed.x + x * Math.cos(angle) - z * Math.sin(angle), bed.z + x * Math.sin(angle) + z * Math.cos(angle)];
 const radius = width / 2;
 const along = Math.min(bed.d * .25, .3);
 const areas = [];
 for (const side of [-1, 1]) {
  if (bed.transferSide === 'left' && side !== -1 || bed.transferSide === 'right' && side !== 1) continue;
  const x = side * (bed.w / 2 + radius + .005);
  const ends = [world(x, -along), world(x, along)];
  if (ends.some(([px, pz]) => Math.abs(px) + radius > room.width / 2 + TOLERANCE || Math.abs(pz) + radius > room.depth / 2 + TOLERANCE)) continue;
  if (outline&&(!ends.every(outline.inside)||outline.wallClearance(...ends)<radius-TOLERANCE))continue;
  if (obstacles.some(item => segmentClearance(...ends, item) < radius - TOLERANCE)) continue;
  areas.push({side: side < 0 ? 'left' : 'right', point: world(x, 0), ends});
 }
 return areas;
}

export function checkCareAccess(project, profile, {includePaths = false, transit = false} = {}) {
 const {room} = project;
 const outline=transit?outlineGeometry(room):null;
 const obstacles = project.items.filter(item => item.role !== 'surface');
 const doors = careDoors(project);
 const usable = new Set();
 const failures = [];
 const pending = [];
 const paths = [];
 const connections = [];
 const transfers = [];
 const result = () => ({failures, pending, paths, ...(transit?{connections}:{}), transfers, turningPoint, doors, status: failures.length ? 'blocked' : pending.length ? 'review-required' : 'checked'});
 let turningPoint = null;
 if (!doors.length) pending.push({id: 'door-position', label: '請在平面圖標出門位，才可核對入口路線。'});
 if (doors.some(door => !['inward-start','inward-end','outward','sliding'].includes(door.swing))) pending.push({id: 'door-swing', label: '請核對開門方向及門扇是否會碰到家具。'});
 if (room.planRoom?.polygon?.length) pending.push({id: 'room-outline', label: outline?'請核對匯入的牆線及凹位。':'路線暫按矩形範圍驗算，請核對凹位及斜牆。'});
 for (const [index,door] of doors.entries()) {
  const wide = door.width >= profile.door - TOLERANCE;
  if (!wide) failures.push({rule: 'door', message: `門洞淨寬 ${door.width.toFixed(2)} m，低於目前設定的 ${profile.door.toFixed(2)} m。`});
  const blocked = obstacles.find(item => blocksKnownSwing(door, item));
  if (blocked) failures.push({rule: 'door-swing', id: blocked.id, message: `${blocked.name}會擋住開門。`});
  if(wide&&!blocked)usable.add(index);
 }
 if (!doors.length && project.doorWidth < profile.door - TOLERANCE) failures.push({rule: 'door', message: `入口淨寬 ${project.doorWidth.toFixed(2)} m，低於目前設定的 ${profile.door.toFixed(2)} m。`});
 if (failures.length&&(!transit||!usable.size)) return result();

 const beds = obstacles.filter(item => item.type === 'bed');
 const bedAreas = beds.map(bed => ({bed, areas: bedAccessAreas(bed, room, obstacles, profile.corridor,outline)}));
 for (const {bed, areas} of bedAreas) {
  if (!areas.length) failures.push({rule: 'bed-access', id: bed.id, message: `${bed.name}旁邊沒有足夠的上落床空間。試把床移向另一面牆。`});
 }
 if ((!transit&&failures.length) || (!doors.length && !beds.length)) return result();
 if (!transit&&!beds.length && doors.length === 1 && project.profile !== 'wheelchair') {
  const door = doors[0];
  const point = door.center.map((coordinate, axis) => coordinate + door.inward[axis] * (profile.corridor/2 + .005));
  if (Math.abs(point[0]) + profile.corridor/2 > room.width/2 + TOLERANCE || Math.abs(point[1]) + profile.corridor/2 > room.depth/2 + TOLERANCE ||
      obstacles.some(item => pointClearance(point, item) < profile.corridor/2 - TOLERANCE || segmentClearance(door.center, point, item) < Math.min(profile.corridor,door.width)/2 - TOLERANCE)) {
   failures.push({rule:'entry-access', message:'門口內側被擋住，請留出由門進入房間的空間。'});
  } else if (includePaths) {
   paths.push([door.center, point]);
   if(transit)connections.push({from:'door:0',to:'arrival',path:[door.center,point]});
  }
  return result();
 }

 const radius = profile.corridor / 2;
 const turningRadius = profile.turning / 2;
 const inside = ([x, z], margin) => Math.abs(x) + margin <= room.width / 2 + TOLERANCE && Math.abs(z) + margin <= room.depth / 2 + TOLERANCE;
 const freePoint = (p, margin = radius) => inside(p, margin) && (!outline||(outline.inside(p)&&outline.wallClearance(p,p)>=margin-TOLERANCE)) && obstacles.every(item => pointClearance(p, item) >= margin - TOLERANCE);
 const clearSegment = (a, b) => (!outline||outline.wallClearance(a,b)>=radius-TOLERANCE) && obstacles.every(item => segmentClearance(a, b, item) >= radius - TOLERANCE);
 const step = Math.max(.14, Math.min(.24, Math.max(room.width, room.depth) / 70));
 const xs = Math.max(1, Math.ceil((room.width - 2 * radius) / step));
 const zs = Math.max(1, Math.ceil((room.depth - 2 * radius) / step));
 const nodes = [], cells = new Map();
 const add = (point, neighbors = []) => { nodes.push({point, neighbors});return nodes.length - 1; };
 for (let row = 0; row <= zs; row++) for (let col = 0; col <= xs; col++) {
  const point = [radius - room.width / 2 + (room.width - 2 * radius) * col / xs, radius - room.depth / 2 + (room.depth - 2 * radius) * row / zs];
  if (freePoint(point)) cells.set(row*(xs+1)+col, add(point));
 }
 function link(a, b) {
  if (a === undefined || b === undefined || !clearSegment(nodes[a].point, nodes[b].point)) return;
  nodes[a].neighbors.push(b);nodes[b].neighbors.push(a);
 }
 for (let row = 0; row <= zs; row++) for (let col = 0; col <= xs; col++) {
  const key = row*(xs+1)+col;
  if(col<xs)link(cells.get(key), cells.get(key+1));
  if(row<zs)link(cells.get(key), cells.get(key+xs+1));
 }
 const gridSize = nodes.length;
 function attach(point) {
  if (!freePoint(point)) return undefined;
  const id = add(point);
  for (let n = 0; n < gridSize; n++) {
   const p = nodes[n].point;
   if (Math.hypot(p[0]-point[0], p[1]-point[1]) <= step * 2) link(id, n);
  }
  return id;
 }
 const entrances = doors.map((door,index) => {
  if(!usable.has(index))return undefined;
  const point = door.center.map((coordinate, axis) => coordinate + door.inward[axis] * (radius + .005));
  const openingRadius = Math.min(radius, door.width / 2);
  if(outline){
   const wall=outline.entranceWall(door);
   if(!wall){failures.push({rule:'outline-door',message:'圖上的門洞與牆線未對齊，請核對門位。'});return undefined;}
   if(outline.wallClearance(door.center,point,wall)<openingRadius-TOLERANCE)return undefined;
  }
  return obstacles.every(item => segmentClearance(door.center, point, item) >= openingRadius - TOLERANCE) ? attach(point) : undefined;
 });
 if (entrances.includes(undefined)) {
  failures.push({rule:'entry-access', message:'門口內側被擋住，請留出由門進入房間的空間。'});
  if(!transit)return result();
 }
 for (const entry of bedAreas) for (const area of entry.areas) area.node = attach(area.point);
 const requiresTurn = project.profile === 'wheelchair' && (!transit || beds.length || room.planRoom?.kind === 'bathroom');
 const turningCandidates = requiresTurn ? nodes.map(({point}, n) => freePoint(point, turningRadius) ? n : -1).filter(n => n >= 0) : [];
 const origins = entrances.length ? (transit?entrances.filter(id=>id!==undefined):[entrances[0]]) : (bedAreas[0]?.areas||[]).map(area => area.node).filter(id => id !== undefined);
 for (const origin of origins) {
  const parents = new Map([[origin, null]]), queue = [origin];
  for (let n = 0; n < queue.length; n++) for (const neighbor of nodes[queue[n]].neighbors) {
   if (!parents.has(neighbor)) { parents.set(neighbor, queue[n]);queue.push(neighbor); }
  }
  if (!transit&&entrances.some(id => !parents.has(id))) continue;
  const chosen = bedAreas.map(({bed, areas}) => ({bed, area: areas.find(area => parents.has(area.node))}));
  if (!transit&&chosen.some(({area}) => !area)) continue;
  const turn = turningCandidates.find(id => parents.has(id));
  if (!transit&&requiresTurn && turn === undefined) continue;
  turningPoint = turn === undefined ? null : nodes[turn].point;
  for (const {bed, area} of chosen) if(area)transfers.push({id: bed.id, side: area.side, point: area.point});
  const entryIndex=entrances.indexOf(origin);
  const destinations = [
   ...entrances.map((node,index)=>({node,key:`door:${index}`,center:doors[index].center})).slice(entryIndex+1),
   ...(transit
    ? bedAreas.flatMap(({bed,areas})=>(!requiresTurn||turn!==undefined)?areas.map(area=>({node:area.node,key:`bed:${bed.id}:${area.side}`})):[])
    : chosen.filter(({area})=>area).map(({bed,area})=>({node:area.node,key:`bed:${bed.id}`}))),
   {node:transit&&room.planRoom?.kind==='bathroom'&&!requiresTurn?origin:turn,key:'arrival'}
  ];
  if (includePaths) for (const {node:destination,key,center} of destinations) {
   if(!parents.has(destination) || (!transit&&destination===origin))continue;
   const path = [];
   for (let id = destination; id !== null; id = parents.get(id)) path.push(nodes[id].point);
   path.reverse();
   // Keep the checked radius when replacing grid steps with direct segments.
   for(let n=0;n+2<path.length;n++){
    let target=path.length-1;
    while(target>n+1&&!clearSegment(path[n],path[target]))target--;
    if(target>n+1)path.splice(n+1,target-n-1);
   }
   if (entryIndex>=0) path.unshift(doors[entryIndex].center);
   if (center) path.push(center);
   paths.push(path);
   if(transit&&entryIndex>=0)connections.push({from:`door:${entryIndex}`,to:key,path});
  }
  if(!transit)return result();
 }
 if(transit&&connections.length)return result();
 failures.push({rule:'route',message:beds.length ? '找不到通往床側、各門口及所需轉向位置的連續路線。試轉床或移走阻擋的家具。' : '門口之間或輪椅轉向位置被擋住，請調整家具。'});
 return result();
}
