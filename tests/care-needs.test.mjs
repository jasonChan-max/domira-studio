import test from 'node:test';
import assert from 'node:assert/strict';
import {careGuidance,careDailyPreferences} from '../public/care-needs.js';
import {validateBrief} from '../public/care-brief.js';
import {chatScene,validateChatMoves} from '../public/care-chat-layout.js';
import {CARE_TEMPLATES,makeCareTemplate} from '../public/care-templates.js';

test('age prompts vary by age and specific design advice follows selected needs and room',()=>{
 const agePrompts=['60','70','80'].map(age=>careGuidance({age,needs:[]},'bathroom').age);
 assert.equal(new Set(agePrompts).size,3);
 const daily={age:'80',needs:['vision','memory','balance','transfer']};
 const advice=careGuidance(daily,'bathroom').advice;
 assert.match(advice.find(item=>item.id==='vision').text,/明暗對比/);
 assert.match(advice.find(item=>item.id==='memory').text,/連續色調/);
 assert.match(advice.find(item=>item.id==='balance').text,/防滑/);
 assert.match(advice.find(item=>item.id==='transfer').text,/牆身固定/);
 assert.deepEqual(careDailyPreferences(['night-light'],daily),['night-light','high-contrast','caregiver']);
 assert.deepEqual(careDailyPreferences([], {age:'80',needs:[]}),[]);
});

test('daily needs are optional and validated without changing the existing furniture brief',()=>{
 const state=makeCareTemplate(CARE_TEMPLATES[1]);
 assert.doesNotThrow(()=>validateBrief(state.brief));
 assert.doesNotThrow(()=>validateBrief({...state.brief,daily:{age:'70',needs:['balance']}}));
 assert.throws(()=>validateBrief({...state.brief,daily:{age:'70',needs:['balance','balance']}}),/年齡及日常需要/);
 assert.throws(()=>validateBrief({...state.brief,daily:{age:'81',needs:[]}}),/年齡及日常需要/);
 const scene=chatScene(state);
 assert.ok(scene.items.some(item=>item.modelStyle));
 assert.doesNotThrow(()=>validateChatMoves(scene,[]));
});
