import test from 'node:test';
import assert from 'node:assert/strict';
import {careNightRoute,careNightRouteOverlay} from '../public/care-night-route.js';
import {careCommand} from '../public/care-commands.js';
import {CARE_TEMPLATES,makeCareTemplate} from '../public/care-templates.js';
import {homePlanSVG} from '../public/home-domain.js';

const small=()=>makeCareTemplate(CARE_TEMPLATES[0]).wholeHome;

test('both templates trace a continuous bed-side to bathroom path through corresponding doors',()=>{
 for(const template of CARE_TEMPLATES){
  const {wholeHome}=makeCareTemplate(template);
  const route=careNightRoute(wholeHome,{profile:template.profile});
  assert.equal(route.status,'route-found',route.detail);
  const [start,end]=[route.points[0],route.points.at(-1)];
  const rooms=route.roomIds.map(id=>wholeHome.home.rooms.find(room=>room.id===id));
  assert.equal(rooms[0].kind,'bedroom');
  assert.equal(rooms.at(-1).kind,'bathroom');
  assert.notDeepEqual(start,[rooms[0].x,rooms[0].z]);
  assert.ok(Math.abs(end[0]-rooms.at(-1).x)<rooms.at(-1).width/2);
  assert.equal(route.crossings.length,rooms.length-1);
  assert.deepEqual(route.crossings.map(({from,to})=>[from,to]),route.roomIds.slice(1).map((id,n)=>[route.roomIds[n],id]));
  assert.ok(route.doorWidth>=.85);
  assert.ok(route.issues.some(issue=>issue.includes('座廁')));
  const svg=homePlanSVG(wholeHome.home,{overlay:project=>careNightRouteOverlay(route,project)});
  assert.match(svg,/床邊至浴室內的夜間路線.*<polyline points="[\d., ]+/);
 }
});

test('a missing, shifted, or too narrow matching bathroom opening does not connect rooms',()=>{
 const whole=small();
 const bathroom=whole.home.rooms.find(room=>room.kind==='bathroom');
 const door=bathroom.openings[0];
 for(const openings of [[],[{...door,offset:.55}],[{...door,width:.66/bathroom.depth}]]){
  bathroom.openings=openings;
  const result=careNightRoute(whole);
  assert.equal(result.status,'pending');
  assert.deepEqual(result.points,[]);
 }
});

test('a cabinet blocking the room crossing or a polygon without a door on its actual boundary prevents the route',()=>{
 const whole=small();
 const hall=whole.home.rooms.find(room=>room.kind==='hall');
 const cabinet={type:'cabinet',name:'固定櫃',id:'obstacle',w:2.18,d:.30,x:0,z:.17,rotation:0};
 hall.items.push(cabinet);
 assert.equal(careNightRoute(whole).status,'pending');
 hall.items=[];
 hall.polygon=[[-1.1,-1.3],[1.1,-1.3],[1.1,-.5],[-.5,-.5],[-.5,1.3],[-1.1,1.3]];
 const route=careNightRoute(whole);
 assert.equal(route.status,'pending');
 assert.ok(route.issues.some(issue=>issue.includes('門洞與牆線未對齊')));
});

test('a valid route inside an L-shaped room avoids the cutout and flags imported walls for checking',()=>{
 const whole=small();
 const hall=whole.home.rooms.find(room=>room.kind==='hall');
 const z=hall.depth/2;
 hall.openings=hall.openings.filter(door=>door.edge==='top'||door.edge==='right');
 hall.polygon=[[-1.1,-z],[1.1,-z],[1.1,z],[-.7,z],[-.7,.85],[-1.1,.85]];
 const route=careNightRoute(whole);
 assert.equal(route.status,'route-found',route.issues.join('\n'));
 assert.ok(route.issues.some(issue=>issue.includes('牆線及凹位')));
 assert.ok(route.points.filter(([x,pointZ])=>x>hall.x-1.1&&x<hall.x+1.1&&pointZ>hall.z-z&&pointZ<hall.z+z).every(([x,pointZ])=>x>=hall.x-.7||pointZ<=hall.z+.85));
});

test('a narrow unused branch does not stop a valid selected route',()=>{
 const whole=small();
 const hall=whole.home.rooms.find(room=>room.kind==='hall');
 const unused=hall.openings.find(door=>door.edge==='left');
 unused.width=.4/hall.depth;
 assert.equal(careNightRoute(whole).status,'route-found');
 assert.deepEqual(careCommand('幫我睇夜晚去廁所路線',{}),{type:'night-route'});
});

test('a marked toilet changes the endpoint to the correct walking or wheelchair approach',()=>{
 for(const [index,toilet,destination] of [
  [0,{x:0,z:.9,transferSide:'either'},'座廁前方'],
  [1,{x:-.8,z:0,transferSide:'left'},'座廁左側']
 ]){
  const template=CARE_TEMPLATES[index],{wholeHome}=makeCareTemplate(template);
  const bathroom=wholeHome.home.rooms.find(room=>room.kind==='bathroom');
  bathroom.toilet={...toilet,w:.36,d:.66,rotation:180};
  const route=careNightRoute(wholeHome,{profile:template.profile});
  assert.equal(route.destination,destination);
  assert.match(route.issues.join(' '),/現場試行/);
  if(index===1){
   bathroom.toilet.transferSide='right';
   const blocked=careNightRoute(wholeHome,{profile:template.profile});
   assert.equal(blocked.status,'pending');
   assert.match(blocked.detail,/座廁使用位置/);
   assert.deepEqual(blocked.points,[]);
  }
 }
});

test('known overlaps with the toilet prevent drawing a misleading route',()=>{
 const whole=small(),bathroom=whole.home.rooms.find(room=>room.kind==='bathroom');
 bathroom.toilet={x:bathroom.items[0].x*.8,z:bathroom.items[0].z*.8,w:.36,d:.66,rotation:0,transferSide:'either'};
 const blocked=careNightRoute(whole);
 assert.equal(blocked.status,'pending');
 assert.match(blocked.issues.join(' '),/與固定座廁重疊/);
});
