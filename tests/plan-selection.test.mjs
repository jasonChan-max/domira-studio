import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three.module.js';
import {geometryFromSegmentation,homeFromRecognition} from '../public/floorplan-geometry.js';
import {closeDetectedDoorFloors,selectHouseContours,selectSupportedWindows} from '../public/plan-selection.js';
import {roomsFromMask} from '../public/room-polygon.js';
import {buildHomeGeometry} from '../public/home-scene.js';

function fixture(){
 const width=100,height=100,mask=new Uint8Array(width*height).fill(4);
 for(let y=10;y<90;y++)for(let x=10;x<90;x++)mask[y*width+x]=(x<14||x>=86||y<14||y>=86||(x>=48&&x<52)||(y>=48&&y<52))?1:0;
 for(let y=48;y<52;y++)for(let x=25;x<35;x++)mask[y*width+x]=0;
 for(let y=2;y<5;y++)for(let x=30;x<60;x++)mask[y*width+x]=0;
 for(let y=20;y<70;y++)for(let x=2;x<5;x++)mask[y*width+x]=1;
 for(let y=20;y<24;y++)for(let x=65;x<70;x++)mask[y*width+x]=1;
 for(let y=10;y<14;y++)for(let x=23;x<37;x++)mask[y*width+x]=3;
 const boxes=[{x:25,y:48,w:10,h:4,cls:'door',score:.9},{x:23,y:10,w:14,h:4,cls:'window',score:.9},{x:28,y:1,w:14,h:3,cls:'window',score:.8},{x:48,y:23,w:4,h:14,cls:'window',score:.8}];
 return {width,height,mask,boxes};
}
test('封门恢复合法房间、去掉屋外窄缝，原始分割和门位置不变',()=>{
 const f=fixture(),before=f.mask.slice(),doors=f.boxes.filter(b=>b.cls==='door');
 const closed=closeDetectedDoorFloors(f.mask,f.width,f.height,doors);
 assert.deepEqual(f.mask,before);assert.equal(closed[49*100+30],2);assert.equal(closed[49*100+40],1);
 const raw=roomsFromMask(before,100,100),result=geometryFromSegmentation(f,f.boxes),home=homeFromRecognition(result,8,8);
 assert.equal(raw.length,4);assert.equal(result.selection.rooms.candidates,5);assert.equal(home.rooms.length,4);
 assert.ok(home.rooms.every(r=>Math.min(r.width,r.depth)>=.6));assert.deepEqual(f.mask,before);
});
test('主体轮廓筛选移除外部分离墙，保留内圈和小面积合法短墙',()=>{
 const f=fixture(),result=geometryFromSegmentation(f,f.boxes);
 assert.ok(result.selection.contours.rejected.length>0);assert.equal(result.frame.x,10);assert.equal(result.frame.y,10);
 assert.ok(result.lines.contours.some(s=>s.outer.every(([x,y])=>x>=65&&x<=70&&y>=20&&y<=24)));
 const inner={outer:[[30,30],[40,30],[40,40],[30,40]],holes:[],areaPixels:100};
 const outer={outer:[[10,10],[90,10],[90,90],[10,90]],holes:[[[20,20],[20,80],[80,80],[80,20]]],areaPixels:2800};
 const distant={outer:[[1,1],[3,1],[3,3],[1,3]],holes:[],areaPixels:4};
 const selected=selectHouseContours([outer,inner,distant],[{bbox:[20,20,80,80],pixels:3600}]);
 assert.deepEqual(selected.contours,[outer,inner]);assert.equal(selected.contours[0].holes.length,1);
});
test('米制房间下限在数据层过滤，不在 UI 删除，也不伪造缺失房间',()=>{
 const f=fixture(),result=geometryFromSegmentation(f,f.boxes);
 result.polygons.push({polygon:[[20,20],[22,20],[22,22],[20,22]],bbox:[20,20,22,22],area:4,pixels:4});
 const home=homeFromRecognition(result,8,8);
 assert.equal(home.rooms.length,4);assert.equal(home.selection.rooms.removedBelowMinimum.length,1);
 assert.throws(()=>homeFromRecognition({...result,polygons:result.polygons.slice(-1)},8,8),/0.6m/);
});
test('窗选择器保留墙端支持规则，内部候选由位置分类转为门',()=>{
 const f=fixture(),r=geometryFromSegmentation(f,f.boxes),home=homeFromRecognition(r,8,8);
 assert.equal(r.selection.windows.raw,3);assert.equal(home.windows.length,1);assert.equal(selectSupportedWindows(f.mask,f.width,f.height,f.boxes.filter(b=>b.cls==='window'),r.frame).rejected.length,2);assert.ok(r.doors.some(b=>b.originalClass==='window'&&b.classification==='interior-door'));
 assert.ok(home.windows[0].wallFootprint);
 const group=buildHomeGeometry(home,false);group.updateMatrixWorld(true);
 assert.equal(group.children.filter(o=>o.userData.window).length,home.windows.length);
 const w=home.windows[0],bounds=w.wallFootprint,walls=group.children.filter(o=>o.userData.wall);
 const hit=y=>new THREE.Raycaster(new THREE.Vector3(w.x,y,bounds.y0-.05),new THREE.Vector3(0,0,1),0,bounds.y1-bounds.y0+.1).intersectObjects(walls).length>0;
 assert.equal(hit(.4),true);assert.equal(hit(1.5),false);assert.equal(hit(2.4),true);
});
test('没有门候选时不会凭空封墙、编造房间',()=>{
 const f=fixture();assert.deepEqual(closeDetectedDoorFloors(f.mask,100,100,[]),f.mask);
 const r=geometryFromSegmentation(f,f.boxes.filter(b=>b.cls!=='door'));
 assert.equal(homeFromRecognition(r,8,8).rooms.length,3);
});
