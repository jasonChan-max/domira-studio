// 從分割 mask 抽出房間多邊形。
//
// 為什麼要這個：Domira 現在用 AI 回的 4 點矩形畫房間，形狀失真、面積虛增 13–14%
// （2026-11-10 實測：客廳 L 形連通域多邊形 90,970 px、外接矩形 103,085 px）。
// 而 home-scene 的 ShapeGeometry 本來就能畫任意多邊形，缺的只是「從 mask 拿輪廓」這一步。
//
// 演算法：
//   1. 連通域標記（BFS，迭代不用遞歸，2000×2000 也不會爆棧）
//   2. 每個連通域取邊界像素，用 Moore 鄰域追外輪廓
//   3. Douglas–Peucker 簡化（epsilon 取周長 0.8%，和 Python 驗證版一致）
//   4. 鞋帶公式算面積，再按 Pick's theorem 補回周長的一半
//
// 座標是「mask 像素座標」，轉成公尺由呼叫方按比例尺處理。

const FLOOR_CLASS = 0;

export function roomsFromMask(mask, width, height, options = {}) {
  const minAreaRatio = options.minAreaRatio ?? 0.01;
  const epsilonRatio = options.epsilonRatio ?? 0.008;

  const n = width * height;
  const label = new Int32Array(n).fill(-1);
  const sizes = [];
  const stack = new Int32Array(n);
  let next = 0;

  for (let start = 0; start < n; start++) {
    if (label[start] !== -1 || mask[start] !== FLOOR_CLASS) continue;
    let sp = 0;
    stack[sp++] = start;
    label[start] = next;
    let count = 0;
    while (sp > 0) {
      const p = stack[--sp];
      count++;
      const x = p % width;
      const y = (p - x) / width;
      if (x > 0) { const q = p - 1; if (label[q] === -1 && mask[q] === FLOOR_CLASS) { label[q] = next; stack[sp++] = q; } }
      if (x < width - 1) { const q = p + 1; if (label[q] === -1 && mask[q] === FLOOR_CLASS) { label[q] = next; stack[sp++] = q; } }
      if (y > 0) { const q = p - width; if (label[q] === -1 && mask[q] === FLOOR_CLASS) { label[q] = next; stack[sp++] = q; } }
      if (y < height - 1) { const q = p + width; if (label[q] === -1 && mask[q] === FLOOR_CLASS) { label[q] = next; stack[sp++] = q; } }
    }
    sizes.push(count);
    next++;
  }

  const totalFloor = sizes.reduce((a, b) => a + b, 0);
  if (totalFloor === 0) return [];
  const minArea = totalFloor * minAreaRatio;

  const rooms = [];
  for (let id = 0; id < sizes.length; id++) {
    if (sizes[id] < minArea) continue;
    const contour = traceContour(label, width, height, id);
    if (contour.length < 4) continue;
    const simplified = simplifyClosed(contour, epsilonRatio);
    if (simplified.length < 3) continue;
    // 像素輪廓的頂點落在像素中心，直接算面積會少掉周長的一半（30×30 的方框
    // 只追出 29×29，誤差 6.6%）。按 Pick's theorem 補回 B/2。
    let perimeter = 0;
    for (let i = 0; i < simplified.length; i++) {
      const a = simplified[i], b = simplified[(i + 1) % simplified.length];
      perimeter += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    const area = Math.abs(shoelace(simplified)) + perimeter / 2;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    let sx = 0, sy = 0;
    for (const [x, y] of simplified) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      sx += x;
      sy += y;
    }
    rooms.push({
      polygon: simplified,
      area,
      pixels: sizes[id],
      bbox: [x0, y0, x1, y1],
      center: [sx / simplified.length, sy / simplified.length],
    });
  }

  rooms.sort((a, b) => b.area - a.area);
  return rooms;
}

/** 追蹤連通域的外輪廓（Moore 鄰域，順時針繞一圈）。 */
function traceContour(label, width, height, id) {
  let startX = -1, startY = -1;
  for (let y = 0; y < height && startY < 0; y++) {
    for (let x = 0; x < width; x++) {
      if (label[y * width + x] === id) { startX = x; startY = y; break; }
    }
  }
  if (startY < 0) return [];

  const inside = (x, y) => x >= 0 && y >= 0 && x < width && y < height && label[y * width + x] === id;
  const dirs = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];
  const contour = [];
  let cx = startX, cy = startY;
  let dir = 7;
  const maxSteps = width * height * 4;
  let steps = 0;
  do {
    contour.push([cx, cy]);
    let found = false;
    for (let k = 0; k < 8; k++) {
      const d = (dir + 1 + k) % 8;
      const nx = cx + dirs[d][0];
      const ny = cy + dirs[d][1];
      if (inside(nx, ny)) {
        cx = nx; cy = ny;
        dir = (d + 4) % 8;
        found = true;
        break;
      }
    }
    if (!found) break;
    steps++;
  } while ((cx !== startX || cy !== startY) && steps < maxSteps);

  return contour;
}

function simplifyClosed(points, epsilonRatio) {
  let perimeter = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    perimeter += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const eps = Math.max(0.5, perimeter * epsilonRatio);
  let far = 0, best = -1;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i][0] - points[0][0], points[i][1] - points[0][1]);
    if (d > best) { best = d; far = i; }
  }
  const a = dp(points.slice(0, far + 1), eps);
  const b = dp(points.slice(far).concat([points[0]]), eps);
  return a.concat(b.slice(1, b.length - 1));
}

function dp(points, eps) {
  if (points.length < 3) return points.slice();
  let maxD = 0, idx = 0;
  const [x0, y0] = points[0];
  const [x1, y1] = points[points.length - 1];
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < points.length - 1; i++) {
    const d = Math.abs(dy * (points[i][0] - x0) - dx * (points[i][1] - y0)) / len;
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [points[0], points[points.length - 1]];
  const left = dp(points.slice(0, idx + 1), eps);
  const right = dp(points.slice(idx), eps);
  return left.slice(0, -1).concat(right);
}

/** 鞋帶公式（像素座標，回傳有符號面積）。 */
export function shoelace(points) {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
}
