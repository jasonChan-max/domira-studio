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

  // 把牆（1）和門（2）像素按「最近的地板連通域」分配，讓房間擴張到牆中線。
  //
  // 為什麼非做不可（2026-11-11 使用者實測）：只取 floor 連通域的話，
  // 相鄰房間之間隔著一圈牆像素，誰都沒認領，畫出來就是一條條空隙；
  // 門洞更糟——門不是 floor 也不是 wall，是一個真正的洞。
  // 吸收之後相鄰房間正好在牆中線相接（沒有縫），門洞被填平（門是通道，地板本來就該連續）。
  // 窗（3）與屋外（4）不吸收：窗在外牆上、屋外是房子外面，擴進去只會把形狀弄歪。
  if (options.absorbWalls !== false) absorbWalls(mask, width, height, label);

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

/**
 * 多源 BFS：每個牆／門像素歸給離它最近的地板連通域。
 *
 * 難點是「距離」：不能用歐氏距離逐點算（262k 像素 × 30 間會爆），
 * 用 4 鄰域 BFS 分層擴散即可——牆通常只有幾個像素厚，BFS 的層數就是到最近房間的步數，
 * 兩間房在同一條中線上相遇，正好各分一半。
 *
 * 只吸收牆（1）與門（2）。窗（3）不吸收：它在外牆上，吃掉會讓房間朝外鼓出去。
 */
function absorbWalls(mask, width, height, label) {
  const n = width * height;
  const dist = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let head = 0, tail = 0;
  for (let i = 0; i < n; i++) {
    if (label[i] >= 0) { dist[i] = 0; queue[tail++] = i; }
  }
  while (head < tail) {
    const p = queue[head++];
    const d = dist[p] + 1;
    const x = p % width, y = (p - x) / width;
    const take = (q) => {
      if (dist[q] !== -1) return;
      const c = mask[q];
      if (c !== 1 && c !== 2) return;
      dist[q] = d;
      label[q] = label[p];
      queue[tail++] = q;
    };
    if (x > 0) take(p - 1);
    if (x < width - 1) take(p + 1);
    if (y > 0) take(p - width);
    if (y < height - 1) take(p + width);
  }
}

/**
 * 從 mask 抽出門的位置（類別 2 的連通域）。
 *
 * 為什麼要單獨抽：門洞在 mask 裡既不是地板也不是牆，`roomsFromMask` 會把它按最近的
 * 房間吸收掉（讓地板連續、不留洞），代價是門本身在幾何上消失了。所以要在吸收之前
 * 先記下門在哪，之後在 2D／3D 上單獨畫出來。
 *
 * 回傳像素座標的 {cx, cy, x, y, w, h, area, horizontal}；轉公尺由呼叫方按比例尺處理。
 */
export function doorsFromMask(mask, width, height, options = {}) {
  const DOOR_CLASS = 2;
  const minAreaRatio = options.minAreaRatio ?? 0.0008;
  const n = width * height;
  const label = new Int32Array(n).fill(-1);
  const sizes = [];
  const stack = new Int32Array(n);
  let next = 0;

  for (let start = 0; start < n; start++) {
    if (label[start] !== -1 || mask[start] !== DOOR_CLASS) continue;
    let sp = 0;
    stack[sp++] = start;
    label[start] = next;
    let count = 0;
    while (sp > 0) {
      const p = stack[--sp];
      count++;
      const x = p % width, y = (p - x) / width;
      if (x > 0) { const q = p - 1; if (label[q] === -1 && mask[q] === DOOR_CLASS) { label[q] = next; stack[sp++] = q; } }
      if (x < width - 1) { const q = p + 1; if (label[q] === -1 && mask[q] === DOOR_CLASS) { label[q] = next; stack[sp++] = q; } }
      if (y > 0) { const q = p - width; if (label[q] === -1 && mask[q] === DOOR_CLASS) { label[q] = next; stack[sp++] = q; } }
      if (y < height - 1) { const q = p + width; if (label[q] === -1 && mask[q] === DOOR_CLASS) { label[q] = next; stack[sp++] = q; } }
    }
    sizes.push(count);
    next++;
  }

  const total = sizes.reduce((a, b) => a + b, 0);
  if (!total) return [];
  const minArea = Math.max(4, total * minAreaRatio);
  const out = [];
  for (let id = 0; id < sizes.length; id++) {
    if (sizes[id] < minArea) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, sx = 0, sy = 0;
    for (let i = 0; i < n; i++) {
      if (label[i] !== id) continue;
      const x = i % width, y = (i - x) / width;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      sx += x; sy += y;
    }
    out.push({
      cx: sx / sizes[id], cy: sy / sizes[id],
      x: x0, y: y0, w: x1 - x0, h: y1 - y0,
      area: sizes[id],
      horizontal: (x1 - x0) >= (y1 - y0),
    });
  }
  return out;
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
