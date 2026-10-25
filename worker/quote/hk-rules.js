/* 香港適老化規則查詢層 —— Python core/hk_rules.py 的 JS 版。
 *
 * 核心立場不變：法規數字不靠模型記憶。模型只負責組織語言與取捨，
 * 尺寸、津貼額度、可不可以改動，一律由這裡查表得出並附出處。
 *
 * 資料來自 worker/data/aging_kb.js（由 scripts/sync-quote-data.mjs 同步）。
 */
import AGING_KB from '../data/aging_kb.js';

const KB = AGING_KB;

export function loadKb() {
  return KB;
}

export function hasKb() {
  return !!(KB && KB.sheets);
}

function sheet(name) {
  const s = KB?.sheets?.[name];
  if (!s) return [];
  const headers = s.headers || [];
  const records = [];
  for (const row of s.rows || []) {
    const record = {};
    headers.forEach((header, index) => {
      if (!header) return;
      record[header] = index < row.length ? row[index] : '';
    });
    records.push(record);
  }
  return records;
}

function isDataRow(record) {
  return String(record['序號'] || '').trim().match(/^\d+$/) !== null;
}

/* 甲類固定裝置 —— 不准許改動，違者房屋署會還原並收費。 */
export function restrictedFixtures() {
  return sheet('02_固定裝置三級分類全表')
    .filter((r) => String(r['分類'] || '').trim() === '甲')
    .map((r) => ({
      code: r['編號'] || '',
      element: r['建築／屋宇裝備元件'] || '',
      scope: r['固定裝置名稱及範圍（原文照錄）'] || '',
      note: r['備註'] || '',
    }));
}

/* 丙類固定裝置 —— 毋須事前批准。扶手、推桿水龍頭、防滑地磚都在這類。 */
export function freeToChangeFixtures() {
  return sheet('02_固定裝置三級分類全表')
    .filter((r) => String(r['分類'] || '').trim() === '丙')
    .map((r) => ({
      code: r['編號'] || '',
      element: r['建築／屋宇裝備元件'] || '',
      scope: r['固定裝置名稱及範圍（原文照錄）'] || '',
      note: r['備註'] || '',
    }));
}

/* 乙類固定裝置 —— 可改動，但須事前獲房委會批准。 */
export function approvalRequiredFixtures() {
  return sheet('02_固定裝置三級分類全表')
    .filter((r) => String(r['分類'] || '').trim() === '乙')
    .map((r) => ({
      code: r['編號'] || '',
      element: r['建築／屋宇裝備元件'] || '',
      scope: r['固定裝置名稱及範圍（原文照錄）'] || '',
      note: r['備註'] || '',
    }));
}

export function subsidyItems() {
  return sheet('03_津貼覆蓋工程')
    .filter(isDataRow)
    .map((r) => ({
      no: r['原文編號'] || '',
      plan: r['計劃／機構'] || '',
      item: r['工程範疇／項目'] || '',
      detail: r['涵蓋內容或例子（原文照錄）'] || '',
      location: r['覆蓋位置'] || '',
      aging_link: r['適老化關聯'] || '',
      grade: r['數據等級'] || '',
      note: r['備註'] || '',
    }));
}

export function directSubsidyItems() {
  return subsidyItems().filter((item) => String(item.aging_link).includes('直接'));
}

export function subsidyRules() {
  const s = KB?.sheets?.['03_津貼覆蓋工程'];
  if (!s) return {};
  const labels = new Set([
    '津貼上限', '申請次數', '與房協計劃的關係', '時序限制', '審批依據',
    '圖則一致性', '常見不獲資助項目',
  ]);
  const rules = {};
  for (const row of s.rows || []) {
    const cells = row.filter((c) => c);
    if (!cells.length || !labels.has(cells[0])) continue;
    // 說明文字可能在 B 或 C 欄，取最長的那一段
    const rest = cells.slice(1);
    rules[cells[0]] = rest.length
      ? rest.reduce((a, b) => (String(b).length > String(a).length ? b : a), '')
      : '';
  }
  return rules;
}

export function complianceDocuments() {
  return sheet('04_單位內工程合規文件')
    .filter(isDataRow)
    .map((r) => ({
      category: r['工程範疇'] || '',
      items: r['具體項目／工序'] || '',
      qualified_by: r['施工者資格'] || '',
      documents: r['完工須提交文件'] || '',
      conditions: r['其他條件'] || '',
    }));
}

export function dimensionParams(category = null) {
  const result = [];
  for (const r of sheet('05_適老化尺寸參數')) {
    if (!isDataRow(r)) continue;
    if (category && String(r['類別'] || '').trim() !== category) continue;
    result.push({
      category: r['類別'] || '',
      item: r['參數項目'] || '',
      requirement: r['參數要求（摘要）'] || '',
      min: r['數值下限'] || '',
      max: r['數值上限'] || '',
      unit: r['單位'] || '',
      level: r['規範層級'] || '',
      mandatory: r['強制性'] || '',
      source: r['出處（文件＋條款）'] || '',
      grade: r['數據等級'] || '',
    });
  }
  return result;
}

export function dimensionCategories() {
  const seen = [];
  for (const item of dimensionParams()) {
    if (!seen.includes(item.category)) seen.push(item.category);
  }
  return seen;
}

export function keyParamsCompare() {
  return sheet('06_關鍵參數三方對照')
    .filter((r) => {
      const p = String(r['參數'] || '').trim();
      return p && !p.startsWith('用法提示') && !p.startsWith('注意');
    })
    .map((r) => ({
      param: r['參數'] || '',
      legal: r['BFA 2008 法定最低'] || '',
      friendly: r['APP-41 長者友善建議'] || '',
      rule_2026: r['2026 新建樓宇強制'] || '',
      hint: r['差異要點／設計提示'] || '',
    }));
}

export function sources() {
  return sheet('07_來源與引用')
    .filter(isDataRow)
    .map((r) => ({
      org: r['機構'] || '',
      title: r['文件名稱'] || '',
      version: r['文號／版本'] || '',
      used_in: r['本表用於'] || '',
      grade: r['數據等級'] || '',
      url: r['網址'] || '',
    }));
}

/* 壓縮成 agent 提示詞可消化的規模：全量 225 行塞進去會讓模型抓不到重點。 */
export function briefingForPrompt() {
  if (!hasKb()) return {};
  return {
    '不可改動的甲類裝置': restrictedFixtures().map((f) => `${f.code} ${f.scope}`),
    '可自行改動的丙類裝置': freeToChangeFixtures().map((f) => `${f.code} ${f.scope}`),
    '須事前批准的乙類裝置': approvalRequiredFixtures().map((f) => `${f.code} ${f.scope}`),
    '尺寸參數': dimensionParams().map((p) => ({
      '類別': p.category,
      '項目': p.item,
      '要求': p.requirement,
      '範圍': `${p.min}–${p.max} ${p.unit}`.replace(/^[–\s]+|[–\s]+$/g, ''),
      '層級': p.level,
      '強制性': p.mandatory,
      '出處': p.source,
    })),
    '津貼直接相關項目': directSubsidyItems().map((i) => ({
      '計劃': i.plan, '項目': i.item, '說明': i.detail,
    })),
    '津貼限制': subsidyRules(),
    '合規文件': complianceDocuments().map((c) => ({
      '範疇': c.category, '資格': c.qualified_by, '文件': c.documents,
    })),
  };
}
