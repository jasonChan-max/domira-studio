// 数一下 wallLinesFromMask 到底吐出多少条线（以及它们的位置分布）
import { readFileSync } from 'node:fs';
import { wallLinesFromMask } from '../public/wall-onnx.js';
import { PNG } from 'pngjs';

const files = process.argv.slice(2);
for (const f of files) {
  const png = PNG.sync.read(readFileSync(f));
  const PAL = [[200, 200, 200], [255, 60, 60], [60, 120, 255], [60, 220, 120], [20, 20, 20]];
  const mask = new Uint8Array(png.width * png.height);
  for (let i = 0; i < mask.length; i++) {
    const r = png.data[i * 4], g = png.data[i * 4 + 1], b = png.data[i * 4 + 2];
    let best = 0, bd = Infinity;
    for (let c = 0; c < 5; c++) {
      const dr = r - PAL[c][0], dg = g - PAL[c][1], db = b - PAL[c][2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bd) { bd = d; best = c; }
    }
    mask[i] = best;
  }
  const r = wallLinesFromMask(mask, png.width, png.height);
  const near = (arr, tol = 6) => {
    const ys = [...new Set(arr.map(l => l.pos))].sort((a, b) => a - b);
    let groups = 0, prev = -999;
    for (const y of ys) { if (y - prev > tol) groups++; prev = y; }
    return groups;
  };
  console.log(`${f.split('\\').pop()}  水平 ${r.hLines.length} 条 → 按位置聚类 ${near(r.hLines)} 组`);
  console.log(`                       垂直 ${r.vLines.length} 条 → 按位置聚类 ${near(r.vLines)} 组`);
}
