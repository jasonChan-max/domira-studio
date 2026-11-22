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

export function roomsWithinHouse(rooms,frame){return frame?rooms.filter(r=>overlaps(roomBounds(r),frame)):rooms;}

export function closeDetectedDoorFloors(mask,width,height,doors){
 const closed=mask.slice();
 for(const b of doors){
  if(![b.x,b.y,b.w,b.h].every(Number.isFinite)||b.w<=0||b.h<=0)continue;
  for(let y=Math.max(0,Math.floor(b.y));y<Math.min(height,Math.ceil(b.y+b.h));y++)for(let x=Math.max(0,Math.floor(b.x));x<Math.min(width,Math.ceil(b.x+b.w));x++)if(closed[y*width+x]===0)closed[y*width+x]=2;
 }
 // 封门只用于房间连通分析；原始 wall/window 像素不变，不能把探针和渲染的数据也改掉。
 return closed;
}

export function assessWindowSupport(mask,width,height,box,frame){
 if(!frame||![box.x,box.y,box.w,box.h].every(Number.isFinite)||box.w<=0||box.h<=0)return {valid:false,reason:'窗坐标无效'};
 const horizontal=box.w>=box.h,cx=box.x+box.w/2,cy=box.y+box.h/2;
 if(cx<frame.x||cx>frame.x+frame.w||cy<frame.y||cy>frame.y+frame.h)return {valid:false,reason:'窗中心位于房屋主体之外'};
 const at=(x,y)=>x>=0&&y>=0&&x<width&&y<height?mask[Math.floor(y)*width+Math.floor(x)]:4;
 const probe=Math.max(3,Math.round(Math.max(width,height)*.015));
 const short=horizontal?box.h:box.w,long=horizontal?box.w:box.h;
 const start=horizontal?box.x:box.y,end=start+long,cross=horizontal?cy:cx;
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
 const aCap=cap(-1),bCap=cap(1),endA=!!aCap,endB=!!bCap;if(!endA||!endB)return {valid:false,reason:'窗的两端缺少墙体支持',endA,endB};
 const crossMin=Math.max(aCap.min,bCap.min),crossMax=Math.min(aCap.max,bCap.max);
 if(crossMax-crossMin<2)return {valid:false,reason:'两端墙体不在同一墙带上',endA,endB};
 let sideA=0,sideB=0;
 for(let n=1;n<=5;n++){
  const along=start+long*n/6,a=cross-short/2-probe,b=cross+short/2+probe;
  sideA+=Number((horizontal?at(along,a):at(a,along))===4);
  sideB+=Number((horizontal?at(along,b):at(b,along))===4);
 }
 if(Math.max(sideA,sideB)<3||Math.min(sideA,sideB)>2)return {valid:false,reason:'没有可验证的室内/屋外两侧',endA,endB,sideA,sideB};
 // 洞口内没有 wall 像素是正常现象；用两端真实墙带的交集恢复窗台和过梁，不能只靠旧墙块碰巧覆盖洞口。
 const footprint=horizontal?{x0:box.x,x1:box.x+box.w,y0:crossMin,y1:crossMax}:{x0:crossMin,x1:crossMax,y0:box.y,y1:box.y+box.h};
 return {valid:true,endA,endB,outsideSide:sideA>sideB?-1:1,sideA,sideB,footprint};
}

export function selectSupportedWindows(mask,width,height,windows,frame){
 const kept=[],rejected=[],checks=[];
 for(const [index,box] of windows.entries()){
  const check=assessWindowSupport(mask,width,height,box,frame);checks.push({index,...check});
  if(check.valid)kept.push({...box,wallSupport:check});else rejected.push({index,box,reason:check.reason});
 }
 return {windows:kept,rejected,checks};
}
