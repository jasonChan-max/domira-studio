import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {wallContoursFromMask,mergeCollinearWallContours,medianWallThickness,filterSmallWallContours,wallMaskFidelity,signedArea,isSimpleRing} from '../public/wall-contours.js';
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/wall-repair-round4.json',import.meta.url)));
const load=name=>{const data=fixtures.cases[name];return {...data,mask:new Uint8Array(gunzipSync(Buffer.from(data.mask,'base64')))};};
const count=shapes=>shapes.reduce((sum,s)=>sum+s.outer.length+s.holes.reduce((n,h)=>n+h.length,0),0);
const shape=outer=>({outer,holes:[],areaPixels:signedArea(outer)});

test('整段台阶拟合保面积、保留真实 L 形转角和斜墙，不改写输入',()=>{
 const top=[[0,0]];for(let x=5;x<160;x+=5)top.push([x,x%10?1:0]);
 const source=[shape([...top,[160,0],[160,20],[80,20],[80,60],[0,60]])],snapshot=structuredClone(source);
 const fitted=mergeCollinearWallContours(source,{maxJitter:4});
 assert.ok(count(fitted)<count(source)/2);assert.ok(isSimpleRing(fitted[0].outer));assert.ok(Math.abs(signedArea(fitted[0].outer)-signedArea(source[0].outer))<.001);
 assert.ok(fitted[0].outer.some(p=>p[0]===80&&p[1]===60));assert.deepEqual(source,snapshot);
 const sloped=[shape([[10,0],[110,84],[100,100],[0,16]])];assert.deepEqual(mergeCollinearWallContours(sloped),sloped);
 assert.throws(()=>mergeCollinearWallContours(source,{maxJitter:NaN}),/参数/);
});

test('噪声阈值随墙厚平方缩放，保留大墙段和正常房间空洞',()=>{
 const main={...shape([[0,0],[60,0],[60,60],[0,60]]),holes:[[[10,10],[10,50],[50,50],[50,10]],[[5,5],[5,6],[6,6],[6,5]]]},small=shape([[70,0],[73,0],[73,3],[70,3]]),short=shape([[70,10],[75,10],[75,14],[70,14]]);
 const result=filterSmallWallContours([main,small,short],4);
 assert.equal(result.removed.length,1);assert.equal(result.contours.length,2);assert.equal(result.contours[0].holes.length,1);assert.equal(result.filledHoles.length,1);
 const scaled=[main,small,short].map(s=>({...s,areaPixels:s.areaPixels*4,outer:s.outer.map(([x,y])=>[x*2,y*2]),holes:s.holes.map(r=>r.map(([x,y])=>[x*2,y*2]))}));
 assert.deepEqual(filterSmallWallContours(scaled,8).removed.map(r=>r.index),result.removed.map(r=>r.index));
 const mask=new Uint8Array(40*40).fill(4);for(let y=5;y<35;y++)for(let x=5;x<9;x++)mask[y*40+x]=1;
 assert.equal(medianWallThickness(mask,40,40),4);
});

test('R(2) 冻结模型数据的长墙点数、短边占比与实际 mask 覆盖同时达标',()=>{
 const data=load('r2'),before=data.mask.slice(),current=wallContoursFromMask(data.mask,data.width,data.height),off=wallContoursFromMask(data.mask,data.width,data.height,{mergeCollinear:false});
 const edges=current.flatMap(s=>[s.outer,...s.holes].flatMap(r=>r.map((p,i)=>Math.hypot(p[0]-r[(i+1)%r.length][0],p[1]-r[(i+1)%r.length][1]))));
 assert.ok(count(current)<=120);assert.ok(edges.filter(e=>e<8).length/edges.length<=.05);assert.ok(count(current)<count(off));assert.ok(wallMaskFidelity(current,data.mask,data.width,data.height).recall>=.92);
 assert.equal(current.diagnostics.removed.length,3);assert.ok(current.every(s=>isSimpleRing(s.outer)&&s.holes.every(isSimpleRing)));assert.deepEqual(data.mask,before);
 // 第四块存疑墙面积远大于相对阈值；不为满足轮廓个数而把厨房交界处的真墙删掉。
 assert.ok(!current.diagnostics.removed.some(r=>r.index===3));
});

test('46.03㎡ 保留原有保真水平，完整关闭后处理仍得到原始 260 点',()=>{
 const data=load('46'),current=wallContoursFromMask(data.mask,data.width,data.height),raw=wallContoursFromMask(data.mask,data.width,data.height,{orthogonalize:false,mergeCollinear:false,filterSmallContours:false});
 assert.equal(count(raw),260);assert.ok(count(current)>=60&&count(current)<=72);assert.ok(wallMaskFidelity(current,data.mask,data.width,data.height).recall>=.95);
});
