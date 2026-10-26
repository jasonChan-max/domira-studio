export const HK_PRICE_UPDATES={
 'nitori-calypso':{pros:['160 cm 寬度較容易保留周邊地板','平織輪廓可用作座位區試搭']},
 'muji-wood-sofa':{cons:['香港售價與布套組合需向門市核實','木框扶手的實際觸感需到店確認']},
 'ikea-kivik':{price:3499,priceKind:'香港官網查詢價',source:'https://www.ikea.com.hk/en/products/sofas-and-armchairs/sofas',review:{stars:3.7,count:3,source:'https://www.ikea.com.hk/en/products/sofas-and-armchairs/sofas'}},
 'muji-oval':{price:680,priceKind:'香港官網促銷快照',source:'https://onlineshop.muji.com.hk/en/products/4550512828433',w:1.1,d:.62,h:.35,cons:['香港頁面促銷價可能變更','款式、庫存及桌高請購買前確認']}
};
const hk={market:'香港',currency:'HKD',checkedAt:'2026-10-25',review:null,priceKind:'香港官網查詢價',modelNotice:'Domira 自製比例示意，非品牌官方 CAD；示意配件不包含於報價。',dimensionBasis:'示意尺寸，購買前核實完整規格'};
const product=(id,type,name,brand,price,w,d,h,modelStyle,color,source,pros,cons,material,scores)=>({...hk,id,type,name,brand,price,w,d,h,modelStyle,color,source,pros,cons,material,scores,priceKind:price===null?'香港報價待核實':'香港官網查詢價'});
export const HK_ADDITIONS=[
 product('muji-hk-armless','sofa','寬座無扶手雙人梳化','MUJI',5280,1.6,.9,.75,'armless','#c7c0ae','https://onlineshop.muji.com.hk/en/categories/sofas',['無扶手輪廓方便不同方向入座','適合搭配獨立邊几'],['完整寬深高待門店核實','示意模型非官方結構，需確認布套組合'],'織物梳化 · 規格以官網為準',{value:7.2,materials:7.5,care:7,versatility:8}),
 product('ikea-hk-micke','desk','MICKE 小型書枱 73','IKEA',399.9,.73,.5,.75,'writing','#dbd9ce','https://www.ikea.com.hk/en/products/work-desks/home-desks',['73 × 50 cm 桌面適合較窄空間','門檻較低的工作區選項'],['桌面較小，大螢幕需確認距離','淺色表面仍需定期清潔'],'板材桌面 · 小型書枱',{value:9.2,materials:6.5,care:8,versatility:7.5}),
 product('ikea-hk-tonstad','desk','TONSTAD 橡木飾面書枱','IKEA',1699,1.2,.47,.75,'executive','#b49b72','https://www.ikea.com.hk/en/products/work-desks/home-desks',['120 cm 寬度提供較長工作面','47 cm 深度利於窄房間'],['橡木飾面並非整塊實木','雙櫃造型為示意，抽屜配置以實品為準'],'橡木飾面',{value:7.8,materials:8,care:7.8,versatility:7.8}),
 product('pricerite-hk-desk','desk','小型書枱系列','Pricerite',null,1.2,.6,.75,'trestle','#aa9477','https://www.pricerite.com.hk/hk/en-us/category/furniture/study-room/study-desk',['可從香港書房系列選擇不同尺寸','可先用概念比例試搭'],['指定型號與港幣售價待核實','尺寸為佈局示意，非特定在售型號'],'書枱系列示意',null),
 product('muji-hk-oak-shelf','bookshelf','橡木五層組合層架','MUJI',1080,.42,.285,2,'grid','#ae946b','https://onlineshop.muji.com.hk/en/pages/large-furniture-26-1',['格架方便收納物分類','橡木色適合自然風格'],['尺寸與防傾倒固定方式需核實','組合配件另計，需確認本體配置'],'橡木組合層架',{value:8.1,materials:8,care:7.8,versatility:8.5}),
 product('ikea-hk-billy','bookshelf','BILLY/OXBERG 玻璃門書架','IKEA',1029,.8,.3,2.02,'open','#d8d7cc','https://www.ikea.com.hk/en/en/campaign/new-lower-price',['80 × 30 cm 占地較緊湊','玻璃門組合可展示藏品'],['模型以開放架示意，玻璃門以實品為準','高櫃需按官方方式固定防傾倒'],'板材與玻璃門組合',{value:8.6,materials:7,care:7.5,versatility:8.4}),
 product('muji-hk-oak-cabinet','cabinet','橡木木門收納櫃','MUJI',1880,.88,.44,.83,'low','#ac926e','https://onlineshop.muji.com.hk/en/categories/wooden-cabinets',['門片讓收納視覺更簡潔','木色適合與自然材質搭配'],['門片開啟前方需留空間','價格與完整尺寸請以門店為準'],'橡木木門櫃',{value:7.8,materials:8,care:7.8,versatility:8.3}),
 product('ikea-hk-brimnes','cabinet','BRIMNES 電視收納櫃 120','IKEA',799,1.2,.41,.53,'low','#deded3','https://www.ikea.com.hk/en/en/campaign/new-lower-price',['120 × 41 cm 占地容易規劃','可用作低位影音收納方向'],['抽屜與承重以實品規格為準','需保留設備散熱與走線空間'],'板材低櫃',{value:8.8,materials:6.8,care:8,versatility:8}),
 product('muji-hk-walnut-bed','bed','胡桃木貼皮單人床架','MUJI',2580,1.03,2.02,.6,'platform','#857055','https://onlineshop.muji.com.hk/en/categories/beds-mattresses',['單人比例便於小睡房規劃','木貼皮外觀容易搭配'],['報價僅床架，床腳床褥等組合需另核實','示意高度含床褥及床頭，非報價尺寸'],'胡桃木貼皮床架',{value:7.4,materials:8,care:8,versatility:7}),
 product('ikea-hk-malm','bed','MALM 雙人高床架','IKEA',null,1.66,2.09,1,'platform','#d9d6cc','https://www.ikea.com.hk/en/malm',['床架系列有不同尺寸配置','可規劃床邊收納與走道'],['香港指定尺寸港幣報價待核實','床褥為示意，實際床架與床底組合請核實'],'床架系列 · 模型材質示意',null),
 product('muji-hk-dining','dining','橡木客飯兩用枱','MUJI',2280,1.3,.65,.6,'rect','#b49b73','https://onlineshop.muji.com.hk/en/products/oak-wood-living-dining-table',['客飯兩用方向適合彈性空間','橡木色容易整合餐椅'],['高度與指定尺寸需核實','實品尺寸不同時需調整模型'],'橡木客飯兩用枱',{value:7.7,materials:8.2,care:7.5,versatility:8.8}),
 product('pricerite-hk-delgado','dining','DELGADO 薄身摺枱','Pricerite',799,1.2,.8,.73,'extendable','#b29a78','https://www.pricerite.com.hk/hk/zh-hk/category/furniture/dining-room',['展開 120 × 80 cm 可作餐桌','收起厚度 16.5 cm 利於小空間'],['模型只顯示展開狀態','摺合機構與承重須以實品為準'],'摺合餐枱',{value:9,materials:6.8,care:7.8,versatility:9}),
 product('muji-hk-stool','stool','鋼管可疊凳','MUJI',158,.4,.4,.45,'tubular','#8c826f','https://onlineshop.muji.com.hk/en/categories/home-accessories',['可疊放形式方便臨時加座','體積小，適合補充座位'],['模型底架材質為示意','尺寸與可疊數量待核實'],'鋼管可疊凳',{value:9,materials:7,care:8.5,versatility:8.7})
];
