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
 }const wallMaterial=new THREE.MeshStandardMaterial({color:'#d8ddd3',roughness:.82,transparent:overview,opacity:overview?.42:1,depthWrite:!overview,side:THREE.DoubleSide});const segment=(s,height,y,material=wallMaterial)=>{const wall=box(group,s.axis==='x'?s.length:.09,height,s.axis==='z'?s.length:.09,material,s.x,y,s.z);wall.castShadow=!overview;};for(const s of planWalls(home)){if(s.kind==='door'){const top=Math.min(2.1,s.height-.15);segment(s,s.height-top,(s.height+top)/2);}else if(s.kind==='window'){const top=Math.min(2.1,s.height-.15),sill=Math.min(.85,top-.2);segment(s,sill,sill/2);segment(s,s.height-top,(s.height+top)/2);const glass=new THREE.MeshPhysicalMaterial({color:'#a5c5cf',transparent:true,opacity:.22,roughness:.15,metalness:.15,side:THREE.DoubleSide});segment(s,top-sill,(top+sill)/2,glass);}else segment(s,s.height,s.height/2);}return group;}
