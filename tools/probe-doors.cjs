#!/usr/bin/env node
// Run all supplied images through the actual browser model and geometric detector.
// Start node scripts/dev.mjs first. Outputs JSON and numbered PNG overlays.
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const base=(process.env.DOMIRA_PROBE_URL||'http://127.0.0.1:3000').replace(/\/$/,'');
const inputs=process.argv.slice(2);
const output=path.resolve(process.env.DOMIRA_PROBE_OUTPUT||'.screenshots/door-gaps');
const port=Number(process.env.DOMIRA_CDP_PORT||9338);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
  if(!inputs.length) throw Error('Usage: node tools/probe-doors.cjs <image> [image ...]');
  for(const file of inputs) if(!fs.existsSync(file)) throw Error('Missing image: '+file);
  fs.mkdirSync(output,{recursive:true});
  const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
  if(!chrome) throw Error('Chrome / Edge not found');
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'domira-door-probe-'));
  const staged=path.resolve('public','__door-probe-'+process.pid+'.jpg');
  let ws,proc;
  const pending=new Map();
  try{
    proc=spawn(chrome,['--headless=new','--disable-gpu','--no-sandbox','--enable-unsafe-swiftshader','--remote-debugging-port='+port,'--user-data-dir='+profile,'about:blank'],{stdio:'ignore',windowsHide:true});
    proc.on('error',e=>console.error(e.message));
    let targets;
    for(let i=0;i<60;i++){
      await sleep(200);
      try{targets=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();if(targets.some(t=>t.type==='page')) break;}catch{}
    }
    const page=targets?.find(t=>t.type==='page');
    if(!page) throw Error('DevTools startup failed');
    ws=new WebSocket(page.webSocketDebuggerUrl);
    ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}});
    await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
    let id=0;
    const send=(method,params={})=>new Promise((resolve,reject)=>{
      const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error('CDP timeout: '+method));},180000);
      pending.set(key,m=>{clearTimeout(timer);m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result);});
      ws.send(JSON.stringify({id:key,method,params}));
    });
    await send('Page.enable');await send('Page.navigate',{url:base});
    await sleep(2500);
    const results=[];
    for(const file of inputs){
      fs.copyFileSync(file,staged);
      const expression=`(async()=>{
        const image=await createImageBitmap(await (await fetch(${JSON.stringify('/'+path.basename(staged))}+'?t='+Date.now())).blob());
        const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
        const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
        const model=await import('/wall-onnx.js');
        const session=await model.loadWallModel('/models/unet-int8.onnx');
        const seg=await model.segmentWalls(canvas,{session});
        const {doorsFromWallGaps,doorsFromMask}=await import('/room-polygon.js');
        const t=performance.now();const doors=doorsFromWallGaps(seg.mask,seg.width,seg.height);
        const ms=Math.round(performance.now()-t);
        ctx.lineWidth=3;ctx.font='bold 18px sans-serif';
        doors.forEach((d,i)=>{ctx.strokeStyle='#ff0033';ctx.strokeRect(d.x,d.y,d.w,d.h);ctx.fillStyle='#ff0033';ctx.fillText(String(i+1),d.x,d.y-5);});
        const overlay=canvas.toDataURL('image/png');
        const maskCanvas=document.createElement('canvas');maskCanvas.width=seg.width;maskCanvas.height=seg.height;
        const mc=maskCanvas.getContext('2d'),pixels=mc.createImageData(seg.width,seg.height);
        const colors=[[238,238,238],[25,25,25],[0,180,80],[80,160,255],[255,255,255]];
        for(let i=0;i<seg.mask.length;i++){pixels.data.set([...colors[seg.mask[i]],255],i*4);}mc.putImageData(pixels,0,0);
        mc.putImageData(pixels,0,0);mc.strokeStyle='#ff0033';mc.fillStyle='#ff0033';mc.lineWidth=3;mc.font='bold 18px sans-serif';
        doors.forEach((d,i)=>{mc.strokeRect(d.x,d.y,d.w,d.h);mc.fillText(String(i+1),d.x,d.y-5);});
        return {size:[seg.width,seg.height],count:doors.length,learnedCount:doorsFromMask(seg.mask,seg.width,seg.height).length,ms,doors,overlay,maskOverlay:maskCanvas.toDataURL('image/png')};
      })()`;
      const response=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
      if(response.exceptionDetails) throw Error(JSON.stringify(response.exceptionDetails));
      const r=response.result.value;
      const stem=path.basename(file,path.extname(file));
      for(const key of ['overlay','maskOverlay']){fs.writeFileSync(path.join(output,stem+'-'+key+'.png'),Buffer.from(r[key].split(',')[1],'base64'));delete r[key];}
      r.file=path.resolve(file);results.push(r);console.log(JSON.stringify(r,null,2));
    }
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2)+'\n');
  }finally{
    ws?.close();proc?.kill();
    if(fs.existsSync(staged)) fs.unlinkSync(staged);
    // Remove only the unique temporary browser profile created above.
    await sleep(500);
    if(path.dirname(path.resolve(profile))!==path.resolve(os.tmpdir()) || !path.basename(profile).startsWith('domira-door-probe-')) throw Error('Unexpected profile cleanup path');
    fs.rmSync(profile,{recursive:true,force:true,maxRetries:4,retryDelay:250});
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});

