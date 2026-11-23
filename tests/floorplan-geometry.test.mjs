import test from 'node:test';
import assert from 'node:assert/strict';
import {geometryFromSegmentation,homeFromRecognition,attachDetectedOpenings,scaleDetectedGeometry} from '../public/floorplan-geometry.js';
import {homePlanSVG} from '../public/home-domain.js';
import {buildHomeGeometry} from '../public/home-scene.js';

function fixture(){
 const width=100,height=100,mask=new Uint8Array(width*height).fill(4);
 for(let y=10;y<90;y++)for(let x=10;x<90;x++)mask[y*width+x]=(x<15||x>=85||y<15||y>=85)?1:0;
 for(let y=10;y<15;y++)for(let x=40;x<60;x++)mask[y*width+x]=3;
 return {mask,width,height};
}
const window={x:40,y:10,w:20,h:5,cls:'window',score:.9};
const door={x:10,y:40,w:4,h:15,cls:'door',score:.8};
test('主识别入口同时保留门窗、墙轮廓，保存后 2D 与 3D 都能读取窗',()=>{
 const result=geometryFromSegmentation(fixture(),[window,door]);
 assert.equal(result.windowSource,'yolo');assert.equal(result.windows.length,1);assert.equal(result.doors.length,1);assert.ok(result.lines.contours.length);
 const home=JSON.parse(JSON.stringify(homeFromRecognition(result,8,8,{height:2.7})));
 assert.equal(home.windowSource,'yolo');assert.equal(home.windows.length,1);assert.equal(home.doors.length,1);
 assert.equal(home.windows[0].x,0);
 assert.match(homePlanSVG(home),/data-opening="window"/);
 const group=buildHomeGeometry(home,false);
 assert.equal(group.children.filter(o=>o.userData.window).length,1);
 const pane=group.children.find(o=>o.userData.window);
 assert.ok(Math.abs(pane.position.y-pane.geometry.parameters.height/2-.85)<1e-6);
 assert.ok(group.children.some(o=>o.userData.wallPart==='contour'));
});
test('YOLO 没有窗或检测失败时窗独立回退分割，已检出的门不丢失',()=>{
 const withDoor=geometryFromSegmentation(fixture(),[door]);
 assert.equal(withDoor.windowSource,'segmentation');assert.equal(withDoor.windows.length,1);assert.equal(withDoor.doors[0].score,.8);
 const failed=geometryFromSegmentation(fixture(),[]);
 assert.equal(failed.windowSource,'segmentation');assert.equal(failed.windows.length,1);
});
test('AI 路径仅接入识别门窗，不改变 AI 房间的位置、尺寸或自动修正策略',()=>{
 const result=geometryFromSegmentation(fixture(),[window,door]),home={width:8,depth:8,rooms:[{id:'r',x:2,z:3,width:4,depth:5}]};
 const rooms=structuredClone(home.rooms);attachDetectedOpenings(home,result);
 assert.deepEqual(home.rooms,rooms);assert.equal(home.windows.length,1);assert.equal(home.windowSource,'yolo');
 assert.equal(attachDetectedOpenings(home,null),home);
});
test('修改长宽时窗、门、墙轮廓与房间局部多边形按同轴缩放，保存后不漂移',()=>{
 const home=homeFromRecognition(geometryFromSegmentation(fixture(),[window,door]),8,8);
 const before=structuredClone(home);scaleDetectedGeometry(home,'width',2);
 assert.equal(home.windows[0].x,before.windows[0].x*2);assert.equal(home.windows[0].w,before.windows[0].w*2);assert.equal(home.windows[0].z,before.windows[0].z);
 assert.equal(home.windows[0].wallFootprint.x0,before.windows[0].wallFootprint.x0*2);
 assert.equal(home.walls.contours[0].outer[0][0],before.walls.contours[0].outer[0][0]*2);
 scaleDetectedGeometry(home,'depth',.5);assert.equal(home.windows[0].z,before.windows[0].z*.5);assert.equal(home.doors[0].d,before.doors[0].d*.5);
 assert.equal(home.windows[0].wallFootprint.y1,before.windows[0].wallFootprint.y1*.5);
 assert.throws(()=>scaleDetectedGeometry(home,'height',1),/无效/);
});
