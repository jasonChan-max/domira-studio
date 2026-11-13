import test from 'node:test';
import assert from 'node:assert/strict';
import {planCareNightAccess} from '../public/care-home-planner.js';
import {careNightRoute} from '../public/care-night-route.js';
import {careGeometry} from '../public/care-domain.js';
import {CARE_TEMPLATES,makeCareTemplate} from '../public/care-templates.js';

const inventory=whole=>whole.home.rooms.flatMap(room=>room.items.map(({id,requestKey,w,d,h})=>[room.id,id,requestKey,w,d,h])).sort();

test('whole-home generation can shorten the actual night path without moving inventory across rooms',async()=>{
 for(const template of CARE_TEMPLATES){
  const {wholeHome}=makeCareTemplate(template);
  const before=structuredClone(wholeHome);
  const route=careNightRoute(before,{profile:template.profile});
  const result=await planCareNightAccess(wholeHome,{profile:template.profile});
  assert.deepEqual(wholeHome,before);
  assert.equal(result.route.status,'route-found');
  assert.ok(result.route.distance<route.distance-.1);
  assert.ok(result.route.doorWidth>=route.doorWidth-.001);
  assert.deepEqual(inventory(result.whole),inventory(before));
  assert.ok(Object.values(result.whole.projects).filter(Boolean).every(project=>careGeometry(project).ok));
  assert.ok(result.checks<=16);
 }
});

test('fixed furniture stays put and a missing crossing stays pending',async()=>{
 const {wholeHome}=makeCareTemplate(CARE_TEMPLATES[0]);
 const bed=wholeHome.home.rooms.find(room=>room.kind==='bedroom');
 bed.items[0].locked=true;
 const result=await planCareNightAccess(wholeHome,{profile:'walker'});
 assert.deepEqual(result.whole.projects[bed.id].items,bed.items);
 wholeHome.home.rooms.find(room=>room.kind==='bathroom').openings=[];
 const pending=await planCareNightAccess(wholeHome,{profile:'walker'});
 assert.equal(pending.route.status,'pending');
 assert.equal(pending.whole,wholeHome);
});
