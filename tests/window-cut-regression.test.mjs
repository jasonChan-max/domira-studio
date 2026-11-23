import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import * as THREE from '../public/vendor/three.module.js';
import {geometryFromSegmentation,homeFromRecognition} from '../public/floorplan-geometry.js';
import {buildHomeGeometry} from '../public/home-scene.js';
import {buildContourWallMeshes,contourWallLayers} from '../public/wall-mesh.js';
import {openingsToHome} from '../public/opening-detection.js';
import {validateHome} from '../public/home-domain.js';
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/wall-repair-round4.json',import.meta.url)));
const load=name=>{const data=fixtures.cases[name];return {...data,mask:new Uint8Array(gunzipSync(Buffer.from(data.mask,'base64')))};};
const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
function auditWindows(home,group){
 group.updateMatrixWorld(true);const walls=group.children.filter(m=>m.userData.wall);
 assert.equal(group.children.filter(m=>m.userData.window).length,home.windows.length);
 for(const w of home.windows){
  const f=w.wallFootprint,glass=w.horizontal?w.w:w.d;
  assert.ok(Math.abs((w.horizontal?f.x1-f.x0:f.y1-f.y0)-glass)<1e-8);
  assert.ok(Math.abs((w.horizontal?(f.x0+f.x1)/2-w.x:(f.y0+f.y1)/2-w.z))<1e-8);
  for(const offset of [-.25,0,.25]){
   const along=w.horizontal?w.x+w.w*offset:w.z+w.d*offset,origin=w.horizontal?new THREE.Vector3(along,0,f.y0-.05):new THREE.Vector3(f.x0-.05,0,along),direction=w.horizontal?new THREE.Vector3(0,0,1):new THREE.Vector3(1,0,0),far=(w.horizontal?f.y1-f.y0:f.x1-f.x0)+.1;
   const hit=y=>{origin.y=y;return new THREE.Raycaster(origin,direction,0,far).intersectObjects(walls).length>0;};
   assert.equal(hit(.4),true);assert.equal(hit(1.5),false);assert.equal(hit(2.4),true);
  }
 }
 group.traverse(m=>m.geometry?.dispose());
}

test('分割窗质心偏离 bbox 中心时，沿墙洞口与玻璃仍同中心同长度',()=>{
 const home=openingsToHome([{cx:6.5,cy:2,w:4,h:2,horizontal:true,wallSupport:{footprint:{x0:4,x1:8,y0:1,y1:3}}}],{x:0,y:0,w:10,h:10},10,10);
 assert.equal(home[0].wallFootprint.x0,home[0].x-home[0].w/2);assert.equal(home[0].wallFootprint.x1,home[0].x+home[0].w/2);
});
test('窄 footprint 不再留下堵窗的墙皮，洞的长度按玻璃而非旧框裁切',()=>{
 const home={height:2.7,rooms:[],windows:[{x:0,z:0,w:1.2,d:.16,horizontal:true,wallFootprint:{x0:-.2,x1:.2,y0:-.08,y1:.08}}],walls:{contours:[{outer:[[-2,-.13],[2,-.13],[2,.13],[-2,.13]],holes:[]}]}};
 const group=new THREE.Group();buildContourWallMeshes(home,material,false).forEach(m=>group.add(m));group.updateMatrixWorld(true);
 for(const x of [-.61,-.3,0,.3,.61]){
  const hit=y=>new THREE.Raycaster(new THREE.Vector3(x,y,-1),new THREE.Vector3(0,0,1)).intersectObjects(group.children).length>0;
  assert.equal(hit(.4),true);assert.equal(hit(1.5),false);assert.equal(hit(2.4),true);
 }
 const layers=contourWallLayers(home);assert.ok(layers.length===3);assert.ok(layers.at(-1).top===home.height);
 group.traverse(m=>m.geometry?.dispose());
});
// 被封门步骤分离的下飘窗改为窗台，不再计作第九间房；两扇真实飘窗现在进入窗数据。
for(const [name,rooms,windows] of [['r2',8,12],['46',4,7],['r10',13,13]])test(name+' 冻结原图可建房且逐窗三点下墙/洞口/上墙均通过',()=>{
 const data=load(name),recognized=geometryFromSegmentation(data,data.boxes),home=JSON.parse(JSON.stringify(homeFromRecognition(recognized,10,10*recognized.frame.h/recognized.frame.w)));
 assert.equal(home.rooms.length,rooms);assert.equal(home.windows.length,windows);validateHome(home);
 if(name==='r2'){
  assert.equal(home.doors.length,10);assert.deepEqual(recognized.doors.map(({x,y,w,h,score})=>({x,y,w,h,score})),data.boxes.filter(b=>b.cls==='door').map(({x,y,w,h,score})=>({x,y,w,h,score})));
  assert.equal(data.boxes.filter(b=>b.cls==='window'&&b.h>b.w&&b.x<100&&b.y<285&&b.y+b.h>150).length,0);
 }
 auditWindows(home,buildHomeGeometry(home,false));
});
