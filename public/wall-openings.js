// 门窗必须先切掉墙体再画面板，否则视觉上有门、实际仍是一堵实墙。
export function openingsOnBlock(block,doors=[],windows=[],height=2.7){
 const horizontal=block.x1-block.x0>=block.y1-block.y0;
 const lo=horizontal?block.x0:block.y0,hi=horizontal?block.x1:block.y1;
 const center=horizontal?(block.y0+block.y1)/2:(block.x0+block.x1)/2;
 const thickness=horizontal?block.y1-block.y0:block.x1-block.x0;
 const top=Math.min(2.1,height-.15),sill=Math.min(.85,top-.2);
 if(!(thickness>0&&hi>lo&&top>0))return [];
 return [...doors.map((o,index)=>({...o,kind:'door',index})),...windows.map((o,index)=>({...o,kind:'window',index}))].flatMap(o=>{
  if(!!o.horizontal!==horizontal||![o.x,o.z,o.w,o.d].every(Number.isFinite)||o.w<=0||o.d<=0)return [];
  const across=horizontal?o.z:o.x,along=horizontal?o.x:o.z,width=horizontal?o.w:o.d;
  if(Math.abs(across-center)>=thickness/2)return [];
  const from=Math.max(lo,along-width/2),to=Math.min(hi,along+width/2);
  return to>from?[{kind:o.kind,index:o.index,from,to,bottom:o.kind==='door'?0:sill,top,horizontal}]:[];
 });
}

export function cutWallBlock(block,doors=[],windows=[],height=2.7){
 const openings=openingsOnBlock(block,doors,windows,height);
 const horizontal=block.x1-block.x0>=block.y1-block.y0;
 const lo=horizontal?block.x0:block.y0,hi=horizontal?block.x1:block.y1;
 const xs=[...new Set([lo,hi,...openings.flatMap(o=>[o.from,o.to])])].sort((a,b)=>a-b);
 const solids=[],glass=[];
 const rect=(from,to,bottom,top,kind)=>({...block,x0:horizontal?from:block.x0,x1:horizontal?to:block.x1,y0:horizontal?block.y0:from,y1:horizontal?block.y1:to,bottom,top,kind});
 for(let i=1;i<xs.length;i++){
  const from=xs[i-1],to=xs[i],mid=(from+to)/2,cover=openings.filter(o=>mid>o.from&&mid<o.to);
  // 同处出现门窗候选时保留通行空间，不能再用窗台把门堵住。
  const selected=cover.find(o=>o.kind==='door')||cover[0];
  if(!selected){solids.push(rect(from,to,0,height,'wall'));continue;}
  if(selected.bottom>0)solids.push(rect(from,to,0,selected.bottom,'sill'));
  if(selected.top<height)solids.push(rect(from,to,selected.top,height,'lintel'));
  if(selected.kind==='window')glass.push(rect(from,to,selected.bottom,selected.top,'glass'));
 }
 return {solids,glass,openings};
}
