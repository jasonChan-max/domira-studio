import {CARE_FLOORING} from './care-flooring.js';
import * as THREE from './vendor/three.module.js';
import {box} from './furniture.js';
import {planWalls,HOME_COLORS} from './home-domain.js';
export function buildHomeGeometry(home,overview=true){const group=new THREE.Group();const slab=box(group,home.width,.06,home.depth,'#ece9e1',0,-.07,0);slab.userData.slab=true;for(const r of home.rooms){
  const color=CARE_FLOORING[r.flooring]?.color||HOME_COLORS[r.kind]||'#b4baa9';
  if(Array.isArray(r.polygon)&&r.polygon.length>=3){
   // 多邊形房間（梯形陽台、L 形客廳）：用 ShapeGeometry 畫出真實輪廓，而不是外接矩形。
   // polygon 的點是相對房間中心的公尺座標，ShapeGeometry 在 XY 平面，rotateX(-90°) 後對應 XZ。
   const shape=new THREE.Shape(r.polygon.map(pt=>new THREE.Vector2(pt[0],-pt[1])));
   const geo=new THREE.ShapeGeometry(shape);geo.rotateX(-Math.PI/2);
   const mesh=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color,roughness:.9,side:THREE.DoubleSide}));
   mesh.position.set(r.x,-.005,r.z);mesh.userData.roomId=r.id;group.add(mesh);
   const pts=r.polygon.map(pt=>new THREE.Vector3(r.x+pt[0],.006,r.z+pt[1]));
   const loop=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:'#c2d8c6',transparent:true,opacity:.55}));
   group.add(loop);
  }else{
   const floor=box(group,r.width,.08,r.depth,color,r.x,-.045,r.z);floor.userData.roomId=r.id;
   const outline=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(r.width,.012,r.depth)),new THREE.LineBasicMaterial({color:'#c2d8c6',transparent:true,opacity:.25}));
   outline.position.set(r.x,.006,r.z);group.add(outline);
  }
 }const wallMaterial=new THREE.MeshStandardMaterial({color:'#d8ddd3',roughness:.82,transparent:overview,opacity:overview?.42:1,depthWrite:!overview,side:THREE.DoubleSide});
 // 門板：2026-11-18 查出來的「3D 沒門」根因——home.doors 一直有資料（分割或 YOLO 給的），
 // 但 planWalls 只從 room.openings 取門，而 roomsFromPolygons 建的房間 openings 是空的，
 // 所以 3D 那段 kind==='door' 的分支從來沒觸發過，home.doors 只被 2D SVG 用過。
 // 先畫一片木色薄板把門標出來；牆仍然整段畫，門洞沒有真的切開。
 const doorH=2.05;
 for(const d of (home.doors||[])){
  if(!Number.isFinite(d.x)||!Number.isFinite(d.z))continue;
  const w=d.horizontal?Math.max(.5,d.w??.9):.07;
  const dep=d.horizontal?.07:Math.max(.5,d.d??.9);
  const leaf=box(group,w,doorH,dep,'#b98a5a',d.x,doorH/2,d.z);
  leaf.castShadow=!overview;
  leaf.userData.door=true;
 }const segment=(s,height,y,material=wallMaterial)=>{const wall=box(group,s.axis==='x'?s.length:.09,height,s.axis==='z'?s.length:.09,material,s.x,y,s.z);wall.castShadow=!overview;};const segRange=(s,a,b,height,y,material=wallMaterial)=>{const len=b-a,mid=(a+b)/2;const wall=box(group,s.axis==='x'?len:.09,height,s.axis==='z'?len:.09,material,s.axis==='x'?mid:s.x,y,s.axis==='z'?mid:s.z);wall.castShadow=!overview;};
 // 把牆在門的位置切開（2026-11-18）：只畫門板而不切牆，視覺上就是「門貼在牆上」。
 // 門的 bbox 來自 YOLO 檢測或分割的 door 類，和牆線不一定完全對齊，
 // 所以用「中心落在這條牆線 ±0.2 m 內、且重疊 >0.15 m」來配對，門洞上方補過梁。
 const doorSegments=(s)=>{
  const along=s.axis==='x';
  const lo=along?s.x-s.length/2:s.z-s.length/2;
  const hi=along?s.x+s.length/2:s.z+s.length/2;
  const coord=along?s.z:s.x;
  return (home.doors||[]).map(d=>{
   const line=along?d.z:d.x;
   if(!Number.isFinite(line)||Math.abs(line-coord)>.2)return null;
   const c=along?d.x:d.z,half=along?Math.max(.45,d.w??.9)/2:Math.max(.45,d.d??.9)/2;
   const a=Math.max(lo,c-half),b=Math.min(hi,c+half);
   return b-a>.15?[a,b]:null;
  }).filter(Boolean).sort((p,q)=>p[0]-q[0]);
 };
 for(const s of planWalls(home)){if(s.kind==='door'){const top=Math.min(2.1,s.height-.15);segment(s,s.height-top,(s.height+top)/2);}else if(s.kind==='window'){const top=Math.min(2.1,s.height-.15),sill=Math.min(.85,top-.2);segment(s,sill,sill/2);segment(s,s.height-top,(s.height+top)/2);const glass=new THREE.MeshPhysicalMaterial({color:'#a5c5cf',transparent:true,opacity:.22,roughness:.15,metalness:.15,side:THREE.DoubleSide});segment(s,top-sill,(top+sill)/2,glass);}else{
  const cuts=doorSegments(s);
  if(!cuts.length){segment(s,s.height,s.height/2);continue;}
  const along=s.axis==='x';
  const lo=along?s.x-s.length/2:s.z-s.length/2,hi=along?s.x+s.length/2:s.z+s.length/2;
  const top=Math.min(2.1,s.height-.15);
  let cur=lo;
  for(const [a,b] of cuts){
   if(a-cur>.05)segRange(s,cur,a,s.height,s.height/2);
   if(s.height-top>.05)segRange(s,a,b,s.height-top,(s.height+top)/2);
   cur=Math.max(cur,b);
  }
  if(hi-cur>.05)segRange(s,cur,hi,s.height,s.height/2);
 }}return group;}
