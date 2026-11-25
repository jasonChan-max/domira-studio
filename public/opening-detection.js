import {doorsFromMask,windowsFromMask} from './room-polygon.js';

// 平開門 0.45–1.2m，推拉門（陽台／客廳隔斷）1.2–3.0m。兩段區間不重疊，
// 所以「門太寬」必須按類型分別判斷——2026-11-23 用戶指出推拉門被當假門刪掉了。
export const DOOR_LIMITS=Object.freeze({minWidth:.45,swingMaxWidth:1.2,slidingMinWidth:1.2,slidingMaxWidth:3,minThickness:.10,maxThickness:.40,minScore:.30});

export function doorsToHome(openings,frame,width,depth){
 const doors=[],checks=[],rejected=[],candidates=[];
 const between=(value,min,max)=>value>=min-1e-9&&value<=max+1e-9;
 for(const [index,box] of (openings||[]).entries()){
  const source={...box,cx:box.cx??box.x+box.w/2,cy:box.cy??box.y+box.h/2},converted=openingsToHome([source],frame,width,depth)[0];
  const door=converted&&['x','z','w','d'].every(k=>Number.isFinite(converted[k]))?converted:null;
  const longSide=door?Math.max(door.w,door.d):null,shortSide=door?Math.min(door.w,door.d):null,score=box.score??null;
  const isSliding=door?longSide>=DOOR_LIMITS.slidingMinWidth:false;
  const reasons=[];
  if(!door)reasons.push('门坐标或房屋比例尺无效');
  else{
   const maxWidth=isSliding?DOOR_LIMITS.slidingMaxWidth:DOOR_LIMITS.swingMaxWidth;
   if(!between(longSide,DOOR_LIMITS.minWidth,maxWidth))reasons.push(isSliding?'推拉门宽不在 1.2–3.0m':'门宽不在 0.45–1.2m');
   if(!between(shortSide,DOOR_LIMITS.minThickness,DOOR_LIMITS.maxThickness))reasons.push('门厚不在 0.10–0.40m');
  }
  // 分割回退没有检测置信度，不能伪造分数；有 score 的检测框则必须通过同一置信度闸。
  if(score!==null&&(!Number.isFinite(score)||score<DOOR_LIMITS.minScore))reasons.push('门检测置信度低于 0.30 或无效');
  const check={index,box:{x:box.x,y:box.y,w:box.w,h:box.h},score,longSide,shortSide,valid:reasons.length===0,reasons};checks.push(check);
  check.kind=isSliding?'sliding':'swing';
  if(check.valid)candidates.push({door:{...door,...(score===null?{}:{score}),kind:check.kind,sourceIndex:index},check,score});
  else rejected.push(check);
 }
 // 同一个门洞只放一个门。同一面墙上沿墙方向重叠超过 60% 就是同一个洞——
 // 不去重的话一个洞会叠两片门板，3D 看起来像两堵墙（2026-11-23 用户回報「入户门那里叠加了两个门」）。
 const overlaps=(a,b)=>{
  // 用 w/d 判斷方向，不依賴 horizontal 欄位（轉換後不一定還在）。
  const aH=a.w>a.d,bH=b.w>b.d;
  if(aH!==bH)return false;
  const along=aH?'x':'z',len=aH?'w':'d',cross=aH?'z':'x';
  if(Math.abs(a[cross]-b[cross])>0.45)return false;
  const overlap=Math.min(a[along]+a[len]/2,b[along]+b[len]/2)-Math.max(a[along]-a[len]/2,b[along]-b[len]/2);
  // 分母用較長者：真實疊加是兩個長度接近的框幾乎重合；
  // 若用較短者，一個小框落在長框裡也算「重疊 100%」，會誤合併大門旁的小門。
  return overlap>0&&overlap/Math.max(a[len],b[len])>0.6;
 };
 const rank=candidates.map((_,i)=>i).sort((i,j)=>(candidates[j].score??-1)-(candidates[i].score??-1));
 for(const i of rank){
  const candidate=candidates[i];
  if(doors.some(kept=>overlaps(kept,candidate.door))){
   candidate.check.valid=false;candidate.check.reasons.push('同一门洞已有更高分的门');
   rejected.push(candidate.check);continue;
  }
  doors.push(candidate.door);
 }
 // 按原始候选顺序输出，避免 2D/3D 里的门排序随分数变动。
 doors.sort((a,b)=>(a.sourceIndex??0)-(b.sourceIndex??0));
 return {doors,raw:checks.length,kept:doors.length,checks,rejected};
}

// 框內如果是「窗」類，這個框就不是門——分割模型已經判對那里是窗，YOLO 框錯了。
// 2026-11-25 實測四個樣本定出這條線：
//   46.03 的假框（窗帶上）→ window **95.5%**
//   3FO3S6MHSB5A 真門（旁邊有窗）→ window **66%**（門和窗重疊，不是純窗）
// 所以 window > 0.75 才拒。0.5 會砍掉那個真門（44 張召回 84.09%→83.77%）。
//
// ⚠️ 試過再加一條「框內 door 佔比 < 0.30 就拒」，**失敗，已刪**：
//   R(2) 的假框 door = 0% / 0.3% / 2%
//   被它誤刪的真門 door = 0% / 0% / 9.5% / 17% / 19.6% / 28.9%
// 真門的 door 佔比可以低到 0（分割模型在門洞位置判成 floor/wall），和假框完全重疊，
// 44 張召回因此掉到 82.14%。**要在門洞語義上做文章，得先解決分割模型在門口的準確度。**
//
// 這條判據**只用來否決，不產生新框**——否決是保守的，生成會把模型的錯誤學進下一輪。
export function filterDoorsByMaskClass(doors, mask, width, height, { minWindowRatio = .75, inset = 2 } = {}) {
 if (!mask || !(width > 0) || !(height > 0)) return { doors: doors || [], rejected: [] };
 const WINDOW_CLASS = 3;
 const kept = [], rejected = [];
 for (const d of doors || []) {
  const x0 = Math.max(0, Math.round(d.x) + inset), y0 = Math.max(0, Math.round(d.y) + inset);
  const x1 = Math.min(width - 1, Math.round(d.x + d.w) - inset), y1 = Math.min(height - 1, Math.round(d.y + d.h) - inset);
  // 框太小（縮邊後取不到內部）就放行：不為了砍假框去冒誤刪真門的風險。
  if (x1 < x0 || y1 < y0) { kept.push(d); continue; }
  let n = 0, win = 0;
  for (let y = y0; y <= y1; y++) {
   const row = y * width;
   for (let x = x0; x <= x1; x++) { n++; if (mask[row + x] === WINDOW_CLASS) win++; }
  }
  const winRatio = n ? win / n : 0;
  if (winRatio > minWindowRatio) rejected.push({ ...d, windowRatio: +winRatio.toFixed(3), rejectReason: '框內是窗，不是門洞' });
  else kept.push(d);
 }
 return { doors: kept, rejected };
}

// Keep both sources available for reproducible comparison. Empty or failed
// detector results fall back independently for doors and windows.
export function selectOpenings(boxes,mask,width,height,{windowSource='yolo'}={}){
 const convert=cls=>(boxes||[]).filter(b=>b.cls===cls&&[b.x,b.y,b.w,b.h].every(Number.isFinite)&&b.w>0&&b.h>0).map(b=>({...b,cx:b.x+b.w/2,cy:b.y+b.h/2,area:b.w*b.h,horizontal:b.w>=b.h}));
 const detectedDoors=convert('door'),detectedWindows=convert('window');
 const useYolo=windowSource==='yolo'&&detectedWindows.length>0;
 return {doors:detectedDoors.length?detectedDoors:doorsFromMask(mask,width,height),windows:useYolo?detectedWindows:windowsFromMask(mask,width,height),windowSource:useYolo?'yolo':'segmentation'};
}

export function openingsToHome(openings,frame,width,depth){
 if(!frame||!(frame.w>0&&frame.h>0))return [];
 return (openings||[]).filter(b=>[b.cx,b.cy,b.w,b.h].every(Number.isFinite)&&b.w>0&&b.h>0).map(b=>{
 const f=b.wallSupport?.footprint,wallFootprint=f?{x0:(f.x0-frame.x-frame.w/2)*width/frame.w,x1:(f.x1-frame.x-frame.w/2)*width/frame.w,y0:(f.y0-frame.y-frame.h/2)*depth/frame.h,y1:(f.y1-frame.y-frame.h/2)*depth/frame.h}:null;
 const opening={
  x:(b.cx-frame.x-frame.w/2)*width/frame.w,z:(b.cy-frame.y-frame.h/2)*depth/frame.h,
  w:b.w*width/frame.w,d:b.h*depth/frame.h,horizontal:!!b.horizontal,
 };
 if(wallFootprint){
  // 分割连通域的质心未必等于 bbox 中心；洞口必须跟随实际玻璃的中心和长度，不能仅让两者长度数值相等。
  if(opening.horizontal){opening.z=(wallFootprint.y0+wallFootprint.y1)/2;opening.d=wallFootprint.y1-wallFootprint.y0;wallFootprint.x0=opening.x-opening.w/2;wallFootprint.x1=opening.x+opening.w/2;}
  else{opening.x=(wallFootprint.x0+wallFootprint.x1)/2;opening.w=wallFootprint.x1-wallFootprint.x0;wallFootprint.y0=opening.z-opening.d/2;wallFootprint.y1=opening.z+opening.d/2;}
  opening.wallFootprint=wallFootprint;
 }
 const bay=b.wallSupport?.bay;
 if(bay){
  const toWorld=f=>({x0:(f.x0-frame.x-frame.w/2)*width/frame.w,x1:(f.x1-frame.x-frame.w/2)*width/frame.w,y0:(f.y0-frame.y-frame.h/2)*depth/frame.h,y1:(f.y1-frame.y-frame.h/2)*depth/frame.h});
  opening.bay={side:bay.side,seatFootprint:toWorld(bay.seatFootprint),panels:bay.panels.map(p=>{
   const f=toWorld(p.footprint);return {horizontal:p.horizontal,x:(f.x0+f.x1)/2,z:(f.y0+f.y1)/2,w:f.x1-f.x0,d:f.y1-f.y0,wallFootprint:f};
  })};
 }
 return opening;
 });
}
