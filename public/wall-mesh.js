import * as THREE from './vendor/three.module.js';
import clipping from './vendor/polygon-clipping.js';
import {openingsOnBlock} from './wall-openings.js';

const closed=ring=>ring.length&&ring[0][0]===ring.at(-1)[0]&&ring[0][1]===ring.at(-1)[1]?ring:[...ring,ring[0]];
const rectangle=b=>[[[b.x0,b.y0],[b.x1,b.y0],[b.x1,b.y1],[b.x0,b.y1],[b.x0,b.y0]]];
export function contourWallLayers(home){
 const source=(home.walls?.contours||[]).map(s=>[closed(s.outer),...(s.holes||[]).map(closed)]);
 if(!source.length)return [];
 const height=home.height,blocks=home.walls?.blocks||[],openings=[];
 for(const [kind,list] of [['door',home.doors||[]],['window',home.windows||[]]])for(const o of list){
  if(kind==='window'&&o.wallFootprint){
   const f=o.wallFootprint,top=Math.min(2.1,height-.15);
   if([f.x0,f.x1,f.y0,f.y1].every(Number.isFinite)&&f.x1>f.x0&&f.y1>f.y0)openings.push({kind,bottom:Math.min(.85,top-.2),top,polygon:rectangle(f)});
   continue;
  }
  const supports=blocks.flatMap(block=>{
   const match=openingsOnBlock(block,kind==='door'?[o]:[],kind==='window'?[o]:[],height)[0];
   return match?[{block,match,overlap:match.to-match.from}]:[];
  }).sort((a,b)=>b.overlap-a.overlap);
  if(!supports.length)continue;
  const {block,match}=supports[0],b=o.horizontal?{x0:o.x-o.w/2,x1:o.x+o.w/2,y0:block.y0,y1:block.y1}:{x0:block.x0,x1:block.x1,y0:o.z-o.d/2,y1:o.z+o.d/2};
  openings.push({...match,polygon:rectangle(b)});
 }
 // 门窗原本可把 wall 类切成两块；补回洞口的平面范围后再按高度切除，过梁才会连续。
 const envelope=openings.length?clipping.union(source,...openings.map(o=>o.polygon)):source;
 const heights=[...new Set([0,height,...openings.flatMap(o=>[o.bottom,o.top])])].sort((a,b)=>a-b),layers=[];
 for(let i=1;i<heights.length;i++){
  const bottom=heights[i-1],top=heights[i];if(top-bottom<1e-6)continue;
  const mid=(bottom+top)/2,cuts=openings.filter(o=>mid>o.bottom&&mid<o.top).map(o=>o.polygon);
  const polygons=cuts.length?clipping.difference(envelope,...cuts):envelope;
  if(polygons.length)layers.push({bottom,top,polygons});
 }
 return layers;
}

export function buildContourWallMeshes(home,material,overview){
 return contourWallLayers(home).map(layer=>{
  const shapes=layer.polygons.map(([outer,...holes])=>{
   const shape=new THREE.Shape(outer.map(([x,z])=>new THREE.Vector2(x,-z)));
   for(const ring of holes)shape.holes.push(new THREE.Path(ring.map(([x,z])=>new THREE.Vector2(x,-z))));
   return shape;
  });
  // 一层的所有墙岛共用一个几何体，避免轮廓细碎时产生几百个 draw call。
  const geometry=new THREE.ExtrudeGeometry(shapes,{depth:layer.top-layer.bottom,bevelEnabled:false,steps:1,curveSegments:1});
  geometry.rotateX(-Math.PI/2);
  const mesh=new THREE.Mesh(geometry,material);mesh.position.y=layer.bottom;mesh.castShadow=!overview;
  mesh.userData.wall=true;mesh.userData.wallPart='contour';mesh.userData.bottom=layer.bottom;mesh.userData.top=layer.top;
  return mesh;
 });
}
