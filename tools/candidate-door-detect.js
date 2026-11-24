/**
 * 门/窗检测（YOLOv8n，自训）。和 wall-onnx.js 的分割互补：
 *   分割给墙／地板／屋外（像素级，IoU 0.82–0.91）
 *   检测给门／窗（bbox，P 0.84 / R 0.89）
 *
 * 为什么门要用检测而不是分割：
 *   门只占全图约 1.5% 像素，逐像素分类学不动（door IoU 只有 0.43）；
 *   门是标准「物体」，bbox 回归反而更准，而且 3D 开门洞只需要位置和宽度。
 *
 * 模型：runs/yolo-n-floorplan/weights/best_int8.onnx（3.41 MB）
 * 训练数据：84 张已有 mask 提 bbox（74 训 / 10 验，1211 个框）
 */

const INPUT_SIZE = 640;
// YOLO 标准的填充色（不是 ImageNet 均值）
const PAD = 114;
const CLASSES = ['door', 'window'];

const sessionPromises = new Map();

function loadOrt() {
  if (window.ort) return Promise.resolve(window.ort);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/ort.min.js';
    s.onload = () => (window.ort ? resolve(window.ort) : reject(new Error('onnxruntime 載入後仍未定義')));
    s.onerror = () => reject(new Error('onnxruntime 載入失敗（CDN 不可達）'));
    document.head.appendChild(s);
  });
}

export async function loadDoorModel(url = new URL('./models/yolo-doors-int8.onnx', import.meta.url).href, onProgress) {
  if (sessionPromises.has(url)) return sessionPromises.get(url);
  const sessionPromise = (async () => {
    const ort = await loadOrt();
    ort.env.wasm.proxy = typeof Worker !== 'undefined';
    let modelData = url;
    if (typeof onProgress === 'function') {
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error('門窗模型下載失敗');
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
  sessionPromises.set(url, sessionPromise);
  sessionPromise.catch(() => { if (sessionPromises.get(url) === sessionPromise) sessionPromises.delete(url); });
  return sessionPromise;
}

/** YOLO 的 letterbox：等比缩放到 640 见方、灰边填充、/255 归一化（没有 ImageNet 均值）。 */
function letterbox(source) {
  const size = INPUT_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = `rgb(${PAD},${PAD},${PAD})`;
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
    for (let c = 0; c < 3; c++) out[c * size * size + i] = rgba[i * 4 + c] / 255;
  }
  return { data: out, ox, oy, scale, nw, nh };
}

function iou(a, b) {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/** 按类别做 NMS（同一扇门只留分数最高的框） */
function nms(boxes, iouThreshold) {
  boxes.sort((a, b) => b.score - a.score);
  const keep = [];
  const used = new Uint8Array(boxes.length);
  for (let i = 0; i < boxes.length; i++) {
    if (used[i]) continue;
    keep.push(boxes[i]);
    for (let j = i + 1; j < boxes.length; j++) {
      if (!used[j] && boxes[j].cls === boxes[i].cls && iou(boxes[i], boxes[j]) > iouThreshold) used[j] = 1;
    }
  }
  return keep;
}

/**
 * 检测门和窗。
 * @param {HTMLImageElement|HTMLCanvasElement} source 原图
 * @param {Object} options {session, modelUrl, conf, iou, onProgress}
 * @returns {Promise<Array<{x,y,w,h,cls,score}>>} 坐标是原图像素；cls 是 'door' 或 'window'
 */
async function detectModelOpenings(source, options = {}) {
  const warm = options.session ? null : loadDoorModel(options.modelUrl, options.onProgress);
  const session = options.session || await warm;
  const ort = await loadOrt();
  const boxed = letterbox(source);
  const tensor = new ort.Tensor('float32', boxed.data, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  const results = await session.run({ [session.inputNames[0]]: tensor });
  const out = results[session.outputNames[0]];
  const [, channels, anchors] = out.dims;
  const nClasses = channels - 4;
  if (nClasses !== CLASSES.length) throw new Error(`門窗模型輸出 ${nClasses} 類，預期 ${CLASSES.length} 類`);

  const conf = options.conf ?? 0.25;
  const data = out.data;
  const boxes = [];
  for (let i = 0; i < anchors; i++) {
    let best = 0, bestScore = 0;
    for (let c = 0; c < nClasses; c++) {
      const s = data[(4 + c) * anchors + i];
      if (s > bestScore) { bestScore = s; best = c; }
    }
    if (bestScore < conf) continue;
    const cx = data[i], cy = data[anchors + i];
    const w = data[2 * anchors + i], h = data[3 * anchors + i];
    // 从 640 的 box 映射回原图
    const x = (cx - w / 2 - boxed.ox) / boxed.scale;
    const y = (cy - h / 2 - boxed.oy) / boxed.scale;
    boxes.push({
      x, y,
      w: w / boxed.scale,
      h: h / boxed.scale,
      cls: CLASSES[best],
      score: bestScore,
    });
  }
  return nms(boxes, options.iou ?? 0.45);
}

// 续训仅用于门。窗继续用原有权重和完全相同的解码/NMS，避免无窗标注的负样本抑制窗。
export async function detectDoors(source, options = {}) {
  const [doors, windows] = await Promise.all([
    detectModelOpenings(source, options),
    detectModelOpenings(source, {
      ...options,
      session: options.windowSession,
      modelUrl: options.windowModelUrl || new URL('./models/yolo-windows-int8.onnx', import.meta.url).href,
      onProgress: undefined,
    }),
  ]);
  return [...doors.filter(b => b.cls === 'door'), ...windows.filter(b => b.cls === 'window')]
    .sort((a, b) => b.score - a.score);
}

/** 只要门（供 home-studio 直接用） */
export async function detectDoorsOnly(source, options = {}) {
  const all = await detectModelOpenings(source, options);
  return all.filter(b => b.cls === 'door');
}
