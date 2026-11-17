#!/usr/bin/env node
/* 查一张圖在前端會得到什麼比例尺：印出 OCR 讀到的面積／長度、estimateScale 的選擇與理由。
 * 用法：node tools/probe-scale.cjs <圖片> [baseUrl]   需要 danger-full-access。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = (process.argv[3] || 'http://127.0.0.1:3000').replace(/\/$/, '');
const SRC = process.argv[2];
const PORT = Number(process.env.DOMIRA_CDP_PORT || 9338);
const PROFILE = path.join(os.tmpdir(), 'domira-scale-cdp');
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
  if (!SRC || !fs.existsSync(SRC)) throw new Error('用法: node tools/probe-scale.cjs <圖片> [baseUrl]');
  fs.copyFileSync(SRC, STAGED);
  const chrome = CANDIDATES.find((p) => fs.existsSync(p));
  const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--enable-unsafe-swiftshader',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, '--window-size=1400,1200', 'about:blank'], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 60; i++) {
    await sleep(200);
    try {
      const res = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      targets = await res.json();
      if (targets && targets.length) break;
    } catch (e) { /* 還沒起來 */ }
  }
  const page = targets.find((t) => t.type === 'page') || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let msgId = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', () => rej(new Error('WS 連不上'))); });
  const send = (method, params) => new Promise((res) => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params: params || {} })); });
  const evaluate = async (expr) => {
    const out = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    const r = out.result || {};
    if (r.exceptionDetails) throw new Error('頁面執行出錯：' + JSON.stringify(r.exceptionDetails).slice(0, 500));
    return r.result ? r.result.value : undefined;
  };
  await send('Runtime.enable');
  await send('Page.navigate', { url: BASE });
  await sleep(2500);

  const expr = `(async()=>{
    const res = await fetch('/__probe-input.jpg', {cache:'no-store'});
    const bmp = await createImageBitmap(await res.blob());
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp,0,0);
    const m = await import('/wall-onnx.js?t=' + Date.now());
    const session = await m.loadWallModel('/models/unet-int8.onnx');
    const seg = await m.segmentWalls(c, {session});
    const rp = await import('/room-polygon.js?t=' + Date.now());
    const poly = rp.roomsFromMask(seg.mask, seg.width, seg.height);
    const doors = rp.doorsFromMask(seg.mask, seg.width, seg.height);
    let fx0=Infinity,fy0=Infinity,fx1=-Infinity,fy1=-Infinity;
    for(let i=0;i<seg.mask.length;i++){ if(seg.mask[i]===4)continue;
      const x=i%seg.width, y=(i-x)/seg.width;
      if(x<fx0)fx0=x; if(x>fx1)fx1=x; if(y<fy0)fy0=y; if(y>fy1)fy1=y; }
    const frame={x:fx0,y:fy0,w:fx1-fx0,h:fy1-fy0};
    const totalPixelArea=poly.reduce((s,p)=>s+(Number(p.area)||0),0);
    const ocr = await import('/plan-ocr.js?t=' + Date.now());
    let numbers={areas:[],lengths:[]};
    try { numbers = await ocr.readPlanNumbers(c); } catch(e) { numbers={error:String(e)}; }
    const scale = ocr.estimateScale({totalPixelArea, frameSpanPx:Math.max(frame.w,frame.h), areas:numbers.areas, doors, assumedMeters:0.02});
    return JSON.stringify({size:[seg.width,seg.height], frame, rooms:poly.length,
      roomPixels:poly.map(p=>p.pixels), totalPixelArea:Math.round(totalPixelArea),
      doors:doors.length, ocrAreas:numbers.areas, ocrLengths:numbers.lengths, ocrError:numbers.error||null, scale});
  })()`;

  const r = JSON.parse(await evaluate(expr));
  console.log('圖片', r.size.join('x'), ' 房間', r.rooms, ' 門', r.doors);
  console.log('房子外框', r.frame, '→', r.frame.w + 'x' + r.frame.h);
  console.log('房間像素', r.roomPixels.join(', '), ' totalPixelArea', r.totalPixelArea);
  console.log('OCR 面積候選', r.ocrAreas);
  console.log('OCR 長度候選', r.ocrLengths);
  if (r.ocrError) console.log('OCR 出錯', r.ocrError);
  console.log('estimateScale →', JSON.stringify(r.scale));

  try { ws.close(); } catch (e) {}
  try { proc.kill(); } catch (e) {}
  try { fs.unlinkSync(STAGED); } catch (e) {}
}

main().catch((e) => {
  console.error('失敗:', e.message);
  try { fs.unlinkSync(STAGED); } catch (x) {}
  process.exit(1);
});
