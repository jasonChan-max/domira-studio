import test from 'node:test';
import assert from 'node:assert/strict';
import { doorsFromMask, doorsFromWallGaps } from '../public/room-polygon.js';
const width=600,height=300;
function fixture(gaps, rows=[90]) {
  const mask=new Uint8Array(width*height);
  for(const row of rows) for(let y=row;y<row+10;y++) for(let x=20;x<580;x++) {
    if(!gaps.some(([start,size])=>x>=start&&x<start+size)) mask[y*width+x]=1;
  }
  return mask;
}
const detect=mask=>doorsFromWallGaps(mask,width,height);
test('one 60px opening: bbox and location',()=>{
  const mask=fixture([[180,60]]),doors=detect(mask);
  assert.equal(doors.length,1);
  const d=doors[0];
  assert.ok(Math.abs(d.w-60)<2);assert.ok(Math.abs(d.cx-209.5)<2);
  assert.ok(Math.abs(d.cy-94.5)<2);assert.ok(Math.abs(d.h-10)<2);
  assert.equal(d.horizontal,true);
  assert.deepEqual(doorsFromMask(mask,width,height,{wallGaps:true}),doors);
  assert.deepEqual(doorsFromMask(mask,width,height),[]);
});
test('60px and 80px openings in one wall',()=>{
  const doors=detect(fixture([[140,60],[350,80]]));
  assert.equal(doors.length,2);
  assert.ok(Math.abs(doors[0].w-60)<2);assert.ok(Math.abs(doors[1].w-80)<2);
});
test('unbroken wall has no doors',()=>assert.equal(detect(fixture([])).length,0));
test('parallel walls with facing openings do not cross-pair',()=>{
  const doors=detect(fixture([[200,60]],[90,160]));
  assert.equal(doors.length,2);
  assert.ok(doors.every(d=>d.horizontal&&Math.abs(d.w-60)<2));
});
test('200px opening exceeds door width',()=>assert.equal(detect(fixture([[180,200]])).length,0));
test('a wall obstruction inside the gap rejects the pair without mutating input',()=>{
  const mask=fixture([[180,60]]);
  for(let y=88;y<102;y++) for(let x=208;x<212;x++) mask[y*width+x]=1;
  const before=mask.slice();
  assert.equal(detect(mask).length,0);assert.deepEqual(mask,before);
});
test('vertical opening and class independence',()=>{
  const original=fixture([[180,60]]),rotated=new Uint8Array(original.length);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) rotated[x*height+y]=original[y*width+x]||3;
  const doors=doorsFromWallGaps(rotated,height,width);
  assert.equal(doors.length,1);assert.equal(doors[0].horizontal,false);
  assert.ok(Math.abs(doors[0].h-60)<2);
});
