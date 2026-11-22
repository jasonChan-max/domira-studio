import clipping from './vendor/polygon-clipping.js';

// 沿像素单元的边走，而不是取连通域外接框；这样凹角和房间空洞不会被填实。
export function wallContoursFromMask(mask,width,height,{epsilon=1,orthogonalize=true,mergeCollinear=true,filterSmallContours=true}={}){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||mask.length!==width*height)throw new Error('墙体 mask 尺寸无效');
 if(!Number.isFinite(epsilon)||epsilon<0||epsilon>2)throw new Error('轮廓简化容差必须为 0–2 像素');
 const stride=width+1,edges=[],outgoing=new Map();
 const add=(x0,y0,x1,y1,dir)=>{const start=y0*stride+x0,end=y1*stride+x1,index=edges.length;edges.push({start,end,dir});if(!outgoing.has(start))outgoing.set(start,[]);outgoing.get(start).push(index);};
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=y*width+x;if(mask[i]!==1)continue;
  if(y===0||mask[i-width]!==1)add(x,y,x+1,y,0);
  if(x===width-1||mask[i+1]!==1)add(x+1,y,x+1,y+1,1);
  if(y===height-1||mask[i+width]!==1)add(x+1,y+1,x,y+1,2);
  if(x===0||mask[i-1]!==1)add(x,y+1,x,y,3);
 }
 const used=new Uint8Array(edges.length),rings=[];
 for(let start=0;start<edges.length;start++){
  if(used[start])continue;const points=[];let at=start;
  for(let count=0;count<=edges.length;count++){
   const e=edges[at];used[at]=1;points.push([e.start%stride,Math.floor(e.start/stride)]);
   if(e.end===edges[start].start)break;
   // 对角接触处优先右转，避免把两个仅顶点接触的墙岛串成自交轮廓。
   const candidates=(outgoing.get(e.end)||[]).filter(index=>!used[index]);
   const rank=dir=>({1:0,0:1,3:2,2:3})[(dir-e.dir+4)%4];
   candidates.sort((a,b)=>rank(edges[a].dir)-rank(edges[b].dir));
   if(!candidates.length)throw new Error('墙体轮廓未闭合');at=candidates[0];
  }
  const ring=removeCollinear(points),area=signedArea(ring);
  if(ring.length>=3&&area!==0)rings.push({points:simplifyRing(ring,epsilon),area});
 }
 const solids=rings.filter(r=>r.area>0).map(r=>({outer:r.points,holes:[],areaPixels:r.area}));
 for(const hole of rings.filter(r=>r.area<0)){
  const parent=solids.filter(s=>pointInRing(hole.points[0],s.outer)).sort((a,b)=>a.areaPixels-b.areaPixels)[0];
  if(!parent)throw new Error('墙体内部空洞缺少外轮廓');parent.holes.push(hole.points);parent.areaPixels+=hole.area;
 }
 const thickness=medianWallThickness(mask,width,height),filtered=filterSmallContours?filterSmallWallContours(solids,thickness):{contours:solids,removed:[],filledHoles:[]};
 const deviation=Math.max(1,Math.min(8,Math.max(width,height)/150));
 const baseline=orthogonalize?orthogonalizeWallContours(filtered.contours,{maxDeviation:deviation}):filtered.contours;
 let result=baseline,fitApplied=false,fitFidelity=null;
 // 已经稀疏的轮廓不必再拟合一次，避免干净小户型为了省几个点而改变真实墙角。
 if(mergeCollinear&&vertexCount(baseline)>120){
  const fitted=mergeCollinearWallContours(filtered.contours,{maxJitter:Math.max(1,Math.min(6,thickness/2))});
  const candidate=orthogonalize?orthogonalizeWallContours(fitted,{maxDeviation:deviation,maxLossRatio:.02}):fitted;
  const before=wallMaskFidelity(baseline,mask,width,height),after=wallMaskFidelity(candidate,mask,width,height);
  // 面积相等不代表覆盖相等；实际栅格覆盖也必须过线，才能替换原来的轮廓。
  if(vertexCount(candidate)<vertexCount(baseline)&&after.recall>=(before.recall>=.95?.95:.92)&&after.precision>=before.precision-.04){result=candidate;fitApplied=true;}
  fitFidelity={before,after};
 }
 Object.defineProperty(result,'diagnostics',{value:{medianThickness:thickness,areaThreshold:thickness*thickness,removed:filtered.removed,filledHoles:filtered.filledHoles,mergeCollinear,fitApplied,baselineVertices:vertexCount(baseline),fitFidelity}});
 return result;
}

export function signedArea(ring){let area=0;for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];area+=a[0]*b[1]-b[0]*a[1];}return area/2;}
export function pointInRing([x,y],ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
function removeCollinear(ring){return ring.filter((p,i)=>{const a=ring[(i+ring.length-1)%ring.length],b=ring[(i+1)%ring.length];return (p[0]-a[0])*(b[1]-p[1])!==(p[1]-a[1])*(b[0]-p[0]);});}
function segmentDistanceSquared(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));return (p[0]-a[0]-t*dx)**2+(p[1]-a[1]-t*dy)**2;}
function simplifyOpen(points,epsilon){
 if(points.length<3)return points;const keep=new Uint8Array(points.length),stack=[[0,points.length-1]];keep[0]=keep[points.length-1]=1;
 while(stack.length){const [a,b]=stack.pop();let max=epsilon*epsilon,index=-1;for(let i=a+1;i<b;i++){const d=segmentDistanceSquared(points[i],points[a],points[b]);if(d>max){max=d;index=i;}}if(index>=0){keep[index]=1;stack.push([a,index],[index,b]);}}
 return points.filter((_,i)=>keep[i]);
}
function simplifyRing(ring,epsilon){
 if(epsilon===0||ring.length<5)return ring;
 const sign=Math.sign(signedArea(ring)),anchors=[0];
 // 长边围成的凹角必须留住；1px 台阶可平滑，但不能把门口或 L 形拐角拉直。
 for(let i=1;i<ring.length;i++){const a=ring[(i+ring.length-1)%ring.length],p=ring[i],b=ring[(i+1)%ring.length];const cross=(p[0]-a[0])*(b[1]-p[1])-(p[1]-a[1])*(b[0]-p[0]);if(cross*sign<0&&Math.hypot(p[0]-a[0],p[1]-a[1])>=2&&Math.hypot(b[0]-p[0],b[1]-p[1])>=2)anchors.push(i);}
 if(anchors.length===1){let far=1;for(let i=2;i<ring.length;i++)if(Math.hypot(ring[i][0]-ring[0][0],ring[i][1]-ring[0][1])>Math.hypot(ring[far][0]-ring[0][0],ring[far][1]-ring[0][1]))far=i;anchors.push(far);}
 anchors.sort((a,b)=>a-b);const out=[];
 for(let i=0;i<anchors.length;i++){const start=anchors[i],end=i+1<anchors.length?anchors[i+1]:ring.length+anchors[0],part=[];for(let j=start;j<=end;j++)part.push(ring[j%ring.length]);out.push(...simplifyOpen(part,epsilon).slice(0,-1));}
 return out.length>=3&&signedArea(out)*sign>0?out:ring;
}

const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const equal=(a,b)=>Math.abs(a[0]-b[0])<1e-8&&Math.abs(a[1]-b[1])<1e-8;
function cleanRing(ring){
 const unique=ring.filter((p,i)=>!equal(p,ring[(i+ring.length-1)%ring.length]));
 return removeCollinear(unique);
}
function segmentsMeet(a,b,c,d){
 const on=(p,a,b)=>Math.abs(cross(a,b,p))<1e-8&&p[0]>=Math.min(a[0],b[0])-1e-8&&p[0]<=Math.max(a[0],b[0])+1e-8&&p[1]>=Math.min(a[1],b[1])-1e-8&&p[1]<=Math.max(a[1],b[1])+1e-8;
 return cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0||on(c,a,b)||on(d,a,b)||on(a,c,d)||on(b,c,d);
}
export function isSimpleRing(ring){
 if(ring.length<3||Math.abs(signedArea(ring))<1e-8)return false;
 for(let i=0;i<ring.length;i++){
  if(equal(ring[i],ring[(i+1)%ring.length]))return false;
  for(let j=i+1;j<ring.length;j++)if(j!==i+1&&!(i===0&&j===ring.length-1)&&segmentsMeet(ring[i],ring[(i+1)%ring.length],ring[j],ring[(j+1)%ring.length]))return false;
 }
 return true;
}
const shapeRings=s=>[s.outer,...(s.holes||[])];
const shapeArea=s=>shapeRings(s).reduce((sum,r)=>sum+signedArea(r),0);
function validShape(shape){
 const rings=shapeRings(shape);
 if(!rings.every(isSimpleRing)||signedArea(shape.outer)<=0||shape.holes.some(r=>signedArea(r)>=0||!pointInRing(r[0],shape.outer)))return false;
 for(let i=0;i<rings.length;i++)for(let j=i+1;j<rings.length;j++){
  const a=rings[i],b=rings[j];
  if(i>0&&(pointInRing(a[0],b)||pointInRing(b[0],a)))return false;
  for(let n=0;n<a.length;n++)for(let m=0;m<b.length;m++)if(segmentsMeet(a[n],a[(n+1)%a.length],b[m],b[(m+1)%b.length]))return false;
 }
 return true;
}
function replaceRing(shape,index,ring){return {...shape,outer:index===0?ring:shape.outer,holes:shape.holes.map((r,i)=>i+1===index?ring:r)};}
function intersection(a,b,c,d){
 const dx=b[0]-a[0],dy=b[1]-a[1],ex=d[0]-c[0],ey=d[1]-c[1],det=dx*ey-dy*ex;
 if(Math.abs(det)<1e-8)return null;
 const t=((c[0]-a[0])*ey-(c[1]-a[1])*ex)/det;return [a[0]+t*dx,a[1]+t*dy];
}

const vertexCount=shapes=>shapes.reduce((sum,s)=>sum+s.outer.length+s.holes.reduce((n,r)=>n+r.length,0),0);
export function medianWallThickness(mask,width,height){
 const horizontal=new Uint32Array(mask.length),histogram=new Uint32Array(Math.max(width,height)+1);let pixels=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;){
  if(mask[y*width+x]!==1){x++;continue;}let end=x+1;while(end<width&&mask[y*width+end]===1)end++;
  horizontal.fill(end-x,y*width+x,y*width+end);x=end;
 }
 for(let x=0;x<width;x++)for(let y=0;y<height;){
  if(mask[y*width+x]!==1){y++;continue;}let end=y+1;while(end<height&&mask[end*width+x]===1)end++;
  for(let at=y;at<end;at++){histogram[Math.min(horizontal[at*width+x],end-y)]++;pixels++;}y=end;
 }
 let total=0;for(let thickness=1;thickness<histogram.length;thickness++){total+=histogram[thickness];if(pixels&&total>=pixels/2)return thickness;}
 return 0;
}
export function filterSmallWallContours(source,thickness){
 const threshold=thickness*thickness,removed=[],filledHoles=[];
 const contours=source.flatMap((s,index)=>{
  const area=s.areaPixels??shapeArea(s);
  if(area<threshold){removed.push({index,area,threshold,bounds:[Math.min(...s.outer.map(p=>p[0])),Math.min(...s.outer.map(p=>p[1])),Math.max(...s.outer.map(p=>p[0])),Math.max(...s.outer.map(p=>p[1]))]});return [];}
  // 墙内的孤立像素孔也会生成一圈极短边；只填相同相对尺度以下的孔，正常房间空洞仍保留。
  const holes=(s.holes||[]).filter((r,hole)=>{const area=Math.abs(signedArea(r));if(area>=threshold)return true;filledHoles.push({index,hole,area,threshold});return false;});
  return [{...s,holes}];
 });
 return {contours,removed,filledHoles};
}

export function wallMaskFidelity(shapes,mask,width,height){
 const covered=new Uint8Array(mask.length);
 for(const shape of shapes){
  const rings=shapeRings(shape),ys=shape.outer.map(p=>p[1]);
  for(let y=Math.max(0,Math.ceil(Math.min(...ys)-.5));y<Math.min(height,Math.ceil(Math.max(...ys)-.5));y++){
   const row=y+.5,crossings=[];
   for(const ring of rings)for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];if((a[1]>row)!==(b[1]>row))crossings.push(a[0]+(row-a[1])*(b[0]-a[0])/(b[1]-a[1]));}
   crossings.sort((a,b)=>a-b);
   for(let i=0;i+1<crossings.length;i+=2){const start=Math.max(0,Math.ceil(crossings[i]-.5)),end=Math.min(width,Math.ceil(crossings[i+1]-.5));if(end>start)covered.fill(1,y*width+start,y*width+end);}
  }
 }
 let tp=0,fp=0,fn=0;for(let i=0;i<mask.length;i++){if(covered[i]&&mask[i]===1)tp++;else if(covered[i])fp++;else if(mask[i]===1)fn++;}
 return {precision:tp+fp?tp/(tp+fp):1,recall:tp+fn?tp/(tp+fn):1,extraPixels:fp,missedPixels:fn};
}

export function mergeCollinearWallContours(source,{maxJitter=6,angleDegrees=15}={}){
 if(!Number.isFinite(maxJitter)||maxJitter<0||!Number.isFinite(angleDegrees)||angleDegrees<0||angleDegrees>15)throw new Error('长直段拟合参数无效');
 const shapes=source.map(s=>({...s,outer:s.outer.map(p=>[...p]),holes:s.holes.map(r=>r.map(p=>[...p]))})),tangent=Math.tan(angleDegrees*Math.PI/180);
 const onAxis=(a,b,axis,coord)=>{const t=(coord-a[1-axis])/(b[1-axis]-a[1-axis]);const p=[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])];p[1-axis]=coord;return p;};
 for(let si=0;si<shapes.length;si++)for(let ri=0;ri<shapeRings(shapes[si]).length;ri++){
  let ring=shapeRings(shapes[si])[ri];
  while(ring.length>4){let best;
   for(let i=0;i<ring.length;i++)for(const axis of [0,1]){
    const start=ring[i],prev=ring[(i+ring.length-1)%ring.length],crossAxis=1-axis;
    if(Math.abs(prev[axis]-start[axis])>Math.abs(prev[crossAxis]-start[crossAxis])*tangent||equal(prev,start))continue;
    let low=start[crossAxis],high=low,min=start[axis],max=min;
    for(let span=1;span<ring.length-1;span++){
     const end=ring[(i+span)%ring.length],next=ring[(i+span+1)%ring.length];low=Math.min(low,end[crossAxis]);high=Math.max(high,end[crossAxis]);min=Math.min(min,end[axis]);max=Math.max(max,end[axis]);
     if(high-low>maxJitter)break;
     if(span<2||best&&span-1<=best.removed||Math.abs(next[axis]-end[axis])>Math.abs(next[crossAxis]-end[crossAxis])*tangent||equal(end,next)||Math.abs(end[axis]-start[axis])<8||min<Math.min(start[axis],end[axis])-maxJitter||max>Math.max(start[axis],end[axis])+maxJitter)continue;
     const excluded=new Set(Array.from({length:span-1},(_,n)=>(i+n+1)%ring.length));
     const make=coord=>{const changed=ring.map(p=>[...p]);changed[i]=onAxis(prev,start,axis,coord);changed[(i+span)%ring.length]=onAxis(end,next,axis,coord);return changed.filter((_,n)=>!excluded.has(n));};
     const target=signedArea(ring);let a=low,b=high,fa=signedArea(make(a))-target,fb=signedArea(make(b))-target;
     if(fa*fb>1e-6)continue;
     // 小台阶的局部转角也是 90°；按整段延续方向合并，并以面积约束求直线位置，不能误称删点天然保面积。
     for(let n=0;n<25;n++){const mid=(a+b)/2,fm=signedArea(make(mid))-target;if(fm*fa>0){a=mid;fa=fm;}else b=mid;}
     const fitted=make((a+b)/2);if(fitted.length<4)continue;
     const candidate=replaceRing(shapes[si],ri,fitted);if(!validShape(candidate))continue;
     best={candidate,removed:span-1};
    }
   }
   if(!best)break;shapes[si]=best.candidate;ring=shapeRings(shapes[si])[ri];
  }
 }
 return shapes.map(s=>({...s,areaPixels:shapeArea(s)}));
}

// 原始轮廓仍可关闭后处理逐像素对照；正交化只向墙内收，避免把房间和洞口填成墙。
export function orthogonalizeWallContours(source,{maxDeviation=8,maxLossRatio=.05,angleDegrees=5}={}){
 if(!Number.isFinite(maxDeviation)||maxDeviation<0||!Number.isFinite(maxLossRatio)||maxLossRatio<0||maxLossRatio>.05||!Number.isFinite(angleDegrees)||angleDegrees<0||angleDegrees>5)throw new Error('正交化参数超出保真范围');
 const shapes=source.map(s=>({...s,outer:s.outer.map(p=>[...p]),holes:(s.holes||[]).map(r=>r.map(p=>[...p]))}));
 const total=shapes.reduce((sum,s)=>sum+shapeArea(s),0),budget=total*maxLossRatio;let lost=0;
 const acceptable=(candidate,index,loss)=>{
  if(loss< -1e-7||lost+loss>budget+1e-7||!validShape(candidate))return false;
  // 只比较顶点不足以发现跨凹角的填墙；连续区域差集还会拦住新自交与洞口侵占。
  try{return clipping.difference(shapeRings(candidate),shapeRings(source[index])).length===0;}catch{return false;}
 };
 for(let si=0;si<shapes.length;si++)for(let ri=0;ri<shapeRings(shapes[si]).length;ri++){
  let ring=shapeRings(shapes[si])[ri];
  for(let i=0;i<ring.length;i++){
   const n=ring.length,a=ring[i],b=ring[(i+1)%n],dx=b[0]-a[0],dy=b[1]-a[1];
   if(dx===0||dy===0||Math.atan2(Math.min(Math.abs(dx),Math.abs(dy)),Math.max(Math.abs(dx),Math.abs(dy)))*180/Math.PI>=angleDegrees)continue;
   const horizontal=Math.abs(dx)>Math.abs(dy),coord=horizontal?(dx>0?Math.max(a[1],b[1]):Math.min(a[1],b[1])):(dy>0?Math.min(a[0],b[0]):Math.max(a[0],b[0]));
   const p=horizontal?[a[0],coord]:[coord,a[1]],q=horizontal?[b[0],coord]:[coord,b[1]];
   const start=intersection(ring[(i+n-1)%n],a,p,q),end=intersection(p,q,b,ring[(i+2)%n]);
   if(!start||!end)continue;
   const snapped=ring.map(p=>[...p]);snapped[i]=start;snapped[(i+1)%n]=end;
   const candidate=replaceRing(shapes[si],ri,snapped),loss=signedArea(ring)-signedArea(snapped);
   if(acceptable(candidate,si,loss)){shapes[si]=candidate;ring=snapped;lost+=Math.max(0,loss);}
  }
 }
 while(true){let best;
  for(let si=0;si<shapes.length;si++)for(let ri=0;ri<shapeRings(shapes[si]).length;ri++){
   const ring=shapeRings(shapes[si])[ri],n=ring.length;if(n<=4)continue;
   for(let i=0;i<n;i++){
    const a=ring[i],b=ring[(i+1)%n],c=ring[(i+2)%n],d=ring[(i+3)%n],prev=ring[(i+n-1)%n],next=ring[(i+4)%n];
    const horizontal=a[1]===b[1]&&c[1]===d[1]&&a[0]===prev[0]&&d[0]===next[0],vertical=a[0]===b[0]&&c[0]===d[0]&&a[1]===prev[1]&&d[1]===next[1];
    if(!horizontal&&!vertical)continue;const axis=horizontal?1:0;
    if(Math.abs(b[axis]-c[axis])>maxDeviation)continue;
    // 原始台阶的每条边本来就是轴向的；必须合并相邻平行链，才能消除半透明墙上的细竖条。
    for(const coord of [b[axis],c[axis]]){
     const changed=ring.map(p=>[...p]);changed[i][axis]=coord;changed[(i+3)%n][axis]=coord;
     const simplified=cleanRing(changed.filter((_,j)=>j!==(i+1)%n&&j!==(i+2)%n));
     if(simplified.length<3||simplified.length>=n||Math.sign(signedArea(simplified))!==Math.sign(signedArea(ring)))continue;
     const loss=signedArea(ring)-signedArea(simplified),score=loss/(n-simplified.length);
     if(best&&score>=best.score)continue;
     const candidate=replaceRing(shapes[si],ri,simplified);
     if(acceptable(candidate,si,loss))best={si,candidate,loss,score};
    }
   }
  }
  if(!best)break;shapes[best.si]=best.candidate;lost+=Math.max(0,best.loss);
 }
 return shapes.map(s=>({...s,outer:cleanRing(s.outer),holes:s.holes.map(cleanRing),areaPixels:shapeArea(s)}));
}
