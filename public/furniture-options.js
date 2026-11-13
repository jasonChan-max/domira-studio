import {PRODUCTS} from './products.js';
// Detail choices intentionally use the whole category, independently of library filters.
export function furnitureOptions(product){return PRODUCTS.filter(option=>option.type===product.type).sort((a,b)=>Number(b.id===product.id)-Number(a.id===product.id));}
