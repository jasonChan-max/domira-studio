import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {doorsToHome} from '../public/opening-detection.js';
import {geometryFromSegmentation,homeFromRecognition,attachDetectedOpenings} from '../public/floorplan-geometry.js';
import {buildHomeGeometry} from '../public/home-scene.js';
const frame={x:0,y:0,w:100,h:100};
const box=(long,short,score=.8,vertical=false,offY=0)=>({x:20,y:20+offY,w:(vertical?short:long)*10,h:(vertical?long:short)*10,horizontal:!vertical,score,cls:'door'});
function load(name){const data=JSON.parse(readFileSync(new URL('./fixtures/wall-repair-round4.json',import.meta.url))).cases[name];return {...data,mask:new Uint8Array(gunzipSync(Buffer.from(data.mask,'base64')))};}
function recognized(name){const data=load(name),result=geometryFromSegmentation(data,data.boxes),depth=10*result.frame.h/result.frame.w;return {data,result,depth,home:homeFromRecognition(result,10,depth)};}

test('推拉门 1.2–3.0m 要保留，超长假框与 0.6m 厚的大框要拒绝',()=>{
 // 推拉门（阳台／客厅隔断）本来就有 2–3 米宽，不能用「超过 2m 就是假门」一刀切。
 const input=[box(1.864,.327,.7,true),box(1.30,.21,.32),box(2.6,.21,.385),box(3.5,.21,.385),box(1.86,.60,.363),box(.23,.16,.385),box(.60,.16,.281)],before=structuredClone(input),r=doorsToHome(input,frame,10,10);
 assert.equal(r.doors.length,3);assert.deepEqual(r.doors.map(d=>d.sourceIndex),[0,1,2]);assert.equal(r.rejected.length,4);assert.deepEqual(input,before);
 assert.equal(r.doors.filter(d=>d.kind==='sliding').length,3);
 assert.ok(r.rejected.find(c=>c.index===3).reasons.some(s=>s.includes('推拉门宽')));
 assert.ok(r.rejected.find(c=>c.index===4).reasons.some(s=>s.includes('门厚')));
});
test('门宽、门厚和分数边界均含端点，任一闸失败都拒绝',()=>{
 // 每个 box 给不同 y，否则同址的框会被门洞去重合并，测不到各自的门宽/门厚闸。
 const r=doorsToHome([box(.45,.10,.30,false,0),box(2,.40,.30,false,12),box(.449,.20,.8,false,24),box(2.001,.20,.8,false,36),box(.8,.099,.8,false,48),box(.8,.401,.8,false,60),box(.8,.20,.299,false,72),box(3.001,.20,.8,false,84)],frame,10,10);
 // 2.001m 是推拉门（1.2–3.0 上限内），不是超宽假门；3.001m 才越界。
 assert.equal(r.doors.length,3);assert.deepEqual(r.checks.map(c=>c.valid),[true,true,false,true,false,false,false,false]);
});
test('无置信度的分割回退不伪造分数，非法坐标或显式无效分数不能绕过闸',()=>{
 const fallback=box(.9,.2);delete fallback.score;
 const r=doorsToHome([fallback,box(.9,.2,NaN),{...box(.9,.2),x:NaN}],frame,10,10);
 assert.equal(r.doors.length,1);assert.equal('score' in r.doors[0],false);assert.equal(r.checks[0].score,null);
 assert.equal(doorsToHome([fallback],{...frame,x:NaN},10,10).doors.length,0);
});
test('尺寸使用米制和横纵独立比例，不能拿像素阈值误筛门',()=>{
 const r=doorsToHome([{x:20,y:20,w:10,h:4,score:.8,horizontal:true}],frame,20,5);
 assert.equal(r.doors.length,1);assert.equal(r.checks[0].longSide,2);assert.equal(r.checks[0].shortSide,.2);
});
test('R(2) 原始14候选采用10个（含2.59m推拉门），模型与AI接入共用闸；门高仍是2.05m',()=>{
 const {result,home,depth}=recognized('r2');
 assert.equal(result.doors.length,14);assert.equal(home.doors.length,10);assert.deepEqual(home.selection.doors.rejected.map(c=>c.index),[9,10,12,13]);
 assert.ok(home.doors.every(d=>Math.max(d.w,d.d)<=3&&Math.min(d.w,d.d)>=.1&&Math.min(d.w,d.d)<=.4&&d.score>=.3));
 // 推拉门要单独标出来，渲染层才能区分「一扇平开门」和「一段推拉门」。
 assert.ok(home.doors.filter(d=>d.kind==='sliding').length>=2);
 assert.ok(home.doors.filter(d=>d.kind==='sliding').every(d=>Math.max(d.w,d.d)>=1.2));
 const ai={width:10,depth,rooms:[{id:'manual',x:0,z:0,width:2,depth:2}]},before=structuredClone(ai.rooms);attachDetectedOpenings(ai,result);
 assert.equal(ai.doors.length,10);assert.deepEqual(ai.rooms,before);assert.equal(ai.windows.length,12);
 const group=buildHomeGeometry(home,false),leaves=group.children.filter(m=>m.userData.door);
 assert.equal(leaves.length,10);assert.ok(leaves.every(m=>m.geometry.parameters.height===2.05));group.traverse(m=>m.geometry?.dispose());
});
test('所有YOLO门被闸值拒绝时不重新塞入分割门，窗数据仍保留',()=>{
 const {result,depth}=recognized('r2'),r={...result,doors:result.doors.map(d=>({...d,score:.1}))},home=homeFromRecognition(r,10,depth);
 assert.equal(home.doors.length,0);assert.equal(home.windows.length,12);assert.equal(home.selection.doors.rejected.length,14);
});
for(const [name,expected] of [['46',4],['r10',7]])test(name+' 所有既有门通过尺寸闸，不误删宽门和0.475m小门',()=>{
 const {home}=recognized(name);assert.equal(home.doors.length,expected);assert.equal(home.selection.doors.rejected.length,0);
 if(name==='46')assert.ok(home.doors.some(d=>Math.abs(Math.max(d.w,d.d)-1.8643679486714326)<1e-8));
 if(name==='r10')assert.ok(home.doors.some(d=>Math.abs(Math.max(d.w,d.d)-.4749193494169467)<1e-8));
});
