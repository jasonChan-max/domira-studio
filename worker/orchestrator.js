/* 多 agent 編排器 —— Python core/orchestrator.py 的 JS 版。
 *
 * 三階段，其中兩階段並行：
 *   第 1 階段（串行）需求分析
 *   第 2 階段（並行）空間規劃 │ 適老化（條件式）│ 預算
 *   第 3 階段（並行）廠商對接 │ 工期排程
 *
 * 並行省下的正是「設計 → 報價 → 找廠商 → 排期」一路排隊的等待，
 * 這是「快」的技術來源，不是話術。
 *
 * 與 Python 版的差異：不生成 floor_plan 幾何（studio 有自己的 3D 場景），
 * agent 的 mock 內容較短；金額與工期仍由 quote/ 規則層計算。
 */
import { AGENT_CLASSES } from './agents/index.js';
import { PROMPTS } from './agents/prompts.js';
import * as pricing from './quote/pricing.js';
import { money } from './agents/base.js';

export const AGENT_KEYS = ['intake', 'layout', 'aging', 'budget', 'vendor', 'schedule'];
export const SURVEY_KEY = 'survey';

const MOBILITY_LIMITED = ['limited', 'wheelchair', '行動不便', '輪椅'];

export function recommendMode(project) {
  const occupants = (project.occupants || []).filter((o) => o && typeof o === 'object');
  const elderly = occupants.some((o) => (Number(o.age) || 0) >= 65);
  const limited = occupants.some((o) => MOBILITY_LIMITED.includes(String(o.mobility || '').toLowerCase()));
  const age = Number(project.building_age || 0) || 0;

  if (elderly || limited) {
    return ['retrofit', '住戶有長者或行動不便，拆改期間需要搬遷，對他們的風險與干擾都高；建議以加裝為主，只處理必要的安全問題。'];
  }
  if (age >= 30) {
    return ['retrofit', `樓齡 ${age} 年，結構與管線狀況未明；先做加裝與局部修補，確認實際狀況後再決定是否值得全屋翻新。`];
  }
  return ['full', '住戶無長者、樓齡較新，可以一次完成全屋裝修。'];
}

export function needsAgingDesign(project) {
  const occupants = (project.occupants || []).filter((o) => o && typeof o === 'object');
  if (occupants.some((o) => (Number(o.age) || 0) >= 65)) return true;
  if (occupants.some((o) => MOBILITY_LIMITED.includes(String(o.mobility || '').toLowerCase()))) return true;
  return String(project.renovation_mode || 'full').trim().toLowerCase() === 'retrofit';
}

export class Orchestrator {
  constructor(llm) {
    this.llm = llm;
    this.agents = {};
    for (const [key, Cls] of Object.entries(AGENT_CLASSES)) {
      const agent = new Cls(llm);
      // 提示詞由 scripts/sync-prompts.py 從 Python 版抽出，保證一字不差；
      // Python 版改了提示詞就重跑那支腳本，不要手改 prompts.js。
      if (PROMPTS[key]) agent.systemPrompt = PROMPTS[key];
      this.agents[key] = agent;
    }
  }

  roster() {
    return Object.values(this.agents).map((a) => ({
      name: a.name,
      title: a.title,
      icon: a.icon,
      role: String(a.systemPrompt || '').split('。')[0].slice(0, 60),
      conditional: a.name === SURVEY_KEY || a.name === 'aging',
    }));
  }

  async plan(project) {
    const started = Date.now();

    // 影像本體只留給 survey；留在 project 裡會讓六個 agent 各帶一份 base64。
    let images = Array.isArray(project.images) ? project.images : [];
    project = Object.fromEntries(Object.entries(project).filter(([k]) => k !== 'images'));

    if (!project.renovation_mode) {
      project.renovation_mode = recommendMode(project)[0];
    }

    const result = { project, _images: images };
    const phases = [];

    // ── 第 0 階段：現場勘察（條件式）──
    if (images.length && this.agents.survey) {
      const t0 = Date.now();
      result[SURVEY_KEY] = await this.agents.survey.run(result);
      phases.push({
        phase: 0, name: '現場勘察（影像判讀）', parallel: false,
        agents: [SURVEY_KEY], images: images.length,
        elapsed_seconds: Math.round((Date.now() - t0) / 100) / 10,
      });
    }

    // ── 第 1 階段：需求分析（串行）──
    const t1 = Date.now();
    result.intake = await this.agents.intake.run(result);
    phases.push({
      phase: 1, name: '需求分析', parallel: false, agents: ['intake'],
      elapsed_seconds: Math.round((Date.now() - t1) / 100) / 10,
    });

    // ── 第 2 階段：設計與預算並行（適老化條件式）──
    const t2 = Date.now();
    const runAging = needsAgingDesign(project);
    const parallelKeys = ['layout', 'budget'].concat(runAging ? ['aging'] : []);
    const phase2 = await Promise.all(parallelKeys.map(async (key) => [key, await this.agents[key].run(result)]));
    for (const [key, value] of phase2) result[key] = value;
    phases.push({
      phase: 2, name: '設計與預算（並行）', parallel: true,
      agents: parallelKeys, aging_skipped: !runAging,
      elapsed_seconds: Math.round((Date.now() - t2) / 100) / 10,
    });

    // ── 第 3 階段：廠商與排程並行 ──
    const t3 = Date.now();
    const phase3 = await Promise.all(['vendor', 'schedule'].map(async (key) => [key, await this.agents[key].run(result)]));
    for (const [key, value] of phase3) result[key] = value;
    phases.push({
      phase: 3, name: '廠商對接與排程（並行）', parallel: true,
      agents: ['vendor', 'schedule'],
      elapsed_seconds: Math.round((Date.now() - t3) / 100) / 10,
    });

    const elapsed = Math.round((Date.now() - started) / 100) / 10;
    const agentKeys = (SURVEY_KEY in result ? [SURVEY_KEY, ...AGENT_KEYS] : [...AGENT_KEYS])
      .filter((key) => key in result);
    const modes = new Set(agentKeys.map((key) => result[key].mode));

    return {
      project_id: `domira-${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`,
      created_at: new Date().toISOString().slice(0, 19),
      project,
      mode: modes.size === 1 ? (modes.has('live') ? 'live' : 'mock') : 'mixed',
      llm: { model: this.llm ? this.llm.model : null, mode: this.llm && this.llm.live ? 'live' : 'mock' },
      elapsed_seconds: elapsed,
      phases,
      agents: Object.fromEntries(agentKeys.map((key) => [key, result[key]])),
      summary: this.summary(result, elapsed),
    };
  }

  summary(result, elapsed) {
    const intake = result.intake?.output || {};
    const budget = result.budget?.output || {};
    const sched = result.schedule?.output || {};
    const aging = result.aging?.output || {};
    const vendor = result.vendor?.output || {};
    const survey = result[SURVEY_KEY]?.output || {};

    const totalReview = budget.total_review || {};
    const duration = sched.duration_review || {};
    const agentCount = AGENT_KEYS.length + (SURVEY_KEY in result ? 1 : 0);

    const weeksByKey = sched.scenario_weeks || {};
    const scenarios = (budget.scenarios || []).map((row) => ({ ...row, weeks: weeksByKey[row.key] }));

    const project = result.project || {};
    const [suggestedMode, modeReason] = recommendMode(project);
    let upgrade = {};
    try {
      const cmp = pricing.modeComparison(project);
      upgrade = {
        retrofit_total: cmp.retrofit.total,
        full_total: cmp.full.total,
        upgrade_cost: cmp.upgrade_cost,
        ratio: cmp.ratio,
      };
    } catch (e) { /* 升級提示算不出來不該讓整份方案失敗 */ }

    return {
      headline: intake.summary || '',
      tags: intake.project_tags || [],
      scenarios,
      mode: project.renovation_mode || 'full',
      recommended_mode: suggestedMode,
      mode_reason: modeReason,
      mode_comparison: upgrade,
      total_cost_hkd: totalReview.total,
      budget_hkd: totalReview.budget,
      gap_hkd: totalReview.gap,
      budget_status: totalReview.status,
      duration_weeks: duration.weeks,
      duration_note: duration.vs_deadline || '',
      aging_measures: (aging.measures || []).length,
      aging_applicable: aging.aging_applicable !== false,
      aging_skipped: !('aging' in result),
      material_total: budget.material_total || 0,
      labour_total: budget.labour_total || 0,
      needs_subsidy: sched.needs_subsidy !== false,
      restricted_warnings: (aging.restricted_warnings || []).length,
      recommended_vendors: (vendor.recommended_vendors || []).map((v) => v.name),
      planning_seconds: elapsed,
      images_analyzed: (result._images || []).length,
      hazards_found: (survey.aging_hazards || []).length,
      verify_items: (survey.to_verify_on_site || []).length,
      detected_area_sqft: (survey.plan || {}).detected_area_sqft,
      additional_risk_hkd: budget.additional_total || 0,
      additional_risk_note: budget.additional_note || '',
      agent_count: agentCount,
      note: `以上結果由 ${agentCount} 個專業 agent 協作產生；法規數值與津貼依據來自香港官方文件知識庫，金額由價目表計算。`
        + (budget.additional_total ? '影像判讀出的追加工程與主造價分開列示，須現場確認。' : ''),
    };
  }
}

export { money };
