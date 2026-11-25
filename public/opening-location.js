// Five-class segmentation determines location; only the original image determines symbols.
export function classifyOpeningByLocation(box,mask,width,height){
 const horizontal=box.w>=box.h;
 const sample=sign=>{
  const counts=[0,0,0,0,0];
  if(mask&&[box.x,box.y,box.w,box.h].every(Number.isFinite)&&box.w>0&&box.h>0){
   for(let offset=8;offset<=30;offset++)for(let t=2;t<=8;t++){
    const along=(horizontal?box.x:box.y)+(horizontal?box.w:box.h)*t/10;
    const cross=(horizontal?box.y:box.x)+(sign<0?0:horizontal?box.h:box.w)+sign*offset;
    const x=Math.round(horizontal?along:cross),y=Math.round(horizontal?cross:along);
    if(x>=0&&x<width&&y>=0&&y<height){const cls=mask[y*width+x];if(cls>=0&&cls<5)counts[cls]++;}
   }
  }
  const total=counts.reduce((a,b)=>a+b,0),dominant=total?counts.indexOf(Math.max(...counts)):null;
  return {counts,total,dominant};
 };
 const sideA=sample(-1),sideB=sample(1);
 const exterior=s=>s.total>0&&(s.dominant===4||(s.counts[4]/s.total>=.2&&(s.counts[1]+s.counts[4])/s.total>.5));
 const kind=sideA.dominant===0&&sideB.dominant===0?'interior-door':exterior(sideA)||exterior(sideB)?'exterior-opening':'unknown';
 return {kind,sideA,sideB};
}

export function imageGrayFromImageData({data,width,height}){
 const gray=new Uint8Array(width*height);
 for(let i=0;i<gray.length;i++)gray[i]=Math.round(.299*data[i*4]+.587*data[i*4+1]+.114*data[i*4+2]);
 return {data:gray,width,height};
}

// Local, anchored quarter-circle fitting. Radial edge directions reject straight
// window frames; a perpendicular leaf must accompany the arc at the same hinge.
export function analyzeDoorArc(box,imageGray,searchRadius=1.2*Math.max(box.w,box.h)){
 const L=Math.max(box.w,box.h),horizontal=box.w>=box.h;
 if(!imageGray?.data||!(L>0)||!Number.isFinite(searchRadius)||searchRadius<=0)return {available:false,found:false};
 const {data,width,height}=imageGray;
 if(data.length!==width*height)return {available:false,found:false};
 const x0=Math.max(1,Math.floor(box.x-searchRadius)),x1=Math.min(width-2,Math.ceil(box.x+box.w+searchRadius));
 const y0=Math.max(1,Math.floor(box.y-searchRadius)),y1=Math.min(height-2,Math.ceil(box.y+box.h+searchRadius));
 const edges=new Map();
 const edge=(x,y)=>{
  x=Math.round(x);y=Math.round(y);if(x<x0||x>x1||y<y0||y>y1)return null;
  const key=y*width+x;if(edges.has(key))return edges.get(key);
  const a=(dx,dy)=>data[(y+dy)*width+x+dx];
  const gx=a(1,-1)+2*a(1,0)+a(1,1)-a(-1,-1)-2*a(-1,0)-a(-1,1);
  const gy=a(-1,1)+2*a(0,1)+a(1,1)-a(-1,-1)-2*a(0,-1)-a(1,-1);
  const e={gx,gy,mag:Math.hypot(gx,gy)};edges.set(key,e);return e;
 };
 const hit=(x,y,nx,ny)=>{
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
   const e=edge(x+dx,y+dy);if(e&&e.mag>=24&&Math.abs(e.gx*nx+e.gy*ny)/e.mag>=.94)return true;
  }
  return false;
 };
 let best={available:true,found:false,support:0,roi:{x0,y0,x1,y1}};
 for(const end of [0,1])for(const cross of [0,.5,1])for(const shift of [-2,0,2]){
  const cx=horizontal?box.x+end*box.w:box.x+cross*box.w+shift;
  const cy=horizontal?box.y+cross*box.h+shift:box.y+end*box.h;
  for(let r=.7*L;r<=1.16*L;r+=Math.max(1,L*.04))for(const sx of [-1,1])for(const sy of [-1,1]){
   let count=0,gap=0,maxGap=0,middle=0;
   for(let i=0;i<24;i++){
    const a=(i+1)*Math.PI/50,nx=sx*Math.cos(a),ny=sy*Math.sin(a);
    if(hit(cx+r*nx,cy+r*ny,nx,ny)){count++;gap=0;if(i>=7&&i<=16)middle++;}else{gap++;maxGap=Math.max(maxGap,gap);}
   }
   if(count<21||middle<8||maxGap>2)continue;
   let leaf=0;
   for(let i=2;i<=18;i++){
    const t=i/20;
    if(horizontal?hit(cx,cy+sy*r*t,1,0):hit(cx+sx*r*t,cy,0,1))leaf++;
   }
   const support=count/24;
   if(leaf>=11&&support>best.support)best={available:true,found:true,support,leafSupport:leaf/17,center:{x:cx,y:cy},radius:r,roi:best.roi};
  }
 }
 return best;
}
export function hasDoorArc(box,imageGray,searchRadius){return analyzeDoorArc(box,imageGray,searchRadius).found;}
