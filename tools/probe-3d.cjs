#!/usr/bin/env node
/* 用真实户型图跑完整 3D 管线，数墙的 mesh 数量与厚度分布。
 * 为什么要它：「3D 很碎」是用户看图发现的，只有真页面的 buildHomeGeometry 能反映。
 * 用法：先开 dev server，再 `node tools/probe-3d.cjs <图片>`
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = (process.env.DOMIRA_PROBE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const PORT = Number(process.env.DOMIRA_CDP_PORT || 9342);
const PROFILE = path.join(os.tmpdir(), 'domira-probe-3d');
const PUBLIC = path.join(__dirname, '..', 'public');
const input = process.argv[2];

const CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!input) throw new Error('用法: node tools/probe-3d.cjs <图片>');
  if (!fs.existsSync(input)) throw new Error('缺图: ' + input);

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

  const staged = path.join(PUBLIC, '__probe3d-input.jpg');
  fs.copyFileSync(input, staged);
  const stamp = Date.now();

  const expr = `(async () => {
    const onnx = await import('/wall-onnx.js');
    const poly = await import('/room-polygon.js');
    const dom = await import('/home-domain.js');
    const scene = await import('/home-scene.js');

    const img = new Image();
    img.src = '/__probe3d-input.jpg?t=${stamp}';
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);

    const seg = await onnx.segmentWalls(c, { modelUrl: '/models/unet-int8.onnx' });
    const walls = onnx.wallLinesFromMask(seg.mask, seg.width, seg.height, { debug: true });
    const blocks = onnx.wallBlocksFromMask(seg.mask, seg.width, seg.height);
    walls.blocks = blocks;
    const roomsArr = poly.roomsFromMask(seg.mask, seg.width, seg.height, {});
    const dbg = { roomsArrType: Array.isArray(roomsArr) ? 'array' : typeof roomsArr, roomsArrLen: Array.isArray(roomsArr) ? roomsArr.length : -1 };
    if (Array.isArray(roomsArr) && roomsArr[0]) dbg.firstKeys = Object.keys(roomsArr[0]);
    if (Array.isArray(roomsArr) && roomsArr[0] && roomsArr[0].polygon) dbg.polyLen = roomsArr[0].polygon.length;
    // 走真实入口 roomsFromPolygons，它会做 hLines -> {h,v} 的坐标换算与厚度传递
    const polys = (Array.isArray(roomsArr) ? roomsArr : []).filter(r => Array.isArray(r.polygon) && r.polygon.length >= 3);
    let home = null;
    try {
      home = dom.roomsFromPolygons(polys, seg.width, seg.height, 10, 8, { walls, height: 2.7 });
    } catch (e) {
      return { error: 'roomsFromPolygons: ' + String(e), dbg, polysLen: polys.length, hLines: walls.hLines.length, vLines: walls.vLines.length };
    }
    let geo = null;
    try { geo = scene.buildHomeGeometry(home); } catch (e) { return { error: String(e) }; }

    const groups = geo.group ? geo.group.children : (geo.children || []);
    const ths = [];
    let wallMeshes = 0, thin = 0, thick = 0;
    const walk = (node) => {
      if (!node || !node.children) return;
      for (const m of node.children) {
        if (m.geometry && m.geometry.parameters) {
          const p = m.geometry.parameters;
          if (Number.isFinite(p.width) && Number.isFinite(p.depth) && Number.isFinite(p.height) && p.height > 1.5) {
            wallMeshes++;
            const th = Math.min(p.width, p.depth);
            ths.push(th);
            if (th < 0.06) thin++;
            if (th > 0.12) thick++;
          }
        }
        walk(m);
      }
    };
    walk(geo.group || geo);
    ths.sort((a, b) => a - b);
    return {
      imgSize: [seg.width, seg.height],
      hLines: walls.hLines.length,
      vLines: walls.vLines.length,
      rooms: home.rooms.length,
      homeBlocks: home.walls?.blocks?.length || 0,
      homeWallsH: home.walls?.h?.length || 0,
      homeWallsV: home.walls?.v?.length || 0,
      // 数据层体检：每条墙的厚度/长度分布，找出异常值是谁
      wallStats: (() => {
        const hw = (home.walls?.h || []).map(w => ({ t: +(w.thickness || 0).toFixed(3), len: +(Math.abs(w.x1 - w.x0)).toFixed(2), pos: +(w.z || 0).toFixed(2), axis: 'h' }));
        const vw = (home.walls?.v || []).map(w => ({ t: +(w.thickness || 0).toFixed(3), len: +(Math.abs(w.z1 - w.z0)).toFixed(2), pos: +(w.x || 0).toFixed(2), axis: 'v' }));
        const all = [...hw, ...vw];
        const byT = [...all].sort((a, b) => b.t - a.t);
        return {
          total: all.length,
          thicknessBuckets: {
            '0 (没有)': all.filter(w => w.t === 0).length,
            '<=0.05': all.filter(w => w.t > 0 && w.t <= 0.05).length,
            '0.05-0.15': all.filter(w => w.t > 0.05 && w.t <= 0.15).length,
            '0.15-0.3': all.filter(w => w.t > 0.15 && w.t <= 0.3).length,
            '0.3-1': all.filter(w => w.t > 0.3 && w.t <= 1).length,
            '>1 (肯定错)': all.filter(w => w.t > 1).length,
          },
          thickest5: byT.slice(0, 5),
          thinnest5: byT.slice(-5).reverse(),
        };
      })(),
      wallMeshes,
      thinWalls: thin,
      thickWalls: thick,
      medianThickness: ths.length ? +ths[Math.floor(ths.length / 2)].toFixed(3) : 0,
      thicknessSample: ths.slice(0, 8).map(v => +v.toFixed(3)),
    };
  })()`;

  const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (res.exceptionDetails) {
    console.log('前端报错:', JSON.stringify(res.exceptionDetails).slice(0, 600));
  } else {
    console.log(JSON.stringify(res.result.value, null, 2));
  }
  try { fs.unlinkSync(staged); } catch {}
  ws.close();
  proc.kill();
}

main().catch((e) => { console.error('失败:', e.message); process.exit(1); });

