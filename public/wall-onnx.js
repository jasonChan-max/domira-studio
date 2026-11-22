// 用訓練好的 UNet 在瀏覽器裡直接辨識牆線（ONNX + WebAssembly）。
//
// 為什麼要多一個模型：`wall-detect.js` 那套是「閾值＋厚度＋長度」的傳統 CV，
// 能抓到牆，但遇到木地板紋理、家具圖例、尺寸標註就開始出錯。
// 這個模型是在 700 張真實平面圖上訓練的（5 類含「屋外」；驗證集 mIoU 0.718、wall 0.646，
// 但真正該看的是它在真實彩色戶型圖上的表現），對這些干擾的容忍度高得多。
//
// 兩者並存：模型負責「牆在哪」（語意分割），傳統 CV 當後備（模型載入失敗時仍能跑）。

const CLASSES = ['floor', 'wall', 'door', 'window', 'outside'];
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

const ORT_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/ort.min.js';

let ortPromise = null;
let sessionPromise = null;
let calibrationPromise;

function loadCalibration() {
  calibrationPromise ??= fetch(new URL('./models/domira-wall-calibration.json', import.meta.url))
    .then(response => response.ok ? response.json() : null)
    .then(value => value?.format === 'domira.wall-calibration.v1' &&
      value.weights?.length === 7 && value.weights.every(Number.isFinite) &&
      Number.isFinite(value.offset) && value.blend > 0 && value.blend <= 1 ? value : null)
    .catch(() => null);
  return calibrationPromise;
}

const clip = value => Math.max(-16, Math.min(16, value));
export function wallClass(logits, stride, index, calibration) {
  const wall = logits[stride + index];
  let alternative = 0;
  for (const candidate of [2, 3, 4]) {
    if (logits[candidate * stride + index] > logits[alternative * stride + index]) alternative = candidate;
  }
  const margin = wall - logits[alternative * stride + index];
  if (!calibration) return margin > 0 ? 1 : alternative;
  const {weights, blend, offset} = calibration;
  let score = weights[6] + weights[5] * clip(margin);
  for (let channel = 0; channel < 5; channel++) score += weights[channel] * clip(logits[channel * stride + index]);
  return (1 - blend) * margin + blend * score + offset > 0 ? 1 : alternative;
}

/**
 * 只留下「房子本體」：非 outside 的最大連通域，其餘非 outside 像素一律改判 outside。
 *
 * 為什麼要這一步（2026-11-16 實測）：v19 是用「緊貼房子裁切」的 clean 圖訓練的，房子幾乎填滿
 * 畫面；真實上傳的圖是「房子只佔一角、四周大片純白」。模型沒見過這種構圖，而酷家樂圖裡的窗
 * 本身就是淺白色帶，於是畫布白底被整片判成窗——1200×900 驗收圖上 window 1.58%(v7)→6.50%，
 * 房子外被拆成 12 塊假區域共 62945 px。加這一步後回到 1.71%，真窗一個沒丟；在 v7 輸出上跑
 * 改動 0 像素（冪等）。
 *
 * 一張戶型圖的房子一定是一個連通塊，所以「不連著房子」的非 outside 像素必然是誤判。
 * 已知邊界：一張圖上有兩個戶型時會只留大的那個——本管線本來就假定單戶型。
 */
function keepHouse(mask, width, height) {
  const total = width * height;
  const label = new Int32Array(total);
  const stack = new Int32Array(total);
  const removed = [0, 0, 0, 0, 0];
  let best = 0, bestSize = 0, id = 0;
  for (let start = 0; start < total; start++) {
    if (label[start] || mask[start] === 4) continue;
    id++;
    let top = 0, size = 0;
    stack[top++] = start;
    label[start] = id;
    while (top) {
      const p = stack[--top];
      size++;
      const y = (p / width) | 0;
      const x = p - y * width;
      if (y > 0) { const q = p - width; if (mask[q] !== 4 && !label[q]) { label[q] = id; stack[top++] = q; } }
      if (y < height - 1) { const q = p + width; if (mask[q] !== 4 && !label[q]) { label[q] = id; stack[top++] = q; } }
      if (x > 0) { const q = p - 1; if (mask[q] !== 4 && !label[q]) { label[q] = id; stack[top++] = q; } }
      if (x < width - 1) { const q = p + 1; if (mask[q] !== 4 && !label[q]) { label[q] = id; stack[top++] = q; } }
    }
    if (size > bestSize) { bestSize = size; best = id; }
  }
  if (id <= 1) return removed;
  for (let i = 0; i < total; i++) {
    if (mask[i] !== 4 && label[i] !== best) { removed[mask[i]]++; mask[i] = 4; }
  }
  return removed;
}

/**
 * 把「落在外牆外框之外」的地板／窗判成屋外。
 *
 * 為什麼（2026-11-17 實測）：R (9) 那種室內白底、室外也白底的冷色調戶型圖，模型分不清
 * 裡外——房子左右兩側的留白被整片判成地板＋窗（兩塊合計約 59600 px，bbox 直接貼到畫面
 * 邊緣）。keepHouse 救不了：它們通過大門缺口和室內地板連成一片，算同一個連通域。
 *
 * 判據：真正的外牆一定包住整棟房子，落在外牆 bbox 之外的地板不可能是房間。
 * 只清 floor(0) 和 window(3)——wall/door 本來就可能在外沿，不能動。
 * options.trimOutside === false 可關掉，方便對照。
 */
function trimOutsideFloor(mask, width, height) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== 1) continue;
    const x = i % width, y = (i - x) / width;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const removed = [0, 0, 0, 0, 0];
  if (x1 < 0) return removed;
  const pad = Math.max(4, Math.round(Math.max(width, height) * .03));
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) continue;
      const i = y * width + x, c = mask[i];
      if (c === 0 || c === 3) { removed[c]++; mask[i] = 4; }
    }
  }
  return removed;
}

/**
 * 窗的两端必须有墙（2026-11-19）。
 *
 * 为什么（实测数据）：44 张标注图逐连通域对比，模型判的窗里 40% 是假的——
 * 图外尺寸线 14.7%、门洞 8.7%、地板 7.8%。而这些假窗全都一头没接墙：
 * 窗在图纸上是「墙上开的洞」，两端一定连着墙垛。
 *
 * 规则：沿连通域长边往两端各探 15px，任一端没有 wall 就改成 floor。
 * 实测（497 个预测窗）：精度 59.4% → 96.4%，假窗 202 → 9，
 * 代价是漏掉 18% 的真窗（阳台转角、飘窗这种末端窗只接一端墙）。
 * 这个权衡是有意的——漏了的窗用户点一下按钮补上，多出来的假窗会让人不信整个系统。
 *
 * 为什么用 wall 做参照而不是窗自己：wall IoU 0.823、窗只有 0.532。
 * 试过「用 mask 自己的 outside/floor 类验证窗」，完全无效——同一次推理的类别
 * 错在同一个地方，自己否不掉自己。
 *
 * 保护：wall 占比 < 5% 时整段跳过（R(9) 那种墙只占 3.35% 的图，墙本身不可靠）。
 */
function filterWindows(mask, width, height) {
  const MIN_WALL_RATIO = .05;
  const PROBE = 15;
  const MIN_LONG = 25;
  let wallCount = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] === 1) wallCount++;
  if (wallCount < mask.length * MIN_WALL_RATIO) return 0;

  const isWall = (x, y) => x >= 0 && x < width && y >= 0 && y < height && mask[y * width + x] === 1;
  const seen = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  let removed = 0;

  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== 3 || seen[start]) continue;
    let sp = 0, x0 = width, y0 = height, x1 = -1, y1 = -1;
    const block = [];
    stack[sp++] = start;
    seen[start] = 1;
    while (sp > 0) {
      const p = stack[--sp];
      block.push(p);
      const x = p % width, y = (p - x) / width;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0) { const q = p - 1; if (mask[q] === 3 && !seen[q]) { seen[q] = 1; stack[sp++] = q; } }
      if (x < width - 1) { const q = p + 1; if (mask[q] === 3 && !seen[q]) { seen[q] = 1; stack[sp++] = q; } }
      if (y > 0) { const q = p - width; if (mask[q] === 3 && !seen[q]) { seen[q] = 1; stack[sp++] = q; } }
      if (y < height - 1) { const q = p + width; if (mask[q] === 3 && !seen[q]) { seen[q] = 1; stack[sp++] = q; } }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (Math.max(bw, bh) < MIN_LONG) continue;
    let endA = false, endB = false;
    if (bw >= bh) {
      for (let d = 1; d <= PROBE && !endA; d++)
        for (let y = y0; y <= y1 && !endA; y++) if (isWall(x0 - d, y)) endA = true;
      for (let d = 1; d <= PROBE && !endB; d++)
        for (let y = y0; y <= y1 && !endB; y++) if (isWall(x1 + d, y)) endB = true;
    } else {
      for (let d = 1; d <= PROBE && !endA; d++)
        for (let x = x0; x <= x1 && !endA; x++) if (isWall(x, y0 - d)) endA = true;
      for (let d = 1; d <= PROBE && !endB; d++)
        for (let x = x0; x <= x1 && !endB; x++) if (isWall(x, y1 + d)) endB = true;
    }
    if (endA && endB) continue;
    for (const p of block) { mask[p] = 0; removed++; }
  }
  return removed;
}

function loadOrt() {
  if (!ortPromise) {
    ortPromise = new Promise((resolve, reject) => {
      if (window.ort) { resolve(window.ort); return; }
      const s = document.createElement('script');
      s.src = ORT_CDN;
      s.async = true;
      s.onload = () => window.ort ? resolve(window.ort) : reject(new Error('onnxruntime 載入後仍未定義'));
      s.onerror = () => reject(new Error('onnxruntime 載入失敗（CDN 不可達）'));
      document.head.appendChild(s);
    });
  }
  return ortPromise;
}

/** 載入模型（只做一次，之後共用）。onProgress 可拿到下載位元組數。 */
export async function loadWallModel(url, onProgress) {
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    const ort = await loadOrt();
    ort.env.wasm.proxy = typeof Worker !== 'undefined';
    let modelData = url;
    // 有 onProgress 就先自己抓，才能回報進度（InferenceSession.create 吃 URL 時無法回報）
    if (typeof onProgress === 'function') {
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error('牆體模型下載失敗');
      const total = Number(res.headers.get('content-length')) || 0;
      const reader = res.body.getReader();
      const chunks = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        onProgress(got, total);
      }
      const buf = new Uint8Array(got);
      let off = 0;
      for (const c of chunks) { buf.set(c, off); off += c.length; }
      modelData = buf;
    }
    const options = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
    try {
      return await ort.InferenceSession.create(modelData, options);
    } catch (error) {
      if (!ort.env.wasm.proxy) throw error;
      ort.env.wasm.proxy = false;
      return ort.InferenceSession.create(url, options);
    }
  })();
  sessionPromise.catch(() => { sessionPromise = null; });
  return sessionPromise;
}

/** 保持長寬比縮放並置中填邊，回傳 512×512 的 Float32Array 與映射參數。 */
function letterbox(source, size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = `rgb(${MEAN.map((m) => Math.round(m * 255)).join(',')})`;
  ctx.fillRect(0, 0, size, size);
  const scale = Math.min(size / source.width, size / source.height);
  const nw = Math.round(source.width * scale);
  const nh = Math.round(source.height * scale);
  const ox = Math.floor((size - nw) / 2);
  const oy = Math.floor((size - nh) / 2);
  ctx.drawImage(source, ox, oy, nw, nh);
  const rgba = ctx.getImageData(0, 0, size, size).data;
  const out = new Float32Array(3 * size * size);
  for (let i = 0; i < size * size; i++) {
    for (let c = 0; c < 3; c++) {
      out[c * size * size + i] = (rgba[i * 4 + c] / 255 - MEAN[c]) / STD[c];
    }
  }
  return { data: out, ox, oy, nw, nh, scale };
}

/**
 * 對一張圖跑牆線分割。
 * @param {HTMLImageElement|HTMLCanvasElement} source 原圖
 * @param {Object} options {session, size}
 * @returns {Promise<{mask: Uint8Array, width: number, height: number, stats: Object}>}
 *          mask 是「原圖尺寸」的類別圖（0=floor 1=wall 2=door 3=window 4=outside）
 */
export async function segmentWalls(source, options = {}) {
  const size = options.size || 512;
  const session = options.session || await loadWallModel(options.modelUrl);
  const ort = await loadOrt();
  const boxed = letterbox(source, size);
  const tensor = new ort.Tensor('float32', boxed.data, [1, 3, size, size]);
  const inputName = session.inputNames[0];
  const results = await session.run({ [inputName]: tensor });
  const logits = results[session.outputNames[0]];
  const [, channels, height, width] = logits.dims;
  if (channels !== CLASSES.length || height !== size || width !== size) throw new Error('牆體模型輸出格式不符');
  const calibration = await loadCalibration();
  const small = new Uint8Array(boxed.nw * boxed.nh);
  for (let y = 0; y < boxed.nh; y++) {
    for (let x = 0; x < boxed.nw; x++) {
      small[y * boxed.nw + x] = wallClass(logits.data, height * width, (y + boxed.oy) * width + x + boxed.ox, calibration);
    }
  }
  const mask = new Uint8Array(source.width * source.height);
  const stats = Object.fromEntries(CLASSES.map(name => [name, 0]));
  for (let y = 0; y < source.height; y++) {
    const row = Math.floor((y + .5) * boxed.nh / source.height) * boxed.nw;
    for (let x = 0; x < source.width; x++) {
      const value = small[row + Math.floor((x + .5) * boxed.nw / source.width)];
      mask[y * source.width + x] = value;
      stats[CLASSES[value]]++;
    }
  }
  let dropped = 0, trimmed = 0;
  if (options.keepHouse !== false) {
    const removed = keepHouse(mask, source.width, source.height);
    for (let c = 0; c < 4; c++) { stats[CLASSES[c]] -= removed[c]; dropped += removed[c]; }
    stats.outside += dropped;
  }
  if (options.trimOutside !== false) {
    const trimmedBy = trimOutsideFloor(mask, source.width, source.height);
    for (let c = 0; c < 4; c++) { stats[CLASSES[c]] -= trimmedBy[c]; trimmed += trimmedBy[c]; }
    stats.outside += trimmed;
  }
  let filteredWindows = 0;
  if (options.filterWindows !== false) {
    filteredWindows = filterWindows(mask, source.width, source.height);
    if (filteredWindows) {
      stats.window -= filteredWindows;
      stats.floor += filteredWindows;
    }
  }
  return { mask, width: source.width, height: source.height, stats, calibrated: !!calibration, dropped, trimmed, filteredWindows };
}

/** 把 mask 裡的牆（類別 1）抽成水平／垂直線段，供吸附使用。 */
export function wallLinesFromMask(mask, width, height, options = {}) {
  const minLenH = options.minLenH || 100;
  const minLenV = options.minLenV || 28;
  const gap = options.gap ?? 90;
  const hLines = [], vLines = [];

  const collect = (alongRows) => {
    const outer = alongRows ? height : width;
    const inner = alongRows ? width : height;
    const out = [];
    for (let i = 0; i < outer; i++) {
      const segs = [];
      let start = -1;
      for (let j = 0; j <= inner; j++) {
        const on = j < inner && (alongRows ? mask[i * width + j] : mask[j * width + i]) === 1;
        if (on && start < 0) start = j;
        if (!on && start >= 0) { segs.push([start, j]); start = -1; }
      }
      const merged = [];
      for (const [a, b] of segs) {
        if (merged.length && a - merged[merged.length - 1][1] < gap) merged[merged.length - 1][1] = b;
        else merged.push([a, b]);
      }
      for (const [a, b] of merged) {
        const minLen = alongRows ? minLenH : minLenV;
        if (b - a >= minLen) out.push({ pos: i, from: a, to: b, len: b - a });
      }
    }
    return out;
  };

  /**
   * 把「同一堵墙的多条平行线」合并成一条带厚度的墙线（2026-11-21）。
   *
   * 为什么必须这一步：上面按行扫描，一堵 10–20px 厚的墙会产出 10–20 条平行线
   * （46.03㎡ 实测垂直线 904 条；R(10) 在 y≈48 附近有 20 条）。3D 照着每条线画
   * 一片墙，结果一堵墙变成 10–20 片薄墙叠在一起——用户说的「3D 很碎、有噪点」。
   * 模型画得对，是这里把墙的厚度当成了多层重叠。
   *
   * 判据：pos 相邻（差 ≤ 6px）且沿线范围重叠 → 同一条墙的下一行。
   * 6px 是实测出来的（2026-11-21）：一开始写 2px，只降了一半（904→174），
   * 因为模型画的墙边界每几行就抖 3–5px，差 1px 就合不上。墙本身厚 10–20px，
   * 抖动在这个范围内，放宽到 6 不会把两堵真墙粘在一起（真墙最少隔 20px）。
   * 合并后 pos 取中线、thickness 取厚度，from/to 取并集。
   */
  const collapseThickness = (lines) => {
    if (!lines.length) return [];
    const sorted = [...lines].sort((a, b) => a.pos - b.pos);
    const out = [];
    let cur = null;
    for (const l of sorted) {
      const sameWall = cur && l.pos - cur.posEnd <= 6 && l.to >= cur.from - 8 && l.from <= cur.to + 8;
      if (sameWall) {
        cur.posEnd = l.pos;
        cur.from = Math.min(cur.from, l.from);
        cur.to = Math.max(cur.to, l.to);
      } else {
        if (cur) out.push(cur);
        cur = { posStart: l.pos, posEnd: l.pos, from: l.from, to: l.to };
      }
    }
    if (cur) out.push(cur);
    return out.map((c) => {
      const thickness = c.posEnd - c.posStart + 1;
      return {
        pos: thickness > 1 ? Math.round((c.posStart + c.posEnd) / 2) : c.posStart,
        from: c.from,
        to: c.to,
        len: c.to - c.from,
        thickness,
      };
    })
      // 2026-11-21 数据层体检：46.03 实测 170 条墙里 161 条厚度 ≤5px、3 条 >100px。
      // 前者是模型把锯齿边缘也扫成了「墙线」，后者是相邻的几堵墙被误当成一堵。
      // 真实墙厚 10–20px，所以两头都砍掉。这条过滤是权宜，根因在合并条件还不够严。
      .filter((l) => l.thickness >= 3 && l.thickness <= 40);
  };

  hLines.push(...collapseThickness(collect(true)));
  vLines.push(...collapseThickness(collect(false)));
  if (options.debug) {
    // 排查用：把合并前后的原始线一起带出去
    const rawH = collect(true), rawV = collect(false);
    return { hLines, vLines, rawH, rawV };
  }
  return { hLines, vLines };
}

/**
 * 从 wall mask 直接提取矩形墙块（2026-11-22）。
 *
 * 为什么要它：`wallLinesFromMask` 把墙当成「一维线」，可 mask 里的墙是**有厚度的
 * 二维块**。逐行扫描再还原成线，永远在「太碎」和「粘成一团」之间摇摆——
 * 46.03 实测 170 条线里 161 条厚度 ≤5px（锯齿边缘），加厚度过滤后只剩 6 条。
 *
 * 这个函数不做线还原：相邻行里 x 范围相近（差 ≤tol）的段直接合并成矩形，
 * 输出 {x0,y0,x1,y1,w,h,thickness,length}。**厚度是块的自然属性，不是猜的参数。**
 * 实测 46.03 得 36 块（厚度中位 18px）、R(10) 得 55 块（厚度中位 9px，P10 6/P90 12），
 * 都和真实墙厚对得上，3D 拿它直接画 box 就不会碎。
 *
 * 为什么必须过滤 thickness：1–2px 的是掩码锯齿边缘（不是墙），>40px 的是相邻几堵墙
 * 被误合并。真实墙厚 8–30px，两头都砍掉。
 */
export function wallBlocksFromMask(mask, width, height, options = {}) {
  const TOL = options.tol ?? 2;
  const MIN_LEN = options.minLen ?? 3;
  const blocks = [];
  let active = [];
  for (let y = 0; y < height; y++) {
    const runs = [];
    let start = -1;
    for (let x = 0; x <= width; x++) {
      const on = x < width && mask[y * width + x] === 1;
      if (on && start < 0) start = x;
      if (!on && start >= 0) { runs.push([start, x - 1]); start = -1; }
    }
    const used = new Array(active.length).fill(false);
    const next = [];
    for (const [x0, x1] of runs) {
      if (x1 - x0 + 1 < MIN_LEN) continue;
      let found = -1;
      for (let k = 0; k < active.length; k++) {
        if (used[k]) continue;
        const b = active[k];
        if (Math.abs(b.x0 - x0) <= TOL && Math.abs(b.x1 - x1) <= TOL) { found = k; break; }
      }
      if (found >= 0) {
        const b = active[found];
        used[found] = true;
        b.y1 = y;
        b.x0 = Math.min(b.x0, x0);
        b.x1 = Math.max(b.x1, x1);
        next.push(b);
      } else {
        next.push({ y0: y, y1: y, x0, x1 });
      }
    }
    for (let k = 0; k < active.length; k++) if (!used[k]) blocks.push(active[k]);
    active = next;
  }
  blocks.push(...active);
  const out = [];
  for (const b of blocks) {
    const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1;
    const thickness = Math.min(w, h), length = Math.max(w, h);
    if (thickness < 3 || thickness > 40 || length < 10) continue;
    out.push({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, w, h, thickness, length });
  }
  return out;
}
