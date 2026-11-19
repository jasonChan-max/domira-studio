import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeFloorplan,findDims,wallBands,otsu} from '../tools/lib/floorplan-cv.mjs';

test('CV rejects empty images and invalid buffers instead of inventing walls',()=>{
  assert.equal(analyzeFloorplan(new Uint8ClampedArray(100*80*4).fill(255),100,80),null);
  assert.throws(()=>analyzeFloorplan(new Uint8Array(4),100,80),/dimensions/);
  assert.throws(()=>wallBands(new Uint8Array(100),10,10,{mmPerPixel:0}),/measured scale/);
});

test('CV retains wall center coordinates and doorway gaps without absorbing isolated text',()=>{
  const w=240,h=180,rgba=new Uint8ClampedArray(w*h*4).fill(255);
  const rect=(x,y,width,height)=>{for(let yy=y;yy<y+height;yy++)for(let xx=x;xx<x+width;xx++){const p=(yy*w+xx)*4;rgba[p]=rgba[p+1]=rgba[p+2]=140;}};
  rect(30,30,180,8);rect(30,140,180,8);rect(30,30,8,118);rect(202,30,8,118);
  rect(110,38,8,40);rect(110,98,8,42);rect(2,2,5,5);
  const result=analyzeFloorplan(rgba,w,h);
  assert.deepEqual(result.frame,{x:30,y:30,w:180,h:118});
  assert.ok(result.lines.hLines.some(b=>Math.abs(b.pos-34)<1));
  assert.ok(result.gaps.some(b=>b.axis==='v'&&Math.abs(b.pos-114)<1&&b.from===78&&b.to===98));
  assert.ok(result.gaps.every(g=>g.kind==='candidate'));
});

test('dimension-line detection requires crossing ticks, not only a long stroke',()=>{
  const w=220,h=180,ink=new Uint8Array(w*h),frame={x:40,y:50,w:140,h:100};
  for(let x=35;x<=185;x++)ink[25*w+x]=1;
  assert.equal(findDims(ink,w,h,frame).top.length,0);
  for(const x of [40,90,180])for(let y=18;y<=32;y++)ink[y*w+x]=1;
  const dims=findDims(ink,w,h,frame);
  assert.ok(dims.top.some(d=>d.at===25&&d.ticks.length===3));
});

test('weighted Otsu separates gray wall ink from pale background',()=>{
  const threshold=otsu([140,150,245,255],[100,100,500,500]);
  assert.ok(threshold>150&&threshold<245);
  assert.equal(otsu([255],[100]),null);
});
