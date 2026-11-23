import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {doorsToHome,doorWallMedian} from '../public/opening-detection.js';
import {geometryFromSegmentation,homeFromRecognition,attachDetectedOpenings} from '../public/floorplan-geometry.js';
import {buildHomeGeometry} from '../public/home-scene.js';
const frame={x:0,y:0,w:100,h:100},walls=t=>({wallBlocks:[{x0:0,y0:0,x1:100,y1:t}]}),box=(w,h,score=.8)=>({x:20,y:20,w,h,score,horizontal:w>=h,cls:'door'});
const select=(boxes,context=walls(10),width=10,depth=10)=>doorsToHome(boxes,frame,width,depth,context);
function recognized(name){const data=JSON.parse(readFileSync(new URL('./fixtures/wall-repair-round4.json',import.meta.url))).cases[name],mask=new Uint8Array(gunzipSync(Buffer.from(data.mask,'base64'))),result=geometryFromSegmentation({...data,mask},data.boxes),depth=10*result.frame.h/result.frame.w;return {result,depth,home:homeFromRecognition(result,10,depth)};}

test('rWidth=4.8的窄门、rThick=1.7保留；rWidth=22和rThick=5拒绝',()=>{
 const boxes=[box(48,17),box(220,17),box(80,50)],before=structuredClone(boxes),r=select(boxes);
 assert.deepEqual(r.checks.map(c=>c.valid),[true,false,false]);assert.equal(r.checks[0].rWidth,4.8);assert.equal(r.checks[0].rThick,1.7);assert.deepEqual(boxes,before);
});
test('相对倍数与score端点均包含，不暗中放宽下限1.0',()=>{
 const r=select([box(30,10,.30),box(120,20,.30),box(29.99,10),box(120.01,10),box(48,9.8),box(48,20.01),box(48,17,.299)]);
 assert.deepEqual(r.checks.map(c=>c.valid),[true,true,false,false,false,false,false]);
});
test('优先候选自己的nearestWall，非法局部墙厚回退全局中位',()=>{
 const r=select([{...box(48,17),nearestWall:{thickness:10}},{...box(48,17),wallSupport:{nearestWall:{thickness:10}}},{...box(48,17),nearestWall:{thickness:NaN}}],walls(20));
 assert.deepEqual(r.checks.map(c=>c.valid),[true,true,false]);assert.deepEqual(r.checks.map(c=>c.wallThicknessSource),['nearestWall','nearestWall','global-median']);
});
test('墙厚均不可得时拒绝并记录，不能退回循环依赖的绝对米数',()=>{
 const r=select([box(48,17)],{});assert.equal(r.doors.length,0);assert.equal(r.checks[0].wallThicknessSource,'unavailable');assert.match(r.rejected[0].reasons.join(),/无法取得/);
 assert.equal(select([{...box(48,17),nearestWall:{thickness:10}}],{}).doors.length,1);
});
test('全局墙厚沿用墙块几何短边的上中位数，忽略无效块且不修改输入',()=>{
 const b=[{x0:0,x1:100,y0:0,y1:8},{x0:0,x1:100,y0:0,y1:12},{x0:0,x1:NaN,y0:0,y1:12}],before=structuredClone(b);
 assert.equal(doorWallMedian(b),12);assert.deepEqual(b,before);assert.equal(doorWallMedian([]),null);
});
test('同轴缩放图像和墙厚、改变估计米数均不改变采用结果',()=>{
 const b=[box(48,17),box(220,17)],a=select(b),differentMeters=select(b,walls(10),20,5),resized=select(b.map(d=>({...d,x:d.x*2,y:d.y*2,w:d.w*2,h:d.h*2})),walls(20));
 assert.deepEqual(a.checks.map(c=>c.valid),differentMeters.checks.map(c=>c.valid));assert.deepEqual(a.checks.map(c=>c.rWidth),resized.checks.map(c=>c.rWidth));assert.notEqual(a.checks[0].longSide,differentMeters.checks[0].longSide);
});
test('分割回退不伪造分数，显式无效分数或坐标仍被拒绝',()=>{
 const fallback=box(48,17);delete fallback.score;const r=select([fallback,box(48,17,NaN),{...box(48,17),x:NaN}]);
 assert.equal(r.doors.length,1);assert.equal('score' in r.doors[0],false);assert.equal(r.checks[0].score,null);
});
test('1.864m宽门保留，2.6m假门和0.6m厚框按相对倍数拒绝',()=>{
 const r=select([box(18.64,3.27),box(26,2.1),box(18.6,6)],walls(1.8));assert.deepEqual(r.checks.map(c=>c.valid),[true,false,false]);
});
test('R(2)原始14候选仍采用9门，两条接入路径一致，门高2.05m不变',()=>{
 const {result,home,depth}=recognized('r2');assert.equal(result.doors.length,14);assert.equal(home.doors.length,9);assert.deepEqual(home.selection.doors.rejected.map(c=>c.index),[8,9,10,12,13]);
 const ai={width:10,depth,rooms:[{id:'manual',x:0,z:0,width:2,depth:2}]},before=structuredClone(ai.rooms);attachDetectedOpenings(ai,result);assert.deepEqual(ai.doors,home.doors);assert.deepEqual(ai.rooms,before);assert.equal(ai.windows.length,12);
 const g=buildHomeGeometry(home,false),leaves=g.children.filter(m=>m.userData.door);assert.equal(leaves.length,9);assert.ok(leaves.every(m=>m.geometry.parameters.height===2.05));g.traverse(m=>m.geometry?.dispose());
});
test('全被拒绝时不重新塞回分割门，R(2)12扇窗仍保留',()=>{
 const {result,depth}=recognized('r2'),home=homeFromRecognition({...result,doors:result.doors.map(d=>({...d,score:.1}))},10,depth);assert.equal(home.doors.length,0);assert.equal(home.windows.length,12);
});
test('46宽1.864m门保留；厚度比0.981的第四门严格小于1，明确记录未满足四门目标',()=>{
 const {home}=recognized('46');assert.equal(home.doors.length,3);assert.ok(home.doors.some(d=>Math.abs(Math.max(d.w,d.d)-1.8643679486714326)<1e-8));
 const rejected=home.selection.doors.rejected;assert.equal(rejected.length,1);assert.equal(rejected[0].index,3);assert.ok(rejected[0].rThick<1&&rejected[0].rThick>.98);assert.equal(home.windows.length,7);
});
test('R(10)全部7门保留，包括0.475m窄门',()=>{
 const {home}=recognized('r10');assert.equal(home.doors.length,7);assert.equal(home.selection.doors.rejected.length,0);assert.ok(home.doors.some(d=>Math.abs(Math.max(d.w,d.d)-.4749193494169467)<1e-8));assert.equal(home.windows.length,13);
});
