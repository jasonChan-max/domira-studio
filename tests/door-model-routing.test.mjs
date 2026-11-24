import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

function runtime(t,create=async()=>{}){
 const previous={window:globalThis.window,document:globalThis.document};
 globalThis.window={ort:{env:{wasm:{}},Tensor:class{constructor(type,data,dims){Object.assign(this,{type,data,dims});}},InferenceSession:{create}}};
 globalThis.document={createElement:()=>({getContext:()=>({fillRect(){},drawImage(){},getImageData:()=>({data:new Uint8ClampedArray(640*640*4)})})})};
 t.after(()=>{for(const key of ['window','document'])if(previous[key]===undefined)delete globalThis[key];else globalThis[key]=previous[key];});
}
const output=boxes=>{const n=boxes.length,data=new Float32Array(6*n);boxes.forEach((b,i)=>b.forEach((v,c)=>data[c*n+i]=v));return {dims:[1,6,n],data};};
const session=out=>({inputNames:['images'],outputNames:['output0'],run:async()=>({output0:out})});

test('门只采用新模型，窗只采用冻结模型；新模型的窗和旧模型的假门不能混入',async t=>{
 runtime(t);const {detectDoors}=await import('../tools/candidate-door-detect.js?routing');
 const door=session(output([[100,100,10,40,.9,.1],[300,300,50,10,.1,.99]]));
 const frozen=session(output([[100,100,10,40,.95,.1],[400,400,40,10,.1,.8],[401,400,40,10,.1,.7]]));
 const r=await detectDoors({width:640,height:640},{session:door,windowSession:frozen});
 assert.equal(r.length,2);assert.deepEqual(r.map(b=>b.cls),['door','window']);assert.equal(r[0].x,95);assert.equal(r[1].x,380);assert.ok(Math.abs(r[1].score-.8)<1e-6);
});
test('模型缓存按URL隔离，失败可重试，不能把窗会话复用成新门会话',async t=>{
 const calls=[];let fail=true;runtime(t,async url=>{calls.push(url);if(url==='retry'&&fail){fail=false;throw Error('temporary');}return {url};});
 const {loadDoorModel}=await import('../tools/candidate-door-detect.js?cache');
 const [a,b,c]=await Promise.all([loadDoorModel('door'),loadDoorModel('door'),loadDoorModel('window')]);assert.equal(a,b);assert.notEqual(a,c);assert.deepEqual(calls,['door','window']);
 await assert.rejects(loadDoorModel('retry'));assert.deepEqual(await loadDoorModel('retry'),{url:'retry'});
});
test('真实入口默认分别加载门和冻结窗模型，只有门的入口不额外加载窗',async t=>{
 const calls=[];runtime(t,async url=>{calls.push(url);return session(output([[200,200,40,10,.8,.1]]));});
 const {detectDoors,detectDoorsOnly}=await import('../tools/candidate-door-detect.js?default');
 await detectDoors({width:640,height:640},{modelUrl:'candidate.onnx'});assert.equal(calls[0],'candidate.onnx');assert.match(calls[1],/yolo-windows-int8\.onnx$/);
 await detectDoorsOnly({width:640,height:640},{modelUrl:'door-only.onnx'});assert.equal(calls.length,3);assert.equal(calls[2],'door-only.onnx');
});
test('冻结窗权重字节保持现役6f257e8，续训不能替换此文件',()=>{
 const data=readFileSync(new URL('../public/models/yolo-doors-int8.onnx',import.meta.url));assert.equal(createHash('sha256').update(data).digest('hex'),'6f257e8060d025f233a1e525067b6a12c8807c6b3a371f989447a42fc57d82c9');
});
