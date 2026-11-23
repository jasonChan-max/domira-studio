// 追 polygon 在完整鏈路裡哪一環消失。
// 模擬 attachPolygons 產出的 data（0-1000 座標的 polygon），
// 跑 validatePlanAnalysis + homeFromAnalysis，檢查 output 的 polygon 還在不在。

import { homeFromAnalysis, validatePlanAnalysis } from '../public/home-domain.js';

const analysis = {
  format: 'domira.floorplan-analysis.v1',
  summary: '測試',
  frame: { w: 1000, h: 1000 },
  scale: { width: 7.8, depth: 6.3, basis: 'assumed' },
  rooms: [
    {
      name: '客餐廳', kind: 'living',
      rect: { x: 100, y: 100, w: 500, h: 600 },
      confidence: 'high',
      openings: [],
      // 模擬 attachPolygons 寫入的：L 形（0-1000 座標）
      polygon: [[100, 100], [600, 100], [600, 400], [400, 400], [400, 700], [100, 700]],
      area_sqm: 32,
    },
    {
      name: '臥室', kind: 'bedroom',
      rect: { x: 650, y: 100, w: 250, h: 300 },
      confidence: 'high',
      openings: [],
      polygon: [[650, 100], [900, 100], [900, 400], [650, 400]],
      area_sqm: 9,
    },
  ],
  warnings: [],
};

console.log('=== 輸入：2 間，都帶 polygon ===');
console.log('客餐廳 polygon 點數:', analysis.rooms[0].polygon.length);
console.log('臥室 polygon 點數:', analysis.rooms[1].polygon.length);

console.log('\n=== 第 1 關：validatePlanAnalysis ===');
const validated = validatePlanAnalysis(structuredClone(analysis));
console.log('房間數:', validated.rooms.length);
validated.rooms.forEach((r, i) => {
  console.log(`  [${i}] ${r.name}: polygon ${Array.isArray(r.polygon) ? r.polygon.length + ' 點' : '沒有'}, rect ${r.rect.w}×${r.rect.h}`);
});

console.log('\n=== 第 2 關：homeFromAnalysis ===');
const home = homeFromAnalysis(structuredClone(analysis), 7.8, 6.3, 2.7, false);
console.log('房間數:', home.rooms.length);
home.rooms.forEach((r, i) => {
  const n = Array.isArray(r.polygon) ? r.polygon.length : -1;
  console.log(`  [${i}] ${r.name}: polygon ${n === 0 ? '空陣列' : n + ' 點'}, 中心(${r.x},${r.z}) 尺寸 ${r.width}×${r.depth}`);
  if (n >= 3) {
    const xs = r.polygon.map(p => p[0]);
    const zs = r.polygon.map(p => p[1]);
    console.log(`       x 範圍 ${Math.min(...xs).toFixed(2)}…${Math.max(...xs).toFixed(2)}, z 範圍 ${Math.min(...zs).toFixed(2)}…${Math.max(...zs).toFixed(2)}`);
  }
});

const withPoly = home.rooms.filter(r => Array.isArray(r.polygon) && r.polygon.length >= 3).length;
console.log(`\n結果：${withPoly}/${home.rooms.length} 間有可用多邊形`);
if (withPoly === 0) {
  console.log('❌ polygon 在鏈路中丟失了 —— 3D 只會畫矩形');
  process.exit(1);
}
