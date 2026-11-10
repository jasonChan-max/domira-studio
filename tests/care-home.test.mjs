import test from 'node:test';import assert from 'node:assert/strict';import {hkCareHome,roomCareProject,validateCareWhole,wholeReview,createManualCareHome,careRoomAssignments} from '../public/care-home-domain.js';
test('HK demo is an explicitly illustrative 41 square metre whole home with exact tiling',()=>{const h=hkCareHome();assert.equal(h.rooms.length,5);assert.ok(Math.abs(h.rooms.reduce((s,r)=>s+r.width*r.depth,0)-41)<1e-8);assert.ok(Math.abs(h.width*h.depth-41)<1e-8);assert.equal(h.scaleConfirmed,false);assert.ok(h.warnings.some(s=>s.includes('不是平均')));});
test('whole home validates independent room care states and rejects size mismatches',()=>{const home=hkCareHome(),projects=Object.fromEntries(home.rooms.map(r=>[r.id,roomCareProject(home,r)])),w={format:'domira.care.home.v1',home,projects,activeRoomId:'living'};assert.equal(validateCareWhole(w),w);assert.equal(wholeReview(w).length,5);projects.bedroom.room.width=5;assert.throws(()=>validateCareWhole(w));});


test('manual whole home converts wall coordinates to room centers and rejects overlap or overflow',()=>{
 const dimensions={width:6,depth:5,height:2.7};
 const rooms=[{name:'客廳',kind:'living',left:0,top:0,width:3,depth:5},{name:'睡房',kind:'bedroom',left:3,top:0,width:3,depth:5}];
 const home=createManualCareHome(dimensions,rooms);
 assert.deepEqual(home.rooms.map(({x,z})=>[x,z]),[[-1.5,0],[1.5,0]]);
 assert.throws(()=>createManualCareHome(dimensions,[rooms[0],{...rooms[1],left:2.99}]),/重疊/);
 assert.throws(()=>createManualCareHome(dimensions,[rooms[0],{...rooms[1],left:3.01}]),/超出/);
});

test('whole-home assignments recommend room purpose and honor valid user overrides',()=>{
 const home=hkCareHome();const brief={selections:['HOME-BED','AID-008','HOME-DINING'].map(productId=>({productId}))};
 assert.deepEqual(careRoomAssignments(home,brief),{'HOME-BED':'bedroom','AID-008':'bathroom','HOME-DINING':'living'});
 assert.deepEqual(careRoomAssignments(home,brief,{'HOME-BED':'living','AID-008':'unknown'}),{'HOME-BED':'living','AID-008':'bathroom','HOME-DINING':'living'});
});
