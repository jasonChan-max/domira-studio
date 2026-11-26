import clipping from './vendor/polygon-clipping.js';
import {signedArea} from './wall-contours.js';
import {wallBlocksFromMask} from './wall-onnx.js';
import {windowsFromMask} from './room-polygon.js';
import {assessBayWindowSupport} from './bay-window.js';

// 飘窗约 58cm 的凸出场景中，玻璃在凸出外沿，主墙中线的 2.5 倍墙厚不足以覆盖它。
// 2026-11-26：R(7) 底部阳台窗实测 ratio 7.14（距离 92.8px / 墙厚 13px），5 倍還是不夠，
// 放寬到 8。放進來的必須靠下面的長寬比閘（方形假框 1.16 會被擋）和 bay 檢查兜住。
export const MAX_WINDOW_WALL_RATIO=8;
export const LEGACY_WINDOW_WALL_RATIO=2.5;
// 2026-11-26：由 2 提到 3。放寬遠牆判定後，3FO3UONGHR0O 放進了兩個 88x44 / 86x43 的框
// （長寬比 2.02 / 2.00）——那是「窗 + 牆」的粗框，不是窗。而真正要救的底部凸窗
// 長寬比是 9.33 / 8.04。3 這個分界兩邊都乾淨。
export const MIN_BAY_WINDOW_ASPECT=3;
// 2026-11-26：框內必須真的有窗像素。46.03 的 W6/W7/W8 是尺寸標註（「1591」「1934」「2304」），
// 框內 window 佔比 0%（outside 100%），卻因為兩側恰好「一邊屋外一邊地板」而通過端點/兩側檢查。
// 真窗的框內 window 佔比實測 87–98%（W1 87%、W4 90%、W2 98%），
// 最差的凸窗（R(7) 底部陽台窗，框內混了 48% 地板）也有 37%。0.30 這個線兩邊都乾淨。
export const MIN_WINDOW_CONTENT_RATIO=.3;

// 筛选与轮廓转换分开；不能为了去除屋外噪声而改写忠实于 mask 的轮廓提取。
export function contourBounds(contour){
 const xs=contour.outer.map(p=>p[0]),ys=contour.outer.map(p=>p[1]);
 return {x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)};
}
const overlaps=(a,b,pad=0)=>a.x+a.w>b.x-pad&&a.x<b.x+b.w+pad&&a.y+a.h>b.y-pad&&a.y<b.y+b.h+pad;
const union=(a,b)=>{const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);return {x,y,w:Math.max(a.x+a.w,b.x+b.w)-x,h:Math.max(a.y+a.h,b.y+b.h)-y};};
const roomBounds=r=>({x:r.bbox[0],y:r.bbox[1],w:r.bbox[2]-r.bbox[0],h:r.bbox[3]-r.bbox[1]});

export function selectHouseContours(contours,rooms){
 if(!contours.length)return {contours:[],frame:null,removed:[]};
 const bounds=contours.map(contourBounds);
 const seed=[...rooms].sort((a,b)=>(b.pixels||b.area)-(a.pixels||a.area))[0];
 let region=seed?roomBounds(seed):bounds.reduce((a,b)=>a.w*a.h>b.w*b.h?a:b);
 const kept=new Set();let changed=true;
 while(changed){changed=false;bounds.forEach((b,i)=>{if(!kept.has(i)&&overlaps(b,region,2)){kept.add(i);region=union(region,b);changed=true;}});}
 const selected=contours.filter((_,i)=>kept.has(i));
 // 外墙厚度也属于房屋范围；仅用地板 bbox 会把贴边的真窗和短墙误判为屋外。
 const frame=selected.length?selected.map(contourBounds).reduce(union):null;
 return {contours:selected,frame,removed:bounds.flatMap((bbox,i)=>kept.has(i)?[]:[{index:i,bbox,reason:'与房屋主体范围分离'}])};
}

function roomFromPolygon(polygon,source){
 const xs=polygon.map(p=>p[0]),ys=polygon.map(p=>p[1]),area=Math.abs(signedArea(polygon));
 return {...source,polygon,bbox:[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)],area};
}
export function roomsWithinHouse(rooms,frame){
 if(!frame)return rooms;
 const bounds=[[[frame.x,frame.y],[frame.x+frame.w,frame.y],[frame.x+frame.w,frame.y+frame.h],[frame.x,frame.y+frame.h]]];
 return rooms.flatMap(room=>{
  if(!overlaps(roomBounds(room),frame))return [];
  if(room.polygon.every(([x,y])=>x>=frame.x&&x<=frame.x+frame.w&&y>=frame.y&&y<=frame.y+frame.h))return [room];
  // 地板吸收墙像素会略越过主体外框；按真实多边形裁切，不能只移动中心掩盖越界。
  return clipping.intersection([room.polygon],bounds).map(p=>roomFromPolygon(p[0].slice(0,-1),room));
 });
}

export function mergeRoomFragments(rooms,mask,width,height){
 const merged=[],result=[...rooms],floorArea=rooms.reduce((sum,r)=>sum+Math.abs(signedArea(r.polygon)),0);
 let changed=true;
 while(changed){changed=false;
  outer:for(let i=0;i<result.length;i++)for(let j=i+1;j<result.length;j++){
   const a=result[i],b=result[j],ab=roomBounds(a),bb=roomBounds(b),box=union(ab,bb),area=ab.w*ab.h+bb.w*bb.h;
   if([a,b].some(r=>Math.abs(signedArea(r.polygon))>floorArea*.18)||[ab,bb].some(r=>r.w<=0||r.h<=0))continue;
   if(Math.abs(signedArea(a.polygon))/(ab.w*ab.h)<.92||Math.abs(signedArea(b.polygon))/(bb.w*bb.h)<.92||area/(box.w*box.h)<.94)continue;
   let horizontal,edge,from,to,gap;
   if(Math.abs(ab.x-bb.x)<=2&&Math.abs(ab.x+ab.w-bb.x-bb.w)<=2){
    const top=ab.y<bb.y?ab:bb,bottom=top===ab?bb:ab;gap=bottom.y-top.y-top.h;
    horizontal=true;edge=(bottom.y+top.y+top.h)/2;from=Math.max(ab.x,bb.x);to=Math.min(ab.x+ab.w,bb.x+bb.w);
   }else if(Math.abs(ab.y-bb.y)<=2&&Math.abs(ab.y+ab.h-bb.y-bb.h)<=2){
    const left=ab.x<bb.x?ab:bb,right=left===ab?bb:ab;gap=right.x-left.x-left.w;
    horizontal=false;edge=(right.x+left.x+left.w)/2;from=Math.max(ab.y,bb.y);to=Math.min(ab.y+ab.h,bb.y+bb.h);
   }else continue;
   if(gap< -1||gap>3||to-from<4)continue;
   let structural=0,floor=0,samples=0,hasDoor=false;
   for(let n=Math.ceil(from)+1;n<Math.floor(to)-1;n++)for(const offset of [-2,0,2]){
    const x=Math.floor(horizontal?n:edge+offset),y=Math.floor(horizontal?edge+offset:n);
    if(x<0||y<0||x>=width||y>=height){structural++;samples++;continue;}
    const c=mask[y*width+x];hasDoor||=c===2;structural+=Number(c===1||c===2);floor+=Number(c===0);samples++;
   }
   // 同尺寸并不代表同一间房；只有分界几乎全是地板且没有墙或门证据，才修复腐蚀造成的假分裂。
   if(!samples||hasDoor||structural/samples>.05||floor/samples<.6)continue;
   const polygon=[[box.x,box.y],[box.x+box.w,box.y],[box.x+box.w,box.y+box.h],[box.x,box.y+box.h]];
   merged.push({from:[a.bbox,b.bbox],to:[box.x,box.y,box.x+box.w,box.y+box.h],reason:'相邻矩形候选的分界没有墙门支持'});
   result[i]=roomFromPolygon(polygon,{...a,pixels:(a.pixels||0)+(b.pixels||0)});result.splice(j,1);changed=true;break outer;
  }
 }
 return {rooms:result,merged};
}

export function closeDetectedDoorFloors(mask,width,height,doors){
 const closed=new Uint8Array(mask);
 for(const b of doors){
  if(![b.x,b.y,b.w,b.h].every(Number.isFinite)||b.w<=0||b.h<=0)continue;
  for(let y=Math.max(0,Math.floor(b.y));y<Math.min(height,Math.ceil(b.y+b.h));y++)for(let x=Math.max(0,Math.floor(b.x));x<Math.min(width,Math.ceil(b.x+b.w));x++)if(closed[y*width+x]===0)closed[y*width+x]=2;
 }
 // 封门只用于房间连通分析；原始 wall/window 像素不变，不能把探针和渲染的数据也改掉。
 return closed;
}

export function windowWallDistance(box,blocks){
 const horizontal=box.w>=box.h,cross=horizontal?box.y+box.h/2:box.x+box.w/2,along=horizontal?box.x+box.w/2:box.y+box.h/2,long=horizontal?box.w:box.h;
 const candidates=blocks.flatMap(b=>{
  const w=b.x1-b.x0+1,h=b.y1-b.y0+1;if((w>=h)!==horizontal)return [];
  const from=horizontal?b.x0:b.y0,to=horizontal?b.x1:b.y1,centerLine=horizontal?(b.y0+b.y1+1)/2:(b.x0+b.x1+1)/2,thickness=horizontal?h:w;
  if(along<from-long/2-thickness*1.5||along>to+long/2+thickness*1.5)return [];
  const distance=Math.abs(cross-centerLine);return [{distance,thickness,ratio:distance/thickness,centerLine,bbox:{x0:b.x0,y0:b.y0,x1:b.x1,y1:b.y1}}];
 });
 return candidates.sort((a,b)=>a.ratio-b.ratio)[0]||null;
}

export function assessWindowSupport(mask,width,height,box,frame,{blocks}={}){
 if(!frame||![box.x,box.y,box.w,box.h].every(Number.isFinite)||box.w<=0||box.h<=0)return {valid:false,reason:'窗坐标无效'};
 const horizontal=box.w>=box.h,cx=box.x+box.w/2,cy=box.y+box.h/2;
 const nearestWall=windowWallDistance(box,blocks||wallBlocksFromMask(mask,width,height));
 const aspectRatio=Math.max(box.w,box.h)/Math.min(box.w,box.h),far=!!nearestWall&&nearestWall.ratio>=LEGACY_WINDOW_WALL_RATIO;
 const diagnostic={onExteriorWall:false,nearestWall,aspectRatio,withinWallDistance:!!nearestWall&&nearestWall.ratio<MAX_WINDOW_WALL_RATIO};
 // 框內幾乎沒有 window 像素 → 不是窗（尺寸標註、文字、空白框）。
 let contentCount=0,contentWin=0;
 for(let yy=Math.max(0,Math.floor(box.y));yy<Math.min(height,Math.ceil(box.y+box.h));yy++){
  const row=yy*width;
  for(let xx=Math.max(0,Math.floor(box.x));xx<Math.min(width,Math.ceil(box.x+box.w));xx++){
   contentCount++;if(mask[row+xx]===3)contentWin++;
  }
 }
 const contentRatio=contentCount?contentWin/contentCount:0;
 diagnostic.contentRatio=contentRatio;
 if(contentRatio<MIN_WINDOW_CONTENT_RATIO)return {...diagnostic,valid:false,reason:'框內幾乎沒有窗像素（疑似尺寸標註或空白框）'};
 // 46.03 的短真窗原框长宽比可小于 2；细长约束用于新增的远墙路径，近墙仍需原来的墙端和屋外证据。
 if(far&&aspectRatio<MIN_BAY_WINDOW_ASPECT)return {...diagnostic,valid:false,reason:'远墙候选长宽比小于 2，疑似方形大假框'};
 if(!diagnostic.withinWallDistance)return {...diagnostic,valid:false,reason:'窗到墙中线距离超过墙厚的 5 倍'};
 if(aspectRatio>=MIN_BAY_WINDOW_ASPECT&&(far||Math.min(box.w,box.h)>nearestWall.thickness*2)){
  const bay=assessBayWindowSupport(mask,width,height,box,nearestWall);
  if(bay)return {...diagnostic,...bay};
 }
 // 2026-11-26：原本這裡是 `if(far)return 拒`——遠牆（ratio>=2.5）一票否決。
 // 但普通外牆窗也會離牆中線遠：R(7) 底部陽台窗 ratio 7.14（距離 92.8px、牆厚 13px）、
 // 主臥下窗 ratio 3.19，兩者長寬比 9.33／8.04 都是標準窗形，卻因為「不像飄窗」被拒。
 // 改成讓它們繼續走下面的「兩端有牆 + 兩側屋外」檢查——那套檢查本身夠嚴：
 // 方形大假框在上一行已被長寬比擋掉，兩端沒牆的會在 cap() 那步被拒。

 const at=(x,y)=>x>=0&&y>=0&&x<width&&y<height?mask[Math.floor(y)*width+Math.floor(x)]:4;
 const probe=Math.max(3,Math.round(Math.max(width,height)*.015));
 const short=horizontal?box.h:box.w,long=horizontal?box.w:box.h;
 const start=horizontal?box.x:box.y,end=start+long,centerCross=horizontal?cy:cx;
 const cross=Math.abs(centerCross-nearestWall.centerLine)>short/2?nearestWall.centerLine:centerCross;
 const cap=side=>{
  for(let step=0;step<=probe;step++){
   const along=side<0?start-step:end+step;let wall=0;
   for(let t=-Math.floor(short/2);t<=Math.ceil(short/2);t++)if((horizontal?at(along,cross+t):at(cross+t,along))===1)wall++;
   if(wall>=Math.max(2,Math.floor(short/3))){
    const span=Math.ceil(Math.max(short*1.5,probe)),crosses=[];
    for(let t=-span;t<=span;t++)if((horizontal?at(along,cross+t):at(cross+t,along))===1)crosses.push(Math.floor(cross+t));
    return {along,min:Math.min(...crosses),max:Math.max(...crosses)+1};
   }
  }
  return null;
 };
 const aCap=cap(-1),bCap=cap(1),endA=!!aCap,endB=!!bCap;if(!endA||!endB)return {...diagnostic,valid:false,reason:'窗的两端缺少墙体支持',endA,endB};
 const crossMin=Math.max(aCap.min,bCap.min),crossMax=Math.min(aCap.max,bCap.max);
 if(crossMax-crossMin<2)return {...diagnostic,valid:false,reason:'两端墙体不在同一墙带上',endA,endB};
 let sideA=0,sideB=0;
 for(let n=1;n<=5;n++){
  const along=start+long*n/6,a=cross-short/2-probe,b=cross+short/2+probe;
  sideA+=Number((horizontal?at(along,a):at(a,along))===4);
  sideB+=Number((horizontal?at(along,b):at(b,along))===4);
 }
 if(Math.max(sideA,sideB)<3||Math.min(sideA,sideB)>2)return {...diagnostic,valid:false,reason:'没有可验证的室内/屋外两侧',endA,endB,sideA,sideB};
 // 洞口内没有 wall 像素是正常现象；用两端真实墙带的交集恢复窗台和过梁，不能只靠旧墙块碰巧覆盖洞口。
 const footprint=horizontal?{x0:box.x,x1:box.x+box.w,y0:crossMin,y1:crossMax}:{x0:crossMin,x1:crossMax,y0:box.y,y1:box.y+box.h};
 return {...diagnostic,valid:true,onExteriorWall:true,endA,endB,outsideSide:sideA>sideB?-1:1,sideA,sideB,footprint};
}

const openingOverlap=(a,b)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y))/Math.min(a.w*a.h,b.w*b.h);
function withWallSupport(box,check){
 const f=check.bay?check.footprint:null;
 return f?{...box,sourceBox:{...box},x:f.x0,y:f.y0,w:f.x1-f.x0,h:f.y1-f.y0,cx:(f.x0+f.x1)/2,cy:(f.y0+f.y1)/2,horizontal:box.horizontal??(box.w>=box.h),wallSupport:check}:{...box,wallSupport:check};
}
export function selectSupportedWindows(mask,width,height,windows,frame,{blocks,recoverFromSegmentation=false,doors=[]}={}){
 const kept=[],rejected=[],checks=[],recovered=[],reclassifiedDoors=[];blocks??=wallBlocksFromMask(mask,width,height);
 for(const [index,box] of windows.entries()){
  const check=assessWindowSupport(mask,width,height,box,frame,{blocks});checks.push({index,box,...check});
  if(check.valid)kept.push(withWallSupport(box,check));else rejected.push({index,box,...check});
 }
 if(recoverFromSegmentation)for(const box of windowsFromMask(mask,width,height)){
  if(kept.some(w=>openingOverlap(w,box)>.5))continue;
  const check=assessWindowSupport(mask,width,height,box,frame,{blocks});
  if(!check.valid||box.area/(box.w*box.h)<.6&&!check.bay)continue;
  // 检测器把真窗叫成门时，必须同时有分割窗类和外墙证据；不能单凭低置信度就改分类。
  // U 形框包含窗台和内缘，不能仅因 bbox 重叠就删除仍待人工确认的门候选。
  const conflicts=check.bay?[]:doors.filter(d=>openingOverlap(d,box)>.65);
  const windowBox=withWallSupport({...box,cls:'window',source:'segmentation'},check);kept.push(windowBox);
  recovered.push({box,...check});reclassifiedDoors.push(...conflicts);
 }
 return {windows:kept,doors:doors.filter(d=>!reclassifiedDoors.includes(d)),rejected,checks,recovered,reclassifiedDoors};
}
