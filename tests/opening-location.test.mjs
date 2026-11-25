import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyOpeningByLocation,hasDoorArc,analyzeDoorArc,imageGrayFromImageData} from '../public/opening-location.js';
import {classifyOpenings,doorsToHome,filterDoorsByMaskClass} from '../public/opening-detection.js';

const box={x:90,y:90,w:8,h:60,cls:'door',score:.9};
function maskSides(a,b){const mask=new Uint8Array(240*240).fill(1);for(let y=0;y<240;y++)for(let x=0;x<240;x++)if(x<90||x>98)mask[y*240+x]=x<90?a:b;return mask;}
function symbol({sx=-1,sy=1,arc=true,leaf=true,radius=60,level=120,center={x:94,y:90}}={}){
 const width=240,height=240,data=new Uint8Array(width*height).fill(255);
 const put=(x,y)=>{x=Math.round(x);y=Math.round(y);if(x>=0&&y>=0&&x<width&&y<height)data[y*width+x]=level;};
 if(arc)for(let i=0;i<=1000;i++){const a=i*Math.PI/2000;put(center.x+sx*radius*Math.cos(a),center.y+sy*radius*Math.sin(a));}
 if(leaf)for(let i=0;i<=radius;i+=.2)put(center.x+sx*i,center.y);
 return {data,width,height};
}

test('floor/floor is an interior door for both bbox orientations and original classes',()=>{
 for(const cls of ['door','window'])assert.equal(classifyOpeningByLocation({...box,cls},maskSides(0,0),240,240).kind,'interior-door');
 const r=classifyOpeningByLocation({x:90,y:90,w:60,h:8},new Uint8Array(240*240),240,240);
 assert.equal(r.kind,'interior-door');assert.equal(r.sideA.total,161);assert.equal(r.sideB.counts[0],161);
});
test('outside/floor and mixed wall/outside are exterior; pure wall is unknown',()=>{
 assert.equal(classifyOpeningByLocation(box,maskSides(4,0),240,240).kind,'exterior-opening');
 const mixed=maskSides(1,0);for(let y=0;y<240;y++)for(let x=0;x<75;x++)mixed[y*240+x]=4;
 assert.equal(classifyOpeningByLocation(box,mixed,240,240).kind,'exterior-opening');
 assert.equal(classifyOpeningByLocation(box,maskSides(1,1),240,240).kind,'unknown');
});
test('invalid and clipped samples do not fabricate outside pixels',()=>{
 for(const b of [{...box,x:NaN},{x:-500,y:-500,w:8,h:60}])assert.equal(classifyOpeningByLocation(b,maskSides(0,0),240,240).kind,'unknown');
 assert.equal(classifyOpeningByLocation(box,null,240,240).kind,'unknown');
});
for(const sx of [-1,1])for(const sy of [-1,1])test(`local quarter arc with perpendicular leaf (${sx},${sy})`,()=>{
 assert.equal(hasDoorArc(box,symbol({sx,sy})),true);
});
test('faint door symbol remains detectable and reports a bounded local ROI',()=>{
 const result=analyzeDoorArc(box,symbol({level:220}));assert.equal(result.found,true);
 assert.ok(Math.abs(result.radius-60)<6);assert.ok(result.roi.x0>=box.x-72);assert.ok(result.roi.x1<=box.x+box.w+72);
});
test('blank image, isolated leaf, isolated arc, wrong radius, and distant arc are not door symbols',()=>{
 for(const options of [{arc:false,leaf:false},{arc:false},{leaf:false},{radius:20},{center:{x:180,y:170}}])assert.equal(hasDoorArc(box,symbol(options)),false,JSON.stringify(options));
 assert.equal(analyzeDoorArc(box,null).available,false);
});
test('straight window frame and floor grid cannot substitute for curved edges',()=>{
 const image=symbol({arc:false,leaf:false});
 for(let y=0;y<240;y++)for(let x=0;x<240;x++)if(x%12===0||y%12===0)image.data[y*240+x]=100;
 assert.equal(hasDoorArc(box,image),false);
});
test('RGBA luminance conversion uses unpainted source pixels',()=>{
 assert.deepEqual([...imageGrayFromImageData({width:2,height:1,data:[255,0,0,255,0,255,0,255]}).data],[76,150]);
});
test('external arc becomes entrance, no arc feeds windows, and interior YOLO window becomes door',()=>{
 const blank=symbol({arc:false,leaf:false}),openings={doors:[box],windows:[]};
 const outside=maskSides(4,0),converted=classifyOpenings(openings,outside,240,240,blank);
 assert.equal(converted.doors.length,0);assert.equal(converted.windows.length,1);
 const entrance=classifyOpenings(openings,outside,240,240,symbol());
 assert.equal(doorsToHome(entrance.doors,{x:0,y:0,w:240,h:240},10,10).doors[0].kind,'entrance');
 const interior=classifyOpenings({doors:[],windows:[{...box,cls:'window'}]},maskSides(0,0),240,240,blank);
 assert.equal(interior.doors.length,1);assert.equal(interior.windows.length,0);
 assert.equal(classifyOpenings(openings,outside,240,240).doors[0].classification,'unknown');
});
test('window veto remains strictly above 75%, including after interior classification',()=>{
 const b={x:2,y:2,w:7,h:7},mask=new Uint8Array(12*12);let n=0;
 for(let y=4;y<=7;y++)for(let x=4;x<=7;x++)mask[y*12+x]=n++<12?3:0;
 assert.equal(filterDoorsByMaskClass([b],mask,12,12).doors.length,1);
 mask[7*12+4]=3;assert.equal(filterDoorsByMaskClass([b],mask,12,12).doors.length,0);
});
