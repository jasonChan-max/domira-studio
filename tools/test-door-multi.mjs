// 驗證多門：起居室這種「一個通玄關、一個通睡房」的房間，兩道門前都要能抓。
// 用 Heason 那間實際尺寸 3.60 × 3.80 m 當案例。
import { careGeometry, newCareProject, doorList } from '../public/care-domain.js';
import { CATALOG } from '../public/domain.js';

const room = { width: 3.6, depth: 3.8, height: 2.7, source: 'demo' };
const item = (o) => ({
  ...CATALOG.cabinet, id: 't1', name: '測試櫃', type: 'cabinet',
  w: 0.4, d: 0.4, h: 0.8, rotation: 0, color: '#aabbcc', ...o,
});

function project(doors, items = []) {
  const p = newCareProject(room);
  p.doorWidth = 0.9;
  p.doors = doors;
  p.items = items;
  return p;
}

const DOORS = [
  { edge: 'bottom', offset: 0.4, width: 0.9 },   // 通玄關
  { edge: 'right', offset: 0.3, width: 0.8 },    // 通睡房
];

// 先看座標換算對不對
const list = doorList(project(DOORS));
console.log('門清單（房間局部座標）:');
list.forEach(d => console.log('  ', JSON.stringify(d)));
console.log(`  門 1 中心 x=${((list[0].x0 + list[0].x1) / 2).toFixed(2)} z=${list[0].z}`);
console.log(`  門 2 中心 z=${((list[1].z0 + list[1].z1) / 2).toFixed(2)} x=${list[1].x}\n`);

const cases = [
  ['空房', project(DOORS, []), 0],
  ['玄關門前擋櫃（下方）', project(DOORS, [item({ x: 0.1, z: 1.5 })]), 1],
  ['睡房門前擋櫃（右側）', project(DOORS, [item({ x: 1.2, z: -0.36 })]), 1],
  ['房間中央（不擋任何門）', project(DOORS, [item({ x: -0.5, z: 0 })]), 0],
];

let ok = true;
for (const [label, p, expect] of cases) {
  const hit = careGeometry(p).failures.filter(f => f.rule === 'door-swing');
  const pass = hit.length === expect;
  if (!pass) ok = false;
  console.log(`${pass ? '✓' : '✗'} ${label}: 預期 ${expect}, 實際 ${hit.length}${hit[0] ? ' → ' + hit[0].message : ''}`);
}

// 舊的單入口行為仍要保留
const legacy = newCareProject(room);
const legacyHit = careGeometry(legacy).failures.filter(f => f.rule === 'door-swing');
console.log(`\n✓ 舊單入口（沒有 doors 欄位）: ${legacyHit.length} 件，doorList 長度 ${doorList(legacy).length}`);

console.log(ok ? '\nPASS 多門判定正常' : '\nFAIL 多門有問題');
process.exit(ok ? 0 : 1);
