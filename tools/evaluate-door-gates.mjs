// 真实浏览器逐张评估；物理尺寸沿用生产自动比例尺，不从标注门宽反推一个有利于闸值的“真值”。
import {createServer} from 'node:http';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve,basename,extname} from 'node:path';
import {existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';

const [imageDir,maskDir]=process.argv.slice(2),root=resolve(import.meta.dirname,'..');
if(!imageDir||!maskDir)throw Error('Usage: node tools/evaluate-door-gates.mjs <44 clean images> <44 clean masks>');
const names=(await readdir(imageDir)).filter(n=>/\.(jpe?g|png)$/i.test(n)).sort(),maskNames=await readdir(maskDir);
if(names.length!==44)throw Error('Expected 44 images, found '+names.length);
const candidateModel=process.env.DOMIRA_DOOR_MODEL_OVERRIDE&&resolve(process.env.DOMIRA_DOOR_MODEL_OVERRIDE);
const frozenWindowModel=process.env.DOMIRA_FROZEN_WINDOW_MODEL?resolve(process.env.DOMIRA_FROZEN_WINDOW_MODEL):resolve(root,'public/models/yolo-doors-int8.onnx');
const hash=b=>createHash('sha256').update(b).digest('hex');
const samples=[];
for(const name of names){const stem=basename(name,extname(name)),mask=maskNames.find(n=>n===stem+'-clean-mask.png');if(!mask)throw Error('Missing original clean annotation for '+name);const image=resolve(imageDir,name),annotation=resolve(maskDir,mask);samples.push({name,image,mask:annotation,imageSha256:hash(await readFile(image)),maskSha256:hash(await readFile(annotation))});}
const baseline=JSON.parse(await readFile(resolve(root,'docs/evaluations/2026-11-19/openings-summary.json'),'utf8'));
const baselineRows=(await readFile(resolve(root,'docs/evaluations/2026-11-19/openings-per-image.csv'),'utf8')).trim().split(/\r?\n/).slice(1).map(line=>line.split(',').slice(0,3));
const baselineDatasetMatches=samples.every(s=>baselineRows.some(([name,imageHash,maskHash])=>name===s.name&&imageHash===s.imageSha256&&maskHash===s.maskSha256));
const modelHashes=Object.fromEntries(await Promise.all(['yolo-doors-int8.onnx','yolo-windows-int8.onnx','unet-int8.onnx'].map(async n=>[n,hash(await readFile(n==='yolo-windows-int8.onnx'?frozenWindowModel:n==='yolo-doors-int8.onnx'&&candidateModel?candidateModel:resolve(root,'public/models',n)))])));
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/runner.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Door gate evaluation</title>');return;}
 const match=url.pathname.match(/^\/sample\/(\d+)\/(image|mask)$/),file=match?samples[Number(match[1])]?.[match[2]]:resolve(root,'public','.'+url.pathname);
 if(!file||(!match&&!file.startsWith(resolve(root,'public')+'/')&&!file.startsWith(resolve(root,'public')+'\\')))throw Error('Invalid sample path');
 const served=candidateModel?(url.pathname==='/models/yolo-doors-int8.onnx'?candidateModel:url.pathname==='/models/yolo-windows-int8.onnx'?frozenWindowModel:url.pathname==='/door-detect.js'?resolve(root,'tools/candidate-door-detect.js'):file):file;
 res.setHeader('Content-Type',extname(file)==='.js'?'text/javascript':extname(file)==='.png'?'image/png':'application/octet-stream');res.end(await readFile(served));
}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);if(!chrome)throw Error('Chrome not found');
const port=Number(process.env.DOMIRA_CDP_PORT||9348),out=resolve(root,process.env.DOMIRA_DOOR_EVAL_OUT||'.screenshots/door-gate-evaluation');await mkdir(out,{recursive:true});
const proc=spawn(chrome,['--headless=new','--disable-gpu','--enable-unsafe-swiftshader','--no-sandbox','--remote-debugging-port='+port,'--user-data-dir='+resolve(tmpdir(),'domira-door-gates-'+port),'about:blank'],{stdio:'ignore',windowsHide:true});let ws;
try{
 let page;for(let i=0;i<80;i++){try{page=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');}catch{}if(page)break;await new Promise(r=>setTimeout(r,250));}if(!page)throw Error('Browser startup timed out');
 ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});let serial=0;const pending=new Map();
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 await send('Page.enable');await send('Page.navigate',{url:base+'/runner.html'});await new Promise(r=>setTimeout(r,1000));
 const rows=[];
 for(let index=0;index<samples.length;index++){
  const r=await send('Runtime.evaluate',{expression:`(${evaluate.toString()})(${index})`,awaitPromise:true,returnByValue:true,timeout:180000});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));
  const row={name:samples[index].name,imageSha256:samples[index].imageSha256,maskSha256:samples[index].maskSha256,...r.result.value};rows.push(row);
  await writeFile(resolve(out,'rows-progress.json'),JSON.stringify(rows,null,2));
  console.log(JSON.stringify({index:index+1,name:row.name,ms:row.ms,truth:row.truth.length,raw:row.raw.matched,scoreOnly:row.scoreOnly.matched,afterGate:row.afterGate.matched,scale:row.scale?.source,error:row.error||null}));
 }
 const total=key=>{const truth=rows.reduce((n,r)=>n+r.truth.length,0),matched=rows.reduce((n,r)=>n+r[key].matched,0),count=rows.reduce((n,r)=>n+r[key].count,0);return {truth,matched,count,recall:matched/truth,precision:count?matched/count:1};};
 const report={date:new Date().toISOString(),annotated:rows.length,modelHashes,baselineModelHashes:baseline.modelHashes,baselineDatasetMatches,referenceRecall:284/308,incumbentRecall:259/308,requiredRecall:.8409,
  definitions:{matching:'原始clean-masks-44蓝色门类的4连通域外接框，预测按score排序，IoU>=0.5一对一匹配；与92.21%记录相同口径。',physicalScale:'生产geometryFromSegmentation + readPlanNumbers + estimateScale，W/D取到0.01m；这是自动估计尺度，并非44张逐张人工实测尺度。',raw:'当前生产YOLO conf0.25原始门框',scoreOnly:'仅score>=0.30，无物理尺寸筛选',selected:'已由既有门窗来源逻辑选用但未加本轮尺寸闸',afterGate:'现役be9ec15规则保持：平开0.45–1.2m/推拉1.2–3m，厚0.10–0.40m，score>=0.30，门洞去重；窗由冻结6f257e8模型提供',unscalable:'自动尺度不可用时计入失败并记录，未臆造物理尺寸'},
  raw:total('raw'),scoreOnly:total('scoreOnly'),selected:total('selected'),afterGate:total('afterGate'),unscalable:rows.filter(r=>r.error).map(r=>({name:r.name,error:r.error})),rows};
 report.gatePassed=report.afterGate.recall>=.8409;
 await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log('REPORT '+JSON.stringify({datasetMatches:baselineDatasetMatches,raw:report.raw,scoreOnly:report.scoreOnly,afterGate:report.afterGate,gatePassed:report.gatePassed}));
}finally{ws?.close();proc.kill();server.closeAllConnections();server.close();}

async function evaluate(index){
 const {detectDoors}=await import('/door-detect.js'),{segmentWalls}=await import('/wall-onnx.js'),{geometryFromSegmentation}=await import('/floorplan-geometry.js'),{readPlanNumbers,estimateScale}=await import('/plan-ocr.js'),{doorsToHome}=await import('/opening-detection.js');
 const start=performance.now();
 const image=new Image();image.src=`/sample/${index}/image`;await image.decode();const canvas=document.createElement('canvas'),factor=Math.min(1,1200/Math.max(image.width,image.height));canvas.width=Math.round(image.width*factor);canvas.height=Math.round(image.height*factor);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
 const annotation=new Image();annotation.src=`/sample/${index}/mask`;await annotation.decode();if(annotation.width!==image.width||annotation.height!==image.height)throw Error('Annotation size mismatch');
 const truthCanvas=document.createElement('canvas');truthCanvas.width=annotation.width;truthCanvas.height=annotation.height;const ctx=truthCanvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(annotation,0,0);const rgba=ctx.getImageData(0,0,annotation.width,annotation.height).data,w=annotation.width,h=annotation.height,n=w*h,seen=new Uint8Array(n),queue=new Int32Array(n),truth=[];
 const blue=p=>rgba[p*4+2]>180&&rgba[p*4]<120&&rgba[p*4+1]<180;
 for(let p=0;p<n;p++){if(seen[p]||!blue(p))continue;let head=0,tail=1,x0=w,y0=h,x1=0,y1=0;seen[p]=1;queue[0]=p;while(head<tail){const q=queue[head++],x=q%w,y=Math.floor(q/w);x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);for(const r of [x>0?q-1:-1,x+1<w?q+1:-1,y>0?q-w:-1,y+1<h?q+w:-1])if(r>=0&&!seen[r]&&blue(r)){seen[r]=1;queue[tail++]=r;}}truth.push({x:x0*canvas.width/w,y:y0*canvas.height/h,w:(x1-x0+1)*canvas.width/w,h:(y1-y0+1)*canvas.height/h});}
 const boxes=await detectDoors(canvas,{modelUrl:'/models/yolo-doors-int8.onnx',conf:.25}),rawDoors=boxes.filter(b=>b.cls==='door');
 function match(boxes){const used=new Set(),pairs=[];for(const [index,b] of [...boxes].sort((a,b)=>(b.score||0)-(a.score||0)).entries()){let at=-1,best=.5;truth.forEach((t,i)=>{const inter=Math.max(0,Math.min(b.x+b.w,t.x+t.w)-Math.max(b.x,t.x))*Math.max(0,Math.min(b.y+b.h,t.y+t.h)-Math.max(b.y,t.y)),iou=inter/(b.w*b.h+t.w*t.h-inter);if(!used.has(i)&&iou>=best){at=i;best=iou;}});if(at>=0){used.add(at);pairs.push({prediction:index,truthIndex:at,iou:best});}}return {count:boxes.length,matched:pairs.length,truthIndices:[...used],pairs};}
 const raw=match(rawDoors),scoreOnly=match(rawDoors.filter(b=>b.score>=.3));
 let scale=null,frame=null,dimensions=null,selection=[],checks=[],kept=[],error=null,ocr=null;
 try{
  const seg=await segmentWalls(canvas,{modelUrl:'/models/unet-int8.onnx'}),predicted=geometryFromSegmentation(seg,boxes);frame=predicted.frame;selection=predicted.doors;
  if(!frame?.w||!frame?.h||!predicted.polygons.length)throw Error('生产识别没有可用的房屋外框/房间');
  try{ocr=await readPlanNumbers(canvas);}catch(e){ocr={areas:[],error:e.message};}
  scale=estimateScale({totalPixelArea:predicted.polygons.reduce((n,p)=>n+(Number(p.area)||0),0),frameSpanPx:Math.max(frame.w,frame.h),areas:ocr.areas,doors:predicted.doors,assumedMeters:.02});
  const mpp=scale.metersPerPixel>0?scale.metersPerPixel:.02,W=Math.round(frame.w*mpp*100)/100,D=Math.round(frame.h*mpp*100)/100;dimensions={width:W,depth:D};
  const gated=doorsToHome(predicted.doors,frame,W,D);checks=gated.checks;kept=checks.filter(c=>c.valid).map(c=>predicted.doors[c.index]);
 }catch(e){error=e.message;}
 const selected=match(selection),afterGate=match(kept),lostTruth=raw.truthIndices.filter(i=>!afterGate.truthIndices.includes(i));
 const iou=(a,b)=>{const inter=Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));return inter/(a.w*a.h+b.w*b.h-inter);};
 return {width:canvas.width,height:canvas.height,ms:performance.now()-start,truth,raw,scoreOnly,selected,afterGate,rawDoors,selectedDoors:selection,checks,scale,dimensions,ocr:ocr&&{areas:ocr.areas,lengths:ocr.lengths,error:ocr.error},frame,error,lostTruth:lostTruth.map(i=>({index:i,box:truth[i],stage:selected.truthIndices.includes(i)?'metric-gate':'existing-selection',rejected:checks.filter(c=>!c.valid&&iou(c.box,truth[i])>=.5).map(c=>({index:c.index,box:c.box,score:c.score,longSide:c.longSide,shortSide:c.shortSide,reasons:c.reasons}))}))};
}
