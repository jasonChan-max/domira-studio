import test from 'node:test';
import assert from 'node:assert/strict';
import {hkCareHome,roomCareProject} from '../public/care-home-domain.js';
import {ALL_CARE_PRODUCTS} from '../public/care-catalog.js';
import {BRIEF_VERSION} from '../public/care-brief.js';
import {careGeometry,careExport,newCareProject,safeCareLayout,SAMPLE_ITEMS} from '../public/care-domain.js';
import {chatScene,validateChatMoves} from '../public/care-chat-layout.js';
import {previewCareReplacement} from '../public/care-replacement.js';
import {segmentClearance} from '../public/circulation-domain.js';

function bedroom(productId) {
 const home=hkCareHome(),room=home.rooms.find(room=>room.kind==='bedroom');
 const product=ALL_CARE_PRODUCTS.find(product=>product.productId===productId);
 const project=roomCareProject(home,room);
 project.brief={version:BRIEF_VERSION,confirmed:true,preferences:[],notes:'',selections:[{productId,quantity:1,w:product.w,d:product.d,h:product.h,dimensionSource:'concept'}]};
 return {project,product};
}

test('both original beds fit the Hong Kong example with real left-door access at original size',async()=>{
 const {generateCareLayout}=await import('../worker/care.js');
 for(const id of ['HOME-BED','AID-018']){
  const {project,product}=bedroom(id);
  const result=await generateCareLayout({project,purpose:'bedroom'},{});
  assert.equal(result.items.length,1,id);
  const bed=result.items[0];
  assert.deepEqual([bed.w,bed.d,bed.h],[product.w,product.d,product.h]);
  const {access}=result.review;
  assert.equal(access.doors[0].edge,'left');
  assert.ok(Math.abs(access.paths[0][0][0]+1.4)<1e-8 && Math.abs(access.paths[0][0][1]-.8)<1e-8);
  assert.ok(access.turningPoint);
  assert.equal(access.transfers[0].id,bed.id);
  for(const path of access.paths)for(let i=2;i<path.length;i++)assert.ok(segmentClearance(path[i-1],path[i],bed)>=.599);
 }
});

test('a shifted route is valid but a piece blocking the actual entry fails locally and in chat',()=>{
 const room={width:4,depth:4,height:2.7,planRoom:{openings:[{kind:'door',edge:'left',offset:.6,width:.225,swing:'sliding'}]}};
 const project=newCareProject(room);
 project.items=[{...SAMPLE_ITEMS[0],id:'chair',x:0,z:0,rotation:0}];
 assert.ok(careGeometry(project).ok);
 const moves=[{id:'chair',x:-1.6,z:1,rotation:0}];
 assert.throws(()=>validateChatMoves(chatScene(project),moves),/門口/);
});

test('known door sweep blocks furniture, while missing doors remain unverified',()=>{
 const room={width:4,depth:4,height:2.7,planRoom:{openings:[{kind:'door',edge:'left',offset:.5,width:.225,swing:'inward-start'}]}};
 const project=newCareProject(room);
 project.items=[{...SAMPLE_ITEMS[0],id:'chair',w:.2,d:.2,x:-1.5,z:.08,rotation:0}];
 assert.ok(careGeometry(project).failures.some(f=>f.rule==='door-swing'));
 const exported=careExport({...project,room:{...room,planRoom:undefined}});
 assert.equal(exported.doorLocation,'unknown');
 assert.equal(exported.review.access.paths.length,0);
 assert.ok(exported.review.pending.some(item=>item.id==='door-position'));
});

test('bed replacement keeps original intact, verifies the new position and preserves physical dimensions',()=>{
 const {project}=bedroom('HOME-BED');
 const candidate=ALL_CARE_PRODUCTS.find(p=>p.productId==='HOME-BED');
 project.items=safeCareLayout(project,[{...candidate,requestKey:'HOME-BED:0'}]).items;
 const original=structuredClone(project);
 const replacement=previewCareReplacement(project,project.items[0].id,'AID-018');
 assert.deepEqual(project,original);
 assert.equal(replacement.item.productId,'AID-018');
 assert.equal(replacement.item.d,2.12);
 assert.equal(replacement.project.brief.selections.length,1);
 assert.ok(careGeometry(replacement.project).ok);
});
