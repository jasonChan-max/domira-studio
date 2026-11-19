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
 return (openings||[]).filter(b=>[b.cx,b.cy,b.w,b.h].every(Number.isFinite)&&b.w>0&&b.h>0).map(b=>({
  x:(b.cx-frame.x-frame.w/2)*width/frame.w,z:(b.cy-frame.y-frame.h/2)*depth/frame.h,
  w:b.w*width/frame.w,d:b.h*depth/frame.h,horizontal:!!b.horizontal,
 }));
}
