/* 七個專業 agent —— Python agents/*.py 的精簡 JS 版（先讓鏈路跑得起來）。
 *
 * 這一版的取捨：mock 內容比 Python 版短，但結構完全一致；金額、工期、法規
 * 一律由 quote/ 的規則層算出，不讓 mock 數字變成假權威。提示詞之後再補齊。
 */
import { BaseAgent, projectOf, areaOf, money, hasElderly, mobilityLimited } from './base.js';
import * as pricing from '../quote/pricing.js';
import * as schedule from '../quote/schedule.js';
import * as hk from '../quote/hk-rules.js';
import * as vendors from '../quote/vendor-match.js';

function modeOf(project) {
  return String(project?.renovation_mode || 'full').toLowerCase();
}

function profileOf(context) {
  return modeOf(projectOf(context)) === 'retrofit' ? 'retrofit' : 'standard';
}

function estimateOf(context, profile = null) {
  return pricing.estimate(projectOf(context), null, profile || profileOf(context));
}

/* 三套方案一律用「全屋工序」算工期。
 * 這是 Python 版踩過的坑：retrofit 模式若拿改造 CPM 去配全屋金額，
 * 畫面會出現「717,552 配 2.0 週」，評審一眼就看出矛盾。 */
function scenarioWeeksFor(elderly, withAging) {
  const full = schedule.compute(schedule.buildTasks({
    hasElderly: elderly, needsSubsidy: withAging,
  }));
  const essential = schedule.compute(schedule.buildTasks({
    hasElderly: elderly, needsSubsidy: withAging,
    excludeTrades: new Set(['木工', '油漆', '門窗']),
  }));
  return {
    standard: full.duration_weeks,
    economy: full.duration_weeks,
    essential: essential.duration_weeks,
  };
}

/* 從知識庫取真實數值，讓示例不是硬編碼的空話。 */
function agingSpec(params, category, item, fallback) {
  const p = params.get(category + '|' + item);
  if (!p) return [fallback, '—'];
  const range = `${p.min}–${p.max} ${p.unit}`.replace(/^[–\s]+|[–\s]+$/g, '');
  return [range, `${p.source}（${p.grade} 級）`];
}

function agingMock(context) {
  const p = projectOf(context);
  const params = new Map(hk.dimensionParams().map((x) => [x.category + '|' + x.item, x]));
  const [handrailSpec, handrailRef] = agingSpec(params, '扶手', '扶手頂高度（長者友善）', '810–900 mm');
  const [thresholdSpec, thresholdRef] = agingSpec(params, '門', '門檻高度', '≤20 mm 並倒斜邊');

  if (modeOf(p) === 'retrofit') {
    return {
      design_principles: [
        '只加不改：不清拆、不動水電泥水，住戶可以繼續住在家裡',
        '先處理跌倒風險：浴室、夜間動線、出入口',
        '優先選丙類可自行施工的項目，不必等批准、不必搬走',
      ],
      measures: [
        {
          area: '浴室', measure: '沿坐廁及淋浴位加裝 L 型扶手',
          spec: `扶手頂距地 ${handrailSpec}；管徑 32–50 mm；距牆 30–50 mm 淨空`,
          standard_ref: handrailRef, fixture_class: '丙（丙八，扶手）',
          approval_needed: '否 —— 丙類可自行改動', cost_level: '低', code: 'handrail_bath',
          why: '浴室是長者跌倒最高發的位置，扶手是最直接的干預',
        },
        {
          area: '走廊', measure: '沿主要動線加裝連續扶手',
          spec: `扶手頂距地 ${handrailSpec}；連續不斷開，轉角位做圓角`,
          standard_ref: handrailRef, fixture_class: '丙（丙八，扶手）',
          approval_needed: '否 —— 丙類可自行改動', cost_level: '低', code: 'handrail_corridor',
          why: '夜間由睡房到廁所的動線最容易跌倒',
        },
        {
          area: '浴室', measure: '坐廁旁加裝上翻式扶手',
          spec: '扶手承重 ≥1.3 kN；安裝位置須按使用者坐姿現場定位',
          standard_ref: 'APP-41 第 6 章（長者友善設計）', fixture_class: '丙（丙八，扶手）',
          approval_needed: '否 —— 丙類可自行改動', cost_level: '低', code: 'toilet_grab_bar',
          why: '坐下與起身是膝關節負荷最大的動作',
        },
        {
          area: '浴室', measure: '淋浴位加裝摺合座椅',
          spec: '座椅承重須達成人體重；收起後不阻通道',
          standard_ref: 'APP-41 第 6 章（長者友善設計）', fixture_class: '丙（丙八，扶手）',
          approval_needed: '否 —— 丙類可自行改動', cost_level: '中', code: 'shower_seat',
          why: '站立淋浴對平衡力要求高，坐著洗最安全',
        },
        {
          area: '浴室', measure: '浴室地面加鋪防滑層',
          spec: '濕態防滑等級 R10 或以上；不需拆除原有地磚',
          standard_ref: 'APP-41 第 6 章（長者友善設計）', fixture_class: '丙（丙八）',
          approval_needed: '否 —— 加鋪不涉改動', cost_level: '中', code: 'non_slip_tile',
          why: '濕滑地面是浴室跌倒的主因',
        },
        {
          area: '睡房／走廊', measure: '加裝感應式夜燈',
          spec: '感應範圍覆蓋床邊至廁所動線；色溫偏暖、亮度可調',
          standard_ref: 'APP-41 第 6 章（照明）', fixture_class: '丙',
          approval_needed: '否 —— 插電式免拉線', cost_level: '低', code: 'night_light',
          why: '夜間摸黑找開關是常見的跌倒情境',
        },
        {
          area: '廚房／浴室', measure: '更換推桿式水龍頭',
          spec: '單柄推桿操作，不需扭轉；水溫標示清楚',
          standard_ref: 'APP-41 第 6 章（長者友善設計）', fixture_class: '丙（丙八）',
          approval_needed: '否 —— 更換龍頭屬丙類', cost_level: '低', code: 'lever_tap',
          why: '扭動式龍頭對手部力量與關節不友善',
        },
        {
          area: '出入口', measure: '門檻加裝斜邊膠條',
          spec: `門檻高 ${thresholdSpec}；斜邊兩側做圓角`,
          standard_ref: thresholdRef, fixture_class: '丙',
          approval_needed: '否 —— 加裝膠條不涉改動', cost_level: '低', code: 'threshold_strip',
          why: '門檻是助行架與輪椅最常卡住的位置',
        },
      ],
      required_fixes: [
        {
          item: '浴室地台去水及防水層老化',
          why: '長期滲水會影響下層單位，屬必須處理的安全問題',
          why_not_add_on: '防滑層貼在失效的防水層上，日後仍會滲漏；必須先做局部防水，光加裝解決不了',
          priority: '立即',
        },
        {
          item: '廚房去水喉鏽蝕',
          why: '鐵喉鏽蝕會突然爆裂，樓齡 45 年的單位尤其常見',
          why_not_add_on: '屬喉管本身老化，須更換該段管道，非加裝可解決',
          priority: '短期',
        },
      ],
      restricted_warnings: [
        {
          item: '結構牆、隔火門、垂直排水渠',
          risk: '屬甲類固定裝置，不准許改動；未經批准改動會被要求還原並收費',
          alternative: '改造模式本來就不動這些，全部以加裝方式處理',
        },
      ],
      subsidy_plan: {
        schemes: [
          {
            name: '市建局「有需要人士維修自住物業津貼」',
            covers: '安裝無障礙設施（扶手、防滑、推桿水龍頭屬此類）',
            ceiling: '上限 HK$80,000（實際額以批核為準）',
          },
        ],
        action: '加裝項目多屬津貼涵蓋範圍；須在施工前完成申請並讓市建局視察，否則該項目不獲津貼。',
      },
      compliance_checklist: [
        {
          scope: '扶手及防滑設施',
          qualified_by: '丙類可自行施工，或由註冊小型工程承建商安裝',
          documents: '一般毋須遞交；保留發票與保養證明',
        },
      ],
      phasing: [
        { phase: '第 1 週前半', what: '進場保護、家具移位；現場定位扶手高度' },
        { phase: '第 1 週後半', what: '安裝扶手、淋浴椅、夜燈、推桿水龍頭' },
        { phase: '第 2 週', what: '防滑層與門檻膠條；清潔與使用教學' },
      ],
    };
  }

  // 全屋裝修：有長者才給 5 項，否則只留前 3 項核心
  const elderly = hasElderly(p) || mobilityLimited(p);
  const measures = [
    {
      area: '浴室', measure: '沿坐廁及淋浴位加裝 L 型扶手',
      spec: `扶手頂距地 ${handrailSpec}；管徑 32–50 mm；距牆 30–50 mm 淨空`,
      standard_ref: handrailRef, fixture_class: '丙（丙八，扶手）',
      approval_needed: '否 —— 丙類可自行改動', cost_level: '低', code: 'handrail_bath',
      why: '浴室是長者跌倒最高發的位置，扶手是最直接有效的干預',
    },
    {
      area: '浴室', measure: '浴缸改淋浴間並設摺合座椅',
      spec: '淋浴間 ≥1500×900 mm；地面防滑；座椅承重須達成人體重',
      standard_ref: 'APP-41 第6章（A 級）；房委會免費調適「改成淋浴間」',
      fixture_class: '乙（乙十，潔具）',
      approval_needed: '須房委會批准；公屋租戶可申請免費改裝連扶手',
      cost_level: '中', code: 'shower_seat',
      why: '跨浴缸是長者最危險的動作；且公屋可免費改，不必自費',
    },
    {
      area: '全屋', measure: '門檻處理與地面平整化',
      spec: `門檻高 ${thresholdSpec}`,
      standard_ref: thresholdRef, fixture_class: '丙（丙四，地台面終飾）',
      approval_needed: '否', cost_level: '低', code: 'threshold_strip',
      why: '20 mm 已是跌倒風險臨界，助行架與輪椅都容易被絆住',
    },
    {
      area: '走廊及睡房', measure: '感應式夜燈與連續照明',
      spec: '公共地方照度 ≥120 lux，均勻、無眩光；夜燈沿動線腳位高度安裝',
      standard_ref: 'APP-41 第6章（照明建議值，A 級）', fixture_class: '丙（丙十三，門鐘／屬電器附件）',
      approval_needed: '否', cost_level: '低', code: 'night_light',
      why: '夜間起身視線不足是夜間跌倒主因；照明是法定手冊中最容易被忽略的一項',
    },
    {
      area: '廚房', measure: '水龍頭改推桿式，灶台面降低並留空下方',
      spec: '單桿式開關，減少扭動手腕；灶台前留 ≥1200 mm 迴轉空間',
      standard_ref: '房委會免費調適「更換推桿式水龍頭」（B 級）',
      fixture_class: '丙（丙七，灶台面終飾）', approval_needed: '否（公屋可申請免費更換）',
      cost_level: '低', code: 'lever_tap',
      why: '手腕扭力下降是長者最常見的功能退化，扭式水龍頭對他們是高難度動作',
    },
  ];

  return {
    design_principles: [
      '先防跌倒，再談美觀 —— 浴室與動線優先於風格',
      '可逆性原則 —— 優先選丙類可自行改動的裝置，日後長者狀況變化仍可調整',
      '不碰甲類 —— 結構、消防、主喉管一律不動，避免還原與罰則',
      '能用津貼就用津貼 —— 先查市建局與房委會，再決定自費範圍',
    ],
    measures: elderly ? measures : measures.slice(0, 3),
    restricted_warnings: [
      {
        item: '拆除廚房與客廳之間的間隔牆以打通空間',
        risk: '該牆多屬甲一（預製內牆／廚房廁所浴室間格牆），未經批准改動，房屋署會還原並向租戶收取費用',
        alternative: '改用玻璃趟門或半開放式設計，保留原牆體，視覺上同樣通透',
      },
      {
        item: '改動單位大門（例如加闊或更換）',
        risk: '單位大門屬甲二（隔火門），涉及消防分隔與耐火時效，不准許改動',
        alternative: '保留原門，改為在門外加裝助力扶手與感應燈；門檻以斜邊膠條處理',
      },
    ],
    subsidy_plan: {
      schemes: hk.directSubsidyItems().map((item) => ({
        name: item.plan,
        covers: `${item.item}：${String(item.detail).slice(0, 80)}`,
        ceiling: '市建局計劃：每宗申請上限 HK$80,000；10 年內最多 4 次',
      })),
      action: '關鍵時序：住用單位維修須在工程開始前完成申請，市建局職員視察施工前狀況前切勿開工 —— 否則該項目不獲津貼。',
    },
    compliance_checklist: hk.complianceDocuments()
      .filter((c) => ['電力裝置及設備', '來水喉', '去水喉', '窗戶', '防火門及其他門'].includes(c.category))
      .map((c) => ({ scope: c.category, qualified_by: c.qualified_by || '—', documents: c.documents || '—' })),
    phasing: [
      { phase: '第 0 週', what: '提交津貼申請並安排市建局視察（未視察不得開工）' },
      { phase: '第 1–2 週', what: '清拆與水電重造；同步訂造扶手與淋浴座椅' },
      { phase: '第 3–5 週', what: '泥水、防水、防滑地磚；扶手預埋件' },
      { phase: '第 6–7 週', what: '安裝扶手、潔具、照明；合規文件送審' },
      { phase: '第 8 週', what: '清潔驗收；津貼結算文件遞交' },
    ],
  };
}

export class IntakeAgent extends BaseAgent {
  constructor(llm) {
    super(llm);
    this.name = 'intake';
    this.title = '需求分析';
    this.icon = '🧭';
    this.systemPrompt = '你是香港裝修需求分析師。整理客戶的面積、樓齡、預算、住戶與痛點，'
      + '輸出 JSON：summary、household_profile、project_tags、priorities、risks、'
      + 'missing_info、recommended_route、fast_track_hint。不要報價、不要工期、不要法規數字。';
  }

  mock(context) {
    const p = projectOf(context);
    const area = areaOf(context);
    const age = Number(p.building_age || 0);
    const budget = Number(p.budget_hkd || 0);
    const weeks = Number(p.deadline_weeks || 0);
    const occupants = (p.occupants || []).filter((o) => o && typeof o === 'object');
    const elderly = occupants.filter((o) => (Number(o.age) || 0) >= 65);
    const mobility = occupants.some((o) => ['limited', 'wheelchair', '行動不便', '輪椅']
      .includes(String(o.mobility || '').toLowerCase()));
    const hasElderly = elderly.length > 0 || mobility;

    const tags = [];
    if (age >= 30) tags.push('舊樓');
    if (area && area <= 450) tags.push('小單位');
    if (hasElderly) tags.push('適老化');
    if (weeks && weeks <= 10) tags.push('快速交付');
    if (!tags.length) tags.push('標準住宅');

    const risks = [];
    if (age >= 40) {
      risks.push({
        risk: '舊樓水管及電線老化，拆除後可能發現額外問題',
        likelihood: '高', impact: '中',
        mitigation: '開工前做一次水電勘察，預留 8-10% 備用金',
      });
    }
    if (area && area <= 450) {
      risks.push({
        risk: '小單位施工空間狹窄，工序互相阻塞拖慢進度',
        likelihood: '中', impact: '中',
        mitigation: '按工序分區進場，材料分批送達',
      });
    }
    if (mobility) {
      risks.push({
        risk: '行動不便住戶在施工期間居住安排困難',
        likelihood: '中', impact: '高',
        mitigation: '提前安排過渡住所，或分階段施工保留可用區域',
      });
    }
    if (weeks && weeks <= 8) {
      risks.push({
        risk: '工期壓縮至 8 週以內，訂造傢俬與泥水易撞期',
        likelihood: '高', impact: '中',
        mitigation: '傢俬與泥水同步下單，採用預製組件',
      });
    }

    const missing = [];
    if (!p.floor_plan) missing.push('原始平面圖或自行量度的尺寸草圖');
    if (!p.photos && !(context._images || []).length) missing.push('現場照片（廚廁、窗、電箱、結構牆位置）');
    missing.push('大廈公契或管理處對施工時間的限制');
    if (elderly.length) missing.push('長者是否有輪椅或助行架，以及現時跌倒史');

    const priorities = [];
    if (hasElderly) {
      priorities.push({ item: '浴室防滑與扶手', why: '長者跌倒多發生在浴室', weight: 5 });
      priorities.push({ item: '夜間照明與動線', why: '半夜起身視線不足易生意外', weight: 4 });
    }
    if ((p.pain_points || []).length) {
      priorities.push({
        item: `解決現有痛點：${p.pain_points.join('、')}`,
        why: '業主最直接的困擾', weight: 4,
      });
    }
    priorities.push({ item: '控制總造價於預算內', why: `業主預算 ${budget} HKD`, weight: 4 });

    return {
      summary: `約 ${area} 平方呎、樓齡 ${age} 年的單位，`
        + `${hasElderly ? '有長者同住，需要適老化設計' : '以年輕業主自住為主'}；`
        + `預算 ${budget} HKD、期望 ${weeks} 週內完成，屬於`
        + `${weeks && weeks <= 10 ? '工期偏緊的舊樓改造' : '常規節奏的改造'}，`
        + '建議走「設計與選料同步、工序並行」的快車道。',
      household_profile: {
        composition: `${occupants.length} 人家庭` + (elderly.length ? `，含 ${elderly.length} 位 65 歲以上長者` : ''),
        mobility_needs: mobility ? '需要無障礙通行與扶手支撐' : '暫無明顯行動限制',
        care_level: mobility ? '中度' : (elderly.length ? '輕度' : '無'),
      },
      project_tags: tags,
      priorities,
      risks,
      missing_info: missing,
      recommended_route: modeOf(p) === 'retrofit' ? '先加裝，確認安全後再考慮大改' : '一次完成全屋裝修',
      fast_track_hint: '若只做加裝，可壓縮至兩週內進場',
    };
  }
}

export class LayoutAgent extends BaseAgent {
  constructor(llm) {
    super(llm);
    this.name = 'layout';
    this.title = '空間規劃';
    this.icon = '📐';
    this.systemPrompt = '你是香港小型單位空間規劃師。輸出 JSON：layout_strategy、zones、'
      + 'storage_plan、circulation、lighting_daylight、do_not_touch、quick_wins、risks。'
      + '牆體永遠只標「須認可人士確認」，不要說可以拆。';
  }

  mock(context) {
    const p = projectOf(context);
    const area = areaOf(context);
    return {
      layout_strategy: '以「動線優先」為原則：先確保主要通道，再安排收納與家具；'
        + '香港小單位寧可少放一件家具，也不要留下過窄的走道。',
      zones: [
        { zone: '客廳', functions: ['休息', '收納'], solutions: ['靠牆電視櫃', '地台收納'], gain: '增加約 15% 儲物空間' },
        { zone: '睡房', functions: ['睡眠', '工作'], solutions: ['床邊留 600mm 通道'], gain: '方便長者上落床' },
      ],
      storage_plan: { total_volume_hint: `${Math.round(area * 0.55)} 平方呎地台` },
      circulation: { main_path: '由大門經客廳到睡房', clear_width_mm: 1050 },
      lighting_daylight: ['保留主要窗戶採光', '夜間加裝感應夜燈'],
      do_not_touch: [{ item: '廚房間隔牆', reason: '屬甲類固定裝置，須認可人士確認，不得自行改動' }],
      quick_wins: [{ action: '浴室加裝扶手與防滑', cost: '低', impact: 4 }],
      risks: ['家具太多會壓縮通道'],
    };
  }
}

export class AgingAgent extends BaseAgent {
  constructor(llm) {
    super(llm);
    this.name = 'aging';
    this.title = '適老化設計';
    this.icon = '🧓';
    this.systemPrompt = '你是香港適老化（居家安老）顧問。輸出 JSON：design_principles、measures、'
      + 'restricted_warnings、subsidy_plan、compliance_checklist、phasing。'
      + '所有尺寸必須引用知識庫數值與出處；找不到出處就標 unverified，不得編造條款。';
  }

  mock(context) {
    // 完整示例（含 retrofit 的 8 項加裝）見 agingMock，數字全部從知識庫取。
    return agingMock(context);
  }
}

export class BudgetAgent extends BaseAgent {
  constructor(llm) {
    super(llm);
    this.name = 'budget';
    this.title = '預算估算';
    this.icon = '💰';
    this.systemPrompt = '你是香港裝修預算顧問。金額一律由價目表計算，你只負責解釋與取捨。'
      + '輸出 JSON：verdict、total_review、cost_drivers、optimizations、do_not_cut、'
      + 'subsidy_offset、cashflow。不要自己算總價。';
  }

  mock(context) {
    const est = estimateOf(context);
    const scenarios = pricing.scenarioComparison(projectOf(context));
    return {
      verdict: est.within_budget ? '預算內' : '超出預算',
      total_review: {
        total: est.total, budget: est.budget, gap: est.gap,
        status: est.within_budget ? 'within_budget' : 'over_budget',
      },
      cost_drivers: est.lines.slice(0, 4).map((l) => ({
        item: l.name, amount: l.amount, why: l.note || l.category,
      })),
      optimizations: [
        { action: '降規格（地磚、櫃體、油漆、潔具）', saving: scenarios[1] ? scenarios[0].total - scenarios[1].total : 0 },
        { action: '縮範圍（暫緩廚房、木工、油漆、門窗）', saving: scenarios[2] ? scenarios[0].total - scenarios[2].total : 0 },
      ],
      do_not_cut: ['水電', '防水'],
      subsidy_offset: { eligible: hasElderly(projectOf(context)), note: '津貼上限 80,000 港元' },
      cashflow: [{ stage: '簽約', pct: 30 }, { stage: '水電完成', pct: 30 }, { stage: '完工', pct: 40 }],
      scenarios,
      material_total: est.material_total,
      labour_total: est.labour_total,
      additional_total: est.additional_total,
      additional_note: est.additional_note,
    };
  }

  postprocess(data, context) {
    // 金額是權威值：不論模型回什麼，一律用價目表覆寫。
    const est = estimateOf(context);
    return {
      ...data,
      total_review: {
        total: est.total, budget: est.budget, gap: est.gap,
        status: est.within_budget ? 'within_budget' : 'over_budget',
      },
      scenarios: pricing.scenarioComparison(projectOf(context)),
      material_total: est.material_total,
      labour_total: est.labour_total,
      additional_total: est.additional_total,
      additional_note: est.additional_note,
    };
  }
}

export class VendorAgent extends BaseAgent {
  constructor(llm) {
    super(llm);
    this.name = 'vendor';
    this.title = '廠商對接';
    this.icon = '🤝';
    this.systemPrompt = '你是香港裝修承辦商對接顧問。輸出 JSON：sourcing_strategy、'
      + 'recommended_vendors、split_plan、rfq_checklist、red_flags、contract_terms、next_actions。'
      + '廠商名單與分數一律由系統匹配，不要自己發明公司名。';
  }

  mock(context) {
    const p = projectOf(context);
    const elderly = hasElderly(p) || mobilityLimited(p);
    const needed = vendors.requiredTrades(elderly);
    const ranked = vendors.match({
      needed, district: p.district || '', needsAging: elderly, urgencyHigh: true,
    });
    return {
      sourcing_strategy: '優先找能覆蓋多工種的承辦商；若無，拆給專項承辦商反而更快。',
      recommended_vendors: ranked,
      split_plan: vendors.planSplit(needed, ranked),
      rfq_checklist: ['報價是否列明材料與人工', '是否包含清運與保護', '工期與罰則'],
      red_flags: ['只給總價不給細項', '同時承接過多工地'],
      contract_terms: ['分階段付款', '完工驗收標準'],
      next_actions: ['向 2–3 家索取書面報價'],
    };
  }
}

export class ScheduleAgent extends BaseAgent {
  constructor(llm) {
    super(llm);
    this.name = 'schedule';
    this.title = '工期排程';
    this.icon = '🗓️';
    this.systemPrompt = '你是香港裝修工期排程顧問。工期一律由關鍵路徑（CPM）計算，你只負責解釋。'
      + '輸出 JSON：duration_review、critical_path、compression_plan、parallel_opportunities、'
      + 'milestones、delay_risks、weekly_plan。不要自己寫一個工期。';
  }

  mock(context) {
    const p = projectOf(context);
    const elderly = hasElderly(p) || mobilityLimited(p);
    const retro = modeOf(p) === 'retrofit';
    const tasks = retro
      ? schedule.buildRetrofitTasks()
      : schedule.buildTasks({ hasElderly: elderly, needsSubsidy: !!elderly });
    const cpm = schedule.compute(tasks);
    const deadline = Number(p.deadline_weeks || 0);
    return {
      duration_review: {
        weeks: cpm.duration_weeks,
        vs_deadline: deadline
          ? (cpm.duration_weeks <= deadline ? `較期限早 ${Math.round((deadline - cpm.duration_weeks) * 10) / 10} 週` : `較期限遲 ${Math.round((cpm.duration_weeks - deadline) * 10) / 10} 週`)
          : '未設定期限',
      },
      critical_path: cpm.critical_path,
      compression_plan: [{ action: '訂造傢俬離場製作', saving_weeks: 2 }],
      parallel_opportunities: cpm.parallel_groups,
      milestones: [{ name: '開工', week: 0 }, { name: '水電完成', week: 3 }, { name: '完工', week: cpm.duration_weeks }],
      delay_risks: ['訂造傢俬延誤', '天氣影響油漆'],
      weekly_plan: cpm.tasks.slice(0, 6).map((t) => ({ week: t.start_week, work: t.name })),
      scenario_weeks: scenarioWeeksFor(elderly, !!elderly),
      needs_subsidy: !!elderly,
    };
  }

  postprocess(data, context) {
    // 工期是權威值：不論模型回什麼，一律用 CPM 覆寫。
    const p = projectOf(context);
    const elderly = hasElderly(p) || mobilityLimited(p);
    const retro = modeOf(p) === 'retrofit';
    const tasks = retro
      ? schedule.buildRetrofitTasks()
      : schedule.buildTasks({ hasElderly: elderly, needsSubsidy: !!elderly });
    const cpm = schedule.compute(tasks);
    return {
      ...data,
      duration_review: {
        ...(data?.duration_review || {}),
        weeks: cpm.duration_weeks,
      },
      scenario_weeks: scenarioWeeksFor(elderly, !!elderly),
      needs_subsidy: !!elderly,
    };
  }
}

export class SurveyAgent extends BaseAgent {
  constructor(llm) {
    super(llm);
    this.name = 'survey';
    this.title = '現場勘察';
    this.icon = '🔍';
    this.systemPrompt = '你是現場影像判讀員。只描述照片看得到的事實與待確認項目，不要給尺寸結論。'
      + '輸出 JSON：plan、spaces、aging_hazards、measurements、scope_signals、to_verify_on_site、conflicts。';
  }

  mock() {
    return {
      plan: {},
      spaces: [],
      aging_hazards: [],
      measurements: [],
      scope_signals: [],
      to_verify_on_site: ['現場量度實際尺寸'],
      conflicts: [],
    };
  }
}

export const AGENT_CLASSES = {
  intake: IntakeAgent,
  layout: LayoutAgent,
  aging: AgingAgent,
  budget: BudgetAgent,
  vendor: VendorAgent,
  schedule: ScheduleAgent,
  survey: SurveyAgent,
};
