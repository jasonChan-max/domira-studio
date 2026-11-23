import clipping from './vendor/polygon-clipping.js';
import {signedArea} from './wall-contours.js';

const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const repeatedSamples=evidence=>new Set(evidence.map(s=>s.fraction)).size>=3;
const rect=(x0,y0,x1,y1)=>({x0:Math.min(x0,x1),y0:Math.min(y0,y1),x1:Math.max(x0,x1),y1:Math.max(y0,y1)});
const ring=b=>[[b.x0,b.y0],[b.x1,b.y0],[b.x1,b.y1],[b.x0,b.y1]];

export function assessBayWindowSupport(mask,width,height,box,wall){
 if(!wall||!(wall.thickness>0))return null;
 const horizontal=box.w>=box.h,start=horizontal?box.x:box.y,length=horizontal?box.w:box.h;
 const center=horizontal?box.y+box.h/2:box.x+box.w/2,short=horizontal?box.h:box.w,sign=Math.sign(center-wall.centerLine);
 if(!sign)return null;
 const at=(along,normal)=>{const x=Math.floor(horizontal?along:normal),y=Math.floor(horizontal?normal:along);return x>=0&&x<width&&y>=0&&y<height?mask[y*width+x]:4;};
 const from=Math.floor(sign*wall.centerLine-wall.thickness*2),to=Math.ceil(sign*center+short/2+wall.thickness*1.5),evidence=[],outerEvidence=[];
 for(const fraction of [.15,.275,.4,.5,.6,.725,.85]){
  const along=start+length*fraction,runs=[];
  for(let t=from;t<to;){const cls=at(along,sign*t);let end=t+1;while(end<to&&at(along,sign*end)===cls)end++;runs.push({from:t,to:end,cls});t=end;}
  const physical=r=>{const a=sign*r.from,b=sign*(r.to-1);return {center:(a+b)/2+.5,thickness:r.to-r.from};};
  let sample;
  for(let i=0;i<runs.length-1;i++){
   const front=runs[i],outside=runs[i+1];
   if(front.cls!==3||front.to-front.from<2||outside.cls!==4||outside.to-outside.from<Math.max(2,wall.thickness*.3))continue;
   outerEvidence.push({fraction,along,front:physical(front),run:front});
   for(let j=i-2;j>=0;j--){
    const root=runs[j];if(![1,2,3].includes(root.cls)||root.to-root.from<2)continue;
    const gap=runs.slice(j+1,i),floor=gap.filter(r=>r.cls===0).reduce((n,r)=>n+r.to-r.from,0),air=gap.filter(r=>r.cls===4).reduce((n,r)=>n+r.to-r.from,0),span=front.from-root.to;
    if(span<3||floor/span<.6||air/span>.1||at(along,sign*(root.from-2))!==0)continue;
    sample={fraction,root:physical(root),front:physical(front),floorPixels:floor};break;
   }
   if(sample)break;
  }
  if(sample)evidence.push(sample);
 }
 if(!repeatedSamples(evidence)&&repeatedSamples(outerEvidence)){
  const frontStart=median(outerEvidence.map(s=>s.run.from));
  const capRoot=along=>{
   for(let step=0;step<=Math.ceil(wall.thickness*2);step++)for(const offset of step?[-step,step]:[0]){
    let count=0,last=-Infinity;
    for(let t=from;t<frontStart-2;t++)if(at(along+offset,sign*t)===1){count++;last=t;}
    if(count>=2)return sign*(last+.5-wall.thickness/2)+.5;
   }
   return null;
  };
  const a=capRoot(start),b=capRoot(start+length);
  // 模型可能把凸窗内缘也涂成地板；此时两端真实墙垛和三面窗仍须共同支持，不能凭一个远框造窗。
  if(a!==null&&b!==null&&Math.abs(a-b)<=wall.thickness*1.5){
   const root=median([a,b]);
   for(const s of outerEvidence){
    let floor=0,air=0,count=0;
    for(let t=Math.ceil(sign*root);t<s.run.from;t++){const cls=at(s.along,sign*t);floor+=Number(cls===0);air+=Number(cls===4);count++;}
    if(count>=3&&floor/count>=.6&&air/count<=.1)evidence.push({fraction:s.fraction,root:{center:root,thickness:wall.thickness},front:s.front,floorPixels:floor,rootSource:'两端墙垛'});
   }
  }
 }
 // 只有「室内—内缘—凸出地板—外缘窗—屋外」的重复证据，才能补墙；远处的尺寸线不能靠距离放宽混进来。
 if(!repeatedSamples(evidence))return null;
 const root=median(evidence.map(s=>s.root.center)),front=median(evidence.map(s=>s.front.center)),thickness=median(evidence.map(s=>s.front.thickness));
 if(sign*(front-root)<Math.max(3,thickness))return null;
 const capSupport=along=>{
  let best=0;
  for(let offset=-Math.ceil(thickness);offset<=Math.ceil(thickness);offset++){
   let count=0;for(let n=1;n<=7;n++)count+=Number(at(along+offset,root+(front-root)*n/8)===3);
   best=Math.max(best,count/7);
  }
  return best;
 };
 const endA=capSupport(start),endB=capSupport(start+length);if(endA<.6||endB<.6)return null;
 const half=thickness/2;
 const footprint=horizontal?rect(start,front-half,start+length,front+half):rect(front-half,start,front+half,start+length);
 const arms=[start,start+length].map(along=>({horizontal:!horizontal,footprint:horizontal?rect(along-half,root,along+half,front):rect(root,along-half,front,along+half)}));
 const seat=horizontal?rect(start-half,root,start+length+half,front+sign*half):rect(root,start-half,front+sign*half,start+length+half);
 const clip=horizontal?rect(start-half,sign>0?root:0,start+length+half,sign>0?height:root):rect(sign>0?root:0,start-half,sign>0?width:root,start+length+half);
 return {valid:true,onExteriorWall:true,endA:true,endB:true,outsideSide:sign,footprint,
  bay:{side:horizontal?(sign>0?'bottom':'top'):(sign>0?'right':'left'),rootLine:root,frontLine:front,projection:Math.abs(front-root),thickness,panels:[{horizontal,footprint},...arms],seatFootprint:seat,floorClip:clip,evidence,capSupport:{endA,endB}}};
}

export function clipBayFloorPolygons(polygons,windows){
 let result=polygons;const changes=[];
 for(const [windowIndex,w] of windows.entries()){
  const clip=w.wallSupport?.bay?.floorClip;if(!clip)continue;
  result=result.flatMap((p,index)=>{
   const before=Math.abs(signedArea(p.polygon));let parts=clipping.difference([p.polygon],[ring(clip)]);
   let after=parts.reduce((sum,part)=>sum+Math.abs(signedArea(part[0])),0);
   if(before-after<1e-6)return [p];
   if(after<before*.05){parts=[];after=0;}
   changes.push({windowIndex,index,bbox:p.bbox,areaBefore:before,areaAfter:after,action:parts.length?'裁去飘窗窗台范围内的地板':'排除被当作独立房间的飘窗地板'});
   // 三面玻璃围住的是窗台，不是可步入的独立房间；裁切延至屋外，不能留下一个被忽略的多边形内孔。
   return parts.filter(part=>part[0].length>=4).map(part=>{
    const polygon=part[0].slice(0,-1),xs=polygon.map(p=>p[0]),ys=polygon.map(p=>p[1]);
    return {...p,polygon,area:Math.abs(signedArea(polygon)),bbox:[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]};
   });
  });
 }
 return {polygons:result,changes};
}

export function windowPanels(window){return window.bay?.panels?.length?window.bay.panels:[window];}
export function rectangleRing(bounds){return ring(bounds);}
