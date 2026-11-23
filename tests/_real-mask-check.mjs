// 用真實 mask 測 room-polygon.js，確認不是只在合成資料上通過。
// 讀 Python 導出的 raw mask（512×512 的類別陣列），跑 roomsFromMask，印出每間的面積與點數。

import { readFileSync } from 'node:fs';
import { roomsFromMask, doorsFromMask } from '../public/room-polygon.js';

const DIR = 'C:/Users/20744/Documents/deepseek-harness/default-workspace/temp/mask-export';
const meta = JSON.parse(readFileSync(`${DIR}/meta.json`, 'utf8'));
const buf = readFileSync(`${DIR}/mask.bin`);
const mask = new Uint8Array(buf);

console.log(`mask ${meta.width}×${meta.height}，floor 像素 ${meta.classes['0']}`);

const t0 = performance.now();
const rooms = roomsFromMask(mask, meta.width, meta.height);
const ms = performance.now() - t0;

console.log(`\n切出 ${rooms.length} 間，耗時 ${ms.toFixed(1)} ms\n`);
console.log('  #  多邊形面積  像素面積   誤差    點數   中心');
let totalPoly = 0, totalPx = 0;
for (const [i, r] of rooms.entries()) {
  const err = Math.abs(r.area - r.pixels) / r.pixels * 100;
  totalPoly += r.area;
  totalPx += r.pixels;
  console.log(`  ${i + 1}  ${r.area.toFixed(0).padStart(9)}  ${String(r.pixels).padStart(8)}  ${err.toFixed(2).padStart(5)}%  ${String(r.polygon.length).padStart(4)}  (${r.center[0].toFixed(0)}, ${r.center[1].toFixed(0)})`);
}

console.log(`\n合計：多邊形 ${totalPoly.toFixed(0)} px，實際像素 ${totalPx} px（floor 總數 ${meta.classes['0']}）`);

// 關鍵檢查：多邊形面積總和應該接近 floor 像素總數
const cover = totalPx / meta.classes['0'] * 100;
console.log(`房間覆蓋率 ${cover.toFixed(1)}%（100% = 所有 floor 都被切出來）`);

// 門：要在吸收之前抽，這裡直接對原始 mask 跑一次。
const doors = doorsFromMask(mask, meta.width, meta.height);
console.log(`\n門：${doors.length} 個（mask 門像素 ${meta.classes['2']} px）`);
for (const d of doors) {
  console.log(`  (${d.cx.toFixed(0)}, ${d.cy.toFixed(0)})  ${d.w}×${d.h} px  ${d.horizontal ? '橫' : '豎'}  ${d.area} px`);
}

if (rooms.length === 0) {
  console.log('\n❌ 一間都沒切出來 —— 這就是前端拿不到多邊形的原因');
  process.exit(1);
}
if (cover < 80) {
  console.log(`\n⚠️ 有 ${(100 - cover).toFixed(1)}% 的 floor 沒被切成房間（可能是小碎塊被 minAreaRatio 濾掉）`);
}
