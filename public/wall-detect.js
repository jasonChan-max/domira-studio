// 從平面圖直接量牆線，再把 AI 給的房間邊界吸到牆線上。
// 為什麼不靠 AI 量牆：實測 deepseek/Qwen 都是「猜房間矩形」，牆的位置誤差可以到整間房；
// 但牆在圖上是實實在在畫著的深色粗線，用像素就能量準（2026-11-06 驗證：外牆、隔牆全部命中）。
//
// 分工：CV 負責「牆在哪」（位置權威），AI 負責「這是什麼房間」與「面積」（語義與數字），
// 最後用牆線把 AI 的矩形邊界拉正。

const DEFAULTS = {
  threshold: 160,   // 牆是深灰不是純黑；用 80 會一個像素都抓不到
  minLenH: 100,     // 水平牆最短長度（去家具/文字）
  minLenV: 28,      // 垂直牆最短長度（垂直牆常被門窗切斷，門檻要低）
  thick: 2,         // 牆的厚度下限（木地板紋理只有 1px）
  gap: 90,          // 同一行上間隔小於這個就合併（封門洞）
  snapTol: 35,      // 邊界離牆線多遠以內才吸（像素）
};

// 把影像轉成灰階二值（暗 = 牆的候選）
function darkMask(rgba, w, h, threshold) {
  const n = w * h;
  const dark = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const gray = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000;
    dark[i] = gray < threshold ? 1 : 0;
  }
  return dark;
}

// 沿某個方向做「厚度」過濾：只保留該方向連續 thick 個以上的像素。
// 牆是粗線，木地板紋理/尺寸線只有 1px，這一步把它們去掉。
function thicknessFilter(dark, w, h, thick, vertical) {
  const out = new Uint8Array(w * h);
  if (thick <= 1) { out.set(dark); return out; }
  if (vertical) {
    for (let y = thick - 1; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let ok = 1;
        for (let k = 0; k < thick; k++) if (!dark[(y - k) * w + x]) { ok = 0; break; }
        out[y * w + x] = ok;
      }
    }
  } else {
    for (let y = 0; y < h; y++) {
      for (let x = thick - 1; x < w; x++) {
        let ok = 1;
        for (let k = 0; k < thick; k++) if (!dark[y * w + (x - k)]) { ok = 0; break; }
        out[y * w + x] = ok;
      }
    }
  }
  return out;
}

// 逐行（或逐列）找出連續段，合併間隔小於 gap 的段（把門洞封起來），只留長度 >= minLen 的
function lineSegments(mask, w, h, minLen, gap, alongRows) {
  const lines = [];
  const outer = alongRows ? h : w;
  const inner = alongRows ? w : h;
  const at = (i, j) => (alongRows ? mask[i * w + j] : mask[j * w + i]);
  for (let i = 0; i < outer; i++) {
    const segs = [];
    let start = -1;
    for (let j = 0; j <= inner; j++) {
      const on = j < inner && at(i, j);
      if (on && start < 0) start = j;
      if (!on && start >= 0) {
        if (j - start >= minLen) segs.push([start, j]);
        start = -1;
      }
    }
    const merged = [];
    for (const [a, b] of segs) {
      if (merged.length && a - merged[merged.length - 1][1] < gap) merged[merged.length - 1][1] = b;
      else merged.push([a, b]);
    }
    for (const [a, b] of merged) lines.push({ pos: i, from: a, to: b, len: b - a });
  }
  return lines;
}

/**
 * 從 RGBA 像素資料量出牆線。
 * @returns {{hLines: Array, vLines: Array, box: {x0,y0,x1,y1}, w: number, h: number}}
 */
export function detectWalls(rgba, width, height, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const dark = darkMask(rgba, width, height, o.threshold);
  const thickH = thicknessFilter(dark, width, height, o.thick, true);   // 垂直方向厚度 → 水平牆
  const thickV = thicknessFilter(dark, width, height, o.thick, false);  // 水平方向厚度 → 垂直牆
  const hLines = lineSegments(thickH, width, height, o.minLenH, o.gap, true);
  const vLines = lineSegments(thickV, width, height, o.minLenV, o.gap, false);

  // 房屋外框：所有「夠長」牆線的整體範圍。
  // 不能只取最長的兩條——門窗會把外牆切成好幾段，取不到真正的外沿。
  const keepH = hLines.filter((l) => l.len >= 80);
  const keepV = vLines.filter((l) => l.len >= 80);
  const xs = [], ys = [];
  for (const l of keepH) { xs.push(l.from, l.to); ys.push(l.pos); }
  for (const l of keepV) { xs.push(l.pos); ys.push(l.from, l.to); }
  const box = xs.length && ys.length
    ? { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
    : { x0: 0, y0: 0, x1: width, y1: height };

  return { hLines, vLines, box, w: width, h: height };
}

function snapOne(v, lines, lo, hi, tol) {
  let best = null, bestD = tol + 1;
  for (const ln of lines) {
    if (ln.to < lo || ln.from > hi) continue;   // 這條牆線沒覆蓋到這段範圍
    const d = Math.abs(ln.pos - v);
    if (d < bestD) { bestD = d; best = ln.pos; }
  }
  return best == null ? v : best;
}

/**
 * 把 AI 的房間邊界吸到牆線上。
 * AI 的 rect 是「相對房屋外框」的 0..1000，所以要先用 CV 量到的 box 映射回像素，吸附後再映射回去。
 * @returns {{rooms: Array, snappedEdges: number, totalEdges: number}}
 */
export function snapRoomsToWalls(rooms, walls, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const { box, hLines, vLines } = walls;
  const bw = box.x1 - box.x0 || 1;
  const bh = box.y1 - box.y0 || 1;
  const frame = options.frame;
  const normalized = frame?.w > 0 && frame?.h > 0;
  const span = normalized ? Math.max(frame.w, frame.h) : 1;
  const fw = normalized ? 1000 * frame.w / span : 1000;
  const fh = normalized ? 1000 * frame.h / span : 1000;
  const ox = (1000 - fw) / 2, oy = (1000 - fh) / 2;
  let snappedEdges = 0, totalEdges = 0;
  const out = rooms.map((r) => {
    const b = r.rect;
    const x0 = box.x0 + ((b.x - ox) / fw) * bw;
    const y0 = box.y0 + ((b.y - oy) / fh) * bh;
    const x1 = box.x0 + ((b.x + b.w - ox) / fw) * bw;
    const y1 = box.y0 + ((b.y + b.h - oy) / fh) * bh;
    const nx0 = snapOne(x0, vLines, Math.floor(y0), Math.ceil(y1), o.snapTol);
    const nx1 = snapOne(x1, vLines, Math.floor(y0), Math.ceil(y1), o.snapTol);
    const ny0 = snapOne(y0, hLines, Math.floor(x0), Math.ceil(x1), o.snapTol);
    const ny1 = snapOne(y1, hLines, Math.floor(x0), Math.ceil(x1), o.snapTol);
    if ((nx1 - nx0) * fw / bw < 15 || (ny1 - ny0) * fh / bh < 15) {
      totalEdges += 4;
      return r;
    }
    for (const [a, b2] of [[x0, nx0], [x1, nx1], [y0, ny0], [y1, ny1]]) {
      totalEdges++;
      if (Math.abs(a - b2) > 0.5) snappedEdges++;
    }
    const nw = Math.max(15, ((nx1 - nx0) / bw) * fw);
    const nh = Math.max(15, ((ny1 - ny0) / bh) * fh);
    return {
      ...r,
      rect: {
        x: Math.max(0, Math.min(1000 - nw, ox + ((nx0 - box.x0) / bw) * fw)),
        y: Math.max(0, Math.min(1000 - nh, oy + ((ny0 - box.y0) / bh) * fh)),
        w: Math.min(nw, 1000),
        h: Math.min(nh, 1000),
      },
    };
  });
  return { rooms: out, snappedEdges, totalEdges };
}

// 從 data URL / URL 載入圖片並取出像素（給瀏覽器用）
export async function imageToPixels(src, maxSide = 900) {
  const img = new Image();
  img.decoding = 'async';
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error('圖片載入失敗'));
    img.src = src;
  });
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  return { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h };
}
