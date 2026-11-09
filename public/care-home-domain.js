import {validateHome} from './home-domain.js';
import {newCareProject,validateCareProject,careReview} from './care-domain.js';
export const HK_SOURCE='https://www.censtatd.gov.hk/en/data/stat_report/product/B1120118/att/B11201182021XXXXB0100.pdf';
export function hkCareHome(){
 const w=6.4,d=6.40625,top=3.8,bottom=d-top;
 const room=(id,name,kind,width,depth,x,z)=>({id,name,kind,purpose:kind==='bedroom'?'bedroom':'living',width,depth,height:2.7,x,z,items:[],openings:[],confidence:'low',notes:'展示假設，非統計戶型或實測門位'});
 const home={format:'domira.home.v1',width:w,depth:d,height:2.7,source:'hk-elderly-demo',scaleConfirmed:false,rooms:[room('living','起居／用餐','living',3.6,top,-1.4,-d/2+top/2),room('bedroom','睡房','bedroom',2.8,top,1.8,-d/2+top/2),room('kitchen','廚房','kitchen',2.1,bottom,-2.15,d/2-bottom/2),room('hall','玄關／通道','hall',2.2,bottom,0,d/2-bottom/2),room('bathroom','浴室','bathroom',2.1,bottom,2.15,d/2-bottom/2)],warnings:['41㎡是2021年含65歲以上長者住戶居所面積中位數，不是平均值。','房間比例、2.7m層高及門位並非統計數據；不代表真實物業或全屋無障礙合規。'],summary:'以41㎡統計面積作展示基準，矩形房間淨面積相加41㎡；牆厚不額外計入。'};
 const door=(edge,offset,width)=>({kind:'door',edge,offset,width});
 home.rooms[0].openings=[door('bottom',2.65/3.6,.9/3.6),door('right',2.25/3.8,.9/3.8)];home.rooms[1].openings=[door('left',2.25/3.8,.9/3.8)];home.rooms[2].openings=[door('right',.45/bottom,.9/bottom)];home.rooms[3].openings=[door('top',.55/2.2,.9/2.2),door('left',.45/bottom,.9/bottom),door('right',.45/bottom,.9/bottom),door('bottom',.65/2.2,.9/2.2)];home.rooms[4].openings=[door('left',.45/bottom,.9/bottom)];
 return validateHome(home);
}
// 從整屋房間建立單房間專案時，把該房間的門一起帶進來。
// ⚠ openings 的 width 是「佔該面牆的比例」（0–1），doorList 要的是公尺；
// `door('bottom',2.65/3.6,.9/3.6)` 裡的 .9/3.6 就是比例，直接當 0.25 m 用會全錯。
export function roomCareProject(home,room){
 const p=newCareProject({width:room.width,depth:room.depth,height:room.height,source:home.source==='hk-elderly-demo'?'demo':'manual-guided',units:'m'},room.name);
 const doors=(room.openings||[])
  .filter(o=>o&&o.kind==='door'&&Number.isFinite(o.offset)&&Number.isFinite(o.width))
  .map(o=>{
   const len=(o.edge==='top'||o.edge==='bottom')?room.width:room.depth;
   return {edge:o.edge,offset:o.offset,width:Math.round(o.width*len*100)/100};
  })
  .filter(d=>d.width>=.3);
 if(doors.length)p.doors=doors;
 return p;
}
export function validateCareWhole(whole){if(!whole||whole.format!=='domira.care.home.v1')throw Error('全屋格式不正確');validateHome(whole.home);if(!whole.home.rooms.some(r=>r.id===whole.activeRoomId))throw Error('目前房間不存在');for(const r of whole.home.rooms){const p=whole.projects[r.id];if(p){validateCareProject(p);if(Math.abs(p.room.width-r.width)>.001||Math.abs(p.room.depth-r.depth)>.001)throw Error('房間尺寸不一致');}}return whole;}
export function wholeReview(whole){return whole.home.rooms.map(r=>({id:r.id,name:r.name,area:r.width*r.depth,review:whole.projects[r.id]?careReview(whole.projects[r.id]):null}));}
