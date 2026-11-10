import {HOME_KINDS,homePlanSVG} from './home-domain.js';
import {createManualCareHome} from './care-home-domain.js';

export function openCareHomeBuilder(modal,onCreate){
 modal('手動建立全屋','<form id="manual-home-form"><p>輸入全屋與各房間尺寸。以全屋左上角為原點，房間位置填寫距左、距上的距離。</p><div class="whole-fields" id="manual-home-dimensions"></div><div id="manual-home-rooms"></div><p id="manual-home-status" role="status"></p><div class="manual-home-preview" id="manual-home-preview"></div><div class="whole-builder-actions"><button type="button" class="secondary" id="manual-home-add">＋ 新增房間</button><button class="primary">建立全屋</button></div></form>');
 const form=document.querySelector('#manual-home-form');
 const $=selector=>form.querySelector(selector);
 const status=$('#manual-home-status'),preview=$('#manual-home-preview'),submit=$('button.primary');
 function field(key,label,{value,type='number',min=0,max=40}={}){
  const container=document.createElement('label');container.textContent=label;
  const input=document.createElement('input');input.name=key;input.type=type;input.required=true;input.addEventListener('invalid',()=>{status.textContent='請核對標示欄位。';});
  if(type==='number'){input.step='.01';input.min=min;input.max=max;}else input.maxLength=40;
  if(value!==undefined)input.value=value;
  container.append(input);return container;
 }
 $('#manual-home-dimensions').append(field('title','全屋名稱',{type:'text',value:'我的全屋規劃'}),field('width','全屋寬（m）',{min:2,value:6}),field('depth','全屋深（m）',{min:2,value:5}),field('height','層高（m）',{min:2,max:6,value:2.7}));
 function addRoom({kind='other',width,depth,left,top}={}){
  const row=document.createElement('fieldset');row.className='whole-builder-room';
  const legend=document.createElement('legend');legend.textContent='房間';row.append(legend);
  const fields=document.createElement('div');fields.className='whole-fields';
  const kindLabel=document.createElement('label'),select=document.createElement('select');select.name='kind';kindLabel.textContent='用途';
  for(const [key,label] of Object.entries(HOME_KINDS))select.add(new Option(label,key));
  select.value=kind;kindLabel.append(select);
  fields.append(field('name','房間名稱',{type:'text',value:kind==='other'?'':HOME_KINDS[kind]}),kindLabel,
   field('width','寬（m）',{min:.6,max:20,value:width}),field('depth','深（m）',{min:.6,max:20,value:depth}),
   field('left','距左（m）',{value:left}),field('top','距上（m）',{value:top}));
  const remove=document.createElement('button');remove.type='button';remove.className='secondary';remove.textContent='移除此房間';
  remove.onclick=()=>{row.remove();update();};row.append(fields,remove);$('#manual-home-rooms').append(row);
 }
 function readHome(){
  const number=(root,name)=>root.querySelector(`[name="${name}"]`).valueAsNumber;
  const dimensions=$('#manual-home-dimensions');
  const rows=[...form.querySelectorAll('.whole-builder-room')];
  return createManualCareHome({width:number(dimensions,'width'),depth:number(dimensions,'depth'),height:number(dimensions,'height')},rows.map(row=>({
   name:row.querySelector('[name="name"]').value,kind:row.querySelector('select').value,width:number(row,'width'),depth:number(row,'depth'),left:number(row,'left'),top:number(row,'top')
  })));
 }
 function update(){
  const rows=[...form.querySelectorAll('.whole-builder-room')];
  rows.forEach((row,index)=>{row.querySelector('legend').textContent=`房間 ${index+1}`;row.querySelector('button').disabled=rows.length===1;});
  $('#manual-home-add').disabled=rows.length>=12;
  try{const home=readHome();submit.disabled=false;status.textContent=`${home.rooms.length} 個空間 · 可建立全屋。`;preview.innerHTML=homePlanSVG(home);}
  catch(error){submit.disabled=true;status.textContent=error.message;preview.replaceChildren();}
 }
 form.addEventListener('input',update);
 $('#manual-home-add').onclick=()=>{addRoom();update();form.querySelector('.whole-builder-room:last-child input').focus();};
 form.onsubmit=event=>{
  event.preventDefault();
  try{onCreate($('[name="title"]').value.trim()||'我的全屋規劃',readHome());}
  catch(error){status.textContent=error.message;}
 };
 addRoom({kind:'living',width:3,depth:5,left:0,top:0});addRoom({kind:'bedroom',width:3,depth:5,left:3,top:0});update();
}
