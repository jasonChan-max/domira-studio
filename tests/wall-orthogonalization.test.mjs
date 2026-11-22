import test from 'node:test';
import assert from 'node:assert/strict';
import clipping from '../public/vendor/polygon-clipping.js';
import {wallContoursFromMask,orthogonalizeWallContours,isSimpleRing,signedArea} from '../public/wall-contours.js';
const area=shapes=>shapes.reduce((sum,s)=>sum+signedArea(s.outer)+s.holes.reduce((n,r)=>n+signedArea(r),0),0);
const count=shapes=>shapes.reduce((sum,s)=>sum+s.outer.length+s.holes.reduce((n,r)=>n+r.length,0),0);
const shape=outer=>({outer,holes:[],areaPixels:signedArea(outer)});
const subset=(after,before)=>assert.deepEqual(clipping.difference(after.map(s=>[s.outer,...s.holes]),before.map(s=>[s.outer,...s.holes])),[]);

test('长墙台阶合并为直线，保留至少 95% 面积且不向房间增加墙体',()=>{
 const width=200,height=100,mask=new Uint8Array(width*height).fill(4);
 for(let x=10;x<190;x++)for(let y=20+(Math.floor(x/30)%2);y<60;y++)mask[y*width+x]=1;
 const before=wallContoursFromMask(mask,width,height,{epsilon:0,orthogonalize:false}),snapshot=structuredClone(before);
 const after=orthogonalizeWallContours(before);
 assert.equal(count(after),4);assert.ok(count(before)>count(after));assert.ok(area(after)/area(before)>=.95);
 subset(after,before);assert.deepEqual(before,snapshot);assert.ok(after.every(s=>isSimpleRing(s.outer)));
});
test('接近轴向的斜边吸附，明确的 40 度斜墙保留',()=>{
 const before=[shape([[0,0],[100,2],[100,42],[0,40]])],after=orthogonalizeWallContours(before);
 assert.ok(after[0].outer.every((p,i,r)=>p[0]===r[(i+1)%r.length][0]||p[1]===r[(i+1)%r.length][1]));
 subset(after,before);assert.ok(area(after)/area(before)>=.95);
 const sloped=[shape([[10,0],[110,84],[100,100],[0,16]])];assert.deepEqual(orthogonalizeWallContours(sloped),sloped);
});
test('窄通道与内孔正交化不会自交、封死空洞或侵入另一个轮廓',()=>{
 const width=120,height=100,mask=new Uint8Array(width*height).fill(4);
 for(let y=10;y<90;y++)for(let x=10;x<110;x++)if(x<22+(y%3===0?1:0)||x>=98||y<22||y>=78)mask[y*width+x]=1;
 const before=wallContoursFromMask(mask,width,height,{orthogonalize:false}),after=wallContoursFromMask(mask,width,height);
 assert.equal(after.length,1);assert.equal(after[0].holes.length,1);
 assert.ok([after[0].outer,...after[0].holes].every(isSimpleRing));subset(after,before);assert.ok(area(after)/area(before)>=.95);
 assert.equal(isSimpleRing([[0,0],[5,5],[0,5],[5,0]]),false);
 assert.equal(isSimpleRing([[0,0],[4,0],[2,0],[2,2],[0,2]]),false);
});
test('关闭正交化保留原始轮廓，保真预算不足时安全回退',()=>{
 const source=[shape([[0,0],[100,2],[100,22],[0,20]])];
 assert.deepEqual(orthogonalizeWallContours(source,{maxLossRatio:0}),source);
 assert.throws(()=>orthogonalizeWallContours(source,{maxLossRatio:.1}),/保真/);
 const mask=new Uint8Array(100).fill(4);for(let y=2;y<8;y++)for(let x=2;x<8;x++)mask[y*10+x]=1;
 assert.deepEqual(wallContoursFromMask(mask,10,10,{orthogonalize:false})[0].outer,[[2,2],[8,2],[8,8],[2,8]]);
});
