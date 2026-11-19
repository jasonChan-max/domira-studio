// Offline candidate for task B. Pixel coordinates use the same {pos,from,to,len}
// contract as wallLinesFromMask. Gaps are candidates, never asserted doors/windows.
export function otsu(values, weights = values.map(() => 1)) {
  const pairs = values.map((v,i)=>[v,weights[i]]).sort((a,b)=>a[0]-b[0]);
  const total = pairs.reduce((s,p)=>s+p[1],0), moment = pairs.reduce((s,p)=>s+p[0]*p[1],0);
  let mass=0,sum=0,best=-1,threshold=null;
  for(let i=0;i<pairs.length-1;i++) {
    const [v,weight]=pairs[i];mass+=weight;sum+=v*weight;
    if(mass<total*.06||total-mass<total*.06||v===pairs[i+1][0])continue;
    const score=mass*(total-mass)*(sum/mass-(moment-sum)/(total-mass))**2;
    if(score>best){best=score;threshold=(v+pairs[i+1][0])/2;}
  }
  return threshold;
}

// Separable sliding-window binary morphology, O(width*height), including edges.
function morph1(mask,w,h,radius,vertical,dilate) {
  if(!radius)return mask.slice();
  const out=new Uint8Array(w*h),outer=vertical?w:h,inner=vertical?h:w,k=radius*2+1;
  const at=(i,j)=>vertical?j*w+i:i*w+j;
  for(let i=0;i<outer;i++){
    let count=0;
    for(let j=0;j<=Math.min(radius,inner-1);j++)count+=mask[at(i,j)];
    for(let j=0;j<inner;j++){
      out[at(i,j)]=Number(dilate?count>0:count===k);
      if(j-radius>=0)count-=mask[at(i,j-radius)];
      if(j+radius+1<inner)count+=mask[at(i,j+radius+1)];
    }
  }
  return out;
}
function morph(mask,w,h,rx,ry,dilate){return morph1(morph1(mask,w,h,rx,false,dilate),w,h,ry,true,dilate);}
function open(mask,w,h,rx,ry){return morph(morph(mask,w,h,rx,ry,false),w,h,rx,ry,true);}
function close(mask,w,h,rx,ry){return morph(morph(mask,w,h,rx,ry,true),w,h,rx,ry,false);}

export function wallBands(mask,w,h,{mmPerPixel}) {
  if(!(mmPerPixel>0))throw new Error('A measured scale is required for parallel-line pairing');
  const thin=morph(mask,w,h,1,1,true),max=Math.max(1,Math.round(330/mmPerPixel/2)),min=Math.max(1,Math.round(60/mmPerPixel/2)),length=Math.max(6,Math.round(600/mmPerPixel/2));
  const horizontal=open(open(close(thin,w,h,0,max),w,h,0,min),w,h,length,0);
  const vertical=open(open(close(thin,w,h,max,0),w,h,min,0),w,h,0,length);
  return horizontal.map((v,i)=>v|vertical[i]);
}

export function runs(mask,w,h,vertical=false){
  const out=new Int32Array(w*h),outer=vertical?w:h,inner=vertical?h:w;
  const at=(i,j)=>vertical?j*w+i:i*w+j;
  for(let i=0;i<outer;i++){let j=0;while(j<inner){if(!mask[at(i,j)]){j++;continue;}const start=j;while(j<inner&&mask[at(i,j)])j++;for(let k=start;k<j;k++)out[at(i,k)]=j-start;}}
  return out;
}

function components(mask,w,h,diagonal=false){
  const label=new Int32Array(w*h).fill(-1),queue=new Int32Array(w*h),out=[];
  for(let p=0;p<mask.length;p++){
    if(!mask[p]||label[p]>=0)continue;
    const id=out.length;let head=0,tail=1,x0=w,y0=h,x1=0,y1=0,sx=0,sy=0;
    queue[0]=p;label[p]=id;
    while(head<tail){const at=queue[head++],x=at%w,y=Math.floor(at/w);x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);sx+=x+.5;sy+=y+.5;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if((!dx&&!dy)||(!diagonal&&dx&&dy))continue;const xx=x+dx,yy=y+dy,q=yy*w+xx;if(xx>=0&&xx<w&&yy>=0&&yy<h&&mask[q]&&label[q]<0){label[q]=id;queue[tail++]=q;}}
    }
    out.push({id,x:x0,y:y0,w:x1-x0,h:y1-y0,area:tail,cx:sx/tail,cy:sy/tail});
  }
  return {label,items:out};
}

export function segmentsFromMask(mask,w,h){
  const hr=runs(mask,w,h),vr=runs(mask,w,h,true),horizontal=new Uint8Array(w*h),vertical=new Uint8Array(w*h);
  for(let i=0;i<mask.length;i++){horizontal[i]=Number(mask[i]&&hr[i]>=vr[i]);vertical[i]=Number(mask[i]&&vr[i]>hr[i]);}
  const lines={hLines:[],vLines:[]};
  for(const [isH,pixels] of [[true,horizontal],[false,vertical]]){
    const {label,items}=components(pixels,w,h);
    for(const c of items){const len=isH?c.w:c.h;if(len<6||c.area<30)continue;
      const counts=new Int32Array(len);
      for(let y=c.y;y<c.y+c.h;y++)for(let x=c.x;x<c.x+c.w;x++)if(label[y*w+x]===c.id)counts[isH?x-c.x:y-c.y]++;
      const nonzero=Array.from(counts).filter(n=>n>0).sort((a,b)=>a-b),thickness=nonzero[Math.floor(nonzero.length/2)];
      if(len<thickness*1.2)continue;
      const from=isH?c.x:c.y;lines[isH?'hLines':'vLines'].push({pos:isH?c.cy:c.cx,from,to:from+len,len,thickness});
    }
  }
  return lines;
}

export function findDims(ink,w,h,frame){
  const out={top:[],bottom:[],left:[],right:[]},pad=Math.round(Math.max(frame.w,frame.h)*.25);
  function scan(vertical,lo,hi,a0,a1,key,span){
    const outer=vertical?w:h,inner=vertical?h:w;lo=Math.max(8,lo);hi=Math.min(outer-8,hi);a0=Math.max(0,a0);a1=Math.min(inner,a1);
    const at=(i,j)=>vertical?j*w+i:i*w+j,rows=[];
    for(let i=lo;i<hi;i++){let count=0;for(let j=a0;j<a1;j++)count+=ink[at(i,j)];if(count>=span*.3)rows.push({pos:i,count});}
    rows.sort((a,b)=>b.count-a.count);
    for(const row of rows.slice(0,12)){
      if(out[key].some(d=>Math.abs(d.at-row.pos)<=4))continue;
      const hits=[];for(let j=a0;j<a1;j++){let before=false,after=false;for(let d=3;d<=7;d++){before ||=!!ink[at(row.pos-d,j)];after ||=!!ink[at(row.pos+d,j)];}if(before&&after)hits.push(j);}
      const ticks=[];let run=[];for(const j of hits){if(run.length&&j-run.at(-1)>2){ticks.push(run.reduce((s,v)=>s+v,0)/run.length);run=[];}run.push(j);}if(run.length)ticks.push(run.reduce((s,v)=>s+v,0)/run.length);
      if(ticks.length>=2)out[key].push({at:row.pos,ticks});
    }
  }
  const {x,y,w:fw,h:fh}=frame;
  scan(false,y-pad,y-2,x-pad,x+fw+pad,'top',fw);scan(false,y+fh+2,y+fh+pad,x-pad,x+fw+pad,'bottom',fw);
  scan(true,x-pad,x-2,y-pad,y+fh+pad,'left',fh);scan(true,x+fw+2,x+fw+pad,y-pad,y+fh+pad,'right',fh);
  return out;
}

export function analyzeFloorplan(rgba,w,h,{mmPerPixel=0}={}){
  if(rgba.length!==w*h*4)throw new Error('RGBA dimensions do not match');
  const start=performance.now(),raw=new Uint8Array(w*h),ink=new Uint8Array(w*h),hist=new Array(256).fill(0);
  for(let i=0;i<raw.length;i++){const p=i*4,max=Math.max(rgba[p],rgba[p+1],rgba[p+2]),min=Math.min(rgba[p],rgba[p+1],rgba[p+2]);if(max-min<22)hist[max]++;ink[i]=Number(max<170&&max-min<60);}
  const threshold=Math.min(175,otsu(hist.map((_,i)=>i),hist)??175);
  for(let i=0;i<raw.length;i++){const p=i*4,max=Math.max(rgba[p],rgba[p+1],rgba[p+2]),min=Math.min(rgba[p],rgba[p+1],rgba[p+2]);raw[i]=Number(max-min<22&&max<threshold);}
  const opened=open(raw,w,h,1,1),cc=components(opened,w,h,true);
  const candidates=cc.items.filter(c=>c.area>=120&&Math.max(c.w,c.h)>=25&&!(Math.max(c.w,c.h)/Math.min(c.w,c.h)<2&&c.area<700));
  if(!candidates.length)return null;
  const parent=candidates.map((_,i)=>i),find=i=>parent[i]===i?i:(parent[i]=find(parent[i])),gap=Math.max(w,h)*.15;
  for(let i=0;i<candidates.length;i++)for(let j=i+1;j<candidates.length;j++){const a=candidates[i],b=candidates[j];if(Math.max(b.x-a.x-a.w,a.x-b.x-b.w,0)<=gap&&Math.max(b.y-a.y-a.h,a.y-b.y-b.h,0)<=gap)parent[find(i)]=find(j);}
  const clusters=new Map();candidates.forEach((c,i)=>{const k=find(i);if(!clusters.has(k))clusters.set(k,[]);clusters.get(k).push(c);});
  const chosen=[...clusters.values()].sort((a,b)=>b.reduce((s,c)=>s+c.area,0)-a.reduce((s,c)=>s+c.area,0))[0],ids=new Set(chosen.map(c=>c.id));
  let mask=opened.map((v,i)=>Number(v&&ids.has(cc.label[i])));
  const x=Math.min(...chosen.map(c=>c.x)),y=Math.min(...chosen.map(c=>c.y)),right=Math.max(...chosen.map(c=>c.x+c.w)),bottom=Math.max(...chosen.map(c=>c.y+c.h)),frame={x,y,w:right-x,h:bottom-y};
  if(mmPerPixel>0){const bands=wallBands(raw,w,h,{mmPerPixel});mask=mask.map((v,i)=>v||Number(bands[i]&&i%w>=x&&i%w<right&&Math.floor(i/w)>=y&&Math.floor(i/w)<bottom));}
  const lines=segmentsFromMask(mask,w,h),gaps=[];
  for(const axis of ['h','v']){
    const list=lines[axis+'Lines'];
    for(const p of list){const next=list.filter(q=>q.from>=p.to+4&&Math.abs(q.pos-p.pos)<=Math.max(2,Math.min(q.thickness,p.thickness)*.6)).sort((a,b)=>a.from-b.from)[0];if(!next)continue;const len=next.from-p.to;if(len>(mmPerPixel>0?3200/mmPerPixel:Math.max(w,h)*.25))continue;gaps.push({axis,pos:(p.pos+next.pos)/2,from:p.to,to:next.from,len,kind:'candidate'});}
  }
  const dimensions=findDims(ink,w,h,frame);
  return {lines,gaps,frame,dimensions,mask,threshold,ms:performance.now()-start};
}
