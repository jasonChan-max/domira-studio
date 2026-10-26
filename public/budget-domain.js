export const BUDGET_VERSION='2026-10-26';
export const BUDGET_CATEGORIES={
 sofa:{label:'沙發',low:2500,high:7000},chair:{label:'座椅',low:800,high:2600},table:{label:'桌几',low:400,high:1800},lamp:{label:'燈具',low:400,high:1500},rug:{label:'地毯',low:400,high:1800},plant:{label:'植栽',low:250,high:1200},bed:{label:'睡床',low:1800,high:5500},desk:{label:'書桌',low:600,high:2400},cabinet:{label:'收納櫃',low:800,high:3000},bookshelf:{label:'書架',low:700,high:2500},dining:{label:'餐桌',low:900,high:3200},stool:{label:'凳子',low:150,high:600}
};
// Editorial purchasing allowances in HKD, never converted Taiwan prices or merchant offers.
const ESTIMATE_OVERRIDES={
 'muji-wood-sofa':[5000,10000],'ikea-poang':[1800,3800],'muji-highback':[1800,4500],'ikea-lack':[250,600],'ikea-lauters':[500,1200],'yigo-bailey':[1500,5000],'ikea-stoense':[600,1600],'nitori-calypso':[400,1400],'pricerite-hk-desk':[500,1600],'ikea-hk-malm':[1500,4000]
};
const STYLE_FACTORS={timber:1.15,channel:1.1,cantilever:1.1,pedestal:1.3,arc:1.15,upholstered:1.15,canopy:1.35,executive:1.3,tall:1.2,fluted:1.2,extendable:1.2};
const cents=n=>Math.round(n*100),amount=n=>n/100;
export function moneyHK(n){return 'HK$ '+new Intl.NumberFormat('en-HK',{maximumFractionDigits:2}).format(n);}
export function budgetRange(low,high){return low===high?moneyHK(low):moneyHK(low)+'–'+new Intl.NumberFormat('en-HK',{maximumFractionDigits:2}).format(high);}
export function budgetPrice(product){
 if(Number.isFinite(product.price)&&product.price>=0&&product.currency==='HKD')return {kind:'reference',low:product.price,high:product.price,label:'香港參考價快照',basis:product.priceKind||'已收錄的香港售價快照',checkedAt:product.checkedAt||'2026-10-25',source:product.source||null};
 const category=BUDGET_CATEGORIES[product.type];if(!category)throw new Error('尚未支援的家具預算類別。');
 const override=ESTIMATE_OVERRIDES[product.id],factor=STYLE_FACTORS[product.modelStyle]||1;
 const [low,high]=override||[Math.round(category.low*factor/50)*50,Math.round(category.high*factor/50)*50];
 return {kind:'estimate',low,high,label:product.brand==='DOMIRA'||!product.brand?'同類選購預算':'預算估價',basis:override?'Domira 按品類、造型與材質預留的選購區間；未核實此型號香港售價。':'Domira 同類零售選購預留；按造型係數調整，非此模型的在售報價。',checkedAt:BUDGET_VERSION,source:null};
}
export function priceStatus(product){return budgetPrice(product).kind==='estimate'?'預算估價 · 待商戶確認':product.priceKind||'香港參考價快照';}
export function normalizeQuoteSettings(settings={}){const number=(key,max,fallback=0)=>Number.isFinite(Number(settings[key]))?Math.max(0,Math.min(max,Number(settings[key]))):fallback;return {delivery:amount(cents(number('delivery',1000000))),assembly:amount(cents(number('assembly',1000000))),contingency:Math.round(number('contingency',30,10)*10)/10,target:amount(cents(number('target',100000000)))};}
export function buildProjectQuote(project,catalog,settings=project.quoteSettings||{}){
 const options=normalizeQuoteSettings(settings),groups=new Map();
 for(const item of project.items||[]){let product=catalog.find(p=>p.id===item.productId&&p.type===item.type);const adjusted=product&&['w','d','h'].some(k=>Math.abs(item[k]-product[k])>.03);if(adjusted)product=null;
 const candidate=product||{...item,id:null,brand:item.brand||'DOMIRA',price:null,currency:'HKD'},price=budgetPrice(candidate);
 const key=product?'product:'+product.id:JSON.stringify([item.type,item.name,item.modelStyle,item.w,item.d,item.h,item.material,item.color]);
 if(!groups.has(key))groups.set(key,{key,type:item.type,name:product?.name||item.name||BUDGET_CATEGORIES[item.type].label,brand:product?.brand||item.brand||'DOMIRA',modelStyle:item.modelStyle,dimensions:[item.w,item.d,item.h],quantity:0,price:{...price,...(adjusted?{basis:'模型尺寸已調整，改採同類選購估價；原型號價格不作為此尺寸報價。'}:{})}});
 groups.get(key).quantity++;
 }
 const rows=[...groups.values()].map(row=>({...row,low:amount(cents(row.price.low)*row.quantity),high:amount(cents(row.price.high)*row.quantity)}));
 const sum=(list,key)=>amount(list.reduce((total,row)=>total+cents(row[key]),0));
 const categories=Object.entries(BUDGET_CATEGORIES).map(([type,category])=>{const selected=rows.filter(row=>row.type===type);return {type,label:category.label,rows:selected,quantity:selected.reduce((n,r)=>n+r.quantity,0),low:sum(selected,'low'),high:sum(selected,'high')};}).filter(group=>group.rows.length);
 const low=sum(rows,'low'),high=sum(rows,'high'),fees=options.delivery+options.assembly,baseLow=low+fees,baseHigh=high+fees,reserveLow=amount(Math.round(cents(baseLow)*options.contingency/100)),reserveHigh=amount(Math.round(cents(baseHigh)*options.contingency/100));
 const totalLow=amount(cents(baseLow)+cents(reserveLow)),totalHigh=amount(cents(baseHigh)+cents(reserveHigh)),expected=amount(Math.round((cents(totalLow)+cents(totalHigh))/2));
 const known=rows.filter(row=>row.price.kind==='reference'),estimated=rows.filter(row=>row.price.kind==='estimate');
 return {currency:'HKD',settings:options,rows,categories,quantity:rows.reduce((n,r)=>n+r.quantity,0),referenceSubtotal:sum(known,'low'),referenceQuantity:known.reduce((n,r)=>n+r.quantity,0),estimatedQuantity:estimated.reduce((n,r)=>n+r.quantity,0),estimateLow:sum(estimated,'low'),estimateHigh:sum(estimated,'high'),subtotalLow:low,subtotalHigh:high,reserveLow,reserveHigh,totalLow,totalHigh,expected,targetStatus:options.target<=0?'unset':totalLow>options.target?'over':totalHigh<=options.target?'within':'uncertain'};
}
export function quoteCSV(project,quote){
 const lines=[['Domira 家具預算明細','HKD',project.name||''],['預算規則版本',BUDGET_VERSION],['分類','家具','品牌','價格性質','單價下限 HKD','單價上限 HKD','數量','小計下限 HKD','小計上限 HKD','來源或估價依據','資料日期']];
 for(const category of quote.categories){for(const row of category.rows)lines.push([category.label,row.name,row.brand,row.price.label,row.price.low,row.price.high,row.quantity,row.low,row.high,row.price.source||row.price.basis,row.price.checkedAt]);lines.push([category.label+'小計','','','','', '',category.quantity,category.low,category.high]);}
 lines.push(['家具小計','','','','','','',quote.subtotalLow,quote.subtotalHigh],['送貨預留',quote.settings.delivery],['安裝預留',quote.settings.assembly],['備用金 %',quote.settings.contingency],['備用金區間',quote.reserveLow,quote.reserveHigh],['預期總開銷區間',quote.totalLow,quote.totalHigh],['預期開銷中位數',quote.expected],['用戶預算',quote.settings.target],['說明','參考價是查詢快照；估價非商戶報價或訂單。零元送貨及安裝表示尚未預留。未含裝修、床褥、稅費及其他配件，請另行確認。']);
 const cell=value=>'"'+String(value??'').replace(/^(?=[=+@\-])/ ,"'").replaceAll('"','""')+'"';return '\uFEFF'+lines.map(line=>line.map(cell).join(',')).join('\r\n');
}
