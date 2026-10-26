/* 工程量與造價估算 —— Python core/pricing.py 的 JS 版。
 *
 * 原則不變：金額由價目表算出，不讓模型自己報數。
 * 這個檔案與 Python 版是同一套規則，輸出由 tests/quote-parity.test.mjs 對照；
 * 任何一邊改了數字都要同步另一邊，否則兩邊報價會漂移。
 *
 * 單位：面積用平方呎（sqft），金額用港幣（HKD）。
 */
import PRICE_LIST from '../data/price_list.js';

export const PRICE = PRICE_LIST;

// 「舊屋改造」只做加法：這 8 項可逐件加裝，其餘一律不動
export const RETROFIT_ITEMS = new Set([
  'handrail_bath', 'handrail_corridor', 'toilet_grab_bar', 'shower_seat',
  'non_slip_tile', 'night_light', 'lever_tap', 'threshold_strip',
]);

// 只有「從頭裝修」才做的範圍，改造模式一律排除
export const FULL_SCOPE_ITEMS = new Set([
  'demolition', 'electrical', 'plumbing', 'masonry', 'flooring', 'painting',
  'kitchen_set', 'bathroom_set', 'built_in_wardrobe', 'storage_platform',
  'door_room', 'aluminium_window',
]);

// 每筆報價拆成材料與人工的比例。沒有真實供應商報價 —— 這些是業界慣例值，
// 一律標 assumed，用途是讓客戶知道錢的結構，不是拿來當合約單價。
export const MATERIAL_RATIOS = {
  '基礎工程': 0.42,
  '泥水': 0.55,
  '油漆': 0.35,
  '廚廁': 0.62,
  '木工': 0.60,
  '門窗': 0.58,
  '適老化': 0.50,
};
export const DEFAULT_MATERIAL_RATIO = 0.5;
export const MATERIAL_RATIO_BASIS = '業界慣例估算，待供應商實報校準';

export const SCENARIO_PROFILES = {
  standard: {
    label: '全屋標準',
    note: '範圍與材料都不變，原本的方案',
    exclude: new Set(),
    discount: {},
  },
  economy: {
    label: '降規格（範圍不變）',
    note: '全屋照做，但地磚、櫃體、油漆、潔具改用經濟級材料；水電與防水不降級',
    exclude: new Set(),
    discount: {
      flooring: 0.85, painting: 0.75, storage_platform: 0.82,
      built_in_wardrobe: 0.82, kitchen_set: 0.88, bathroom_set: 0.90,
      door_room: 0.85, aluminium_window: 0.88,
    },
  },
  essential: {
    label: '縮範圍（只做必要）',
    note: '只做安全與防水：清拆、水電、泥水、浴室；廚房、木工、油漆、門窗暫緩',
    exclude: new Set([
      'kitchen_set', 'storage_platform', 'built_in_wardrobe', 'door_room',
      'aluminium_window', 'painting',
    ]),
    discount: {},
  },
  retrofit: {
    label: '舊屋改造（只加不改）',
    note: '只加裝適老化設施與局部補強，不清拆、不動水電泥水；住戶可繼續居住，工期以日計而非以月計',
    exclude: FULL_SCOPE_ITEMS,
    discount: {},
  },
};

/* Python 的 round() 是銀行家捨入（四捨六入五成雙），JS 的 Math.round 不是。
 * 金額差一元也會被客戶拿計算機對，所以照 Python 的行為實作。 */
export function pyRound(x) {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

function roundTo(x, digits) {
  const k = Math.pow(10, digits);
  return pyRound(x * k) / k;
}

function isElderlyHousehold(project) {
  const occupants = project.occupants || [];
  return occupants.some((o) => o && typeof o === 'object'
    && ((Number(o.age) || 0) >= 65
      || ['limited', 'wheelchair', '行動不便', '輪椅'].includes(String(o.mobility || '').toLowerCase())));
}

/* 依專案條件決定每個項目的數量。係數是經驗值，集中一處方便日後用真實案例校準。
 * forceAging 用於舊屋改造：即使沒有長者，改造本來就是加裝安全設施。 */
export function quantities(project, area, forceAging = false) {
  const rooms = Math.trunc(Number(project.rooms || 2)) || 2;
  const q = new Map();

  for (const item of PRICE.area_items || []) q.set(item.code, area);

  q.set('storage_platform', pyRound(area * 0.55));
  q.set('kitchen_set', 1);
  q.set('bathroom_set', 1);
  q.set('built_in_wardrobe', Math.max(rooms, 1));
  q.set('door_room', Math.max(rooms, 1));
  q.set('aluminium_window', 3);

  if (forceAging || isElderlyHousehold(project)) {
    q.set('handrail_bath', 2);
    q.set('handrail_corridor', 6);
    q.set('toilet_grab_bar', 1);
    q.set('shower_seat', 1);
    q.set('non_slip_tile', 40);
    q.set('night_light', 3);
    q.set('lever_tap', 3);
    q.set('threshold_strip', 2);
  }
  return q;
}

function catalogueOf(price) {
  const out = new Map();
  for (const key of ['area_items', 'item_items', 'aging_items']) {
    for (const item of price[key] || []) out.set(item.code, item);
  }
  return out;
}

/* 算出分項報價、費用與總額。
 * extras 是影像判讀推出的追加項，獨立成一個區塊，不併入主造價。 */
export function estimate(project, extras = null, profile = 'standard') {
  const price = PRICE;
  let area = Number(project.area_sqft || 0);
  if (!Number.isFinite(area)) area = 0;

  const spec = SCENARIO_PROFILES[profile] || SCENARIO_PROFILES.standard;
  const excludedCodes = spec.exclude;
  const discounts = spec.discount;

  const qty = quantities(project, area, profile === 'retrofit');
  const catalogue = catalogueOf(price);

  const lines = [];
  const categoryTotals = {};
  const excludedNames = [];

  for (const [code, qtyValue] of qty) {
    const item = catalogue.get(code);
    if (!item || qtyValue <= 0) continue;

    if (excludedCodes.has(code)) {
      excludedNames.push(item.name);
      continue;
    }

    const listPrice = Number(item.unit_price);
    const factor = Number(discounts[code] ?? 1.0);
    const unitPrice = factor < 1.0 ? pyRound(listPrice * factor) : listPrice;
    const amount = pyRound(qtyValue * unitPrice);

    const ratio = Number(
      item.material_ratio
      ?? MATERIAL_RATIOS[item.category]
      ?? DEFAULT_MATERIAL_RATIO,
    );
    const materials = pyRound(amount * ratio);
    const labour = amount - materials;

    lines.push({
      code,
      category: item.category,
      name: item.name,
      quantity: qtyValue,
      unit: item.unit,
      unit_price: unitPrice,
      list_price: listPrice,
      discount_factor: factor,
      amount,
      material_ratio: roundTo(ratio, 3),
      materials,
      labour,
      note: item.note || '',
    });
    categoryTotals[item.category] = (categoryTotals[item.category] || 0) + amount;
  }

  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const materialTotal = lines.reduce((s, l) => s + l.materials, 0);
  const labourTotal = lines.reduce((s, l) => s + l.labour, 0);
  const rates = price.rates || {};
  const fees = {
    '設計費': pyRound(subtotal * Number(rates.design_fee_rate || 0)),
    '工程監管費': pyRound(subtotal * Number(rates.supervision_rate || 0)),
    '前期及雜項': pyRound(subtotal * Number(rates.preliminaries_rate || 0)),
    '備用金（應對舊樓突發）': pyRound(subtotal * Number(rates.contingency_rate || 0)),
  };
  const total = subtotal + Object.values(fees).reduce((s, v) => s + v, 0);

  let budget = Number(project.budget_hkd || 0);
  if (!Number.isFinite(budget)) budget = 0;
  const gap = budget ? total - budget : 0;

  const additional = additionalWorks(extras, catalogue, area, rates);

  return {
    lines,
    category_totals: categoryTotals,
    subtotal,
    material_total: materialTotal,
    labour_total: labourTotal,
    material_ratio_basis: MATERIAL_RATIO_BASIS,
    fees,
    total,
    budget,
    gap,
    within_budget: budget > 0 && total <= budget,
    aging_subtotal: lines
      .filter((l) => l.category === '適老化')
      .reduce((s, l) => s + l.amount, 0),
    profile,
    profile_label: spec.label,
    profile_note: spec.note,
    excluded_items: excludedNames,
    additional_works: additional.lines,
    additional_total: additional.total,
    additional_note: additional.note,
  };
}

/* 改造模式每個可加項目的單價與數量，供前端勾選後即時加總。 */
export function retrofitLineItems(project) {
  const est = estimate(project, null, 'retrofit');
  const out = {};
  for (const line of est.lines) {
    out[line.code] = {
      name: line.name,
      quantity: line.quantity,
      unit: line.unit,
      unit_price: line.unit_price,
      amount: line.amount,
    };
  }
  return out;
}

/* 比較「舊屋改造」與「從頭裝修」兩種模式的金額。 */
export function modeComparison(project, extras = null) {
  const retrofit = estimate(project, extras, 'retrofit');
  const full = estimate(project, extras, 'standard');
  const upgrade = full.total - retrofit.total;
  return {
    retrofit: {
      label: retrofit.profile_label,
      note: retrofit.profile_note,
      total: retrofit.total,
      subtotal: retrofit.subtotal,
      lines: retrofit.lines,
    },
    full: {
      label: full.profile_label,
      total: full.total,
      subtotal: full.subtotal,
    },
    upgrade_cost: upgrade,
    upgrade_pct: retrofit.total ? roundTo(upgrade / retrofit.total * 100, 1) : 0.0,
    ratio: retrofit.total ? roundTo(full.total / retrofit.total, 1) : 0.0,
  };
}

/* 一次算出三套方案的金額，供「方案比較」頁並列呈現。 */
export function scenarioComparison(project, extras = null) {
  const rows = [];
  for (const key of ['standard', 'economy', 'essential']) {
    const est = estimate(project, extras, key);
    rows.push({
      key,
      label: est.profile_label,
      note: est.profile_note,
      total: est.total,
      subtotal: est.subtotal,
      budget: est.budget,
      gap: est.gap,
      within_budget: est.within_budget,
      excluded_items: est.excluded_items,
      line_count: est.lines.length,
    });
  }
  const baseline = rows[0].total;
  for (const row of rows) {
    row.saving_vs_standard = baseline - row.total;
    row.saving_pct = baseline ? roundTo(row.saving_vs_standard / baseline * 100, 1) : 0.0;
  }
  return rows;
}

/* 把影像判讀出的缺陷換算成「待確認的追加工程」金額。
 * 刻意不併入主造價：主造價是已確認範圍，追加是還沒現場確認的風險。 */
function additionalWorks(extras, catalogue, area, rates) {
  if (!extras || !extras.length) return { lines: [], total: 0, note: '' };

  const lines = [];
  const seen = new Set();
  for (const extra of extras) {
    if (!extra || typeof extra !== 'object') continue;
    const code = String(extra.code || '');
    if (seen.has(code)) continue;
    const item = catalogue.get(code);
    if (!item) continue;
    seen.add(code);

    const unit = item.unit;
    const quantity = unit === 'sqft' && area ? area : 1;
    const amount = pyRound(quantity * Number(item.unit_price));
    lines.push({
      code,
      category: item.category,
      name: item.name,
      quantity,
      unit,
      unit_price: item.unit_price,
      amount,
      reason: extra.reason || '',
      confidence: extra.confidence || 'low',
      source: extra.source || 'image',
    });
  }

  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const fees = {
    '設計費': pyRound(subtotal * Number(rates.design_fee_rate || 0)),
    '工程監管費': pyRound(subtotal * Number(rates.supervision_rate || 0)),
    '前期及雜項': pyRound(subtotal * Number(rates.preliminaries_rate || 0)),
    '備用金': pyRound(subtotal * Number(rates.contingency_rate || 0)),
  };
  return {
    lines,
    total: subtotal + Object.values(fees).reduce((s, v) => s + v, 0),
    note: lines.length ? '由影像判讀推出，尚未現場確認；確認後才納入正式報價' : '',
  };
}
