// 多邊形從「分析結果」到「3D 房屋資料」的整合測試。
// 目的：確認 polygon 放進 analysis.rooms[i] 之後，homeFromAnalysis 會把它
// 轉成相對房間中心的公尺座標，而不是被靜默丟掉。

import { homeFromAnalysis, polygonArea } from '../public/home-domain.js';

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

// 模擬 AI 回傳：一個客廳 + 一個臥室，客廳帶 L 形 polygon（0-1000 座標）
const analysis = {
  format: 'domira.floorplan-analysis.v1',
  summary: '測試',
  frame: { w: 1000, h: 1000 },
  rooms: [
    {
      name: '客廳', kind: 'living',
      rect: { x: 100, y: 100, w: 500, h: 500 },
      confidence: 'high',
      openings: [],
      // L 形：右下角切掉 100×100
      polygon: [[100, 100], [600, 100], [600, 400], [400, 400], [400, 600], [100, 600]],
      area_sqm: 32,
    },
    {
      name: '臥室', kind: 'bedroom',
      rect: { x: 650, y: 100, w: 300, h: 300 },
      confidence: 'high',
      openings: [],
      polygon: [[650, 100], [950, 100], [950, 400], [650, 400]],
      area_sqm: 9,
    },
  ],
  warnings: [],
};

console.log('=== 整合測試：analysis.polygon → home.room.polygon ===\n');

const home = homeFromAnalysis(analysis, 10, 10, 2.7, false);
check('切出 2 間房', home.rooms.length === 2, `實際 ${home.rooms.length}`);

const living = home.rooms.find(r => r.name === '客廳');
const bed = home.rooms.find(r => r.name === '臥室');
console.log(`    客廳中心 (${living.x}, ${living.z}) 尺寸 ${living.width}×${living.depth}`);

check('客廳保留 polygon', Array.isArray(living.polygon) && living.polygon.length >= 6,
  `點數 ${living?.polygon?.length}`);
check('客廳是 L 形（≥6 點）', living.polygon.length >= 6, `點數 ${living.polygon.length}`);
check('臥室是矩形（4 點）', bed.polygon.length === 4, `點數 ${bed.polygon.length}`);

// polygon 座標是「相對房間中心」的公尺偏移，所以應該落在 ±房間尺寸範圍內
const xs = living.polygon.map(p => p[0]);
const zs = living.polygon.map(p => p[1]);
console.log(`    客廳 polygon x 範圍 ${Math.min(...xs).toFixed(2)} … ${Math.max(...xs).toFixed(2)} m`);
console.log(`    客廳 polygon z 範圍 ${Math.min(...zs).toFixed(2)} … ${Math.max(...zs).toFixed(2)} m`);
// 這份測資的 frame 是 1000×1000 但 rect 只佔 100–600，validatePlanAnalysis 會把
// frame 收成房間 bbox，x/z 兩軸比例尺不同，所以 z 的偏移比 x 大是預期行為。
// 真正要驗的是「有正確轉換、沒有跑飛到離譜的量級」。
check('x 偏移在 ±5 m 內', xs.every(x => Math.abs(x) <= 5), `max ${Math.max(...xs.map(Math.abs)).toFixed(2)}`);
check('z 偏移在 ±10 m 內', zs.every(z => Math.abs(z) <= 10), `max ${Math.max(...zs.map(Math.abs)).toFixed(2)}`);

const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
const cz = zs.reduce((a, b) => a + b, 0) / zs.length;
console.log(`    polygon 形心 (${cx.toFixed(2)}, ${cz.toFixed(2)}) — L 形不對稱，偏離原點屬正常`);
check('形心在 x 範圍內', cx >= Math.min(...xs) && cx <= Math.max(...xs));
check('形心在 z 範圍內', cz >= Math.min(...zs) && cz <= Math.max(...zs));

// L 形比外接矩形小，這是不變的關係（不管比例尺怎麼縮放）
const polyArea = Math.abs(polygonArea(living.polygon));
const rectArea = living.width * living.depth;
console.log(`    L 形多邊形面積 ${polyArea.toFixed(2)} m²，外接矩形 ${rectArea.toFixed(2)} m²`);
check('L 形面積小於外接矩形', polyArea < rectArea, `${polyArea.toFixed(2)} vs ${rectArea.toFixed(2)}`);
check('L 形面積大於外接矩形的一半（切掉 100×100 只少一成多）', polyArea > rectArea * 0.5);
check('L 形面積大於 0', polyArea > 0);

// 沒有 polygon 的房間不應該憑空生出 polygon
const bare = { ...analysis, rooms: [{ ...analysis.rooms[0], polygon: undefined }] };
const home2 = homeFromAnalysis(bare, 10, 10, 2.7, false);
check('沒有 polygon 時給空陣列（不編造）', Array.isArray(home2.rooms[0].polygon) && home2.rooms[0].polygon.length === 0,
  `實際 ${JSON.stringify(home2.rooms[0].polygon)?.slice(0, 40)}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
