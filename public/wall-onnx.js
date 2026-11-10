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
  return { mask, width: source.width, height: source.height, stats, calibrated: !!calibration };
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

  hLines.push(...collect(true));
  vLines.push(...collect(false));
  return { hLines, vLines };
}
