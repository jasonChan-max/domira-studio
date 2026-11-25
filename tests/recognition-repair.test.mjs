import test from 'node:test';
import assert from 'node:assert/strict';
import {roomsWithinHouse,mergeRoomFragments,assessWindowSupport,selectSupportedWindows} from '../public/plan-selection.js';
import {geometryFromSegmentation,homeFromRecognition} from '../public/floorplan-geometry.js';
import {validateHome} from '../public/home-domain.js';
const room=(x,y,w,h)=>({polygon:[[x,y],[x+w,y],[x+w,y+h],[x,y+h]],bbox:[x,y,x+w,y+h],area:w*h,pixels:w*h});
function fixture(){
 const width=100,height=100,mask=new Uint8Array(width*height).fill(4);
 for(let y=10;y<90;y++)for(let x=10;x<90;x++)mask[y*width+x]=(x<14||x>=86||y<14||y>=86)?1:0;
 for(let x=23;x<37;x++)for(let y=10;y<14;y++)mask[y*width+x]=3;
 return {mask,width,height};
}
test('只合并分界无墙门支持的小矩形碎片，真实门和实体隔墙阻止合并',()=>{
 const rooms=[room(4,4,10,10),room(4,15,10,10),room(30,4,50,50)],mask=new Uint8Array(10000);
 const merged=mergeRoomFragments(rooms,mask,100,100);assert.equal(merged.rooms.length,2);assert.equal(merged.merged.length,1);assert.deepEqual(merged.rooms[0].bbox,[4,4,14,25]);
 for(const cls of [1,2]){
  const divided=mask.slice();for(let x=4;x<14;x++)divided[14*100+x]=cls;
  assert.equal(mergeRoomFragments(rooms,divided,100,100).rooms.length,3);
 }
 const narrowDoor=mask.slice();narrowDoor[14*100+9]=2;assert.equal(mergeRoomFragments(rooms,narrowDoor,100,100).rooms.length,3);
 assert.equal(mergeRoomFragments([room(4,4,10,10),room(8,15,10,10),rooms[2]],mask,100,100).rooms.length,3);
});
test('房间多边形在数据层裁到主体外框，小比例尺建房也不会越界',()=>{
 const input=[room(5,20,25,20),room(0,0,3,3)],before=structuredClone(input),clipped=roomsWithinHouse(input,{x:10,y:10,w:80,h:80});
 assert.equal(clipped.length,1);assert.deepEqual(clipped[0].bbox,[10,20,30,40]);assert.deepEqual(input,before);
 const f=fixture(),result=geometryFromSegmentation(f,[]);
 result.polygons=clipped;
 for(const width of [4.78,10]){const home=homeFromRecognition(result,width,width);assert.equal(validateHome(home),home);}
});
test('检测框中心略超出外框仍可吸附真实墙带，远处尺寸线不能成为窗',()=>{
 const f=fixture(),frame={x:10,y:10,w:80,h:80},shifted={x:23,y:7,w:14,h:4};
 const valid=assessWindowSupport(f.mask,100,100,shifted,frame);assert.equal(valid.valid,true);assert.equal(valid.onExteriorWall,true);assert.deepEqual(valid.footprint,{x0:23,x1:37,y0:10,y1:14});
 const invalid=assessWindowSupport(f.mask,100,100,{...shifted,y:0},frame);assert.equal(invalid.valid,false);assert.equal(invalid.onExteriorWall,false);assert.ok(invalid.nearestWall.ratio>=1.5);
});
test('分割窗与外墙证据共同纠正被检成门的真窗，保留其他真实门且不重复已有窗',()=>{
 const f=fixture(),window={x:23,y:10,w:14,h:4,cls:'window',score:.9},misclassified={x:10,y:40,w:4,h:15,cls:'door',score:.5},door={x:86,y:50,w:4,h:15,cls:'door',score:.8};
 for(let y=40;y<55;y++)for(let x=10;x<14;x++)f.mask[y*100+x]=3;
 const before=f.mask.slice(),recognized=geometryFromSegmentation(f,[window,misclassified,door]);
 assert.equal(recognized.windows.length,2);assert.equal(recognized.windowSource,'yolo+segmentation');assert.deepEqual(recognized.doors.map(d=>d.score),[.8]);assert.equal(recognized.selection.maskClassDoors.rejected.filter(b=>b.originalClass==='door').length,1);assert.deepEqual(f.mask,before);
 const again=selectSupportedWindows(f.mask,100,100,recognized.windows,recognized.frame,{recoverFromSegmentation:true,doors:recognized.doors});assert.equal(again.windows.length,2);assert.equal(again.recovered.length,0);
 const switched=geometryFromSegmentation(f,[window,misclassified,door],{orthogonalize:false});assert.equal(switched.selection.contours.orthogonalize,false);
});
