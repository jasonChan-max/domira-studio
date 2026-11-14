import test from 'node:test';
import assert from 'node:assert/strict';
import {careVoiceDecision} from '../public/care-voice.js';

test('spoken confirmation only matches a standalone decision',()=>{
 for(const text of ['確認套用。','确认应用！','用呢個'])assert.equal(careVoiceDecision(text),'apply');
 for(const text of ['取消','唔好改。','不要改'])assert.equal(careVoiceDecision(text),'dismiss');
 for(const text of ['唔好確認','確認套用嗎？','取消後再確認','我想確認床有多闊','可以'])assert.equal(careVoiceDecision(text),null);
});
