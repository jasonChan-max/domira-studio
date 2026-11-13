import {CARE_DATA} from './care-data.js';

// Authored category envelopes, not measurements or complete SKU data from Excel.
const dimensionLabel='概念示意尺寸，非SKU、非實測；選購及施工前請以實物整體尺寸覆核。';
const aidSheet=CARE_DATA.sheets.find(sheet=>sheet.name==='②辅助装置产品库');
const definitions=[
 // source ID, model, compatible kind, planning type, W/D/H (m), colour, description
 ['AID-004','quad-cane','cane','chair',.23,.30,.88,'#738d85','四腳底座、可調杖身及橫向握柄示意。原表合併單腳與四腳，本模型展示四腳款。'],
 ['AID-005','rollator','walker','chair',.60,.68,.88,'#7d9a86','四輪、手掣、座板與置物籃的助行車示意；原表亦包含無輪步行架。'],
 ['AID-006','manual-wheelchair','wheelchair','chair',.65,1.02,.94,'#7691a0','有大後輪、手推輪圈、腳踏及推手的手動輪椅示意。'],
 ['AID-007','power-wheelchair','wheelchair','chair',.64,1.00,1.00,'#6e858e','有電池箱、驅動輪及扶手操縱桿的電動輪椅示意。'],
 ['AID-008','round-shower-stool','stool','stool',.42,.42,.46,'#d3dfcf','圓形排水座板、四支可調腳及防滑腳套的無背沐浴凳示意。'],
 ['AID-009','shower-armchair','shower','chair',.54,.53,.85,'#b3cabe','有排水孔座板、靠背及雙扶手的沐浴椅示意。'],
 ['AID-010','wall-folding-seat','folding','chair',.44,.45,.55,'#c7d3c4','展開的掛牆折疊座板、鉸位及支撐腳示意。須另核安裝高度與牆體。'],
 ['AID-011','swivel-shower-chair','swivel','chair',.52,.52,.83,'#a5c3b5','圓座、旋轉轉盤、環形背靠及扶手的旋轉沐浴椅示意。'],
 ['AID-012','wheeled-shower-commode','commode','chair',.55,.85,1.00,'#8fafae','有開孔座板、便桶、四組腳輪與前腳踏的沐浴便廁椅示意。'],
 ['AID-013','toilet-seat-raiser','toilet','chair',.55,.50,.35,'#e0e4d7','獨立加高廁板、中央開孔、固定旋鈕與輔助扶手示意，不包含原有坐廁。'],
 ['AID-014','bedside-commode','commode','chair',.54,.55,.83,'#a8b7a0','無輪床旁便椅，配可拆座蓋、便桶及穩定腳套。'],
 ['AID-015','wall-grab-rail','rail','chair',.60,.09,.65,'#b4c7aa','防滑握段及三個固定底座的L型扶手示意；位置與錨固須現場設計。'],
 ['AID-016','anti-slip-mat','surface','rug',.65,.45,.012,'#8aab9c','柔性防滑墊示意，有邊框、排水紋及凸點；亦代表原表防滑條品類。'],
 ['AID-017','anti-slip-tiles','surface','rug',.90,.90,.018,'#c3c8b4','九格粗面地磚與縫隙的薄地面飾層示意；不表示檢測防滑等級。'],
 ['AID-018','electric-care-bed','care-bed','bed',1.02,2.12,1.02,'#a6b49c','可抬背的分段床面、護欄、腳輪及手持控制器的護理床示意。'],
 ['AID-019','reminder-pillbox','pillbox','cabinet',.22,.12,.065,'#a4bba1','七格藥物分隔、可辨按鍵與提醒顯示窗的藥盒示意。'],
];

export const CARE_PRODUCTS=Object.freeze(definitions.map(([productId,careModel,careKind,type,w,d,h,color,description])=>{
 const record=aidSheet?.records.find(row=>row.id===productId);
 if(!record)throw Error('找不到原表器具記錄：'+productId);
 return Object.freeze({productId,name:record.fields['产品类型'],type,careKind,careModel,w,d,h,color,
  ...(careKind==='surface'?{role:'surface'}:{}),sourceRecordId:productId,
  sourceSheet:record.source_sheet,sourceRow:record.source_row,sourceFields:Object.freeze({...record.fields}),
  dimensionSource:'concept',dimensionLabel,conceptDimensions:Object.freeze({w,d,h,units:'m',basis:'authored-category-illustration'}),
  sku:null,category:record.fields['类别'],description});
}));

// General home furniture uses the existing furniture() models. Related Excel
// rows are context only, not extra products or SKU dimensions claimed by Excel.
const homeDefinitions=[
 ['HOME-CHAIR','扶手椅','chair',.66,.72,.94,'#b5ae91','起居家具','有靠背及雙扶手的概念座椅；須另核實座高與坐起動作。',[]],
 ['HOME-SOFA','扶手沙發','sofa',1.85,.86,.88,'#b9b8a1','起居家具','雙人扶手沙發示意，整體包絡不代表原表的座面尺寸。',['DES-025']],
 ['HOME-BED','睡床','bed',1.20,2.10,.88,'#c8c4ad','睡房家具','單人睡床概念包絡含床頭板，整體高度不是床面高度。',['DES-017','DES-018']],
 ['HOME-CABINET','收納櫃','cabinet',1.10,.42,.85,'#aaa68d','收納家具','低身收納櫃示意；開門、抽屜操作及可及高度需另留空間。',['DES-013','DES-021']],
 ['HOME-DINING','餐桌','dining',1.20,.80,.75,'#b5aa8e','用餐家具','餐桌概念包絡；輪椅膝部空間與拉椅位置需另行核對。',[]],
 ['HOME-DESK','書桌','desk',1.10,.60,.75,'#b9ae94','工作家具','書桌概念包絡；座姿、膝部與常用物件位置需另行試配。',[]],
];
export const HOME_FURNITURE=Object.freeze(homeDefinitions.map(([productId,name,type,w,d,h,color,category,description,relatedSourceRecordIds])=>Object.freeze({
 productId,name,type,w,d,h,color,category,description,sourceRecordId:null,relatedSourceRecordIds:Object.freeze(relatedSourceRecordIds),
 dimensionSource:'concept',dimensionLabel,conceptDimensions:Object.freeze({w,d,h,units:'m',basis:'authored-home-furniture-illustration'}),sku:null,
})));
// Original alternatives are separate from imported workbook records.
const innovations=[
 ['HOME-CHAIR','DOMIRA 安心閱讀扶手椅','cantilever',.70,.78,1.02,'#879a8c','高背閱讀與雙側扶手概念，配清晰的握持色彩；坐起動作及穩定性需實物驗證。'],
 ['HOME-SOFA','DOMIRA 分區陪伴沙發','timber',1.72,.82,.90,'#b8ac94','木框雙人座與獨立坐墊概念，為照顧者陪坐及換洗預留設計方向。'],
 ['HOME-BED','DOMIRA 柔背起居床','upholstered',1.20,2.12,.98,'#b3b8a0','軟包床頭與對比床框概念；轉移高度需按使用者與床褥核對。'],
 ['HOME-CABINET','DOMIRA 易見分區收納櫃','fluted',1.0,.38,.78,'#9d947b','低身分區收納及清楚門面紋理概念，常用物品集中在易見位置。'],
 ['HOME-DINING','DOMIRA 圓桌共餐島','round',1.10,1.10,.76,'#b8a886','中央柱腳圓桌概念，減少外側桌腳；膝部淨空與抗傾覆需核實。'],
 ['HOME-DESK','DOMIRA 輕盈共用書桌','trestle',1.20,.65,.76,'#a7b6a1','開放桌下空間與對比桌緣概念；輪椅膝部淨空需按實物檢查。'],
];
export const INNOVATIVE_FURNITURE=Object.freeze([
 ...innovations.map(([baseId,name,modelStyle,w,d,h,color,description])=>{const base=HOME_FURNITURE.find(p=>p.productId===baseId);return Object.freeze({...base,productId:'DESIGN-'+baseId,optionFamily:baseId,name,modelStyle,w,d,h,color,description,relatedSourceRecordIds:[],conceptDimensions:Object.freeze({w,d,h,units:'m',basis:'authored-home-furniture-illustration'})});}),
 ...CARE_PRODUCTS.map(p=>{const w=Number((p.w*.94).toFixed(3)),d=Number((p.d*.96).toFixed(3));return Object.freeze({...p,productId:'DESIGN-'+p.productId,optionFamily:p.careKind,name:'DOMIRA '+p.name+' · 清晰綠調',w,d,color:'#88a69a',sourceRecordId:null,sourceSheet:null,sourceRow:null,sourceFields:null,description:'原創配色與較窄整體包絡的設計探索；'+p.description+' 並非原表商品或已驗證規格，承重與操作須另行核實。',conceptDimensions:Object.freeze({w,d,h:p.h,units:'m',basis:'authored-category-illustration'})});})
]);
export function careFurnitureOptions(product){const family=p=>p.optionFamily||p.careKind||p.productId;return ALL_CARE_PRODUCTS.filter(p=>family(p)===family(product));}
export const ALL_CARE_PRODUCTS=Object.freeze([...CARE_PRODUCTS,...HOME_FURNITURE,...INNOVATIVE_FURNITURE]);

export function productFitsProfile(product, profile){
 return profile!=='wheelchair'||!['walker','cane'].includes(product?.careKind);
}
