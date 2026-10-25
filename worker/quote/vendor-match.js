/* 承辦商匹配與評分 —— Python core/vendor_match.py 的 JS 版。
 *
 * 評分刻意做成可解釋的：每一分都說明理由，而不是丟一個 87.3 分。
 * 同時納入香港實務真正會拖垮工期的因素：「同時承接量」往往比評分更重要 ——
 * 一家 4.9 分的公司手上壓著 15 個工地，實際開工可能比承諾晚三週。
 */
import VENDORS from '../data/vendors.js';

const DB = VENDORS;

export function loadVendors() {
  return DB;
}

export function allTrades() {
  return DB.trades || [];
}

/* 一個全屋舊樓改造理論上需要的工種。 */
export function requiredTrades(hasElderly) {
  const trades = ['清拆', '水電', '泥水', '木工', '油漆', '廚廁', '門窗'];
  if (hasElderly) trades.push('適老化安裝');
  return trades;
}

/* 回傳分數與逐項理由，總分 100。 */
export function scoreVendor(vendor, {
  needed = [],
  district = '',
  needsAging = false,
  urgencyHigh = false,
} = {}) {
  const reasons = [];
  let score = 0;

  // 1) 工種覆蓋度（50 分）── 最核心：能不能一個人做完
  const covered = needed.filter((t) => (vendor.trades || []).includes(t));
  const coverage = needed.length ? covered.length / needed.length : 0;
  const tradeScore = coverage * 50;
  score += tradeScore;
  if (coverage >= 0.85) {
    reasons.push(`可承擔 ${covered.length}/${needed.length} 個工種，接近一站式（+${Math.round(tradeScore)}）`);
  } else if (coverage >= 0.5) {
    reasons.push(`可承擔 ${covered.length}/${needed.length} 個工種，需配合其他承辦商（+${Math.round(tradeScore)}）`);
  } else {
    reasons.push(`僅覆蓋 ${covered.length}/${needed.length} 個工種（+${Math.round(tradeScore)}）`);
  }

  // 2) 評分（30 分）
  const rating = Number(vendor.rating || 0);
  const ratingScore = Math.max(0, (rating - 3.0) / 2.0) * 30;
  score += ratingScore;
  reasons.push(`客戶評分 ${rating}（${vendor.review_count || 0} 個評價）（+${Math.round(ratingScore)}）`);

  // 3) 適老化經驗（10 分）── 有長者的案子裡，這比評分更能反映合規意識
  if (needsAging) {
    if (vendor.aging_experience) {
      score += 10;
      reasons.push('具適老化改造經驗，熟悉扶手高度與無障礙動線（+10）');
    } else {
      reasons.push('無適老化經驗，需另行指導規格（+0）');
    }
  }

  // 4) 進場速度（10 分）── 專案賣點就是「快」
  const lead = Number(vendor.lead_time_weeks ?? 8);
  const leadScore = Math.max(0, Math.min(10, (6 - lead) * 2.5));
  score += leadScore;
  reasons.push(`可於 ${lead} 週內進場（+${Math.round(leadScore)}）`);

  // 5) 同時承接量扣分 ── 這是工期延誤最常見的真實原因
  const capacity = Number(vendor.concurrent_capacity || 0);
  if (capacity >= 12) {
    score -= 8;
    reasons.push(`同時承接 ${capacity} 個工地，開工日期有延後風險（-8）`);
  } else if (capacity >= 9) {
    score -= 4;
    reasons.push(`同時承接 ${capacity} 個工地，排期偏緊（-4）`);
  }

  // 6) 地區匹配
  const districts = vendor.districts || [];
  if (district && (districts.includes(district) || districts.includes('全港'))) {
    score += 3;
    reasons.push(`服務範圍覆蓋${district}（+3）`);
  }

  // 7) 趕工期時，慢工種直接扣分
  if (urgencyHigh && lead >= 5) {
    score -= 5;
    reasons.push('工期緊張，進場等待較久不利（-5）');
  }

  return {
    id: vendor.id || '',
    name: vendor.name || '',
    score: Math.round(Math.max(0, Math.min(100, score)) * 10) / 10,
    coverage_pct: Math.round(coverage * 100),
    covered_trades: covered,
    lead_time_weeks: lead,
    price_level: vendor.price_level || '',
    rating,
    accredited: vendor.accredited || [],
    aging_experience: !!vendor.aging_experience,
    notes: vendor.notes || '',
    reasons,
  };
}

export function match({ needed, district = '', needsAging = false, urgencyHigh = false, limit = 6 }) {
  const scored = (DB.vendors || []).map((vendor) => scoreVendor(vendor, {
    needed, district, needsAging, urgencyHigh,
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/* 沒有單一公司能全包時，給出分包方案。 */
export function planSplit(needed, ranked) {
  let remaining = [...needed];
  const plan = [];
  for (const vendor of ranked) {
    if (!remaining.length) break;
    const covered = vendor.covered_trades.filter((t) => remaining.includes(t));
    if (!covered.length) continue;
    plan.push({
      vendor: vendor.name,
      trades: covered,
      why: `覆蓋 ${covered.join('、')}${vendor.aging_experience ? '，具適老化經驗' : ''}`,
      lead_time_weeks: vendor.lead_time_weeks,
    });
    remaining = remaining.filter((t) => !covered.includes(t));
  }
  if (remaining.length) {
    plan.push({
      vendor: '（待招標）',
      trades: remaining,
      why: '現有名單未覆蓋，須另行招標或納入總承辦商',
      lead_time_weeks: 0,
    });
  }
  return plan;
}
