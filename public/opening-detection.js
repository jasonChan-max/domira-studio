import {doorsFromMask,windowsFromMask} from './room-polygon.js';

export const DOOR_LIMITS=Object.freeze({minWidth:.45,maxWidth:2,minThickness:.10,maxThickness:.40,minScore:.30});

export function doorsToHome(openings,frame,width,depth){
 const doors=[],checks=[],rejected=[];
 const between=(value,min,max)=>value>=min-1e-9&&value<=max+1e-9;
 for(const [index,box] of (openings||[]).entries()){
  const source={...box,cx:box.cx??box.x+box.w/2,cy:box.cy??box.y+box.h/2},converted=openingsToHome([source],frame,width,depth)[0];
  const door=converted&&['x','z','w','d'].every(k=>Number.isFinite(converted[k]))?converted:null;
  const longSide=door?Math.max(door.w,door.d):null,shortSide=door?Math.min(door.w,door.d):null,score=box.score??null;
  const reasons=[];
  if(!door)reasons.push('门坐标或房屋比例尺无效');
  else{
   if(!between(longSide,DOOR_LIMITS.minWidth,DOOR_LIMITS.maxWidth))reasons.push('门宽不在 0.45–2.0m');
   if(!between(shortSide,DOOR_LIMITS.minThickness,DOOR_LIMITS.maxThickness))reasons.push('门厚不在 0.10–0.40m');
  }
  // 分割回退没有检测置信度，不能伪造分数；有 score 的检测框则必须通过同一置信度闸。
  if(score!==null&&(!Number.isFinite(score)||score<DOOR_LIMITS.minScore))reasons.push('门检测置信度低于 0.30 或无效');
  const check={index,box:{x:box.x,y:box.y,w:box.w,h:box.h},score,longSide,shortSide,valid:reasons.length===0,reasons};checks.push(check);
  if(check.valid)doors.push({...door,...(score===null?{}:{score}),sourceIndex:index});else rejected.push(check);
 }
 return {doors,raw:checks.length,kept:doors.length,checks,rejected};
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
