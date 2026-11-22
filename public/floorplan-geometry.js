import {wallLinesFromMask,wallBlocksFromMask} from './wall-onnx.js';
import {roomsFromMask} from './room-polygon.js';
import {wallContoursFromMask} from './wall-contours.js';
import {selectOpenings,openingsToHome} from './opening-detection.js';
import {roomsFromPolygons} from './home-domain.js';

// 上传、模型识别和探针共用同一入口，避免验收时有窗、实际主流程却只取门。
export function geometryFromSegmentation(result,boxes){
 const {mask,width,height}=result,minLength=Math.max(18,Math.round(Math.max(width,height)*.03));
 const openings=selectOpenings(boxes,mask,width,height);
 const lines=wallLinesFromMask(mask,width,height,{minLenH:minLength,minLenV:minLength,gap:8});
 const blocks=wallBlocksFromMask(mask,width,height),contours=wallContoursFromMask(mask,width,height);
 let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
 for(let i=0;i<mask.length;i++)if(mask[i]!==4){const x=i%width,y=Math.floor(i/width);x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
 const frame=Number.isFinite(x0)?{x:x0,y:y0,w:Math.max(1,x1-x0),h:Math.max(1,y1-y0)}:null;
 return {...openings,polygons:roomsFromMask(mask,width,height),lines:{...lines,blocks,contours},frame,segWidth:width,segHeight:height};
}

export function homeFromRecognition(result,width,depth,options={}){
 const home=roomsFromPolygons(result.polygons,result.segWidth,result.segHeight,width,depth,{...options,frame:result.frame,doors:result.doors,windows:result.windows,walls:result.lines});
 home.windowSource=result.windowSource;
 return home;
}

export function attachDetectedOpenings(home,result){
 if(!result?.frame)return home;
 home.doors=openingsToHome(result.doors,result.frame,home.width,home.depth);
 home.windows=openingsToHome(result.windows,result.frame,home.width,home.depth);
 home.windowSource=result.windowSource;
 return home;
}

// 用户改长宽后，墙与窗也必须跟着同轴缩放，否则保存再打开就会看到窗漂离墙面。
export function scaleDetectedGeometry(home,axis,factor){
 if(!['width','depth'].includes(axis)||!Number.isFinite(factor)||factor<=0)throw new Error('平面缩放参数无效');
 const horizontal=axis==='width',coordinate=horizontal?'x':'z',size=horizontal?'w':'d';
 for(const list of [home.doors,home.windows])for(const o of list||[]){o[coordinate]*=factor;o[size]*=factor;}
 for(const room of home.rooms||[])for(const p of room.polygon||[])p[horizontal?0:1]*=factor;
 for(const wall of home.walls?.h||[]){if(horizontal){wall.x0*=factor;wall.x1*=factor;}else{wall.z*=factor;if(Number.isFinite(wall.thickness))wall.thickness*=factor;}}
 for(const wall of home.walls?.v||[]){if(horizontal){wall.x*=factor;if(Number.isFinite(wall.thickness))wall.thickness*=factor;}else{wall.z0*=factor;wall.z1*=factor;}}
 for(const b of home.walls?.blocks||[]){b[horizontal?'x0':'y0']*=factor;b[horizontal?'x1':'y1']*=factor;}
 for(const s of home.walls?.contours||[])for(const ring of [s.outer,...(s.holes||[])])for(const p of ring)p[horizontal?0:1]*=factor;
}
