import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {doorsToHome} from '../public/opening-detection.js';
import {geometryFromSegmentation,homeFromRecognition,attachDetectedOpenings} from '../public/floorplan-geometry.js';
import {buildHomeGeometry} from '../public/home-scene.js';
const symbols=JSON.parse(readFileSync(new URL('./fixtures/opening-symbols.json',import.meta.url)));
const imageGray=name=>({...symbols[name],data:new Uint8Array(gunzipSync(Buffer.from(symbols[name].gray,'base64')))});
const frame={x:0,y:0,w:100,h:100};
const box=(long,short,score=.8,vertical=false,offY=0)=>({x:20,y:20+offY,w:(vertical?short:long)*10,h:(vertical?long:short)*10,horizontal:!vertical,score,cls:'door'});
function load(name){const data=JSON.parse(readFileSync(new URL('./fixtures/wall-repair-round4.json',import.meta.url))).cases[name];return {...data,mask:new Uint8Array(gunzipSync(Buffer.from(data.mask,'base64')))};}
function recognized(name){const data=load(name),result=geometryFromSegmentation(data,data.boxes,{imageGray:imageGray(name)}),depth=10*result.frame.h/result.frame.w;return {data,result,depth,home:homeFromRecognition(result,10,depth)};}

test('室内和unknown跳过米制尺寸否决，仍保留置信度门槛',()=>{
 const input=[box(3.5,.6,.8,false,0),box(.23,.05,.8,false,15),box(.8,.2,.299,false,30)];
 input[0].classification='interior-door';input[1].classification='unknown';
 const before=structuredClone(input),r=doorsToHome(input,frame,10,10);
 assert.deepEqual(r.doors.map(d=>d.sourceIndex),[0,1]);assert.deepEqual(input,before);
 assert.equal(r.checks[2].valid,false);assert.match(r.checks[2].reasons.join(),/置信度/);
});
test('未知位置不因比例尺改变被尺寸否决，分数0.30包含端点',()=>{
 const input=[box(.449,.099,.30,false,0),box(3.001,.401,.30,false,15)];
 for(const scale of [1,10,100])assert.equal(doorsToHome(input,frame,scale,scale).doors.length,2);
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
test('R(2) 位置加局部符号规则采用11门，保留入户门与宽门，模型与AI共用结果',()=>{
 const {result,home,depth}=recognized('r2');
 assert.equal(result.doors.length,14);assert.equal(home.doors.length,11);assert.ok(home.doors.some(d=>d.kind==='entrance'));
 assert.ok(home.doors.every(d=>d.score>=.3));assert.ok(home.doors.some(d=>Math.min(d.w,d.d)>.4));
 // 推拉门要单独标出来，渲染层才能区分「一扇平开门」和「一段推拉门」。
 assert.ok(home.doors.filter(d=>d.kind==='sliding').length>=2);
 assert.ok(home.doors.filter(d=>d.kind==='sliding').every(d=>Math.max(d.w,d.d)>=1.2));
 const ai={width:10,depth,rooms:[{id:'manual',x:0,z:0,width:2,depth:2}]},before=structuredClone(ai.rooms);attachDetectedOpenings(ai,result);
 assert.equal(ai.doors.length,11);assert.deepEqual(ai.rooms,before);assert.equal(ai.windows.length,12);
 const group=buildHomeGeometry(home,false),leaves=group.children.filter(m=>m.userData.door);
 assert.equal(leaves.length,11);assert.ok(leaves.every(m=>m.geometry.parameters.height===2.05));group.traverse(m=>m.geometry?.dispose());
});
test('所有YOLO门被闸值拒绝时不重新塞入分割门，窗数据仍保留',()=>{
 const {result,depth}=recognized('r2'),r={...result,doors:result.doors.map(d=>({...d,score:.1}))},home=homeFromRecognition(r,10,depth);
 assert.equal(home.doors.length,0);assert.equal(home.windows.length,12);assert.equal(home.selection.doors.rejected.length,14);
});
for(const [name,expected] of [['46',4],['r10',9]])test(name+' 新位置规则不误删既有门，R10含两个由窗改判的内部开口',()=>{
 const {home}=recognized(name);assert.equal(home.doors.length,expected);assert.ok(home.selection.doors.rejected.every(c=>c.reasons.every(r=>r.includes('同一门洞')||r.includes('置信度'))));
 if(name==='46')assert.ok(home.doors.some(d=>Math.abs(Math.max(d.w,d.d)-1.8643679486714326)<1e-8));
 if(name==='r10')assert.ok(home.doors.some(d=>Math.abs(Math.max(d.w,d.d)-.4749193494169467)<1e-8));
});
