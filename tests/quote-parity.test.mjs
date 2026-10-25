/* 報價引擎的 Python / JS parity 測試。
 *
 * 做法：Python 版先產生基準（scripts/make-baseline.py），這裡逐欄位比對。
 * 為什麼要這麼嚴：兩邊各算一次，差一元客戶就會發現；而且「差一點點」
 * 通常不是四捨五入，是某個係數或排除規則寫錯了。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as pricing from '../worker/quote/pricing.js';
import * as schedule from '../worker/quote/schedule.js';
import * as hk from '../worker/quote/hk-rules.js';
import * as schema from '../worker/quote/schema.js';

const baseline = JSON.parse(
  fs.readFileSync(new URL('./fixtures/pricing-baseline.json', import.meta.url), 'utf8'),
);
const project = baseline.project;

for (const profile of ['standard', 'economy', 'essential', 'retrofit']) {
  const py = baseline[profile];

  test(`${profile}：總額與小計一致`, () => {
    const js = pricing.estimate(project, null, profile);
    assert.equal(js.total, py.total, 'total');
    assert.equal(js.subtotal, py.subtotal, 'subtotal');
    assert.equal(js.material_total, py.material_total, 'material_total');
    assert.equal(js.labour_total, py.labour_total, 'labour_total');
    assert.equal(js.aging_subtotal, py.aging_subtotal, 'aging_subtotal');
    assert.equal(js.within_budget, py.within_budget, 'within_budget');
    assert.equal(js.gap, py.gap, 'gap');
  });

  test(`${profile}：分項逐筆一致`, () => {
    const js = pricing.estimate(project, null, profile);
    assert.equal(js.lines.length, py.lines.length, 'lines 數量');
    for (let i = 0; i < py.lines.length; i++) {
      const a = py.lines[i];
      const b = js.lines[i];
      assert.equal(b.code, a.code, `第 ${i} 行 code`);
      assert.equal(b.quantity, a.quantity, `${a.code} quantity`);
      assert.equal(b.unit_price, a.unit_price, `${a.code} unit_price`);
      assert.equal(b.amount, a.amount, `${a.code} amount`);
      assert.equal(b.materials, a.materials, `${a.code} materials`);
      assert.equal(b.labour, a.labour, `${a.code} labour`);
    }
    assert.deepEqual(js.excluded_items, py.excluded_items, 'excluded_items');
  });
}

test('改造模式逐項勾選單價一致', () => {
  const js = pricing.retrofitLineItems(project);
  assert.deepEqual(Object.keys(js).sort(), Object.keys(baseline.retrofit_items).sort());
  for (const [code, py] of Object.entries(baseline.retrofit_items)) {
    assert.equal(js[code].amount, py.amount, `${code} amount`);
    assert.equal(js[code].unit_price, py.unit_price, `${code} unit_price`);
  }
});

test('兩種模式比較一致', () => {
  const js = pricing.modeComparison(project);
  const py = baseline.mode_comparison;
  assert.equal(js.retrofit.total, py.retrofit.total);
  assert.equal(js.full.total, py.full.total);
  assert.equal(js.upgrade_cost, py.upgrade_cost);
  assert.equal(js.upgrade_pct, py.upgrade_pct);
  assert.equal(js.ratio, py.ratio);
});

test('三套方案比較一致', () => {
  const js = pricing.scenarioComparison(project);
  const py = baseline.scenarios;
  assert.equal(js.length, py.length);
  for (let i = 0; i < py.length; i++) {
    assert.equal(js[i].key, py[i].key);
    assert.equal(js[i].total, py[i].total);
    assert.equal(js[i].saving_vs_standard, py[i].saving_vs_standard);
    assert.equal(js[i].saving_pct, py[i].saving_pct);
    assert.equal(js[i].line_count, py[i].line_count);
  }
});

test('排程：五種條件下工期與關鍵路徑一致', () => {
  const py = baseline.schedule;
  const cases = [
    ['full_elderly', () => schedule.compute(schedule.buildTasks({ hasElderly: true, needsSubsidy: true }))],
    ['full_elderly_no_subsidy', () => schedule.compute(schedule.buildTasks({ hasElderly: true, needsSubsidy: false }))],
    ['full_young', () => schedule.compute(schedule.buildTasks({ hasElderly: false, needsSubsidy: true }))],
    ['essential', () => schedule.compute(schedule.buildTasks({
      hasElderly: true, needsSubsidy: true,
      excludeTrades: new Set(['木工', '油漆', '門窗']),
    }))],
    ['retrofit', () => schedule.compute(schedule.buildRetrofitTasks())],
  ];

  for (const [key, fn] of cases) {
    const js = fn();
    assert.equal(js.duration_weeks, py[key].duration_weeks, key + ' 總工期');
    assert.equal(js.tasks.length, py[key].tasks.length, key + ' 工序數');

    const pyById = new Map(py[key].tasks.map((t) => [t.id, t]));
    for (const row of js.tasks) {
      const p = pyById.get(row.id);
      assert.ok(p, key + ' 缺少工序 ' + row.id);
      assert.equal(row.start_week, p.start_week, key + ' ' + row.id + ' 開始');
      assert.equal(row.finish_week, p.finish_week, key + ' ' + row.id + ' 完成');
      assert.equal(row.slack_weeks, p.slack_weeks, key + ' ' + row.id + ' 浮時');
      assert.equal(row.critical, p.critical, key + ' ' + row.id + ' 關鍵');
    }
    assert.deepEqual(
      js.critical_path.map((r) => r.name),
      py[key].critical_path.map((r) => r.name),
      key + ' 關鍵路徑',
    );
  }
});

test('法規查詢：數量與欄位一致', () => {
  const py = baseline.hk;
  assert.equal(hk.restrictedFixtures().length, py.restricted, '甲類');
  assert.equal(hk.freeToChangeFixtures().length, py.free, '丙類');
  assert.equal(hk.approvalRequiredFixtures().length, py.approval, '乙類');
  assert.equal(hk.subsidyItems().length, py.subsidy, '津貼項目');
  assert.equal(hk.directSubsidyItems().length, py.direct, '直接津貼');
  assert.equal(hk.dimensionParams().length, py.dimension, '尺寸參數');
  assert.deepEqual(hk.dimensionCategories(), py.dim_categories, '類別');
  assert.equal(hk.keyParamsCompare().length, py.compare, '關鍵參數');
  assert.equal(hk.sources().length, py.sources, '來源');
  assert.equal(hk.complianceDocuments().length, py.compliance, '合規文件');
  assert.deepEqual(Object.keys(hk.subsidyRules()), py.subsidy_rule_keys, '津貼限制鍵');
  assert.deepEqual(Object.keys(hk.briefingForPrompt()), py.briefing_keys, '簡報鍵');
  assert.deepEqual(hk.dimensionParams()[0], py.first_dimension, '第一條尺寸參數');
});

test('schema 校驗：壞輸入的處理與 Python 一致', () => {
  const cases = {
    '缺欄位': ['intake', { summary: 'ok' }],
    '型別錯': ['layout', {
      layout_strategy: ['不該是陣列'],
      zones: '分區A、分區B',
      storage_plan: [{ a: 1 }],
      circulation: '不是物件',
    }],
    '包裝清單': ['aging', {
      measures: { items: [{ code: 'handrail_bath' }] },
      subsidy_plan: { plan: 'x' },
    }],
    '多餘欄位': ['budget', { verdict: 'ok', extra_note: '模型多給的' }],
    '頂層非物件': ['vendor', ['not', 'an', 'object']],
  };
  for (const [name, [agent, input]] of Object.entries(cases)) {
    const [data, issues] = schema.normalize(agent, input);
    const [pyData, pyIssues] = baseline.schema_cases[name];
    assert.deepEqual(data, pyData, name + ' 資料');
    assert.deepEqual(issues, pyIssues, name + ' 問題清單');
  }
});
