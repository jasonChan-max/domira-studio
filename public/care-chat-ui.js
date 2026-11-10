import {chatScene,validateChatMoves} from './care-chat-layout.js';
import {API_BASE} from './api-config.js';

export function createCareChat({getState,apply,notify}){
 const $=id=>document.getElementById(id);
 const panel=$('care-chat'),toggle=$('care-chat-toggle'),input=$('care-chat-input');
 const send=$('care-chat-send'),adjust=$('care-chat-adjust'),status=$('care-chat-status');
 const log=$('care-chat-log'),preview=$('care-chat-proposal'),list=$('care-chat-moves');
 const messages=[];
 let controller=null,pending=null;
 const signature=p=>JSON.stringify([p.wholeHome?.activeRoomId,p.wholeHome?.view,chatScene(p)]);
 function show(open){panel.hidden=!open;toggle.setAttribute('aria-expanded',String(open));if(open)input.focus();else toggle.focus();}
 toggle.onclick=()=>show(panel.hidden);
 $('care-chat-close').onclick=()=>show(false);
 panel.addEventListener('keydown',event=>{if(event.key==='Escape')show(false);});
 panel.querySelectorAll('[data-chat-prompt]').forEach(button=>button.onclick=()=>{input.value=button.dataset.chatPrompt;input.focus();});
 function add(role,content){
  messages.push({role,content});
  const line=document.createElement('p');line.className=role;line.textContent=(role==='user'?'你 · ':'助手 · ')+content;
  log.append(line);if(messages.length>20){messages.shift();log.firstElementChild.remove();}log.scrollTop=log.scrollHeight;
 }
 function clearProposal(){pending=null;preview.hidden=true;list.replaceChildren();}
 $('care-chat-dismiss').onclick=clearProposal;
 $('care-chat-apply').onclick=()=>{
  if(!pending)return;
  const state=getState();
  try{
   if(signature(state)!==pending.signature)throw Error('房間或家具已變更，請重新產生擺位建議。');
   const {items}=validateChatMoves(state,pending.moves);
   apply(items);clearProposal();status.textContent='已套用，按「復原」可返回原來擺位。';notify('已套用助手的家具擺位。');
  }catch(error){clearProposal();status.textContent=error.message;}
 };
 $('care-chat-cancel').onclick=()=>controller?.abort();
 $('care-chat-form').onsubmit=async event=>{
  event.preventDefault();
  const text=input.value.trim(),layout=event.submitter===adjust;
  if(!text||controller)return;
  const state=getState(),scene=chatScene(state),snapshot=signature(state);
  if(layout&&!scene.items.length){status.textContent='請先選擇有家具的房間，或加入家具。';return;}
  clearProposal();add('user',text);input.value='';
  controller=new AbortController();send.disabled=adjust.disabled=true;$('care-chat-cancel').hidden=false;
  status.textContent=layout?'正在規劃並驗算擺位…':'正在整理建議…';
  try{
   const {room,profile,doorWidth,style,purpose}=scene;
   const context={room,profile,doorWidth,style,purpose,items:scene.items.map(({name,w,d,h,x,z,rotation})=>({name,w,d,h,x,z,rotation}))};
   const payload={messages:messages.slice(-6).map(m=>({...m,content:m.content.slice(0,1800)})),context};
   if(layout){payload.mode='layout';payload.scene=scene;payload.context={};}
   const response=await fetch(API_BASE+'/api/care/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(24000)])});
   const data=await response.json();if(!response.ok)throw Error(data.error||'對話服務不可用。');
   if(signature(getState())!==snapshot){status.textContent='房間或家具已變更，請依目前畫面重新提問。';return;}
   add('assistant',data.reply);
   if(layout&&data.moves?.length){
    const {moves}=validateChatMoves(state,data.moves);
    pending={signature:snapshot,moves};
    for(const move of moves){
     const item=scene.items.find(i=>i.id===move.id),line=document.createElement('li');
     line.textContent=`${item.name} · 移動 ${Math.hypot(item.x-move.x,item.z-move.z).toFixed(2)} m · 朝向 ${Math.round(move.rotation)}°`;
     list.append(line);
    }
    preview.hidden=false;
   }
   status.textContent=preview.hidden?'':'擺位已通過幾何驗算，可套用至目前房間。';
  }catch(error){status.textContent=controller.signal.aborted?'已取消。':error.name==='TimeoutError'?'等待逾時，請再試一次。':error.message;input.value=text;}
  finally{controller=null;send.disabled=adjust.disabled=false;$('care-chat-cancel').hidden=true;}
 };
}
