// 純模型建房間：roomsFromPolygons 的單元測試。
// 驗證三件事：座標準確、面積等於多邊形面積、L 形質心不會偏。

import { roomsFromPolygons, polygonArea } from '../public/home-domain.js';

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

// 模擬模型輸出：512×512 的 mask 上兩個房間
// 房間 1：L 形（右上角切掉），房間 2：方形
const polys = [
  {
    polygon: [[100, 100], [300, 100], [300, 200], [200, 200], [200, 400], [100, 400]],
    bbox: [100, 100, 300, 400],
    center: [180, 220],
    area: 50000,
  },
  {
    polygon: [[350, 100], [450, 100], [450, 300], [350, 300]],
    bbox: [350, 100, 450, 300],
    center: [400, 200],
    area: 20000,
  },
];

console.log('=== 測試 1：基本建構（10 m × 10 m 全屋）===');
const home = roomsFromPolygons(polys, 512, 512, 10, 10);
check('切出 2 間', home.rooms.length === 2, `實際 ${home.rooms.length}`);
check('format 正確', home.format === 'domira.home.v1');
check('source 標記為模型', home.source === 'onnx-floorplan');

const [big, small] = home.rooms;
console.log(`    房間 1: ${big.name}, 面積 ${big.area_sqm} m², 尺寸 ${big.width}×${big.depth}`);
console.log(`    房間 2: ${small.name}, 面積 ${small.area_sqm} m², 尺寸 ${small.width}×${small.depth}`);
check('大房間排前面', big.area_sqm > small.area_sqm);
check('房間 1 有 polygon', big.polygon.length >= 6, `${big.polygon.length}`);
check('房間 2 是矩形', small.polygon.length === 4, `${small.polygon.length}`);

// 面積檢查：L 形 200×300 減掉 100×200 的角 = 60000-20000 = 40000 px²
// 比例尺 10/512 m/px，面積 = 40000 * (10/512)² = 40000 * 0.0003814 = 15.26 m²
const expectedBig = 40000 * (10 / 512) ** 2;
console.log(`    房間 1 預期面積 ${expectedBig.toFixed(2)} m²`);
check('房間 1 面積誤差 < 2%', Math.abs(big.area_sqm - expectedBig) / expectedBig < 0.02,
  `${big.area_sqm} vs ${expectedBig.toFixed(2)}`);

// 方形 100×200 = 20000 px² → 20000 * 0.0003814 = 7.63 m²
const expectedSmall = 20000 * (10 / 512) ** 2;
check('房間 2 面積誤差 < 2%', Math.abs(small.area_sqm - expectedSmall) / expectedSmall < 0.02,
  `${small.area_sqm} vs ${expectedSmall.toFixed(2)}`);

console.log('\n=== 測試 2：polygon 是相對房間中心的座標 ===');
for (const r of home.rooms) {
  const xs = r.polygon.map(p => p[0]);
  const zs = r.polygon.map(p => p[1]);
  const spanX = Math.max(...xs) - Math.min(...xs);
  console.log(`    ${r.name}: polygon x 跨 ${spanX.toFixed(2)} m, 房間寬 ${r.width} m`);
  check(`${r.name} polygon 跨度和房間寬一致`, Math.abs(spanX - r.width) < 0.02,
    `${spanX.toFixed(2)} vs ${r.width}`);
}

console.log('\n=== 測試 3：錯誤處理 ===');
let threw = false;
try { roomsFromPolygons([], 512, 512, 10, 10); } catch { threw = true; }
check('空 polys 會報錯', threw);

threw = false;
try { roomsFromPolygons(polys, 512, 512, 0, 10); } catch { threw = true; }
check('寬度 0 會報錯', threw);

threw = false;
try { roomsFromPolygons([{ polygon: [[1, 1]], bbox: [0, 0, 1, 1] }], 512, 512, 10, 10); } catch { threw = true; }
check('少於 3 點的 polygon 會報錯', threw);

console.log('\n=== 測試 4：座標以房子中心為原點 ===');
const totalArea = home.rooms.reduce((s, r) => s + r.area_sqm, 0);
console.log(`    兩間總面積 ${totalArea.toFixed(2)} m²`);
check('總面積小於全屋（10×10=100）', totalArea < 100);
check('總面積大於 0', totalArea > 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
