import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import * as THREE from '../public/vendor/three.module.js';
import clipping from '../public/vendor/polygon-clipping.js';
import {assessWindowSupport,selectSupportedWindows,closeDetectedDoorFloors,MAX_WINDOW_WALL_RATIO,MIN_BAY_WINDOW_ASPECT} from '../public/plan-selection.js';
import {geometryFromSegmentation,homeFromRecognition,scaleDetectedGeometry} from '../public/floorplan-geometry.js';
import {windowPanels,rectangleRing} from '../public/bay-window.js';
import {buildHomeGeometry} from '../public/home-scene.js';
import {homePlanSVG,validateHome} from '../public/home-domain.js';
import {wallMaskFidelity} from '../public/wall-contours.js';
import {roomsFromMask} from '../public/room-polygon.js';
import {openingsToHome} from '../public/opening-detection.js';
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/wall-repair-round4.json',import.meta.url)));
function load(name){const d=fixtures.cases[name];return {...d,mask:new Uint8Array(gunzipSync(Buffer.from(d.mask,'base64')))};}
function recognize(name){const data=load(name),result=geometryFromSegmentation(data,data.boxes);return {data,result,home:homeFromRecognition(result,10,10*result.frame.h/result.frame.w)};}
function auditPanels(home){
 const group=buildHomeGeometry(home,false);group.updateMatrixWorld(true);
 const walls=group.children.filter(m=>m.userData.wall),glass=group.children.filter(m=>m.userData.window);
 assert.equal(glass.length,home.windows.length);
 for(const w of home.windows)for(const p of windowPanels(w))for(const offset of [-.25,0,.25]){
  const f=p.wallFootprint,along=p.horizontal?p.x+p.w*offset:p.z+p.d*offset,origin=p.horizontal?new THREE.Vector3(along,0,f.y0-.05):new THREE.Vector3(f.x0-.05,0,along),direction=p.horizontal?new THREE.Vector3(0,0,1):new THREE.Vector3(1,0,0),far=(p.horizontal?f.y1-f.y0:f.x1-f.x0)+.1;
  const hits=(meshes,y)=>{origin.y=y;return new THREE.Raycaster(origin,direction,0,far).intersectObjects(meshes).length>0;};
  assert.equal(hits(walls,.4),true);assert.equal(hits(walls,1.5),false);assert.equal(hits(walls,2.4),true);assert.equal(hits(glass,1.5),true);
 }
 assert.equal(glass.filter(m=>m.userData.windowKind==='bay').length,home.windows.filter(w=>w.bay).length);
 group.traverse(m=>m.geometry?.dispose());
}
function synthetic(){
 const width=120,height=120,mask=new Uint8Array(width*height).fill(4);
 for(let y=10;y<110;y++)for(let x=10;x<80;x++)mask[y*width+x]=x<16||x>=74||y<16||y>=104?1:0;
 for(let y=27;y<93;y++)for(let x=74;x<106;x++)mask[y*width+x]=x<80||x>=100||y<33||y>=87?3:0;
 return {mask,width,height,frame:{x:10,y:10,w:96,h:100},box:{x:82,y:27,w:24,h:66,cls:'window',score:.8}};
}

test('细长远墙飘窗有三面窗和地板/屋外证据才通过，方框与空白尺寸线被拒',()=>{
 const f=synthetic(),options={blocks:[{x0:74,x1:79,y0:10,y1:24}]};
 const bay=assessWindowSupport(f.mask,120,120,f.box,f.frame,options);
 assert.equal(MAX_WINDOW_WALL_RATIO,5);assert.equal(MIN_BAY_WINDOW_ASPECT,2);assert.equal(bay.valid,true);assert.equal(bay.bay.panels.length,3);assert.ok(bay.nearestWall.ratio>2.5);
 const square=assessWindowSupport(f.mask,120,120,{...f.box,h:26},f.frame,options);assert.equal(square.valid,false);assert.match(square.reason,/方形/);
 const distant=assessWindowSupport(f.mask,120,120,{...f.box,x:98,w:18},f.frame,options);assert.equal(distant.valid,false);assert.ok(distant.nearestWall.ratio>=5);
 const empty=f.mask.map(c=>c===3?4:c);assert.equal(assessWindowSupport(empty,120,120,f.box,f.frame,options).valid,false);
});

test('飘窗识别支持四个朝向，不能只硬编码R(2)右边坐标',()=>{
 let f=synthetic();
 for(const side of ['right','bottom','left','top']){
  const c=assessWindowSupport(f.mask,f.width,f.height,f.box,f.frame);assert.equal(c.valid,true);assert.equal(c.bay.side,side);
  const rotated=new Uint8Array(f.mask.length);
  for(let y=0;y<120;y++)for(let x=0;x<120;x++)rotated[x*120+119-y]=f.mask[y*120+x];
  const rotate=b=>({x:120-b.y-b.h,y:b.x,w:b.h,h:b.w});
  f={...f,mask:rotated,box:{...f.box,...rotate(f.box)},frame:rotate(f.frame)};
 }
});

test('内缘被模型涂成连续地板时，四向飘窗仍须由两端墙垛和三面窗支持',()=>{
 let f=synthetic();for(let y=33;y<87;y++)for(let x=74;x<80;x++)f.mask[y*120+x]=0;
 for(const side of ['right','bottom','left','top']){
  const c=assessWindowSupport(f.mask,120,120,f.box,f.frame);assert.equal(c.valid,true);assert.equal(c.bay.side,side);assert.ok(c.bay.evidence.some(e=>e.rootSource==='两端墙垛'));
  const rotated=new Uint8Array(f.mask.length);for(let y=0;y<120;y++)for(let x=0;x<120;x++)rotated[x*120+119-y]=f.mask[y*120+x];
  const rotate=b=>({x:120-b.y-b.h,y:b.x,w:b.h,h:b.w});f={...f,mask:rotated,box:{...f.box,...rotate(f.box)},frame:rotate(f.frame)};
 }
});

test('R(2) 的两个飘窗与两个大假框明确区分，14门原始数据不被删除',()=>{
 const {data,result,home}=recognize('r2'),checks=result.selection.windows.checks;
 assert.equal(home.windows.length,12);assert.equal(home.windows.filter(w=>w.bay).length,2);assert.equal(home.doors.length,9);
 for(const index of [2,7]){assert.equal(checks[index].valid,true);assert.ok(checks[index].bay);assert.ok(checks[index].aspectRatio>=2);assert.ok(checks[index].nearestWall.ratio<5);}
 for(const index of [9,10]){assert.equal(checks[index].valid,false);assert.ok(checks[index].aspectRatio<2);}
 assert.equal(result.doors.length,data.boxes.filter(b=>b.cls==='door').length);
 const svg=homePlanSVG(home);assert.equal((svg.match(/data-opening="window"/g)||[]).length,12);assert.equal((svg.match(/data-window-kind="bay"/g)||[]).length,2);
});

test('分割回收路径中的飘窗也将质心归到外沿，主窗与三面玻璃不能各用一个中心',()=>{
 const {data,result}=recognize('r2'),normal=data.boxes.find(b=>b.cls==='window');
 const supported=selectSupportedWindows(data.mask,data.width,data.height,[normal],result.frame,{recoverFromSegmentation:true,doors:data.boxes.filter(b=>b.cls==='door')});
 assert.ok(supported.recovered.some(w=>w.bay));
 assert.equal(supported.doors.length,data.boxes.filter(b=>b.cls==='door').length);
 const windows=openingsToHome(supported.windows,result.frame,10,10*result.frame.h/result.frame.w);
 for(const w of windows.filter(w=>w.bay)){const front=w.bay.panels[0];for(const key of ['x','z','w','d'])assert.ok(Math.abs(w[key]-front[key])<1e-8);}
});

test('两扇飘窗三面玻璃均有窗台/过梁且洞口贯通，保存重开与缩放后仍成立',()=>{
 const {home}=recognize('r2'),saved=JSON.parse(JSON.stringify(home));validateHome(saved);auditPanels(saved);
 const before=structuredClone(saved);
 for(const [axis,factor] of [['width',1.2],['depth',.8]]){
  for(const room of saved.rooms){room[axis]*=factor;room[axis==='width'?'x':'z']*=factor;}
  scaleDetectedGeometry(saved,axis,factor);saved[axis]*=factor;
 }
 const a=saved.windows.find(w=>w.bay),b=before.windows.find(w=>w.bay);
 assert.ok(Math.abs(a.bay.seatFootprint.x0-b.bay.seatFootprint.x0*1.2)<1e-8);
 assert.ok(Math.abs(a.bay.panels[0].wallFootprint.y1-b.bay.panels[0].wallFootprint.y1*.8)<1e-8);
 validateHome(saved);auditPanels(saved);
});

test('空间9是封门形成的飘窗地板候选；裁为窗台后不再生成独立房间或外露地板',()=>{
 const {data,result,home}=recognize('r2'),rawRooms=roomsFromMask(data.mask,data.width,data.height);
 assert.equal(rawRooms.length,8);assert.equal(result.selection.rooms.candidates,9);assert.equal(home.rooms.length,8);
 assert.ok(result.selection.rooms.bayFloorChanges.some(c=>c.action==='排除被当作独立房间的飘窗地板'));
 for(const w of home.windows.filter(w=>w.bay))for(const room of home.rooms){
  const floor=room.polygon.map(([x,z])=>[room.x+x,room.z+z]),intersection=clipping.intersection([floor],[rectangleRing(w.bay.seatFootprint)]);
  const area=intersection.reduce((sum,p)=>sum+Math.abs(p[0].reduce((n,a,i)=>{const b=p[0][(i+1)%p[0].length];return n+a[0]*b[1]-b[0]*a[1];},0)/2),0);
  assert.ok(area<.005,'普通房间地板不应覆盖飘窗窗台');
 }
});

test('封门只修改分析副本，Node Buffer 也不能反向污染原始导出mask',()=>{
 const {mask,width,height,boxes}=load('r2'),buffer=Buffer.from(mask),before=Buffer.from(buffer),doors=boxes.filter(b=>b.cls==='door');
 const closed=closeDetectedDoorFloors(buffer,width,height,doors);
 assert.deepEqual(buffer,before);assert.equal(before[604*width+677],0);assert.equal(closed[604*width+677],2);
});

for(const [name,rooms,windows] of [['46',4,7],['r10',13,13]])test(name+' 原有短窗和空间不因新增长宽比门槛退化',()=>{
 const {data,result,home}=recognize(name);assert.equal(home.rooms.length,rooms);assert.equal(home.windows.length,windows);assert.equal(home.windows.filter(w=>w.bay).length,0);
 if(name==='46'){
  assert.equal(result.lines.contours.reduce((n,s)=>n+s.outer.length+s.holes.reduce((n,r)=>n+r.length,0),0),64);
  assert.equal(wallMaskFidelity(result.lines.contours,data.mask,data.width,data.height).precision,1);
  assert.ok(result.selection.windows.checks.some(c=>c.valid&&c.aspectRatio<2));
 }
 auditPanels(home);
});
