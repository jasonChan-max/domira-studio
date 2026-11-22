import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three.module.js';
import {wallContoursFromMask,signedArea,pointInRing} from '../public/wall-contours.js';
import {buildContourWallMeshes,contourWallLayers} from '../public/wall-mesh.js';
import {roomsFromPolygons,homePlanSVG} from '../public/home-domain.js';

const area=shapes=>shapes.reduce((sum,s)=>sum+Math.abs(signedArea(s.outer))-s.holes.reduce((n,r)=>n+Math.abs(signedArea(r)),0),0);
const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
const ray=(meshes,origin,direction)=>{const group=new THREE.Group();meshes.forEach(m=>group.add(m));group.updateMatrixWorld(true);return new THREE.Raycaster(new THREE.Vector3(...origin),new THREE.Vector3(...direction)).intersectObjects(group.children).length;};

test('像素边界轮廓保留锯齿面积，不再把 100 个墙像素扩成 180',()=>{
 const w=60,h=40,mask=new Uint8Array(w*h).fill(4);
 for(let y=5;y<25;y++)for(let x=20+(y%2)*4;x<25+(y%2)*4;x++)mask[y*w+x]=1;
 const exact=wallContoursFromMask(mask,w,h,{epsilon:0}),smooth=wallContoursFromMask(mask,w,h);
 assert.equal(area(exact),100);
 // 简化允许 1px 边界误差，不能要求简化后的面积与锯齿逐像素完全相等。
 const distance=(p,ring)=>Math.min(...ring.map((a,i)=>{const b=ring[(i+1)%ring.length],dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);}));
 for(const p of exact[0].outer)assert.ok(distance(p,smooth[0].outer)<=1+1e-9);
 assert.ok(area(smooth)<180);
 assert.throws(()=>wallContoursFromMask(mask,0,h),/尺寸/);
 assert.throws(()=>wallContoursFromMask(mask,w,h,{epsilon:3}),/容差/);
});
test('闭合外墙保留内部空洞，挤出后的房间中心没有实墙',()=>{
 const w=12,h=12,mask=new Uint8Array(w*h).fill(4);
 for(let y=1;y<11;y++)for(let x=1;x<11;x++)if(x<3||x>=9||y<3||y>=9)mask[y*w+x]=1;
 const shapes=wallContoursFromMask(mask,w,h,{epsilon:0});
 assert.equal(shapes.length,1);assert.equal(shapes[0].holes.length,1);assert.equal(area(shapes),64);
 const meshes=buildContourWallMeshes({height:2.7,walls:{contours:shapes}},material,false);
 assert.equal(meshes.length,1);assert.equal(ray(meshes,[6,5,6],[0,-1,0]),0);assert.ok(ray(meshes,[2,5,6],[0,-1,0])>0);
});
test('轮廓保留 L 形凹角、斜墙台阶和仅顶点接触的独立墙岛',()=>{
 const w=20,h=20,mask=new Uint8Array(w*h).fill(4);
 for(let y=2;y<16;y++)for(let x=2;x<16;x++)if(x<5||y<5)mask[y*w+x]=1;
 const shapes=wallContoursFromMask(mask,w,h,{epsilon:1});
 assert.equal(pointInRing([10,10],shapes[0].outer),false);assert.equal(pointInRing([3,10],shapes[0].outer),true);
 const diagonal=new Uint8Array(16).fill(4);diagonal[0]=diagonal[5]=1;
 assert.equal(wallContoursFromMask(diagonal,4,4,{epsilon:0}).length,2);
 const slope=new Uint8Array(20*20).fill(4);for(let y=2;y<16;y++)for(let x=y;x<y+3;x++)slope[y*20+x]=1;
 const exact=wallContoursFromMask(slope,20,20,{epsilon:0});assert.equal(area(exact),42);
 const meshes=buildContourWallMeshes({height:2.7,walls:{contours:exact}},material,false);
 assert.ok(ray(meshes,[8.5,5,7.5],[0,-1,0])>0);assert.equal(ray(meshes,[2.5,5,10.5],[0,-1,0]),0);
});
test('轮廓挤出真正切开门和窗，门上有过梁、窗下有窗台',()=>{
 const block={x0:-2,x1:2,y0:-.1,y1:.1},contours=[{outer:[[-2,-.1],[2,-.1],[2,.1],[-2,.1]],holes:[]}];
 const opening={x:0,z:0,w:1,d:.2,horizontal:true};
 const doorHome={height:2.7,doors:[opening],walls:{blocks:[block],contours}};
 const doorMeshes=buildContourWallMeshes(doorHome,material,false);
 assert.equal(ray(doorMeshes,[0,1,-1],[0,0,1]),0);assert.ok(ray(doorMeshes,[0,2.4,-1],[0,0,1])>0);
 const windowMeshes=buildContourWallMeshes({...doorHome,doors:[],windows:[opening]},material,false);
 assert.equal(ray(windowMeshes,[0,1.5,-1],[0,0,1]),0);assert.ok(ray(windowMeshes,[0,.4,-1],[0,0,1])>0);assert.ok(ray(windowMeshes,[0,2.4,-1],[0,0,1])>0);
 assert.ok(contourWallLayers({...doorHome,doors:[opening,{...opening,x:.2}]}).length<=3);
});
test('轮廓坐标经房屋换算、JSON 保存和 SVG evenodd 后仍保留内部空洞',()=>{
 const outer=[[10,20],[110,20],[110,120],[10,120]],hole=[[30,40],[30,100],[90,100],[90,40]];
 const home=roomsFromPolygons([{polygon:outer}],150,150,10,10,{frame:{x:10,y:20,w:100,h:100},walls:{hLines:[],vLines:[],contours:[{outer,holes:[hole]}]}});
 const saved=JSON.parse(JSON.stringify(home));
 assert.deepEqual(saved.walls.contours[0].outer,[[-5,-5],[5,-5],[5,5],[-5,5]]);
 assert.equal(saved.walls.contours[0].holes.length,1);assert.match(homePlanSVG(saved),/data-wall="contour"[^>]*fill-rule="evenodd"/);
});
