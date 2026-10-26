import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
test('v2 preserves the repository renovation agent and knowledge routes',async()=>{for(const path of ['agents','knowledge']){const response=await worker.fetch(new Request('https://domira.test/api/'+path));assert.equal(response.status,200);const data=await response.json();if(path==='agents')assert.equal(data.agents.length,7);else assert.ok('available' in data);}});
test('v2 renovation plan route remains runnable without a model secret',async()=>{const response=await worker.fetch(new Request('https://domira.test/api/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({area_sqft:380,rooms:2,building_age:40,budget_hkd:500000,occupants:[],renovation_mode:'full'})}));assert.equal(response.status,200);const data=await response.json();assert.ok(data.summary.total_cost_hkd>0);assert.ok(data.summary.duration_weeks>0);});
