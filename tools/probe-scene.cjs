#!/usr/bin/env node
/* 在真 Chrome 里跑 buildHomeGeometry，检查 3D 场景里门/门洞有没有真的建出来。
 * 为什么要它：「3D 没门」是用户实测发现的，单元测试看不到 THREE 的 group 结构。
 * 用法：先开 dev server，再 `node tools/probe-scene.cjs`。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = (process.argv[2] || 'http://127.0.0.1:3000').replace(/\/$/, '');
const PORT = Number(process.env.DOMIRA_CDP_PORT || 9340);
const PROFILE = path.join(os.tmpdir(), 'domira-probe-scene');

const CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
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
  await send('Page.navigate', { url: `${BASE}/studio.html` });
  await sleep(2500);

  // 构造一份「有一道墙 + 两个门」的最小 home，跑 3D 几何
  const expr = `(async () => {
    const mod = await import('/home-scene.js');
    const home = {
      width: 10, depth: 8, height: 2.7,
      rooms: [{ id: 'r1', name: '客廳', kind: 'living', x: 0, z: 0, width: 10, depth: 8, height: 2.7, openings: [], items: [] }],
      doors: [
        { x: 0, z: -4, w: 1.0, d: 0.1, horizontal: true },
        { x: -5, z: 0, w: 0.1, d: 0.9, horizontal: false }
      ],
      walls: null
    };
    const group = mod.buildHomeGeometry(home, false);
    const meshes = [];
    group.traverse(o => { if (o.isMesh && o.geometry && o.geometry.parameters) meshes.push(o); });
    const doors = group.children.filter(c => c.userData && c.userData.door);
    const doorBoxes = doors.map(d => ({
      w: +d.geometry.parameters.width.toFixed(2),
      h: +d.geometry.parameters.height.toFixed(2),
      d: +d.geometry.parameters.depth.toFixed(2),
      x: +d.position.x.toFixed(2),
      z: +d.position.z.toFixed(2),
    }));
    // 統計牆段：高度 < 2.6 的（門洞過梁）與滿高的分開數
    const wallLike = meshes.filter(o => o.userData && !o.userData.door && !o.userData.slab && o.geometry.parameters.height > 0.1);
    const lintels = wallLike.filter(o => o.geometry.parameters.height < 2.5);
    return {
      total: group.children.length,
      doorCount: doors.length,
      doorBoxes,
      wallMeshes: wallLike.length,
      lintels: lintels.length,
      maxWallH: wallLike.length ? Math.max(...wallLike.map(o => +o.geometry.parameters.height.toFixed(2))) : 0,
    };
  })()`;

  const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails).slice(0, 600));
  const o = res.result.value;
  console.log('=== 3D 場景檢查 ===');
  console.log(`門的 mesh：${o.doorCount} 個`);
  for (const d of o.doorBoxes) console.log(`  ${d.w} x ${d.h} x ${d.d} m  在 (${d.x}, ${d.z})`);
  console.log(`牆的 mesh：${o.wallMeshes} 段，其中門洞過梁 ${o.lintels} 段`);
  console.log(`最高的牆：${o.maxWallH} m`);
  const ok = o.doorCount === 2 && o.lintels >= 2 && o.maxWallH > 2.5;
  console.log(ok ? '\n✔ 兩個門都建出來了，牆也在門的位置切開（有過梁）' : '\n✘ 缺東西，看上面的數字');

  ws.close();
  proc.kill();
}

main().catch((e) => { console.error('失败:', e.message); process.exit(1); });
