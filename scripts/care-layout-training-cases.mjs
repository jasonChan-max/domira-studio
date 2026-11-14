import {CARE_TEMPLATES,makeCareTemplate} from '../public/care-templates.js';
import {createManualCareHome,HK_SOURCE} from '../public/care-home-domain.js';

// Authored example plans. Dimensions are in metres and are not surveys of the cited properties.
function hallwayHome({livingWidth,bedWidth,topDepth,hallWidth,bathWidth,bottomDepth,kitchenWidth,doorWidth,nearSide}){
 const width=livingWidth+bedWidth,depth=topDepth+bottomDepth;
 const entries=[
  {name:'客飯廳',kind:'living',left:0,top:0,width:livingWidth,depth:topDepth},
  {name:'睡房',kind:'bedroom',left:livingWidth,top:0,width:bedWidth,depth:topDepth},
  {name:'廚房',kind:'kitchen',left:0,top:topDepth,width:kitchenWidth,depth:bottomDepth},
  {name:'玄關',kind:'hall',left:kitchenWidth,top:topDepth,width:hallWidth,depth:bottomDepth},
  {name:'浴室',kind:'bathroom',left:kitchenWidth+hallWidth,top:topDepth,width:bathWidth,depth:bottomDepth}
 ];
 const home=createManualCareHome({width,depth,height:2.7},entries);
 const [living,bed,,hall,bath]=home.rooms;
 const door=(room,edge,start)=>room.openings.push({kind:'door',edge,offset:start/(['top','bottom'].includes(edge)?room.width:room.depth),width:doorWidth/(['top','bottom'].includes(edge)?room.width:room.depth),swing:'sliding'});
 const bedroomDoor=nearSide?topDepth-doorWidth-.65:.65;
 const bathDoor=nearSide?bottomDepth-doorWidth-.65:.65;
 const hallDoor=(hallWidth-doorWidth)/2;
 door(living,'right',bedroomDoor);door(bed,'left',bedroomDoor);
 door(living,'bottom',kitchenWidth+hallDoor);door(hall,'top',hallDoor);
 door(hall,'right',bathDoor);door(bath,'left',bathDoor);
 return home;
}

function nextDoorHome({livingWidth,bedWidth,topDepth,bottomDepth,doorWidth,offset}){
 const home=createManualCareHome({width:livingWidth+bedWidth,depth:topDepth+bottomDepth,height:2.7},[
  {name:'客飯廳',kind:'living',left:0,top:0,width:livingWidth,depth:topDepth},
  {name:'睡房',kind:'bedroom',left:livingWidth,top:0,width:bedWidth,depth:topDepth},
  {name:'浴室',kind:'bathroom',left:livingWidth,top:topDepth,width:bedWidth,depth:bottomDepth},
  {name:'廚房',kind:'kitchen',left:0,top:topDepth,width:livingWidth,depth:bottomDepth}
 ]);
 const [living,bed,bath]=home.rooms;
 const door=(edge,start,span)=>({kind:'door',edge,offset:start/span,width:doorWidth/span,swing:'sliding'});
 living.openings=[door('right',offset,topDepth)];
 bed.openings=[door('left',offset,topDepth),door('bottom',(bedWidth-doorWidth)/2,bedWidth)];
 bath.openings=[door('top',(bedWidth-doorWidth)/2,bedWidth)];
 return home;
}

export const trainingFamilies=[
 {id:'domira-small',split:'train',source:HK_SOURCE,home:CARE_TEMPLATES[0].makeHome,variations:[null]},
 {id:'domira-family',split:'train',source:'Domira 56 m² template',home:CARE_TEMPLATES[1].makeHome,variations:[null]},
 {id:'hall-link',split:'train',source:'Domira synthetic hallway plan',home:hallwayHome,variations:[
  {livingWidth:4,bedWidth:3.25,topDepth:4.3,hallWidth:2.1,bathWidth:2.55,bottomDepth:2.85,kitchenWidth:2.6,doorWidth:.95},
  {livingWidth:4.4,bedWidth:3.3,topDepth:4.6,hallWidth:2.15,bathWidth:2.8,bottomDepth:3.1,kitchenWidth:2.5,doorWidth:.95,nearSide:true},
  {livingWidth:3.85,bedWidth:3.35,topDepth:3.95,hallWidth:2.15,bathWidth:2.55,bottomDepth:3.2,kitchenWidth:2.5,doorWidth:1,nearSide:true}
 ]},
 {id:'adjacent-bath',split:'test',source:'Domira synthetic adjacent-bathroom plan',home:nextDoorHome,variations:[
  {livingWidth:3.6,bedWidth:3.5,topDepth:4.1,bottomDepth:2.7,doorWidth:.95,offset:1.4},
  {livingWidth:4.15,bedWidth:3.2,topDepth:4,bottomDepth:2.8,doorWidth:1,offset:1.9},
  {livingWidth:4.3,bedWidth:3.75,topDepth:4.35,bottomDepth:3.1,doorWidth:.9,offset:1.5}
 ]}
];

export function makeTrainingCase(family,variation,profile){
 const home=family.home(variation);
 const bedroom=home.rooms.find(room=>room.kind==='bedroom');
 const original=CARE_TEMPLATES.find(template=>template.profile===profile);
 // Alternate authentic catalog concepts across profiles and keep a traceable product ID.
 const plan=makeCareTemplate({...original,makeHome:()=>home});
 if(!bedroom.items.some(item=>item.type==='bed'))return null;
 return plan.wholeHome;
}
