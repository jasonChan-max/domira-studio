/* 端到端：沒 key 時整條鏈路仍要跑完，金額與工期仍要是真的。
 *
 * 這是「降級優先於失敗」的驗收：觀眾看到的永遠是一份完整方案，
 * 而不是一個錯誤訊息；而且 mock 模式下的金額仍來自價目表。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Orchestrator } from '../worker/orchestrator.js';
import { LLMClient } from '../worker/quote/llm.js';
import * as quoteApi from '../worker/quote-api.js';

const PROJECT = {
  area_sqft: 380,
  rooms: 2,
  building_age: 45,
  budget_hkd: 500000,
  district: '深水埗',
  renovation_mode: 'full',
  occupants: [{ age: 72, mobility: 'limited', relation: '母親' }],
};

test('沒有 key 時仍完成三階段，且全部降級為 mock', async () => {
  const orch = new Orchestrator(new LLMClient({ apiKey: '' }));
  const result = await orch.plan(PROJECT);

  assert.equal(result.mode, 'mock');
  assert.equal(result.phases.length, 3);
  for (const key of ['intake', 'layout', 'aging', 'budget', 'vendor', 'schedule']) {
    assert.ok(result.agents[key], `缺少 ${key}`);
    assert.equal(result.agents[key].mode, 'mock');
  }
  assert.equal(result.summary.agent_count, 6);
});

test('mock 模式的金額與工期仍由規則層算出', async () => {
  const orch = new Orchestrator(new LLMClient({ apiKey: '' }));
  const result = await orch.plan(PROJECT);
  assert.equal(result.summary.total_cost_hkd, 717552);
  assert.equal(result.summary.duration_weeks, 9.5);
  // 全屋裝修 + 有長者：5 項措施（8 項是舊屋改造的加裝清單）
  assert.equal(result.summary.aging_measures, 5);
  assert.ok(result.summary.material_total > 0);
  assert.ok(result.summary.labour_total > 0);
  // 材料 + 人工只涵蓋施工項目，總額還含設計費／監管費／備用金，所以必然較小
  assert.ok(result.summary.material_total < result.summary.total_cost_hkd);
  assert.ok(result.summary.labour_total < result.summary.total_cost_hkd);
});

test('舊屋改造模式：金額變 13,998，工期 2 週，8 項加裝', async () => {
  const orch = new Orchestrator(new LLMClient({ apiKey: '' }));
  const result = await orch.plan({ ...PROJECT, renovation_mode: 'retrofit' });
  assert.equal(result.summary.total_cost_hkd, 13998);
  assert.equal(result.summary.duration_weeks, 2);
  assert.equal(result.summary.aging_measures, 8);
});

test('沒有長者時適老化整段跳過', async () => {
  const orch = new Orchestrator(new LLMClient({ apiKey: '' }));
  const result = await orch.plan({
    ...PROJECT,
    occupants: [{ age: 29, mobility: 'normal' }],
    building_age: 5,
  });
  assert.equal(result.summary.aging_skipped, true);
  assert.equal(result.agents.aging, undefined);
  assert.ok(!result.phases[1].agents.includes('aging'));
});

test('API 層：room 公尺會換算成平方呎', async () => {
  const res = await quoteApi.plan(
    { room: { width: 5.4, depth: 6.5, height: 2.8 }, rooms: 1, building_age: 10 },
    {},
  );
  const data = await res.json();
  assert.ok(data.summary.total_cost_hkd > 0);
  // 5.4 × 6.5 = 35.1 m² ≈ 378 sqft
  assert.ok(Math.abs(data.project.area_sqft - 378) <= 2, String(data.project.area_sqft));
});

test('API 層：缺面積回 400', async () => {
  const res = await quoteApi.plan({ rooms: 2 }, {});
  assert.equal(res.status, 400);
});

test('知識庫端點有內容', () => {
  const k = quoteApi.knowledge();
  assert.equal(k.available, true);
  assert.ok(k.dimension_params > 0);
  assert.ok(k.restricted_fixtures > 0);
  assert.ok(k.subsidy_rules['津貼上限']);
});
