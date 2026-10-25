/* Agent 輸出的結構校驗與補齊 —— Python core/schema.py 的 JS 版。
 *
 * 「寬進嚴出」：缺欄位補預設、型別不對就轉（並記錄問題）、多給的欄位保留。
 * 這不是騙過使用者，而是讓一次不完美的模型回覆仍能產出完整方案，
 * 同時在結果裡誠實標註哪裡是補的。
 */

export const SHAPES = {
  intake: {
    summary: ['str', ''],
    household_profile: ['dict', {}],
    project_tags: ['list', []],
    priorities: ['list', []],
    risks: ['list', []],
    missing_info: ['list', []],
    recommended_route: ['str', ''],
    fast_track_hint: ['str', ''],
  },
  layout: {
    layout_strategy: ['str', ''],
    zones: ['list', []],
    storage_plan: ['dict', {}],
    circulation: ['dict', {}],
    lighting_daylight: ['list', []],
    do_not_touch: ['list', []],
    quick_wins: ['list', []],
    risks: ['list', []],
  },
  aging: {
    design_principles: ['list', []],
    measures: ['list', []],
    restricted_warnings: ['list', []],
    subsidy_plan: ['dict', {}],
    compliance_checklist: ['list', []],
    phasing: ['list', []],
  },
  budget: {
    verdict: ['str', ''],
    total_review: ['dict', {}],
    cost_drivers: ['list', []],
    optimizations: ['list', []],
    do_not_cut: ['list', []],
    subsidy_offset: ['dict', {}],
    cashflow: ['list', []],
  },
  vendor: {
    sourcing_strategy: ['str', ''],
    recommended_vendors: ['list', []],
    split_plan: ['list', []],
    rfq_checklist: ['list', []],
    red_flags: ['list', []],
    contract_terms: ['list', []],
    next_actions: ['list', []],
  },
  schedule: {
    duration_review: ['dict', {}],
    critical_path: ['list', []],
    compression_plan: ['list', []],
    parallel_opportunities: ['list', []],
    milestones: ['list', []],
    delay_risks: ['list', []],
    weekly_plan: ['list', []],
  },
  survey: {
    plan: ['dict', {}],
    spaces: ['list', []],
    aging_hazards: ['list', []],
    measurements: ['list', []],
    scope_signals: ['list', []],
    to_verify_on_site: ['list', []],
    conflicts: ['list', []],
  },
};

const TYPE_LABEL = { str: '字串', list: '陣列', dict: '物件', number: '數字' };

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function cloneDefault(value) {
  if (Array.isArray(value)) return [];
  if (isPlainObject(value)) return {};
  return value;
}

function coerce(value, kind) {
  if (kind === 'str') {
    if (typeof value === 'string') return [value, true];
    if (value === null || value === undefined) return ['', true];
    if (Array.isArray(value) || isPlainObject(value)) return ['', false];
    return [String(value), true];
  }

  if (kind === 'list') {
    if (Array.isArray(value)) return [value, true];
    if (value === null || value === undefined) return [[], true];
    if (isPlainObject(value)) {
      for (const key of ['items', 'list', 'data', 'values']) {
        if (Array.isArray(value[key])) return [value[key], true];
      }
      return [[], false];
    }
    if (typeof value === 'string') {
      const parts = value.replace(/；/g, '、').replace(/,/g, '、').split('、')
        .map((p) => p.trim()).filter(Boolean);
      return [parts, true];
    }
    return [[], false];
  }

  if (kind === 'dict') {
    if (isPlainObject(value)) return [value, true];
    if (Array.isArray(value) && value.length && value.every(isPlainObject)) {
      return [{ items: value }, true];
    }
    return [{}, false];
  }

  if (kind === 'number') {
    if (typeof value === 'boolean') return [0, false];
    if (typeof value === 'number') return [value, true];
    if (typeof value === 'string') {
      const cleaned = value.replace(/,/g, '').replace(/HK\$/g, '').replace(/\$/g, '').trim();
      const n = Number(cleaned);
      if (Number.isFinite(n)) return [n, true];
      return [0, false];
    }
    return [0, false];
  }

  return [value, true];
}

/* 把 agent 的原始輸出整理成保證可用的結構，回傳 [資料, 問題清單]。 */
export function normalize(agentName, data) {
  const issues = [];

  if (!isPlainObject(data)) {
    const typeName = data === null ? 'NoneType' : Array.isArray(data) ? 'list' : typeof data;
    return [{}, [`頂層不是物件（實際為 ${typeName}），已全部使用預設值`]];
  }

  const shape = SHAPES[agentName];
  if (!shape) return [data, []];

  const result = {};

  // 先保留模型多給的欄位 —— 可能是有用的補充資訊
  for (const [key, value] of Object.entries(data)) {
    if (!(key in shape)) result[key] = value;
  }

  for (const [key, [kind, def]] of Object.entries(shape)) {
    if (!(key in data)) {
      issues.push(`缺少欄位 ${key}，已補預設值`);
      result[key] = cloneDefault(def);
      continue;
    }
    const [value, ok] = coerce(data[key], kind);
    if (!ok) {
      issues.push(`欄位 ${key} 型別不符（期望${TYPE_LABEL[kind] || kind}），已改用預設值`);
      result[key] = cloneDefault(def);
    } else {
      result[key] = value;
    }
  }

  return [result, issues];
}
