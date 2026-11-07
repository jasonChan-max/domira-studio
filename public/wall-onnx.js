// 用訓練好的 UNet 在瀏覽器裡直接辨識牆線（ONNX + WebAssembly）。
//
// 為什麼要多一個模型：`wall-detect.js` 那套是「閾值＋厚度＋長度」的傳統 CV，
// 能抓到牆，但遇到木地板紋理、家具圖例、尺寸標註就開始出錯。
// 這個模型是在 700 張真實平面圖上訓練的（5 類含「屋外」；驗證集 mIoU 0.718、wall 0.646，
// 但真正該看的是它在真實彩色戶型圖上的表現），對這些干擾的容忍度高得多。
//
// 兩者並存：模型負責「牆在哪」（語意分割），傳統 CV 當後備（模型載入失敗時仍能跑）。

const CLASSES = ['floor', 'wall', 'door', 'window'];
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

const ORT_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.min.js';

let ortPromise = null;
let sessionPromise = null;

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
    let modelData = url;
    // 有 onProgress 就先自己抓，才能回報進度（InferenceSession.create 吃 URL 時無法回報）
    if (typeof onProgress === 'function') {
      const res = await fetch(url);
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
    return ort.InferenceSession.create(modelData, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  })();
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
  const [, C, H, W] = logits.dims;
  const data = logits.data;

  // argmax over channels
  const small = new Uint8Array(H * W);
  for (let i = 0; i < H * W; i++) {
    let best = 0, bestV = -Infinity;
    for (let c = 0; c < C; c++) {
      const v = data[c * H * W + i];
      if (v > bestV) { bestV = v; best = c; }
    }
    small[i] = best;
  }

  // 裁掉 letterbox 邊，縮回原圖尺寸
  const canvas = document.createElement('canvas');
  canvas.width = boxed.nw;
  canvas.height = boxed.nh;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(boxed.nw, boxed.nh);
  for (let y = 0; y < boxed.nh; y++) {
    for (let x = 0; x < boxed.nw; x++) {
      const v = small[(y + boxed.oy) * W + (x + boxed.ox)];
      const i = (y * boxed.nw + x) * 4;
      imgData.data[i] = v === 1 ? 255 : v === 2 ? 60 : v === 3 ? 60 : 200;
      imgData.data[i + 1] = v === 2 ? 120 : v === 3 ? 220 : 200;
      imgData.data[i + 2] = v === 1 ? 60 : 200;
      imgData.data[i + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  // 放大回原圖尺寸（最近鄰，保持類別不糊掉）
  const full = document.createElement('canvas');
  full.width = source.width;
  full.height = source.height;
  const fctx = full.getContext('2d', { willReadFrequently: true });
  fctx.imageSmoothingEnabled = false;
  fctx.drawImage(canvas, 0, 0, source.width, source.height);
  const fullData = fctx.getImageData(0, 0, source.width, source.height).data;

  const mask = new Uint8Array(source.width * source.height);
  const stats = { floor: 0, wall: 0, door: 0, window: 0 };
  for (let i = 0; i < mask.length; i++) {
    const r = fullData[i * 4], g = fullData[i * 4 + 1], b = fullData[i * 4 + 2];
    let cls = 0;
    if (r === 255 && g === 200 && b === 60) cls = 1;
    else if (r === 60 && g === 120 && b === 200) cls = 2;
    else if (r === 60 && g === 220 && b === 200) cls = 3;
    mask[i] = cls;
    stats[CLASSES[cls]]++;
  }
  return { mask, width: source.width, height: source.height, stats };
}

/** 把 mask 裡的牆（類別 1）抽成水平／垂直線段，供吸附使用。 */
export function wallLinesFromMask(mask, width, height, options = {}) {
  const minLenH = options.minLenH || 100;
  const minLenV = options.minLenV || 28;
  const gap = options.gap || 90;
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

  hLines.push(...collect(true));
  vLines.push(...collect(false));
  return { hLines, vLines };
}
