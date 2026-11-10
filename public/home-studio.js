import {API_BASE} from './api-config.js';
import {HOME_KINDS,HOME_COLORS,homeFromAnalysis,validateHome,homePlanSVG,readPlanDimensions} from './home-domain.js';
import {imageToPixels,detectWalls,snapRoomsToWalls} from './wall-detect.js';
import {loadWallModel,segmentWalls,wallLinesFromMask} from './wall-onnx.js';
const hs=s=>document.querySelector(s),homeEscape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createHomeStudio({modal,setCleanup,createHome,notify}){
 let sequence=0,controller=null,image=null,analysis=null,draft=null,live=false;
 function stop(){live=false;sequence++;controller?.abort();controller=null;image=null;analysis=null;draft=null;hs('#floorplan-image')?.removeAttribute('src');hs('#floorplan-review-image')?.removeAttribute('src');}
 const preview=()=>{if(draft)hs('#floorplan-preview').innerHTML=homePlanSVG(draft);};
 function doorEditor(r,index){
 const label={top:'上',right:'右',bottom:'下',left:'左'};
 return `<div class="door-editor" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;align-items:center">${['top','right','bottom','left'].map(edge=>`<button type="button" data-add-door="${index}:${edge}" title="在${label[edge]}牆加一道門" style="font-size:11px;padding:2px 6px;cursor:pointer">+${label[edge]}門</button>`).join('')}${r.openings.map((o,i)=>`<span style="font-size:11px;padding:2px 6px;background:#eef2ec;border-radius:4px;display:inline-flex;align-items:center;gap:2px">${o.kind==='door'?'門':'窗'}·${label[o.edge]||o.edge}<button type="button" data-remove-opening="${index}:${i}" title="刪除" style="background:none;border:none;cursor:pointer;padding:0 2px">×</button></span>`).join('')}</div>`;
}
 function renderRooms(){hs('#floorplan-rooms').innerHTML=draft.rooms.map((r,index)=>`<div class="floorplan-room-row"><div class="floorplan-room-name"><span style="background:${HOME_COLORS[r.kind]}"></span><input aria-label="房間 ${index+1} 名稱" data-home-field="name" data-room-index="${index}" value="${homeEscape(r.name)}" maxlength="40"><button aria-label="移除 ${homeEscape(r.name)}" data-remove-room="${index}">×</button></div><select aria-label="房間 ${index+1} 用途" data-home-field="kind" data-room-index="${index}">${Object.entries(HOME_KINDS).map(([k,label])=>`<option value="${k}" ${k===r.kind?'selected':''}>${label}</option>`).join('')}</select>${[['x','中心 X'],['z','中心 Z'],['width','寬'],['depth','深']].map(([key,label])=>`<label>${label} / m<input type="number" step=".01" data-home-field="${key}" data-room-index="${index}" value="${r[key].toFixed(2)}" aria-label="房間 ${index+1} ${label}"></label>`).join('')}<small class="confidence ${r.confidence}">${({high:'高信心',medium:'待核對',low:'低信心'})[r.confidence]||'待核對'} · ${r.openings.length} 個門窗${r.notes?' · '+homeEscape(r.notes):''}</small>${doorEditor(r,index)}</div>`).join('');document.querySelectorAll('[data-home-field]').forEach(input=>input.onchange=()=>{const room=draft.rooms[Number(input.dataset.roomIndex)],key=input.dataset.homeField;room[key]=['name','kind'].includes(key)?input.value:Number(input.value);room.purpose=['bedroom','dining','work'].includes(room.kind)?room.kind:'living';preview();});document.querySelectorAll('[data-home-field]').forEach(input=>input.oninput=input.onchange);document.querySelectorAll('[data-remove-room]').forEach(button=>button.onclick=()=>{draft.rooms.splice(Number(button.dataset.removeRoom),1);renderRooms();preview();});document.querySelectorAll('[data-add-door]').forEach(button=>button.onclick=()=>{const[ri,edge]=button.dataset.addDoor.split(':');draft.rooms[Number(ri)].openings.push({kind:'door',edge,offset:.4,width:.2});renderRooms();preview();});document.querySelectorAll('[data-remove-opening]').forEach(button=>button.onclick=()=>{const[ri,oi]=button.dataset.removeOpening.split(':');draft.rooms[Number(ri)].openings.splice(Number(oi),1);renderRooms();preview();});}
 async function detectImageWalls(upload, ticket){
  try{
   const model=await loadWallModel(new URL('./models/unet-int8.onnx',import.meta.url).href);
   if(!live||ticket!==sequence||upload!==image)return null;
   const result=await segmentWalls(upload.canvas,{session:model});
   if(!live||ticket!==sequence||upload!==image)return null;
   const marked=document.createElement('canvas');
   marked.width=result.width;marked.height=result.height;
   const context=marked.getContext('2d');
   context.drawImage(upload.canvas,0,0);
   const overlay=context.getImageData(0,0,result.width,result.height);
   for(let pixel=0;pixel<result.mask.length;pixel++){
    if(result.mask[pixel]!==1)continue;
    const i=pixel*4;
    overlay.data[i]=Math.round(overlay.data[i]*.28+255*.72);
    overlay.data[i+1]=Math.round(overlay.data[i+1]*.28+45*.72);
    overlay.data[i+2]=Math.round(overlay.data[i+2]*.28+75*.72);
   }
   context.putImageData(overlay,0,0);
   const markedUrl=marked.toDataURL('image/png');
   for(const id of ['#floorplan-wall-upload','#floorplan-wall-review']){
    const preview=hs(id);
    preview.hidden=!result.stats.wall;
    preview.querySelector('img').src=markedUrl;
   }
   hs('#floorplan-wall-status').textContent=result.stats.wall
    ?(result.calibrated?'Domira 牆體模型已完成辨識。':'基礎牆體模型已完成辨識。')+' 紅色為候選牆體。'
    :'模型未辨識到牆體，請改用更清晰的單層圖紙。';
   const minLength=Math.max(18,Math.round(Math.max(result.width,result.height)*.03));
   return {lines:wallLinesFromMask(result.mask,result.width,result.height,{minLenH:minLength,minLenV:minLength,gap:8}),source:result.calibrated?'Domira 牆體模型':'基礎牆體模型'};
  }catch(error){
   console.warn('[wall-model]',error);
   if(live&&ticket===sequence&&upload===image)hs('#floorplan-wall-status').textContent='牆體預覽暫時無法載入，仍可分析房間與尺寸。';
   return null;
  }
 }
 async function snapWithWalls(data, upload){
  try{
   const predicted=upload.wallResult;
   let lines=predicted?.lines,source=predicted?.source;
   if(!lines?.hLines.length||!lines?.vLines.length){
    const pixels=await imageToPixels(upload.data);
    lines=detectWalls(pixels.data,pixels.width,pixels.height);
    source='圖像閾值';
   }
   const keepH=lines.hLines.filter(line=>line.len>=80);
   const keepV=lines.vLines.filter(line=>line.len>=80);
   if(!keepH.length||!keepV.length)return data;
   const xs=[],ys=[];
   for(const line of keepH){xs.push(line.from,line.to);ys.push(line.pos);}
   for(const line of keepV){xs.push(line.pos);ys.push(line.from,line.to);}
   const walls={hLines:lines.hLines,vLines:lines.vLines,box:{x0:Math.min(...xs),x1:Math.max(...xs),y0:Math.min(...ys),y1:Math.max(...ys)}};
   const result=snapRoomsToWalls(data.rooms,walls,{frame:data.frame});
   if(!result.snappedEdges)return data;
   return {...data,rooms:result.rooms,warnings:[...data.warnings,'已依'+source+'校正 '+result.snappedEdges+' 條房間邊界，請與原圖核對。']};
  }catch(error){console.warn('[wall-detect] skipped:',error);return data;}
 }
 function renderDimensions(first,second){
  const sides={top:'上',bottom:'下',left:'左',right:'右'};
  const left=readPlanDimensions(first),right=readPlanDimensions(second);
  const panel=hs('#floorplan-dimensions');
  panel.replaceChildren();
  for(const [side,label] of Object.entries(sides)){
   const a=left.dimensions[side],b=right.dimensions[side];
   if(!a&&!b)continue;
   const row=document.createElement('li');
   row.textContent=label+'側尺寸（mm）：'+(a||b).join(' ＋ ')+(a&&b&&a.join()!==b.join()?' ／ 第二次讀取 '+b.join(' ＋ ')+'，請核對':'');
   panel.append(row);
  }
  const empty=hs('#floorplan-no-dimensions');
  empty.hidden=panel.childElementCount>0;
  const merged=readPlanDimensions({...left.dimensions,...Object.fromEntries(Object.keys(sides).filter(side=>!left.dimensions[side]&&right.dimensions[side]).map(side=>[side,right.dimensions[side]]))});
  const apply=hs('#floorplan-apply-dimensions');
  const disagreements=[];
  for(const [axis,keys] of [['width',['top','bottom']],['depth',['left','right']]]){
   if(merged.conflicts.includes(axis)||keys.some(side=>left.dimensions[side]&&right.dimensions[side]&&left.dimensions[side].join()!==right.dimensions[side].join()))disagreements.push(axis);
  }
  apply.hidden=!['width','depth'].some(axis=>merged[axis]&&!disagreements.includes(axis));
  hs('#floorplan-dimension-conflicts').textContent=disagreements.length?'尺寸標線互相不一致，請按原圖核對'+disagreements.map(axis=>axis==='width'?'寬度':'深度').join('和')+'。':'';
  apply.onclick=()=>{
   for(const axis of ['width','depth']){
    const input=hs('#home-'+axis);
    if(!merged[axis]||disagreements.includes(axis)||input.value)continue;
    input.value=merged[axis];
    input.onchange();
   }
  };
 }
 function showReview(data){analysis=data;const aspect=data.frame&&data.frame.w>0?data.frame.h/data.frame.w:image.height/image.width,readArea=(data.rooms||[]).reduce((s,r)=>s+(r.area_sqm||0),0),assumedArea=readArea>15?readArea*1.25:50,assumedW=Math.sqrt(assumedArea/Math.min(Math.max(aspect,.2),5)),w=Number(hs('#floorplan-known-width').value)||data.scale.width||assumedW,d=data.scale.depth||Math.round(w*aspect*100)/100;draft=homeFromAnalysis(data,w,Math.max(2,Math.min(40,d)),2.7,false);hs('#floorplan-review').hidden=false;hs('#floorplan-upload').hidden=true;hs('#floorplan-summary').textContent=data.summary;renderDimensions(data.dimensions);hs('#floorplan-review-image').src=image.data;hs('#home-width').value=Number(hs('#floorplan-known-width').value)||data.scale.width||'';hs('#home-depth').value=data.scale.depth||'';hs('#floorplan-scale-note').textContent=data.scale.basis==='dimensioned'?'AI 讀取到圖上尺寸，仍請按原圖或實測核對。':readArea>15?'圖上各房間標註面積合計 '+readArea.toFixed(2)+' m²（淨面積），已加 25% 牆體與公用部分換算全屋寬深；仍請逐間核對。':'圖紙沒有可驗證的尺寸標註；請填入全屋實際長寬。未填入前，寬深是按圖紙比例假設的示意值（約 40 m²）。';hs('#floorplan-warnings').textContent=['首版以矩形空間近似單層戶型，不是施工圖。',...data.warnings].join(' ');renderRooms();preview();hs('#modal').scrollTop=0;}
  async function postFloorplan(body,signal){const response=await fetch(API_BASE+'/api/floorplan/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});const data=await response.json();if(!response.ok)throw new Error(data.error||'分析未完成');return data;}
  // 第二段的面積回來時只補數字：位置、矩形、門窗都已在第一段定好，這裡不動任何幾何。
  // draft 用「名字」而不只用下標對齊——homeFromAnalysis 可能合併同名房間，兩邊數量不一定一樣。
  function applyAreas(result){
   renderDimensions(analysis?.dimensions,result.dimensions);
   (result.areas||[]).forEach(a=>{
    const room=analysis?.rooms?.[a.i];
    if(!room||!Number.isFinite(a.area_sqm)||a.area_sqm<=0)return;
    room.area_sqm=a.area_sqm;
    const draftRoom=draft?.rooms?.find(x=>x.name===room.name);
    if(draftRoom)draftRoom.area_sqm=a.area_sqm;
   });
   const total=(analysis?.rooms||[]).reduce((s,r)=>s+(r.area_sqm||0),0);
   if(total>15&&analysis?.scale.basis!=='dimensioned')hs('#floorplan-scale-note').textContent='圖上各房間標註面積合計 '+total.toFixed(2)+' m²（淨面積），已加 25% 牆體與公用部分換算全屋寬深；仍請逐間核對。';
   if(draft)renderRooms();
   hs('#floorplan-warnings').textContent=['首版以矩形空間近似單層戶型，不是施工圖。',...(analysis?.warnings||[]),...(result.warnings||[])].join(' ');
  }
 async function open(){stop();let ticket;modal('從一張圖，走進整個家。',`<div class="floorplan-intro"><span>FLOORPLAN → AI → WHOLE HOME</span><p>上傳單層戶型圖，即可在瀏覽器預覽候選牆體。再分析房間、門窗和圖上尺寸，核對後建立整屋模型。</p></div><section id="floorplan-upload"><label class="floorplan-drop" for="floorplan-file"><span>⌑</span><strong>選擇你的平面圖</strong><small>JPG / PNG / WebP · 最多 8 MB · 單層、最多 12 個空間</small><input id="floorplan-file" type="file" accept="image/jpeg,image/png,image/webp" hidden></label><div class="floorplan-source" id="floorplan-source" hidden><img id="floorplan-image" alt="待分析的平面圖"><div><strong id="floorplan-file-name"></strong><p>影像會先壓縮為最長 1200px，減少傳輸與識別成本。</p></div></div><p id="floorplan-wall-status" class="floorplan-status" role="status"></p><details id="floorplan-wall-upload" class="floorplan-wall-preview" hidden><summary>查看牆體辨識圖</summary><img alt="平面圖疊加紅色候選牆體"></details><div class="form-grid"><div class="field"><label for="floorplan-known-width">已知全屋寬度 / m（選填 · 一般 3–6 m）</label><input id="floorplan-known-width" type="number" min="2" max="40" step=".01" placeholder="完整戶型外框寬度，非單間尺寸"></div><div class="field"><label for="floorplan-notes">圖紙說明（選填）</label><input id="floorplan-notes" maxlength="300" placeholder="例如：上方是睡房，單位為 mm"></div></div><label class="floorplan-consent"><input id="floorplan-consent" type="checkbox"> 同意將這張圖紙傳送至 <span id="floorplan-provider">識圖服務</span> 進行識別；請先遮去不需要的姓名與地址。</label><p class="floorplan-service" id="floorplan-service">正在檢查識圖服務…</p><button class="primary" id="floorplan-analyze" disabled>AI 分析平面圖 ↗</button><p class="floorplan-status" id="floorplan-status" role="status"></p></section><section id="floorplan-review" hidden><div class="floorplan-review-grid"><div class="floorplan-preview" id="floorplan-preview"></div><div class="floorplan-review-copy"><span>REVIEW BEFORE BUILD</span><h3>先核對，再成為你的家。</h3><img id="floorplan-review-image" alt="原始平面圖，供核對 AI 結果"><p id="floorplan-summary"></p><p id="floorplan-scale-note"></p><details id="floorplan-wall-review" class="floorplan-wall-preview" hidden><summary>查看牆體辨識圖</summary><img alt="平面圖疊加紅色候選牆體"></details></div></div><div class="form-grid"><div class="field"><label for="home-name">全屋專案名稱</label><input id="home-name" value="我的全屋設計" maxlength="40"></div><div class="field"><label for="home-height">層高 / m</label><input id="home-height" type="number" min="2" max="6" step=".01" value="2.7"></div></div><div class="form-grid"><div class="field"><label for="home-width">全屋寬度 / m</label><input id="home-width" type="number" min="2" max="40" step=".01" placeholder="請填入實際寬度"></div><div class="field"><label for="home-depth">全屋深度 / m</label><input id="home-depth" type="number" min="2" max="40" step=".01" placeholder="請填入實際深度"></div></div><section class="floorplan-readings" aria-label="圖紙尺寸"><h3>圖紙外框尺寸標註</h3><ul id="floorplan-dimensions"></ul><p id="floorplan-no-dimensions">未讀到可列出的外框標註。請按原圖或實測填入長寬。</p><p id="floorplan-dimension-conflicts" role="status"></p><button type="button" id="floorplan-apply-dimensions" class="secondary" hidden>用圖紙讀值補入空白長寬</button></section><div class="floorplan-rooms-heading"><h3>房間與相對位置</h3><button class="secondary" id="floorplan-add-room">＋ 補充空間</button></div><p class="modal-copy">座標以全屋中心為原點，X 向右、Z 向圖紙下方。可調整矩形近似、名稱及用途；門窗依 AI 可辨識位置建立。</p><div id="floorplan-rooms"></div><p class="modal-notice" id="floorplan-warnings"></p><label class="floorplan-consent"><input type="checkbox" id="floorplan-confirm"> 我已核對長寬高、房間數量和位置，接受矩形近似並建立模型。</label><div class="modal-actions"><button class="secondary" id="floorplan-restart">重新選圖</button><button class="primary" id="floorplan-build">建立全屋 3D 模型 ↗</button></div></section><p id="floorplan-error" class="error-text" role="alert"></p>`,'WHOLE HOME / FROM PLAN TO SPACE');live=true;ticket=sequence;setCleanup(stop);hs('#modal').classList.add('floorplan-modal');hs('#modal').addEventListener('close',()=>hs('#modal').classList.remove('floorplan-modal'),{once:true});let service=false,uploadEpoch=0;
 const enable=()=>{hs('#floorplan-analyze').disabled=!(service&&image&&hs('#floorplan-consent').checked);};fetch(API_BASE+'/api/floorplan/capabilities').then(r=>r.json()).then(data=>{if(!live||ticket!==sequence)return;service=!!data.enabled;const names={qwen:'通義千問（阿里雲百煉）',gemini:'Google Gemini',deepseek:'DeepSeek'},provider=(names[data.provider]||'所選識圖服務')+(data.merge?.enabled?' ＋ '+(names[data.merge.provider]||'第二來源'):'');hs('#floorplan-provider').textContent=provider;hs('#floorplan-service').textContent=service?provider+' · '+(data.model||'視覺模型')+' 已連線 · '+(data.merge?.enabled?'每張圖分別調用兩個模型，不自動重試。':'每次只分析一張，不自動重試。'):'識圖服務暫未啟用，請稍後再試。';enable();}).catch(()=>{if(live)hs('#floorplan-service').textContent='暫時無法連接識圖服務。';});hs('#floorplan-consent').onchange=enable;
 hs('#floorplan-file').onchange=async event=>{const file=event.target.files?.[0];if(!file)return;const uploadTicket=++uploadEpoch;image=null;enable();hs('#floorplan-source').hidden=true;hs('#floorplan-wall-upload').hidden=true;hs('#floorplan-wall-status').textContent='';try{if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>8000000)throw new Error('請選擇 8 MB 以內的 JPG、PNG 或 WebP 圖片；PDF 請先匯出為圖片。');const bitmap=await createImageBitmap(file);if(!bitmap.width||bitmap.width*bitmap.height>80000000){bitmap.close();throw new Error('圖紙解析度過大，請先縮小或裁切。');}const factor=Math.min(1,1200/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*factor);canvas.height=Math.round(bitmap.height*factor);const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();let data=canvas.toDataURL('image/png');if(data.length>1850000)data=canvas.toDataURL('image/jpeg',.92);if(data.length>1850000)data=canvas.toDataURL('image/jpeg',.75);if(data.length>1850000)throw new Error('壓縮後圖紙仍過大，請先裁切。');if(!live||ticket!==sequence||uploadTicket!==uploadEpoch)return;image={data,width:canvas.width,height:canvas.height,canvas};for(const id of ['#floorplan-wall-upload','#floorplan-wall-review']){hs(id).hidden=true;hs(id).open=false;hs(id).querySelector('img').removeAttribute('src');}hs('#floorplan-wall-status').textContent='正在辨識牆體…';const upload=image;detectImageWalls(upload,ticket).then(result=>{upload.wallResult=result;});hs('#floorplan-image').src=data;hs('#floorplan-file-name').textContent=file.name;hs('#floorplan-source').hidden=false;hs('#floorplan-error').textContent='';enable();}catch(error){if(live&&ticket===sequence&&uploadTicket===uploadEpoch){hs('#floorplan-error').textContent=error.message;image=null;enable();}}};
 hs('#floorplan-analyze').onclick=async()=>{
  if(!image||!hs('#floorplan-consent').checked)return;
  const known=hs('#floorplan-known-width');
  if(known.value&&!known.checkValidity())return known.reportValidity();
  hs('#floorplan-analyze').disabled=true;
  hs('#floorplan-file').disabled=true;
  hs('#floorplan-error').textContent='';
  hs('#floorplan-status').textContent='① 正在識別房間位置、門窗與相鄰關係，約 10 秒…';
  const width=known.value?Number(known.value):null;
  const notes=hs('#floorplan-notes').value;
  controller=new AbortController();
  const timer=setTimeout(()=>controller?.abort(),90000);
  try{
   // 第一段（位置）：副來源 deepseek 約 7 秒。先讓使用者看到房間框，不必等面積。
   const position=await postFloorplan({image:image.data,knownWidth:width,notes,stage:'position'},controller.signal);
   clearTimeout(timer);
   if(!live||ticket!==sequence)return;
   const analysed=await snapWithWalls(position,image);
   if(!live||ticket!==sequence)return;
   showReview(analysed);
   hs('#floorplan-file').disabled=false;
   hs('#floorplan-status').textContent='';
   if(position.areaPending===false){enable();return;}
   // 第二段（面積）：主來源 Qwen，獨立請求、獨立逾時；失敗只影響面積，房間框已經在畫面上。
   hs('#floorplan-status').textContent='② 房間框已就位，正在讀取圖上標註的面積（約 1 分鐘，可先核對尺寸與門窗）…';
   const areaController=new AbortController();
   const areaTimer=setTimeout(()=>areaController.abort(),120000);
   postFloorplan({image:image.data,knownWidth:width,notes,stage:'area',rooms:analysed.rooms.map(r=>({name:r.name,kind:r.kind}))},areaController.signal)
    .then(result=>{clearTimeout(areaTimer);if(!live||ticket!==sequence)return;applyAreas(result);hs('#floorplan-status').textContent='② 面積已補上（'+result.matched+'/'+result.total+' 間）。';enable();})
    .catch(()=>{clearTimeout(areaTimer);if(!live||ticket!==sequence)return;hs('#floorplan-status').textContent='② 面積未讀到（位置與房間框不受影響）；可稍後重新分析補上。';enable();});
  }catch(error){
   clearTimeout(timer);
   if(live&&ticket===sequence){hs('#floorplan-error').textContent=error.name==='AbortError'?'分析已取消或逾時，未變更原專案。可稍後手動重試。':error.message;hs('#floorplan-status').textContent='';enable();hs('#floorplan-file').disabled=false;}
  }
 };
 for(const key of ['width','depth','height'])hs('#home-'+key).onchange=()=>{if(!draft)return;const value=Number(hs('#home-'+key).value);if(!value||!hs('#home-'+key).checkValidity())return hs('#home-'+key).reportValidity();if(key==='height')for(const room of draft.rooms)room.height=value;else{const factor=value/draft[key];for(const room of draft.rooms){room[key]*=factor;room[key==='width'?'x':'z']*=factor;} }draft[key]=value;renderRooms();preview();};for(const key of ['width','depth','height'])hs('#home-'+key).oninput=hs('#home-'+key).onchange;hs('#floorplan-add-room').onclick=()=>{if(draft.rooms.length>=12)return notify('目前最多 12 個空間。');draft.rooms.push({id:crypto.randomUUID(),name:'補充空間',kind:'other',purpose:'living',x:0,z:0,width:2,depth:2,height:draft.height,confidence:'low',openings:[],items:[]});renderRooms();preview();};hs('#floorplan-restart').onclick=open;
 hs('#floorplan-build').onclick=()=>{try{if(!draft)return;document.querySelectorAll('[data-home-field]').forEach(input=>{const key=input.dataset.homeField;draft.rooms[Number(input.dataset.roomIndex)][key]=['name','kind'].includes(key)?input.value:Number(input.value);});for(const key of ['width','depth','height']){const input=hs('#home-'+key);if(!input.value||!input.checkValidity())throw new Error('請填入並確認全屋實際長寬高。');if(Math.abs(draft[key]-Number(input.value))>.001)input.onchange();}if(!hs('#floorplan-confirm').checked)throw new Error('請先確認尺寸與房間位置。');validateHome(draft);createHome(hs('#home-name').value.trim()||'我的全屋設計',structuredClone(draft));notify('全屋模型已建立。點選房間可進入編輯與佈局。');}catch(error){hs('#floorplan-error').textContent=error.message;hs('#floorplan-error').scrollIntoView({block:'nearest'});}};}
 return {open,stop};
}
