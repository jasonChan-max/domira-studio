import {doorsFromMask,windowsFromMask} from './room-polygon.js';

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
 return opening;
 });
}
