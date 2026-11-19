// Real-browser YOLO evaluation. No model or annotation files are copied into public/.
// node tools/evaluate-openings.mjs <clean-directory> <mask-directory> [real-image ...]
import {createServer} from 'node:http';
import {readFile, readdir, mkdir, writeFile} from 'node:fs/promises';
import {resolve, basename, extname} from 'node:path';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';

const [images, masks, ...real] = process.argv.slice(2);
if (!images || !masks) throw new Error('Usage: node tools/evaluate-openings.mjs <clean-directory> <mask-directory> [real-image ...]');
const root = resolve(import.meta.dirname, '..');
const names = (await readdir(images)).filter(n => /\.(jpg|jpeg|png)$/i.test(n)).sort();
const maskNames = await readdir(masks);
const samples = names.map(name => {
  const stem = basename(name, extname(name));
  const mask = maskNames.find(n => n === `${stem}-clean-mask.png`);
  if (!mask) throw new Error(`Missing annotation: ${stem}`);
  return {name, image: resolve(images, name), mask: resolve(masks, mask)};
}).concat(real.map(image => ({name: basename(image), image: resolve(image)})));
if (names.length !== 44) throw new Error(`Expected 44 annotated images, found ${names.length}`);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
for(const sample of samples){sample.imageSha256=sha256(await readFile(sample.image));if(sample.mask)sample.maskSha256=sha256(await readFile(sample.mask));}
const modelHashes=Object.fromEntries(await Promise.all(['yolo-doors-int8.onnx','unet-int8.onnx'].map(async name=>[name,sha256(await readFile(resolve(root,'public/models',name)))])));

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if(url.pathname==='/runner.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Offline opening evaluation</title>');return;}
    if(url.pathname==='/__cv.mjs'){res.setHeader('Content-Type','text/javascript');res.end(await readFile(resolve(root,'tools/lib/floorplan-cv.mjs')));return;}
    const match = url.pathname.match(/^\/sample\/(\d+)\/(image|mask)$/);
    const file = match ? samples[Number(match[1])]?.[match[2]] : resolve(root, 'public', '.' + url.pathname);
    if (!file || (!match && !file.startsWith(resolve(root, 'public') + '\\') && !file.startsWith(resolve(root, 'public') + '/'))) throw new Error('Invalid path');
    res.setHeader('Content-Type', ({'.html':'text/html','.js':'text/javascript','.png':'image/png','.css':'text/css'})[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
if (!chrome) throw new Error('Chrome / Edge not found');
const port = Number(process.env.DOMIRA_CDP_PORT || 9347);
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--no-sandbox', `--remote-debugging-port=${port}`, `--user-data-dir=${resolve(tmpdir(), 'domira-opening-evaluation')}`, 'about:blank'], {stdio:'ignore', windowsHide:true});
let ws;
try {
  let page;
  for (let i=0;i<80;i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page'); } catch {}
    if (page) break;
    await new Promise(r=>setTimeout(r,250));
  }
  if (!page) throw new Error('Browser startup timed out');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
  let serial=0; const pending=new Map();
  ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  await send('Page.enable');
  await send('Page.navigate',{url:base+'/runner.html'});
  await new Promise(r=>setTimeout(r,1000));
  const rows=[];
  for (let index=0;index<samples.length;index++) {
    const known46=samples[index].imageSha256==='073c2aa05ca23d03d52c83fece70998fbe5fd43f561accd06b60a65d61df6691';
    const result=await send('Runtime.evaluate',{expression:`(${evaluate.toString()})(${index},${!!samples[index].mask},${known46})`,awaitPromise:true,returnByValue:true,timeout:180000});
    if(result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    const row={name:known46?'46.03':samples[index].name,imageSha256:samples[index].imageSha256,maskSha256:samples[index].maskSha256,...result.result.value};
    if(row.overlays){const out=resolve(root,'.screenshots/opening-evaluation');await mkdir(out,{recursive:true});for(const [key,url] of Object.entries(row.overlays))await writeFile(resolve(out,`${index}-${key}.png`),Buffer.from(url.split(',')[1],'base64'));delete row.overlays;}
    rows.push(row);
    console.log(JSON.stringify({name:row.name,ms:row.ms,windowPixelIoU:row.windowPixelIoU,windowBoxIoU:row.windowBoxIoU,windows:row.windowCount,cv:row.cv,ocr:row.ocr,doors:row.thresholds.map(({conf,count,matched,unmatched,truth})=>({conf,count,matched,unmatched,truth}))}));
  }
  const labeled=rows.filter(r=>r.windowPixelIoU!==null);
  const mean=key=>labeled.reduce((s,r)=>s+r[key],0)/labeled.length;
  const report={createdAt:new Date().toISOString(),modelHashes,conf:0.25,annotated:labeled.length,
    definitions:{windowPixelIoU:'Union of predicted window rectangles versus annotated green pixels; both empty = 1.',windowBoxIoU:'Union of predicted window rectangles versus 4-connected annotation bounding rectangles; both empty = 1.',doorMatching:'Greedy one-to-one bounding-box IoU >= 0.5 using 4-connected components, matching training annotation connectivity; proxy only; real-image false positives require visual review.'},
    meanWindowPixelIoU:mean('windowPixelIoU'),meanWindowBoxIoU:mean('windowBoxIoU'),
    windowGatePassed:mean('windowPixelIoU')>=0.6,rows};
  const out=resolve(root,'.screenshots/opening-evaluation');await mkdir(out,{recursive:true});
  await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log('REPORT',JSON.stringify({meanWindowPixelIoU:report.meanWindowPixelIoU,meanWindowBoxIoU:report.meanWindowBoxIoU,windowGatePassed:report.windowGatePassed,path:resolve(out,'report.json')}));
} finally {ws?.close();proc.kill();server.closeAllConnections();server.close();}

async function evaluate(index, annotated, known46) {
  const {detectDoors}=await import('/door-detect.js');
  async function pixels(path) {const img=new Image();img.src=path;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0);return {canvas:c,data:ctx.getImageData(0,0,c.width,c.height).data};}
  const {canvas}=await pixels(`/sample/${index}/image`),w=canvas.width,h=canvas.height;
  const start=performance.now();
  // Run once at the lowest confidence; class-wise NMS is score ordered, so
  // filtering reproduces the higher-confidence runs without extra inference.
  const boxes=await detectDoors(canvas,{modelUrl:'/models/yolo-doors-int8.onnx',conf:0.10});
  const ms=performance.now()-start;
  let data=null;
  if(annotated){const mask=await pixels(`/sample/${index}/mask`);if(mask.canvas.width!==w||mask.canvas.height!==h)throw new Error('Annotation size mismatch');data=mask.data;}
  function classPixels(cls) {const out=new Uint8Array(w*h);if(data)for(let i=0;i<out.length;i++){const p=i*4;out[i]=cls==='window'?Number(data[p+1]>180&&data[p]<120&&data[p+2]<180):Number(data[p+2]>180&&data[p]<120&&data[p+1]<180);}return out;}
  function components(mask){const visited=new Uint8Array(w*h),queue=new Int32Array(w*h),out=[];for(let i=0;i<mask.length;i++){if(!mask[i]||visited[i])continue;let head=0,tail=1,x0=w,y0=h,x1=0,y1=0;queue[0]=i;visited[i]=1;while(head<tail){const p=queue[head++],x=p%w,y=Math.floor(p/w);x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(dx && dy)continue;const xx=x+dx,yy=y+dy,j=yy*w+xx;if(xx>=0&&xx<w&&yy>=0&&yy<h&&mask[j]&&!visited[j]){visited[j]=1;queue[tail++]=j;}}}out.push({x:x0,y:y0,w:x1-x0+1,h:y1-y0+1,pixels:tail});}return out;}
  function raster(rects){const out=new Uint8Array(w*h);for(const b of rects)for(let y=Math.max(0,Math.floor(b.y));y<Math.min(h,Math.ceil(b.y+b.h));y++)out.fill(1,y*w+Math.max(0,Math.floor(b.x)),y*w+Math.min(w,Math.ceil(b.x+b.w)));return out;}
  function pixelIoU(a,b){let inter=0,union=0;for(let i=0;i<a.length;i++){inter+=a[i]&&b[i]?1:0;union+=a[i]||b[i]?1:0;}return union?inter/union:1;}
  function iou(a,b){const inter=Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));return inter/(a.w*a.h+b.w*b.h-inter);}
  const windowMask=classPixels('window'),windowTruth=components(windowMask),doorTruth=components(classPixels('door'));
  const windows=boxes.filter(b=>b.cls==='window'&&b.score>=0.25);
  const thresholds=[0.25,0.20,0.15,0.10].map(conf=>{const doors=boxes.filter(b=>b.cls==='door'&&b.score>=conf),used=new Set();let matched=0;for(const b of doors){let best=-1,score=0.5;doorTruth.forEach((t,j)=>{const v=iou(b,t);if(!used.has(j)&&v>=score){best=j;score=v;}});if(best>=0){used.add(best);matched++;}}return {conf,count:doors.length,matched:annotated?matched:null,unmatched:annotated?doors.length-matched:null,truth:annotated?doorTruth.length:null,boxes:doors};});
  let cv=null,ocr=null;const overlays={};
  if(!annotated){
    const {analyzeFloorplan,segmentsFromMask}=await import('/__cv.mjs');
    const rgba=canvas.getContext('2d').getImageData(0,0,w,h).data;
    const result=analyzeFloorplan(rgba,w,h);
    const {segmentWalls}=await import('/wall-onnx.js');
    const segStart=performance.now(),seg=await segmentWalls(canvas,{modelUrl:'/models/unet-int8.onnx'}),segMs=performance.now()-segStart;
    const modelLines=segmentsFromMask(seg.mask.map(c=>Number(c===1)),w,h);
    const differences=[];
    if(result)for(const key of ['hLines','vLines'])for(const line of result.lines[key]){
      for(let at=line.from;at<line.to;at+=5){const near=modelLines[key].filter(b=>at>=b.from&&at<=b.to);if(near.length)differences.push(Math.min(...near.map(b=>Math.abs(b.pos-line.pos))));}
    }
    differences.sort((a,b)=>a-b);
    cv=result?{ms:result.ms,walls:result.lines.hLines.length+result.lines.vLines.length,gaps:result.gaps.length,frame:result.frame,dimensions:result.dimensions,centerDifference:{samples:differences.length,mean:differences.reduce((s,v)=>s+v,0)/differences.length,p95:differences[Math.floor(differences.length*.95)],max:differences.at(-1)},segMs}:null;
    const ocrStart=performance.now();
    try{const mod=await import('/plan-ocr.js');const numbers=await mod.readPlanNumbers(canvas);ocr={ms:performance.now()-ocrStart,...numbers};}catch(error){ocr={ms:performance.now()-ocrStart,error:error.message};}
    // Evaluate task C's wall-distance proposal without changing production conf.
    // Only 46.03 has an independently readable physical scale in this fixture set.
    // Other images report pixel distances; no invented meters are used to filter.
    const measuredMpp=known46&&result?8.883/result.frame.w:null;
    function wallDistance(box){const cx=box.x+box.w/2,cy=box.y+box.h/2;let best=Infinity;const radius=measuredMpp ? 0.2/measuredMpp : 30;for(let yy=Math.max(0,Math.floor(cy-radius));yy<Math.min(h,Math.ceil(cy+radius));yy++)for(let xx=Math.max(0,Math.floor(cx-radius));xx<Math.min(w,Math.ceil(cx+radius));xx++)if(seg.mask[yy*w+xx]===1)best=Math.min(best,Math.hypot(xx-cx,yy-cy));return Number.isFinite(best)?best:null;}
    for(const t of thresholds){t.wallDistances=t.boxes.map(b=>({score:b.score,distancePx:wallDistance(b)}));t.wallFilteredCount=measuredMpp?t.wallDistances.filter(d=>d.distancePx!==null&&d.distancePx*measuredMpp<.2).length:null;}
    if(result){cv.scaleCrossCheck=known46?{source:'Manually read fixture dimensions: 8883 x 7348 mm; not OCR',widthMm:8883,heightMm:7348,widthMmPerPx:8883/result.frame.w,heightMmPerPx:7348/result.frame.h,relativeDifference:Math.abs(8883/result.frame.w/(7348/result.frame.h)-1)}:null;}
    for(const t of thresholds){const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');ctx.drawImage(canvas,0,0);ctx.lineWidth=2;ctx.font='15px sans-serif';t.boxes.forEach((b,i)=>{ctx.strokeStyle=b.score>=.25?'#1565ff':'#e05000';ctx.fillStyle=ctx.strokeStyle;ctx.strokeRect(b.x,b.y,b.w,b.h);ctx.fillText(`${i+1}: ${b.score.toFixed(2)}`,b.x+2,b.y-4);});overlays['doors-'+t.conf]=c.toDataURL();}
    const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');ctx.drawImage(canvas,0,0);
    const image=ctx.getImageData(0,0,w,h);for(let i=0;i<seg.mask.length;i++)if(seg.mask[i]===1){image.data[i*4]=255;image.data[i*4+1]*=.45;image.data[i*4+2]*=.45;}ctx.putImageData(image,0,0);
    if(result){ctx.strokeStyle='#005eff';ctx.lineWidth=2;for(const [key,isH] of [['hLines',true],['vLines',false]])for(const b of result.lines[key]){ctx.beginPath();ctx.moveTo(isH?b.from:b.pos,isH?b.pos:b.from);ctx.lineTo(isH?b.to:b.pos,isH?b.pos:b.to);ctx.stroke();}}
    overlays['cv-v22']=c.toDataURL();
    const {selectOpenings}=await import('/opening-detection.js');
    const {roomsFromPolygons,homePlanSVG}=await import('/home-domain.js');
    const {roomsFromMask}=await import('/room-polygon.js');
    const {wallLinesFromMask}=await import('/wall-onnx.js');
    const {buildHomeGeometry}=await import('/home-scene.js');
    const THREE=await import('/vendor/three.module.js');
    const polygons=roomsFromMask(seg.mask,w,h);
    let x0=w,y0=h,x1=0,y1=0;
    for(let i=0;i<seg.mask.length;i++)if(seg.mask[i]!==4){x0=Math.min(x0,i%w);y0=Math.min(y0,Math.floor(i/w));x1=Math.max(x1,i%w);y1=Math.max(y1,Math.floor(i/w));}
    const frame={x:x0,y:y0,w:x1-x0,h:y1-y0},mpp=measuredMpp||.02,W=frame.w*mpp,D=frame.h*mpp;
    const minLength=Math.max(18,Math.round(Math.max(w,h)*.03));
    const wallLines=wallLinesFromMask(seg.mask,w,h,{minLenH:minLength,minLenV:minLength,gap:8});
    const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(800,680);renderer.setPixelRatio(1);
    const comparison=[];const pairs={source:[],plan:[],scene:[]};
    for(const windowSource of ['segmentation','yolo']){
      const openings=selectOpenings(boxes.filter(b=>b.score>=.25),seg.mask,w,h,{windowSource});
      const home=roomsFromPolygons(polygons,w,h,W,D,{frame,doors:openings.doors,windows:openings.windows,walls:wallLines,height:2.7});
      comparison.push({requestedSource:windowSource,usedSource:openings.windowSource,count:openings.windows.length,totalBoxArea:openings.windows.reduce((s,b)=>s+b.w*b.h,0)});
      const source=document.createElement('canvas');source.width=w;source.height=h;const ctx=source.getContext('2d');ctx.drawImage(canvas,0,0);ctx.lineWidth=2;ctx.strokeStyle='#00b050';ctx.fillStyle='rgba(0,176,80,.2)';for(const b of openings.windows){ctx.fillRect(b.x,b.y,b.w,b.h);ctx.strokeRect(b.x,b.y,b.w,b.h);}pairs.source.push(source);
      const svg=new Image();svg.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(homePlanSVG(home));await svg.decode();pairs.plan.push(svg);
      const scene=new THREE.Scene();scene.background=new THREE.Color('#202830');scene.add(new THREE.HemisphereLight('#ffffff','#707070',2));const light=new THREE.DirectionalLight('#ffffff',2.5);light.position.set(5,12,8);scene.add(light);const group=buildHomeGeometry(home,false);scene.add(group);
      const span=Math.max(W,D),camera=new THREE.PerspectiveCamera(40,800/680,.1,200);camera.position.set(span*.95,span*1.3,span*1.25);camera.lookAt(0,.5,0);renderer.render(scene,camera);
      const shot=document.createElement('canvas');shot.width=800;shot.height=680;shot.getContext('2d').drawImage(renderer.domElement,0,0);pairs.scene.push(shot);
      group.traverse(o=>{o.geometry?.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material?.dispose();});
    }
    renderer.dispose();renderer.forceContextLoss();
    for(const [key,imgs] of Object.entries(pairs)){const pair=document.createElement('canvas');pair.width=1600;pair.height=730;const ctx=pair.getContext('2d');ctx.fillStyle='#202830';ctx.fillRect(0,0,1600,730);ctx.fillStyle='#ffffff';ctx.font='22px sans-serif';ctx.fillText(`Segmentation windows (${comparison[0].count})`,20,32);ctx.fillText(`YOLO windows (${comparison[1].count})`,820,32);imgs.forEach((img,i)=>{const scale=Math.min(780/img.width,670/img.height);ctx.drawImage(img,i*800+(800-img.width*scale)/2,50,img.width*scale,img.height*scale);});overlays['windows-'+key]=pair.toDataURL();}
    cv.windowComparison=comparison;
  }
  return {width:w,height:h,ms:Math.round(ms),windowCount:windows.length,windowTruth:annotated?windowTruth.length:null,windowPixelIoU:annotated?pixelIoU(raster(windows),windowMask):null,windowBoxIoU:annotated?pixelIoU(raster(windows),raster(windowTruth)):null,windows,thresholds,cv,ocr,overlays};
}
