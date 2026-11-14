import {validateChatMoves} from './care-chat-layout.js';

const kinds=[
 [/(?:梳化|沙發|沙发)/,'sofa'],[/(?:扶手椅|椅子|座椅|椅)/,'chair'],[/(?:睡床|護理床|护理床|床)/,'bed'],
 [/(?:餐桌|飯枱|饭桌)/,'dining'],[/(?:書桌|书桌)/,'desk'],[/(?:收納櫃|收纳柜|櫃|柜)/,'cabinet']
];
const translate=/^(.*?)(?:向|往|朝|移向|移到)?([左右上下前後后])(?:邊|边)?(?:移動|移动|移|挪|搬|推)?\s*(\d+(?:\.\d+)?)\s*(厘米|公分|cm|毫米|mm|公尺|米|m)$/i;
const rotate=/^(.*?)(?:(逆時針|逆时针|順時針|顺时针)\s*)?(?:旋轉|旋转|轉|转)\s*(\d+(?:\.\d+)?)\s*(度|°)$/;
const prefix=/^(?:(?:請你|请你|幫我|帮我|請|请|麻煩你|麻烦你|把|將|将|讓|让)\s*)+/;
const metres={厘米:.01,公分:.01,cm:.01,毫米:.001,mm:.001,公尺:1,米:1,m:1};
const direction={左:[-1,0],右:[1,0],上:[0,-1],下:[0,1]};

export function carePositionCommand(text){
 const input=text.normalize('NFKC').trim().replace(/[。！!]+$/,'').replace(prefix,'');
 if(/^(?:不要|別|别|唔好|無需|无需|不用)/.test(input))return null;
 const match=input.match(translate);
 if(match){
  const [,subject,side,number,unit]=match;
  if(!direction[side])return {error:'請用平面圖方向講「上、下、左、右」，例如「梳化向左移 20 公分」。'};
  const distance=Number(number)*metres[unit.toLowerCase()];
  if(!(distance>0&&distance<=3))return {error:'一次可以移動最多 3 公尺。請說出想移動的距離。'};
  const [x,z]=direction[side];
  return {subject:subject.trim(),dx:x*distance,dz:z*distance,turn:0,label:`在平面圖向${side}移 ${(distance*100).toFixed(1).replace(/\.0$/,'')} 公分`};
 }
 const turn=input.match(rotate);
 if(!turn)return null;
 const [,subject,side,degrees]=turn;
 const angle=Number(degrees);
 if(!(angle>0&&angle<360))return {error:'請說出小於 360 度的旋轉角度，例如「梳化轉 90 度」。'};
 const reverse=side?.startsWith('逆');
 return {subject:subject.trim(),dx:0,dz:0,turn:reverse?-angle:angle,label:`${reverse?'逆':'順'}時針轉 ${angle}°`};
}

export function carePositionItem(project,subject,selectedId){
 const selected=project.items.find(item=>item.id===selectedId);
 if(!subject||/^(?:呢件|這件|这件|目前選取的家具|選中的家具)$/.test(subject)){
  if(selected)return selected;
  throw Error('請先點選一件家具，或說出家具名稱。');
 }
 const exact=project.items.filter(item=>subject.includes(item.name));
 const type=kinds.find(([pattern])=>pattern.test(subject))?.[1];
 const candidates=exact.length?exact:project.items.filter(item=>item.type===type);
 if(candidates.includes(selected))return selected;
 if(candidates.length===1)return candidates[0];
 throw Error(candidates.length?'有多件符合的家具。請先點選想移動的那一件。':'在這間房找不到這件家具。請核對房間或家具名稱。');
}

export function previewCarePosition(project,command,selectedId){
 const item=carePositionItem(project,command.subject,selectedId);
 const moves=[{id:item.id,x:item.x+command.dx,z:item.z+command.dz,rotation:((item.rotation+command.turn)%360+360)%360}];
 const result=validateChatMoves(project,moves);
 return {...result,item:result.items.find(candidate=>candidate.id===item.id)};
}
