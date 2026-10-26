import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three.module.js';
import {furniture} from '../public/furniture.js';
import {CATALOG,refineLayoutOrientation,furnitureFront,rotationToward,itemBounds,collisions,layoutOpenings} from '../src/domain.js';
import {validateAILayout,generateAILayout} from '../worker/layout.js';
const room={width:6,depth:5,height:2.7};
const make=(type,x,z,rotation=0,id=type)=>({...CATALOG[type],id,type,x,z,rotation});
const facing=(item,target)=>{const f=furnitureFront(item.rotation),dx=target.x-item.x,dz=target.z-item.z;return (f.x*dx+f.z*dz)/Math.hypot(dx,dz);};
const check=items=>{assert.deepEqual(collisions(items),[]);for(const i of items){const b=itemBounds(i);assert.ok(Math.abs(i.x)+b.w/2<=room.width/2+.001);assert.ok(Math.abs(i.z)+b.d/2<=room.depth/2+.001);}};
test('heading convention matches actual rendered model transforms for all quadrants and negative yaw',()=>{
 for(const rotation of [0,90,180,270,-30,405]){
  const item=make('chair',0,0,rotation),group=furniture(item),actual=new THREE.Vector3(0,0,1).applyEuler(group.rotation),expected=furnitureFront(rotation);
  assert.ok(Math.abs(actual.x-expected.x)<1e-8&&Math.abs(actual.z-expected.z)<1e-8);
 }
 assert.equal(rotationToward({x:0,z:0},{x:1,z:0}),270);
 assert.equal(rotationToward({x:0,z:0},{x:-1,z:0}),90);
});
test('side seating and sofa face the coffee table instead of turning their backs on it',()=>{
 const input=[make('sofa',0,-1.7,180),make('chair',2,0,270),make('table',0,0)],before=structuredClone(input);
 const result=refineLayoutOrientation(input,room);check(result.items);
 const table=result.items.find(i=>i.type==='table');
 for(const seat of result.items.filter(i=>['chair','sofa'].includes(i.type)))assert.ok(facing(seat,table)>.9,seat.type);
 assert.deepEqual(input,before,'manual/original input must not be mutated');assert.ok(result.adjusted>=2);
});
test('desk chair moves to the usable front side and faces the desktop',()=>{
 const result=refineLayoutOrientation([make('desk',0,0,180),make('chair',0,-1.25,0)],room,{purpose:'work'});check(result.items);
 const desk=result.items[0],chair=result.items[1],front=furnitureFront(desk.rotation);
 assert.ok((chair.x-desk.x)*front.x+(chair.z-desk.z)*front.z>desk.d/2+.1);
 assert.ok(facing(chair,desk)>.9);
});
test('dining chairs on opposite sides face each other across the table',()=>{
 const result=refineLayoutOrientation([make('dining',0,0),make('chair',-1.65,0,270,'left'),make('chair',1.65,0,90,'right')],room,{purpose:'dining'});check(result.items);
 for(const chair of result.items.slice(1))assert.ok(facing(chair,result.items[0])>.9);
});
test('bed head and storage backs align to a wall while fronts face into the room',()=>{
 for(const type of ['bed','cabinet','bookshelf','desk']){
  const result=refineLayoutOrientation([make(type,1.8,0,47)],room);const item=result.items[0];check(result.items);
  assert.ok([0,90,180,270].includes(item.rotation));
  const f=furnitureFront(item.rotation),back={x:item.x-f.x*item.d/2,z:item.z-f.z*item.d/2};
  assert.ok(Math.min(Math.abs(back.x+3),Math.abs(back.x-3),Math.abs(back.z+2.5),Math.abs(back.z-2.5))<.15,type);
  assert.ok(facing(item,{x:0,z:0})>0,type);
 }
});
test('known door clearance is preserved after turning wall furniture',()=>{
 const measured={...room,planRoom:{openings:[{kind:'door',edge:'right',offset:.35,width:.3}]}};
 const result=refineLayoutOrientation([make('cabinet',2.65,0,270),make('chair',0,-1.5),make('table',0,0)],measured);check(result.items);
 // Right-side doorway clear zone is x=[2.2,3], z=[-.81,.81].
 for(const item of result.items){if(item.type==='rug')continue;const b=itemBounds(item);assert.ok(item.x+b.w/2<=2.215||Math.abs(item.z)>=(b.d+1.62)/2-.015,item.type);}
 assert.equal(result.openingCount,1);
});
test('large fixtures do not overlap a known window clear strip',()=>{
 const measured={...room,planRoom:{openings:[{kind:'window',edge:'top',offset:.2,width:.6}]}};
 const result=refineLayoutOrientation([make('bookshelf',0,-2.3,180)],measured);const shelf=result.items[0],b=itemBounds(shelf);
 assert.ok(shelf.z-b.d/2>=-2.25-.015||Math.abs(shelf.x)>(b.w+3.72)/2-.015);
});
test('a correctly facing conversational angle survives, rather than forcing all seating onto cardinal axes',()=>{
 const table=make('table',.2,.1),chair=make('chair',-1.4,-1.2);chair.rotation=rotationToward(chair,table)+7;
 const result=refineLayoutOrientation([table,chair],room);assert.ok(Math.abs(result.items[1].rotation-chair.rotation)<.01);check(result.items);
});
test('rotation enlargement cannot push a corrected seat through the room boundary or its neighbor',()=>{
 const input=[make('chair',2.55,.3,0),make('table',0,.3),make('lamp',2.5,-.8)];
 const result=refineLayoutOrientation(input,room);check(result.items);assert.ok(facing(result.items[0],result.items[1])>.8);
});
test('impossible front clearances fail explicitly without changing the previous layout',()=>{
 const tiny={width:2,depth:2,height:2.7};const source=[make('bed',0,0,180)],before=structuredClone(source);
 assert.throws(()=>refineLayoutOrientation(source,tiny),/原設計已保留/);assert.deepEqual(source,before);
});
test('validated opening data and exact rotation contract reach the AI; missing openings stay unknown',async t=>{
 const opening={kind:'door',edge:'left',offset:.2,width:.2};let calls=0;
 t.mock.method(globalThis,'fetch',async(_,request)=>{
  const payload=JSON.parse(request.body),data=JSON.parse(payload.messages[1].content);calls++;
  assert.match(payload.messages[0].content,/90 faces -x/);assert.match(payload.messages[0].content,/never invent a door/);
  assert.deepEqual(data.room.openings,calls===1?[opening]:[]);
  return Response.json({choices:[{message:{content:JSON.stringify({items:[{type:'chair',modelStyle:'arc',x:0,z:-1.5,rotation:180,color:'#aabbcc'},{type:'table',modelStyle:'oval',x:0,z:0,rotation:0,color:'#998877'}]})}}]});
 });
 const result=await generateAILayout({room:{...room,planRoom:{openings:[opening,{kind:'door',edge:'invalid',offset:0,width:1}]}},style:'warm',purpose:'living',preferences:[]},{DEEPSEEK_API_KEY:'test'});
 assert.ok(result.furnitureAdvice.items.find(i=>i.type==='chair').orientationReason.includes('朝向茶几'));
 await generateAILayout({room,style:'warm',purpose:'living',preferences:[]},{DEEPSEEK_API_KEY:'test'});
 assert.deepEqual(layoutOpenings({planRoom:{openings:'untrusted'}}),[]);
});
test('AI angle repair runs before returning the scene and keeps item/advice index ordering',()=>{
 const result=validateAILayout({items:[{type:'chair',modelStyle:'arc',x:2,z:0,rotation:270,color:'#aabbcc'},{type:'table',modelStyle:'oval',x:0,z:0,rotation:0,color:'#998877'}]},room);
 assert.equal(result.items[0].type,'chair');assert.equal(result.items[1].type,'table');assert.ok(facing(result.items[0],result.items[1])>.9);assert.ok(result.orientation.adjusted>0);
});
