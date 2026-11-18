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
  const stack = new Int32Array(n);
  const eroded = new Uint8Array(n);
  // 3×3 腐蝕：邊界以外視為非地板，切斷 1–2px 的地板細橋。
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x;
      let floor = true;
      for (let dy = -1; dy <= 1 && floor; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (mask[p + dy * width + dx] !== FLOOR_CLASS) { floor = false; break; }
        }
      }
      if (floor) eroded[p] = 1;
    }
  }

  // 檢查每個原始連通域；完全消失的那一塊改用原始地板作種子。
  const labelFloor = (seedsOnly) => {
    label.fill(-1);
    const sizes = [];
    const surviving = [];
    for (let start = 0; start < n; start++) {
      if (label[start] !== -1 || mask[start] !== FLOOR_CLASS || (seedsOnly && !eroded[start])) continue;
      const id = sizes.length;
      let sp = 0, count = 0, survives = false;
      stack[sp++] = start;
      label[start] = id;
      while (sp > 0) {
        const p = stack[--sp];
        count++;
        if (eroded[p]) survives = true;
        const x = p % width;
        const take = (q) => {
          if (label[q] !== -1 || mask[q] !== FLOOR_CLASS || (seedsOnly && !eroded[q])) return;
          label[q] = id;
          stack[sp++] = q;
        };
        if (x > 0) take(p - 1);
        if (x < width - 1) take(p + 1);
        if (p >= width) take(p - width);
        if (p + width < n) take(p + width);
      }
      sizes.push(count);
      surviving.push(survives);
    }
    return { sizes, surviving };
  };
  const original = labelFloor(false);
  const totalFloor = original.sizes.reduce((a, b) => a + b, 0);
  if (totalFloor === 0) return [];
  // 沒有任何種子時也會還原所有原始連通域，不讓狹窄小房間消失。
  for (let p = 0; p < n; p++) {
    if (label[p] >= 0 && !original.surviving[label[p]]) eroded[p] = 1;
  }
  const sizes = labelFloor(true).sizes;
  const minArea = totalFloor * minAreaRatio;

  // 從所有種子同時逐層擴散，還原地板並吸收牆／門到中線。
  // sizes 只累計地板，窗（3）與屋外（4）不分配；保留 absorbWalls:false。
  const queue = new Int32Array(n);
  let head = 0, tail = 0;
  for (let p = 0; p < n; p++) {
    if (label[p] >= 0) queue[tail++] = p;
  }
  while (head < tail) {
    const p = queue[head++];
    const x = p % width;
    const take = (q) => {
      if (label[q] !== -1) return;
      const c = mask[q];
      if (c !== FLOOR_CLASS && (options.absorbWalls === false || (c !== 1 && c !== 2))) return;
      label[q] = label[p];
      if (c === FLOOR_CLASS) sizes[label[q]]++;
      queue[tail++] = q;
    };
    if (x > 0) take(p - 1);
    if (x < width - 1) take(p + 1);
    if (p >= width) take(p - width);
    if (p + width < n) take(p + width);
  }

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
  // Explicit opt-in; remove this option to return to the learned door class.
  if (options.wallGaps === true) return doorsFromWallGaps(mask, width, height, options);
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

/** Infer openings from wall geometry only. Coordinates and fields match doorsFromMask.
 * Defaults are in mask pixels. Opt in via doorsFromMask(..., {wallGaps:true}).
 */
export function doorsFromWallGaps(mask, width, height, options = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || mask.length !== width * height) {
    throw new RangeError('Invalid wall mask dimensions');
  }
  const minGap = options.minGap ?? 40, maxGap = options.maxGap ?? 120;
  const n = width * height;
  const wall = Uint8Array.from(mask, c => c === 1 ? 1 : 0);
  const dirs = [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]];
  const at = (a, x, y) => x >= 0 && y >= 0 && x < width && y < height ? a[y * width + x] : 0;
  const neighbors = (a, p) => {
    const x = p % width, y = Math.floor(p / width);
    return dirs.map(([dx,dy]) => at(a,x+dx,y+dy) ? (y+dy)*width+x+dx : -1).filter(q => q >= 0);
  };
  // Zhang-Suen: simultaneous deletion in each of the two subiterations.
  const thin = input => {
    const a = input.slice();
    let changed;
    do {
      changed = false;
      for (let phase = 0; phase < 2; phase++) {
        const remove = [];
        for (let p = 0; p < n; p++) {
          if (!a[p]) continue;
          const x = p % width, y = Math.floor(p / width);
          const b = dirs.map(([dx,dy]) => at(a,x+dx,y+dy));
          const count = b.reduce((s,v) => s+v,0);
          if (count < 2 || count > 6) continue;
          let transitions = 0;
          for (let k=0;k<8;k++) if (!b[k] && b[(k+1)%8]) transitions++;
          if (transitions !== 1) continue;
          if (phase === 0 ? b[0]*b[2]*b[4] || b[2]*b[4]*b[6] : b[0]*b[2]*b[6] || b[0]*b[4]*b[6]) continue;
          remove.push(p);
        }
        for (const p of remove) a[p] = 0;
        if (remove.length) changed = true;
      }
    } while (changed);
    return a;
  };
  let skeleton = thin(wall);
  const endpoints = () => Array.from(skeleton.keys()).filter(p => skeleton[p] && neighbors(skeleton,p).length === 1);
  let ends = endpoints();
  if (ends.length > 50) {
    // One 3x3 opening removes edge spurs; never close gaps.
    const eroded = new Uint8Array(n), opened = new Uint8Array(n);
    for (let p=0;p<n;p++) {
      const x=p%width,y=Math.floor(p/width);
      eroded[p] = wall[p] && dirs.every(([dx,dy]) => at(wall,x+dx,y+dy)) ? 1 : 0;
    }
    for (let p=0;p<n;p++) {
      const x=p%width,y=Math.floor(p/width);
      opened[p] = eroded[p] || dirs.some(([dx,dy]) => at(eroded,x+dx,y+dy)) ? 1 : 0;
    }
    skeleton = thin(opened); ends = endpoints();
  }
  const point = p => ({x:p%width,y:Math.floor(p/width)});
  const outward = start => {
    let prev=-1,p=start;
    for (let i=0;i<12;i++) {
      const next=neighbors(skeleton,p).filter(q=>q!==prev);
      if (next.length!==1) break;
      prev=p;p=next[0];
    }
    const a=point(start),b=point(p),len=Math.hypot(a.x-b.x,a.y-b.y)||1;
    return {x:(a.x-b.x)/len,y:(a.y-b.y)/len};
  };
  const tangents=ends.map(outward);
  // Bounded Dijkstra, with Euclidean weights for diagonal skeleton edges.
  const shortPath = (start,target,limit) => {
    const best=new Map([[start,0]]), queue=[[0,start]];
    while(queue.length) {
      queue.sort((a,b)=>b[0]-a[0]);
      const [d,p]=queue.pop();
      if(d!==best.get(p)) continue;
      if(p===target) return true;
      for(const q of neighbors(skeleton,p)) {
        const a=point(p),b=point(q),nd=d+Math.hypot(a.x-b.x,a.y-b.y);
        if(nd<=limit && nd<(best.get(q)??Infinity)) { best.set(q,nd);queue.push([nd,q]); }
      }
    }
    return false;
  };
  const candidates=[];
  for(let i=0;i<ends.length;i++) for(let j=i+1;j<ends.length;j++) {
    const a=point(ends[i]),b=point(ends[j]),dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);
    if(d<minGap || d>maxGap) continue;
    const ux=dx/d,uy=dy/d;
    // Both wall tips must face the opening, excluding cross-wall pairs.
    if(tangents[i].x*ux+tangents[i].y*uy<0.9 || tangents[j].x*-ux+tangents[j].y*-uy<0.9) continue;
    if(shortPath(ends[i],ends[j],d*1.3)) continue;
    // Thinning pulls tips inside thick walls. Trim only the contiguous wall
    // caps at either end, then check every pixel of the actual opening.
    const samples=Math.max(60,Math.ceil(d*2)), values=[];
    for(let k=0;k<=samples;k++) values.push(at(wall,Math.round(a.x+dx*k/samples),Math.round(a.y+dy*k/samples)));
    let first=0,last=samples;
    while(first<=last && values[first]) first++;
    while(last>=first && values[last]) last--;
    if(first>last || values.slice(first,last+1).some(Boolean)) continue;
    const gap=(last-first+1)*d/samples;
    if(gap<minGap || gap>maxGap) continue;
    const thickness = p => {
      let t=1;
      for(const sign of [-1,1]) for(let k=1;k<=maxGap;k++) {
        if(!at(wall,Math.round(p.x-sign*uy*k),Math.round(p.y+sign*ux*k))) break;
        t++;
      }
      return t;
    };
    const thick=(thickness(a)+thickness(b))/2;
    const cx=a.x+dx*(first+last)/(2*samples),cy=a.y+dy*(first+last)/(2*samples);
    const w=Math.abs(ux)*gap+Math.abs(uy)*thick,h=Math.abs(uy)*gap+Math.abs(ux)*thick;
    candidates.push({cx,cy,x:cx-w/2,y:cy-h/2,w,h,area:gap*thick,horizontal:Math.abs(dx)>Math.abs(dy)});
  }
  const out=[];
  for(const door of candidates) {
    let merged={...door},again=true;
    while(again) {
      again=false;
      for(let i=0;i<out.length;i++) {
        const other=out[i];
        if(other.horizontal!==merged.horizontal) continue;
        const overlap=Math.max(0,Math.min(other.x+other.w,merged.x+merged.w)-Math.max(other.x,merged.x))*
          Math.max(0,Math.min(other.y+other.h,merged.y+merged.h)-Math.max(other.y,merged.y));
        if(overlap/Math.min(other.w*other.h,merged.w*merged.h)<=0.6) continue;
        const x=Math.min(other.x,merged.x),y=Math.min(other.y,merged.y);
        const w=Math.max(other.x+other.w,merged.x+merged.w)-x,h=Math.max(other.y+other.h,merged.y+merged.h)-y;
        merged={x,y,w,h,cx:x+w/2,cy:y+h/2,area:w*h,horizontal:merged.horizontal};
        out.splice(i,1);again=true;break;
      }
    }
    out.push(merged);
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
