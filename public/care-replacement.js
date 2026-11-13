import {ALL_CARE_PRODUCTS, productFitsProfile} from './care-catalog.js';
import {BRIEF_VERSION, requestedItems} from './care-brief.js';
import {careGeometry, placeCareItem, validateCareProject} from './care-domain.js';

const families = [['chair','sofa'], ['dining','desk','table'], ['cabinet','wardrobe'], ['bed']];

export function replacementProducts(item, profile) {
 const family = families.find(types => types.includes(item.type));
 return ALL_CARE_PRODUCTS.filter(product => {
  if (product.productId === item.productId || !productFitsProfile(product, profile)) return false;
  if (item.type === 'bed') return product.type === 'bed';
  return item.careKind ? product.careKind === item.careKind : !product.careKind && family?.includes(product.type);
 });
}

export function previewCareReplacement(project, itemId, productId, {transferSide} = {}) {
 validateCareProject(project);
 const old = project.items.find(item => item.id === itemId);
 if (!old || old.locked) throw Error('請選擇可以更換的家具。');
 const product = replacementProducts(old, project.profile).find(candidate => candidate.productId === productId);
 if (!product) throw Error('找不到可替換這件家具的款式。');
 const whole = project.wholeHome;
 const conflictingRoom = whole?.home.rooms.find(room => room.id !== whole.activeRoomId && whole.projects[room.id]?.brief?.selections.some(selection => selection.productId === productId));
 if (conflictingRoom) throw Error(`這款已分配到${conflictingRoom.name}。請先到全屋需求修改分配。`);
 const brief = structuredClone(project.brief || {version:BRIEF_VERSION,confirmed:true,selections:[],preferences:[],notes:''});
 const selection = brief.selections.find(entry => entry.productId === old.productId && old.requestKey);
 const removedIndex = selection ? Number(old.requestKey.split(':').at(-1)) : -1;
 if (selection && --selection.quantity === 0) brief.selections.splice(brief.selections.indexOf(selection), 1);
 let nextSelection = brief.selections.find(entry => entry.productId === productId);
 if (nextSelection) nextSelection.quantity++;
 else {
  nextSelection = {productId,quantity:1,w:product.w,d:product.d,h:product.h,dimensionSource:'concept'};
  brief.selections.push(nextSelection);
 }
 const items = project.items.filter(item => item.id !== itemId).map(item => {
  if (removedIndex < 0 || item.productId !== old.productId || !item.requestKey) return item;
  const index = Number(item.requestKey.split(':').at(-1));
  return index > removedIndex ? {...item,requestKey:`${item.productId}:${index-1}`} : item;
 });
 const next = {...project,items,brief,fieldChecks:{}};
 const spec = requestedItems(brief).find(item => item.requestKey === `${productId}:${nextSelection.quantity-1}`);
 const item = placeCareItem(next, {...spec,id:old.id,x:old.x,z:old.z,rotation:old.rotation,transferSide:transferSide||old.transferSide});
 if (!item) return {product,reason:'找不到符合門口及使用空間的擺位。原家具已保留。'};
 next.items = project.items.map(current => current.id === old.id ? item : items.find(remaining => remaining.id === current.id));
 if (whole) {
  const shared = structuredClone(whole.brief || brief);
  if (whole.brief) {
   const previous = shared.selections.find(entry => entry.productId === old.productId && old.requestKey);
   if (previous && --previous.quantity === 0) shared.selections.splice(shared.selections.indexOf(previous), 1);
   const target = shared.selections.find(entry => entry.productId === productId);
   if (target) target.quantity++;
   else shared.selections.push({...nextSelection,quantity:1});
   requestedItems(shared);
  }
  next.wholeHome = {...whole,brief:shared,allocations:{...whole.allocations,[productId]:whole.activeRoomId},view:'room'};
 }
 return {product,item,project:next,access:careGeometry(next,{includePaths:true}).access};
}
