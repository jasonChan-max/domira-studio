// 純函數部分（不跑 OCR，不需要 wasm）：數字抽取與比例尺推導。
// Heason 2026-11-12 的要求：圖上有數字就用數字，沒有才用固定比例尺，
// 無論如何都不要「先猜總面積再回推房間」。

import { parsePlanNumbers, estimateScale } from '../public/plan-ocr.js';

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

console.log('=== 測試 1：從圖上文字抽面積與尺寸 ===');
// 模擬 Heason 那張圖的標註：淨面積 46.03㎡ ＋ 一整圈 mm 尺寸
const ocr = parsePlanNumbers('淨面積 46.03 m2   2640   3900   2550   2180   3600   2340   1380');
console.log(`    面積候選：${ocr.areas.map(a => a.value).join(', ') || '（無）'}`);
console.log(`    尺寸候選：${ocr.lengths.map(a => a.value).join(', ') || '（無）'}`);
check('抽出 46.03 當面積', ocr.areas.some(a => Math.abs(a.value - 46.03) < 0.001));
check('抽出 2640／3900 當尺寸', ocr.lengths.some(a => a.value === 2640) && ocr.lengths.some(a => a.value === 3900));
check('面積按大小排序（最大的在最前）', ocr.areas.length >= 1 && ocr.areas[0].value >= (ocr.areas.at(-1)?.value ?? 0));

console.log('\n=== 測試 2：整數面積也要認 ===');
const plain = parsePlanNumbers('46 m2 客廳');
check('「46 m2」被當成面積', plain.areas.some(a => a.value === 46));

console.log('\n=== 測試 2b：黏在一起的數字要擋掉 ===');
// R(7) 的真實 OCR 輸出，22.8518 是 22.85 和 18 黏在一起
const noisy = parsePlanNumbers('8.95 4030 13.813 380 8670 22.8518 40.45 9700');
console.log(`    面積候選：${noisy.areas.map(a => a.value).join(', ') || '（無）'}`);
check('22.8518（小數 4 位）被擋掉', !noisy.areas.some(a => a.value === 22.8518));
check('13.813（小數 3 位）被擋掉', !noisy.areas.some(a => Math.abs(a.value - 13.813) < 0.001));
check('40.45 保留', noisy.areas.some(a => a.value === 40.45));

console.log('\n=== 測試 3：面積優先於門寬 ===');
const byArea = estimateScale({
  totalPixelArea: 94630,
  frameSpanPx: 400,
  areas: [{ value: 46.03 }],
  doors: [{ w: 29, h: 5 }],
  assumedMeters: 0.02,
});
console.log(`    ${byArea.source} · ${byArea.metersPerPixel.toFixed(5)} m/px · ${byArea.detail}`);
check('用圖上面積', byArea.source === 'floor-area');
check('比例尺數值正確（√(46.03/94630)）', Math.abs(byArea.metersPerPixel - Math.sqrt(46.03 / 94630)) < 1e-9);
check('三個候選都列出來（可比較）', byArea.candidates.length === 3);

console.log('\n=== 測試 4：沒有面積就退回門寬 ===');
const byDoor = estimateScale({
  totalPixelArea: 94630,
  frameSpanPx: 400,
  areas: [],
  doors: [{ w: 29, h: 5 }, { w: 29, h: 4 }, { w: 76, h: 9 }, { w: 28, h: 27 }],
  assumedMeters: 0.02,
});
console.log(`    ${byDoor.source} · ${byDoor.metersPerPixel.toFixed(5)} m/px · ${byDoor.detail}`);
check('用門洞反推', byDoor.source === 'door-width');
// 細長門只有 29/29/76 三個，中位數 29；28×27 的弧線方塊要排除
check('弧線方塊被排除（中位數取 29 不是 28）', Math.abs(byDoor.metersPerPixel - 0.85 / 29) < 1e-9,
  `${byDoor.metersPerPixel}`);

console.log('\n=== 測試 5：都沒有才用固定值 ===');
const byAssumed = estimateScale({ totalPixelArea: 94630, frameSpanPx: 400, assumedMeters: 0.02 });
check('用固定比例尺', byAssumed.source === 'assumed');
check('固定值原樣帶出', byAssumed.metersPerPixel === 0.02);

console.log('\n=== 測試 6：離譜的值要被擋掉 ===');
// 500 m² 是 OCR 誤讀的典型（把尺寸當面積）。94630 px² 配 500 m² 會解出 37 m 的房子。
const bad = estimateScale({ totalPixelArea: 94630, frameSpanPx: 400, areas: [{ value: 500 }] });
check('500 m² 被擋掉', bad.source !== 'floor-area', `實際 ${bad.source}`);
// 房子外框 400 px、比例尺 0.02 → 8 m，合理
const ok = estimateScale({ totalPixelArea: 94630, frameSpanPx: 400, assumedMeters: 0.02 });
check('8 m 的房子通過', ok.source === 'assumed');
// 比例尺 0.1 → 房子 40 m，剛好在邊界外
const huge = estimateScale({ totalPixelArea: 94630, frameSpanPx: 400, assumedMeters: 0.1 });
check('40 m 的荒謬房子被擋', huge.source === 'none', `實際 ${huge.source}`);

console.log('\n=== 測試 7：完全沒有線索 ===');
const none = estimateScale({ totalPixelArea: 94630, frameSpanPx: 400 });
check('回傳 none 而不是編一個數字', none.source === 'none');
check('metersPerPixel 是 0', none.metersPerPixel === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
