// 從樓面圖上讀印刷數字：淨面積與尺寸鏈。
//
// 為什麼要這個（2026-11-12 Heason 原話）：「需要一个专门识别文字的插件，识别总面积和
// 墙的长度，没有相关数据按照一个固定的比例尺推断，不要从零猜一个面积出来，要按照每个
// 房间的长度算出来」。
//
// 舊做法的方向是錯的：先把總面積假設成 60 m²，再按房間比例回推。圖上明明印著
// 「淨面積 46.03㎡」和一整圈尺寸（2640、3900…），那些是地面真值，猜不如讀。
//
// 邊界：只認阿拉伯數字與小數點，不認中文（房間名稱由使用者自己填）。所以語言包用
// eng 就夠，tessdata_fast 4 MB，全部放本機，展覽斷網也能跑。

let workerPromise = null;

const VENDOR = new URL('./vendor/tesseract/', import.meta.url).href;

async function loadWorker() {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    const mod = await import('./vendor/tesseract/tesseract.esm.min.js');
    // 這個 ESM 包只有 default 導出（`export { tesseract_min as default }`），
    // 直接解構 createWorker 會拿到 undefined。
    const Tesseract = mod.default || mod;
    const worker = await Tesseract.createWorker('eng', 1, {
      workerPath: VENDOR + 'worker.min.js',
      corePath: VENDOR,
      langPath: VENDOR,
      // 從同源路徑直接載入，不要包成 blob——blob 會讓 wasm／語言包的相對路徑解析失敗
      workerBlobURL: false,
      // 我們放的是未壓縮的 eng.traineddata。默認 gzip:true 會去找 eng.traineddata.gz，
      // 找不到就在初始化階段卡死（2026-11-12 實測：200 秒不返回、不拋錯，極難查）。
      gzip: false,
      logger: () => {},
    });
    // 只留數字與小數點：工程圖上其餘符號（箭頭、比例尺刻度、圖名）干擾很大
    await worker.setParameters({ tessedit_char_whitelist: '0123456789.' });
    return worker;
  })();
  return workerPromise;
}

/**
 * 對 canvas 跑一次 OCR，回傳原始文字與解析結果。
 *
 * 預處理做兩件事，都是被測出來的必要步驟：
 * ① 放大 2 倍——上傳的圖會被壓到最長 1200px，圖上的「2640」這種小字可能只剩 12px，
 *    tesseract 在那個尺寸幾乎認不出；放大到 2400px 後明顯改善。
 * ② 轉灰階——戶型圖是彩色的（米黃地板、彩色家具），灰階能壓掉顏色干擾。
 */
export async function readPlanNumbers(canvas) {
  const worker = await loadWorker();
  const { data } = await worker.recognize(preprocess(canvas));
  return { text: data.text || '', ...parsePlanNumbers(data.text || '') };
}

function preprocess(canvas) {
  try {
    const out = document.createElement('canvas');
    out.width = canvas.width * 2;
    out.height = canvas.height * 2;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, out.width, out.height);
    const img = ctx.getImageData(0, 0, out.width, out.height);
    const px = img.data;
    for (let i = 0; i < px.length; i += 4) {
      const gray = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
      px[i] = px[i + 1] = px[i + 2] = gray;
    }
    ctx.putImageData(img, 0, 0);
    return out;
  } catch {
    // 取不到 pixel 就退回原圖，OCR 品質差一點但不會整個失敗
    return canvas;
  }
}

/**
 * 從 OCR 文字裡抽出「面積候選」與「尺寸候選」。
 *
 * 面積：戶型圖上通常寫「淨面積 46.03㎡」，數值落在 15–300 之間（含小數）。
 * 尺寸：香港與內地的工程圖用 mm 標註，四位數（1000–20000）。
 * 兩者用數值範圍區分——不靠「㎡」符號，tesseract 對那個字形識別很差。
 */
export function parsePlanNumbers(text) {
  const cleaned = String(text).replace(/[，,]/g, ' ').replace(/\s+/g, ' ');
  const areas = [];
  const lengths = [];

  for (const m of cleaned.matchAll(/\d+(?:\.\d+)?/g)) {
    const raw = m[0];
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) continue;
    // 小數點存在 → 幾乎一定是面積或長度（m），不會是 mm 尺寸
    if (raw.includes('.')) {
      const decimals = raw.split('.')[1].length;
      // 面積小數不會超過 2 位。實測 R(7) 那張圖 OCR 出「22.8518」——
      // 那是 22.85 和後面的 18 黏在一起，不擋掉會變成一個憑空多出來的候選。
      if (decimals <= 2 && value >= 15 && value <= 300) {
        areas.push({ value, raw, digits: raw.replace('.', '').length });
      }
    } else if (raw.length === 4 && value >= 1000 && value <= 20000) {
      lengths.push({ value, raw });
    } else if (value >= 15 && value <= 300 && raw.length <= 3) {
      // 「46 m²」這種整數面積
      areas.push({ value, raw, digits: raw.length });
    }
  }

  // 同一頁常有多個面積（建築面積、實用面積、各房間面積）。取最大的那個當全屋淨面積：
  // 單間面積不會是整張圖裡最大的數，而全屋面積一定不小於任何一間。
  areas.sort((a, b) => b.value - a.value);
  lengths.sort((a, b) => b.value - a.value);

  return { areas, lengths, rawText: cleaned };
}

/**
 * 估比例尺（公尺／像素）。優先級：圖上面積 > 門洞寬度 > 使用者給的固定值。
 *
 * @param {object} input
 * @param {number} input.totalPixelArea  所有房間多邊形的像素面積合計
 * @param {number} [input.frameSpanPx]   房子外框長邊的像素長度（用來擋掉離譜的比例尺）
 * @param {Array}  [input.areas]         parsePlanNumbers 的面積候選
 * @param {Array}  [input.doors]         doorsFromMask 的結果（像素）
 * @param {number} [input.assumedMeters] 完全沒有線索時的固定值（公尺/像素）
 * @returns {{metersPerPixel:number, source:string, detail:string, candidates:Array}}
 */
export function estimateScale({ totalPixelArea, frameSpanPx = 0, areas = [], doors = [], assumedMeters = 0 } = {}) {
  const candidates = [];
  // 一套住宅的長邊不可能小於 3 m，也不該大到 35 m（香港單層戶型）。
  // 沒有這道閘，OCR 誤讀成 500 m² 也會被當真，整屋直接放大到 29 m 長邊。
  const plausible = (mpp) => {
    if (!(mpp > 0.002 && mpp < 0.2)) return false;
    if (frameSpanPx > 0) {
      const span = mpp * frameSpanPx;
      if (span < 3 || span > 35) return false;
    }
    return true;
  };
  // 面積本身也要過濾：全屋淨面積 15–300 m²。parsePlanNumbers 已經篩過一次，
  // 但呼叫方可能直接丟 candidates 進來，這裡再擋一層。
  const areaOk = (v) => Number.isFinite(v) && v >= 15 && v <= 300;

  // ① 圖上印的面積最可信：用「面積 ÷ 像素面積」直接解出公尺/像素
  const area = areas.find((a) => areaOk(a && a.value));
  if (area && totalPixelArea > 0) {
    const mpp = Math.sqrt(area.value / totalPixelArea);
    if (plausible(mpp)) {
      candidates.push({
        metersPerPixel: mpp,
        source: 'floor-area',
        detail: `圖上標示 ${area.value} m²`,
      });
    }
  }

  // ② 門洞寬度：住宅門淨寬常見 0.8–0.9 m，取所有「細長門」長邊的中位數當一扇門。
  // 只認長邊 ≥ 短邊 2.2 倍的連通域：CubiCasa5K 把開合弧線也標成門，那些是方塊，
  // 混進來會把中位數帶歪（2026-11-11 實測 7 個門裡有 2 個是 28×27、27×22 的方塊）。
  const doorSpans = doors
    .filter((d) => d && Number.isFinite(d.w) && Number.isFinite(d.h) && d.w > 0 && d.h > 0)
    .filter((d) => Math.max(d.w, d.h) >= 2.2 * Math.min(d.w, d.h))
    .map((d) => Math.max(d.w, d.h))
    .filter((v) => v >= 8)
    .sort((a, b) => a - b);
  if (doorSpans.length) {
    const median = doorSpans[Math.floor(doorSpans.length / 2)];
    const mpp = 0.85 / median;
    if (plausible(mpp)) {
      candidates.push({
        metersPerPixel: mpp,
        source: 'door-width',
        detail: `以門洞 ${median}px ≈ 0.85 m 反推（${doorSpans.length} 個細長門）`,
      });
    }
  }

  // ③ 都沒有 → 固定值（介面上可調）。這是誠實的假設，不是偽裝成測量。
  if (assumedMeters > 0 && plausible(assumedMeters)) {
    candidates.push({
      metersPerPixel: assumedMeters,
      source: 'assumed',
      detail: `固定比例尺 ${assumedMeters.toFixed(4)} m/px`,
    });
  }

  // 按優先級取第一個有效的
  const chosen = candidates.find((c) => c.source === 'floor-area')
    || candidates.find((c) => c.source === 'door-width')
    || candidates.find((c) => c.source === 'assumed')
    || null;

  return chosen
    ? { ...chosen, candidates }
    : { metersPerPixel: 0, source: 'none', detail: '沒有可用線索', candidates };
}

/** 釋放 worker（切換房間或關閉編輯器時呼叫，避免反覆佔用記憶體）。 */
export async function disposeOcr() {
  if (!workerPromise) return;
  try {
    const worker = await workerPromise;
    await worker.terminate();
  } catch { /* 已經結束就忽略 */ }
  workerPromise = null;
}
