import test from 'node:test';
import assert from 'node:assert/strict';
import {careCommand} from '../public/care-commands.js';
import {validateCareWhole,wholeReview} from '../public/care-home-domain.js';
import {CARE_TEMPLATES,makeCareTemplate} from '../public/care-templates.js';

test('Cantonese floor and save instructions keep room targets and version name',()=>{
 const state=makeCareTemplate(CARE_TEMPLATES[0]);
 const command=careCommand('客廳用木地板，浴室用防滑磚。儲存做第二版',state);
 assert.equal(command.type,'floor');
 assert.equal(command.save,'第二版');
 assert.deepEqual(command.changes.map(({roomId,material})=>[roomId,material]),[['living','wood'],['bathroom','tile']]);
 assert.equal(careCommand('浴室用木地板好唔好？',state),null);
});

test('bed replacement keeps the requested room and transfer side, and asks about ambiguous rooms',()=>{
 const state=makeCareTemplate(CARE_TEMPLATES[1]);
 assert.match(careCommand('睡房換護理床',state).error,/哪一間/);
 assert.deepEqual(careCommand('主人房換普通床，右邊留位',state),{type:'bed',roomId:'manual-2',product:'HOME-BED',transferSide:'right'});
 assert.deepEqual(careCommand('帮我重新规划全屋',state),{type:'plan'});
 assert.deepEqual(careCommand('匯出全屋設計',state),{type:'export',whole:true});
});

test('all one-click templates carry a bed and place each chosen item with the actual room geometry',()=>{
 for(const template of CARE_TEMPLATES){
  const {wholeHome}=makeCareTemplate(template);
  validateCareWhole(wholeHome);
  assert.ok(wholeHome.home.rooms.some(room=>room.kind==='bedroom'&&room.items.some(item=>item.type==='bed')));
  assert.equal(wholeHome.home.rooms.flatMap(room=>room.items).length,template.products.length);
  assert.ok(wholeReview(wholeHome).every(room=>room.review?.ok!==false));
 }
});
