// 經 roomsFromPolygons 驗證牆段合併，不額外導出內部函數。
import { roomsFromPolygons } from '../public/home-domain.js';

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

const wallsFrom = lines => roomsFromPolygons(
  [{ polygon: [[0, 0], [100, 0], [100, 100], [0, 100]] }],
  100, 100, 10, 10,
  { frame: { x: 0, y: 0, w: 100, h: 100 }, walls: { hLines: lines, vLines: lines } },
).walls;

console.log('=== 相鄰 10 條重疊牆線合併，並保留完整區間 ===');
const lines = Array.from({ length: 10 }, (_, i) => ({ pos: 20 + i, from: 10 - i, to: 60 + i }));
const merged = wallsFrom(lines);
check('水平牆只剩 1 條', merged.h.length === 1, `實際 ${merged.h.length}`);
check('垂直牆只剩 1 條', merged.v.length === 1, `實際 ${merged.v.length}`);
// 像素區間聯集 1..69，比例尺 0.1 m/px，以 50px 為原點。
check('水平牆覆蓋全部 from/to', merged.h[0]?.x0 === -4.9 && merged.h[0]?.x1 === 1.9);
check('垂直牆覆蓋全部 from/to', merged.v[0]?.z0 === -4.9 && merged.v[0]?.z1 === 1.9);
check('合併牆位於厚度中線', merged.h[0]?.z === -2.55 && merged.v[0]?.x === -2.55);

console.log('\n=== 相距 50px 的重疊牆線不合併 ===');
const separate = wallsFrom([{ pos: 10, from: 10, to: 60 }, { pos: 60, from: 10, to: 60 }]);
check('水平牆保留 2 條', separate.h.length === 2);
check('垂直牆保留 2 條', separate.v.length === 2);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
