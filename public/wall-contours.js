// 沿像素单元的边走，而不是取连通域外接框；这样凹角和房间空洞不会被填实。
export function wallContoursFromMask(mask,width,height,{epsilon=1}={}){
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
 return solids;
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
