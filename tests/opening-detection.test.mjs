import test from 'node:test';
import assert from 'node:assert/strict';
import {selectOpenings,openingsToHome} from '../public/opening-detection.js';
import {roomsFromPolygons,homePlanSVG} from '../public/home-domain.js';
import {buildHomeGeometry} from '../public/home-scene.js';

test('door and window detector fallbacks are independent; comparison preserves segmentation',()=>{
 const mask=new Uint8Array(100).fill(4);for(let y=1;y<3;y++)for(let x=1;x<5;x++)mask[y*10+x]=3;
 const box={x:5,y:6,w:4,h:2,cls:'door',score:.7};
 const fallback=selectOpenings([box],mask,10,10);
 assert.equal(fallback.doors.length,1);assert.equal(fallback.windows.length,1);assert.equal(fallback.windowSource,'segmentation');
 const windows=[{...box,cls:'window'}];
 const yolo=selectOpenings(windows,mask,10,10);
 assert.equal(yolo.windowSource,'yolo');assert.equal(yolo.windows[0].cx,7);
 assert.equal(selectOpenings(windows,mask,10,10,{windowSource:'segmentation'}).windows[0].x,1);
 assert.equal(selectOpenings([{...box,cls:'window',x:NaN}],mask,10,10).windowSource,'segmentation');
});

test('window coordinates use the house frame and survive into both 2D and 3D',()=>{
 const frame={x:100,y:50,w:400,h:200},windows=[{cx:300,cy:50,w:80,h:8,horizontal:true}];
 const options={frame,windows,walls:{hLines:[{pos:50,from:100,to:500,len:400}],vLines:[]}};
 const poly={polygon:[[100,50],[500,50],[500,250],[100,250]],area:80000,bbox:[100,50,500,250]};
 const home=roomsFromPolygons([poly],600,400,8,4,options);
 const converted=openingsToHome(windows,frame,8,4)[0];
 assert.equal(home.windows[0].x,converted.x);assert.equal(home.windows[0].z,-2);assert.equal(home.windows[0].w,1.6);
 assert.match(homePlanSVG(home),/data-opening="window"/);
 const geometry=buildHomeGeometry(home,false);
 assert.equal(geometry.children.filter(c=>c.userData.window).length,1);
 assert.ok(geometry.children.some(c=>c.geometry?.parameters?.height>2.5),'segmented polygon homes must have standing walls');
 assert.equal(buildHomeGeometry({...home,windows:[]},false).children.filter(c=>c.userData.window).length,0);
});
