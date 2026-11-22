#!/usr/bin/env node
/* 生成 2D 平面图（homePlanSVG）并与原图并排，检查「像不像原图」。
 * 用法：先开 dev server，`node tools/probe-2d.cjs <图片>`
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = (process.env.DOMIRA_PROBE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const PORT = Number(process.env.DOMIRA_CDP_PORT || 9343);
const PROFILE = path.join(os.tmpdir(), 'domira-probe-2d');
const PUBLIC = path.join(__dirname, '..', 'public');
const OUT = path.join(__dirname, '..', '.screenshots', 'wall-repair');
const input = process.argv[2];

const CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!input) throw new Error('用法: node tools/probe-2d.cjs <图片>');
  fs.mkdirSync(OUT, {recursive:true});
  const chrome = CANDIDATES.find((p) => fs.existsSync(p));
  if (!chrome) throw new Error('找不到 Chrome');
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

  const staged = path.join(PUBLIC, '__probe2d-input.jpg');
  fs.copyFileSync(input, staged);
  const stamp = Date.now();

  const expr = `(async () => {
    const onnx = await import('/wall-onnx.js');
    const {geometryFromSegmentation,homeFromRecognition} = await import('/floorplan-geometry.js');
    const {detectDoors} = await import('/door-detect.js');
    const dom = await import('/home-domain.js');
    const img = new Image();
    img.src = '/__probe2d-input.jpg?t=${stamp}';
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    const seg = await onnx.segmentWalls(c, { modelUrl: '/models/unet-int8.onnx' });
    const boxes = await detectDoors(c,{modelUrl:'/models/yolo-doors-int8.onnx'});
    const recognized = geometryFromSegmentation(seg,boxes);
    const W = 10, D = W * recognized.frame.h / recognized.frame.w;
    const home = homeFromRecognition(recognized,W,D,{height:2.7});
    const blocks = recognized.lines.blocks;
    const svg = dom.homePlanSVG(home);
    return { svg, blocks: blocks.length, rooms: home.rooms.length, W: +W.toFixed(2), D: +D.toFixed(2) };
  })()`;

  const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (res.exceptionDetails) {
    console.log('报错:', JSON.stringify(res.exceptionDetails).slice(0, 500));
  } else {
    const o = res.result.value;
    const svgPath = path.join(OUT, 'plan-2d.svg');
    fs.writeFileSync(svgPath, o.svg);
    console.log(`块 ${o.blocks} / 房间 ${o.rooms} / 整屋 ${o.W}×${o.D} m`);
    console.log('SVG:', svgPath, o.svg.length, 'bytes');
  }
  try { fs.unlinkSync(staged); } catch {}
  ws.close();
  proc.kill();
}

main().catch((e) => { console.error('失败:', e.message); process.exit(1); });
