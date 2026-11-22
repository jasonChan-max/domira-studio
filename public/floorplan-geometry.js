import {wallLinesFromMask,wallBlocksFromMask} from './wall-onnx.js';
import {roomsFromMask} from './room-polygon.js';
import {wallContoursFromMask} from './wall-contours.js';
import {selectOpenings,openingsToHome} from './opening-detection.js';
import {roomsFromPolygons} from './home-domain.js';
import {closeDetectedDoorFloors,selectHouseContours,roomsWithinHouse,mergeRoomFragments,selectSupportedWindows} from './plan-selection.js';

// 上传、模型识别和探针共用同一入口，避免验收时有窗、实际主流程却只取门。
export function geometryFromSegmentation(result,boxes,options={}){
 const {mask,width,height}=result,minLength=Math.max(18,Math.round(Math.max(width,height)*.03));
 const openings=selectOpenings(boxes,mask,width,height);
 const lines=wallLinesFromMask(mask,width,height,{minLenH:minLength,minLenV:minLength,gap:8});
 const blocks=wallBlocksFromMask(mask,width,height),rawContours=wallContoursFromMask(mask,width,height,options);
 const initialRooms=roomsFromMask(mask,width,height),selection=selectHouseContours(rawContours,initialRooms),{contours,frame}=selection;
 const supported=selectSupportedWindows(mask,width,height,openings.windows,frame,{blocks,recoverFromSegmentation:openings.windowSource==='yolo',doors:openings.doors});
 const closedMask=closeDetectedDoorFloors(mask,width,height,supported.doors),roomCandidates=roomsFromMask(closedMask,width,height);
 const inside=roomsWithinHouse(roomCandidates,frame),merged=mergeRoomFragments(inside,closedMask,width,height),polygons=merged.rooms;
 return {...openings,doors:supported.doors,windows:supported.windows,windowSource:supported.recovered.length?'yolo+segmentation':openings.windowSource,polygons,lines:{...lines,blocks,contours},frame,segWidth:width,segHeight:height,
  selection:{contours:{raw:rawContours.length,kept:contours.length,rejected:selection.removed,orthogonalize:options.orthogonalize!==false},rooms:{candidates:roomCandidates.length,insideHouse:inside.length,merged:merged.merged},windows:{raw:openings.windows.length,kept:supported.windows.length,checks:supported.checks,rejected:supported.rejected,recovered:supported.recovered,reclassifiedDoors:supported.reclassifiedDoors}}};
}

export function homeFromRecognition(result,width,depth,options={}){
 const home=roomsFromPolygons(result.polygons,result.segWidth,result.segHeight,width,depth,{...options,frame:result.frame,doors:result.doors,windows:result.windows,walls:result.lines});
 // 米制下限必须在数据层执行；不能等 UI 报错后再靠用户删掉窄缝假房间。
 const rejected=home.rooms.filter(r=>Math.min(r.width,r.depth)<.6);
 home.rooms=home.rooms.filter(r=>Math.min(r.width,r.depth)>=.6);
 if(!home.rooms.length)throw new Error('没有短边达到 0.6m 的有效房间，请核对比例尺或图纸');
 home.rooms.forEach((r,i)=>{r.id='space-'+i;});
 home.summary='房間位置與形狀由分割模型直接從圖上辨識（'+home.rooms.length+' 間），不是 AI 目測的矩形。';
 home.selection={...result.selection,rooms:{...result.selection?.rooms,removedBelowMinimum:rejected.map(r=>({name:r.name,width:r.width,depth:r.depth})),kept:home.rooms.length}};
 home.windowSource=result.windowSource;
 home.windows=openingsToHome(result.windows,result.frame,width,depth);
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
 for(const list of [home.doors,home.windows])for(const o of list||[]){o[coordinate]*=factor;o[size]*=factor;if(o.wallFootprint){o.wallFootprint[horizontal?'x0':'y0']*=factor;o.wallFootprint[horizontal?'x1':'y1']*=factor;}}
 for(const room of home.rooms||[])for(const p of room.polygon||[])p[horizontal?0:1]*=factor;
 for(const wall of home.walls?.h||[]){if(horizontal){wall.x0*=factor;wall.x1*=factor;}else{wall.z*=factor;if(Number.isFinite(wall.thickness))wall.thickness*=factor;}}
 for(const wall of home.walls?.v||[]){if(horizontal){wall.x*=factor;if(Number.isFinite(wall.thickness))wall.thickness*=factor;}else{wall.z0*=factor;wall.z1*=factor;}}
 for(const b of home.walls?.blocks||[]){b[horizontal?'x0':'y0']*=factor;b[horizontal?'x1':'y1']*=factor;}
 for(const s of home.walls?.contours||[])for(const ring of [s.outer,...(s.holes||[])])for(const p of ring)p[horizontal?0:1]*=factor;
}
