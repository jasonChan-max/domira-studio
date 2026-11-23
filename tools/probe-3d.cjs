#!/usr/bin/env node
// 同图、同识别数据、同相机比较墙块与轮廓，避免把模型变化误当作几何修复效果。
const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=path.resolve(__dirname,'..'),input=process.argv[2],base=(process.env.DOMIRA_PROBE_URL||'http://127.0.0.1:3000').replace(/\/$/,'');
const port=Number(process.env.DOMIRA_CDP_PORT||9342),out=path.resolve(root,process.env.DOMIRA_PROBE_OUT||'.screenshots/wall-repair'),staged=path.join(root,'public/__probe3d-input.jpg');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 if(!input||!fs.existsSync(input))throw Error('用法：node tools/probe-3d.cjs <原图>');
 const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);if(!chrome)throw Error('未找到 Chrome/Edge');
 fs.mkdirSync(out,{recursive:true});fs.copyFileSync(input,staged);
 const proc=spawn(chrome,['--headless=new','--disable-gpu','--no-sandbox','--enable-unsafe-swiftshader',`--remote-debugging-port=${port}`,`--user-data-dir=${path.join(os.tmpdir(),'domira-wall-repair-probe')}`,'about:blank'],{stdio:'ignore',windowsHide:true});let ws;
 try{
  let page;for(let i=0;i<80;i++){try{page=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');}catch{}if(page)break;await pause(250);}if(!page)throw Error('浏览器启动失败');
  ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});let serial=0;const pending=new Map();
  ws.addEventListener('message',event=>{const m=JSON.parse(event.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  await send('Page.enable');await send('Page.navigate',{url:base+'/studio.html'});await pause(1000);
  const saved=path.join(out,'blocks-fixed-scene.js'),baseline=fs.existsSync(saved)?'data:text/javascript;base64,'+Buffer.from(fs.readFileSync(saved,'utf8').replace(/from (['"])\.\/([^'"]+)\1/g,(_,q,file)=>`from '${base}/${file}'`)).toString('base64'):null;
  const r=await send('Runtime.evaluate',{expression:`(${probeInBrowser.toString()})(${JSON.stringify(baseline)},${process.env.DOMIRA_EXPORT_DATA==='1'},${Number(process.env.DOMIRA_KNOWN_WIDTH)||10})`,awaitPromise:true,returnByValue:true,timeout:180000});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));
  if(r.result.value.exportData){const data=r.result.value.exportData;fs.writeFileSync(path.join(out,'raw-mask.bin'),Buffer.from(data.mask,'base64'));delete data.mask;fs.writeFileSync(path.join(out,'raw-data.json'),JSON.stringify(data,null,2));console.log(JSON.stringify({exported:out,...data}));return;}
  const report=r.result.value;for(const [name,url] of Object.entries(report.images))fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(url.split(',')[1],'base64'));fs.writeFileSync(path.join(out,'plan-2d.svg'),report.svg);delete report.images;delete report.svg;
  fs.writeFileSync(path.join(out,'probe-3d.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
 }finally{ws?.close();proc.kill();fs.unlinkSync(staged);}
}
async function probeInBrowser(baselineURL,exportData=false,knownWidth=10){
 const onnx=await import('/wall-onnx.js'),poly=await import('/room-polygon.js'),dom=await import('/home-domain.js');
 const {signedArea,pointInRing}=await import('/wall-contours.js'),{detectDoors}=await import('/door-detect.js');
 const {geometryFromSegmentation,homeFromRecognition}=await import('/floorplan-geometry.js');
 const sceneModule=await import('/home-scene.js'),THREE=await import('/vendor/three.module.js');
 const img=new Image();img.src='/__probe3d-input.jpg?t='+Date.now();await img.decode();const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;canvas.getContext('2d').drawImage(img,0,0);
 const t=performance.now(),seg=await onnx.segmentWalls(canvas,{modelUrl:'/models/unet-int8.onnx'}),segMs=performance.now()-t,min=Math.max(18,Math.round(Math.max(seg.width,seg.height)*.03));
 const boxes=await detectDoors(canvas,{modelUrl:'/models/yolo-doors-int8.onnx'});
 if(exportData){let encoded='';for(let i=0;i<seg.mask.length;i+=8192)encoded+=String.fromCharCode(...seg.mask.subarray(i,i+8192));return {exportData:{width:seg.width,height:seg.height,mask:btoa(encoded),boxes,stats:seg.stats}};}
 const traceStart=performance.now(),recognized=geometryFromSegmentation(seg,boxes),geometryMs=performance.now()-traceStart;
 const original=geometryFromSegmentation(seg,boxes,{orthogonalize:false,mergeCollinear:false,filterSmallContours:false});
 const {frame}=recognized,{contours}=recognized.lines,width=knownWidth,depth=width*frame.h/frame.w;
 // JSON 往返模拟项目保存；只测内存中的对象会漏掉窗字段在保存链上的丢失。
 const home=JSON.parse(JSON.stringify(homeFromRecognition(recognized,width,depth,{height:2.7})));
 dom.validateHome(home);
 const roomAudit=home.rooms.map(r=>{const points=r.polygon.map(([x,z])=>[r.x+x,r.z+z]),xs=points.map(p=>p[0]),zs=points.map(p=>p[1]);return {name:r.name,bounds:{x0:Math.min(...xs),x1:Math.max(...xs),z0:Math.min(...zs),z1:Math.max(...zs)},withinHouse:points.every(([x,z])=>Math.abs(x)<=home.width/2+.03&&Math.abs(z)<=home.depth/2+.03)};});
 const median=a=>[...a].sort((x,y)=>x-y)[Math.floor(a.length/2)],release=g=>g.traverse(o=>o.geometry?.dispose());
 function benchmarkBuild(build){const times=[];let geometry;for(let i=0;i<10;i++){const start=performance.now(),g=build(home,false);if(i>=3)times.push(performance.now()-start);if(i===9)geometry=g;else release(g);}return {ms:median(times),samples:times,geometry};}
 const current=benchmarkBuild(sceneModule.buildHomeGeometry),baseline=baselineURL?benchmarkBuild((await import(baselineURL)).buildHomeGeometry):null;
 const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(900,700);renderer.setPixelRatio(1);const camera=new THREE.PerspectiveCamera(40,900/700,.1,100);camera.position.set(width,Math.max(width,depth)*1.3,depth*1.3);camera.lookAt(0,.6,0);
 function measureRender(geometry){const scene=new THREE.Scene();scene.background=new THREE.Color('#202830');scene.add(new THREE.HemisphereLight('#ffffff','#707070',2));const light=new THREE.DirectionalLight('#ffffff',2.5);light.position.set(5,12,8);scene.add(light);scene.add(geometry);const gl=renderer.getContext();for(let i=0;i<5;i++){renderer.render(scene,camera);gl.finish();}const times=[];for(let i=0;i<12;i++){const start=performance.now();renderer.render(scene,camera);gl.finish();times.push(performance.now()-start);}return {ms:median(times),samples:times,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,image:renderer.domElement.toDataURL()};}
 const currentRender=measureRender(current.geometry),baselineRender=baseline?measureRender(baseline.geometry):null;
 const count=(g,predicate)=>{let n=0;g.traverse(o=>{if(predicate(o))n++;});return n;};
 current.geometry.updateMatrixWorld(true);
 const doorMeshes=current.geometry.children.filter(m=>m.userData.door);
 const doorHeightAudit={configuredHeight:2.05,meshCount:doorMeshes.length,heights:doorMeshes.map(m=>{m.geometry.computeBoundingBox();return m.geometry.boundingBox.max.y-m.geometry.boundingBox.min.y;}),changed:false};
 const doorAudit={...home.selection?.doors,maxWidth:Math.max(...home.doors.map(d=>Math.max(d.w,d.d))),minThickness:Math.min(...home.doors.map(d=>Math.min(d.w,d.d))),maxThickness:Math.max(...home.doors.map(d=>Math.min(d.w,d.d))),height:doorHeightAudit};
 const solidWalls=current.geometry.children.filter(m=>m.userData.wall);
 const glassMeshes=current.geometry.children.filter(m=>m.userData.window);
 const {windowPanels,rectangleRing}=await import('/bay-window.js'),{default:clipping}=await import('/vendor/polygon-clipping.js');
 const auditPanel=p=>{
  const f=p.wallFootprint,hits=(meshes,y,offset)=>{
   const along=p.horizontal?p.x+p.w*offset:p.z+p.d*offset;
   const origin=p.horizontal?new THREE.Vector3(along,y,f.y0-.05):new THREE.Vector3(f.x0-.05,y,along),direction=p.horizontal?new THREE.Vector3(0,0,1):new THREE.Vector3(1,0,0),far=(p.horizontal?f.y1-f.y0:f.x1-f.x0)+.1;
   return new THREE.Raycaster(origin,direction,0,far).intersectObjects(meshes).length>0;
  };
  return [-.25,0,.25].map(offset=>({offset,lowerWall:hits(solidWalls,.4,offset),openingClear:!hits(solidWalls,1.5,offset),upperWall:hits(solidWalls,2.4,offset),glassPresent:hits(glassMeshes,1.5,offset)}));
 };
 const windowAudit=home.windows.map((w,index)=>{
  const f=w.wallFootprint,support=recognized.windows[index].wallSupport;
  if(!f)return {index,valid:false,reason:'缺少经过墙体支持验证的洞口'};
  const samples=auditPanel(w),panels=windowPanels(w).map(p=>({horizontal:p.horizontal,wallFootprint:p.wallFootprint,samples:auditPanel(p)}));
  const onExteriorWall=!!support?.valid&&support.endA&&support.endB;
  const glassLength=w.horizontal?w.w:w.d,footprintLength=w.horizontal?f.x1-f.x0:f.y1-f.y0;
  const centerDelta=w.horizontal?(f.x0+f.x1)/2-w.x:(f.y0+f.y1)/2-w.z;
  return {index,x:w.x,z:w.z,onExteriorWall,kind:w.bay?'bay':'flat',wallFootprint:f,glassLength,footprintLength,alongLengthDelta:footprintLength-glassLength,alongCenterDelta:centerDelta,samples,panels,valid:onExteriorWall&&panels.every(p=>p.samples.every(s=>s.lowerWall&&s.openingClear&&s.upperWall&&s.glassPresent))};
 });
 const windowMeshCount=count(current.geometry,o=>o.userData.window);
 const windowsAllValid=windowMeshCount===home.windows.length&&windowAudit.every(w=>w.valid);
 const bayWindows=home.windows.flatMap((w,index)=>w.bay?[{index,x:w.x,z:w.z,frontLength:w.horizontal?w.w:w.d,totalGlassLength:w.bay.panels.reduce((n,p)=>n+(p.horizontal?p.w:p.d),0),side:w.bay.side,panels:w.bay.panels,seatFootprint:w.bay.seatFootprint,sourceBox:recognized.windows[index].sourceBox}]:[]);
 const bayFloorAudit=bayWindows.map(b=>({index:b.index,overlaps:home.rooms.map(r=>{
  const global=r.polygon.map(([x,z])=>[r.x+x,r.z+z]),intersection=clipping.intersection([global],[rectangleRing(b.seatFootprint)]);
  return {room:r.name,area:intersection.reduce((n,p)=>n+Math.abs(signedArea(p[0]))-p.slice(1).reduce((n,h)=>n+Math.abs(signedArea(h)),0),0)};
 })}));
 const noExposedBayFloors=bayFloorAudit.every(b=>b.overlaps.every(r=>r.area<.005));
 const thickness=home.walls.blocks.map(b=>Math.min(b.x1-b.x0,b.y1-b.y0)).sort((a,b)=>a-b);
 let tp=0,fp=0,fn=0;for(let y=0;y<seg.height;y++)for(let x=0;x<seg.width;x++){const p=[x+.5,y+.5],predicted=contours.some(s=>pointInRing(p,s.outer)&&!s.holes.some(h=>pointInRing(p,h))),actual=seg.mask[y*seg.width+x]===1;if(predicted&&actual)tp++;else if(predicted)fp++;else if(actual)fn++;}
 const images={'contours-3d':currentRender.image};if(baselineRender)images['blocks-3d']=baselineRender.image;
 const svg=dom.homePlanSVG(home),svgImg=new Image();svgImg.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);await svgImg.decode();const sc=document.createElement('canvas');sc.width=svgImg.width;sc.height=svgImg.height;sc.getContext('2d').drawImage(svgImg,0,0);images['plan-2d']=sc.toDataURL();
 const pair=document.createElement('canvas');pair.width=1800;pair.height=1000;const ctx=pair.getContext('2d');ctx.fillStyle='#202830';ctx.fillRect(0,0,1800,1000);ctx.fillStyle='#ffffff';ctx.font='24px sans-serif';ctx.fillText('Original',20,35);ctx.fillText('Contour plan',920,35);for(const [i,image] of [img,svgImg].entries()){const scale=Math.min(880/image.width,940/image.height);ctx.drawImage(image,i*900+(900-image.width*scale)/2,50,image.width*scale,image.height*scale);}images['plan-original-comparison']=pair.toDataURL();
 renderer.dispose();renderer.forceContextLoss();
 // 直接操作真实上传控件和建房按钮，避免共享函数的测试掩盖页面漏传 windows 的问题。
 const {createHomeStudio}=await import('/home-studio.js');let created;
 const modal=document.querySelector('#modal');
 const studio=createHomeStudio({modal:(title,content)=>{modal.querySelector('#modal-body').innerHTML=content;if(!modal.open)modal.showModal();},setCleanup:()=>{},createHome:(name,home)=>{created=JSON.parse(JSON.stringify(home));},notify:()=>{}});
 await studio.open();
 const file=new File([await(await fetch('/__probe3d-input.jpg')).blob()],'probe.jpg',{type:'image/jpeg'}),transfer=new DataTransfer();transfer.items.add(file);
 const input=document.querySelector('#floorplan-file');input.files=transfer.files;await input.onchange({target:input});
 document.querySelector('#floorplan-known-width').value=String(knownWidth);
 await document.querySelector('#floorplan-model-only').onclick();
 const svgWindowCount=document.querySelectorAll('#floorplan-preview [data-opening="window"]').length;
 document.querySelector('#floorplan-confirm').checked=true;document.querySelector('#floorplan-build').onclick();
 const initialBuildError=document.querySelector('#floorplan-error').textContent;
 const initialRooms=created?.rooms.length,initialWidth=created?.width;
 const newWidth=document.querySelector('#home-width');newWidth.value='12';newWidth.onchange();
 document.querySelector('#floorplan-build').onclick();
 const resizedBuildError=document.querySelector('#floorplan-error').textContent;
 const reviewedRooms=[];
 // 本轮必须数据层直接产出可建房的房间，不能再让探针代替用户删掉失败候选。
 if(initialBuildError)throw Error('未经人工删除的页面保存失败：'+initialBuildError);
 if(resizedBuildError)throw Error('修改长宽后的页面保存失败：'+resizedBuildError);
 if(!created)throw Error('页面建房失败：'+document.querySelector('#floorplan-error').textContent+' '+document.querySelector('#floorplan-model-status').textContent+' '+JSON.stringify(Array.from(document.querySelectorAll('[data-home-field]')).map(e=>({room:e.dataset.roomIndex,key:e.dataset.homeField,value:e.value}))));
 if(Math.abs(created.width-12)>1e-6)throw Error('页面长宽修改没有保存');
 if(created.rooms.length!==home.rooms.length)throw Error('原始图与上传后的房间数量不一致');
 const uiFlow={initialBuildError,resizedBuildError,initialRooms,initialWidth,reviewedRooms,doors:created.doors.length,rooms:created.rooms.length,windows:created.windows.length,windowSource:created.windowSource,svgWindowCount,windowsMatchData:created.windows.length===home.windows.length,svgWindowsMatchData:svgWindowCount===created.windows.length,savedContours:created.walls.contours.length,savedWidth:created.width,savedBayWindows:created.windows.filter(w=>w.bay).map(w=>({x:w.x,z:w.z,panels:w.bay.panels,seatFootprint:w.bay.seatFootprint}))};
 studio.stop();
 const metrics=(build,render)=>({buildMs:build.ms,buildSamples:build.samples,frameMs:render.ms,frameSamples:render.samples,meshCount:count(build.geometry,o=>o.isMesh),wallMeshes:count(build.geometry,o=>o.userData.wall),drawCalls:render.drawCalls,triangles:render.triangles});
 const stepStats=rings=>{const lens=[];for(const ring of rings){const n=ring.length;for(let i=0;i<n;i++){const a=ring[i],b=ring[(i+1)%n],l=Math.hypot(b[0]-a[0],b[1]-a[1]);lens.push(l);}}const sorted=[...lens].sort((x,y)=>x-y),under8=lens.filter(l=>l<8).length;return {edges:lens.length,under3:lens.filter(l=>l<3).length,under6:lens.filter(l=>l<6).length,under8,under8Ratio:under8/lens.length,under10:lens.filter(l=>l<10).length,min:sorted[0],median:median(sorted),max:sorted.at(-1)};};
 return {imgSize:[seg.width,seg.height],segMs,rooms:home.rooms.length,roomAudit,doors:home.doors.length,doorAudit,doorDetections:boxes.filter(b=>b.cls==='door'),homeDoors:home.doors,windowsRaw:boxes.filter(b=>b.cls==='window'),windows:home.windows.length,windowMeshCount,windowAudit,windowsAllValid,bayWindows,bayFloorAudit,noExposedBayFloors,edges:stepStats(contours.flatMap(c=>[c.outer,...c.holes])),contoursRaw:contours.map(c=>({outer:c.outer,holes:c.holes})),selection:home.selection,homeBlocks:home.walls.blocks.length,homeContours:contours.length,holes:contours.reduce((s,c)=>s+c.holes.length,0),vertices:contours.reduce((s,c)=>s+c.outer.length+c.holes.reduce((a,h)=>a+h.length,0),0),orthogonalization:{enabled:true,originalVertices:original.lines.contours.reduce((s,c)=>s+c.outer.length+c.holes.reduce((a,h)=>a+h.length,0),0),originalArea:original.lines.contours.reduce((s,c)=>s+Math.abs(signedArea(c.outer))-c.holes.reduce((n,h)=>n+Math.abs(signedArea(h)),0),0)},geometryMs,contourArea:contours.reduce((sum,s)=>sum+Math.abs(signedArea(s.outer))-s.holes.reduce((n,h)=>n+Math.abs(signedArea(h)),0),0),maskFidelity:{precision:tp/(tp+fp),recall:tp/(tp+fn),extraPixels:fp,missedPixels:fn},thickness:{min:thickness[0],median:median(thickness),max:thickness.at(-1)},current:metrics(current,currentRender),baseline:baseline?metrics(baseline,baselineRender):null,uiFlow,images,svg};
}
main().catch(error=>{console.error(error);process.exitCode=1;});
