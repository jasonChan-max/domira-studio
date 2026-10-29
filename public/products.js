import {budgetPrice,budgetRange} from './budget-domain.js';
import {HK_ADDITIONS,HK_PRICE_UPDATES} from './hong-kong-catalog.js';
import {CATALOG} from './domain.js';
export const PRICE_CHECKED='2026-10-25';
export const SCORE_WEIGHTS={value:.25,materials:.20,care:.20,versatility:.20,fit:.15};
export const SCORE_LABELS={value:'價格競爭力',materials:'材質配置',care:'維護便利',versatility:'使用彈性',fit:'房間適配'};
const pdf='https://shop.muji.tw/muji-journal/pdf/pdf/25AW-furniture.pdf';
const basic={market:'台灣',currency:'HKD',checkedAt:PRICE_CHECKED,review:null,dimensionBasis:'官網規格',modelNotice:'Domira 自製比例示意模型，非品牌官方 CAD；材質與細節請以實品為準。'};
const make=(id,type,name,brand,price,w,d,h,modelStyle,color,extra)=>({...basic,id,type,name,brand,price,w,d,h,modelStyle,color,...extra});
const LEGACY_BRANDED_PRODUCTS=[
 make('ikea-kivik','sofa','KIVIK 雙人沙發','IKEA',12990,1.9,.95,.83,'cloud','#bcb5a4',{priceKind:'官網頁面',source:'https://www.ikea.com.tw/zh/products/sofas/sofas/kivik-spr-19440594',material:'布面、泡棉與獨立筒',scores:{value:8.6,materials:7.7,care:9,versatility:8.5},pros:['布套可拆洗與更換','低扶手與深座面利於休憩'],cons:['寬扶手會占用座位外側空間','95 cm 深度需確認客廳動線'],review:{stars:5,count:1,source:'https://www.ikea.com.tw/zh/collections/sofa-kivik'}}),
 make('muji-wood-sofa','sofa','木製沙發・水洗棉 2 人座','MUJI',23900,1.48,.96,.825,'timber','#c6bdab',{priceKind:'2025 AW 型錄參考',source:pdf,material:'橡木扶手、木貼皮與棉布套',scores:{value:6.6,materials:8.7,care:8,versatility:8.4},pros:['148 cm 寬適合較小牆面','木框與布面形成清楚的材質層次'],cons:['參考價高於此處 KIVIK 選項','型錄價格需向門市確認現售組合']}),
 make('ikea-poang','chair','POÄNG 皮面扶手椅','IKEA',6799,.68,.82,1,'cantilever','#a8784d',{priceKind:'官網頁面',source:'https://www.ikea.com.tw/zh/products/armchairs-footstool-and-sofa-tables/armchairs/poang-spr-59625251',material:'樺木貼皮框架、皮面椅墊',scores:{value:8.2,materials:8.3,care:7.6,versatility:8},pros:['高背形式，適合獨立閱讀角','椅墊有不同配搭選項'],cons:['懸臂底架需保留完整地面空間','皮面需依官方方式保養']}),
 make('muji-highback','chair','高椅背和室沙發','MUJI',11900,.74,1.365,.895,'lounge','#b6b7a8',{priceKind:'2025 AW 型錄參考',source:pdf,material:'聚酯布、鋼架與木腳',scores:{value:7.2,materials:7.5,care:8.7,versatility:9.1},pros:['可調整靠背，使用姿勢較多','可拆卸清洗的布套'],cons:['模型按最大展開深度預留 136.5 cm','參考型錄價格需向門市核實'],dimensionNote:'寬 74；深 114–136.5；高 66.5–89.5 cm。模型預留展開深度。'}),
 make('ikea-lack','table','LACK 染白橡木紋茶几','IKEA',999,.9,.55,.45,'rect','#b5a888',{priceKind:'官網頁面',source:'https://www.ikea.com.tw/zh/products/sofa-tables/sofa-tables-and-side-tables',material:'木紋飾面板材',scores:{value:9.5,materials:6.2,care:8,versatility:8},pros:['此組對比中預算門檻較低','下層置物板可收納小物'],cons:['木紋飾面不等於實木桌板','直角桌面需留意行走動線'],review:{stars:4.6,count:46,source:'https://www.ikea.com.tw/zh/products/sofa-tables/sofa-tables-and-side-tables'}}),
 make('muji-oval','table','橡膠木橢圓矮桌 110','MUJI',4590,1.1,.62,.35,'oval','#a28963',{priceKind:'2025 AW 型錄參考',source:pdf,material:'橡膠木貼皮桌板、天然木桌腳',scores:{value:7.4,materials:8.1,care:7.9,versatility:8.2},pros:['橢圓輪廓減少突出的桌角','35 cm 低桌適合低座位配置'],cons:['桌板為木貼皮，非整片實木','桌高偏低，需核對沙發座面高度']}),
 make('ikea-lauters','lamp','LAUTERS 實木落地燈','IKEA',2299,.62,.62,1.51,'tripod','#d5c6a0',{priceKind:'官網頁面',source:'https://www.ikea.com.tw/zh/products/luminaires/floor-lamps/lauters-art-60405050',material:'實心梣木、聚酯燈罩',scores:{value:8.9,materials:8.2,care:7.7,versatility:8.4},pros:['可調整高度，適應不同座位','布罩提供柔和散射光'],cons:['E27 燈泡需另外購買','62 cm 底座需預留地面空間']}),
 make('yigo-bailey','lamp','Bailey 貝利落地燈','YIGO',8370,.35,.35,1.6,'column','#d8caa8',{priceKind:'官網系列頁參考',source:'https://www.yigo.tw/collections/floor-lamps',material:'木質與布面風格',scores:{value:5.8,materials:7.8,care:7,versatility:6.7},pros:['柱狀輪廓容易融入安靜空間','適合作為角落氣氛光的設計方向'],cons:['查詢時系列頁顯示售罄','尺寸為示意，選購前需向賣方確認'],dimensionBasis:'示意尺寸，非已核實商品規格',availability:'查詢時售罄'}),
 make('ikea-stoense','rug','STOENSE 短毛地毯','IKEA',3999,2.4,1.7,.018,'plush','#c5bcaa',{priceKind:'官網頁面',source:'https://www.ikea.com.tw/zh/products/home-furnishing-rugs/rugs/stoense-art-90607669',material:'聚丙烯絨面、合成橡膠背面',scores:{value:7.8,materials:7.3,care:5.8,versatility:8.1},pros:['170 × 240 cm 可界定小型座位區','短毛表面帶柔和光澤'],cons:['官方標示不可洗滌','需另搭防滑墊，頁面顯示線上缺貨'],availability:'查詢時線上缺貨'}),
 make('nitori-calypso','rug','Calypso 地毯 160 × 235','NITORI',2490,2.35,1.6,.012,'woven','#9c9b8c',{priceKind:'品牌直營店頁參考',source:'https://www.rakuten.com.tw/shop/nitori/product/7232212/',material:'以直營店商品標示為準',scores:{value:8.5,materials:6.5,care:6.5,versatility:7.8},pros:['標示價格低於此處 STOENSE','160 cm 寬度較容易保留周邊地板'],cons:['尚無已核實的清洗與纖維規格','12 mm 厚度為示意，需核對實品'],dimensionBasis:'寬深為官方型錄；厚度示意'})
];
export const BRANDED_PRODUCTS=[...LEGACY_BRANDED_PRODUCTS.map(p=>({...p,market:'香港',currency:'HKD',price:null,priceKind:'香港報價待核實',availability:null,review:null,scores:null,cons:[...p.cons,'原來源為台灣資料；香港供應與報價待核實'],...HK_PRICE_UPDATES[p.id],...(HK_PRICE_UPDATES[p.id]?.price>0?{scores:p.scores}: {})})),...HK_ADDITIONS];
const concepts={
 sofa:[['cloud','雲朵布藝','#bcb5a4'],['timber','橡木框架','#c7bfae'],['channel','復古絎縫','#687a70']],
 chair:[['arc','弧形木椅','#a38360'],['cantilever','懸臂高背','#b1aa94'],['lounge','包覆休閒','#7c8b82']],
 table:[['oval','原木橢圓','#8e7252'],['rect','雙層方几','#b6a382'],['pedestal','洞石圓几','#c6bba5']],
 lamp:[['arc','黃銅弧光','#b8a377'],['tripod','梣木三腳','#cbb993'],['column','柔光柱燈','#ded2b5']],
 rug:[['woven','天然編織','#bfb6a2'],['plush','細絨奶油','#d4cbb8'],['border','幾何邊框','#919c91']],
 bed:[['platform','原木低台床','#b4a38a'],['upholstered','軟包雙人床','#c4b5a4'],['canopy','四柱木床','#9b805a']],
 desk:[['writing','單屜書桌','#b3946a'],['trestle','支架工作桌','#b1a58e'],['executive','雙櫃書桌','#947c5b']],
 cabinet:[['low','雙門低櫃','#aa936e'],['fluted','直紋收納櫃','#a38a63'],['tall','高身收納櫃','#9b896e']],
 bookshelf:[['open','開放層架','#b69d76'],['ladder','斜梯層架','#a48b67'],['grid','方格書架','#b7a17f']],
 dining:[['rect','實木長餐桌','#b29b76'],['round','圓柱腳餐桌','#b8aa8b'],['extendable','伸展餐桌','#9b805b']],
 stool:[['round','圓座木凳','#a58f68'],['saddle','馬鞍木凳','#9d825b'],['upholstered','軟墊矮凳','#b7b09c']],
 wardrobe:[['door','雙門木櫃','#b9a888'],['open','開放層架','#c2b49a'],['sliding','推拉門櫃','#a89a80']],
 plant:[['fig','琴葉榕','#59714c'],['olive','橄欖樹','#6c7d59'],['palm','散尾葵','#526d50']]
};
export const CONCEPT_PRODUCTS=Object.entries(concepts).flatMap(([type,styles])=>styles.map(([modelStyle,name,color])=>({...CATALOG[type],id:'concept-'+type+'-'+modelStyle,type,modelStyle,name,brand:'DOMIRA',color,price:null,source:null,material:({sofa:'織物與木框',chair:'木質與織物',table:modelStyle==='pedestal'?'洞石風格':'木質風格',lamp:'金屬、木質與織物',rug:'編織風格',plant:'室內植栽示意',bed:'木質與織物',desk:'木質與金屬',cabinet:'木質收納',bookshelf:'木質層架',dining:'木質桌面',stool:'木質與織物'})[type],dimensionBasis:'設計概念尺寸',modelNotice:'Domira 原創概念模型，無對應在售商品，不提供虛構報價。',scores:null,pros:['可直接加入場景試搭','配色與輪廓可自由組合'],cons:['未對應實際品牌商品','尺寸、材質與售價需另行選購確認']})));
export const PRODUCTS=[...BRANDED_PRODUCTS,...CONCEPT_PRODUCTS];
export function priceLabel(product){const price=budgetPrice(product);return (price.kind==='estimate'?'約 ':'')+budgetRange(price.low,price.high);}
export function analyzeProduct(product,room){if(!product.scores)return null;const area=product.w*product.d,available=room.width*room.depth;const fits=product.w<=room.width&&product.d<=room.depth;const fit=fits?Math.max(3,Math.min(9.6,9.8-area/available*12)):0;const scores={...product.scores,fit:Math.round(fit*10)/10};const total=Math.round(Object.entries(SCORE_WEIGHTS).reduce((sum,[key,weight])=>sum+scores[key]*weight,0)*10)/10;return {scores,total,stars:Math.round(total/2*10)/10,fit:fits,footprint:area,coverage:area/available*100};}
export function toSceneItem(product){return {...CATALOG[product.type],type:product.type,name:product.name,w:product.w,d:product.d,h:product.h,color:product.color,modelStyle:product.modelStyle,productId:product.id,brand:product.brand,material:product.material,priceSnapshot:product.price===null?null:{amount:product.price,currency:'HKD',checkedAt:product.checkedAt,kind:product.priceKind,source:product.source}};}
