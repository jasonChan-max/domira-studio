import {BRIEF_VERSION,requestedItems} from './care-brief.js';
import {ALL_CARE_PRODUCTS} from './care-catalog.js';
import {safeCareLayout} from './care-domain.js';
import {careRoomAssignments,createManualCareHome,hkCareHome,roomCareProject} from './care-home-domain.js';

function twoBedroomHome() {
 const home=createManualCareHome({width:8,depth:7,height:2.7},[
  {name:'客飯廳',kind:'living',left:0,top:0,width:5,depth:4},
  {name:'主人房',kind:'bedroom',left:5,top:0,width:3,depth:4},
  {name:'廚房',kind:'kitchen',left:0,top:4,width:2.2,depth:3},
  {name:'玄關',kind:'hall',left:2.2,top:4,width:1.2,depth:3},
  {name:'浴室',kind:'bathroom',left:3.4,top:4,width:2.2,depth:3},
  {name:'家人房',kind:'bedroom',left:5.6,top:4,width:2.4,depth:3}
 ]);
 const opening=(edge,start,net,span)=>({kind:'door',edge,offset:start/span,width:net/span,swing:'sliding'});
 const [living,bedroom,kitchen,hall,bath,guest]=home.rooms;
 living.openings=[opening('right',2,1,4),opening('bottom',2.3,1,5),opening('bottom',3.75,.9,5)];
 bedroom.openings=[opening('left',2,1,4),opening('bottom',1.15,.95,3)];
 kitchen.openings=[opening('right',.6,.9,3)];
 hall.openings=[opening('top',.1,1,1.2),opening('left',.6,.9,3),opening('bottom',.1,1,1.2)];
 bath.openings=[opening('top',.35,.9,2.2)];
 guest.openings=[opening('top',.55,.95,2.4)];
 home.source='care-template';
 home.warnings=['56㎡ 兩房為 Domira 編製的示範戶型，尺寸、門位及用料須按實地條件調整。'];
 return home;
}

export const CARE_TEMPLATES = [
 {id:'small',name:'小戶型，先做少量改動',description:'41㎡ 一房示範 · 日常步行或使用助行器。睡房放普通床，浴室試排沖涼座椅。',makeHome:hkCareHome,profile:'walker',style:'warm',products:['HOME-BED','HOME-SOFA','AID-009'],preferences:['night-light','easy-clean']},
 {id:'family',name:'兩房，同家人一起住',description:'56㎡ 兩房示範 · 照顧者可從側面協助上落床。先比較床位與夜間如廁安排。',makeHome:twoBedroomHome,profile:'wheelchair',style:'minimal',products:['AID-018','DESIGN-HOME-SOFA','AID-008'],preferences:['night-light','caregiver','high-contrast']}
];

export const CARE_CASES = [
 {name:'香港中區 · 舊樓居家改造',detail:'房協評估後，住戶改造走廊、客廳與浴室，並拆除浴室地台。',url:'https://www.hkhs.com/home/upload/pdf/hst_65_HST_65_Chi.pdf#page=7',source:'香港房屋協會',template:'small'},
 {name:'香港杏花邨 · 拆門檻與浴室改造',detail:'將浴缸改為企缸，加扶手與趟門，改用防滑地磚。',url:'https://www.hkhs.com/home/upload/pdf/hst_67_HST_67_Chi.pdf#page=21',source:'香港房屋協會',template:'small'},
 {name:'新加坡 · HDB EASE 改造計劃',detail:'按戶型、適用資格和現場條件提供扶手、防滑處理或出入口改善。',url:'https://www.hdb.gov.sg/managing-my-home/upgrading-and-redevelopment/enhancement-for-active-seniors-ease',source:'新加坡建屋發展局'}
];

export function makeCareTemplate(template) {
 const home=template.makeHome();
 const selections=template.products.map(productId=>{
  const {w,d,h}=ALL_CARE_PRODUCTS.find(product=>product.productId===productId);
  return {productId,quantity:1,w,d,h,dimensionSource:'concept'};
 });
 const brief={version:BRIEF_VERSION,confirmed:true,selections,preferences:template.preferences,notes:''};
 const allocations=careRoomAssignments(home,brief);
 const projects={};
 for(const room of home.rooms){
  room.flooring=['bathroom','kitchen'].includes(room.kind)?'tile':'wood';
  if(room.width<2||room.depth<2){projects[room.id]=null;continue;}
  const project={...roomCareProject(home,room),profile:template.profile,style:template.style};
  project.room.flooring=room.flooring;
  const chosen=selections.filter(selection=>allocations[selection.productId]===room.id);
  if(chosen.length){
   project.brief={...brief,selections:chosen};
   const required=requestedItems(project.brief);
   project.items=safeCareLayout(project,required).items;
   project.unplaced=required.filter(item=>!project.items.some(placed=>placed.requestKey===item.requestKey));
   project.engine='template';
   room.items=project.items;
  }
  projects[room.id]=project;
 }
 const activeRoomId=home.rooms.find(room=>room.kind==='living').id;
 return {...projects[activeRoomId],wholeHome:{format:'domira.care.home.v1',home,projects,activeRoomId,view:'whole',name:template.name,brief,allocations}};
}
