/* Domira 報價／規劃 API —— 接在現有 Cloudflare Worker 上的薄路由層。
 *
 * 對外端點：
 *   GET  /api/agents     七個 agent 的名冊
 *   GET  /api/knowledge  法規知識庫摘要
 *   POST /api/plan       {area_sqft, rooms, building_age, budget_hkd, occupants, renovation_mode, images?}
 *                        → 三階段規劃結果（agents、summary、phases）
 *
 * 設計取捨：不重複寫一套 JSON 回應格式，直接復用 Worker 的 json() 慣例；
 * 金額與工期由 quote/ 規則層計算，模型只負責解釋。
 */
import { clientFromEnv } from './quote/llm.js';
import { Orchestrator } from './orchestrator.js';
import * as hk from './quote/hk-rules.js';
import * as pricing from './quote/pricing.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  },
});

export function agents() {
  const orch = new Orchestrator(null);
  return { agents: orch.roster() };
}

export function knowledge() {
  return {
    available: hk.hasKb(),
    dimension_params: hk.dimensionParams().length,
    dimension_categories: hk.dimensionCategories(),
    restricted_fixtures: hk.restrictedFixtures().length,
    subsidy_items: hk.subsidyItems().length,
    subsidy_rules: hk.subsidyRules(),
    sources: hk.sources().length,
    compliance_documents: hk.complianceDocuments().length,
    price_meta: pricing.PRICE.meta,
  };
}

export async function plan(body, env) {
  const project = { ...(body || {}) };
  if (!project.area_sqft && !(project.room && project.room.width)) {
    return json({ error: '請提供 area_sqft（平方呎）或 room.width/depth（公尺）' }, 400);
  }

  // 允許前端直接送 studio 的 room（公尺），轉成我們的平方呎。
  if (!project.area_sqft && project.room) {
    const w = Number(project.room.width || 0);
    const d = Number(project.room.depth || 0);
    if (w > 0 && d > 0) project.area_sqft = Math.round(w * d * 10.7639);
  }
  if (!project.rooms && project.room) project.rooms = 1;

  const llm = clientFromEnv(env);
  const orch = new Orchestrator(llm);
  const result = await orch.plan(project);

  // 公開部署時不要把 project_id 以外的個資回傳；目前只有面積與樓齡，無需特別處理。
  return json(result);
}
