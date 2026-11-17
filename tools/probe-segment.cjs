#!/usr/bin/env node
/* 在真實 Chrome 裡跑一次 segmentWalls，印出 mask 統計、房間多邊形數、房子外框。
 *
 * 為什麼要它：Python 只能複刻 letterbox + wallClass，複刻不到 roomsFromMask / doorsFromMask
 * （那是 public/room-polygon.js 的東西）。要確認「前端輸出是不是一堆碎塊」，只能在真頁面跑。
 *
 * 用法：先開 dev server，再 `node tools/probe-segment.cjs <圖片路徑>`
 * 需要 danger-full-access（Chrome 要建 Mojo named pipe）。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = (process.argv[3] || 'http://127.0.0.1:3000').replace(/\/$/, '');
const SRC = process.argv[2];
const PORT = Number(process.env.DOMIRA_CDP_PORT || 9337);
const PROFILE = path.join(os.tmpdir(), 'domira-probe-cdp');
const PUBLIC = path.join(__dirname, '..', 'public');
const STAGED = path.join(PUBLIC, '__probe-input.jpg');

const CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!SRC || !fs.existsSync(SRC)) throw new Error('用法: node tools/probe-segment.cjs <圖片路徑> [baseUrl]');
  fs.copyFileSync(SRC, STAGED);
  const chrome = CANDIDATES.find((p) => fs.existsSync(p));
  if (!chrome) throw new Error('找不到 Chrome / Edge');

  const proc = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--enable-unsafe-swiftshader',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE,
    '--window-size=1400,1200', 'about:blank',
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 60; i++) {
    await sleep(200);
    try {
      const res = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      targets = await res.json();
      if (targets && targets.length) break;
    } catch (e) { /* 還沒起來 */ }
  }
  if (!targets || !targets.length) { try { proc.kill(); } catch (e) {} throw new Error('DevTools 沒起來'); }

  const page = targets.find((t) => t.type === 'page') || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let msgId = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails || {};
      errors.push((d.exception && d.exception.description) || d.text || 'exception');
    }
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', () => reject(new Error('WebSocket 連不上 DevTools')));
  });
  const send = (method, params) => new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  const evaluate = async (expr) => {
    const out = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    const r = out.result || {};
    if (r.exceptionDetails) throw new Error('頁面執行出錯：' + JSON.stringify(r.exceptionDetails).slice(0, 600));
    return r.result ? r.result.value : undefined;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: BASE });
  await sleep(2500);

  const expr = `(async()=>{
    const res = await fetch('/__probe-input.jpg', {cache:'no-store'});
    const bmp = await createImageBitmap(await res.blob());
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp,0,0);
    const m = await import('/wall-onnx.js?t=' + Date.now());
    const t0 = performance.now();
    const session = await m.loadWallModel('/models/unet-int8.onnx');
    const segOff = await m.segmentWalls(c, {session, keepHouse:false});
    const t1 = performance.now();
    const seg = await m.segmentWalls(c, {session});
    const rp = await import('/room-polygon.js?t=' + Date.now());
    const polyOff = rp.roomsFromMask(segOff.mask.slice(), segOff.width, segOff.height);
    const poly = rp.roomsFromMask(seg.mask, seg.width, seg.height);
    let doors = -1;
    try { doors = rp.doorsFromMask(seg.mask, seg.width, seg.height).length; } catch(e) {}
    const frameOf = (sg) => {
      let fx0=Infinity,fy0=Infinity,fx1=-Infinity,fy1=-Infinity;
      for(let i=0;i<sg.mask.length;i++){ if(sg.mask[i]===4)continue;
        const x=i%sg.width, y=(i-x)/sg.width;
        if(x<fx0)fx0=x; if(x>fx1)fx1=x; if(y<fy0)fy0=y; if(y>fy1)fy1=y; }
      return [fx0,fy0,fx1,fy1];
    };
    return JSON.stringify({
      size:[seg.width,seg.height], calibrated:seg.calibrated,
      msOff:Math.round(t1-t0), ms:Math.round(performance.now()-t1), dropped:seg.dropped,
      off:{stats:segOff.stats, rooms:polyOff.length, pixels:polyOff.map(r=>r.pixels),
           areas:polyOff.map(r=>Math.round(r.area)), bboxes:polyOff.map(r=>r.bbox.map(Math.round)),
           frame:frameOf(segOff)},
      on:{stats:seg.stats, rooms:poly.length, pixels:poly.map(r=>r.pixels),
          areas:poly.map(r=>Math.round(r.area)), bboxes:poly.map(r=>r.bbox.map(Math.round)),
          frame:frameOf(seg)},
      doors
    });
  })()`;

  const raw = await evaluate(expr);
  const r = JSON.parse(raw);
  const tot = r.size[0] * r.size[1];
  const pct = (v) => (v / tot * 100).toFixed(2) + '%';
  const line = (tag, o) => {
    console.log('【' + tag + '】類別：floor ' + pct(o.stats.floor) + '  wall ' + pct(o.stats.wall) +
      '  door ' + pct(o.stats.door) + '  window ' + pct(o.stats.window) + '  outside ' + pct(o.stats.outside));
    const f = o.frame;
    console.log('       房子外框 x ' + f[0] + '–' + f[2] + '  y ' + f[1] + '–' + f[3] +
      '  (' + (f[2] - f[0]) + 'x' + (f[3] - f[1]) + ')   房間多邊形 ' + o.rooms + ' 間');
    o.pixels.forEach((p, i) => {
      console.log('         #' + (i + 1) + ' ' + p + ' px  面積 ' + o.areas[i] + '  bbox [' + o.bboxes[i].join(',') + ']');
    });
  };
  console.log('圖片 ' + r.size[0] + 'x' + r.size[1] + '   校準 ' + r.calibrated +
    '   耗時 off ' + r.msOff + 'ms / on ' + r.ms + 'ms   keepHouse 清掉 ' + r.dropped + ' px (' +
    (r.dropped / tot * 100).toFixed(2) + '%)');
  line('清理前 keepHouse:false', r.off);
  line('清理後（現行）', r.on);
  console.log('門 ' + r.doors + ' 個');
  if (errors.length) console.log('\n頁面錯誤:\n' + errors.slice(0, 5).join('\n'));

  try { ws.close(); } catch (e) {}
  try { proc.kill(); } catch (e) {}
  try { fs.unlinkSync(STAGED); } catch (e) {}
}

main().catch((e) => {
  console.error('失敗:', e.message);
  try { fs.unlinkSync(STAGED); } catch (x) {}
  process.exit(1);
});
