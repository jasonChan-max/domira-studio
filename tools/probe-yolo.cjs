#!/usr/bin/env node
/* 在真 Chrome 里跑一次 detectDoors（YOLOv8n 门/窗检测），印出检出结果。
 * 用法：先开 dev server（node scripts/dev.mjs），再 `node tools/probe-yolo.cjs <图片路径>`。
 * 需 danger-full-access（Chrome 要建 Mojo named pipe）。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = (process.argv[3] || 'http://127.0.0.1:3000').replace(/\/$/, '');
const SRC = process.argv[2];
const PORT = Number(process.env.DOMIRA_CDP_PORT || 9339);
const PROFILE = path.join(os.tmpdir(), 'domira-probe-yolo');
const PUBLIC = path.join(__dirname, '..', 'public');
const STAGED = path.join(PUBLIC, '__probe-door.jpg');

const CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!SRC || !fs.existsSync(SRC)) throw new Error('用法: node tools/probe-yolo.cjs <图片路径> [baseUrl]');
  fs.copyFileSync(SRC, STAGED);
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

  const expr = `(async () => {
    const mod = await import('/door-detect.js');
    const img = new Image();
    img.src = '/__probe-door.jpg?t=' + Date.now();
    await img.decode();
    const t0 = performance.now();
    const boxes = await mod.detectDoors(img, { modelUrl: '/models/yolo-doors-int8.onnx' });
    return { size: [img.width, img.height], ms: Math.round(performance.now() - t0), boxes };
  })()`;

  const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails).slice(0, 500));
  const out = res.result.value;
  console.log(`圖片 ${out.size[0]}x${out.size[1]}   耗時 ${out.ms}ms   檢出 ${out.boxes.length} 個`);
  for (const b of out.boxes) {
    console.log(`  ${b.cls.padEnd(7)} conf ${b.score.toFixed(2)}  bbox (${b.x.toFixed(0)},${b.y.toFixed(0)}) ${b.w.toFixed(0)}x${b.h.toFixed(0)}`);
  }
  const doors = out.boxes.filter((b) => b.cls === 'door');
  console.log(`\n門 ${doors.length} 個，窗 ${out.boxes.length - doors.length} 個`);

  ws.close();
  proc.kill();
  try { fs.unlinkSync(STAGED); } catch {}
}

main().catch((e) => { console.error('失败:', e.message); process.exit(1); });
