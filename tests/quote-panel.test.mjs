/* 報價面板的純函式測試（不碰 DOM，Node 直接跑）。
 *
 * 面板本身靠 DOM 事件，但「把 /api/plan 的結果變成 HTML」是純函式，
 * 可以獨立驗證：金額有沒有出現、三套方案在不在、法規紅線有沒有漏。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderQuoteResult } from '../public/quote-panel.js';

const PLAN = {
  summary: {
    total_cost_hkd: 717552,
    duration_weeks: 9.5,
    material_total: 300000,
    labour_total: 250000,
    aging_measures: 4,
    mode: 'full',
    recommended_mode: 'retrofit',
  },
  agents: {
    budget: {
      output: {
        total_review: { total: 717552, budget: 500000, gap: 217552, status: 'over_budget' },
        scenarios: [
          { key: 'standard', label: '全屋標準', total: 717552, weeks: 9.5, saving_vs_standard: 0 },
          { key: 'economy', label: '降規格（範圍不變）', total: 600000, weeks: 9.5, saving_vs_standard: 117552 },
          { key: 'essential', label: '縮範圍（只做必要）', total: 420000, weeks: 7, saving_vs_standard: 297552 },
        ],
      },
    },
    aging: {
      output: {
        measures: [{ measure: '浴室扶手', spec: '850–950mm' }],
        restricted_warnings: [{ item: '廚房間隔牆', risk: '屬甲類固定裝置，不得改動' }],
      },
    },
    schedule: { output: { critical_path: [{ name: '泥水', weeks: 2 }] } },
    vendor: { output: { recommended_vendors: [{ name: '示例承辦商', score: 88.5, covered_trades: ['泥水'] }] } },
  },
};

test('報價結果含總額、工期與材料人工', () => {
  const html = renderQuoteResult(PLAN);
  assert.ok(html.includes('HK$717,552'), '總額');
  assert.ok(html.includes('9.5 週'), '工期');
  assert.ok(html.includes('HK$300,000'), '材料');
  assert.ok(html.includes('HK$250,000'), '人工');
});

test('三套方案、法規紅線、適老化措施都在', () => {
  const html = renderQuoteResult(PLAN);
  assert.ok(html.includes('全屋標準'));
  assert.ok(html.includes('降規格'));
  assert.ok(html.includes('縮範圍'));
  assert.ok(html.includes('廚房間隔牆'));
  assert.ok(html.includes('浴室扶手'));
  assert.ok(html.includes('示例承辦商'));
});

test('缺金額時給明確錯誤，不假裝成功', () => {
  const html = renderQuoteResult({ summary: {}, agents: {} });
  assert.ok(html.includes('quote-error'));
  assert.ok(html.includes('沒有回傳金額'));
});
