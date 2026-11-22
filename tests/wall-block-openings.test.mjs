import test from 'node:test';
import assert from 'node:assert/strict';
import {cutWallBlock} from '../public/wall-openings.js';
import {buildHomeGeometry} from '../public/home-scene.js';

const block={x0:-2,x1:2,y0:-.1,y1:.1};
const door={x:0,z:0,w:1,d:.2,horizontal:true};
const contains=(b,x,y,z)=>x>b.x0&&x<b.x1&&z>b.y0&&z<b.y1&&y>b.bottom&&y<b.top;
test('墙块门洞保留两侧墙和过梁，门下方不残留墙体',()=>{
 const {solids}=cutWallBlock(block,[door],[],2.7);
 assert.equal(solids.length,3);assert.equal(solids.filter(s=>s.kind==='lintel').length,1);
 assert.equal(solids.some(b=>contains(b,0,1,0)),false);
 assert.equal(solids.some(b=>contains(b,0,2.3,0)),true);
 assert.ok(Math.abs(solids.find(s=>s.kind==='lintel').bottom-2.1)<1e-9);
});
test('墙块窗洞保留窗台、上墙和玻璃，重叠的门优先通行',()=>{
 const window={...door,w:1.5};const p=cutWallBlock(block,[],[window]);
 assert.equal(p.solids.filter(s=>s.kind==='sill').length,1);assert.equal(p.glass.length,1);
 assert.equal(p.solids.some(b=>contains(b,0,1.5,0)),false);
 assert.equal(p.solids.some(b=>contains(b,0,.4,0)),true);
 assert.equal(cutWallBlock(block,[door],[window]).glass.some(b=>contains(b,0,1.5,0)),false);
});
test('竖墙也能开洞，离开墙厚范围、方向不符或无重叠的框不能切墙',()=>{
 const vertical={x0:-.1,x1:.1,y0:-2,y1:2};
 assert.equal(cutWallBlock(vertical,[{...door,horizontal:false,w:.2,d:1}]).solids.length,3);
 for(const invalid of [{...door,z:.1},{...door,horizontal:false},{...door,x:4},{...door,w:NaN}])assert.equal(cutWallBlock(block,[invalid]).solids.length,1);
});
test('真实 blocks 渲染分支会生成过梁并保留线分支',()=>{
 const room={id:'r',kind:'other',x:0,z:0,width:4,depth:4,height:2.7,polygon:[[-2,-2],[2,-2],[2,2],[-2,2]],openings:[],items:[]};
 const geometry=buildHomeGeometry({width:4,depth:4,height:2.7,rooms:[room],doors:[door],windows:[],walls:{blocks:[block]}},false);
 assert.equal(geometry.children.filter(c=>c.userData.wallPart==='lintel').length,1);
 assert.equal(geometry.children.filter(c=>c.userData.wall).length,3);
 assert.ok(buildHomeGeometry({width:4,depth:4,height:2.7,rooms:[{...room,polygon:[]}],doors:[],walls:null},false).children.length>2);
});
