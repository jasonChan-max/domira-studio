#!/usr/bin/env node
/* 并排跑「分割」和「门检测」，各出一张叠加图，方便肉眼对比。
 * 用法：先开 dev server，再 `node tools/probe-compare.cjs <图1> [图2 ...]`
 * 输出：temp/probe-compare/<名字>-seg.png / -door.png
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OUT = path.resolve(__dirname, '..', '..', '..', 'deepseek-harness', 'default-workspace', 'temp', 'probe-compare');
const BASE = (process.env.DOMIRA_PROBE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const PORT = Number(process.env.DOMIRA_CDP_PORT || 9341);
const PROFILE = path.join(os.tmpdir(), 'domira-probe-compare');
const PUBLIC = path.join(__dirname, '..', 'public');
const inputs = process.argv.slice(2);

const CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!inputs.length) throw new Error('用法: node tools/probe-compare.cjs <图1> [图2 ...]');
  for (const f of inputs) if (!fs.existsSync(f)) throw new Error('缺图: ' + f);
  fs.mkdirSync(OUT, { recursive: true });

  const chrome = CANDIDATES.find((p) => fs.existsSync(p));
  if (!chrome) throw new Error('找不到 Chrome / Edge');
  const proc = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--enable-unsafe-swiftshader',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, 'about:blank',
  ], { stdio: 'ignore', windowsHide: true });

  let targets = null;
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      targets = await r.json();
      if (targets.find((t) => t.type === 'page')) break;
    } catch {}
  }
  const page = targets && targets.find((t) => t.type === 'page');
  if (!page) throw new Error('Chrome 没起来');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    }
  });
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id;
    pending.set(key, { resolve, reject });
    ws.send(JSON.stringify({ id: key, method, params }));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: `${BASE}/index.html` });
  await sleep(2500);

  for (const src of inputs) {
    const stem = path.basename(src).replace(/\.[^.]+$/, '');
    const staged = path.join(PUBLIC, '__compare-input.jpg');
    fs.copyFileSync(src, staged);
    const stamp = Date.now();

    const expr = `(async () => {
      const seg = await import('/wall-onnx.js');
      const det = await import('/door-detect.js');
      const img = new Image();
      img.src = '/__compare-input.jpg?t=${stamp}';
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      canvas.getContext('2d').drawImage(img, 0, 0);

      const t0 = performance.now();
      const r1 = await seg.segmentWalls(canvas, { modelUrl: '/models/unet-int8.onnx' });
      const segMs = Math.round(performance.now() - t0);

      const t1 = performance.now();
      const boxes = await det.detectDoors(canvas, { modelUrl: '/models/yolo-doors-int8.onnx' });
      const detMs = Math.round(performance.now() - t1);

      // 分割叠加：五色半透明
      const OVERLAY = [[200,200,200,.30],[255,60,60,.65],[60,120,255,.65],[60,220,120,.65],[0,0,0,0]];
      const c1 = document.createElement('canvas');
      c1.width = img.width; c1.height = img.height;
      const x1 = c1.getContext('2d');
      x1.drawImage(img, 0, 0);
      const d1 = x1.getImageData(0, 0, img.width, img.height);
      for (let i = 0; i < r1.mask.length; i++) {
        const s = OVERLAY[r1.mask[i]];
        if (!s[3]) continue;
        const p = i * 4, a = s[3], b = 1 - a;
        d1.data[p] = Math.round(d1.data[p]*b + s[0]*a);
        d1.data[p+1] = Math.round(d1.data[p+1]*b + s[1]*a);
        d1.data[p+2] = Math.round(d1.data[p+2]*b + s[2]*a);
      }
      x1.putImageData(d1, 0, 0);

      // 检测叠加：门蓝框、窗绿框
      const c2 = document.createElement('canvas');
      c2.width = img.width; c2.height = img.height;
      const x2 = c2.getContext('2d');
      x2.drawImage(img, 0, 0);
      x2.lineWidth = Math.max(2, Math.round(Math.max(img.width, img.height) / 300));
      x2.font = Math.round(Math.max(12, img.height / 45)) + 'px sans-serif';
      for (const b of boxes) {
        const isDoor = b.cls === 'door';
        x2.strokeStyle = isDoor ? '#1565ff' : '#00b050';
        x2.fillStyle = x2.strokeStyle;
        x2.strokeRect(b.x, b.y, b.w, b.h);
        x2.fillText((isDoor ? 'door ' : 'win ') + b.score.toFixed(2), b.x + 2, b.y - 4);
      }

      return {
        size: [img.width, img.height],
        segMs, detMs,
        wallPct: +(r1.stats.wall / (img.width * img.height) * 100).toFixed(2),
        doorCount: boxes.filter(b => b.cls === 'door').length,
        winCount: boxes.filter(b => b.cls === 'window').length,
        seg: c1.toDataURL('image/png'),
        det: c2.toDataURL('image/png'),
      };
    })()`;

    const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails).slice(0, 400));
    const o = res.result.value;

    const save = (dataUrl, suffix) => {
      const b64 = dataUrl.split(',')[1];
      const dst = path.join(OUT, `${stem}-${suffix}.png`);
      fs.writeFileSync(dst, Buffer.from(b64, 'base64'));
      return dst;
    };
    save(o.seg, 'seg');
    save(o.det, 'door');

    console.log(`${stem}:  ${o.size[0]}x${o.size[1]}  分割 ${o.segMs}ms（墙 ${o.wallPct}%）  检测 ${o.detMs}ms（门 ${o.doorCount} 窗 ${o.winCount}）`);
    try { fs.unlinkSync(staged); } catch {}
  }

  ws.close();
  proc.kill();
  console.log('\n图在 ' + OUT);
}

main().catch((e) => { console.error('失败:', e.message); process.exit(1); });
