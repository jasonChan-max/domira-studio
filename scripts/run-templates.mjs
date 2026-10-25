/* 三個客群模板，各跑一次完整鏈路（mock 模式，不花 API 費用）。
 *
 * 目的不是「看它能不能跑」，是看**不同客群下判斷是否合理**：
 * 長者舊樓該走加裝、年輕新屋該走全屋、預算不足時三套方案怎麼分岔。
 *
 * 用法：node scripts/run-templates.mjs [--json]
 */
import { Orchestrator } from '../worker/orchestrator.js';
import { LLMClient } from '../worker/quote/llm.js';

const TEMPLATES = [
  {
    key: 'A',
    name: '長者舊樓・只加不改',
    note: '72 歲行動不便、45 年樓齡、預算 30 萬，應該走 retrofit、不搬走',
    project: {
      area_sqft: 380, rooms: 2, building_age: 45, budget_hkd: 300000,
      renovation_mode: 'retrofit', deadline_weeks: 4, district: '深水埗',
      occupants: [{ age: 72, mobility: 'limited', relation: '母親' }],
      pain_points: ['廚廁漏水', '浴室濕滑'],
    },
  },
  {
    key: 'B',
    name: '長者舊樓・全屋裝修',
    note: '同一間屋改走 full，對照「差幾倍」',
    project: {
      area_sqft: 380, rooms: 2, building_age: 45, budget_hkd: 500000,
      renovation_mode: 'full', deadline_weeks: 8, district: '深水埗',
      occupants: [{ age: 72, mobility: 'limited', relation: '母親' }],
      pain_points: ['廚廁漏水', '儲物不足'],
    },
  },
  {
    key: 'C',
    name: '年輕新屋・全屋裝修',
    note: '29／27 歲、5 年樓齡、預算 80 萬，不應出現適老化',
    project: {
      area_sqft: 500, rooms: 3, building_age: 5, budget_hkd: 800000,
      renovation_mode: 'full', deadline_weeks: 10, district: '將軍澳',
      occupants: [{ age: 29, mobility: 'normal' }, { age: 27, mobility: 'normal' }],
      pain_points: ['儲物不足'],
    },
  },
];

const asJson = process.argv.includes('--json');
const results = [];

for (const t of TEMPLATES) {
  const orch = new Orchestrator(new LLMClient({ apiKey: '' }));
  const r = await orch.plan(t.project);
  const s = r.summary;
  const budget = r.agents.budget?.output || {};
  const schedule = r.agents.schedule?.output || {};
  const vendor = r.agents.vendor?.output || {};
  const aging = r.agents.aging?.output || {};

  const entry = {
    key: t.key,
    name: t.name,
    note: t.note,
    mode: s.mode,
    recommended: s.recommended_mode,
    agent_count: s.agent_count,
    aging_skipped: s.aging_skipped,
    total: s.total_cost_hkd,
    budget: s.budget_hkd,
    gap: s.gap_hkd,
    weeks: s.duration_weeks,
    aging_measures: s.aging_measures,
    scenarios: s.scenarios.map((x) => ({ label: x.label, total: x.total, weeks: x.weeks })),
    critical: (schedule.critical_path || []).slice(0, 3).map((x) => x.name),
    vendors: (vendor.recommended_vendors || []).slice(0, 2).map((x) => `${x.name}(${x.score})`),
    warnings: (aging.restricted_warnings || []).length,
    missing: (r.agents.intake?.output?.missing_info || []).length,
  };
  results.push(entry);
}

if (asJson) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const r of results) {
    console.log(`\n=== ${r.key} ${r.name} ===`);
    console.log(`  ${r.note}`);
    console.log(`  模式 ${r.mode} / agent ${r.agent_count} 個 / 適老化${r.aging_skipped ? '跳過' : r.aging_measures + ' 項'}`);
    console.log(`  總額 ${r.total.toLocaleString('en-US')} HKD（預算 ${r.budget.toLocaleString('en-US')}，${r.gap > 0 ? '超 ' + r.gap.toLocaleString('en-US') : '在預算內'}）`);
    console.log(`  工期 ${r.weeks} 週 / 系統建議 ${r.recommended}`);
    console.log(`  三套：${r.scenarios.map((s) => `${s.label} ${s.total.toLocaleString('en-US')}(${s.weeks ?? '-'}週)`).join(' / ')}`);
    console.log(`  關鍵路徑：${r.critical.join(' → ')}`);
    console.log(`  建議廠商：${r.vendors.join('、')}`);
    console.log(`  法規紅線 ${r.warnings} 條 / 待補資訊 ${r.missing} 項`);
  }
}
