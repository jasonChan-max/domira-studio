import {ALL_CARE_PRODUCTS} from './care-catalog.js';
export const BRIEF_VERSION='domira.care.brief.v1';
export const PREFERENCES=[['night-light','夜間照明'],['high-contrast','清晰色彩對比'],['caregiver','照顧者協助空間'],['easy-clean','容易清潔'],['daylight','自然採光'],['quiet','安靜休息']];
export function validateBrief(brief){
 if(!brief||brief.version!==BRIEF_VERSION||brief.confirmed!==true||!Array.isArray(brief.selections)||!brief.selections.length||brief.selections.length>ALL_CARE_PRODUCTS.length||!Array.isArray(brief.preferences)||brief.preferences.length>6||brief.preferences.some(p=>!PREFERENCES.some(([id])=>id===p))||typeof brief.notes!=='string'||brief.notes.length>500)throw Error('請先完成器具、家具和偏好選擇。');
 const ids=new Set();let count=0;for(const s of brief.selections){const product=ALL_CARE_PRODUCTS.find(p=>p.productId===s.productId);if(!product||ids.has(s.productId)||!Number.isInteger(s.quantity)||s.quantity<1||s.quantity>4||!['w','d','h'].every(k=>Number.isFinite(s[k])&&s[k]>=.005&&s[k]<=8)||!['concept','user-confirmed'].includes(s.dimensionSource))throw Error('產品選擇或整體尺寸不正確。');if(product.role==='surface'&&s.h>.03)throw Error('防滑薄層的厚度上限為0.03m。');ids.add(s.productId);count+=s.quantity;}
 if(count>40)throw Error('每個房間最多選擇40件器具與家具。');return brief;
}
export function requestedItems(brief){validateBrief(brief);return brief.selections.flatMap(s=>{const p=ALL_CARE_PRODUCTS.find(p=>p.productId===s.productId);return Array.from({length:s.quantity},(_,n)=>({type:p.type,careKind:p.careKind,careModel:p.careModel,modelStyle:p.modelStyle,productId:p.productId,sourceRecordId:p.sourceRecordId,role:p.role,name:p.name+(s.quantity>1?' '+(n+1):''),w:s.w,d:s.d,h:s.h,color:p.color,dimensionSource:s.dimensionSource,requestKey:p.productId+':'+n}));});}

export function remainingRequestedItems(project){if(!project.brief)return [];return requestedItems(project.brief).filter(r=>!project.items.some(i=>i.requestKey===r.requestKey&&i.productId===r.productId&&['w','d','h'].every(k=>Math.abs(i[k]-r[k])<1e-8)));}
