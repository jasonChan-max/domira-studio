import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as THREE from '../public/vendor/three.module.js';
import {CARE_DATA} from '../public/care-data.js';
import {CARE_PRODUCTS,HOME_FURNITURE,INNOVATIVE_FURNITURE,ALL_CARE_PRODUCTS} from '../public/care-catalog.js';
import {careFurniture} from '../public/care-furniture.js';
import {furniture} from '../public/furniture.js';

const dispose=group=>group.traverse(object=>{object.geometry?.dispose();if(Array.isArray(object.material))object.material.forEach(material=>material.dispose());else if(object.material&&!object.material.userData.shared)object.material.dispose();});
const close=(actual,expected,label)=>assert.ok(Math.abs(actual-expected)<1e-6,`${label}: ${actual} vs ${expected}`);

test('all sixteen workbook product rows map once to explicit concept envelopes with intact source fields',()=>{
 const records=CARE_DATA.sheets.find(sheet=>sheet.name==='②辅助装置产品库').records;
 assert.equal(CARE_PRODUCTS.length,16);assert.deepEqual(CARE_PRODUCTS.map(product=>product.productId),records.map(record=>record.id));
 assert.equal(new Set(CARE_PRODUCTS.map(product=>product.careModel)).size,16);
 for(const product of CARE_PRODUCTS){
  const record=records.find(row=>row.id===product.productId);
  assert.equal(product.sourceRecordId,record.id);assert.equal(product.name,record.fields['产品类型']);assert.equal(product.category,record.fields['类别']);assert.deepEqual(product.sourceFields,record.fields);
  assert.equal(product.sourceSheet,record.source_sheet);assert.equal(product.sourceRow,record.source_row);assert.equal(product.dimensionSource,'concept');assert.equal(product.sku,null);assert.match(product.dimensionLabel,/非SKU.*非實測/);
  assert.deepEqual(product.conceptDimensions,{w:product.w,d:product.d,h:product.h,units:'m',basis:'authored-category-illustration'});
  assert.ok(['w','d','h'].every(key=>Number.isFinite(product[key])&&product[key]>0));assert.match(product.color,/^#[a-f\d]{6}$/i);assert.ok(product.description);
  if(product.role==='surface'){assert.equal(product.type,'rug');assert.equal(product.careKind,'surface');assert.ok(product.h<=.03);}
 }
 assert.equal(HOME_FURNITURE.length,6);assert.equal(ALL_CARE_PRODUCTS.length,44);assert.equal(new Set(ALL_CARE_PRODUCTS.map(product=>product.productId)).size,44);
 assert.deepEqual(HOME_FURNITURE.map(product=>product.type),['chair','sofa','bed','cabinet','dining','desk']);
});

test('every category has a distinct finite mesh and follows supplied metre envelopes at different aspect ratios',()=>{
 const fingerprints=new Set();
 for(const product of CARE_PRODUCTS){
  for(const [index,envelope] of [{w:product.w,d:product.d,h:product.h},{w:.73,d:1.17,h:.92}].entries()){
   const group=careFurniture({...product,...envelope,id:product.productId,x:0,z:0,rotation:0});
   group.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(group),size=bounds.getSize(new THREE.Vector3());
   for(const [axis,key] of [['x','w'],['y','h'],['z','d']])close(size[axis],envelope[key],product.productId+' '+axis);
   close(bounds.min.y,0,product.productId+' floor');close((bounds.min.x+bounds.max.x)/2,0,'center x');close((bounds.min.z+bounds.max.z)/2,0,'center z');
   assert.equal(group.userData.careModel,product.careModel);assert.equal(group.userData.dimensionSource,'concept');
   let meshes=0;const hash=createHash('sha256');
   group.traverse(object=>{if(!object.isMesh)return;meshes++;assert.ok(object.matrixWorld.elements.every(Number.isFinite));const position=object.geometry.getAttribute('position');assert.ok(position.count>0);assert.ok([...position.array].every(Number.isFinite));hash.update(Buffer.from(position.array.buffer,position.array.byteOffset,position.array.byteLength));hash.update(object.userData.part||'');});
   assert.ok(meshes>1,product.productId+' has recognizable parts');if(index===0)fingerprints.add(hash.digest('hex'));dispose(group);
  }
 }
 assert.equal(fingerprints.size,16,'separate geometry for both wheelchairs, commodes and surface layers');
});

test('wheelchairs, finishes, raiser and medical equipment retain identifying parts',()=>{
 const parts=id=>{const product=CARE_PRODUCTS.find(product=>product.productId===id),group=careFurniture(product),result=new Set();group.traverse(object=>{if(object.userData.part)result.add(object.userData.part);});dispose(group);return result;};
 assert.ok(parts('AID-006').has('hand-push-rim'));assert.ok(!parts('AID-006').has('joystick'));assert.ok(parts('AID-007').has('joystick'));assert.ok(parts('AID-007').has('battery-box'));assert.ok(!parts('AID-007').has('hand-push-rim'));
 assert.ok(parts('AID-016').has('grip-nub'));assert.ok(!parts('AID-016').has('grout-bed'));assert.ok(parts('AID-017').has('grout-bed'));
 assert.ok(parts('AID-013').has('toilet-fixing-clamp'));assert.ok(parts('AID-013').has('open-toilet-seat'));assert.ok(parts('AID-018').has('raised-back-section'));assert.ok(parts('AID-018').has('bed-controller'));assert.ok(parts('AID-019').has('daily-compartment'));assert.ok(parts('AID-019').has('reminder-display'));
});

test('source IDs recover distinct models for old projects and kind-only projects remain renderable',()=>{
 for(const product of CARE_PRODUCTS){const group=careFurniture({careKind:product.careKind,sourceRecordId:product.sourceRecordId,w:.5,d:.6,h:.7});assert.equal(group.userData.careModel,product.careModel);dispose(group);}
 for(const careKind of ['cane','walker','wheelchair','stool','shower','folding','swivel','commode','toilet','rail','surface','care-bed','pillbox']){const group=careFurniture({careKind,w:.7,d:.9,h:1.1,x:0,z:0,rotation:0,color:'#aabbcc'}),size=new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());close(size.x,.7,careKind);close(size.y,1.1,careKind);close(size.z,.9,careKind);dispose(group);}
});

test('1:1 bounds survive placement and rotation and home furniture retains the existing furniture API',()=>{
 for(const product of ALL_CARE_PRODUCTS){const item={...product,id:product.productId,x:1.4,z:-2.1,rotation:90},group=furniture(item),bounds=new THREE.Box3().setFromObject(group),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());close(size.x,item.d,item.productId+' rotated width');close(size.z,item.w,item.productId+' rotated depth');close(size.y,item.h,item.productId+' height');close(center.x,item.x,'translated x');close(center.z,item.z,'translated z');close(bounds.min.y,0,'floor');dispose(group);}
});

test('invalid envelopes cannot create NaN or infinite models',()=>{
 for(const bad of [undefined,0,-.1,NaN,Infinity])assert.throws(()=>careFurniture({careKind:'cane',w:bad,d:1,h:1}),/整體/);
 assert.throws(()=>careFurniture({careKind:'cane',w:.2,d:.2,h:1,x:NaN}),/位置/);
});
