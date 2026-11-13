import {CARE_FLOORING} from './care-flooring.js';

const roomAliases = {
 bedroom: /睡房|臥室|卧室|房間|房间/,
 living: /客廳|客厅|起居|大廳|大厅/,
 bathroom: /浴室|廁所|厕所|洗手間|洗手间|衛生間|卫生间/,
 kitchen: /廚房|厨房/,
 dining: /飯廳|饭厅|餐廳|餐厅/,
 hall: /玄關|玄关|走廊/
};
const materials = {wood:/木地板|木地面/,tile:/瓷磚|瓷砖|地磚|地砖|磁磚|防滑磚|防滑砖/,carpet:/地毯|地氈/};
const ask = /[?？]|^(?:點樣|如何|怎麼|怎么|為什麼|为什么|為何|應唔應該|應該|应该|適合|适合|有咩|可否比較|有什麼|有什么)|(?:好唔好|適合嗎|适合吗|可以嗎|可以吗|嗎|吗)$/;
const save = /^(?:幫我|帮我|請|请|而家|现在|現在|再|順便|顺便|最後|最后|\s)*(?:儲存|保存|另存|存為|存为|存成|存低|存起來|存起来)(?:目前|當前|当前)?(?:呢個|這個|这个)?(?:方案|設計|设计|版本)?(?:名為|名为|叫|為|为|做|成|作)?\s*(.*)$/;
const sideOf = clause => /右側|右侧|右邊|右边/.test(clause) ? 'right' : /左側|左侧|左邊|左边/.test(clause) ? 'left' : undefined;

export function careCommand(text, state) {
 const input = text.normalize('NFKC').trim().replace(/[。！!]+$/, '');
 if (ask.test(input)) return null;
 const rooms = state.wholeHome?.home.rooms || [];
 const active = rooms.find(room => room.id === state.wholeHome.activeRoomId);
 const clauses = input.split(/[，,、；;。]|同埋|以及|並且|并且|然後|然后/).map(clause=>clause.trim()).filter(Boolean);
 const changes = [];
 let command;
 for (const clause of clauses) {
  const material = Object.keys(materials).find(key => materials[key].test(clause));
  const kind = Object.keys(roomAliases).find(key => roomAliases[key].test(clause));
  const named = rooms.filter(room => room.name.length >= 2 && clause.includes(room.name));
  const matches = named.length ? named : kind ? rooms.filter(room => room.kind === kind) : [];
  if (material && /換|换|改|用|鋪|铺|選|选/.test(clause)) {
   if ((kind || named.length) && rooms.length && matches.length !== 1) return {error:`請講清楚要換哪一間房的${CARE_FLOORING[material].name}。`};
   const target = matches[0] || active;
   changes.push({roomId:target?.id,material,name:target?.name || state.name});
   continue;
  }
  const saved = clause.match(save);
  if (saved) {
   if(command)return {error:'請先完成目前的修改，再儲存版本。'};
   command={type:'save',label:saved[1].trim().replace(/^[「『“"']|[」』”"']$/g,'').slice(0,60)};
   continue;
  }
  if (command?.type==='bed' && sideOf(clause) && /留|上落|起身|轉移|转移/.test(clause)) {command.transferSide=sideOf(clause);continue;}
  if (command) return {error:'請一次講一項修改，確認後可以再改。'};
  if (/^(?:幫我|帮我|請|请)?\s*(?:復原|复原|撤銷|撤销|還原|还原|返回|返去|換返|换回)(?:上一步|上一版|上一個擺法|上一個版本|上一个版本|剛才的修改|刚才的修改|原來的擺位|原来的摆位)?$/.test(clause)) command={type:'undo'};
  else if (/^(?:幫我|帮我|請|请)?\s*(?:匯出|汇出|導出|导出|下載|下载)(?:這份|这份|我的|目前的)?(?:全屋|房間|房间)?(?:方案|設計|设计|平面圖|平面图)?$/.test(clause)) command={type:'export',whole:!/房間|房间/.test(clause)};
  else if (/^(?:幫我|帮我|請|请)?\s*(?:開始|开始|重新|再)?\s*(?:規劃|规划|設計|设计|生成|排一排|排下|排個|排个)(?:整間屋|成間屋|我屋企|全屋|全屋方案|全屋佈局|全屋布局|方案)$/.test(clause)) command={type:'plan'};
  else if (/換|换|更換|更换|替換|替换|改/.test(clause) && /床/.test(clause)) {
   if ((kind || named.length) && rooms.length && matches.length !== 1) return {error:'請講清楚要換哪一間睡房的床。'};
   const bedrooms = rooms.filter(room=>room.kind==='bedroom');
   const room=matches[0] || (active?.kind==='bedroom'?active:bedrooms.length===1?bedrooms[0]:null);
   if (!room && bedrooms.length>1) return {error:'有多間睡房。請講埋房間名稱，例如「主人房換護理床」。'};
   const product = /護理床|护理床|升降床|電動床|电动床/.test(clause) ? 'AID-018' : /普通|一般|單人|单人|睡床/.test(clause) ? 'HOME-BED' : null;
   const transferSide = sideOf(clause);
   command={type:'bed',roomId:room?.id,product,transferSide};
  } else return null;
 }
 if (changes.length) {
  if (command && command.type!=='save') return {error:'請先換地面，再分開講另一項修改。'};
  if (new Set(changes.map(change=>change.roomId)).size!==changes.length) return {error:'同一間房請先選一種地面材料。'};
  return {type:'floor',changes,save:command?.label};
 }
 return command || null;
}
