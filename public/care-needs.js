export const CARE_AGES = [['60','60–69 歲'],['70','70–79 歲'],['80','80 歲或以上']];
const AGE_PROMPTS={
 '60':'想保留哪些常用家具？也可以為日後加扶手或使用輔具預留位置。',
 '70':'先想想平日從椅子起身、夜晚去廁所及沖涼，哪一件最想改善？',
 '80':'先確認如何上落床、平常由哪一側扶起身，以及坐著能否拿到常用物品。'
};
export const CARE_GUIDANCE_SOURCES={
 housing:{label:'香港房屋協會｜長者友善家居',url:'https://erc.hkhs.com/site/housing1'},
 safety:{label:'衞生署長者健康服務｜家居安全',url:'https://www.elderly.gov.hk/tc_chi/healthy_ageing/healthy_living/home_safety.html'}
};
export const DAILY_NEEDS={
 vision:{label:'看不清門口或物件',source:'safety',preference:'high-contrast',steps:{all:'讓門框、扶手與開關容易辨認。用柔和照明減少反光，現場核對眩光。',bedroom:'把床邊燈的開關放在坐著也拿得到的位置，夜間起身時有光照到地面。',bathroom:'讓扶手與牆面有明暗對比，並照亮門檻及濕區入口。',kitchen:'在備餐檯補充照明，讓控制按鈕和檯面邊緣容易看清。'}},
 memory:{label:'容易忘記或找不到東西',source:'housing',steps:{all:'保留熟悉的家具位置。用容易辨認的圖案及大字標記門口和常用物品。',bedroom:'常用衣物放在看得到、拿得到的位置，可試用開放或透明收納。',bathroom:'讓廁所門容易辨認，地面用連續色調及簡單圖案。',kitchen:'比較有清楚操作提示及自動關閉功能的爐具。'}},
 balance:{label:'站立或轉身時不穩',source:'safety',preference:'night-light',steps:{all:'清走走道雜物及鬆散地毯，在轉彎、門口及濕區核對地面高差。',living:'試坐有雙扶手的穩固座椅，確認雙腳可以平放地面、容易借力起身。',bathroom:'比較防滑地材、穩固的沖涼椅和固定扶手，並按使用姿勢試配。',bedroom:'在上落床的一側清出空間，並讓床邊夜燈容易開啟。'}},
 transfer:{label:'上落床或如廁需要攙扶',source:'housing',preference:'caregiver',steps:{all:'在需要攙扶的位置預留照顧者的站位，按輔具和實際動作試行。',bedroom:'先確認從哪側上落床、床面高度及照顧者站位，再選床架。',bathroom:'現場試配座廁側的轉移位置、扶手握位和牆身固定方式。'}}
};

export function validateCareNeeds(value){
 if(value===undefined)return;
 if(!value||typeof value!=='object'||Array.isArray(value)||!['',...CARE_AGES.map(([id])=>id)].includes(value.age)||!Array.isArray(value.needs)||value.needs.length>Object.keys(DAILY_NEEDS).length||new Set(value.needs).size!==value.needs.length||value.needs.some(id=>!Object.hasOwn(DAILY_NEEDS,id)))throw Error('請重新選擇年齡及日常需要。');
}

export function careGuidance(daily,kind){
 const age=Object.hasOwn(AGE_PROMPTS,daily?.age)?AGE_PROMPTS[daily.age]:undefined;
 const needs=Array.isArray(daily?.needs)?daily.needs:[];
 const advice=needs.filter(id=>Object.hasOwn(DAILY_NEEDS,id)).map(id=>{
  const {label,steps,source}=DAILY_NEEDS[id];
  return {id,label,text:steps[kind]||steps.all,source};
 });
 return {age,advice};
}

export function careDailyPreferences(preferences,daily){
 return [...new Set([...preferences,...(daily?.needs||[]).map(id=>DAILY_NEEDS[id]?.preference).filter(Boolean)])];
}
