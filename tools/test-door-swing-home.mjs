// 驗證整屋版門扇檢查：門口擋家具要報，貼同一堵牆但在另一間房的不要誤報。
import { doorSwingConflicts, buildRoomGraph } from '../public/home-domain.js';

const item = (o) => ({ id: o.id || 'i1', name: o.name || '柜', w: o.w ?? 0.4, d: o.d ?? 0.3, h: 0.8, rotation: 0, role: 'solid', x: o.x, z: o.z });

function home(itemsA = [], itemsB = []) {
  return {
    width: 8, depth: 4,
    rooms: [
      { id: 'a', name: '客廳', kind: 'living', x: -2, z: 0, width: 4, depth: 4,
        openings: [{ edge: 'right', kind: 'door', offset: 0.4, width: 0.15 }], items: itemsA },
      { id: 'b', name: '睡房', kind: 'bedroom', x: 2, z: 0, width: 4, depth: 4,
        openings: [{ edge: 'left', kind: 'door', offset: 0.4, width: 0.15 }], items: itemsB },
    ],
  };
}

// 先確認圖結構：一道門，寬 0.6（offset .4、寬 .15 × 4m 牆）
const g = buildRoomGraph(home());
console.log('edges:', JSON.stringify(g.edges.map(e => ({ axis: e.shared.axis, door: e.door }))));
const dw = g.edges[0]?.door.width ?? 0;
console.log('門寬:', dw.toFixed(2), 'm  (門洞 z 從', g.edges[0]?.door.from, '到', g.edges[0]?.door.to, ')');

const cases = [
  ['空房', home([], []), 0],
  ['客廳家具堵門口', home([item({ x: -0.3, z: 0 })], []), 1],
  ['客廳家具離門遠', home([item({ x: -2, z: 1.5 })], []), 0],
  ['睡房家具堵門口（另一側）', home([], [item({ x: 0.3, z: 0 })]), 1],
];

let ok = true;
for (const [label, h, expect] of cases) {
  const got = doorSwingConflicts(h);
  const pass = got.length === expect;
  if (!pass) ok = false;
  console.log(`${pass ? '✓' : '✗'} ${label}: 預期 ${expect} 件, 實際 ${got.length} 件${got[0] ? ' → ' + got[0].message0 || '' : ''}`);
  got.forEach(c => console.log(`    ${c.roomName} / ${c.itemName} / 門寬 ${c.doorWidth.toFixed(2)}m`));
}

console.log(ok ? '\nPASS 整屋門扇檢查正常' : '\nFAIL 有情況不符合預期');
process.exit(ok ? 0 : 1);
